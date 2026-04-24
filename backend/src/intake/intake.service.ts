import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  MedicationVerificationStatus,
  Prisma,
  ProfileVerificationStatus,
  VerificationChangeType,
  VerifierRole,
} from '../generated/prisma/client.js'
import type {
  PatientMedication,
  PatientProfile,
} from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import type {
  CorrectProfileDto,
  VerifyProfileDto,
} from './dto/correct-profile.dto.js'
import type { IntakeMedicationsDto } from './dto/intake-medications.dto.js'
import type { IntakeProfileDto } from './dto/intake-profile.dto.js'
import type { PregnancyDto } from './dto/pregnancy.dto.js'
import type { UpdateMedicationDto } from './dto/update-medication.dto.js'
import type { VerifyMedicationDto } from './dto/verify-medication.dto.js'

type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

// Prisma Postgres (managed, network-latency) needs more than the default 5 s
// interactive-transaction budget once we fan out 10+ log rows. Generous
// timeout + reasonable maxWait keeps local-dev behaviour unchanged.
const TX_OPTIONS = { timeout: 20_000, maxWait: 5_000 } as const

// Clinical fields on PatientProfile that participate in verification logs.
// Any change to one of these fields produces a ProfileVerificationLog row.
const VERIFIABLE_PROFILE_FIELDS = [
  'gender',
  'heightCm',
  'isPregnant',
  'pregnancyDueDate',
  'historyPreeclampsia',
  'hasHeartFailure',
  'heartFailureType',
  'hasAFib',
  'hasCAD',
  'hasHCM',
  'hasDCM',
  'hasTachycardia',
  'hasBradycardia',
  'diagnosedHypertension',
] as const satisfies readonly (keyof PatientProfile)[]

type VerifiableField = (typeof VERIFIABLE_PROFILE_FIELDS)[number]

@Injectable()
export class IntakeService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Patient: POST /intake/profile ───────────────────────────────────────

  async upsertProfile(userId: string, dto: IntakeProfileDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.patientProfile.findUnique({ where: { userId } })

      const patch = this.stripUndefined(dto)
      this.validatePregnancyShape(patch, existing)

      // Diff every verifiable field the DTO touches.
      const changes = this.diffProfile(existing, patch)

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

      if (changes.length) {
        await this.writeProfileLogs(tx, {
          userId,
          changes,
          changedBy: userId,
          changedByRole: VerifierRole.PATIENT,
          changeType: VerificationChangeType.PATIENT_REPORT,
        })
      }

      return {
        statusCode: 200,
        message: existing ? 'Profile updated' : 'Profile created',
        data: this.serializeProfile(profile),
        changedFields: changes.map((c) => c.field),
      }
    }, TX_OPTIONS)
  }

  // ─── Patient: POST /me/pregnancy ─────────────────────────────────────────

  async updatePregnancy(userId: string, dto: PregnancyDto) {
    const patch: Partial<IntakeProfileDto> = {
      isPregnant: dto.isPregnant,
      pregnancyDueDate: dto.pregnancyDueDate ?? null,
    }
    if (dto.historyPreeclampsia !== undefined) {
      patch.historyPreeclampsia = dto.historyPreeclampsia
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
      const created = await Promise.all(
        dto.medications.map((item) =>
          tx.patientMedication.create({
            data: {
              userId,
              drugName: item.drugName,
              drugClass: item.drugClass,
              frequency: item.frequency,
              isCombination: item.isCombination ?? false,
              combinationComponents: item.combinationComponents ?? [],
              source: item.source ?? 'PATIENT_SELF_REPORT',
              rawInputText: item.rawInputText,
              notes: item.notes,
              // Patient self-report starts unverified; voice/photo cannot
              // fire automated alerts until a provider verifies (see
              // BUILD_PLAN §3.4 safety-net table).
              verificationStatus:
                item.source === 'PATIENT_VOICE' || item.source === 'PATIENT_PHOTO'
                  ? MedicationVerificationStatus.AWAITING_PROVIDER
                  : MedicationVerificationStatus.UNVERIFIED,
            },
          }),
        ),
      )

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

      // Adding a new medication flips the patient profile back to UNVERIFIED.
      await this.flipProfileToUnverified(tx, userId)

      return {
        statusCode: 201,
        message: `${created.length} medication(s) recorded`,
        data: created.map((m) => this.serializeMedication(m)),
      }
    }, TX_OPTIONS)
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

  // ─── Admin: POST /admin/users/:id/verify-profile ─────────────────────────

  async verifyProfile(
    adminId: string,
    patientUserId: string,
    dto: VerifyProfileDto,
  ) {
    const profile = await this.prisma.patientProfile.findUnique({
      where: { userId: patientUserId },
    })
    if (!profile) {
      throw new NotFoundException('Patient profile not found')
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.patientProfile.update({
        where: { userId: patientUserId },
        data: {
          profileVerificationStatus: ProfileVerificationStatus.VERIFIED,
          profileVerifiedAt: new Date(),
          profileVerifiedBy: adminId,
        },
      }),
      this.prisma.profileVerificationLog.create({
        data: {
          userId: patientUserId,
          fieldPath: 'profile.verificationStatus',
          previousValue: profile.profileVerificationStatus,
          newValue: ProfileVerificationStatus.VERIFIED,
          changedBy: adminId,
          changedByRole: VerifierRole.ADMIN,
          changeType: VerificationChangeType.ADMIN_VERIFY,
          rationale: dto.rationale,
        },
      }),
    ])

    return {
      statusCode: 200,
      message: 'Profile verified',
      data: this.serializeProfile(updated),
    }
  }

  // ─── Admin: POST /admin/users/:id/correct-profile ────────────────────────

  async correctProfile(
    adminId: string,
    patientUserId: string,
    dto: CorrectProfileDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.patientProfile.findUnique({
        where: { userId: patientUserId },
      })
      if (!existing) {
        throw new NotFoundException('Patient profile not found')
      }

      const patch = this.stripUndefined(dto.corrections)
      this.validatePregnancyShape(patch, existing)

      const changes = this.diffProfile(existing, patch)
      if (!changes.length) {
        throw new BadRequestException(
          'No corrections supplied. Use verify-profile to confirm without changes.',
        )
      }

      const updated = await tx.patientProfile.update({
        where: { userId: patientUserId },
        data: {
          ...patch,
          pregnancyDueDate: this.coerceDate(patch.pregnancyDueDate),
          profileVerificationStatus: ProfileVerificationStatus.CORRECTED,
          profileVerifiedAt: new Date(),
          profileVerifiedBy: adminId,
        },
      })

      await this.writeProfileLogs(tx, {
        userId: patientUserId,
        changes,
        changedBy: adminId,
        changedByRole: VerifierRole.ADMIN,
        changeType: VerificationChangeType.ADMIN_CORRECT,
        discrepancyFlag: true,
        rationale: dto.rationale,
      })

      return {
        statusCode: 200,
        message: 'Profile corrected',
        data: this.serializeProfile(updated),
        correctedFields: changes.map((c) => c.field),
      }
    }, TX_OPTIONS)
  }

  // ─── Admin: POST /admin/medications/:id/verify ───────────────────────────

  async verifyMedication(
    adminId: string,
    medicationId: string,
    dto: VerifyMedicationDto,
  ) {
    const med = await this.prisma.patientMedication.findUnique({
      where: { id: medicationId },
    })
    if (!med) {
      throw new NotFoundException('Medication not found')
    }

    const nextStatus = dto.status as MedicationVerificationStatus
    const changeType =
      nextStatus === MedicationVerificationStatus.REJECTED
        ? VerificationChangeType.ADMIN_REJECT
        : VerificationChangeType.ADMIN_VERIFY

    if (changeType === VerificationChangeType.ADMIN_REJECT && !dto.rationale) {
      throw new BadRequestException('Rationale is required to reject a medication')
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.patientMedication.update({
        where: { id: medicationId },
        data: {
          verificationStatus: nextStatus,
          verifiedByAdminId: adminId,
          verifiedAt: new Date(),
        },
      }),
      this.prisma.profileVerificationLog.create({
        data: {
          userId: med.userId,
          fieldPath: `medication:${medicationId}.verificationStatus`,
          previousValue: med.verificationStatus,
          newValue: nextStatus,
          changedBy: adminId,
          changedByRole: VerifierRole.ADMIN,
          changeType,
          rationale: dto.rationale,
          discrepancyFlag: changeType === VerificationChangeType.ADMIN_REJECT,
        },
      }),
    ])

    return {
      statusCode: 200,
      message: `Medication ${nextStatus.toLowerCase()}`,
      data: this.serializeMedication(updated),
    }
  }

  // ─── Reads (admin dashboards will need these; also used by tests) ────────

  async getProfile(userId: string) {
    const profile = await this.prisma.patientProfile.findUnique({
      where: { userId },
    })
    return {
      statusCode: 200,
      message: profile ? 'Profile retrieved' : 'No profile yet',
      data: profile ? this.serializeProfile(profile) : null,
    }
  }

  async listMedications(userId: string, includeDiscontinued = false) {
    // Exclude REJECTED meds so a provider's "this isn't the patient's med" call
    // doesn't get re-asked on the patient's daily check-in. UNVERIFIED stays
    // visible — patient's word is still actionable pending provider review.
    const meds = await this.prisma.patientMedication.findMany({
      where: {
        userId,
        ...(includeDiscontinued ? {} : { discontinuedAt: null }),
        verificationStatus: { not: 'REJECTED' },
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
    return {
      statusCode: 200,
      message: 'Verification logs retrieved',
      data: logs,
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

