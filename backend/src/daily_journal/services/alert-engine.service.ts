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
  cadRule,
  dcmRule,
  hcmRule,
  hfpefRule,
  hfrefRule,
} from '../engine/condition-branches.js'
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
  bradyRule,
  buildTachyRule,
} from '../engine/hr-branches.js'
import {
  getWidePulsePressureAnnotation,
  pulsePressureWideRule,
} from '../engine/pulse-pressure.js'
import {
  getLoopDiureticAnnotation,
  loopDiureticHypotensionRule,
} from '../engine/loop-diuretic.js'

/**
 * Phase/5 AlertEngineService — the single owner of rule evaluation.
 *
 * Pipeline (short-circuits on first match):
 *   1. Pregnancy + ACE/ARB (Tier 1)                ← runs even for AFib <3 readings
 *   2. NDHP-CCB + HFrEF (Tier 1)                   ← runs even for AFib <3 readings
 *   3. Symptom override (general + pregnancy)      ← runs even for AFib <3 readings
 *      → BP Level 2
 *  ── AFib ≥3-reading gate (CLINICAL_SPEC §4.4) — bails here if AFib patient
 *     has fewer than 3 readings in the session. Contraindications + symptom
 *     overrides above are NOT gated (they don't depend on averaged vitals).
 *   4. Absolute emergency (SBP≥180 / DBP≥120) → BP Level 2
 *   5. Pregnancy L2 → L1 High (if isPregnant)
 *   6. Condition branches: HFrEF / HFpEF / CAD / HCM / DCM
 *   7. Personalized high / low (threshold + ≥7 readings)
 *   8. Standard L1 High / L1 Low
 *   9. HR branches: AFib / Tachy / Brady
 *  10. Pulse pressure wide / loop-diuretic sensitivity (physician-only)
 *
 * Writes at most one DeviationAlert row per call — annotations from pulse-
 * pressure + loop-diuretic ride on the primary result's metadata rather than
 * creating additional rows. Three-tier messages come from OutputGenerator.
 */
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

  /** Evaluate a single JournalEntry. Public so tests + ops tooling can call. */
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

    const result = await this.runPipeline(session, ctx)
    if (!result) {
      await this.resolveOpenAlerts(session.userId)
      return null
    }

    // Annotate physicianMessage for wide PP + loop-diuretic sensitivity.
    this.addPhysicianAnnotations(result, session, ctx)

    await this.persistAlert(session, ctx, result)
    return result
  }

  // ─── pipeline ──────────────────────────────────────────────────────────

  private async runPipeline(
    session: SessionAverage,
    ctx: ResolvedContext,
  ): Promise<RuleResult | null> {
    // Stage A — rules that don't depend on averaged vitals. Must run even for
    // AFib patients with <3 readings (the gate below blocks BP/HR rules but
    // must not block med contraindications / symptom overrides).
    const preGateRules: RuleFunction[] = [
      pregnancyAceArbRule,
      ndhpHfrefRule,
      symptomOverridePregnancyRule,
      symptomOverrideGeneralRule,
    ]
    for (const rule of preGateRules) {
      const r = rule(session, ctx)
      if (r) return r
    }

    // AFib ≥3-reading gate — stops BP/HR-dependent rules when session sample
    // size is too small.
    if (ctx.profile.hasAFib && session.readingCount < AlertEngineService.AFIB_MIN_READINGS) {
      this.logger.log(
        `AFib gate: skipping BP/HR rules for entry ${session.entryId} — session has ${session.readingCount}/${AlertEngineService.AFIB_MIN_READINGS} readings.`,
      )
      return null
    }

    // Stage B — BP/HR pipeline. Tachycardia needs cross-session state.
    const priorTachyElevated = await this.wasPriorReadingPulseElevated(session, ctx)
    const tachyRule = buildTachyRule(priorTachyElevated)

    const bpHrRules: RuleFunction[] = [
      absoluteEmergencyRule,
      pregnancyL2Rule,
      pregnancyL1HighRule,
      // dcmRule must precede hfrefRule: both apply to `resolvedHFType=HFREF`,
      // but dcmRule bails when hasHeartFailure=true, so putting it first lets
      // DCM-only patients (biased to HFREF by the resolver) get the DCM-
      // specific message wording. HFrEF patients still route to hfrefRule.
      dcmRule,
      hfrefRule,
      hfpefRule,
      cadRule,
      hcmRule,
      personalizedHighRule,
      personalizedLowRule,
      standardL1HighRule,
      standardL1LowRule,
      afibHrRule,
      tachyRule,
      bradyRule,
      loopDiureticHypotensionRule,
      pulsePressureWideRule,
    ]

    for (const rule of bpHrRules) {
      const r = rule(session, ctx)
      if (r) return r
    }
    return null
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

  // ─── annotations ───────────────────────────────────────────────────────

  private addPhysicianAnnotations(
    result: RuleResult,
    session: SessionAverage,
    ctx: ResolvedContext,
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

    // Bug 1 fix — capture the upserted row so we can emit its real id.
    const upserted = await this.prisma.deviationAlert.upsert({
      where: {
        journalEntryId_type: {
          journalEntryId: session.entryId,
          type: legacyType,
        },
      },
      update: {
        severity: legacySeverity,
        tier: result.tier,
        ruleId: result.ruleId,
        mode: result.mode,
        pulsePressure: result.pulsePressure,
        suboptimalMeasurement: result.suboptimalMeasurement,
        dismissible,
        actualValue:
          result.actualValue != null
            ? new Prisma.Decimal(result.actualValue.toFixed(2))
            : null,
        patientMessage: messages.patientMessage,
        caregiverMessage: messages.caregiverMessage,
        physicianMessage: messages.physicianMessage,
      },
      create: {
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
        actualValue:
          result.actualValue != null
            ? new Prisma.Decimal(result.actualValue.toFixed(2))
            : null,
        patientMessage: messages.patientMessage,
        caregiverMessage: messages.caregiverMessage,
        physicianMessage: messages.physicianMessage,
      },
    })

    this.logger.log(
      `Alert fired: ${result.ruleId} (${result.tier}) for user ${session.userId} — ${result.reason}`,
    )

    this.eventEmitter.emit(JOURNAL_EVENTS.ANOMALY_TRACKED, {
      userId: session.userId,
      alertId: upserted.id,
      type: legacyType,
      severity: legacySeverity,
      escalated: upserted.escalated,
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
      result.ruleId === 'RULE_NDHP_HFREF'
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
