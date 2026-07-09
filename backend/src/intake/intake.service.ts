import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import {
  ActorUser,
  PatientAccessService,
} from '../common/patient-access.service.js'
import { DrugEnrichmentService } from '../drug-enrichment/drug-enrichment.service.js'
import { INTAKE_EVENTS } from './intake-events.js'
import {
  DrugClass,
  EnrollmentStatus,
  MedicationHoldReason,
  MedicationVerificationStatus,
  NotificationChannel,
  Prisma,
  ProfileVerificationStatus,
  UserRole,
  VerificationChangeType,
  VerifierRole,
} from '../generated/prisma/client.js'
import { canCompleteEnrollment } from '../practice/enrollment-gate.js'
import { resolveCanonicalDrugId, resolveCanonicalDrugClass } from './medication-dedup.js'
import type {
  AdminAddMedicationDto,
  AdminEditMedicationDto,
} from './dto/admin-medication.dto.js'
import {
  systemMsgMedicationHold,
  systemMsgProfileFieldRejected,
  isProviderDirectedHold,
} from '@cardioplace/shared'
import type {
  PatientMedication,
  PatientProfile,
} from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  pickDisplayName,
  pickDisplayRole,
  resolveUserDisplays,
} from '../common/user-name-resolver.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import type {
  CorrectProfileDto,
  VerifyProfileDto,
} from './dto/correct-profile.dto.js'
import type { IntakeMedicationsDto } from './dto/intake-medications.dto.js'
import type { IntakeMedicationItemDto } from './dto/intake-medications.dto.js'
import type { IntakeProfileDto } from './dto/intake-profile.dto.js'
import type { PregnancyDto } from './dto/pregnancy.dto.js'
import type { ReplaceMedicationsDto } from './dto/replace-medications.dto.js'
import type { UpdateMedicationDto } from './dto/update-medication.dto.js'
import type { VerifyMedicationDto } from './dto/verify-medication.dto.js'

type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

// Prisma Postgres (managed, network-latency) needs more than the default 5 s
// interactive-transaction budget once we fan out 10+ log rows. Generous
// timeout + maxWait keeps local-dev behaviour unchanged. maxWait was bumped
// from 5s → 15s after seeing P2028 ("Unable to start a transaction") on
// burst load — proxy round-trips can eat past 5s when the pool needs a
// fresh connection.
const TX_OPTIONS = { timeout: 20_000, maxWait: 15_000 } as const

// Clinical fields on PatientProfile that participate in verification logs.
// Any change to one of these fields produces a ProfileVerificationLog row.
const VERIFIABLE_PROFILE_FIELDS = [
  'gender',
  'heightCm',
  'isPregnant',
  'pregnancyDueDate',
  'historyHDP',
  'hasHeartFailure',
  'heartFailureType',
  'hasAFib',
  'hasCAD',
  'hasHCM',
  'hasDCM',
  'hasAorticStenosis',
  'hasTachycardia',
  'hasBradycardia',
  'diagnosedHypertension',
] as const satisfies readonly (keyof PatientProfile)[]

type VerifiableField = (typeof VERIFIABLE_PROFILE_FIELDS)[number]

// Threshold-mandatory conditions (mirrors enrollment-gate / thresholdMandatory).
// A patient self-edit touching one of these on an enrolled profile gets a
// care-team "review needed" notice (IVR-04 sibling for the non-revert cases).
const SERIOUS_CONDITION_LABELS: Partial<Record<VerifiableField, string>> = {
  heartFailureType: 'heart failure type',
  hasHCM: 'HCM',
  hasDCM: 'DCM',
  hasAorticStenosis: 'aortic stenosis',
}

// Patient-facing labels used in the "please re-check your {field}" inbox notice
// dispatched when an admin rejects a self-reported field. Lowercase nouns so
// they read naturally mid-sentence. NEEDS Dr. Singal sign-off on wording.
const PROFILE_FIELD_LABELS: Record<VerifiableField, string> = {
  gender: 'sex',
  heightCm: 'height',
  isPregnant: 'pregnancy status',
  pregnancyDueDate: 'pregnancy due date',
  historyHDP: 'history of hypertensive disorder of pregnancy (HDP)',
  hasHeartFailure: 'heart failure history',
  heartFailureType: 'heart failure type',
  hasAFib: 'atrial fibrillation history',
  hasCAD: 'coronary artery disease history',
  hasHCM: 'hypertrophic cardiomyopathy history',
  hasDCM: 'dilated cardiomyopathy history',
  hasAorticStenosis: 'aortic stenosis history',
  hasTachycardia: 'tachycardia history',
  hasBradycardia: 'bradycardia history',
  diagnosedHypertension: 'high blood pressure diagnosis',
}

/**
 * Round 2 A4 — extract the caregiver id from a verification-log fieldPath.
 * Mirrors the write site `caregiver.service.ts:writeAudit` which uses
 * `fieldPath: caregiver:${id}`. Returns null for non-caregiver logs.
 */
function caregiverIdFromFieldPath(fieldPath: string | null | undefined): string | null {
  if (!fieldPath || !fieldPath.startsWith('caregiver:')) return null
  const id = fieldPath.slice('caregiver:'.length).trim()
  return id.length > 0 ? id : null
}

@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly drugEnrichment: DrugEnrichmentService,
    private readonly access: PatientAccessService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Notify subscribers that a patient's intake or medication list changed so
   * downstream caches (ChatService.contextCache, VoiceService.contextCache)
   * drop the stale entry. Decoupled via @nestjs/event-emitter to avoid a
   * ChatModule ↔ IntakeModule circular import. Listener lives in
   * ChatService.onIntakeUpdated (and VoiceService equivalent).
   */
  private emitIntakeUpdated(userId: string): void {
    if (!userId) return
    this.eventEmitter.emit(INTAKE_EVENTS.UPDATED, { userId })
  }

  /**
   * Background-enrich freeform medications (drugClass = OTHER_UNVERIFIED) by
   * resolving canonical name + pill image + plain-language description via
   * RxNorm/DailyMed/OpenFDA. Fire-and-forget — never blocks intake submit.
   * Catalog-tapped meds keep their hand-written `purpose` and brand icon and
   * are skipped here.
   */
  private kickOffMedicationEnrichment(meds: PatientMedication[]): void {
    const freeform = meds.filter((m) => m.drugClass === DrugClass.OTHER_UNVERIFIED)
    if (!freeform.length) return

    void Promise.allSettled(
      freeform.map(async (med) => {
        const enrichment = await this.drugEnrichment.enrich(med.drugName)
        if (!enrichment) return
        await this.prisma.patientMedication.update({
          where: { id: med.id },
          data: {
            pillImageUrl: enrichment.pillImageUrl,
            plainLanguageDescription: enrichment.plainLanguageDescription,
          },
        })
      }),
    ).catch((err) => {
      this.logger.warn(`background medication enrichment failed: ${(err as Error).message}`)
    })
  }

  // ─── Patient: POST /intake/profile ───────────────────────────────────────

  async upsertProfile(userId: string, dto: IntakeProfileDto) {
    const { result, enrollmentReverted, conditionReviewLabels } = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.patientProfile.findUnique({ where: { userId } })

      const patch = this.stripUndefined(dto)
      // Pull dateOfBirth out — it lives on User, not PatientProfile. Captured
      // at intake A1 so the rule engine has age before the first check-in.
      const dobPatch = patch.dateOfBirth
      delete (patch as Partial<IntakeProfileDto>).dateOfBirth
      this.validatePregnancyShape(patch, existing)

      // Diff every verifiable field the DTO touches.
      const changes = this.diffProfile(existing, patch)

      if (dobPatch !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: { dateOfBirth: dobPatch === null ? null : new Date(dobPatch) },
        })
      }

      const profile = existing
        ? await tx.patientProfile.update({
            where: { userId },
            data: {
              ...patch,
              pregnancyDueDate: this.coerceDate(patch.pregnancyDueDate),
              profileVerificationStatus: changes.length
                ? ProfileVerificationStatus.UNVERIFIED
                : existing.profileVerificationStatus,
              profileLastEditedAt: changes.length ? new Date() : existing.profileLastEditedAt,
              profileVerifiedAt: changes.length ? null : existing.profileVerifiedAt,
              profileVerifiedBy: changes.length ? null : existing.profileVerifiedBy,
            },
          })
        : await tx.patientProfile.create({
            data: {
              userId,
              ...patch,
              pregnancyDueDate: this.coerceDate(patch.pregnancyDueDate),
              profileVerificationStatus: ProfileVerificationStatus.UNVERIFIED,
              profileLastEditedAt: new Date(),
            },
          })

      let enrollmentReverted = false
      let conditionReviewLabels: string[] = []
      if (changes.length) {
        await this.writeProfileLogs(tx, {
          userId,
          changes,
          changedBy: userId,
          changedByRole: VerifierRole.PATIENT,
          changeType: VerificationChangeType.PATIENT_REPORT,
        })

        // IVR-04 — a patient self-adding a threshold-mandatory condition
        // (HFrEF / HCM / DCM) while enrolled must also revert enrollment, same
        // as the admin correction path. No-op on create / when not enrolled.
        enrollmentReverted = await this.revertEnrollmentIfThresholdGap(
          tx,
          userId,
          userId,
          VerifierRole.PATIENT,
        )

        // Sibling case: the patient changed a serious condition but it did NOT
        // trip the revert — i.e. they removed one, or added one while a
        // threshold already exists. If they're ENROLLED (post-setup), nudge the
        // care team to re-verify + revisit the threshold. Skipped when not
        // enrolled (initial intake) — the verification queue covers that.
        if (!enrollmentReverted) {
          const serious = changes
            .map((c) => SERIOUS_CONDITION_LABELS[c.field])
            .filter((l): l is string => !!l)
          if (serious.length) {
            const u = await tx.user.findUnique({
              where: { id: userId },
              select: { enrollmentStatus: true },
            })
            if (u?.enrollmentStatus === EnrollmentStatus.ENROLLED) {
              conditionReviewLabels = serious
            }
          }
        }
      }

      return {
        result: {
          statusCode: 200,
          message: existing ? 'Profile updated' : 'Profile created',
          data: this.serializeProfile(profile),
          changedFields: changes.map((c) => c.field),
        },
        enrollmentReverted,
        conditionReviewLabels,
      }
    }, TX_OPTIONS)

    // IVR-04 (patient path) — dispatch care-team notices AFTER the tx commits
    // so a notification failure can't roll back the safety revert. Only the
    // patient path notifies: the admin path's actor is already on the screen.
    if (enrollmentReverted) {
      await this.notifyCareTeamEnrollmentPaused(userId)
    } else if (conditionReviewLabels.length) {
      await this.notifyCareTeamConditionReview(userId, conditionReviewLabels)
    }
    // Drop any stale chat/voice patient-context cache — the next prompt build
    // must see the new profile so the INTAKE STATUS block flips immediately.
    this.emitIntakeUpdated(userId)
    return result
  }

  // ─── Patient: POST /me/pregnancy ─────────────────────────────────────────

  async updatePregnancy(userId: string, dto: PregnancyDto) {
    const patch: Partial<IntakeProfileDto> = {
      isPregnant: dto.isPregnant,
      pregnancyDueDate: dto.pregnancyDueDate ?? null,
    }
    if (dto.historyHDP !== undefined) {
      patch.historyHDP = dto.historyHDP
    }
    // Clearing pregnancy also clears the due date by contract.
    if (!dto.isPregnant) {
      patch.pregnancyDueDate = null
    }
    return this.upsertProfile(userId, patch as IntakeProfileDto)
  }

  // ─── Patient: POST /intake/medications ───────────────────────────────────

  async createMedications(userId: string, dto: IntakeMedicationsDto) {
    return this.prisma.$transaction(async (tx) => {
      // F13 — load-bearing ACE/ARB contraindication. After a B4 angioedema
      // resolution the provider sets PatientProfile.aceContraindicatedAt. From
      // then on, an ACE inhibitor or ARB the patient re-adds must NOT be
      // trusted-then-verified like a normal self-report: it is forced into
      // AWAITING_PROVIDER (never auto-fires alerts) and the care team is
      // notified so they can review before the drug goes live.
      const profile = await tx.patientProfile.findUnique({
        where: { userId },
        select: { aceContraindicatedAt: true },
      })
      const aceContraindicated = profile?.aceContraindicatedAt != null
      const isContraindicatedReadd = (drugClass: DrugClass): boolean =>
        aceContraindicated &&
        (drugClass === DrugClass.ACE_INHIBITOR || drugClass === DrugClass.ARB)
      // Dedup against the patient's currently-active medications using the
      // same canonical key as PUT /me/medications (see medicationKey). Any
      // incoming item whose key matches an active row is silently dropped —
      // the existing row is returned in `data` instead of a duplicate. This
      // makes POST idempotent so a re-render or double-tap on the intake
      // screen can't produce phantom rows. The DB-level partial unique index
      // (uq_patientmed_active) is the belt to this suspenders.
      // Exclude REJECTED rows from the dedup set — re-adding a drug the
      // provider rejected must create a fresh UNVERIFIED row for re-review
      // (IVR-19), not silently match the terminal rejected record.
      const existingActive = await tx.patientMedication.findMany({
        where: {
          userId,
          discontinuedAt: null,
          verificationStatus: { not: MedicationVerificationStatus.REJECTED },
        },
      })
      const existingByKey = new Map(
        existingActive.map((m) => [this.medicationKey(m), m]),
      )

      const toCreate: IntakeMedicationItemDto[] = []
      const skippedExisting: PatientMedication[] = []
      const seenInPayload = new Set<string>()
      for (const item of dto.medications) {
        const key = this.medicationKey({
          drugName: item.drugName,
          drugClass: item.drugClass,
          isCombination: item.isCombination ?? false,
          frequency: item.frequency,
          combinationComponents: item.combinationComponents ?? [],
        })
        const existing = existingByKey.get(key)
        if (existing) {
          // Skip a row already on file; echo it back exactly once even if
          // the patient submits the same dup multiple times in one payload.
          if (!seenInPayload.has(key)) skippedExisting.push(existing)
        } else if (!seenInPayload.has(key)) {
          toCreate.push(item)
        }
        seenInPayload.add(key)
      }

      const created = await Promise.all(
        toCreate.map((item) =>
          tx.patientMedication.create({
            data: {
              userId,
              drugName: item.drugName,
              drugClass: item.drugClass,
              // #85 — canonical identity for brand/generic dedup (null when
              // off-catalog; dedup is skipped for null canonicals).
              canonicalDrugId: resolveCanonicalDrugId(item.drugName),
              frequency: item.frequency,
              isCombination: item.isCombination ?? false,
              combinationComponents: item.combinationComponents ?? [],
              source: item.source ?? 'PATIENT_SELF_REPORT',
              rawInputText: item.rawInputText,
              notes: item.notes,
              // Patient self-report starts unverified; voice/photo cannot
              // fire automated alerts until a provider verifies (see
              // BUILD_PLAN §3.4 safety-net table). F13 — a re-added ACE/ARB on
              // a contraindicated patient is also held for provider review.
              verificationStatus:
                isContraindicatedReadd(item.drugClass) ||
                item.source === 'PATIENT_VOICE' ||
                item.source === 'PATIENT_PHOTO'
                  ? MedicationVerificationStatus.AWAITING_PROVIDER
                  : MedicationVerificationStatus.UNVERIFIED,
            },
          }),
        ),
      )

      // F13 — collect contraindicated ACE/ARB re-adds so we can alert the care
      // team and tell the patient app the add needs provider review.
      const contraindicatedReadd = created.filter((m) =>
        isContraindicatedReadd(m.drugClass),
      )

      if (created.length) {
        await tx.profileVerificationLog.createMany({
          data: created.map((med) => ({
            userId,
            fieldPath: `medication:${med.id}`,
            previousValue: Prisma.JsonNull,
            newValue: this.serializeMedication(med) as Prisma.InputJsonValue,
            changedBy: userId,
            changedByRole: VerifierRole.PATIENT,
            changeType: VerificationChangeType.PATIENT_REPORT,
          })),
        })

        // Adding a new medication flips the patient profile back to
        // UNVERIFIED. Pure-dedup calls (no new rows) leave verification
        // status alone.
        await this.flipProfileToUnverified(tx, userId)
      }

      // F13 — fire a Tier-2-style admin notice to the patient's primary
      // provider for each contraindicated ACE/ARB re-add, so the care team
      // reviews before the held medication is ever trusted.
      if (contraindicatedReadd.length) {
        const assignment = await tx.patientProviderAssignment.findUnique({
          where: { userId },
          select: { primaryProviderId: true },
        })
        const providerId = assignment?.primaryProviderId
        if (providerId) {
          const drugList = contraindicatedReadd
            .map((m) => m.drugName)
            .join(', ')
          await tx.notification.create({
            data: {
              userId: providerId,
              channel: 'DASHBOARD',
              title: 'Contraindicated medication re-added',
              body: `Patient re-added a medication flagged as contraindicated (prior angioedema): ${drugList}. It is held for your review before it can be trusted.`,
              tips: [],
              dispatchTrigger: 'MEDICATION_CONTRAINDICATION',
            },
          })
        } else {
          this.logger.warn(
            `F13 — contraindicated ACE/ARB re-add for user ${userId} but no primary provider to notify (${contraindicatedReadd
              .map((m) => m.drugName)
              .join(', ')})`,
          )
        }
      }

      const responseRows = [...created, ...skippedExisting]
      const message = skippedExisting.length
        ? `${created.length} medication(s) recorded, ${skippedExisting.length} duplicate(s) skipped`
        : `${created.length} medication(s) recorded`

      return {
        result: {
          statusCode: 201,
          message,
          data: responseRows.map((m) => this.serializeMedication(m)),
          // F13 — names of any ACE/ARB the patient re-added while
          // contraindicated. The patient app uses this to confirm the
          // "needs provider review" outcome after an acknowledged add.
          contraindicatedReadd: contraindicatedReadd.map((m) => m.drugName),
        },
        created,
      }
    }, TX_OPTIONS).then(({ result, created }) => {
      this.kickOffMedicationEnrichment(created)
      this.emitIntakeUpdated(userId)
      return result
    })
  }

  // ─── Patient: PATCH /me/medications/:id ──────────────────────────────────

  async updateMedication(
    userId: string,
    medicationId: string,
    dto: UpdateMedicationDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.patientMedication.findFirst({
        where: { id: medicationId, userId },
      })
      if (!existing) {
        throw new NotFoundException('Medication not found')
      }
      if (existing.discontinuedAt) {
        throw new BadRequestException('Medication already discontinued')
      }

      const data: Prisma.PatientMedicationUpdateInput = {}
      const changedFields: string[] = []

      if (dto.discontinue === true) {
        data.discontinuedAt = new Date()
        changedFields.push('discontinuedAt')
      }
      if (dto.drugName !== undefined && dto.drugName !== existing.drugName) {
        data.drugName = dto.drugName
        changedFields.push('drugName')
      }
      if (dto.drugClass !== undefined && dto.drugClass !== existing.drugClass) {
        data.drugClass = dto.drugClass
        changedFields.push('drugClass')
      }
      if (dto.frequency !== undefined && dto.frequency !== existing.frequency) {
        data.frequency = dto.frequency
        changedFields.push('frequency')
      }
      if (
        dto.isCombination !== undefined &&
        dto.isCombination !== existing.isCombination
      ) {
        data.isCombination = dto.isCombination
        changedFields.push('isCombination')
      }
      if (dto.combinationComponents !== undefined) {
        data.combinationComponents = dto.combinationComponents
        changedFields.push('combinationComponents')
      }
      if (dto.rawInputText !== undefined) {
        data.rawInputText = dto.rawInputText
        changedFields.push('rawInputText')
      }
      if (dto.notes !== undefined) {
        data.notes = dto.notes
        changedFields.push('notes')
      }

      if (!changedFields.length) {
        return {
          statusCode: 200,
          message: 'No changes applied',
          data: this.serializeMedication(existing),
        }
      }

      // Patient edits always reset the medication back to UNVERIFIED so the
      // provider re-reviews the change (verification-on-edit rule).
      if (!dto.discontinue) {
        data.verificationStatus = MedicationVerificationStatus.UNVERIFIED
        data.verifiedByAdminId = null
        data.verifiedAt = null
      }

      const updated = await tx.patientMedication.update({
        where: { id: medicationId },
        data,
      })

      await tx.profileVerificationLog.createMany({
        data: changedFields.map((field) => ({
          userId,
          fieldPath: `medication:${medicationId}.${field}`,
          previousValue: this.toJsonValue(
            existing[field as keyof PatientMedication],
          ),
          newValue: this.toJsonValue(updated[field as keyof PatientMedication]),
          changedBy: userId,
          changedByRole: VerifierRole.PATIENT,
          changeType: VerificationChangeType.PATIENT_REPORT,
        })),
      })

      await this.flipProfileToUnverified(tx, userId)

      return {
        statusCode: 200,
        message: dto.discontinue
          ? 'Medication discontinued'
          : 'Medication updated',
        data: this.serializeMedication(updated),
      }
    }, TX_OPTIONS)
  }

  // ─── Patient: PUT /me/medications ────────────────────────────────────────
  //
  // Replace semantics. Soft-closes rows no longer in the list (sets
  // `discontinuedAt = now()`) and creates fresh rows for additions. Rows that
  // match by canonical key are left untouched to preserve provider
  // verification timestamps. We soft-close rather than hard-delete because
  // `discontinuedAt` is already the project's convention for "no longer
  // current" (see profile-resolver and monthly-reask) and keeps drug-exposure
  // history intact for Joint Commission audit. If any row was closed or
  // created, flip the profile back to UNVERIFIED.

  async replaceMedications(userId: string, dto: ReplaceMedicationsDto) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.patientMedication.findMany({
        where: { userId, discontinuedAt: null },
      })

      // Rejected rows are terminal audit records — a patient self-edit must
      // NEVER auto-close them (IVR-19: the old REJECTED row is preserved as-is,
      // not discontinued). Excluding them from the diff also guarantees that
      // re-selecting the same drug creates a fresh UNVERIFIED row rather than
      // matching/reviving the rejected one.
      const closeable = current.filter(
        (m) => m.verificationStatus !== MedicationVerificationStatus.REJECTED,
      )

      const { toClose, toCreate } = this.diffMedications(
        closeable,
        dto.medications,
      )

      if (!toClose.length && !toCreate.length) {
        return {
          result: {
            statusCode: 200,
            message: 'No changes applied',
            data: current.map((m) => this.serializeMedication(m)),
          },
          created: [] as PatientMedication[],
        }
      }

      const now = new Date()

      if (toClose.length) {
        await tx.patientMedication.updateMany({
          where: { id: { in: toClose.map((m) => m.id) } },
          data: { discontinuedAt: now },
        })
      }

      const created: PatientMedication[] = []
      for (const item of toCreate) {
        const row = await tx.patientMedication.create({
          data: {
            userId,
            drugName: item.drugName,
            drugClass: item.drugClass,
            // #85 — canonical identity for brand/generic dedup.
            canonicalDrugId: resolveCanonicalDrugId(item.drugName),
            frequency: item.frequency,
            isCombination: item.isCombination ?? false,
            combinationComponents: item.combinationComponents ?? [],
            source: item.source ?? 'PATIENT_SELF_REPORT',
            rawInputText: item.rawInputText,
            notes: item.notes,
            verificationStatus:
              item.source === 'PATIENT_VOICE' || item.source === 'PATIENT_PHOTO'
                ? MedicationVerificationStatus.AWAITING_PROVIDER
                : MedicationVerificationStatus.UNVERIFIED,
          },
        })
        created.push(row)
      }

      const logRows: Prisma.ProfileVerificationLogCreateManyInput[] = [
        ...toClose.map((med) => ({
          userId,
          fieldPath: `medication:${med.id}.discontinuedAt`,
          previousValue: Prisma.JsonNull,
          newValue: now.toISOString() as Prisma.InputJsonValue,
          changedBy: userId,
          changedByRole: VerifierRole.PATIENT,
          changeType: VerificationChangeType.PATIENT_REPORT,
          rationale: 'patient self-edit post-verification',
        })),
        ...created.map((med) => ({
          userId,
          fieldPath: `medication:${med.id}`,
          previousValue: Prisma.JsonNull,
          newValue: this.serializeMedication(med) as Prisma.InputJsonValue,
          changedBy: userId,
          changedByRole: VerifierRole.PATIENT,
          changeType: VerificationChangeType.PATIENT_REPORT,
          rationale: 'patient self-edit post-verification',
        })),
      ]
      if (logRows.length) {
        await tx.profileVerificationLog.createMany({ data: logRows })
      }

      await this.flipProfileToUnverified(tx, userId)

      const active = await tx.patientMedication.findMany({
        where: { userId, discontinuedAt: null },
        orderBy: { reportedAt: 'desc' },
      })

      return {
        result: {
          statusCode: 200,
          message: `Medication list replaced (${toClose.length} closed, ${toCreate.length} added)`,
          data: active.map((m) => this.serializeMedication(m)),
        },
        created,
      }
    }, TX_OPTIONS).then(({ result, created }) => {
      this.kickOffMedicationEnrichment(created)
      this.emitIntakeUpdated(userId)
      return result
    })
  }

  // ─── Admin: POST /admin/users/:id/verify-profile ─────────────────────────

  async verifyProfile(
    actor: ActorUser,
    patientUserId: string,
    dto: VerifyProfileDto,
    ctx?: { practiceId: string | null },
  ) {
    await this.access.assertCanAccessPatient(actor, patientUserId)
    const profile = await this.prisma.patientProfile.findUnique({
      where: { userId: patientUserId },
    })
    if (!profile) {
      throw new NotFoundException('Patient profile not found')
    }

    // Hard gate: cannot complete verification while any field is still in the
    // rejected ("needs correction") state. Rejecting a field flags it as wrong
    // and awaiting a correction or patient re-report; flipping the whole
    // profile to VERIFIED around it both defeats the safety net and produces a
    // contradictory "Verified" badge on a rejected row. The admin must Correct,
    // re-confirm, or have the patient re-report each one first. The Profile tab
    // disables the button and lists these — this is the backend belt.
    const latestByField = await this.latestLogTypeForFields(
      patientUserId,
      VERIFIABLE_PROFILE_FIELDS,
    )
    const stillRejected = [...latestByField.entries()]
      .filter(([, type]) => type === VerificationChangeType.ADMIN_REJECT)
      .map(([path]) => path.replace(/^profile\./, ''))
    if (stillRejected.length) {
      throw new BadRequestException(
        `Resolve rejected field(s) before completing verification: ${stillRejected.join(', ')}`,
      )
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.patientProfile.update({
        where: { userId: patientUserId },
        data: {
          profileVerificationStatus: ProfileVerificationStatus.VERIFIED,
          profileVerifiedAt: new Date(),
          profileVerifiedBy: actor.id,
        },
      }),
      this.prisma.profileVerificationLog.create({
        data: {
          userId: patientUserId,
          fieldPath: 'profile.verificationStatus',
          previousValue: profile.profileVerificationStatus,
          newValue: ProfileVerificationStatus.VERIFIED,
          changedBy: actor.id,
          changedByRole: VerifierRole.ADMIN,
          changeType: VerificationChangeType.ADMIN_VERIFY,
          rationale: dto.rationale,
          practiceContext: ctx?.practiceId ?? null,
        },
      }),
    ])

    return {
      statusCode: 200,
      message: 'Profile verified',
      data: this.serializeProfile(updated),
    }
  }

  // ─── Admin: POST /admin/users/:id/confirm-profile-field(s) ───────────────
  // Per-field ✓ "Confirm" (IVR-08). Writes an ADMIN_VERIFY audit row pinned to
  // each `profile.{field}` WITHOUT touching the whole-profile verification
  // status (that's what the footer "Verification complete" / verify-profile is
  // for). The admin Profile tab derives each field's status from the latest log
  // per `profile.{field}`, so this row is what makes the ✓ "stick".
  //
  // Fields whose latest log is already ADMIN_VERIFY are skipped so repeat clicks
  // / "Confirm all" don't pile up duplicate audit rows (same idempotency spirit
  // as the IVR-16 reject guard). Only VERIFIABLE_PROFILE_FIELDS are accepted.
  async confirmProfileFields(
    actor: ActorUser,
    patientUserId: string,
    dto: { fields: string[]; rationale?: string },
    ctx?: { practiceId: string | null },
  ) {
    await this.access.assertCanAccessPatient(actor, patientUserId)
    const profile = await this.prisma.patientProfile.findUnique({
      where: { userId: patientUserId },
    })
    if (!profile) {
      throw new NotFoundException('Patient profile not found')
    }
    const requested = Array.isArray(dto.fields) ? dto.fields : []
    const fields = requested.filter((f): f is VerifiableField =>
      (VERIFIABLE_PROFILE_FIELDS as readonly string[]).includes(f),
    )
    if (!fields.length) {
      throw new BadRequestException('No valid profile fields to confirm')
    }

    // Idempotency: drop fields already confirmed (latest log = ADMIN_VERIFY).
    const latestByField = await this.latestLogTypeForFields(patientUserId, fields)
    const toConfirm = fields.filter(
      (f) => latestByField.get(`profile.${f}`) !== VerificationChangeType.ADMIN_VERIFY,
    )

    if (toConfirm.length) {
      await this.prisma.profileVerificationLog.createMany({
        data: toConfirm.map((field) => ({
          userId: patientUserId,
          fieldPath: `profile.${field}`,
          previousValue: this.toJsonValue(profile[field as keyof PatientProfile]),
          newValue: this.toJsonValue(profile[field as keyof PatientProfile]),
          changedBy: actor.id,
          changedByRole: VerifierRole.ADMIN,
          changeType: VerificationChangeType.ADMIN_VERIFY,
          rationale: dto.rationale,
          practiceContext: ctx?.practiceId ?? null,
        })),
      })
    }

    return {
      statusCode: 200,
      message: toConfirm.length
        ? `${toConfirm.length} field(s) confirmed`
        : 'No new fields to confirm',
      data: this.serializeProfile(profile),
      confirmedFields: toConfirm,
    }
  }

  async confirmProfileField(
    actor: ActorUser,
    patientUserId: string,
    dto: { field: string; rationale?: string },
    ctx?: { practiceId: string | null },
  ) {
    if (!dto.field || typeof dto.field !== 'string') {
      throw new BadRequestException('field is required')
    }
    return this.confirmProfileFields(
      actor,
      patientUserId,
      { fields: [dto.field], rationale: dto.rationale },
      ctx,
    )
  }

  // Returns the most recent changeType per `profile.{field}` fieldPath for the
  // given fields. Used by the per-field confirm/reject idempotency guards.
  private async latestLogTypeForFields(
    userId: string,
    fields: readonly string[],
  ): Promise<Map<string, VerificationChangeType>> {
    const fieldPaths = fields.map((f) => `profile.${f}`)
    const logs = await this.prisma.profileVerificationLog.findMany({
      where: { userId, fieldPath: { in: fieldPaths } },
      orderBy: { createdAt: 'desc' },
      select: { fieldPath: true, changeType: true },
    })
    const latest = new Map<string, VerificationChangeType>()
    for (const log of logs) {
      // findMany is createdAt-desc, so the first row seen per path is the latest.
      if (!latest.has(log.fieldPath)) latest.set(log.fieldPath, log.changeType)
    }
    return latest
  }

  // ─── Admin: POST /admin/users/:id/reject-profile-field ───────────────────
  // Flips the whole profile back to UNVERIFIED and writes an ADMIN_REJECT
  // audit row pinned to the field the admin flagged. Used by the Flow H
  // Profile tab when an admin rejects a single field after a prior verify.
  async rejectProfileField(
    actor: ActorUser,
    patientUserId: string,
    dto: { field: string; rationale?: string },
    ctx?: { practiceId: string | null },
  ) {
    await this.access.assertCanAccessPatient(actor, patientUserId)
    const profile = await this.prisma.patientProfile.findUnique({
      where: { userId: patientUserId },
    })
    if (!profile) {
      throw new NotFoundException('Patient profile not found')
    }
    if (!dto.field || typeof dto.field !== 'string') {
      throw new BadRequestException('field is required')
    }

    // IVR-16 idempotency: rejecting an already-rejected field is a no-op so
    // repeat clicks don't pile up duplicate ADMIN_REJECT audit rows (the
    // profile is already UNVERIFIED from the first rejection). The FE also
    // hides the Reject button once a field is rejected — this is the backend
    // belt to that suspenders.
    const latestByField = await this.latestLogTypeForFields(patientUserId, [
      dto.field,
    ])
    if (
      latestByField.get(`profile.${dto.field}`) ===
      VerificationChangeType.ADMIN_REJECT
    ) {
      return {
        statusCode: 200,
        message: 'Field already rejected',
        data: this.serializeProfile(profile),
      }
    }

    const previousStatus = profile.profileVerificationStatus
    const fieldKey = dto.field as keyof typeof profile
    const previousValue = profile[fieldKey] ?? null

    const [updated] = await this.prisma.$transaction([
      this.prisma.patientProfile.update({
        where: { userId: patientUserId },
        data: {
          profileVerificationStatus: ProfileVerificationStatus.UNVERIFIED,
          profileVerifiedAt: null,
          profileVerifiedBy: null,
          profileLastEditedAt: new Date(),
        },
      }),
      this.prisma.profileVerificationLog.create({
        data: {
          userId: patientUserId,
          fieldPath: `profile.${dto.field}`,
          previousValue: previousValue as Prisma.InputJsonValue,
          newValue: Prisma.JsonNull,
          changedBy: actor.id,
          changedByRole: VerifierRole.ADMIN,
          changeType: VerificationChangeType.ADMIN_REJECT,
          rationale: dto.rationale,
          discrepancyFlag: true,
          practiceContext: ctx?.practiceId ?? null,
        },
      }),
      // Also write a status-flip log so the timeline shows why the profile
      // dropped back to UNVERIFIED.
      this.prisma.profileVerificationLog.create({
        data: {
          userId: patientUserId,
          fieldPath: 'profile.verificationStatus',
          previousValue: previousStatus,
          newValue: ProfileVerificationStatus.UNVERIFIED,
          changedBy: actor.id,
          changedByRole: VerifierRole.ADMIN,
          changeType: VerificationChangeType.ADMIN_REJECT,
          rationale: `Reverted to unverified — ${dto.field} rejected`,
          practiceContext: ctx?.practiceId ?? null,
        },
      }),
    ])

    // Notify the patient so they can re-check the flagged field (the value is
    // preserved — they confirm or update it). Best-effort + post-commit: a
    // dispatch failure must never undo the reject. Only the non-idempotent path
    // reaches here, so a repeat reject won't re-notify. PUSH so it lands in the
    // patient's Notifications tab (mirrors the medication-HOLD notice).
    try {
      const label =
        PROFILE_FIELD_LABELS[dto.field as VerifiableField] ?? 'a profile detail'
      await this.prisma.notification.create({
        data: {
          userId: patientUserId,
          channel: NotificationChannel.PUSH,
          title: 'Please re-check a profile detail',
          body: systemMsgProfileFieldRejected(label),
          dispatchTrigger: 'PROFILE_REJECTED',
        },
      })
    } catch (err) {
      this.logger.error(
        `Profile-field-reject notification failed for ${patientUserId}`,
        err instanceof Error ? err.stack : err,
      )
    }

    return {
      statusCode: 200,
      message: 'Field rejected; profile returned to unverified',
      data: this.serializeProfile(updated),
    }
  }

  // ─── Admin: POST /admin/users/:id/correct-profile ────────────────────────

  async correctProfile(
    actor: ActorUser,
    patientUserId: string,
    dto: CorrectProfileDto,
    ctx?: { practiceId: string | null },
  ) {
    await this.access.assertCanAccessPatient(actor, patientUserId)
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.patientProfile.findUnique({
        where: { userId: patientUserId },
      })
      if (!existing) {
        throw new NotFoundException('Patient profile not found')
      }

      const patch = this.stripUndefined(dto.corrections)
      // dateOfBirth lives on User, not PatientProfile. Pull it out so the
      // patientProfile.update below doesn't try to write a column that
      // doesn't exist on the table (Prisma rejects → 500). Mirrors the same
      // split already used in upsertProfile (patient self-report path).
      const dobPatch = patch.dateOfBirth
      delete (patch as Partial<IntakeProfileDto>).dateOfBirth

      this.validatePregnancyShape(patch, existing)

      const changes = this.diffProfile(existing, patch)

      // Track DOB changes separately so a DOB-only correction isn't falsely
      // rejected as "no corrections supplied". User row is queried only when
      // a DOB patch was actually provided.
      const existingUser =
        dobPatch !== undefined
          ? await tx.user.findUnique({
              where: { id: patientUserId },
              select: { dateOfBirth: true },
            })
          : null
      const dobChanged =
        dobPatch !== undefined &&
        this.normalizeDateForDiff(dobPatch) !==
          this.normalizeDateForDiff(existingUser?.dateOfBirth ?? null)

      if (!changes.length && !dobChanged) {
        throw new BadRequestException(
          'No corrections supplied. Use verify-profile to confirm without changes.',
        )
      }

      if (dobPatch !== undefined) {
        await tx.user.update({
          where: { id: patientUserId },
          data: { dateOfBirth: dobPatch === null ? null : new Date(dobPatch) },
        })
      }

      const updated = await tx.patientProfile.update({
        where: { userId: patientUserId },
        data: {
          ...patch,
          pregnancyDueDate: this.coerceDate(patch.pregnancyDueDate),
          profileVerificationStatus: ProfileVerificationStatus.CORRECTED,
          profileVerifiedAt: new Date(),
          profileVerifiedBy: actor.id,
        },
      })

      await this.writeProfileLogs(tx, {
        userId: patientUserId,
        changes,
        changedBy: actor.id,
        changedByRole: VerifierRole.ADMIN,
        changeType: VerificationChangeType.ADMIN_CORRECT,
        discrepancyFlag: true,
        rationale: dto.rationale,
        practiceContext: ctx?.practiceId ?? null,
      })

      // Joint Commission NPSG.03.06.01 audit trail — DOB corrections need
      // their own log row because dateOfBirth isn't in
      // VERIFIABLE_PROFILE_FIELDS (lives on User, not PatientProfile).
      if (dobChanged) {
        await tx.profileVerificationLog.create({
          data: {
            userId: patientUserId,
            fieldPath: 'user.dateOfBirth',
            previousValue: existingUser?.dateOfBirth
              ? (existingUser.dateOfBirth.toISOString() as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            newValue:
              dobPatch === null
                ? Prisma.JsonNull
                : (new Date(dobPatch).toISOString() as Prisma.InputJsonValue),
            changedBy: actor.id,
            changedByRole: VerifierRole.ADMIN,
            changeType: VerificationChangeType.ADMIN_CORRECT,
            discrepancyFlag: true,
            rationale: dto.rationale,
            practiceContext: ctx?.practiceId ?? null,
          },
        })
      }

      // IVR-04 — if this correction added a threshold-mandatory condition to an
      // already-enrolled patient with no threshold on file, revert enrollment.
      const enrollmentReverted = await this.revertEnrollmentIfThresholdGap(
        tx,
        patientUserId,
        actor.id,
        VerifierRole.ADMIN,
      )

      const correctedFields: string[] = [
        ...changes.map((c) => c.field as string),
        ...(dobChanged ? ['dateOfBirth'] : []),
      ]
      return {
        statusCode: 200,
        message: 'Profile corrected',
        data: this.serializeProfile(updated),
        correctedFields,
        enrollmentReverted,
      }
    }, TX_OPTIONS)
  }

  // ─── Admin: POST /admin/medications/:id/verify ───────────────────────────

  async verifyMedication(
    actor: ActorUser,
    medicationId: string,
    dto: VerifyMedicationDto,
    ctx?: { practiceId: string | null },
  ) {
    const med = await this.prisma.patientMedication.findUnique({
      where: { id: medicationId },
    })
    if (!med) {
      throw new NotFoundException('Medication not found')
    }
    // Access check after the med lookup so we can pivot off med.userId.
    // Throws 403 if PROVIDER isn't in panel / MED_DIR doesn't head practice.
    await this.access.assertCanAccessPatient(actor, med.userId)

    const nextStatus = dto.status as MedicationVerificationStatus
    const changeType =
      nextStatus === MedicationVerificationStatus.REJECTED
        ? VerificationChangeType.ADMIN_REJECT
        : VerificationChangeType.ADMIN_VERIFY

    if (changeType === VerificationChangeType.ADMIN_REJECT && !dto.rationale) {
      throw new BadRequestException('Rationale is required to reject a medication')
    }
    // Cluster 7 A.7 + Manisha 5/24 Med §3 — Hold requires a structured reason
    // code (drives the two-path patient message); OTHER additionally requires a
    // free-text rationale. The reason is also captured in the audit log.
    if (nextStatus === MedicationVerificationStatus.HOLD) {
      if (!dto.holdReason) {
        throw new BadRequestException('A hold reason is required to place a medication on hold')
      }
      if (dto.holdReason === 'OTHER' && !dto.rationale) {
        throw new BadRequestException('A rationale is required when the hold reason is "Other"')
      }
    }

    const isHold = nextStatus === MedicationVerificationStatus.HOLD
    const [updated] = await this.prisma.$transaction([
      this.prisma.patientMedication.update({
        where: { id: medicationId },
        data: {
          verificationStatus: nextStatus,
          verifiedByAdminId: actor.id,
          verifiedAt: new Date(),
          // Stamp/clear the structured hold metadata. holdSetAt anchors the
          // 7/14/30/45-day reconciliation escalation ladder; leaving a hold
          // clears both so a re-held med restarts the clock. holdEscalationLevel
          // always resets to 0 (entering OR leaving a hold restarts the ladder).
          holdReason: isHold ? (dto.holdReason as MedicationHoldReason) : null,
          holdSetAt: isHold ? new Date() : null,
          holdEscalationLevel: 0,
        },
      }),
      this.prisma.profileVerificationLog.create({
        data: {
          userId: med.userId,
          fieldPath: `medication:${medicationId}.verificationStatus`,
          previousValue: med.verificationStatus,
          newValue: nextStatus,
          changedBy: actor.id,
          changedByRole: VerifierRole.ADMIN,
          changeType,
          rationale: dto.rationale,
          discrepancyFlag: changeType === VerificationChangeType.ADMIN_REJECT,
          // Phase/practice-identity (Manisha 2026-06-12 §1, HIPAA 45 CFR
          // §164.312(a)(2)(i)) — capture WHICH practice the admin/provider
          // was acting under at verification time.
          practiceContext: ctx?.practiceId ?? null,
        },
      }),
    ])

    // Cluster 7 A.7 — dispatch a system message to the patient inbox so they
    // know NOT to take the held medication until the admin clears it. Failure
    // to dispatch is logged but does not roll back the status change — the
    // medication is on hold regardless of whether the notification landed.
    if (nextStatus === MedicationVerificationStatus.HOLD) {
      // Provider-directed = "pause it" (names the med); administrative =
      // "keep taking as usual" (does NOT name the med) — Manisha 5/24 §3.
      const providerDirected = isProviderDirectedHold(dto.holdReason!)
      const title = providerDirected ? 'Please pause a medication' : 'Medicine list review'
      const body = systemMsgMedicationHold(med.drugName, dto.holdReason!)
      try {
        // F16 — administrative holds consolidate to ONE bell row per Manisha A1
        // "Display once": a patient with 4 administrative holds should see a
        // single "Medicine list review" notice, not 4 identical rows. The
        // administrative body is generic (doesn't name a med), so an unread
        // notice already standing for one hold covers the rest — bump its
        // timestamp instead of stacking a duplicate. Provider-directed holds
        // name a specific medication, so each keeps its own row.
        const existing = providerDirected
          ? null
          : await this.prisma.notification.findFirst({
              where: {
                userId: med.userId,
                channel: NotificationChannel.PUSH,
                title: 'Medicine list review',
                readAt: null,
              },
              select: { id: true },
            })
        if (existing) {
          await this.prisma.notification.update({
            where: { id: existing.id },
            data: { sentAt: new Date(), body },
          })
        } else {
          await this.prisma.notification.create({
            data: {
              userId: med.userId,
              // PUSH (not DASHBOARD) so it lands in the patient's Notifications
              // tab — that tab renders only PUSH/null channels; DASHBOARD rows
              // are treated as alert-linked and surface on the Alerts tab. This
              // is a standalone care-team message (CLINICAL_SPEC §14.2), so it
              // belongs with gap-alert / monthly-reask / care-team-update (all PUSH).
              channel: NotificationChannel.PUSH,
              title,
              body,
              dispatchTrigger: 'CARE_TEAM_UPDATE',
            },
          })
        }
      } catch (err) {
        this.logger.error(
          `HOLD notification failed for medication ${medicationId}`,
          err instanceof Error ? err.stack : err,
        )
      }
    }

    return {
      statusCode: 200,
      message: `Medication ${nextStatus.toLowerCase()}`,
      data: this.serializeMedication(updated),
    }
  }

  // ─── Reads (admin dashboards will need these; also used by tests) ────────

  async getProfile(userId: string) {
    const [profile, user] = await Promise.all([
      this.prisma.patientProfile.findUnique({ where: { userId } }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { dateOfBirth: true },
      }),
    ])
    const dob = user?.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : null
    // Fields whose latest log is ADMIN_REJECT — surfaced so the patient profile
    // can flag exactly what the care team asked them to re-check (pairs with the
    // "please re-check" inbox notice). Empty when there's no profile.
    let rejectedFields: string[] = []
    if (profile) {
      const latest = await this.latestLogTypeForFields(
        userId,
        VERIFIABLE_PROFILE_FIELDS,
      )
      rejectedFields = [...latest.entries()]
        .filter(([, type]) => type === VerificationChangeType.ADMIN_REJECT)
        .map(([path]) => path.replace(/^profile\./, ''))
    }
    return {
      statusCode: 200,
      message: profile ? 'Profile retrieved' : 'No profile yet',
      // dateOfBirth lives on User but is surfaced here so the admin
      // profile tab can show age alongside other demographics without a
      // second fetch. Read-only — patients edit it via /v2/auth/profile
      // or via clinical-intake A1.
      data: profile
        ? { ...this.serializeProfile(profile), dateOfBirth: dob, rejectedFields }
        : null,
    }
  }

  // ─── #92 — admin add / edit medication ─────────────────────────────────
  //
  // Clinical roles (SUPER_ADMIN / PROVIDER / MEDICAL_DIRECTOR) can record a
  // medication on a patient's behalf. Admin is authoritative, so the row is
  // VERIFIED on add — EXCEPT the ACE/ARB-on-angioedema safety gate (mirror of
  // #84), which forces PROVIDER_DIRECTED_HOLD instead. Dedup reuses #85's
  // canonical resolution: a brand/generic duplicate of an existing active med
  // is rejected with 409 + the existing record so the caller edits it instead.

  /** Map the actor's admin role to the audit VerifierRole. */
  private adminVerifierRole(roles: UserRole[]): VerifierRole {
    return roles.includes(UserRole.PROVIDER)
      ? VerifierRole.PROVIDER
      : VerifierRole.ADMIN
  }

  /** Fold an optional free-text dose into notes (no dedicated dose column). */
  private composeNotes(dose?: string, notes?: string): string | null {
    const parts = [dose?.trim() ? `Dose: ${dose.trim()}` : '', notes?.trim() ?? '']
      .filter(Boolean)
    return parts.length ? parts.join(' — ') : null
  }

  private canonicalDuplicate409(
    drugName: string,
    canonicalDrugId: string,
    existing: { id: string; drugName: string; verificationStatus: MedicationVerificationStatus; holdReason: MedicationHoldReason | null },
  ): never {
    throw new ConflictException({
      statusCode: 409,
      error: 'DUPLICATE_CANONICAL_DRUG',
      message: `This medication is already on the patient’s record (${existing.drugName}).`,
      existing: {
        id: existing.id,
        drugName: existing.drugName,
        canonicalDrugId,
        verificationStatus: existing.verificationStatus,
        holdReason: existing.holdReason,
      },
    })
  }

  async adminAddMedication(
    actor: ActorUser,
    patientUserId: string,
    dto: AdminAddMedicationDto,
    ctx?: { practiceId: string | null },
  ) {
    await this.access.assertCanAccessPatient(actor, patientUserId)

    const canonicalDrugId = resolveCanonicalDrugId(dto.drugName)
    // #85 dedup — only when the name resolves to the catalog. Off-catalog
    // (null canonical) meds are never blocked.
    if (canonicalDrugId) {
      const dup = await this.prisma.patientMedication.findFirst({
        where: { userId: patientUserId, canonicalDrugId, discontinuedAt: null },
      })
      if (dup) this.canonicalDuplicate409(dto.drugName, canonicalDrugId, dup)
    }

    // Defensive fallback dedup: an existing active row with the SAME drugName
    // (case-insensitive) that the canonical check above missed — e.g. a legacy
    // row whose canonicalDrugId was never populated (pre-fix seed / import gap),
    // or an off-catalog drug. Only 409s when the canonical pass didn't already
    // cover this exact row, so it never double-throws.
    const nameDup = await this.prisma.patientMedication.findFirst({
      where: {
        userId: patientUserId,
        drugName: { equals: dto.drugName, mode: 'insensitive' },
        discontinuedAt: null,
      },
    })
    if (nameDup && (!canonicalDrugId || nameDup.canonicalDrugId !== canonicalDrugId)) {
      this.canonicalDuplicate409(dto.drugName, canonicalDrugId ?? 'off-catalog', nameDup)
    }

    // Catalog wins on class: if the name resolves to the catalog, prefer the
    // catalog's drugClass over whatever the provider picked — prevents a known
    // drug being mis-filed (e.g. Metoprolol saved as OTHER_UNVERIFIED). Off-
    // catalog names keep the provider's class.
    const effectiveDrugClass = resolveCanonicalDrugClass(dto.drugName) ?? dto.drugClass

    // ACE/ARB-on-angioedema safety gate (mirror of #84). Auto-hold instead of
    // auto-verify so an admin can't silently re-introduce a contraindicated drug.
    const profile = await this.prisma.patientProfile.findUnique({
      where: { userId: patientUserId },
      select: { aceContraindicatedAt: true },
    })
    const isAceArb =
      effectiveDrugClass === DrugClass.ACE_INHIBITOR ||
      effectiveDrugClass === DrugClass.ARB
    const angioedemaHold = profile?.aceContraindicatedAt != null && isAceArb

    const now = new Date()
    const role = this.adminVerifierRole(actor.roles)

    const created = await this.prisma.$transaction(async (tx) => {
      const med = await tx.patientMedication.create({
        data: {
          userId: patientUserId,
          drugName: dto.drugName,
          drugClass: effectiveDrugClass,
          canonicalDrugId,
          frequency: dto.frequency,
          notes: this.composeNotes(dto.dose, dto.notes),
          source: 'PROVIDER_ENTERED',
          addedByUserId: actor.id,
          addedByRole: role,
          addedAt: now,
          verificationStatus: angioedemaHold
            ? MedicationVerificationStatus.HOLD
            : MedicationVerificationStatus.VERIFIED,
          verifiedByAdminId: angioedemaHold ? null : actor.id,
          verifiedAt: angioedemaHold ? null : now,
          holdReason: angioedemaHold ? MedicationHoldReason.PROVIDER_DIRECTED_HOLD : null,
          holdSetAt: angioedemaHold ? now : null,
        },
      })
      await tx.profileVerificationLog.create({
        data: {
          userId: patientUserId,
          fieldPath: `medication:${med.id}`,
          previousValue: Prisma.JsonNull,
          newValue: {
            drugName: dto.drugName,
            drugClass: effectiveDrugClass,
            verificationStatus: med.verificationStatus,
            holdReason: med.holdReason,
          } as Prisma.InputJsonValue,
          changedBy: actor.id,
          changedByRole: role,
          changeType: VerificationChangeType.ADMIN_CORRECT,
          discrepancyFlag: angioedemaHold,
          rationale: angioedemaHold
            ? 'Admin-added ACE/ARB on angioedema-contraindicated patient — auto-held (PROVIDER_DIRECTED_HOLD).'
            : 'Admin-added medication.',
          practiceContext: ctx?.practiceId ?? null,
        },
      })
      return med
    })

    return {
      statusCode: 201,
      message: 'Medication added',
      // Tells the admin UI to show the confirmation modal explaining the hold.
      requiresAcknowledgement: angioedemaHold,
      data: this.serializeMedication(created),
    }
  }

  async adminEditMedication(
    actor: ActorUser,
    medicationId: string,
    dto: AdminEditMedicationDto,
    ctx?: { practiceId: string | null },
  ) {
    const med = await this.prisma.patientMedication.findUnique({
      where: { id: medicationId },
    })
    if (!med) throw new NotFoundException('Medication not found')
    await this.access.assertCanAccessPatient(actor, med.userId)

    const now = new Date()
    const role = this.adminVerifierRole(actor.roles)
    const nameChanged = dto.drugName != null && dto.drugName !== med.drugName
    let newDrugClass = dto.drugClass ?? med.drugClass
    let canonicalDrugId = med.canonicalDrugId
    if (nameChanged) {
      canonicalDrugId = resolveCanonicalDrugId(dto.drugName!)
      if (canonicalDrugId) {
        const dup = await this.prisma.patientMedication.findFirst({
          where: {
            userId: med.userId,
            canonicalDrugId,
            discontinuedAt: null,
            id: { not: medicationId },
          },
        })
        if (dup) this.canonicalDuplicate409(dto.drugName!, canonicalDrugId, dup)
      }
    }

    // Catalog wins on class (mirror of adminAddMedication): if the effective
    // drug name resolves to the catalog, the catalog's class overrides whatever
    // the provider picked — self-heals a mis-classified catalog drug on any
    // edit. Off-catalog names keep the provider/existing class.
    const canonicalClass = resolveCanonicalDrugClass(dto.drugName ?? med.drugName)
    if (canonicalClass) newDrugClass = canonicalClass

    // If the edit turns this into an ACE/ARB for an angioedema patient, hold it.
    const isAceArb =
      newDrugClass === DrugClass.ACE_INHIBITOR || newDrugClass === DrugClass.ARB
    const profile = isAceArb
      ? await this.prisma.patientProfile.findUnique({
          where: { userId: med.userId },
          select: { aceContraindicatedAt: true },
        })
      : null
    const angioedemaHold = profile?.aceContraindicatedAt != null && isAceArb

    const data: Prisma.PatientMedicationUpdateInput = {
      lastEditedByUserId: actor.id,
      lastEditedByRole: role,
      lastEditedAt: now,
    }
    if (dto.drugName != null) data.drugName = dto.drugName
    // Persist the effective class (catalog-corrected) whenever it changes —
    // covers both an explicit provider class change and a catalog auto-correct.
    if (newDrugClass !== med.drugClass) data.drugClass = newDrugClass
    if (dto.frequency != null) data.frequency = dto.frequency
    if (dto.dose != null || dto.notes != null) {
      data.notes = this.composeNotes(dto.dose, dto.notes ?? med.notes ?? undefined)
    }
    if (nameChanged) data.canonicalDrugId = canonicalDrugId
    if (angioedemaHold && med.verificationStatus !== MedicationVerificationStatus.HOLD) {
      data.verificationStatus = MedicationVerificationStatus.HOLD
      data.holdReason = MedicationHoldReason.PROVIDER_DIRECTED_HOLD
      data.holdSetAt = now
      data.holdEscalationLevel = 0
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.patientMedication.update({ where: { id: medicationId }, data })
      // N5 (2026-07-09) — capture the FULL clinical snapshot before + after.
      // Was 3 fields (drugName/drugClass/frequency); now mirrors serializeMedication
      // so an alteration on dose, notes, verificationStatus, holdReason,
      // holdEscalationLevel, discontinuedAt, etc. is reconstructable from the
      // audit trail (HIPAA §164.312(c) integrity, Humaira Activity 4 item 2).
      // The patient-facing update paths at :566 already use per-field snapshots;
      // this brings the admin edit path to the same coverage.
      await tx.profileVerificationLog.create({
        data: {
          userId: med.userId,
          fieldPath: `medication:${medicationId}`,
          previousValue: this.serializeMedication(med) as Prisma.InputJsonValue,
          newValue: this.serializeMedication(row) as Prisma.InputJsonValue,
          changedBy: actor.id,
          changedByRole: role,
          changeType: VerificationChangeType.ADMIN_CORRECT,
          discrepancyFlag: angioedemaHold,
          rationale: angioedemaHold
            ? 'Admin edit to ACE/ARB on angioedema-contraindicated patient — auto-held.'
            : 'Admin edit to medication.',
          practiceContext: ctx?.practiceId ?? null,
        },
      })
      return row
    })

    return {
      statusCode: 200,
      message: 'Medication updated',
      requiresAcknowledgement: angioedemaHold,
      data: this.serializeMedication(updated),
    }
  }

  async listMedications(
    userId: string,
    includeDiscontinued = false,
    includeRejected = false,
  ) {
    // Exclude REJECTED meds by default so a provider's "this isn't the patient's
    // med" call doesn't get re-asked on the patient's daily check-in or
    // re-prefilled into the intake/edit wizard. UNVERIFIED stays visible —
    // patient's word is still actionable pending provider review.
    //
    // Callers that need the full picture *with* status (the admin
    // reconciliation tab and the patient's read-only profile) pass
    // includeRejected=true so the REJECTED rows surface with their badge
    // (IVR-18). The daily-check-in and wizard-prefill paths keep the default.
    const meds = await this.prisma.patientMedication.findMany({
      where: {
        userId,
        ...(includeDiscontinued ? {} : { discontinuedAt: null }),
        ...(includeRejected ? {} : { verificationStatus: { not: 'REJECTED' } }),
      },
      orderBy: { reportedAt: 'desc' },
    })
    return {
      statusCode: 200,
      message: 'Medications retrieved',
      data: meds.map((m) => this.serializeMedication(m)),
    }
  }

  async listVerificationLogs(userId: string) {
    const logs = await this.prisma.profileVerificationLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    const names = await resolveUserDisplays(
      this.prisma,
      logs.map((l) => l.changedBy),
    )
    // Manual-test round 2 Group A4 — humanize caregiver references in the
    // timeline. Caregiver-scoped logs use fieldPath `caregiver:${id}` (see
    // caregiver.service.ts:writeAudit). Without resolution the timeline
    // renders raw UUIDs ("Caregiver:9a0446d9-…"). Batch-fetch every
    // referenced caregiver in one query (same N+1-avoiding pattern as
    // resolveUserDisplays) and stamp the name + relationship onto each log.
    const caregiverIds = Array.from(
      new Set(
        logs
          .map((l) => caregiverIdFromFieldPath(l.fieldPath))
          .filter((id): id is string => id != null),
      ),
    )
    const caregiversById = new Map<string, { name: string; relationship: string | null }>()
    if (caregiverIds.length > 0) {
      const caregivers = await this.prisma.patientCaregiver.findMany({
        where: { id: { in: caregiverIds } },
        select: { id: true, name: true, relationship: true },
      })
      for (const c of caregivers) {
        caregiversById.set(c.id, { name: c.name, relationship: c.relationship })
      }
    }
    return {
      statusCode: 200,
      message: 'Verification logs retrieved',
      data: logs.map((l) => {
        const caregiverId = caregiverIdFromFieldPath(l.fieldPath)
        const caregiver = caregiverId ? caregiversById.get(caregiverId) ?? null : null
        return {
          ...l,
          changedByName: pickDisplayName(l.changedBy, names),
          // The actor's real role (e.g. PROVIDER) resolved from their account —
          // the stored changedByRole is the coarse ADMIN for every admin action.
          // Falls back to the stored role when the user can't be resolved.
          changedByRoleResolved: pickDisplayRole(l.changedBy, names, l.changedByRole),
          // Round 2 A4 — null when the log isn't caregiver-scoped, or when the
          // caregiver row has been deleted. UI falls back to "Caregiver contact".
          caregiverName: caregiver?.name ?? null,
          caregiverRelationship: caregiver?.relationship ?? null,
        }
      }),
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async flipProfileToUnverified(tx: PrismaTx, userId: string) {
    const profile = await tx.patientProfile.findUnique({ where: { userId } })
    if (!profile) return
    if (profile.profileVerificationStatus === ProfileVerificationStatus.UNVERIFIED) {
      await tx.patientProfile.update({
        where: { userId },
        data: { profileLastEditedAt: new Date() },
      })
      return
    }
    await tx.patientProfile.update({
      where: { userId },
      data: {
        profileVerificationStatus: ProfileVerificationStatus.UNVERIFIED,
        profileLastEditedAt: new Date(),
        profileVerifiedAt: null,
        profileVerifiedBy: null,
      },
    })
  }

  /**
   * IVR-04 — clinical-safety enrollment re-gate. After a profile write that may
   * have added a threshold-mandatory condition (HFrEF / HCM / DCM), re-run the
   * enrollment gate. If the patient is ENROLLED and the gate now fails *because*
   * a mandatory condition lacks a configured threshold, revert enrollment to
   * NOT_ENROLLED — otherwise the alert engine keeps running on standard
   * thresholds for a patient who now needs a personalized one — and write a
   * JCAHO audit row.
   *
   * Only the `threshold-required-for-condition` reason triggers a revert; other
   * gate failures (missing assignment / business hours) are unrelated to a
   * condition change. No-op when the patient is already NOT_ENROLLED or a
   * threshold is on file. Runs in both the admin (correctProfile) and patient
   * (upsertProfile) edit paths so the unsafe state can't be reached from either.
   */
  private async revertEnrollmentIfThresholdGap(
    tx: PrismaTx,
    userId: string,
    actorId: string,
    actorRole: VerifierRole,
  ): Promise<boolean> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { enrollmentStatus: true },
    })
    if (user?.enrollmentStatus !== EnrollmentStatus.ENROLLED) return false

    const gate = await canCompleteEnrollment(tx, userId)
    if (gate.ok || !gate.reasons.includes('threshold-required-for-condition')) {
      return false
    }

    const changeType =
      actorRole === VerifierRole.PATIENT
        ? VerificationChangeType.PATIENT_REPORT
        : VerificationChangeType.ADMIN_CORRECT

    await tx.user.update({
      where: { id: userId },
      data: { enrollmentStatus: EnrollmentStatus.NOT_ENROLLED },
    })
    await tx.profileVerificationLog.create({
      data: {
        userId,
        fieldPath: 'user.enrollmentStatus',
        previousValue: EnrollmentStatus.ENROLLED,
        newValue: EnrollmentStatus.NOT_ENROLLED,
        changedBy: actorId,
        changedByRole: actorRole,
        changeType,
        discrepancyFlag: true,
        rationale:
          'Enrollment auto-reverted — a threshold-mandatory condition (HFrEF / HCM / DCM) was added without a configured threshold.',
      },
    })
    return true
  }

  /**
   * IVR-04 (patient path) — when a patient's OWN profile edit auto-reverts
   * their enrollment, nobody is on the admin screen to see it. Notify the care
   * team (primary provider + medical director) so they reconfigure the
   * threshold and re-enroll promptly. Best-effort + post-commit: a failure here
   * must never undo the safety revert, hence the try/catch and the call site
   * outside the transaction. The admin path doesn't call this — that actor is
   * already looking at the EnrollmentCard.
   */
  // Shared care-team notice dispatch. Routes to the patient's primary provider
  // + medical director (deduped) and stamps `patientUserId` so the admin bell /
  // notifications page can deep-link to /patients/{patientUserId}. Throws on DB
  // error — the public wrappers below are best-effort.
  private async dispatchCareTeamNotice(
    patientUserId: string,
    title: string,
    body: string,
  ): Promise<void> {
    const assignment = await this.prisma.patientProviderAssignment.findUnique({
      where: { userId: patientUserId },
      select: { primaryProviderId: true, medicalDirectorId: true },
    })
    // No care team on file → no one to route to.
    if (!assignment) return
    const recipients = [
      ...new Set(
        [assignment.primaryProviderId, assignment.medicalDirectorId].filter(
          (id): id is string => !!id,
        ),
      ),
    ]
    if (!recipients.length) return
    await this.prisma.notification.createMany({
      data: recipients.map((userId) => ({
        userId,
        patientUserId,
        channel: NotificationChannel.PUSH,
        title,
        body,
        dispatchTrigger: 'CARE_TEAM_UPDATE',
      })),
    })
  }

  private async notifyCareTeamEnrollmentPaused(patientUserId: string): Promise<void> {
    try {
      const [patient, profile] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: patientUserId },
          select: { name: true },
        }),
        this.prisma.patientProfile.findUnique({
          where: { userId: patientUserId },
          select: {
            heartFailureType: true,
            hasHCM: true,
            hasDCM: true,
            hasAorticStenosis: true,
          },
        }),
      ])
      const conditions = [
        profile?.heartFailureType === 'HFREF' ? 'HFrEF' : null,
        profile?.hasHCM ? 'HCM' : null,
        profile?.hasDCM ? 'DCM' : null,
        profile?.hasAorticStenosis ? 'aortic stenosis' : null,
      ]
        .filter(Boolean)
        .join(' / ')
      const patientName = patient?.name ?? 'A patient'
      const body =
        `${patientName} reported ${conditions || 'a condition'} that requires a personalized BP threshold. ` +
        `Their enrollment has been paused — set a threshold and re-enroll to resume monitoring.`
      await this.dispatchCareTeamNotice(
        patientUserId,
        'Enrollment paused — threshold needed',
        body,
      )
    } catch (err) {
      this.logger.error(
        `Care-team enrollment-paused notification failed for ${patientUserId}`,
        err instanceof Error ? err.stack : err,
      )
    }
  }

  /**
   * Patient changed a threshold-mandatory condition (HFrEF / HCM / DCM) on an
   * already-ENROLLED profile WITHOUT it tripping the enrollment revert — i.e.
   * they removed one, or added one while a threshold already exists. The
   * existing threshold may no longer fit and the self-report needs re-verifying,
   * so nudge the care team. Best-effort + post-commit.
   */
  private async notifyCareTeamConditionReview(
    patientUserId: string,
    changedLabels: string[],
  ): Promise<void> {
    try {
      const patient = await this.prisma.user.findUnique({
        where: { id: patientUserId },
        select: { name: true },
      })
      const patientName = patient?.name ?? 'A patient'
      const list = changedLabels.length
        ? changedLabels.join(', ')
        : 'a monitored condition'
      const body =
        `${patientName} changed ${list} on their profile — it is now unverified. ` +
        `Review the change and confirm their thresholds are still appropriate.`
      await this.dispatchCareTeamNotice(
        patientUserId,
        'Condition change — review needed',
        body,
      )
    } catch (err) {
      this.logger.error(
        `Care-team condition-review notification failed for ${patientUserId}`,
        err instanceof Error ? err.stack : err,
      )
    }
  }

  private diffProfile(
    existing: PatientProfile | null,
    patch: Partial<IntakeProfileDto>,
  ): Array<{
    field: VerifiableField
    previous: Prisma.InputJsonValue | typeof Prisma.JsonNull
    next: Prisma.InputJsonValue | typeof Prisma.JsonNull
  }> {
    const changes: Array<{
      field: VerifiableField
      previous: Prisma.InputJsonValue | typeof Prisma.JsonNull
      next: Prisma.InputJsonValue | typeof Prisma.JsonNull
    }> = []

    for (const field of VERIFIABLE_PROFILE_FIELDS) {
      if (!(field in patch)) continue
      const nextRaw = (patch as Record<string, unknown>)[field]
      const next =
        field === 'pregnancyDueDate'
          ? this.normalizeDateForDiff(nextRaw)
          : (nextRaw ?? null)
      const prevRaw = existing ? (existing as Record<string, unknown>)[field] : null
      const previous =
        field === 'pregnancyDueDate'
          ? this.normalizeDateForDiff(prevRaw)
          : (prevRaw ?? null)

      if (this.sameValue(previous, next)) continue

      changes.push({
        field,
        previous: this.toJsonValue(previous),
        next: this.toJsonValue(next),
      })
    }
    return changes
  }

  // Canonical key for medication identity. Two rows match if they share
  // drugName (case-insensitive), drugClass, isCombination, frequency and
  // the sorted set of combinationComponents. Matching rows survive a replace
  // unchanged so provider-verified timestamps aren't reset needlessly.
  private medicationKey(m: {
    drugName: string
    drugClass: string
    isCombination: boolean
    frequency: string
    combinationComponents: string[]
  }): string {
    const sortedComponents = [...(m.combinationComponents ?? [])].sort().join(',')
    return [
      m.drugName.trim().toLowerCase(),
      m.drugClass,
      String(m.isCombination),
      m.frequency,
      sortedComponents,
    ].join('|')
  }

  private diffMedications(
    current: PatientMedication[],
    incoming: IntakeMedicationItemDto[],
  ): {
    toClose: PatientMedication[]
    toCreate: IntakeMedicationItemDto[]
  } {
    const currentByKey = new Map(current.map((m) => [this.medicationKey(m), m]))
    const incomingByKey = new Map(
      incoming.map((m) => [
        this.medicationKey({
          drugName: m.drugName,
          drugClass: m.drugClass,
          isCombination: m.isCombination ?? false,
          frequency: m.frequency,
          combinationComponents: m.combinationComponents ?? [],
        }),
        m,
      ]),
    )

    const toClose: PatientMedication[] = []
    for (const [key, row] of currentByKey) {
      if (!incomingByKey.has(key)) toClose.push(row)
    }
    const toCreate: IntakeMedicationItemDto[] = []
    for (const [key, item] of incomingByKey) {
      if (!currentByKey.has(key)) toCreate.push(item)
    }
    return { toClose, toCreate }
  }

  private async writeProfileLogs(
    tx: PrismaTx,
    params: {
      userId: string
      changes: Array<{
        field: VerifiableField
        previous: Prisma.InputJsonValue | typeof Prisma.JsonNull
        next: Prisma.InputJsonValue | typeof Prisma.JsonNull
      }>
      changedBy: string
      changedByRole: VerifierRole
      changeType: VerificationChangeType
      discrepancyFlag?: boolean
      rationale?: string
      /** Phase/practice-identity — populated only on admin-actor paths. */
      practiceContext?: string | null
    },
  ) {
    if (!params.changes.length) return
    await tx.profileVerificationLog.createMany({
      data: params.changes.map((change) => ({
        userId: params.userId,
        fieldPath: `profile.${change.field}`,
        previousValue: change.previous,
        newValue: change.next,
        changedBy: params.changedBy,
        changedByRole: params.changedByRole,
        changeType: params.changeType,
        discrepancyFlag: params.discrepancyFlag ?? false,
        rationale: params.rationale,
        practiceContext: params.practiceContext ?? null,
      })),
    })
  }

  private validatePregnancyShape(
    patch: Partial<IntakeProfileDto>,
    existing: PatientProfile | null,
  ) {
    const effectiveIsPregnant =
      patch.isPregnant ?? existing?.isPregnant ?? false
    if (!effectiveIsPregnant && patch.pregnancyDueDate) {
      throw new BadRequestException(
        'pregnancyDueDate cannot be set when isPregnant is false',
      )
    }
  }

  private coerceDate(value: string | null | undefined): Date | null | undefined {
    if (value === undefined) return undefined
    if (value === null) return null
    return new Date(value)
  }

  private normalizeDateForDiff(value: unknown): string | null {
    if (value === null || value === undefined) return null
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'string') {
      const d = new Date(value)
      return Number.isNaN(d.getTime()) ? value : d.toISOString()
    }
    return String(value)
  }

  private sameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (a == null && b == null) return true
    return JSON.stringify(a) === JSON.stringify(b)
  }

  private stripUndefined<T extends object>(obj: T): Partial<T> {
    const out: Partial<T> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) (out as Record<string, unknown>)[k] = v
    }
    return out
  }

  private toJsonValue(
    value: unknown,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === null || value === undefined) return Prisma.JsonNull
    if (value instanceof Date) return value.toISOString()
    return value as Prisma.InputJsonValue
  }

  private serializeProfile(profile: PatientProfile) {
    return {
      ...profile,
      pregnancyDueDate: profile.pregnancyDueDate?.toISOString() ?? null,
      profileVerifiedAt: profile.profileVerifiedAt?.toISOString() ?? null,
      profileLastEditedAt: profile.profileLastEditedAt.toISOString(),
      // Manisha 5/24 Q4 — permanent ACE-inhibitor contraindication (angioedema).
      aceContraindicatedAt: profile.aceContraindicatedAt?.toISOString() ?? null,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    }
  }

  private serializeMedication(med: PatientMedication) {
    return {
      ...med,
      reportedAt: med.reportedAt.toISOString(),
      verifiedAt: med.verifiedAt?.toISOString() ?? null,
      discontinuedAt: med.discontinuedAt?.toISOString() ?? null,
    }
  }
}

