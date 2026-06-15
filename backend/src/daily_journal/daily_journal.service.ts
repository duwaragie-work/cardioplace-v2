import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { randomUUID } from 'node:crypto'
import { SESSION_WINDOW_MS, SINGLE_READING_FINALIZE_MS } from '@cardioplace/shared'
import {
  Prisma,
  EntrySource,
  EscalationLevel,
  DelayBand,
  EmergencyConfirmationState,
} from '../generated/prisma/client.js'
import {
  UserRole,
  VerifierRole,
  VerificationChangeType,
} from '../generated/prisma/enums.js'
import type { ActorUser } from '../common/patient-access.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { JOURNAL_EVENTS } from './constants/events.js'
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto.js'
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto.js'

type JsonValue = Prisma.JsonValue

const SOURCE_MAP: Record<string, EntrySource> = {
  manual: EntrySource.MANUAL,
  healthkit: EntrySource.HEALTHKIT,
}

const POSITION_VALUES = ['SITTING', 'STANDING', 'LYING'] as const

// Manisha Backdated Readings sign-off 2026-06-06 (Chunk A) — bucketed lag
// between when the patient says they measured (measuredAt) and when the
// system received the row (now). Thresholds match the DelayBand enum
// comments in prisma/schema/daily_journal.prisma:
//   REAL_TIME         (<5 min)        normal current-session entry
//   NEAR_REAL_TIME    (5 min - <1 h)  acceptable lag (e.g. forgot to log)
//   DELAYED_ENTRY     (1 h - <24 h)   L2 911 CTA suppressed (provider flag)
//   HISTORICAL_ENTRY  (>=24 h)        L2 not fired; CMS 99454 16-day excluded
const DELAY_BAND_NEAR_MS = 5 * 60 * 1000
const DELAY_BAND_DELAYED_MS = 60 * 60 * 1000
const DELAY_BAND_HISTORICAL_MS = 24 * 60 * 60 * 1000

export function computeDelayBand(measuredAt: Date, now: Date): DelayBand {
  const lagMs = now.getTime() - measuredAt.getTime()
  if (lagMs < DELAY_BAND_NEAR_MS) return DelayBand.REAL_TIME
  if (lagMs < DELAY_BAND_DELAYED_MS) return DelayBand.NEAR_REAL_TIME
  if (lagMs < DELAY_BAND_HISTORICAL_MS) return DelayBand.DELAYED_ENTRY
  return DelayBand.HISTORICAL_ENTRY
}

// Structured symptom booleans snapshotted into journal audit rows — collapsed
// to the names that are true so the Timeline renders one readable list
// instead of 19 booleans. Order mirrors the schema groupings.
const AUDIT_SYMPTOM_FLAGS = [
  'severeHeadache',
  'visualChanges',
  'alteredMentalStatus',
  'chestPainOrDyspnea',
  'focalNeuroDeficit',
  'severeEpigastricPain',
  'newOnsetHeadache',
  'ruqPain',
  'edema',
  'dizziness',
  'syncope',
  'palpitations',
  'legSwelling',
  'fatigue',
  'shortnessOfBreath',
  'dryCough',
  'nsaidUse',
  'faceSwelling',
  'throatTightness',
] as const

/**
 * Channel-aware predicate for the in-app bell LIST + unread COUNT. Both
 * exclusions are READ-SIDE ONLY — the escalation write path
 * (`Notification.create`) and the Resend email send are untouched.
 *  • EMAIL rows — outbound deliveries, not in-app bell state. A patient with
 *    both a PUSH and an EMAIL row for one event was seeing it twice while the
 *    badge counted it once (H3 #80).
 *  • alert-linked PUSH rows — escalation T+0 dispatch writes a PUSH
 *    Notification row to the PATIENT for emergency-class alerts (BP_LEVEL_2,
 *    symptom-override, angioedema). The alert is already shown in the Alerts
 *    tab, so this must not ALSO render in the Notifications tab (H5 G.4). The
 *    row STAYS in the DB as the hook for a future real-push service — there is
 *    no out-of-app push delivery today. System-action PUSH rows (alertId null
 *    — med-hold, threshold, profile-reject, gap-alert) remain visible.
 * Memory: project_notification_tab_split_2026_06_04,
 *         project_no_push_service_pilot_gap_2026_06_04.
 */
const BELL_VISIBLE_NOTIFICATION_FILTER: Prisma.NotificationWhereInput = {
  AND: [
    { channel: { not: 'EMAIL' } },
    { NOT: { AND: [{ alertId: { not: null } }, { channel: 'PUSH' }] } },
  ],
}

@Injectable()
export class DailyJournalService {
  private readonly logger = new Logger(DailyJournalService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * `actor` is set when care-team staff create the reading on the patient's
   * behalf via the admin readings endpoints (Phase 3B) — it flips the audit
   * changeType to ADMIN_READING_ADDED, stamps addedByUserId + source=ADMIN,
   * and makes a stale client sessionId a hard 400 instead of a silent
   * re-group. Patient-app calls leave it undefined.
   */
  async create(userId: string, dto: CreateJournalEntryDto, actor?: ActorUser) {
    // Layer A journaling gate — patient must have a PatientProfile row
    // (completed clinical intake) before their readings get persisted. The
    // rule engine relies on PatientProfile for every safety-net bias; without
    // it, any alert generation is silently skipped, so taking a reading would
    // be clinically meaningless. 403 here drives the frontend to route the
    // patient into /clinical-intake.
    //
    // Admin users (who aren't patients) hit this same gate — they have no
    // PatientProfile by design, so they can't accidentally pollute the
    // journal. See TESTING_FLOW_GUIDE.md §6.1 for rationale.
    const profile = await this.prisma.patientProfile.findUnique({
      where: { userId },
      select: { userId: true },
    })
    if (!profile) {
      throw new ForbiddenException({
        message: 'clinical-intake-required',
        reason:
          'Complete your clinical intake before logging readings so your care team has the context to interpret them.',
      })
    }

    // Manisha 5/24 Q1 Tier 1 — physiologically-impossible reading (diastolic at
    // or above systolic). Reject at entry: do NOT persist, do NOT run the rule
    // engine (a transposed 120/140 would otherwise fire a false DBP≥120 Level-2
    // emergency). Log the rejected values for QA + the provider dashboard note.
    if (
      dto.systolicBP != null &&
      dto.diastolicBP != null &&
      dto.diastolicBP >= dto.systolicBP
    ) {
      await this.prisma.rejectedReadingLog.create({
        data: {
          userId,
          systolicBP: dto.systolicBP,
          diastolicBP: dto.diastolicBP,
          pulse: dto.pulse ?? null,
          reason: 'diastolic-ge-systolic',
        },
      })
      throw new UnprocessableEntityException({
        message: 'implausible-reading',
        reason:
          "That reading doesn't look right — the bottom number should be lower than the top number. Please check your cuff and try again.",
      })
    }

    // Manisha 5/24 Q1 Tier 2 — narrow pulse pressure on THIS individual reading
    // (artifact range, 0 < SBP−DBP < 15). Physician-only flag (no alert tier, no
    // patient message); the reading still enters the session average where the
    // separate <25 hemodynamic rule may fire.
    const narrowPpArtifact =
      dto.systolicBP != null &&
      dto.diastolicBP != null &&
      dto.systolicBP - dto.diastolicBP > 0 &&
      dto.systolicBP - dto.diastolicBP < 15

    // Resolve any missed-medication rows that came in with only `drugName`
    // (voice agent / chat tool). Looks up PatientMedication.id by name,
    // filters out AS_NEEDED (PRN) drugs since they aren't on a daily
    // schedule, drops unmatched drugs (model hallucination guard).
    const resolvedMissedMedications = await this.resolveMissedMedications(
      userId,
      dto.missedMedications,
    )

    // Reject attaching this reading to an EXPIRED session. The client supplies
    // sessionId, so a stale/reused id (e.g. a cached id from a prior sitting)
    // could otherwise smuggle a reading hours apart into one averaged session.
    // Patient path: dropped (not 400) so voice/chat flows that pass a cached
    // id don't fail. Admin path: strict 400 — the admin multi-reading flow
    // passes sessionId deliberately, so a stale id is an error the staff
    // member must see, not silently re-group.
    if (actor && dto.sessionId) {
      await this.assertSessionJoinable(userId, dto.sessionId, new Date(dto.measuredAt))
    }
    const effectiveSessionId = await this.resolveCreateSessionId(
      userId,
      dto.sessionId,
      new Date(dto.measuredAt),
    )

    // Option D (Manisha 2026-06-12 Q2) — retake-to-confirm state from the DTO.
    // AWAITING = first-of-pair emergency reading (held; engine NOT run here);
    // CONFIRMATORY = second reading confirming/clearing the first.
    const optionDState: EmergencyConfirmationState | null =
      dto.beginEmergencyConfirmation
        ? EmergencyConfirmationState.AWAITING
        : dto.confirmsEntryId
          ? EmergencyConfirmationState.CONFIRMATORY
          : null

    // Step 2 edit window (Manisha 2026-06-12 Q1+Q4) — patient (non-admin)
    // readings are editable/deletable for 5 min before the engine commits. The
    // readings page reads this to surface the edit/delete affordance; the engine
    // firing itself is still gated by the existing single-reading hold. Admin
    // entries and Option D AWAITING readings (held under their own retake
    // semantics) get no window.
    const engineEvaluationDeferredUntil =
      actor || optionDState === EmergencyConfirmationState.AWAITING
        ? null
        : new Date(Date.now() + SINGLE_READING_FINALIZE_MS)

    try {
      // Chunk A — compute the measurement-lag band at persist time so the
      // patient app + admin can render the right affordance off a stored value.
      const delayBand = computeDelayBand(new Date(dto.measuredAt), new Date())
      // Audit write is transaction-scoped with the insert — a reading can't
      // exist without its PATIENT_READING_CREATED / ADMIN_READING_ADDED audit
      // row; an audit failure rolls the insert back (succeed/fail together).
      const entry = await this.prisma.$transaction(async (tx) => {
        const created = await tx.journalEntry.create({
        data: {
          userId,
          addedByUserId: actor?.id ?? null,
          measuredAt: new Date(dto.measuredAt),
          delayBand,
          systolicBP: dto.systolicBP ?? null,
          diastolicBP: dto.diastolicBP ?? null,
          pulse: dto.pulse ?? null,
          narrowPpArtifact,
          weight: dto.weight != null ? new Prisma.Decimal(dto.weight) : null,
          position: dto.position ?? null,
          sessionId: effectiveSessionId,
          // Option D + edit window (Manisha 2026-06-12).
          emergencyConfirmation: optionDState,
          confirmsEntryId: dto.confirmsEntryId ?? null,
          engineEvaluationDeferredUntil,
          measurementConditions: (dto.measurementConditions as JsonValue) ?? Prisma.JsonNull,
          medicationTaken: dto.medicationTaken ?? null,
          medicationScheduledLater: dto.medicationScheduledLater ?? false,
          missedDoses: dto.missedDoses ?? null,
          missedMedications: (resolvedMissedMedications as unknown as JsonValue) ?? Prisma.JsonNull,
          medicationStatuses: (dto.medicationStatuses as unknown as JsonValue) ?? Prisma.JsonNull,
          // V2 structured Level-2 symptom triggers (Flow B). Prefer the
          // explicit booleans, otherSymptoms goes to the same column. The
          // legacy `symptoms` array (v1 clients) is appended so nothing is
          // lost during the transition.
          severeHeadache: dto.severeHeadache ?? false,
          visualChanges: dto.visualChanges ?? false,
          alteredMentalStatus: dto.alteredMentalStatus ?? false,
          chestPainOrDyspnea: dto.chestPainOrDyspnea ?? false,
          focalNeuroDeficit: dto.focalNeuroDeficit ?? false,
          severeEpigastricPain: dto.severeEpigastricPain ?? false,
          newOnsetHeadache: dto.newOnsetHeadache ?? false,
          ruqPain: dto.ruqPain ?? false,
          edema: dto.edema ?? false,
          dizziness: dto.dizziness ?? false,
          syncope: dto.syncope ?? false,
          palpitations: dto.palpitations ?? false,
          legSwelling: dto.legSwelling ?? false,
          // Cluster 7 — Appendix A side-effect symptom flags.
          fatigue: dto.fatigue ?? false,
          shortnessOfBreath: dto.shortnessOfBreath ?? false,
          dryCough: dto.dryCough ?? false,
          nsaidUse: dto.nsaidUse ?? false,
          // Cluster 8 — ACE-angioedema airway-emergency flags.
          faceSwelling: dto.faceSwelling ?? false,
          throatTightness: dto.throatTightness ?? false,
          otherSymptoms: [
            ...(dto.otherSymptoms ?? []),
            ...(dto.symptoms ?? []),
          ],
          teachBackAnswer: dto.teachBackAnswer ?? null,
          teachBackCorrect: dto.teachBackCorrect ?? null,
          notes: dto.notes ?? null,
          source: actor
            ? EntrySource.ADMIN
            : dto.source
              ? SOURCE_MAP[dto.source]
              : EntrySource.MANUAL,
          sourceMetadata: (dto.sourceMetadata as JsonValue) ?? Prisma.JsonNull,
        },
        })

        await this.writeJournalAudit(tx, {
          userId,
          actor,
          changeType: actor
            ? VerificationChangeType.ADMIN_READING_ADDED
            : VerificationChangeType.PATIENT_READING_CREATED,
          fieldPath: actor ? 'journal_entry.admin_added' : 'journal_entry.created',
          previousValue: null,
          newValue: this.serializeForAudit(created),
        })

        return created
      })

      // Option D (Manisha 2026-06-12 Q2) — when this reading CONFIRMS a held
      // first-of-pair, release that first-of-pair's hold so the session-finalize
      // cron won't ALSO fire RULE_UNCONFIRMED_EMERGENCY on it. The atomic
      // updateMany guard mirrors finalizeSingleReadingSession.
      if (
        optionDState === EmergencyConfirmationState.CONFIRMATORY &&
        dto.confirmsEntryId
      ) {
        await this.prisma.journalEntry.updateMany({
          where: { id: dto.confirmsEntryId, userId, singleReadingFinalized: false },
          data: { singleReadingFinalized: true },
        })
      }

      // Engine evaluation runs for BOTH patient and admin creates — a new
      // reading is a new clinical datapoint regardless of who keyed it in.
      // EXCEPTION: an Option D AWAITING first-of-pair is HELD — the engine must
      // NOT run (no emergency may page until the patient confirms or the
      // cron/decline path resolves it as UNCONFIRMED). So skip the emit.
      if (optionDState !== EmergencyConfirmationState.AWAITING) {
        this.eventEmitter.emit(JOURNAL_EVENTS.ENTRY_CREATED, {
          userId,
          entryId: entry.id,
          measuredAt: entry.measuredAt,
          systolicBP: entry.systolicBP,
          diastolicBP: entry.diastolicBP,
          pulse: entry.pulse,
          weight: entry.weight != null ? Number(entry.weight) : null,
          sessionId: entry.sessionId,
        })
      }

      // Cluster 6 Q2 (Manisha 5/9/26): frontend hint to render the "Take a
      // second reading in about 1 minute" prompt + 5-min timeout. True when
      // this is the only entry in its session AND the patient isn't AFib
      // (which has its own ≥3-reading gate) AND isn't Pre-Day-3. The engine
      // gate is the authoritative source — this hint is just for UX so the
      // patient sees the prompt without polling.
      // Option D readings drive their own retake UI (Screen B), not the
      // ordinary Cluster 6 Q2 "take a second reading" non-emergency prompt.
      const pendingSecondReading = optionDState
        ? false
        : await this.computePendingSecondReading(userId, entry)

      // Chunk B fix-up (Manisha Backdated Readings sign-off 2026-06-06) —
      // Gate A (structural "is new latest?") POST signal. If a strictly later
      // reading already exists OUTSIDE this entry's 5-min session window, the
      // engine will suppress all alerts for this entry, and the patient app
      // shows the "recorded but won't trigger real-time alerts" banner. The
      // window margin keeps a second same-session reading from false-
      // positives; the engine's own gate (alert-engine.service.ts) compares
      // against the session max, so the two predicates agree except in
      // exotic overlap cases, where the engine (suppression side) wins.
      // Computed at create time only — not on GETs (recomputing later could
      // misreport entries whose alerts genuinely fired before a later-
      // measured entry arrived; persisting it would need a schema change).
      const newerOutsideSession = await this.prisma.journalEntry.findFirst({
        where: {
          userId,
          measuredAt: {
            gt: new Date(entry.measuredAt.getTime() + SESSION_WINDOW_MS),
          },
        },
        select: { id: true },
      })

      return {
        statusCode: 202,
        message: 'Journal entry accepted. Background analysis in progress.',
        data: this.serializeEntry(entry, {
          gateASuppressed: newerOutsideSession != null,
        }),
        pendingSecondReading,
        // Option D (Manisha 2026-06-12 Q2) — tells the patient app to show the
        // confirmatory second-reading screen (Screen B). The held first-of-pair
        // id is `data.id`, which the app passes back as `confirmsEntryId`.
        pendingEmergencyConfirmation:
          optionDState === EmergencyConfirmationState.AWAITING,
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A journal entry already exists for this timestamp',
        )
      }

      this.logger.error('Failed to create journal entry', error)
      throw new InternalServerErrorException(
        'An unexpected error occurred while saving the journal entry',
      )
    }
  }

  /**
   * `actor` set = care-team edit via the admin readings endpoints: audit row
   * is ADMIN_READING_EDITED and no event is emitted at all.
   *
   * Patient edits (actor undefined) emit ENTRY_UPDATED — but per the signed CTO
   * 2026-06-09 no-re-trigger policy (Manisha 2026-06-12 Q2 "we cannot un-page"),
   * the rule engine deliberately does NOT subscribe to ENTRY_UPDATED. The emit
   * exists ONLY so chat / voice refresh their context cache. The edited value
   * is seen by the engine only when it next evaluates a NEW entry (e.g. session
   * averaging picks up the corrected sibling). A patient editing a fired reading
   * never flips/double-fires its alert.
   */
  async update(
    userId: string,
    entryId: string,
    dto: UpdateJournalEntryDto,
    actor?: ActorUser,
  ) {
    const existing = await this.prisma.journalEntry.findFirst({
      where: { id: entryId, userId },
    })

    if (!existing) {
      // Composite WHERE failed — either the entry doesn't exist OR it exists
      // but belongs to a different patient. We don't distinguish: both surface
      // the same NotFoundException so a probe can't confirm an id's existence.
      // The log line lets ops detect cross-tenant probes + LLM-hallucinated
      // UUIDs (Gemini native-audio hallucinates ids, python-genai#1894).
      this.logger.warn(
        `[SECURITY] cross_tenant_attempt service=journal action=update userId=${userId} requestedId=${entryId}`,
      )
      throw new NotFoundException('Journal entry not found')
    }

    try {
      const data: Prisma.JournalEntryUpdateInput = {}

      if (dto.measuredAt !== undefined) data.measuredAt = new Date(dto.measuredAt)
      if (dto.systolicBP !== undefined) data.systolicBP = dto.systolicBP
      if (dto.diastolicBP !== undefined) data.diastolicBP = dto.diastolicBP
      if (dto.pulse !== undefined) data.pulse = dto.pulse
      if (dto.weight !== undefined)
        data.weight = dto.weight != null ? new Prisma.Decimal(dto.weight) : null
      if (dto.position !== undefined)
        data.position = POSITION_VALUES.includes(dto.position as typeof POSITION_VALUES[number])
          ? (dto.position as typeof POSITION_VALUES[number])
          : null
      if (dto.sessionId !== undefined) data.sessionId = dto.sessionId

      if (dto.measurementConditions !== undefined)
        data.measurementConditions =
          (dto.measurementConditions as JsonValue) ?? Prisma.JsonNull
      if (dto.medicationTaken !== undefined) data.medicationTaken = dto.medicationTaken
      if (dto.medicationScheduledLater !== undefined)
        data.medicationScheduledLater = dto.medicationScheduledLater
      if (dto.missedDoses !== undefined) data.missedDoses = dto.missedDoses
      if (dto.missedMedications !== undefined) {
        const resolved = await this.resolveMissedMedications(
          userId,
          dto.missedMedications,
        )
        data.missedMedications = (resolved as unknown as JsonValue) ?? Prisma.JsonNull
      }
      if (dto.medicationStatuses !== undefined) {
        data.medicationStatuses =
          (dto.medicationStatuses as unknown as JsonValue) ?? Prisma.JsonNull
      }

      // Structured V2 symptom booleans (Flow B). Each is independently
      // patchable so a partial update doesn't blow away the others.
      if (dto.severeHeadache !== undefined) data.severeHeadache = dto.severeHeadache
      if (dto.visualChanges !== undefined) data.visualChanges = dto.visualChanges
      if (dto.alteredMentalStatus !== undefined) data.alteredMentalStatus = dto.alteredMentalStatus
      if (dto.chestPainOrDyspnea !== undefined) data.chestPainOrDyspnea = dto.chestPainOrDyspnea
      if (dto.focalNeuroDeficit !== undefined) data.focalNeuroDeficit = dto.focalNeuroDeficit
      if (dto.severeEpigastricPain !== undefined) data.severeEpigastricPain = dto.severeEpigastricPain
      if (dto.newOnsetHeadache !== undefined) data.newOnsetHeadache = dto.newOnsetHeadache
      if (dto.ruqPain !== undefined) data.ruqPain = dto.ruqPain
      if (dto.edema !== undefined) data.edema = dto.edema
      if (dto.dizziness !== undefined) data.dizziness = dto.dizziness
      if (dto.syncope !== undefined) data.syncope = dto.syncope
      if (dto.palpitations !== undefined) data.palpitations = dto.palpitations
      if (dto.legSwelling !== undefined) data.legSwelling = dto.legSwelling
      // Cluster 7 — Appendix A side-effect symptom flags on edit path.
      if (dto.fatigue !== undefined) data.fatigue = dto.fatigue
      if (dto.shortnessOfBreath !== undefined) data.shortnessOfBreath = dto.shortnessOfBreath
      if (dto.dryCough !== undefined) data.dryCough = dto.dryCough
      if (dto.nsaidUse !== undefined) data.nsaidUse = dto.nsaidUse
      // Cluster 8 — ACE-angioedema airway-emergency flags on edit path.
      if (dto.faceSwelling !== undefined) data.faceSwelling = dto.faceSwelling
      if (dto.throatTightness !== undefined) data.throatTightness = dto.throatTightness

      if (dto.otherSymptoms !== undefined || dto.symptoms !== undefined) {
        data.otherSymptoms = [
          ...(dto.otherSymptoms ?? []),
          ...(dto.symptoms ?? []),
        ]
      }
      if (dto.teachBackAnswer !== undefined) data.teachBackAnswer = dto.teachBackAnswer
      if (dto.teachBackCorrect !== undefined) data.teachBackCorrect = dto.teachBackCorrect
      if (dto.notes !== undefined) data.notes = dto.notes
      if (dto.source !== undefined)
        data.source = dto.source ? SOURCE_MAP[dto.source] : EntrySource.MANUAL
      if (dto.sourceMetadata !== undefined)
        data.sourceMetadata = (dto.sourceMetadata as JsonValue) ?? Prisma.JsonNull

      // Bug 41 + 42 — no-op filter. Strip any field whose new value equals
      // the existing value so the LLM/patient gets a graceful "nothing to
      // update" response instead of a successful but meaningless Prisma
      // round-trip. Side effect (Bug 42): the resolveUpdateSessionId call
      // below is now gated on data.measuredAt SURVIVING the filter — i.e.
      // it only fires when the new time actually differs. Pre-fix Bug 25's
      // regroup churned sessionId even when the LLM re-set measuredAt to
      // its current value.
      this.filterNoOpFieldsInPlace(data, existing)
      if (Object.keys(data).length === 0) {
        // Bug 59 — explicit `noChange: true` flag so dispatchers can route
        // the response to a graceful "values already match" reply for the
        // patient instead of claiming "Reading updated successfully." when
        // nothing actually changed. Pre-fix dispatchers ignored result.message
        // and hardcoded "Reading updated successfully." — the patient got
        // told their reading was edited even when it wasn't.
        return {
          statusCode: 200,
          noChange: true,
          message:
            'No changes — the reading already has those values. Nothing to update.',
          data: this.serializeEntry(existing),
        }
      }

      // Bug 25 — when measuredAt is being changed AND the caller did NOT
      // explicitly override sessionId, re-evaluate the session assignment
      // against the new time. Auto-joins a 5-min-window sibling session,
      // leaves a stale session when moving away from originals, or stays
      // put when still grouped with current siblings. Bug 42 — gated on
      // data.measuredAt surviving the no-op filter above so we don't churn
      // sessionId on a no-change "edit".
      if (data.measuredAt !== undefined && dto.sessionId === undefined) {
        const resolved = await this.resolveUpdateSessionId(
          userId,
          entryId,
          existing.sessionId,
          data.measuredAt as Date,
        )
        if (resolved !== existing.sessionId) {
          this.logger.log(
            `update: time-edit auto-regrouping entry=${entryId} ` +
              `${existing.sessionId ?? 'null'} → ${resolved}`,
          )
        }
        data.sessionId = resolved
      }

      // Update + audit are one transaction — the edit can't land without its
      // prior/new snapshot pair, and an audit failure rolls the edit back.
      const updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.journalEntry.update({
          where: { id: entryId },
          data,
        })
        await this.writeJournalAudit(tx, {
          userId,
          actor,
          changeType: actor
            ? VerificationChangeType.ADMIN_READING_EDITED
            : VerificationChangeType.PATIENT_READING_EDITED,
          fieldPath: actor ? 'journal_entry.admin_edited' : 'journal_entry.edited',
          previousValue: this.serializeForAudit(existing),
          newValue: this.serializeForAudit(row),
        })
        return row
      })

      // Patient edits keep the engine re-evaluation (see method doc). Admin
      // edits skip it per CTO Option C — no new emit, existing alerts stand.
      if (!actor) {
        this.eventEmitter.emit(JOURNAL_EVENTS.ENTRY_UPDATED, {
          userId,
          entryId: updated.id,
          measuredAt: updated.measuredAt,
          systolicBP: updated.systolicBP,
          diastolicBP: updated.diastolicBP,
          pulse: updated.pulse,
          weight: updated.weight != null ? Number(updated.weight) : null,
          sessionId: updated.sessionId,
        })
      }

      return {
        statusCode: actor ? 200 : 202,
        message: actor
          ? 'Journal entry updated.'
          : 'Journal entry updated. Background re-analysis in progress.',
        data: this.serializeEntry(updated),
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A journal entry already exists for this timestamp',
        )
      }

      this.logger.error('Failed to update journal entry', error)
      throw new InternalServerErrorException(
        'An unexpected error occurred while updating the journal entry',
      )
    }
  }

  async findAll(
    userId: string,
    startDate?: string,
    endDate?: string,
    limit?: number,
  ) {
    const where: Prisma.JournalEntryWhereInput = { userId }

    if (startDate || endDate) {
      where.measuredAt = {}
      if (startDate) where.measuredAt.gte = new Date(startDate)
      if (endDate) where.measuredAt.lte = new Date(endDate)
    }

    const take = Math.min(limit ?? 50, 200)

    const entries = await this.prisma.journalEntry.findMany({
      where,
      orderBy: [{ measuredAt: 'desc' }, { createdAt: 'desc' }],
      take,
    })

    return {
      statusCode: 200,
      message: 'Journal entries retrieved successfully',
      data: entries.map((entry) => this.serializeEntry(entry)),
    }
  }

  async getHistory(userId: string, page: number, limit: number) {
    const skip = (page - 1) * limit

    const [entries, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where: { userId },
        orderBy: [{ measuredAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
        include: {
          deviationAlerts: {
            select: {
              id: true,
              type: true,
              severity: true,
              magnitude: true,
              baselineValue: true,
              actualValue: true,
              escalated: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.journalEntry.count({ where: { userId } }),
    ])

    return {
      statusCode: 200,
      message: 'Journal history retrieved successfully',
      data: entries.map((entry) => ({
        id: entry.id,
        measuredAt: entry.measuredAt,
        systolicBP: entry.systolicBP,
        diastolicBP: entry.diastolicBP,
        pulse: entry.pulse,
        weight: entry.weight != null ? Number(entry.weight) : null,
        position: entry.position,
        sessionId: entry.sessionId,
        medicationTaken: entry.medicationTaken,
        missedDoses: entry.missedDoses,
        otherSymptoms: entry.otherSymptoms,
        teachBackAnswer: entry.teachBackAnswer,
        teachBackCorrect: entry.teachBackCorrect,
        notes: entry.notes,
        source: entry.source.toLowerCase(),
        sourceMetadata: entry.sourceMetadata,
        deviations: entry.deviationAlerts.map((a) => ({
          id: a.id,
          type: a.type,
          severity: a.severity,
          magnitude: a.magnitude != null ? Number(a.magnitude) : null,
          baselineValue: a.baselineValue ? Number(a.baselineValue) : null,
          actualValue: a.actualValue ? Number(a.actualValue) : null,
          escalated: a.escalated,
          status: a.status,
        })),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  async findOne(userId: string, id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, userId },
    })

    if (!entry) {
      this.logger.warn(
        `[SECURITY] cross_tenant_attempt service=journal action=findOne userId=${userId} requestedId=${id}`,
      )
      throw new NotFoundException('Journal entry not found')
    }

    return {
      statusCode: 200,
      message: 'Journal entry retrieved successfully',
      data: this.serializeEntry(entry),
    }
  }

  async getAlerts(userId: string) {
    const alerts = await this.prisma.deviationAlert.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      // Cap at 200 most-recent alerts — a heavy patient with years of
      // history doesn't need every alert dumped at once. Older alerts can
      // be fetched via paginated routes if/when needed. Defence-in-depth
      // for OWASP LLM02 "minimum necessary" — even within a single
      // patient's data, don't fetch more than the UI uses.
      take: 200,
      include: {
        journalEntry: {
          select: {
            id: true,
            measuredAt: true,
            systolicBP: true,
            diastolicBP: true,
            pulse: true,
            weight: true,
          },
        },
      },
    })

    // Bug 12 (live-test 2026-06-15) — provider-only alerts must NEVER reach the
    // patient surface, regardless of tier. A PROVIDER-ONLY alert is one with an
    // empty patientMessage: Tier-3 caregiver/physician notes
    // (RULE_HF_CAREGIVER_EDEMA, RULE_HCM_VASODILATOR, RULE_PULSE_PRESSURE_NARROW,
    // loop-diuretic, etc.) AND the Option D Tier-1 RULE_UNCONFIRMED_EMERGENCY /
    // Tier-3 RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL. The previous filter only
    // gated TIER_3_INFO, so RULE_UNCONFIRMED_EMERGENCY (TIER_1_CONTRAINDICATION,
    // empty patientMessage) leaked into the patient feed with a tier-generic
    // "Important medication alert" title. Filtering on a non-empty patientMessage
    // universally is the robust guard — every genuinely patient-facing alert
    // (BP L1/L2, emergencies, contraindications, adherence) carries one; the
    // admin endpoint is unchanged (Physician Notes keep everything).
    const patientVisible = alerts.filter(
      (a) => typeof a.patientMessage === 'string' && a.patientMessage.trim().length > 0,
    )

    return {
      statusCode: 200,
      message: 'Alerts retrieved successfully',
      data: patientVisible.map((alert) => ({
        ...alert,
        magnitude: alert.magnitude != null ? Number(alert.magnitude) : null,
        baselineValue: alert.baselineValue
          ? Number(alert.baselineValue)
          : null,
        actualValue: alert.actualValue ? Number(alert.actualValue) : null,
        journalEntry: alert.journalEntry
          ? {
              ...alert.journalEntry,
              weight: alert.journalEntry.weight != null
                ? Number(alert.journalEntry.weight)
                : null,
            }
          : null,
      })),
    }
  }

  async acknowledgeAlert(userId: string, alertId: string) {
    const alert = await this.prisma.deviationAlert.findFirst({
      where: { id: alertId, userId },
    })

    if (!alert) {
      throw new NotFoundException('Alert not found')
    }

    // CLINICAL_SPEC §V2-C — Tier 1 contraindications + BP Level 2 emergencies
    // are non-dismissable: only a clinician closes them out via the resolve
    // endpoint. Setting acknowledgedAt would stop the escalation cron from
    // paging providers (see escalation.service.ts advanceOverdueLadders),
    // creating a clinical-safety hole. Reject patient acks here even if the
    // UI happens to surface the button (defense-in-depth against stale
    // builds and direct API calls).
    if (alert.dismissible === false) {
      throw new BadRequestException(
        'This alert is non-dismissable and must be resolved by your care team.',
      )
    }

    if (alert.status === 'ACKNOWLEDGED') {
      return {
        statusCode: 200,
        message: 'Alert already acknowledged',
        data: alert,
      }
    }

    // Bug #4 fix: ack must propagate to EscalationEvent rows so the JCAHO
    // 15-field audit trail (CLINICAL_SPEC §V2-D) carries the patient's
    // ack-by + ack-at on every dispatched event row, not just the parent
    // DeviationAlert. Bug #2 fix: also populate acknowledgedByUserId so
    // the actor (patient vs admin vs provider) is recoverable from the
    // alert row alone — matches the admin path semantics in
    // alert-resolution.service.ts. Both writes happen inside a single
    // transaction so a partial failure can't desynchronize state.
    const now = new Date()
    const [updated] = await this.prisma.$transaction([
      this.prisma.deviationAlert.update({
        where: { id: alertId },
        data: {
          status: 'ACKNOWLEDGED',
          acknowledgedAt: now,
          acknowledgedByUserId: userId,
        },
      }),
      this.prisma.escalationEvent.updateMany({
        where: { alertId, acknowledgedAt: null, resolvedAt: null },
        data: { acknowledgedAt: now, acknowledgedBy: userId },
      }),
    ])

    return {
      statusCode: 200,
      message: 'Alert acknowledged',
      data: updated,
    }
  }

  async getNotifications(
    userId: string,
    status: 'all' | 'unread' | 'read' = 'all',
  ) {
    // Bell LIST uses the shared BELL_VISIBLE_NOTIFICATION_FILTER (H3 #80 EMAIL
    // exclusion + H5 G.4 alert-linked-PUSH exclusion). READ-SIDE only.
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...BELL_VISIBLE_NOTIFICATION_FILTER,
    }

    if (status === 'unread') {
      where.readAt = null
    } else if (status === 'read') {
      where.readAt = { not: null }
    }

    const notifications = await this.prisma.withConnectionRetry(
      () =>
        this.prisma.notification.findMany({
          where,
          orderBy: { sentAt: 'desc' },
          // Cap at 200 — bell shows the most-recent N; older notifications
          // exist in the DB but don't need to flood the response. Same
          // OWASP LLM02 "minimum necessary" rationale as getAlerts above.
          take: 200,
          // Pull the patient userId via the linked alert so the bell can
          // deep-link clicks to /patients/{patientUserId}?alert={alertId}.
          // notification.userId is the *recipient* (admin/provider/ops), not
          // the patient — without this join the bell can't reconstruct the
          // patient URL.
          include: { alert: { select: { userId: true } } },
        }),
      'getNotifications',
    )

    return {
      statusCode: 200,
      message: 'Notifications retrieved successfully',
      data: notifications.map((notification) => ({
        ...notification,
        // Prefer the explicit subject patient (care-team notices); fall back to
        // the linked alert's patient (alert/escalation notices). Either drives
        // the bell's /patients/{id} deep-link.
        patientUserId: notification.patientUserId ?? notification.alert?.userId ?? null,
        watched: notification.readAt != null,
      })),
    }
  }

  /**
   * Count of in-app unread notifications for the bell badge. Uses the SAME
   * BELL_VISIBLE_NOTIFICATION_FILTER as getNotifications so the badge count and
   * the list contents can never drift (EMAIL + alert-linked PUSH excluded).
   * Cheap (indexed on [userId, readAt]).
   */
  async getNotificationsUnreadCount(userId: string) {
    const count = await this.prisma.withConnectionRetry(
      () =>
        this.prisma.notification.count({
          where: {
            userId,
            readAt: null,
            ...BELL_VISIBLE_NOTIFICATION_FILTER,
          },
        }),
      'getNotificationsUnreadCount',
    )
    return {
      statusCode: 200,
      data: { unread: count },
    }
  }

  async getNotificationById(userId: string, id: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
    })

    if (!notification) {
      throw new NotFoundException('Notification not found')
    }

    return {
      statusCode: 200,
      message: 'Notification retrieved successfully',
      data: {
        ...notification,
        watched: notification.readAt != null,
      },
    }
  }

  async updateNotificationStatus(
    userId: string,
    id: string,
    watched: boolean,
  ) {
    const existing = await this.prisma.notification.findFirst({
      where: { id, userId },
    })

    if (!existing) {
      throw new NotFoundException('Notification not found')
    }

    const readAt = watched ? existing.readAt ?? new Date() : null

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt },
    })

    return {
      statusCode: 200,
      message: 'Notification status updated',
      data: {
        ...updated,
        watched: updated.readAt != null,
      },
    }
  }

  async bulkUpdateNotificationStatus(
    userId: string,
    ids: string[],
    watched: boolean,
  ) {
    if (!ids.length) {
      return {
        statusCode: 200,
        message: 'Notifications status updated',
        data: { count: 0 },
      }
    }

    const readAt = watched ? new Date() : null

    const result = await this.prisma.notification.updateMany({
      where: {
        id: { in: ids },
        userId,
      },
      data: { readAt },
    })

    return {
      statusCode: 200,
      message: 'Notifications status updated',
      data: { count: result.count },
    }
  }

  // v2: trend averages are derived on the fly, not stored. This endpoint used
  // to read BaselineSnapshot rows; now it computes a trailing 7-day mean of
  // complete (SBP + DBP) readings from JournalEntry. Returns null when the
  // window has no usable data.
  async getLatestBaseline(userId: string) {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const entries = await this.prisma.journalEntry.findMany({
      where: {
        userId,
        measuredAt: { gte: sevenDaysAgo },
        systolicBP: { not: null },
        diastolicBP: { not: null },
      },
      select: { systolicBP: true, diastolicBP: true, weight: true },
    })

    if (entries.length === 0) {
      return {
        statusCode: 200,
        message: 'No baseline available yet',
        data: null,
      }
    }

    const sbps = entries.map((e) => e.systolicBP as number)
    const dbps = entries.map((e) => e.diastolicBP as number)
    const weights = entries
      .filter((e) => e.weight != null)
      .map((e) => Number(e.weight))

    const avg = (xs: number[]) =>
      xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null

    return {
      statusCode: 200,
      message: 'Baseline retrieved successfully',
      data: {
        baselineSystolic: avg(sbps),
        baselineDiastolic: avg(dbps),
        baselineWeight: avg(weights),
        sampleSize: entries.length,
      },
    }
  }

  /**
   * Cluster 6 Q2 (Manisha 5/9/26) — patient's 5-min "take a second reading"
   * timer elapsed. Flip `singleReadingFinalized = true` on the entry and
   * emit a fresh ENTRY_UPDATED event so AlertEngine re-evaluates with the
   * non-emergency single-reading gate bypassed. Idempotent — no-op if the
   * flag is already set or a sibling reading has since arrived (in which
   * case the session is no longer single-reading and the flag is moot).
   */
  async finalizeSingleReadingSession(userId: string, entryId: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id: entryId, userId },
      select: {
        id: true,
        userId: true,
        sessionId: true,
        measuredAt: true,
        systolicBP: true,
        diastolicBP: true,
        pulse: true,
        weight: true,
        singleReadingFinalized: true,
      },
    })
    if (!entry) {
      throw new NotFoundException('Journal entry not found')
    }
    if (entry.singleReadingFinalized) {
      return {
        statusCode: 200,
        message: 'Already finalized — no-op.',
      }
    }

    // Bug 1 (secondary) — atomic claim. The frontend 5-min timer and the
    // SessionFinalizeService cron (and two cron ticks) can call this
    // concurrently; the read-then-update above would let both pass the guard,
    // both re-emit ENTRY_UPDATED, and double-fire the alert. updateMany flips
    // the flag only while it's still false, so exactly one caller wins
    // (count === 1) and proceeds to re-evaluate — the rest no-op.
    const claim = await this.prisma.journalEntry.updateMany({
      where: { id: entryId, singleReadingFinalized: false },
      data: { singleReadingFinalized: true },
    })
    if (claim.count === 0) {
      return {
        statusCode: 200,
        message: 'Already finalized — no-op.',
      }
    }

    // FIRST evaluation of the held single reading (not a re-trigger).
    // AlertEngineService.handleEntryFinalized subscribes to ENTRY_FINALIZED;
    // ENTRY_UPDATED (patient edits) deliberately no longer reaches the engine
    // per the CTO 2026-06-09 no-re-trigger policy.
    this.eventEmitter.emit(JOURNAL_EVENTS.ENTRY_FINALIZED, {
      userId: entry.userId,
      entryId: entry.id,
      measuredAt: entry.measuredAt,
      systolicBP: entry.systolicBP,
      diastolicBP: entry.diastolicBP,
      pulse: entry.pulse,
      weight: entry.weight != null ? Number(entry.weight) : null,
      sessionId: entry.sessionId,
    })

    return {
      statusCode: 202,
      message:
        'Session finalized as single-reading. Background re-analysis in progress.',
    }
  }

  /**
   * Option D (Manisha 2026-06-12 Q2) — resolve a held AWAITING first-of-pair as
   * UNCONFIRMED. Called by the explicit decline endpoint (patient closed/declined
   * the retake) and by the SessionFinalizeService cron (app-closed safety net,
   * 5-min window elapsed with no confirmatory reading). Flips the row to
   * UNCONFIRMED + releases the hold, then re-triggers the engine, which fires
   * RULE_UNCONFIRMED_EMERGENCY (Tier 1 provider-only).
   *
   * Idempotent via the same `singleReadingFinalized` atomic claim as
   * finalizeSingleReadingSession — a CONFIRMATORY resolution releases the hold
   * first (sets singleReadingFinalized=true), so a racing cron tick no-ops and
   * never double-fires.
   */
  async finalizeUnconfirmedEmergency(userId: string, entryId: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id: entryId, userId },
      select: {
        id: true,
        userId: true,
        sessionId: true,
        measuredAt: true,
        systolicBP: true,
        diastolicBP: true,
        pulse: true,
        weight: true,
        singleReadingFinalized: true,
        emergencyConfirmation: true,
      },
    })
    if (!entry) {
      throw new NotFoundException('Journal entry not found')
    }
    // Only a still-held AWAITING entry becomes UNCONFIRMED. A CONFIRMATORY
    // resolution already released the hold — no-op.
    if (
      entry.emergencyConfirmation !== EmergencyConfirmationState.AWAITING ||
      entry.singleReadingFinalized
    ) {
      return { statusCode: 200, message: 'Already resolved — no-op.' }
    }

    // Atomic claim — flip hold + state only while still AWAITING + unfinalized.
    const claim = await this.prisma.journalEntry.updateMany({
      where: {
        id: entryId,
        singleReadingFinalized: false,
        emergencyConfirmation: EmergencyConfirmationState.AWAITING,
      },
      data: {
        singleReadingFinalized: true,
        emergencyConfirmation: EmergencyConfirmationState.UNCONFIRMED,
      },
    })
    if (claim.count === 0) {
      return { statusCode: 200, message: 'Already resolved — no-op.' }
    }

    // FIRST evaluation of the held reading (not a re-trigger). runPipeline sees
    // emergencyConfirmation=UNCONFIRMED and fires RULE_UNCONFIRMED_EMERGENCY.
    // Uses ENTRY_FINALIZED so the no-re-trigger policy on ENTRY_UPDATED holds.
    this.eventEmitter.emit(JOURNAL_EVENTS.ENTRY_FINALIZED, {
      userId: entry.userId,
      entryId: entry.id,
      measuredAt: entry.measuredAt,
      systolicBP: entry.systolicBP,
      diastolicBP: entry.diastolicBP,
      pulse: entry.pulse,
      weight: entry.weight != null ? Number(entry.weight) : null,
      sessionId: entry.sessionId,
    })

    return {
      statusCode: 202,
      message:
        'Unconfirmed emergency finalized. Background analysis in progress.',
    }
  }

  /**
   * Hard delete (soft-delete is paused with Chunk E). `actor` set = care-team
   * delete via the admin readings endpoints — ADMIN_READING_DELETED audit row
   * and NO session re-evaluation emit. Full row fetched (not a narrow select)
   * because the audit snapshot must capture the state being destroyed.
   */
  async delete(userId: string, id: string, actor?: ActorUser) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, userId },
    })

    if (!entry) {
      this.logger.warn(
        `[SECURITY] cross_tenant_attempt service=journal action=delete userId=${userId} requestedId=${id}`,
      )
      throw new NotFoundException('Journal entry not found')
    }

    // Resolve the session anchor that will trigger a re-evaluation BEFORE the
    // delete cascades. SessionAveragerService groups by sessionId OR a 5-min
    // measuredAt window (CLINICAL_SPEC §5.2); we mirror that here so the rule
    // engine recomputes the averaged vitals for what's left of the session.
    //
    // DeviationAlert / EscalationEvent rows owned by `entry` cascade-delete
    // via the FK (phase/2 schema). The re-evaluation below re-runs the rule
    // engine against the surviving session-anchor entry. Bug #6/#7 fix
    // (alert-engine.service.ts) removed the silent auto-resolve sweep, so
    // sibling-owned alerts retain their state until an admin resolves them
    // explicitly via /admin/alerts/:id/resolve. Re-evaluation may surface
    // NEW alerts on the surviving entry, but it never silently closes
    // existing ones.
    const survivingAnchor = actor ? null : await this.findSessionReevalAnchor(entry)

    // Audit row is written BEFORE the row is removed, in the same transaction
    // — the snapshot survives the hard delete, and a failed audit write rolls
    // the delete back (a reading can't vanish without its audit row).
    await this.prisma.$transaction(async (tx) => {
      await this.writeJournalAudit(tx, {
        userId,
        actor,
        changeType: actor
          ? VerificationChangeType.ADMIN_READING_DELETED
          : VerificationChangeType.PATIENT_READING_DELETED,
        fieldPath: actor ? 'journal_entry.admin_deleted' : 'journal_entry.deleted',
        previousValue: this.serializeForAudit(entry),
        newValue: null,
      })
      await tx.journalEntry.delete({ where: { id } })
    })

    // Patient deletes keep the surviving-sibling re-evaluation (session-
    // integrity maintenance — the averaged vitals must recompute for what's
    // left of the session). Admin deletes skip it per CTO Option C.
    if (survivingAnchor) {
      this.eventEmitter.emit(JOURNAL_EVENTS.ENTRY_UPDATED, {
        userId: survivingAnchor.userId,
        entryId: survivingAnchor.id,
        measuredAt: survivingAnchor.measuredAt,
        systolicBP: survivingAnchor.systolicBP,
        diastolicBP: survivingAnchor.diastolicBP,
        pulse: survivingAnchor.pulse,
        weight:
          survivingAnchor.weight != null ? Number(survivingAnchor.weight) : null,
        sessionId: survivingAnchor.sessionId,
      })
    }

    return {
      statusCode: 200,
      message: 'Journal entry deleted successfully',
    }
  }

  /**
   * Returns the newest remaining session-sibling of `entry`, or null if no
   * sibling exists. The rule engine will re-average the session from that
   * anchor after delete cascades.
   */
  private async findSessionReevalAnchor(entry: {
    id: string
    userId: string
    sessionId: string | null
    measuredAt: Date
  }) {
    // Window is anchored on this entry's measuredAt; mirror SessionAverager so
    // the surviving anchor we pick is one that would actually re-average with
    // what's left of the session (same id AND within the window, or null + window).
    const windowStart = new Date(entry.measuredAt.getTime() - SESSION_WINDOW_MS)
    const windowEnd = new Date(entry.measuredAt.getTime() + SESSION_WINDOW_MS)
    const select = {
      id: true,
      userId: true,
      sessionId: true,
      measuredAt: true,
      systolicBP: true,
      diastolicBP: true,
      pulse: true,
      weight: true,
    }

    if (entry.sessionId) {
      return this.prisma.journalEntry.findFirst({
        where: {
          userId: entry.userId,
          sessionId: entry.sessionId,
          id: { not: entry.id },
          measuredAt: { gte: windowStart, lte: windowEnd },
        },
        orderBy: { measuredAt: 'desc' },
        select,
      })
    }

    return this.prisma.journalEntry.findFirst({
      where: {
        userId: entry.userId,
        sessionId: null,
        id: { not: entry.id },
        measuredAt: { gte: windowStart, lte: windowEnd },
      },
      orderBy: { measuredAt: 'desc' },
      select,
    })
  }

  async getStats(userId: string) {
    const now = new Date()
    const thirtyDaysAgo = new Date(now)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const [totalEntries, recentEntries, allEntries] = await Promise.all([
      this.prisma.journalEntry.count({ where: { userId } }),
      this.prisma.journalEntry.findMany({
        // 30-day window is the natural cap for recentEntries — already
        // date-bounded so no `take` ceiling needed (worst-case: a patient
        // who logs 50 entries/day for 30 days = 1500 narrow rows, fine).
        where: { userId, measuredAt: { gte: thirtyDaysAgo } },
        select: { systolicBP: true, diastolicBP: true },
      }),
      this.prisma.journalEntry.findMany({
        where: { userId },
        orderBy: { measuredAt: 'desc' },
        // Cap full-history streak read at 1000 entries (~3 years of daily
        // check-ins) — long enough to compute any plausible streak, short
        // enough that a pathological row count can't blow the response.
        take: 1000,
        select: { measuredAt: true, medicationTaken: true },
      }),
    ])

    // Current streak: consecutive days ending today (tolerates UTC drift
    // by starting from tomorrow UTC for users east of UTC).
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    let currentStreak = 0
    if (allEntries.length > 0) {
      const entryDates = new Set(
        allEntries.map((e) => e.measuredAt.toISOString().slice(0, 10)),
      )
      const checkDate = new Date(today)
      checkDate.setDate(checkDate.getDate() + 1)
      while (
        !entryDates.has(checkDate.toISOString().slice(0, 10)) &&
        checkDate >= today
      ) {
        checkDate.setDate(checkDate.getDate() - 1)
      }
      while (entryDates.has(checkDate.toISOString().slice(0, 10))) {
        currentStreak++
        checkDate.setDate(checkDate.getDate() - 1)
      }
    }

    const medEntries = allEntries.filter((e) => e.medicationTaken !== null)
    const medTaken = medEntries.filter((e) => e.medicationTaken === true).length
    const medicationAdherenceRate =
      medEntries.length > 0 ? Math.round((medTaken / medEntries.length) * 100) : 0

    const systolicValues = recentEntries
      .filter((e) => e.systolicBP !== null)
      .map((e) => Number(e.systolicBP))
    const diastolicValues = recentEntries
      .filter((e) => e.diastolicBP !== null)
      .map((e) => Number(e.diastolicBP))

    const averageSystolic =
      systolicValues.length > 0
        ? Math.round(systolicValues.reduce((a, b) => a + b, 0) / systolicValues.length)
        : null
    const averageDiastolic =
      diastolicValues.length > 0
        ? Math.round(diastolicValues.reduce((a, b) => a + b, 0) / diastolicValues.length)
        : null

    const lastEntryDate =
      allEntries.length > 0
        ? allEntries[0].measuredAt.toISOString().slice(0, 10)
        : null

    return {
      statusCode: 200,
      message: 'Journal stats retrieved successfully',
      data: {
        totalEntries,
        currentStreak,
        medicationAdherenceRate,
        averageSystolic,
        averageDiastolic,
        lastEntryDate,
      },
    }
  }

  async getEscalations(userId: string) {
    const escalations = await this.prisma.escalationEvent.findMany({
      where: { userId },
      orderBy: { triggeredAt: 'desc' },
      // Cap at 200 most-recent escalations — patient escalation history
      // can grow large over time; older events are still queryable via
      // paginated routes if needed. Same OWASP "minimum necessary" rationale.
      take: 200,
      include: {
        alert: {
          select: {
            id: true,
            type: true,
            severity: true,
            tier: true,
            ruleId: true,
            actualValue: true,
            // Three-tier messages populated by OutputGenerator (phase/6).
            // Reviewed wording signed off by Dr. Singal; prefer these over
            // any hand-rolled strings in this endpoint.
            patientMessage: true,
            caregiverMessage: true,
            physicianMessage: true,
            journalEntry: {
              select: {
                measuredAt: true,
                systolicBP: true,
                diastolicBP: true,
              },
            },
          },
        },
      },
    })

    return {
      statusCode: 200,
      message: 'Escalation events retrieved successfully',
      data: escalations.map((e) => {
        const systolicBP = e.alert.journalEntry?.systolicBP ?? 0
        const diastolicBP = e.alert.journalEntry?.diastolicBP ?? 0

        // Prefer the three-tier messages persisted on DeviationAlert
        // (populated by OutputGenerator in phase/6). The v1 fallback copy
        // below only fires when a legacy escalation has all three message
        // columns null — shouldn't happen for phase/5+ alerts but kept as
        // a defensive last resort so the endpoint never returns an empty
        // string to the dashboard.
        const patientMessage =
          e.alert.patientMessage ??
          (e.escalationLevel === EscalationLevel.LEVEL_2
            ? 'URGENT: Your blood pressure reading indicates a medical emergency. Call 911 immediately or go to your nearest emergency room.'
            : 'Your recent blood pressure reading has been flagged. Your care team has been notified and will follow up with you within 24 hours.')

        // Provider dashboard consumes this as the clinical-side message.
        // `physicianMessage` is the reviewed clinician wording; fall back
        // to `caregiverMessage` if for some reason physician is null
        // (Tier 3 physician-only rules DO populate physicianMessage, so
        // this fallback is belt-and-suspenders).
        const careTeamMessage =
          e.alert.physicianMessage ??
          e.alert.caregiverMessage ??
          (e.escalationLevel === EscalationLevel.LEVEL_2
            ? `IMMEDIATE ACTION REQUIRED: Patient ${e.userId} has critical BP readings (${systolicBP}/${diastolicBP} mmHg). Emergency escalation triggered.`
            : `FOLLOW-UP WITHIN 24H: Patient ${e.userId} has elevated BP readings (${systolicBP}/${diastolicBP} mmHg). Review recommended.`)

        return {
          id: e.id,
          level: e.escalationLevel,
          patientMessage,
          careTeamMessage,
          createdAt: e.triggeredAt,
          alert: {
            id: e.alert.id,
            type: e.alert.type,
            severity: e.alert.severity,
            tier: e.alert.tier,
            ruleId: e.alert.ruleId,
            actualValue: e.alert.actualValue ? Number(e.alert.actualValue) : null,
            journalEntry: e.alert.journalEntry
              ? {
                  measuredAt: e.alert.journalEntry.measuredAt,
                  systolicBP: e.alert.journalEntry.systolicBP,
                  diastolicBP: e.alert.journalEntry.diastolicBP,
                }
              : null,
          },
        }
      }),
    }
  }

  /**
   * Compact JSON snapshot of a reading for the journal audit rows
   * (ProfileVerificationLog.previousValue / newValue) — the patient-visible
   * state only: vitals, timing, session, symptoms, notes. Internal engine
   * flags (narrowPpArtifact, singleReadingFinalized, teach-back) are not
   * audit-surface. `symptoms` collapses the structured booleans to the names
   * that are true plus freeform otherSymptoms.
   */
  private serializeForAudit(entry: {
    id: string
    measuredAt: Date
    systolicBP?: number | null
    diastolicBP?: number | null
    pulse?: number | null
    weight?: Prisma.Decimal | number | null
    position?: string | null
    sessionId?: string | null
    medicationTaken?: boolean | null
    missedDoses?: number | null
    otherSymptoms?: string[]
    notes?: string | null
    source?: EntrySource
    [key: string]: unknown
  }): Prisma.InputJsonValue {
    const symptoms: string[] = [
      ...AUDIT_SYMPTOM_FLAGS.filter((flag) => entry[flag] === true),
      ...(entry.otherSymptoms ?? []),
    ]
    return {
      entryId: entry.id,
      measuredAt: entry.measuredAt.toISOString(),
      systolicBP: entry.systolicBP ?? null,
      diastolicBP: entry.diastolicBP ?? null,
      pulse: entry.pulse ?? null,
      weight: entry.weight != null ? Number(entry.weight) : null,
      position: entry.position ?? null,
      sessionId: entry.sessionId ?? null,
      medicationTaken: entry.medicationTaken ?? null,
      missedDoses: entry.missedDoses ?? null,
      symptoms,
      notes: entry.notes ?? null,
      source: entry.source ? entry.source.toLowerCase() : null,
    }
  }

  /**
   * Journal-entry audit row writer — HIPAA/JCAHO closure for reading
   * create/edit/delete, which previously left no trace. Transaction-scoped
   * (caller passes the tx) so the audit row and the data operation succeed
   * or fail together; mirrors caregiver.service.ts writeAudit.
   */
  private async writeJournalAudit(
    tx: Prisma.TransactionClient,
    args: {
      userId: string
      actor?: ActorUser
      changeType: VerificationChangeType
      fieldPath: string
      previousValue: Prisma.InputJsonValue | null
      newValue: Prisma.InputJsonValue | null
    },
  ): Promise<void> {
    await tx.profileVerificationLog.create({
      data: {
        userId: args.userId,
        fieldPath: args.fieldPath,
        previousValue: args.previousValue ?? Prisma.JsonNull,
        newValue: args.newValue ?? Prisma.JsonNull,
        changedBy: args.actor?.id ?? args.userId,
        changedByRole: this.verifierRoleFor(args.actor),
        changeType: args.changeType,
      },
    })
  }

  /**
   * VerifierRole predates the 5-role split, so admin actors collapse:
   * PROVIDER (without a broader admin role) keeps its own VerifierRole;
   * SUPER_ADMIN / MEDICAL_DIRECTOR map to ADMIN. No actor = patient action.
   */
  private verifierRoleFor(actor?: ActorUser): VerifierRole {
    if (!actor) return VerifierRole.PATIENT
    if (
      actor.roles.includes(UserRole.PROVIDER) &&
      !actor.roles.includes(UserRole.SUPER_ADMIN) &&
      !actor.roles.includes(UserRole.MEDICAL_DIRECTOR)
    ) {
      return VerifierRole.PROVIDER
    }
    return VerifierRole.ADMIN
  }

  /**
   * Strict admin-POST variant of resolveCreateSessionId's staleness check.
   * The admin multi-reading flow passes sessionId deliberately, so a stale id
   * must surface as a 400 ("Session expired or invalid") rather than being
   * silently re-grouped like the forgiving patient/voice path. A sessionId
   * with no members yet is fine — the reading establishes the session.
   */
  private async assertSessionJoinable(
    userId: string,
    sessionId: string,
    measuredAt: Date,
  ): Promise<void> {
    const newest = await this.prisma.journalEntry.findFirst({
      where: { userId, sessionId },
      orderBy: { measuredAt: 'desc' },
      select: { measuredAt: true },
    })
    if (!newest) return
    const gapMs = Math.abs(measuredAt.getTime() - newest.measuredAt.getTime())
    if (gapMs > SESSION_WINDOW_MS) {
      throw new BadRequestException('Session expired or invalid')
    }
  }

  private serializeEntry(entry: {
    id: string
    userId: string
    measuredAt: Date
    // Manisha Backdated Readings sign-off 2026-06-06 (Chunk A) — bucketed
    // measurement-lag band. Surfaced for the patient time-picker UI (Chunk C)
    // and the admin "DELAYED" badge. Optional so legacy callers / tests that
    // mock the entry without delayBand keep compiling — Prisma always supplies
    // it on real reads via the @default(REAL_TIME) on the column.
    delayBand?: string
    systolicBP: number | null
    diastolicBP: number | null
    pulse: number | null
    weight: Prisma.Decimal | number | null
    position: string | null
    sessionId: string | null
    medicationTaken: boolean | null
    medicationScheduledLater?: boolean
    missedDoses: number | null
    missedMedications?: JsonValue
    medicationStatuses?: JsonValue
    severeHeadache?: boolean
    visualChanges?: boolean
    alteredMentalStatus?: boolean
    chestPainOrDyspnea?: boolean
    focalNeuroDeficit?: boolean
    severeEpigastricPain?: boolean
    newOnsetHeadache?: boolean
    ruqPain?: boolean
    edema?: boolean
    dizziness?: boolean
    syncope?: boolean
    palpitations?: boolean
    legSwelling?: boolean
    // Cluster 7 — Appendix A side-effect symptoms.
    fatigue?: boolean
    shortnessOfBreath?: boolean
    dryCough?: boolean
    nsaidUse?: boolean
    // Cluster 8 — ACE-angioedema airway-emergency symptoms.
    faceSwelling?: boolean
    throatTightness?: boolean
    otherSymptoms: string[]
    teachBackAnswer: string | null
    teachBackCorrect: boolean | null
    notes: string | null
    source: EntrySource
    sourceMetadata: JsonValue
    // Option D + edit window (Manisha 2026-06-12). Optional so mocked/legacy
    // callers keep compiling; Prisma supplies them on real reads.
    engineEvaluationDeferredUntil?: Date | null
    emergencyConfirmation?: string | null
    createdAt: Date
    updatedAt: Date
  },
  // Chunk B fix-up — POST-time-only signals that can't be derived from the
  // row itself. Omitted by GET/list callers.
  opts?: { gateASuppressed?: boolean },
  ) {
    return {
      id: entry.id,
      userId: entry.userId,
      measuredAt: entry.measuredAt,
      // Chunk A — surface the bucketed lag so the patient app + admin can
      // show the right UI affordance (DELAYED badge, 911-CTA-suppression
      // copy, HISTORICAL_ENTRY informational note). Defaults to REAL_TIME for
      // legacy rows persisted before the migration.
      delayBand: entry.delayBand ?? 'REAL_TIME',
      // Chunk B fix-up (Manisha Backdated Readings sign-off 2026-06-06) — why
      // real-time alerts were suppressed for this entry, if at all.
      // 'HISTORICAL_ENTRY' derives from the stored band, so it is stable on
      // POST and every subsequent GET and takes precedence; 'GATE_A' is
      // computed at create time only (see create()). Drives the Chunk C
      // "recorded but won't trigger real-time alerts" banner.
      alertsSuppressedReason:
        (entry.delayBand ?? 'REAL_TIME') === 'HISTORICAL_ENTRY'
          ? ('HISTORICAL_ENTRY' as const)
          : opts?.gateASuppressed
            ? ('GATE_A' as const)
            : null,
      systolicBP: entry.systolicBP,
      diastolicBP: entry.diastolicBP,
      pulse: entry.pulse,
      weight: entry.weight != null ? Number(entry.weight) : null,
      position: entry.position,
      sessionId: entry.sessionId,
      medicationTaken: entry.medicationTaken,
      medicationScheduledLater: entry.medicationScheduledLater ?? false,
      missedDoses: entry.missedDoses,
      missedMedications: entry.missedMedications ?? null,
      medicationStatuses: entry.medicationStatuses ?? null,
      severeHeadache: entry.severeHeadache ?? false,
      visualChanges: entry.visualChanges ?? false,
      alteredMentalStatus: entry.alteredMentalStatus ?? false,
      chestPainOrDyspnea: entry.chestPainOrDyspnea ?? false,
      focalNeuroDeficit: entry.focalNeuroDeficit ?? false,
      severeEpigastricPain: entry.severeEpigastricPain ?? false,
      newOnsetHeadache: entry.newOnsetHeadache ?? false,
      ruqPain: entry.ruqPain ?? false,
      edema: entry.edema ?? false,
      dizziness: entry.dizziness ?? false,
      syncope: entry.syncope ?? false,
      palpitations: entry.palpitations ?? false,
      legSwelling: entry.legSwelling ?? false,
      // Cluster 7 — Appendix A side-effect symptoms.
      fatigue: entry.fatigue ?? false,
      shortnessOfBreath: entry.shortnessOfBreath ?? false,
      dryCough: entry.dryCough ?? false,
      nsaidUse: entry.nsaidUse ?? false,
      // Cluster 8 — ACE-angioedema airway-emergency symptoms.
      faceSwelling: entry.faceSwelling ?? false,
      throatTightness: entry.throatTightness ?? false,
      otherSymptoms: entry.otherSymptoms,
      teachBackAnswer: entry.teachBackAnswer,
      teachBackCorrect: entry.teachBackCorrect,
      notes: entry.notes,
      source: entry.source.toLowerCase(),
      sourceMetadata: entry.sourceMetadata,
      // Option D + edit window (Manisha 2026-06-12) — the readings page uses
      // engineEvaluationDeferredUntil to show the "editable for 5 min / not yet
      // sent to your care team" affordance; emergencyConfirmation lets the app
      // distinguish a held/retake reading from an ordinary one.
      engineEvaluationDeferredUntil: entry.engineEvaluationDeferredUntil ?? null,
      emergencyConfirmation: entry.emergencyConfirmation ?? null,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }
  }

  /**
   * Backfill missing `medicationId` / `drugClass` on missed-medication rows
   * coming from clients that only know `drugName` (chat tool, ADK voice).
   * Filters out AS_NEEDED (PRN) drugs since they aren't on a fixed schedule
   * — the medication-missed rule shouldn't fire on them. Drugs the patient
   * doesn't actually own (model hallucination) are silently dropped.
   *
   * Returns undefined when nothing resolved so the JSON column stays NULL
   * and the adherence rule falls back to the medicationTaken rollup.
   *
   * Form-shape rows that already include medicationId + drugClass pass
   * through unchanged (still filtered for AS_NEEDED via the lookup).
   */
  /**
   * Cluster 6 Q2 frontend hint. Same gating semantics as the engine but
   * computed synchronously at create time so the response can carry it
   * without forcing the patient app to poll. Conservative — when in
   * doubt (e.g. profile lookup fails), returns false so we don't show
   * the prompt for someone whose AFib status was unknown.
   */
  private async computePendingSecondReading(
    userId: string,
    entry: { id: string; sessionId: string | null; measuredAt: Date },
  ): Promise<boolean> {
    return this.shouldFinalizeAsSingleReading(userId, entry)
  }

  /**
   * Single source of truth for "is this a lone reading that should fire a
   * single-reading-informational alert if no second reading arrives?" — i.e.
   * the only sibling-free, non-AFib, post-Day-3 case. Used by:
   *  - `computePendingSecondReading` (create-time frontend hint),
   *  - the server-side session-finalize cron (SessionFinalizeService),
   * so the rule lives in exactly one place. AFib (own ≥3 gate) and Pre-Day-3
   * (rules already fire on a single reading) are excluded.
   */
  async shouldFinalizeAsSingleReading(
    userId: string,
    entry: { id: string; sessionId: string | null; measuredAt: Date },
  ): Promise<boolean> {
    const PRE_DAY_3_THRESHOLD = 7
    const windowStart = new Date(entry.measuredAt.getTime() - SESSION_WINDOW_MS)
    const windowEnd = new Date(entry.measuredAt.getTime() + SESSION_WINDOW_MS)

    const [siblingCount, profile, lifetimeReadingCount] = await Promise.all([
      this.prisma.journalEntry.count({
        where: {
          userId,
          id: { not: entry.id },
          measuredAt: { gte: windowStart, lte: windowEnd },
          ...(entry.sessionId ? { sessionId: entry.sessionId } : { sessionId: null }),
        },
      }),
      this.prisma.patientProfile
        .findUnique({ where: { userId }, select: { hasAFib: true } })
        .catch(() => null),
      this.prisma.journalEntry.count({ where: { userId } }),
    ])

    if (siblingCount > 0) return false
    if (profile?.hasAFib) return false
    if (lifetimeReadingCount < PRE_DAY_3_THRESHOLD) return false
    return true
  }

  /**
   * Resolve the sessionId a new reading should actually be persisted with.
   * A client-supplied sessionId is honoured for a fresh session (no existing
   * members) or one still inside the window; an expired/stale id is dropped to
   * null (with a log) so it can't average readings taken hours apart. Returns
   * null when no id was supplied.
   */
  private async resolveCreateSessionId(
    userId: string,
    sessionId: string | undefined,
    measuredAt: Date,
  ): Promise<string> {
    // #91 — a JournalEntry MUST always carry a sessionId. This previously
    // returned null when no id was supplied OR when the supplied id was stale
    // (window elapsed), leaving orphaned null-session readings that the
    // SessionAverager / AFib ≥3-reading gate couldn't group reliably. Now it
    // resolves to a usable session in every case (never null):
    //   • valid client id still inside the window → keep it (join the session)
    //   • no id / stale id → JOIN the patient's open in-window session if one
    //     exists (preserves proximity averaging for clients that don't pass an
    //     id), else MINT a fresh UUID so the reading anchors its own session.
    if (sessionId) {
      const newest = await this.prisma.journalEntry.findFirst({
        where: { userId, sessionId },
        orderBy: { measuredAt: 'desc' },
        select: { measuredAt: true },
      })
      // Fresh session — this reading establishes it; keep the id.
      if (!newest) return sessionId
      const gapMs = Math.abs(measuredAt.getTime() - newest.measuredAt.getTime())
      if (gapMs <= SESSION_WINDOW_MS) return sessionId
      // Window elapsed → don't smuggle this reading into the stale session.
      this.logger.warn(
        `create: supplied sessionId ${sessionId} is stale for user ${userId} ` +
          `(gap ${Math.round(gapMs / 60000)}min exceeds session window); starting a new session`,
      )
    }
    // No usable client id — join an open, non-finalized session within the
    // window if the patient has one, else mint a fresh UUID. Never null.
    const windowStart = new Date(measuredAt.getTime() - SESSION_WINDOW_MS)
    const windowEnd = new Date(measuredAt.getTime() + SESSION_WINDOW_MS)
    const openInWindow = await this.prisma.journalEntry.findFirst({
      where: {
        userId,
        sessionId: { not: null },
        singleReadingFinalized: false,
        measuredAt: { gte: windowStart, lte: windowEnd },
      },
      orderBy: { measuredAt: 'desc' },
      select: { sessionId: true },
    })
    return openInWindow?.sessionId ?? randomUUID()
  }

  /**
   * Bug 25 — when the patient edits an existing entry's measurement_time, the
   * session_id must be re-evaluated against the new time. Pre-fix, `update()`
   * mutated `measuredAt` but left `sessionId` untouched. Two failure modes:
   *
   *   1. Entry moves AWAY from its current session's siblings: stays glued
   *      to a stale session_id whose other members are now > 5 min away.
   *      The averaging window already prevents data corruption (sibling
   *      lookup bounds by measuredAt too), but the session_id is misleading
   *      and the UI groups them visually as one session.
   *
   *   2. Entry moves INTO another session's window: stays in its lone /
   *      stale session and is never grouped with what the clinical spec
   *      ("readings within 5 min average together") says should be its
   *      new session-mates.
   *
   * Resolution policy:
   *   • Caller explicitly passed dto.sessionId → respect it (LLM move).
   *     Handled by the caller; this helper is only invoked when sessionId
   *     was NOT explicitly set.
   *   • New time falls within ±5 min of a sibling sharing the CURRENT
   *     session_id (excluding self) → keep current session_id. (Still
   *     grouped with our originals.)
   *   • New time falls within ±5 min of a DIFFERENT-session entry → adopt
   *     the newest such entry's session_id. (Join their session.)
   *   • New time is not within ±5 min of any other entry → if current
   *     session has other siblings, mint a fresh UUID (we're leaving);
   *     else keep current session_id (we were alone — nothing to regroup).
   */
  /**
   * Bug 41 — strip fields from a Prisma update payload when the new value
   * equals the existing value, so the LLM/patient gets a clean "no changes"
   * response when they ask to edit a reading to its current value (instead
   * of a successful but meaningless DB round-trip + an "updated" message
   * that confuses them). Side-effect supports Bug 42 — the gated
   * resolveUpdateSessionId call only fires when data.measuredAt actually
   * survives this filter, preventing spurious session-id churn.
   *
   * Mutates `data` in place. Compares the common-path fields the LLM
   * touches on edit: measuredAt (millisecond compare), numeric BP/pulse,
   * weight (Decimal → number compare), position, sessionId, medication
   * flags, structured symptom booleans, source, notes, and the freeform
   * otherSymptoms array (set-equality, order-irrelevant).
   *
   * Complex JSON fields (measurementConditions, missedMedications,
   * medicationStatuses, sourceMetadata) are NOT compared — they're rare
   * on LLM-edits AND their deep-equality is expensive + error-prone. If
   * present in `data` they pass through to Prisma unchanged; in practice
   * the LLM doesn't re-issue them without intent.
   */
  private filterNoOpFieldsInPlace(
    data: Prisma.JournalEntryUpdateInput,
    existing: {
      measuredAt: Date | string
      systolicBP: number | null
      diastolicBP: number | null
      pulse: number | null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      weight: any
      position: string | null
      sessionId: string | null
      medicationTaken: boolean | null
      medicationScheduledLater: boolean | null
      missedDoses: number | null
      severeHeadache: boolean
      visualChanges: boolean
      alteredMentalStatus: boolean
      chestPainOrDyspnea: boolean
      focalNeuroDeficit: boolean
      severeEpigastricPain: boolean
      newOnsetHeadache: boolean
      ruqPain: boolean
      edema: boolean
      dizziness: boolean
      syncope: boolean
      palpitations: boolean
      legSwelling: boolean
      fatigue: boolean
      shortnessOfBreath: boolean
      dryCough: boolean
      nsaidUse: boolean
      faceSwelling: boolean
      throatTightness: boolean
      otherSymptoms: string[]
      teachBackAnswer: string | null
      teachBackCorrect: boolean | null
      notes: string | null
      source: string | null
    },
  ): void {
    // measuredAt — millisecond equality. Avoids a regroup when LLM re-set
    // time to its current value.
    if (data.measuredAt !== undefined) {
      const newMs = (data.measuredAt as Date).getTime?.()
      const existingMs =
        existing.measuredAt instanceof Date
          ? existing.measuredAt.getTime()
          : new Date(existing.measuredAt).getTime()
      if (newMs === existingMs) delete data.measuredAt
    }
    // Numeric scalars.
    if (data.systolicBP !== undefined && data.systolicBP === existing.systolicBP)
      delete data.systolicBP
    if (data.diastolicBP !== undefined && data.diastolicBP === existing.diastolicBP)
      delete data.diastolicBP
    if (data.pulse !== undefined && data.pulse === existing.pulse) delete data.pulse
    // Weight is Decimal in storage — compare via Number().
    if (data.weight !== undefined) {
      const newW = data.weight === null ? null : Number(data.weight)
      const existingW =
        existing.weight === null || existing.weight === undefined
          ? null
          : Number(existing.weight)
      if (newW === existingW) delete data.weight
    }
    if (data.position !== undefined && data.position === existing.position)
      delete data.position
    if (data.sessionId !== undefined && data.sessionId === existing.sessionId)
      delete data.sessionId
    // Medication flags.
    if (data.medicationTaken !== undefined && data.medicationTaken === existing.medicationTaken)
      delete data.medicationTaken
    if (
      data.medicationScheduledLater !== undefined &&
      data.medicationScheduledLater === existing.medicationScheduledLater
    )
      delete data.medicationScheduledLater
    if (data.missedDoses !== undefined && data.missedDoses === existing.missedDoses)
      delete data.missedDoses
    // Structured symptom booleans (Flow B + Cluster 6/7/8).
    const symptomBools: Array<
      keyof Prisma.JournalEntryUpdateInput & keyof typeof existing
    > = [
      'severeHeadache',
      'visualChanges',
      'alteredMentalStatus',
      'chestPainOrDyspnea',
      'focalNeuroDeficit',
      'severeEpigastricPain',
      'newOnsetHeadache',
      'ruqPain',
      'edema',
      'dizziness',
      'syncope',
      'palpitations',
      'legSwelling',
      'fatigue',
      'shortnessOfBreath',
      'dryCough',
      'nsaidUse',
      'faceSwelling',
      'throatTightness',
    ]
    for (const k of symptomBools) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (data[k] !== undefined && (data as any)[k] === (existing as any)[k]) {
        delete data[k]
      }
    }
    // otherSymptoms — set equality, order-irrelevant.
    if (Array.isArray(data.otherSymptoms)) {
      const newSet = new Set(data.otherSymptoms as string[])
      const existingSet = new Set(existing.otherSymptoms ?? [])
      if (
        newSet.size === existingSet.size &&
        [...newSet].every((s) => existingSet.has(s))
      ) {
        delete data.otherSymptoms
      }
    }
    if (data.teachBackAnswer !== undefined && data.teachBackAnswer === existing.teachBackAnswer)
      delete data.teachBackAnswer
    if (
      data.teachBackCorrect !== undefined &&
      data.teachBackCorrect === existing.teachBackCorrect
    )
      delete data.teachBackCorrect
    if (data.notes !== undefined && data.notes === existing.notes) delete data.notes
    if (data.source !== undefined && data.source === existing.source) delete data.source
  }

  private async resolveUpdateSessionId(
    userId: string,
    entryId: string,
    currentSessionId: string | null,
    newMeasuredAt: Date,
  ): Promise<string> {
    const windowStart = new Date(newMeasuredAt.getTime() - SESSION_WINDOW_MS)
    const windowEnd = new Date(newMeasuredAt.getTime() + SESSION_WINDOW_MS)

    // Any sibling in our CURRENT session (other than us) still within the
    // new window? If yes, stay put — we're still grouped with our originals.
    if (currentSessionId) {
      const stillNearOriginalSibling =
        await this.prisma.journalEntry.findFirst({
          where: {
            userId,
            sessionId: currentSessionId,
            id: { not: entryId },
            measuredAt: { gte: windowStart, lte: windowEnd },
          },
          select: { id: true },
        })
      if (stillNearOriginalSibling) return currentSessionId
    }

    // No sibling-in-original-session match. Look for a different-session
    // entry within the window — we should join it. AND-stacking the two
    // sessionId constraints because Prisma's field-level filter takes
    // exactly one `not`; layering needs explicit AND.
    const otherSessionInWindow = await this.prisma.journalEntry.findFirst({
      where: {
        userId,
        id: { not: entryId },
        singleReadingFinalized: false,
        measuredAt: { gte: windowStart, lte: windowEnd },
        AND: [
          { sessionId: { not: null } },
          ...(currentSessionId ? [{ sessionId: { not: currentSessionId } }] : []),
        ],
      },
      orderBy: { measuredAt: 'desc' },
      select: { sessionId: true },
    })
    if (otherSessionInWindow?.sessionId) return otherSessionInWindow.sessionId

    // Nothing within ±5 min. If our original session has other members
    // (we're leaving them behind), mint a fresh id. Otherwise we were
    // alone in our session — keep the id so we don't churn the UUID.
    if (currentSessionId) {
      const originalSibling = await this.prisma.journalEntry.findFirst({
        where: {
          userId,
          sessionId: currentSessionId,
          id: { not: entryId },
        },
        select: { id: true },
      })
      if (originalSibling) return randomUUID()
      return currentSessionId
    }
    // No current session id (rare — pre-#91 data) — mint one.
    return randomUUID()
  }

  /**
   * Returns the patient's currently OPEN reading session, or null. "Open" =
   * the latest reading is within SESSION_WINDOW_MS of `now` AND the session
   * hasn't been finalized as single-reading. Reads server state so it catches
   * sessions opened by ANY path (form / voice / chat), not just the form.
   * Drives the patient app's "add to this session or start new?" prompt.
   */
  async getActiveSession(
    userId: string,
    now: Date = new Date(),
  ): Promise<{
    sessionId: string | null
    openedAt: string
    lastReadingAt: string
    readingCount: number
    expiresAt: string
    requiresMoreReadings: boolean
  } | null> {
    const PRE_DAY_3_THRESHOLD = 7

    const latest = await this.prisma.journalEntry.findFirst({
      where: { userId },
      orderBy: { measuredAt: 'desc' },
      select: {
        id: true,
        sessionId: true,
        measuredAt: true,
        singleReadingFinalized: true,
      },
    })
    if (!latest) return null
    // Expired — last reading older than the window.
    if (now.getTime() - latest.measuredAt.getTime() > SESSION_WINDOW_MS) return null
    // Closed — single-reading already finalized; its alert has fired.
    if (latest.singleReadingFinalized) return null

    // Resolve the session group exactly like SessionAverager.loadSessionSiblings.
    const windowStart = new Date(latest.measuredAt.getTime() - SESSION_WINDOW_MS)
    const windowEnd = new Date(latest.measuredAt.getTime() + SESSION_WINDOW_MS)
    const members = await this.prisma.journalEntry.findMany({
      where: {
        userId,
        measuredAt: { gte: windowStart, lte: windowEnd },
        ...(latest.sessionId ? { sessionId: latest.sessionId } : { sessionId: null }),
      },
      orderBy: { measuredAt: 'asc' },
      select: { measuredAt: true },
    })
    if (members.length === 0) return null

    const readingCount = members.length
    const openedAt = members[0].measuredAt
    const lastReadingAt = members[members.length - 1].measuredAt
    const expiresAt = new Date(lastReadingAt.getTime() + SESSION_WINDOW_MS)

    const [profile, lifetimeReadingCount] = await Promise.all([
      this.prisma.patientProfile
        .findUnique({ where: { userId }, select: { hasAFib: true } })
        .catch(() => null),
      this.prisma.journalEntry.count({ where: { userId } }),
    ])
    const hasAFib = profile?.hasAFib ?? false
    const preDay3 = lifetimeReadingCount < PRE_DAY_3_THRESHOLD
    // Mirror the engine gates: AFib needs ≥3, other non-emergency tiers need
    // ≥2; Pre-Day-3 fires on a single reading so nothing more is required.
    const requiresMoreReadings = hasAFib
      ? readingCount < 3
      : !preDay3 && readingCount < 2

    return {
      sessionId: latest.sessionId,
      openedAt: openedAt.toISOString(),
      lastReadingAt: lastReadingAt.toISOString(),
      readingCount,
      expiresAt: expiresAt.toISOString(),
      requiresMoreReadings,
    }
  }

  private async resolveMissedMedications(
    userId: string,
    raw: unknown,
  ): Promise<
    Array<{
      medicationId: string
      drugName: string
      drugClass: string
      reason: string
      missedDoses: number
    }> | undefined
  > {
    if (!Array.isArray(raw) || raw.length === 0) return undefined
    const resolved: Array<{
      medicationId: string
      drugName: string
      drugClass: string
      reason: string
      missedDoses: number
    }> = []
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>
      const drugName = typeof r.drugName === 'string' ? r.drugName.trim() : ''
      const reason = typeof r.reason === 'string' ? r.reason.trim().toUpperCase() : ''
      if (!drugName || !reason) continue
      const dosesRaw = typeof r.missedDoses === 'number' ? r.missedDoses : 1
      const missedDoses = Math.min(10, Math.max(1, Math.round(dosesRaw)))

      // If the client gave us a medicationId, trust it but still verify it
      // belongs to the patient + isn't AS_NEEDED.
      const explicitId = typeof r.medicationId === 'string' ? r.medicationId : null
      const med = explicitId
        ? await this.prisma.patientMedication.findFirst({
            where: { id: explicitId, userId, discontinuedAt: null },
            select: { id: true, drugName: true, drugClass: true, frequency: true },
          })
        : await this.prisma.patientMedication.findFirst({
            where: {
              userId,
              discontinuedAt: null,
              drugName: { contains: drugName, mode: 'insensitive' },
            },
            orderBy: { reportedAt: 'desc' },
            select: { id: true, drugName: true, drugClass: true, frequency: true },
          })
      if (!med) continue
      if (med.frequency === 'AS_NEEDED') continue

      resolved.push({
        medicationId: med.id,
        drugName: med.drugName,
        drugClass: med.drugClass,
        reason,
        missedDoses,
      })
    }
    return resolved.length > 0 ? resolved : undefined
  }
}
