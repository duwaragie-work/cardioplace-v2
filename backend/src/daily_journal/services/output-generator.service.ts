import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import {
  ALL_RULE_IDS,
  alertMessageRegistry,
  type AlertContext,
  type RuleId,
} from '@cardioplace/shared'
import type { RuleResult, SessionAverage } from '../engine/types.js'

/**
 * Phase/6 OutputGenerator — single consumer of the shared alert-messages
 * registry. The orchestrator (AlertEngine) calls `generate()` after a rule
 * fires; the returned trio lands on DeviationAlert.{patient,caregiver,physician}Message.
 *
 * Startup contract: `onModuleInit()` verifies every `RuleId` in
 * ALL_RULE_IDS has a registry entry. If any rule is missing its messages,
 * the backend refuses to boot — this keeps the contract tight as new rules
 * are added in future phases.
 */
@Injectable()
export class OutputGeneratorService implements OnModuleInit {
  private readonly logger = new Logger(OutputGeneratorService.name)

  onModuleInit(): void {
    const missing: RuleId[] = []
    for (const ruleId of ALL_RULE_IDS) {
      const entry = alertMessageRegistry[ruleId]
      if (
        !entry ||
        typeof entry.patientMessage !== 'function' ||
        typeof entry.caregiverMessage !== 'function' ||
        typeof entry.physicianMessage !== 'function'
      ) {
        missing.push(ruleId)
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `OutputGeneratorService: alertMessageRegistry is missing entries for rule(s): ${missing.join(
          ', ',
        )}. Add them to shared/src/alert-messages.ts before booting.`,
      )
    }
    this.logger.log(
      `alertMessageRegistry verified: ${ALL_RULE_IDS.length} rules, all 3 tiers populated.`,
    )
  }

  generate(
    result: RuleResult,
    session: SessionAverage,
    preDay3: boolean,
  ): {
    patientMessage: string
    caregiverMessage: string
    physicianMessage: string
  } {
    const entry = alertMessageRegistry[result.ruleId]
    const ctx = this.buildContext(result, session, preDay3)
    return {
      patientMessage: entry.patientMessage(ctx),
      caregiverMessage: entry.caregiverMessage(ctx),
      physicianMessage: entry.physicianMessage(ctx),
    }
  }

  private buildContext(
    result: RuleResult,
    session: SessionAverage,
    preDay3: boolean,
  ): AlertContext {
    return {
      systolicBP: session.systolicBP,
      diastolicBP: session.diastolicBP,
      pulse: session.pulse,
      pulsePressure: result.pulsePressure,
      drugName: result.metadata.drugName ?? null,
      drugClass: result.metadata.drugClass ?? null,
      conditionLabel: result.metadata.conditionLabel ?? null,
      thresholdValue: result.metadata.thresholdValue ?? null,
      physicianAnnotations: result.metadata.physicianAnnotations ?? [],
      preDay3,
      suboptimalMeasurement: result.suboptimalMeasurement,
      // Surface per-medication miss detail for RULE_MEDICATION_MISSED messages.
      // Strip medicationId (internal) and narrow reason to the union the
      // message registry expects.
      missedMedications: result.metadata.missedMedications?.map((m) => ({
        drugName: m.drugName,
        drugClass: m.drugClass,
        reason: m.reason,
        missedDoses: m.missedDoses,
      })),
    }
  }
}
