import { Injectable, Logger } from '@nestjs/common'
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter'
import {
  ProfileNotFoundException,
  type ResolvedContext,
} from '@cardioplace/shared'
import { Prisma } from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { JOURNAL_EVENTS } from '../constants/events.js'
import type { JournalEntryCreatedEvent, JournalEntryUpdatedEvent } from '../interfaces/events.interface.js'
import type { RuleFunction, RuleResult, SessionAverage } from '../engine/types.js'
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
import { absoluteEmergencyRule } from '../engine/absolute-emergency.js'
import {
  pregnancyL1HighRule,
  pregnancyL2Rule,
} from '../engine/pregnancy-thresholds.js'
import {
  cadDbpRule,
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
  afibPalpitationsRule,
  betaBlockerDizzinessRule,
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
  bradySymptomaticRule,
  buildTachyRule,
  getHrContextAnnotation,
} from '../engine/hr-branches.js'
import {
  getWidePulsePressureAnnotation,
  pulsePressureWideRule,
} from '../engine/pulse-pressure.js'
import {
  getLoopDiureticAnnotation,
  loopDiureticHypotensionRule,
} from '../engine/loop-diuretic.js'
import { medicationMissedRuleWithWindow } from '../engine/adherence.js'
import { loadAdherenceWindow } from '../engine/adherence-window.js'

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
  | 'contraindication'
  | 'emergency'
  | 'bp-high'
  | 'sbp-low'
  | 'dbp-low'
  | 'hr'
  | 'hf-decomp'
  | 'palpitations'
  | 'orthostatic'
  | 'syncope'
  | 'med-side-effect'
  | 'info'

const AXIS_PRIORITY: Axis[] = [
  'emergency',
  'contraindication',
  'bp-high',
  'sbp-low',
  'dbp-low',
  'hr',
  'hf-decomp',
  'orthostatic',
  'palpitations',
  'syncope',
  'med-side-effect',
  'info',
]

function axisFor(r: RuleResult): Axis {
  if (r.tier === 'TIER_1_CONTRAINDICATION') return 'contraindication'
  if (r.tier === 'BP_LEVEL_2' || r.tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') return 'emergency'
  // HCM vasodilator is Tier 3, not a high/low axis claimant — let HCM_LOW
  // still fire on sbp-low for the same patient (§4.6).
  if (r.ruleId === 'RULE_HCM_VASODILATOR') return 'info'
  if (r.ruleId === 'RULE_CAD_DBP_CRITICAL') return 'dbp-low'
  // HR rules emit BP_LEVEL_1_HIGH / LOW tiers but represent a different axis.
  if (
    r.ruleId === 'RULE_AFIB_HR_HIGH' ||
    r.ruleId === 'RULE_AFIB_HR_LOW' ||
    r.ruleId === 'RULE_TACHY_HR' ||
    r.ruleId === 'RULE_BRADY_HR_SYMPTOMATIC' ||
    r.ruleId === 'RULE_BRADY_HR_ASYMPTOMATIC'
  ) {
    return 'hr'
  }
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
  ) {}

  @OnEvent(JOURNAL_EVENTS.ENTRY_CREATED, { async: true })
  async handleEntryCreated(payload: JournalEntryCreatedEvent) {
    await this.evaluate(payload.entryId).catch((err) =>
      this.logEvaluationError(payload.entryId, err),
    )
  }

  @OnEvent(JOURNAL_EVENTS.ENTRY_UPDATED, { async: true })
  async handleEntryUpdated(payload: JournalEntryUpdatedEvent) {
    await this.evaluate(payload.entryId).catch((err) =>
      this.logEvaluationError(payload.entryId, err),
    )
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

    // Pass 1 — multi-axis BP/HR pipeline
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

    // Only run the BP-L1 resolve-sweep when NEITHER pipeline fired. This
    // preserves Bug 2 fix scope (sweep is scoped to BP L1 tiers only) and
    // avoids auto-resolving adherence alerts on an unrelated benign BP entry.
    if (bpResults.length === 0 && !adherenceResult) {
      await this.resolveOpenAlerts(session.userId)
    }

    return primary ?? adherenceResult
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
      pregnancyAceArbRule,
      ndhpHfrefRule,
      // symptomOverridePregnancyRule runs BEFORE symptomOverrideGeneralRule
      // so a pregnant patient with ruqPain gets the preeclampsia-specific
      // message wording, not the generic one. Both share the 'emergency'
      // axis so only the first match claims it.
      symptomOverridePregnancyRule,
      symptomOverrideGeneralRule,
    ]
    for (const rule of preGateRules) {
      const r = rule(session, ctx)
      if (!r) continue
      const axis = axisFor(r)
      if (claimed.has(axis)) continue
      claimed.set(axis, r)
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
    ]
    for (const rule of emergencyRules) {
      const r = rule(session, ctx)
      if (!r) continue
      const axis = axisFor(r)
      if (claimed.has(axis)) continue
      claimed.set(axis, r)
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
      hcmRule,
      // HCM vasodilator is split from hcmRule so it claims the info axis
      // independently — an HCM patient on a DHP-CCB with low SBP fires both
      // RULE_HCM_VASODILATOR (Tier 3, physician-only) AND RULE_HCM_LOW
      // (BP_LEVEL_1_LOW, patient-facing) per §4.6.
      hcmVasodilatorRule,
      personalizedHighRule,
      personalizedLowRule,
      standardL1HighRule,
      standardL1LowRule,
      afibHrRule,
      tachyRule,
      // Cluster 6 — brady split into two emitters. bradyAbsoluteRule (HR<40)
      // claims 'contraindication' (Tier 1); bradySymptomaticRule (HR<50 +
      // dizziness/syncope/AMS/etc.) claims 'hr'. They're on different axes
      // so both can co-fire on the same reading.
      bradyAbsoluteRule,
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
   * intervening normal readings. Spec §4.5 requires back-to-back elevation.
   */
  private async wasPriorReadingPulseElevated(
    session: SessionAverage,
    ctx: ResolvedContext,
  ): Promise<boolean> {
    if (!ctx.profile.hasTachycardia) return false
    const prior = await this.prisma.journalEntry.findFirst({
      where: {
        userId: session.userId,
        measuredAt: { lt: session.measuredAt },
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
    const messages = this.outputGenerator.generate(result, session, ctx.preDay3Mode)

    // Phase/7 — app-level dedup by (journalEntryId, ruleId). The legacy
    // @@unique([journalEntryId, type]) was dropped so v2 can persist multiple
    // alerts per entry (e.g. Tier 3 pulse-pressure riding alongside a Tier 1
    // contraindication). Upsert is replaced with findFirst → update|create.
    const existing = await this.prisma.deviationAlert.findFirst({
      where: {
        journalEntryId: session.entryId,
        ruleId: result.ruleId,
      },
      select: { id: true },
    })

    const actualValue =
      result.actualValue != null
        ? new Prisma.Decimal(result.actualValue.toFixed(2))
        : null

    const upserted = existing
      ? await this.prisma.deviationAlert.update({
          where: { id: existing.id },
          data: {
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
      : await this.prisma.deviationAlert.create({
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

    this.logger.log(
      `Alert fired: ${result.ruleId} (${result.tier}) for user ${session.userId} — ${result.reason}`,
    )

    // Patient-facing in-app dashboard notification. Independent of the
    // EscalationService ladder (which only pages PROVIDER/MD/OPS for most
    // tiers per CLINICAL_SPEC §V2-D). This row is what populates the
    // patient's /notifications inbox so they see "Important medication
    // alert" cards alongside their dashboard alerts banner. Idempotent via
    // the @@unique([alertId, escalationEventId, userId, channel]) index —
    // re-evaluation of the same entry won't double-write.
    if (messages.patientMessage) {
      const patientTitle = patientNotificationTitle(result.tier)
      await this.prisma.notification
        .create({
          data: {
            userId: session.userId,
            alertId: upserted.id,
            escalationEventId: null,
            channel: 'DASHBOARD',
            title: patientTitle,
            body: messages.patientMessage,
            tips: [],
          },
        })
        .catch((err: unknown) => {
          // P2002 = duplicate (re-evaluation of same entry). Safe to ignore.
          const code = (err as { code?: string })?.code
          if (code !== 'P2002') throw err
        })
    }

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
  }

  /**
   * Bug 2 fix — only auto-resolve BP Level 1 alerts when a benign reading
   * arrives. Tier 1 contraindications, BP Level 2 emergencies, and Tier 2/3
   * need explicit admin resolution (phase/7). Historically this cleared
   * everything and silently wiped unresolved safety-critical alerts.
   */
  private async resolveOpenAlerts(userId: string) {
    await this.prisma.deviationAlert.updateMany({
      where: {
        userId,
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
        tier: { in: ['BP_LEVEL_1_HIGH', 'BP_LEVEL_1_LOW'] },
      },
      data: { status: 'RESOLVED' },
    })
  }

  private legacyTypeFor(result: RuleResult, session: SessionAverage): 'SYSTOLIC_BP' | 'DIASTOLIC_BP' | 'WEIGHT' | 'MEDICATION_ADHERENCE' {
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
    // Default: systolic-axis is the primary surface for BP rules.
    return 'SYSTOLIC_BP'
  }

  private legacySeverityFor(result: RuleResult): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (
      result.tier === 'TIER_1_CONTRAINDICATION' ||
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
    tier === 'BP_LEVEL_2' ||
    tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE'
  )
}

/**
 * Title shown on the patient's in-app notification card. Mirrors what the
 * patient sees in the dashboard banner — derived from the alert tier so the
 * notifications inbox can't drift away from the alert's actual severity.
 */
function patientNotificationTitle(tier: RuleResult['tier']): string {
  switch (tier) {
    case 'BP_LEVEL_2':
    case 'BP_LEVEL_2_SYMPTOM_OVERRIDE':
      return 'Urgent Blood Pressure Alert'
    case 'TIER_1_CONTRAINDICATION':
      return 'Important medication alert'
    case 'TIER_2_DISCREPANCY':
      return 'Medication check-in needed'
    case 'BP_LEVEL_1_HIGH':
      return 'Elevated blood pressure'
    case 'BP_LEVEL_1_LOW':
      return 'Low blood pressure'
    case 'TIER_3_INFO':
      return 'Care team update'
    default:
      return 'Cardioplace Alert'
  }
}
