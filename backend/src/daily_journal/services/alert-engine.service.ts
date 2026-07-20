import { Injectable, Logger } from '@nestjs/common'
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter'
import { ClsService } from 'nestjs-cls'
import {
  ProfileNotFoundException,
  RULE_IDS,
  getPulsePressure,
  type ResolvedContext,
} from '@cardioplace/shared'
import { Prisma } from '../../generated/prisma/client.js'
import { withDeadlockRetry } from '../../common/deadlock-retry.js'
import { runAsCronActor } from '../../common/cls/cron-actor.util.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { JOURNAL_EVENTS } from '../constants/events.js'
import type {
  JournalEntryCreatedEvent,
  JournalEntryEvaluatedEvent,
  JournalEntryUpdatedEvent,
} from '../interfaces/events.interface.js'
import type { RuleFunction, RuleResult, SessionAverage, SessionSymptoms } from '../engine/types.js'

const EMPTY_SESSION_SYMPTOMS: SessionSymptoms = {
  severeHeadache: false,
  visualChanges: false,
  alteredMentalStatus: false,
  chestPainOrDyspnea: false,
  focalNeuroDeficit: false,
  severeEpigastricPain: false,
  newOnsetHeadache: false,
  ruqPain: false,
  edema: false,
  dizziness: false,
  syncope: false,
  palpitations: false,
  legSwelling: false,
  fatigue: false,
  shortnessOfBreath: false,
  dryCough: false,
  nsaidUse: false,
  faceSwelling: false,
  throatTightness: false,
  otherSymptoms: [],
}
import { OutputGeneratorService } from './output-generator.service.js'
import { ProfileResolverService } from './profile-resolver.service.js'
import { SessionAveragerService } from './session-averager.service.js'
import {
  ndhpHfrefRule,
  pregnancyAceArbRule,
} from '../engine/contraindications.js'
import {
  symptomOverrideGeneralRule,
  symptomOverridePregnancyRule,
} from '../engine/symptom-override.js'
import { angioedemaRule } from '../engine/angioedema.js'
import { absoluteEmergencyRule } from '../engine/absolute-emergency.js'
import { decideOptionDOutcome } from '../engine/option-d.js'
import {
  pregnancyL1HighRule,
  pregnancyL2Rule,
} from '../engine/pregnancy-thresholds.js'
import {
  aorticStenosisRule,
  cadDbpRule,
  cadDbpHighRule,
  cadDefaultUpper,
  cadHighRule,
  dcmRule,
  dhpCcbLegSwellingRule,
  getCadHtnUncontrolledAnnotation,
  hcmRule,
  hcmVasodilatorRule,
  hfDecompensationRule,
  hfpefRule,
  hfrefRule,
} from '../engine/condition-branches.js'
import {
  aceCoughRule,
  afibPalpitationsRule,
  betaBlockerDizzinessRule,
  betaBlockerFatigueRule,
  betaBlockerSobHfRule,
  betaBlockerSobNonHfRule,
  hfCaregiverEdemaRule,
  nsaidAntihypertensiveRule,
  orthostaticHypotensionRule,
  palpitationsGeneralRule,
  syncopeGeneralRule,
  tachyPalpitationsRule,
} from '../engine/symptom-rules.js'
import {
  personalizedHighRule,
  personalizedLowRule,
} from '../engine/personalized.js'
import {
  standardL1HighRule,
  standardL1LowRule,
} from '../engine/standard.js'
import {
  afibHrRule,
  bradyAbsoluteRule,
  bradySurveillanceRuleWithWindow,
  bradySymptomaticRule,
  buildTachyRule,
  getHrContextAnnotation,
  tachySevereRule,
} from '../engine/hr-branches.js'
import {
  getWidePulsePressureAnnotation,
  getNarrowPulsePressureAnnotation,
  pulsePressureWideRule,
  pulsePressureNarrowRule,
} from '../engine/pulse-pressure.js'
import {
  getLoopDiureticAnnotation,
  loopDiureticHypotensionRule,
} from '../engine/loop-diuretic.js'
import {
  firstMonthAdherenceNudge,
  medicationMissedRuleWithWindow,
} from '../engine/adherence.js'
import { loadAdherenceWindow } from '../engine/adherence-window.js'
import { loadBradyPatternWindow } from '../engine/hr-pattern-window.js'

/**
 * Phase/5 AlertEngineService — the single owner of rule evaluation.
 *
 * Pipeline (multi-axis emission — phase/26 fix to §1.1+§4.3 co-fire bug):
 *
 *   Stage A — pre-gate (terminal, single alert):
 *     pregnancyAceArb / ndhpHfref / symptomOverridePregnancy / symptomOverrideGeneral
 *     ← these run even for AFib <3 readings (don't depend on averaged vitals)
 *
 *   AFib ≥3-reading gate (CLINICAL_SPEC §4.4) — bails here if AFib patient
 *   has fewer than 3 readings in the session.
 *
 *   Stage B — emergency (terminal, single alert):
 *     absoluteEmergency / pregnancyL2
 *
 *   Stage C — multi-axis accumulation (one alert per axis):
 *     bp-high  : pregnancyL1High, dcm/hfref/hfpef/hcm (high arm), cadHigh,
 *                personalizedHigh, standardL1High
 *     sbp-low  : dcm/hfref/hfpef/hcm (low arm), personalizedLow, standardL1Low
 *                (suppressed by HF/HCM/DCM if those rules already claimed sbp-low —
 *                they iterate first per spec: condition rules REPLACE standard)
 *     dbp-low  : cadDbp (the only DBP-axis rule per CLINICAL_SPEC §4.3)
 *     info     : hcm vasodilator branch (Tier 3)
 *     hr       : afib / tachy / brady
 *
 *   Stage D — info fallback (only if Stage C empty):
 *     loopDiureticHypotension / pulsePressureWide
 *
 *   Multiple DeviationAlert rows can be written per call — phase/7 dropped the
 *   @@unique([journalEntryId, type]) and dedup is now (journalEntryId, ruleId).
 *   Pulse-pressure + loop-diuretic ride as annotations on the highest-tier
 *   primary result when not standalone (preserves Scenario 15). Three-tier
 *   messages come from OutputGenerator (per-result, stateless).
 */
type Axis =
  // Cluster 8 — ACE-angioedema airway emergency. Highest priority: a
  // potential airway obstruction outranks every BP/contraindication row.
  | 'angioedema'
  | 'contraindication'
  | 'emergency'
  | 'bp-high'
  // Cluster 8 Q2 — CAD DBP-high is its own axis so it co-fires with the
  // SBP bp-high row (the "second independent alert trigger").
  | 'dbp-high'
  | 'sbp-low'
  | 'dbp-low'
  | 'hr'
  | 'hf-decomp'
  | 'palpitations'
  | 'orthostatic'
  | 'syncope'
  | 'med-side-effect'
  // Cluster 7 — each Appendix A rule lives on its own axis so they
  // coexist with BP / HR / other med-side-effect rows on the same reading.
  | 'med-fatigue'
  | 'med-sob'
  | 'med-interaction'
  | 'med-cough'
  | 'hf-caregiver-edema'
  // Cluster 8 Q1 — asymptomatic-bradycardia surveillance chart event.
  | 'brady-surveillance'
  | 'info'

const AXIS_PRIORITY: Axis[] = [
  'angioedema',
  'emergency',
  'contraindication',
  'bp-high',
  'dbp-high',
  'sbp-low',
  'dbp-low',
  'hr',
  'hf-decomp',
  'orthostatic',
  'palpitations',
  'syncope',
  'med-side-effect',
  'med-fatigue',
  'med-sob',
  'med-interaction',
  'med-cough',
  'hf-caregiver-edema',
  'brady-surveillance',
  'info',
]

function axisFor(r: RuleResult): Axis {
  // Cluster 8 — angioedema claims its own axis ahead of everything so the
  // airway-emergency row coexists with (and outranks) any BP/HR row.
  if (r.tier === 'TIER_1_ANGIOEDEMA') return 'angioedema'
  if (r.tier === 'TIER_1_CONTRAINDICATION') return 'contraindication'
  if (r.tier === 'BP_LEVEL_2' || r.tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') return 'emergency'
  // HCM vasodilator is Tier 3, not a high/low axis claimant — let HCM_LOW
  // still fire on sbp-low for the same patient (§4.6).
  if (r.ruleId === 'RULE_HCM_VASODILATOR') return 'info'
  if (r.ruleId === 'RULE_CAD_DBP_CRITICAL') return 'dbp-low'
  // Cluster 8 Q2 — CAD DBP-high emits BP_LEVEL_1_HIGH but claims its own
  // axis so it co-fires with the SBP cadHighRule 'bp-high' row.
  if (r.ruleId === 'RULE_CAD_DBP_HIGH') return 'dbp-high'
  // HR rules emit BP_LEVEL_1_HIGH / LOW tiers but represent a different axis.
  // N-7 (2026-07-14 triage) — RULE_BRADY_HR_ASYMPTOMATIC removed from this
  // branch; superseded by RULE_BRADY_ABSOLUTE (Manisha 2026-05-10 Cluster 6).
  if (
    r.ruleId === 'RULE_AFIB_HR_HIGH' ||
    r.ruleId === 'RULE_AFIB_HR_LOW' ||
    r.ruleId === 'RULE_TACHY_HR' ||
    r.ruleId === 'RULE_BRADY_HR_SYMPTOMATIC'
  ) {
    return 'hr'
  }
  // Cluster 8 Q1 — surveillance on its own axis so the (Tier 3 / escalated
  // Tier 2) chart event coexists with any BP/HR row on the same reading.
  if (r.ruleId === 'RULE_BRADY_SURVEILLANCE') return 'brady-surveillance'
  // Cluster 6 — each new rule lives on its own axis so they coexist with
  // whatever BP/HR row also fires on the same reading.
  if (r.ruleId === 'RULE_HF_DECOMPENSATION') return 'hf-decomp'
  if (r.ruleId === 'RULE_ORTHOSTATIC_HYPOTENSION') return 'orthostatic'
  if (
    r.ruleId === 'RULE_AFIB_PALPITATIONS' ||
    r.ruleId === 'RULE_TACHY_WITH_PALPITATIONS' ||
    r.ruleId === 'RULE_PALPITATIONS_GENERAL'
  ) {
    return 'palpitations'
  }
  if (r.ruleId === 'RULE_SYNCOPE_GENERAL') return 'syncope'
  if (
    r.ruleId === 'RULE_DHP_CCB_LEG_SWELLING' ||
    r.ruleId === 'RULE_BETA_BLOCKER_DIZZINESS'
  ) {
    return 'med-side-effect'
  }
  // Cluster 7 — Appendix A side-effect / interaction axes.
  if (r.ruleId === 'RULE_BETA_BLOCKER_FATIGUE') return 'med-fatigue'
  if (
    r.ruleId === 'RULE_BETA_BLOCKER_SOB_HF' ||
    r.ruleId === 'RULE_BETA_BLOCKER_SOB_NON_HF'
  ) {
    return 'med-sob'
  }
  if (r.ruleId === 'RULE_NSAID_ANTIHTN_INTERACTION') return 'med-interaction'
  if (r.ruleId === 'RULE_ACE_COUGH') return 'med-cough'
  if (r.ruleId === 'RULE_HF_CAREGIVER_EDEMA') return 'hf-caregiver-edema'
  if (r.tier === 'BP_LEVEL_1_LOW') return 'sbp-low'
  if (r.tier === 'BP_LEVEL_1_HIGH') return 'bp-high'
  return 'info'
}
@Injectable()
export class AlertEngineService {
  private readonly logger = new Logger(AlertEngineService.name)

  // AFib ≥3-reading gate per CLINICAL_SPEC §4.4.
  private static readonly AFIB_MIN_READINGS = 3

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly profileResolver: ProfileResolverService,
    private readonly sessionAverager: SessionAveragerService,
    private readonly outputGenerator: OutputGeneratorService,
    private readonly cls: ClsService,
  ) {}

  // The @OnEvent handlers fire from inside the patient's journal-submit request,
  // whose CLS actor is the PATIENT. Left as-is, the engine's DeviationAlert
  // writes would be audited as the patient authoring their own alert. The
  // engine's judgment is system-authored (Epic In Basket / Cerner norm: patient
  // action → JournalEntry; engine verdict → DeviationAlert), so we open a fresh
  // SYSTEM_ACTOR context labelled 'engine-alert-generator' for the handler body.
  // Only the handlers are wrapped — direct callers of evaluate() (tests, ops
  // tooling) keep whatever CLS context they set up.
  @OnEvent(JOURNAL_EVENTS.ENTRY_CREATED, { async: true })
  async handleEntryCreated(payload: JournalEntryCreatedEvent) {
    await runAsCronActor(this.cls, 'engine-alert-generator', async () => {
      // Track whether evaluate() threw so ENTRY_EVALUATED's `alertsFired`
      // defaults to `true` on failure — a "we don't know" outcome must never
      // surface "Looking good" to the patient (Gap 1 fix, 2026-07-13).
      let evaluationFailed = false
      try {
        await this.evaluate(payload.entryId)
      } catch (err) {
        evaluationFailed = true
        this.logEvaluationError(payload.entryId, err)
      }

      // Count DeviationAlert rows this entry produced and emit ENTRY_EVALUATED
      // with the verdict. (L-6, 2026-07-14 — the logged-confirmation listener
      // that consumed this was removed; the "Looking good" confirmation is now
      // an in-app success screen. The event is retained for any future
      // post-evaluation consumer and is harmless with zero listeners.) By this
      // point evaluate() has awaited every persistAlert transaction (see
      // withDeadlockRetry + prisma.$transaction inside persistAlert), so all
      // committed rows are visible to the count. Wrapped in try/catch so a
      // count failure never breaks the engine's happy path.
      let alertCount = 0
      try {
        alertCount = await this.prisma.deviationAlert.count({
          where: { journalEntryId: payload.entryId },
        })
      } catch (err) {
        // Preserve the safety invariant: unknown → assume alerts fired.
        this.logger.error(
          `ENTRY_EVALUATED: deviationAlert.count failed for entry=${payload.entryId}`,
          err instanceof Error ? err.stack : String(err),
        )
        alertCount = 1
      }
      const evaluatedPayload: JournalEntryEvaluatedEvent = {
        ...payload,
        alertsFired: evaluationFailed || alertCount > 0,
        alertCount,
      }
      this.eventEmitter.emit(JOURNAL_EVENTS.ENTRY_EVALUATED, evaluatedPayload)
    })
  }

  // Signed CTO 2026-06-09 "no re-trigger" policy (Manisha 2026-06-12 Q2 "we
  // cannot un-page"): the engine MUST NOT re-evaluate on a patient EDIT/DELETE
  // (ENTRY_UPDATED). It subscribes ONLY to ENTRY_FINALIZED — the FIRST
  // evaluation of a previously-HELD reading (Cluster 6 Q2 single-reading
  // finalize + Option D UNCONFIRMED finalize). A patient editing a fired
  // reading no longer flips/double-fires its alert; the corrected value rides
  // into the next new entry's evaluation batch (e.g. session averaging).
  @OnEvent(JOURNAL_EVENTS.ENTRY_FINALIZED, { async: true })
  async handleEntryFinalized(payload: JournalEntryUpdatedEvent) {
    await runAsCronActor(this.cls, 'engine-alert-generator', async () => {
      await this.evaluate(payload.entryId).catch((err) =>
        this.logEvaluationError(payload.entryId, err),
      )
    })
  }

  /**
   * Evaluate a single JournalEntry. Public so tests + ops tooling can call.
   *
   * Runs two independent passes against the same session:
   *   Pass 1 — Multi-axis BP/HR pipeline (one alert per clinical axis).
   *   Pass 2 — Medication-adherence rule (fires if the session reports any
   *            missed dose). Runs regardless of Pass 1.
   *
   * Both passes can persist multiple DeviationAlert rows on one entry; dedup
   * is keyed on `(journalEntryId, ruleId)` (phase/7 dropped the legacy type-
   * uniqueness constraint).
   *
   * The return value preserves the legacy "primary result" shape for callers
   * that expect one RuleResult — highest-tier BP/HR wins if fired, else
   * adherence, else null. The persist order is sorted by AXIS_PRIORITY so
   * `prisma.deviationAlert.create.mock.calls[0]` stays the highest-tier row,
   * keeping Scenario 62-style positional assertions stable.
   */
  async evaluate(entryId: string): Promise<RuleResult | null> {
    const session = await this.sessionAverager.averageForEntry(entryId)
    if (!session) return null

    // Manisha Backdated Readings sign-off 2026-06-06 (Chunk B fix-up) — the
    // signed dual-gate framework. See docs/clinical-signoffs/
    // MANISHA_2026_06_06_OPEN_DECISIONS_AND_BACKDATING_SIGNOFF.md.
    //
    // Gate B (time-window): a HISTORICAL_ENTRY reading (logged ≥24h after
    // measurement) fires NO alerts of ANY tier — the data is too stale to
    // support real-time action; it persists for trend analysis only. (The
    // original Chunk B dropped only BP Level 2; the signed policy suppresses
    // every tier, so this early-return covers all four passes below.)
    if (session.delayBand === 'HISTORICAL_ENTRY') {
      return null
    }

    // Gate A (structural "is new latest?"): if ANY entry for this user has a
    // strictly later measuredAt, this entry is a backfill — the later reading
    // already represents the patient's current state, so no alerts fire (any
    // tier); the data persists. Comparing against session.measuredAt (= MAX
    // of the session siblings' measuredAt) means same-session siblings can
    // never suppress each other: they all have measuredAt <= the session max,
    // so the strict `gt` excludes them without id-exclusion gymnastics. Ties
    // pass (the (journalEntryId, ruleId) dedup guards double-fires). Cheap —
    // hits the (userId, measuredAt) index. The POST response mirrors this
    // signal via `alertsSuppressedReason` (daily_journal.service.ts) computed
    // at create time; a newer entry landing between create and this event can
    // only flip toward suppression (the safe direction).
    const newerEntry = await this.prisma.journalEntry.findFirst({
      where: {
        userId: session.userId,
        measuredAt: { gt: session.measuredAt },
      },
      select: { id: true },
    })
    if (newerEntry) {
      return null
    }

    let ctx: ResolvedContext
    try {
      ctx = await this.profileResolver.resolve(session.userId, session.measuredAt)
    } catch (err) {
      if (err instanceof ProfileNotFoundException) {
        this.logger.log(
          `Skipping entry ${entryId} — user ${session.userId} has no PatientProfile.`,
        )
        return null
      }
      throw err
    }

    // Cross-session "prior reading pulse elevated" flag — used by tachyRule
    // (Stage C) AND by the HR-context annotation when terminal-stage rules
    // preempt Stage C. Computed once here so we don't re-query the DB.
    const priorElevated = await this.wasPriorReadingPulseElevated(session, ctx)

    // Cluster 6 — one Prisma read for prior weight + prior SBP. Drives the
    // HF-decompensation weight-delta + orthostatic-hypotension SBP-drop
    // predicates. Cheap (single row lookup on the indexed (userId, measuredAt)
    // pair) and the same row covers both fields.
    await this.attachPriorReading(session)

    // Pass 1 — multi-axis BP/HR pipeline. HISTORICAL_ENTRY + Gate A failures
    // never reach here (suppressed at engine entry above). DELAYED_ENTRY
    // (1h–<24h) keeps every alert but renders with the 911 CTA suppressed,
    // the signed L2 physician delayed-entry wording, and the L1 provider-only
    // disclaimer — all via ctx.delayBand in the message layer, no engine
    // change (Chunk B fix-up).
    const bpResults = await this.runPipeline(session, ctx, priorElevated)
    const primary = bpResults[0] ?? null
    // HR-context annotation (added below in addPhysicianAnnotations) was a
    // workaround for the old terminal-stage pattern where Stage C never ran.
    // With co-fire, an HR-axis row may already be in bpResults — skip the
    // annotation to avoid double-surfacing the same finding.
    const hasHrRow = bpResults.some((r) => axisFor(r) === 'hr')
    if (primary)
      this.addPhysicianAnnotations(primary, session, ctx, priorElevated, hasHrRow)
    for (const r of bpResults) {
      await this.persistAlert(session, ctx, r)
    }

    // Pass 2 — Adherence pipeline (independent of Pass 1). Pre-computes a
    // rolling 3-day / 7-day window so the rule can fire on a non-adherence
    // PATTERN, not a single miss. Carves out beta-blockers for HFrEF/HCM/
    // AFib patients where even a single miss is hemodynamically risky.
    const adherenceWindow = await loadAdherenceWindow(
      this.prisma,
      session.userId,
      session.measuredAt,
      ctx.timezone ?? 'America/New_York',
    )
    const adherenceResult = medicationMissedRuleWithWindow(adherenceWindow)(session, ctx)
    if (adherenceResult) {
      await this.persistAlert(session, ctx, adherenceResult)
    }

    // Pass 3 — Cluster 8 Q1 asymptomatic-bradycardia surveillance.
    // Independent pass (mirrors the adherence pattern): pre-computes the
    // consecutive ≤45 bpm session run so the rule can escalate Tier 3 →
    // Tier 2 on a sustained pattern. persistAlert dedups by
    // (journalEntryId, ruleId) so this coexists with any Stage C row.
    const bradyWindow = await loadBradyPatternWindow(
      this.prisma,
      session.userId,
      session.measuredAt,
      ctx.timezone ?? 'America/New_York',
    )
    const bradySurveillanceResult = bradySurveillanceRuleWithWindow(
      bradyWindow.consecutiveSessionsLe45,
    )(session, ctx)
    if (bradySurveillanceResult) {
      await this.persistAlert(session, ctx, bradySurveillanceResult)
    }

    // Pass 4 — Cluster 8 Q3 first-month educational adherence nudge.
    // One-time per patient ever: only fires when NO prior nudge alert
    // exists for the user (mirrors the CAD-ramp one-time-notice guard).
    // Reuses the adherence window — no extra query.
    const nudgeResult = firstMonthAdherenceNudge(adherenceWindow)(session, ctx)
    if (nudgeResult) {
      const priorNudges = await this.prisma.deviationAlert.count({
        where: {
          userId: session.userId,
          ruleId: 'RULE_FIRST_MONTH_ADHERENCE_NUDGE',
        },
      })
      if (priorNudges === 0) {
        await this.persistAlert(session, ctx, nudgeResult)
      }
    }

    // Bug #6/#7 fix: the silent auto-resolve sweep was removed. A clean
    // reading must NOT mutate prior open alerts — that flow flipped alerts
    // to RESOLVED with NULL resolutionAction / resolutionRationale /
    // resolvedBy, breaching the JCAHO 15-field audit trail and conflating
    // patient-self-clear with provider closure. Resolution now happens
    // ONLY through the explicit /admin/alerts/:id/resolve API path
    // (alert-resolution.service.ts), which writes the full audit fields
    // and closes EscalationEvent rows. If "trend recovery" is wanted in
    // the future, it must be a non-blocking SUGGESTION in admin UI per
    // Manisha — never a silent state mutation.

    return primary ?? adherenceResult
  }

  // ─── ad-hoc evaluation (chatbot tool) ──────────────────────────────────

  /**
   * Chatbot entry point: "what does this reading mean *for me*?" Runs the
   * same pipeline as `evaluate()` against a synthetic, non-persisted
   * `SessionAverage` so the LLM can quote the canonical patient-tier
   * message from the alert registry instead of paraphrasing thresholds.
   *
   * Differences vs `evaluate()`:
   *   - no DeviationAlert / Notification rows are written
   *   - no events emitted (no escalation ladder, no caregiver dispatch)
   *   - `runPipeline` is reused as-is; prior-elevation + prior-weight/SBP
   *     are still queried so the verdict matches what would happen if the
   *     patient actually logged this reading
   *   - `readingCount=1`, single-reading sessions can fire AFib/single-
   *     reading-gated rules only via the same fallback paths used by
   *     `evaluate()`; trend rules that need history (e.g. brady-surveillance,
   *     adherence-window) are deliberately skipped — they aren't single-
   *     reading questions and including them would surprise the patient
   *     with verdicts that depend on data they haven't logged yet
   */
  async evaluateAdHoc(input: {
    userId: string
    systolicBP: number
    diastolicBP: number
    pulse?: number | null
    symptoms?: Partial<SessionSymptoms>
    measuredAt?: Date
  }): Promise<
    | {
        evaluated: true
        ruleId: RuleResult['ruleId'] | null
        tier: RuleResult['tier'] | null
        mode: RuleResult['mode'] | null
        preDay3: boolean
        patientMessage: string | null
      }
    | { evaluated: false; reason: 'PROFILE_NOT_FOUND' }
  > {
    const measuredAt = input.measuredAt ?? new Date()

    let ctx: ResolvedContext
    try {
      ctx = await this.profileResolver.resolve(input.userId, measuredAt)
    } catch (err) {
      if (err instanceof ProfileNotFoundException) {
        return { evaluated: false, reason: 'PROFILE_NOT_FOUND' }
      }
      throw err
    }

    const session: SessionAverage = {
      entryId: '',
      userId: input.userId,
      measuredAt,
      systolicBP: input.systolicBP,
      diastolicBP: input.diastolicBP,
      pulse: input.pulse ?? null,
      weight: null,
      readingCount: 1,
      // The patient is explicitly asking us to interpret ONE reading. That's
      // semantically the same as the 5-min frontend-finalize flow that the
      // engine's single-reading gate is designed for — flipping this flag
      // lets Stage C non-emergency rules (pregnancyL1High, personalizedHigh,
      // standardL1High, etc.) actually fire. Without this, the chatbot would
      // get ruleId:null on borderline-elevated readings and have nothing to
      // quote back to the patient.
      singleReadingFinalized: true,
      symptoms: { ...EMPTY_SESSION_SYMPTOMS, ...(input.symptoms ?? {}) },
      suboptimalMeasurement: false,
      sessionId: null,
      medicationTaken: null,
      missedMedications: [],
    }

    const priorElevated = await this.wasPriorReadingPulseElevated(session, ctx)
    await this.attachPriorReading(session)

    const results = await this.runPipeline(session, ctx, priorElevated)
    const top = results[0] ?? null

    const totalReadings = await this.prisma.journalEntry.count({
      where: { userId: input.userId },
    })
    const preDay3 = totalReadings < 7

    if (!top) {
      return {
        evaluated: true,
        ruleId: null,
        tier: null,
        mode: null,
        preDay3,
        patientMessage: null,
      }
    }

    // Issue #68 — pass dateOfBirth so the output generator can compute
    // `patientAgeYears` for any rule message that opts in via `agePhrase(ctx)`.
    // Issue #69 — also pipe `contextMeds` so the generator can compute
    // `activeMedications` (deduped against `drugNames`) for any rule message
    // that opts in via `medicationListPhrase(ctx)`.
    const messages = this.outputGenerator.generate(
      top,
      session,
      preDay3,
      null,
      ctx.dateOfBirth,
      ctx.contextMeds,
      // Chunk B fix-up — timezone renders the signed DELAYED_ENTRY
      // "[date/time]" placeholder in the patient's local time.
      ctx.timezone ?? null,
    )
    return {
      evaluated: true,
      ruleId: top.ruleId,
      tier: top.tier,
      mode: top.mode,
      preDay3,
      patientMessage: messages.patientMessage,
    }
  }

  /**
   * Option D resolution (Manisha 2026-06-12 Q2). Builds the single outcome
   * RuleResult for a CONFIRMATORY or UNCONFIRMED session. The decision uses the
   * confirmatory reading's OWN value (submitted*), never the session average —
   * see engine/option-d.ts for why. BP1 (the held first-of-pair) rides on
   * session.optionDInitial* for the CONFIRMED_NORMAL physician message.
   */
  private resolveOptionD(session: SessionAverage): RuleResult | null {
    const state = session.emergencyConfirmation
    const sbp = session.submittedSystolicBP ?? session.systolicBP
    const dbp = session.submittedDiastolicBP ?? session.diastolicBP
    const pp = getPulsePressure(sbp, dbp)

    if (state === 'UNCONFIRMED') {
      // Patient declined / window expired. Tier 1 PROVIDER-ONLY (Implementation
      // Note 5: unconfirmed + possibly artifactual → Tier 1, not Tier 2).
      return {
        ruleId: RULE_IDS.UNCONFIRMED_EMERGENCY,
        tier: 'TIER_1_CONTRAINDICATION',
        mode: 'STANDARD',
        pulsePressure: pp,
        suboptimalMeasurement: session.suboptimalMeasurement,
        actualValue: sbp,
        reason: `Unconfirmed emergency-range reading ${sbp ?? '?'}/${dbp ?? '?'} — patient did not complete confirmatory measurement.`,
        metadata: {},
      }
    }

    if (state === 'CONFIRMATORY') {
      const outcome = decideOptionDOutcome(sbp, dbp)
      if (outcome === 'EMERGENCY') {
        // Second reading also ≥180/120 → a genuine, confirmed emergency. Fire
        // the existing RULE_ABSOLUTE_EMERGENCY (BP Level 2, full ladder).
        const sbpTrigger = sbp != null && sbp >= 180
        return {
          ruleId: RULE_IDS.ABSOLUTE_EMERGENCY,
          tier: 'BP_LEVEL_2',
          mode: 'STANDARD',
          pulsePressure: pp,
          suboptimalMeasurement: session.suboptimalMeasurement,
          actualValue: sbpTrigger ? sbp : dbp,
          reason: `Confirmed emergency: confirmatory reading ${sbp ?? '?'}/${dbp ?? '?'} also in emergency range.`,
          metadata: { thresholdValue: sbpTrigger ? 180 : 120 },
        }
      }
      // Second reading below threshold → no emergency. Tier 3 informational;
      // BP1/BP2 rendered by the registry from systolicBP (BP2) + initialSystolicBP.
      return {
        ruleId: RULE_IDS.EMERGENCY_RANGE_CONFIRMED_NORMAL,
        tier: 'TIER_3_INFO',
        mode: 'STANDARD',
        pulsePressure: pp,
        suboptimalMeasurement: session.suboptimalMeasurement,
        actualValue: sbp,
        reason: `Emergency-range first reading confirmed normal on retake (${sbp ?? '?'}/${dbp ?? '?'}).`,
        metadata: {},
      }
    }

    return null
  }

  // ─── pipeline ──────────────────────────────────────────────────────────

  private async runPipeline(
    session: SessionAverage,
    ctx: ResolvedContext,
    priorElevated: boolean,
  ): Promise<RuleResult[]> {
    // Multi-alert co-fire: every stage routes its winner into the same
    // claimed Map, keyed by clinical axis (contraindication / emergency /
    // bp-high / sbp-low / dbp-low / hr / info). Distinct axes coexist;
    // same-axis later candidates are skipped. v2 spec addendum Part D
    // requires this — Tier 1 contraindication, BP Level 2, and BP Level 1
    // each have their own escalation ladder, so each must produce its own
    // DeviationAlert row to start its own ladder. The previous "Stage A
    // terminally returns" pattern broke this for pregnant-on-ACE patients
    // (the patient never saw the BP Level 2 911 message because the Tier 1
    // ACE row preempted everything).
    const claimed = new Map<Axis, RuleResult>()

    // Stage A — pre-gate rules that don't depend on averaged vitals. Must
    // also run for AFib patients with <3 readings, since contraindications
    // and symptom overrides aren't BP/HR-sample-size dependent.
    const preGateRules: RuleFunction[] = [
      // Cluster 8 — angioedema runs FIRST. Airway emergency fires for ALL
      // patients on a single reading (bypasses AFib ≥3 + Q2 single-reading
      // gates) and claims the top-priority 'angioedema' axis.
      angioedemaRule,
      pregnancyAceArbRule,
      ndhpHfrefRule,
      // symptomOverridePregnancyRule runs BEFORE symptomOverrideGeneralRule
      // so a pregnant patient with ruqPain gets the preeclampsia-specific
      // message wording, not the generic one. Both share the 'emergency'
      // axis so only the first match claims it.
      symptomOverridePregnancyRule,
      symptomOverrideGeneralRule,
      // HR<40 absolute bradycardia (Tier 1) — a hard emergency floor that
      // must fire on a SINGLE reading, so it runs pre-gate (NIVA_HR doc /
      // Cluster 6). Listed AFTER the contraindication rules above so they
      // keep priority on the shared 'contraindication' axis. Bypasses the
      // single-reading gate AND fires for AFib <3 (like angioedema).
      bradyAbsoluteRule,
    ]
    for (const rule of preGateRules) {
      const r = rule(session, ctx)
      if (!r) continue
      const axis = axisFor(r)
      if (claimed.has(axis)) {
        // Cluster 6 Q3 (Manisha 5/9/26): audit-log when ruqPain triggered
        // BOTH pregnancy + general overrides. Pregnancy claims 'emergency'
        // first (it iterates ahead of general in preGateRules), so general
        // is silently dropped. Manisha asked for the suppression to be
        // recorded for clinical-reasoning traceability.
        const claimedRule = claimed.get(axis)?.ruleId
        if (
          r.ruleId === 'RULE_SYMPTOM_OVERRIDE_GENERAL' &&
          claimedRule === 'RULE_SYMPTOM_OVERRIDE_PREGNANCY' &&
          session.symptoms.ruqPain
        ) {
          this.logger.log(
            `Symptom-override suppressed: pregnancy override ` +
              `fired on ruqPain — RULE_SYMPTOM_OVERRIDE_GENERAL skipped. ` +
              `user=${session.userId} entry=${session.entryId}`,
          )
        }
        continue
      }
      claimed.set(axis, r)
    }

    // Option D resolution (Manisha 2026-06-12 Q2) — TERMINAL. The held AWAITING
    // first-of-pair never reaches the engine (the service skips its
    // ENTRY_CREATED emit), so only a CONFIRMATORY resolution or a cron/decline
    // UNCONFIRMED finalize land here. Each produces EXACTLY ONE outcome alert
    // (Tier 1 unconfirmed / BP L2 confirmed-emergency / Tier 3 confirmed-
    // normal); returning here prevents the average-based absoluteEmergencyRule
    // (Stage B) and standardL1High (Stage C) from co-firing on the pair (e.g. a
    // 195/120 + 135/85 session averages to ~165/102, which would otherwise fire
    // a spurious BP Level 1). If a confirmatory reading ALSO carries a new
    // symptom, Stage A's symptom override already claimed 'emergency' (Option A
    // immediate fire) and wins — we defer to it.
    if (
      session.emergencyConfirmation === 'CONFIRMATORY' ||
      session.emergencyConfirmation === 'UNCONFIRMED'
    ) {
      if (!claimed.has('emergency')) {
        const optionD = this.resolveOptionD(session)
        if (optionD) claimed.set(axisFor(optionD), optionD)
      }
      return AXIS_PRIORITY.map((axis) => claimed.get(axis)).filter(
        (r): r is RuleResult => r !== undefined,
      )
    }

    // AFib <3-reading gate — stops Stage B + Stage C (BP/HR-dependent
    // rules) but preserves anything Stage A already claimed. Per
    // CLINICAL_SPEC §4.4, AFib readings need ≥3 samples before BP/HR
    // alerts fire; contraindications and symptom overrides are not
    // sample-size dependent and continue to fire on the first reading.
    if (ctx.profile.hasAFib && session.readingCount < AlertEngineService.AFIB_MIN_READINGS) {
      this.logger.log(
        `AFib gate: skipping BP/HR rules for entry ${session.entryId} — session has ${session.readingCount}/${AlertEngineService.AFIB_MIN_READINGS} readings.`,
      )
      return AXIS_PRIORITY
        .map((axis) => claimed.get(axis))
        .filter((r): r is RuleResult => r !== undefined)
    }

    // Stage B — emergency rules. BP Level 2 (SBP ≥180 / DBP ≥120 or the
    // pregnancy ≥160/110) coexists with any Tier 1 contraindication
    // claimed in Stage A — they're on different axes ('emergency' vs
    // 'contraindication'). Per v2 addendum D.5: the patient-facing 911
    // message + dual provider notification fires from the L2 row at T+0,
    // independently of Tier 1's T+0/4h/8h/24h/48h ladder.
    const emergencyRules: RuleFunction[] = [
      absoluteEmergencyRule,
      pregnancyL2Rule,
      // HR>130 severe tachycardia (Cluster 6 Q5) — fires immediately on a
      // single reading, so it runs in the emergency set to bypass the
      // single-reading gate. Placed in Stage B (after the AFib gate) so AFib
      // patients keep their ≥3-reading gate, since AFib rapid-HR is expected.
      // Claims the 'hr' axis.
      tachySevereRule,
    ]
    for (const rule of emergencyRules) {
      const r = rule(session, ctx)
      if (!r) continue
      const axis = axisFor(r)
      if (claimed.has(axis)) continue
      claimed.set(axis, r)
    }

    // F20 — emergency is exclusive. Once a BP_LEVEL_2 / 911-warranting rule
    // (absolute emergency, pregnancy L2, or a symptom-override emergency) has
    // claimed the 'emergency' axis, no lower-tier BP/HR rule on the SAME
    // reading is clinically meaningful — and a "contact your provider
    // tomorrow / recheck before bed" L1 message rendered alongside a "call
    // 911 now" message is a real harm path. Short-circuit before Stage C so
    // only the top-tier axes already claimed in Stage A/B survive (airway
    // angioedema + Tier 1 contraindication co-fire intentionally per D.5;
    // each runs its own ladder). This also closes the session-finalize
    // re-eval path: the existing emergency row triggers this early-return so
    // no L1 row is appended on the second pass.
    if (claimed.has('emergency')) {
      return AXIS_PRIORITY
        .map((axis) => claimed.get(axis))
        .filter((r): r is RuleResult => r !== undefined)
    }

    // Cluster 6 Q2 (Manisha 5/9/26) — non-emergency BP/HR alerts require
    // ≥2 readings averaged in the current session. Emergency rules from
    // Stage A (symptom override) + Stage B (absolute emergency, pregnancy
    // L2) already ran above and stay if they fired — they explicitly
    // bypass the gate per Manisha's note. The remaining axisRules in
    // Stage C / Stage D info fallback are suppressed for single-reading
    // sessions on adult non-AFib non-preDay3 patients until either:
    //   (a) a second reading lands and SessionAverager re-averages, or
    //   (b) the frontend's 5-min timeout POSTs the finalize endpoint
    //       which flips `JournalEntry.singleReadingFinalized = true`.
    const isSingleReadingNonEmergency =
      session.readingCount < 2 &&
      !session.singleReadingFinalized &&
      !ctx.preDay3Mode &&
      !ctx.profile.hasAFib
    if (isSingleReadingNonEmergency) {
      // Manisha Q2 (2026-06-02 reply) — RULE_HFREF_HIGH reverts to
      // single-reading firing. The HFrEF therapeutic window (≈120–130 mmHg)
      // is narrow; holding a lone SBP≥target reading behind the ≥2-reading
      // gate risks missing a clinically actionable HFrEF reading (a patient
      // takes one reading at 145 and leaves → alert never fires). A
      // false-positive at 132 is low-cost (clinician reviews, no action); a
      // missed 145 in HFrEF is high-cost. So HFREF_HIGH — and ONLY the high
      // branch — bypasses the gate, evaluating this reading's own value. The
      // low branch (HFREF_LOW) and every other non-emergency rule stay gated,
      // and RULE_STANDARD_L1_HIGH session-averaging is untouched (Manisha:
      // averaging stays ONLY for standard L1). Same-session noise is managed
      // via Q6 per-session dedup, not by re-suppressing the alert.
      const hfref = hfrefRule(session, ctx)
      if (hfref && hfref.ruleId === RULE_IDS.HFREF_HIGH) {
        const axis = axisFor(hfref)
        if (!claimed.has(axis)) claimed.set(axis, hfref)
      }
      this.logger.log(
        `Single-reading session — gating non-emergency rules for entry ${session.entryId}; ` +
          'RULE_HFREF_HIGH exempt',
      )
      return AXIS_PRIORITY
        .map((axis) => claimed.get(axis))
        .filter((r): r is RuleResult => r !== undefined)
    }

    // Stage C — multi-axis accumulation. Tachycardia uses the cross-session
    // priorElevated flag computed once in evaluate() (used here + by the
    // HR-context annotation, gated below to avoid double-annotating when
    // an HR rule has its own row).
    const tachyRule = buildTachyRule(priorElevated)

    // Order matters for the suppression invariant: HFrEF/HFpEF/HCM/DCM rules
    // (which REPLACE standard SBP-low per §4.2/4.6/4.7/4.8) must iterate
    // BEFORE personalizedLowRule + standardL1LowRule, so condition rules
    // claim sbp-low first and bucket-derived rules are skipped. CAD does not
    // claim sbp-low (only dbp-low), so a CAD-only patient at SBP <100 (65+)
    // still fires AGE_65_LOW alongside CAD_DBP_CRITICAL. This is the bug fix.
    const axisRules: RuleFunction[] = [
      pregnancyL1HighRule,
      // dcmRule must precede hfrefRule: both apply to `resolvedHFType=HFREF`,
      // but dcmRule bails when hasHeartFailure=true, so putting it first lets
      // DCM-only patients (biased to HFREF by the resolver) get the DCM-
      // specific message wording. HFrEF patients still route to hfrefRule.
      dcmRule,
      hfrefRule,
      hfpefRule,
      cadDbpRule,
      cadHighRule,
      // Cluster 8 Q2 — CAD DBP-high; own axis so it co-fires with cadHighRule.
      cadDbpHighRule,
      hcmRule,
      // HCM vasodilator is split from hcmRule so it claims the info axis
      // independently — an HCM patient on a DHP-CCB with low SBP fires both
      // RULE_HCM_VASODILATOR (Tier 3, physician-only) AND RULE_HCM_LOW
      // (BP_LEVEL_1_LOW, patient-facing) per §4.6.
      hcmVasodilatorRule,
      // Manisha 5/24 Q5C — aortic stenosis (interim HCM-style thresholds).
      // Claims the systolic axis like the other condition rules.
      aorticStenosisRule,
      personalizedHighRule,
      personalizedLowRule,
      standardL1HighRule,
      standardL1LowRule,
      afibHrRule,
      tachyRule,
      // Cluster 6 — bradyAbsoluteRule (HR<40, Tier 1 'contraindication') was
      // moved to the Stage A pre-gate set so the emergency floor fires on a
      // single reading. bradySymptomaticRule (HR<50 + dizziness/syncope/AMS/
      // etc., 'hr' axis) stays gated here — it needs symptom confirmation.
      bradySymptomaticRule,
      // Cluster 6 — HF decompensation + DHP-CCB side-effect + the six
      // symptom-rules.ts entries. Each claims a distinct axis so they
      // coexist with whatever BP/HR row also fires.
      hfDecompensationRule,
      dhpCcbLegSwellingRule,
      orthostaticHypotensionRule,
      betaBlockerDizzinessRule,
      afibPalpitationsRule,
      tachyPalpitationsRule,
      palpitationsGeneralRule,
      syncopeGeneralRule,
      // Cluster 7 (Manisha 5/11/26) — Appendix A side-effect + interaction
      // rules. β-blocker fatigue/SOB (HF + non-HF), NSAID + antihypertensive,
      // ACE cough, and HF caregiver edema sibling. Each claims its own
      // distinct axis (see axisFor above) so they coexist with everything
      // else on the same reading.
      betaBlockerFatigueRule,
      betaBlockerSobHfRule,
      betaBlockerSobNonHfRule,
      nsaidAntihypertensiveRule,
      aceCoughRule,
      hfCaregiverEdemaRule,
    ]

    // Stage C continues into the same `claimed` Map declared above so
    // Stage A contraindications coexist with Stage C BP/HR rows.
    for (const rule of axisRules) {
      const r = rule(session, ctx)
      if (!r) continue
      const axis = axisFor(r)
      if (claimed.has(axis)) continue
      claimed.set(axis, r)
    }

    // Stage D — info fallback. Pulse-pressure-wide and loop-diuretic-
    // hypotension are physician-only Tier 3 hints. They fire as standalone
    // rows ONLY when nothing else fired; otherwise they ride as annotations
    // on the highest-tier primary via addPhysicianAnnotations() (preserves
    // Scenario 15: PP-wide co-occurring with L1-High becomes an annotation,
    // not a second row).
    if (claimed.size === 0) {
      const fallbackRules: RuleFunction[] = [
        loopDiureticHypotensionRule,
        pulsePressureWideRule,
        pulsePressureNarrowRule,
      ]
      for (const rule of fallbackRules) {
        const r = rule(session, ctx)
        if (r) return [r]
      }
      return []
    }

    // Sort by AXIS_PRIORITY so the highest-tier row persists first — keeps
    // `prisma.deviationAlert.create.mock.calls[0]` pointing at the highest-
    // tier alert (preserves Scenario 62's positional assertion shape).
    return AXIS_PRIORITY
      .map((axis) => claimed.get(axis))
      .filter((r): r is RuleResult => r !== undefined)
  }

  /**
   * Bug 4 fix — true "consecutive readings" check. Load only the *immediately
   * previous* JournalEntry for this user (before the current session's
   * anchor) and test its pulse. Prior implementation filtered on pulse>100 at
   * query time, which would match any prior elevated reading — even with
   * intervening normal readings.
   *
   * Cluster 6 Q5 (Manisha 5/9/26): narrow the lookup window from "any prior
   * reading" to 8h consecutive. A reading 9+ hours ago is no longer
   * clinically related to the current session's tachycardia question.
   * (The HR > 130 single-reading Tier 2 exception lives in `buildTachyRule`
   * — it doesn't consult this helper at all.)
   */
  private static readonly TACHY_CONSECUTIVE_WINDOW_MS = 8 * 60 * 60 * 1000

  private async wasPriorReadingPulseElevated(
    session: SessionAverage,
    ctx: ResolvedContext,
  ): Promise<boolean> {
    if (!ctx.profile.hasTachycardia) return false
    const windowStart = new Date(
      session.measuredAt.getTime() - AlertEngineService.TACHY_CONSECUTIVE_WINDOW_MS,
    )
    const prior = await this.prisma.journalEntry.findFirst({
      where: {
        userId: session.userId,
        measuredAt: { lt: session.measuredAt, gte: windowStart },
      },
      orderBy: { measuredAt: 'desc' },
      select: { pulse: true },
    })
    if (!prior || prior.pulse == null) return false
    return prior.pulse > 100
  }

  /**
   * Cluster 6 — populate `session.priorWeight`, `session.priorWeightAt`, and
   * `session.priorSystolicBP` from the most-recent prior journal entry. One
   * query covers both predicates (HF-decompensation weight-delta + orthostatic
   * SBP-drop). Idempotent — fields are simply assigned, defaulting to null.
   */
  private async attachPriorReading(session: SessionAverage): Promise<void> {
    const prior = await this.prisma.journalEntry.findFirst({
      where: {
        userId: session.userId,
        measuredAt: { lt: session.measuredAt },
      },
      orderBy: { measuredAt: 'desc' },
      select: { weight: true, systolicBP: true, measuredAt: true },
    })
    session.priorWeight = prior?.weight != null ? Number(prior.weight) : null
    session.priorWeightAt = prior?.measuredAt ?? null
    session.priorSystolicBP = prior?.systolicBP ?? null
  }

  // ─── annotations ───────────────────────────────────────────────────────

  private addPhysicianAnnotations(
    result: RuleResult,
    session: SessionAverage,
    ctx: ResolvedContext,
    priorElevated: boolean,
    hasHrRow: boolean,
  ) {
    const annotations: string[] = result.metadata.physicianAnnotations ?? []

    // Don't double-annotate if the primary rule IS the annotation.
    if (result.ruleId !== 'RULE_PULSE_PRESSURE_WIDE') {
      const ppNote = getWidePulsePressureAnnotation(
        session.systolicBP,
        session.diastolicBP,
      )
      if (ppNote) annotations.push(ppNote)
    }

    // Manisha 5/24 Q2 — narrow PP rides as a physician annotation when a
    // higher-tier finding already fired (mirrors the wide-PP pattern).
    if (result.ruleId !== 'RULE_PULSE_PRESSURE_NARROW') {
      const narrowNote = getNarrowPulsePressureAnnotation(
        session.systolicBP,
        session.diastolicBP,
        ctx.profile,
      )
      if (narrowNote) annotations.push(narrowNote)
    }

    if (result.ruleId !== 'RULE_LOOP_DIURETIC_HYPOTENSION') {
      const loopNote = getLoopDiureticAnnotation(ctx.contextMeds, session.systolicBP)
      if (loopNote) annotations.push(loopNote)
    }

    // Phase/26 round-3 fix — bidirectional BP context. Surfaces "SBP also
    // above CAD goal" framing alongside the J-curve framing when both are
    // true on the same reading (Reading 3: 155/65). Without this, provider
    // sees only the dose-reduction recommendation and may miss that SBP is
    // uncontrolled (per §4.3 treatment target 130/80).
    if (result.ruleId === 'RULE_CAD_DBP_CRITICAL') {
      const htnNote = getCadHtnUncontrolledAnnotation(
        session.systolicBP ?? null,
        ctx.profile.hasCAD,
      )
      if (htnNote) annotations.push(htnNote)
    }

    // Phase/26 Reading 5b fix — HR context annotation. When a Stage A/B
    // rule (symptom override or absolute emergency) is the primary, the
    // HR-axis rule may also have fired (post co-fire fix) OR may have been
    // suppressed (sample-size, gating). Surface the HR finding as an
    // annotation only when there is NO HR row in the result set; otherwise
    // the dedicated HR row already carries the framing and double-surfacing
    // would be redundant.
    const STAGE_AB_RULE_IDS = [
      'RULE_SYMPTOM_OVERRIDE_GENERAL',
      'RULE_SYMPTOM_OVERRIDE_PREGNANCY',
      'RULE_ABSOLUTE_EMERGENCY',
      'RULE_PREGNANCY_L2',
    ] as const
    if (
      !hasHrRow &&
      (STAGE_AB_RULE_IDS as readonly string[]).includes(result.ruleId)
    ) {
      const hrNote = getHrContextAnnotation(session, ctx, priorElevated)
      if (hrNote) annotations.push(hrNote)
    }

    if (annotations.length > 0) {
      result.metadata.physicianAnnotations = annotations
    }
  }

  // ─── persistence ───────────────────────────────────────────────────────

  private async persistAlert(
    session: SessionAverage,
    ctx: ResolvedContext,
    result: RuleResult,
  ) {
    const legacyType = this.legacyTypeFor(result, session)
    const legacySeverity = this.legacySeverityFor(result)
    const dismissible = !isNonDismissableTier(result.tier)
    const messages = this.outputGenerator.generate(
      result,
      session,
      ctx.preDay3Mode,
      ctx.patientName,
      // Issue #68 — pipe DOB so rule messages can render `(age X)` via
      // `agePhrase(ctx)`. The output generator computes age once from
      // `session.measuredAt` so both surfaces agree with the email block.
      ctx.dateOfBirth,
      // Issue #69 — pipe the full active-meds list (verified + UNVERIFIED
      // known-class) so rule messages can render "Currently also taking:
      // …" via `medicationListPhrase(ctx)`. Dedup against `drugNames`
      // happens in the generator.
      ctx.contextMeds,
      // Chunk B fix-up — timezone renders the signed DELAYED_ENTRY
      // "[date/time]" placeholder in the patient's local time.
      ctx.timezone ?? null,
    )

    const actualValue =
      result.actualValue != null
        ? new Prisma.Decimal(result.actualValue.toFixed(2))
        : null

    // Cluster 6 bug #11 (HIGH severity) — wrap the DeviationAlert upsert +
    // patient notification write in a serializable transaction with
    // deadlock-retry. Under Prisma Cloud DB concurrency, the previous
    // auto-commit pattern silently rolled back alert creation when a
    // deadlock collided with an in-flight escalation/notification write.
    // Production failure: a BP Level 2 reading during a deadlock window
    // simply doesn't fire its alert.
    const upserted = await withDeadlockRetry(
      `persistAlert:${result.ruleId}:${session.entryId}`,
      async () => {
        return await this.prisma.$transaction(
          async (tx) => {
            // Phase/7 — app-level dedup by (journalEntryId, ruleId). The legacy
            // @@unique([journalEntryId, type]) was dropped so v2 can persist
            // multiple alerts per entry (e.g. Tier 3 pulse-pressure riding
            // alongside a Tier 1 contraindication). Upsert is replaced with
            // findFirst → update|create.
            const existing = await tx.deviationAlert.findFirst({
              where: {
                journalEntryId: session.entryId,
                ruleId: result.ruleId,
              },
              select: { id: true, escalated: true },
            })

            // F9 (P0 — JCAHO immutability). A DeviationAlert is the
            // at-fire-time clinical record. When the engine re-evaluates the
            // same (journalEntryId, ruleId) — session-finalize, an entry edit,
            // or a later personalized-mode pass — it must NEVER rewrite the
            // fired-record fields (mode, severity, tier, ruleId, the three-tier
            // messages, dismissible, actualValue). Doing so retroactively
            // mutated e.g. a STANDARD-mode alert to PERSONALIZED once the
            // patient crossed 7 readings, corrupting the audit trail.
            // Acknowledge / resolve mutations are owned by
            // AlertResolutionService, not this engine path — so once the row
            // exists we return it untouched and skip the write entirely.
            const row = existing
              ? existing
              : await tx.deviationAlert.create({
                  data: {
                    userId: session.userId,
                    journalEntryId: session.entryId,
                    type: legacyType,
                    severity: legacySeverity,
                    tier: result.tier,
                    ruleId: result.ruleId,
                    mode: result.mode,
                    pulsePressure: result.pulsePressure,
                    suboptimalMeasurement: result.suboptimalMeasurement,
                    dismissible,
                    actualValue,
                    patientMessage: messages.patientMessage,
                    caregiverMessage: messages.caregiverMessage,
                    physicianMessage: messages.physicianMessage,
                  },
                })

            // Manual-test round 2 — Group B (Manisha sign-off pending). Reverses
            // CLINICAL_SPEC Part 13.2's "immediate patient DASHBOARD/push" rule:
            // clinical alerts NO LONGER mirror into the patient in-app
            // Notification surface. The alert detail page (TierAlertView) and
            // the dashboard banner already carry the patient-facing message;
            // the inbox is reserved for admin/care-team action events
            // (HOLD, profile reject, ack/resolve, threshold change, follow-up
            // call, gap-alert + monthly-reask crons). Provider/MD escalation
            // PUSH+EMAIL and the caregiver dispatch path remain unchanged.
            //
            // N6 (2026-07-13) — quiet-hours gate rationale. This path does NOT
            // check the patient's User.quietHours{Start,End} because it does
            // not fan out to the patient's PUSH/EMAIL channels at all
            // (per the Group-B comment above). Tier 3 caregiver-routed rules
            // reach the caregiver via EscalationService.dispatchCaregiverNotification;
            // suppressing those on the PATIENT's quiet-hours preference would be
            // wrong — the caregiver is the recipient. Provider/MD Tier 1 + BP L2
            // dispatches are safety-critical and MUST NEVER be quiet-suppressed.
            // If a Tier-3 patient-facing push is added back in a future sprint,
            // gate it here with `isWithinQuietHours(patient, now)` before the
            // notification.create — see backend/src/crons/daily-reminder/helpers.ts.

            return row
          },
          { isolationLevel: 'Serializable' },
        )
      },
      this.logger,
    )

    // V-05 sweep — `result.reason` embeds raw clinical values (e.g. "confirmatory
    // reading 180/120 …" for a confirmed emergency). ruleId + tier + userId
    // already say WHAT fired for WHOM; the narrative + all vitals live on the
    // DeviationAlert row (`upserted.id`), access-controlled and audited. Log the
    // row id as the correlation handle instead of the PHI-bearing reason.
    this.logger.log(
      `Alert fired: ${result.ruleId} (${result.tier}) for user ${session.userId} — alert=${upserted.id}`,
    )

    // Phase/7 — renamed from ANOMALY_TRACKED and enriched with tier + ruleId so
    // the escalation service can route by tier without re-fetching the alert.
    this.eventEmitter.emit(JOURNAL_EVENTS.ALERT_CREATED, {
      userId: session.userId,
      alertId: upserted.id,
      type: legacyType,
      severity: legacySeverity,
      escalated: upserted.escalated,
      tier: result.tier,
      ruleId: result.ruleId,
    })

    // Cluster 8 Q2 — one-time provider notice when a CAD patient's effective
    // threshold first changed 160→140. Fire-and-forget; never blocks the
    // alert. Idempotent: only on the patient's FIRST RULE_CAD_HIGH alert.
    void this.maybeNotifyCadThresholdRamp(session, ctx, result).catch((err) =>
      this.logger.warn(
        `CAD threshold-ramp notice failed for user ${session.userId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    )
  }

  /**
   * Cluster 8 Q2 — when the phased ramp first lowers a CAD patient's default
   * sbpUpperTarget to 140 (no provider-set custom threshold) and that change
   * produces the patient's first RULE_CAD_HIGH alert, send a one-time
   * dashboard notice to the primary provider so they can customise the
   * threshold. Idempotent via the "exactly one CAD_HIGH alert exists" guard.
   */
  private async maybeNotifyCadThresholdRamp(
    session: SessionAverage,
    ctx: ResolvedContext,
    result: RuleResult,
  ): Promise<void> {
    if (result.ruleId !== 'RULE_CAD_HIGH') return
    // Only when the NEW default produced this alert: no provider custom
    // threshold AND the ramp resolved this patient to 140.
    if (ctx.threshold?.sbpUpperTarget != null) return
    if (cadDefaultUpper(ctx) !== 140) return
    const providerId = ctx.assignment?.primaryProviderId
    if (!providerId) return

    const cadHighCount = await this.prisma.deviationAlert.count({
      where: { userId: session.userId, ruleId: 'RULE_CAD_HIGH' },
    })
    // >1 means an earlier CAD_HIGH already fired — notice already sent.
    if (cadHighCount !== 1) return

    await this.prisma.notification.create({
      data: {
        userId: providerId,
        channel: 'DASHBOARD',
        title: 'CAD patient alert threshold updated',
        body: 'CAD patient alert threshold updated from SBP ≥160 to SBP ≥140 per AHA/ACC guideline alignment (treatment target 130/80). Customise the threshold in patient settings.',
        tips: [],
        dispatchTrigger: 'THRESHOLD_UPDATED',
      },
    })
  }

  // N-7 (Duwaragie 2026-07-14 triage) — 'WEIGHT' removed from the return
  // union. No branch has returned it since the Cluster 6 rewrite; enum
  // value dropped from DeviationType in the same PR (schema + migration).
  private legacyTypeFor(result: RuleResult, session: SessionAverage): 'SYSTOLIC_BP' | 'DIASTOLIC_BP' | 'MEDICATION_ADHERENCE' {
    // Map new tier/ruleId back to legacy DeviationType for the @@unique
    // constraint until it can be dropped (phase/7+).
    if (
      result.ruleId === 'RULE_PREGNANCY_ACE_ARB' ||
      result.ruleId === 'RULE_NDHP_HFREF' ||
      result.ruleId === 'RULE_MEDICATION_MISSED'
    ) {
      return 'MEDICATION_ADHERENCE'
    }
    if (result.ruleId === 'RULE_CAD_DBP_CRITICAL' && session.diastolicBP != null) {
      return 'DIASTOLIC_BP'
    }
    // F18 — derive the legacy axis from the triggering value rather than
    // defaulting every BP rule to SYSTOLIC_BP. A DBP-only L1 (e.g. 119/109)
    // or a DBP-driven emergency carries actualValue == the diastolic reading;
    // tagging it SYSTOLIC_BP mislabels the audited axis. Comes after the
    // MEDICATION_ADHERENCE guard so med rules keep their type.
    if (session.diastolicBP != null && result.actualValue === session.diastolicBP) {
      return 'DIASTOLIC_BP'
    }
    // Default: systolic-axis is the primary surface for BP rules.
    return 'SYSTOLIC_BP'
  }

  private legacySeverityFor(result: RuleResult): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (
      result.tier === 'TIER_1_CONTRAINDICATION' ||
      result.tier === 'TIER_1_ANGIOEDEMA' ||
      result.tier === 'BP_LEVEL_2' ||
      result.tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE'
    ) {
      return 'HIGH'
    }
    if (
      result.tier === 'BP_LEVEL_1_HIGH' ||
      result.tier === 'BP_LEVEL_1_LOW' ||
      result.tier === 'TIER_2_DISCREPANCY'
    ) {
      return 'MEDIUM'
    }
    return 'LOW'
  }

  private logEvaluationError(entryId: string, err: unknown) {
    this.logger.error(
      `AlertEngine evaluation failed for entry ${entryId}`,
      err instanceof Error ? err.stack : err,
    )
  }
}

function isNonDismissableTier(tier: RuleResult['tier']): boolean {
  return (
    tier === 'TIER_1_CONTRAINDICATION' ||
    tier === 'TIER_1_ANGIOEDEMA' ||
    tier === 'BP_LEVEL_2' ||
    tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE'
  )
}

// patientNotificationTitle() removed in Round 2 Group B — the patient inbox
// no longer mirrors alerts. The alert detail screen (TierAlertView) and the
// dashboard banner carry the patient-facing title now.
