import { Injectable, Logger } from '@nestjs/common'
import {
  getAgeGroup,
  ProfileNotFoundException,
  type ContextMedication,
  type ContextProfile,
  type ContextThreshold,
  type ContextAssignment,
  type DrugClassInput,
  type EffectiveThreshold,
  type HeartFailureTypeInput,
  type MedicationSourceInput,
  type MedicationVerificationStatusInput,
  type ResolvedContext,
  type ThresholdRuleSource,
} from '@cardioplace/shared'
import { PrismaService } from '../../prisma/prisma.service.js'
import { cadDefaultUpper, cadRampApplies } from '../engine/condition-branches.js'

// Item C / Bug 24 — effective-threshold constants mirror the engine rules so the
// dashboard shows the SAME numbers the engine alerts on.
//   pregnancy-thresholds.ts: L1 high 140/90
//   standard.ts:             L1 high 160/100 (AHA target 140/90 + 20 SBP / 10 DBP)
//   personalized.ts:         SBP target + 20 (no DBP-high rule — see note below)
//   condition-branches.ts:   HFrEF default upper 160; CAD DBP-high 80 (ramp)
const PREG_SBP = 140
const PREG_DBP = 90
const HFREF_DEFAULT_UPPER = 160
const STANDARD_HIGH_SBP = 160
const STANDARD_HIGH_DBP = 100
const STANDARD_GOAL_SBP = 140
const STANDARD_GOAL_DBP = 90
const SBP_TOLERANCE = 20
const DBP_TOLERANCE = 10
const CAD_DBP_HIGH = 80

interface ThresholdCandidate {
  sbpAlert: number
  dbpAlert: number
  sbpGoal: number
  dbpGoal: number
  source: ThresholdRuleSource
}

/**
 * Pure computation of the patient's effective high-alert threshold — the lowest
 * point (across every applicable engine rule) at which an alert fires, plus the
 * displayable goal. Mirrors the engine's rule selection so the dashboard never
 * advertises a different alert point than the engine uses.
 *
 * DBP note (flagged for Manisha): the engine's HFrEF and PERSONALIZED rules are
 * SBP-only — there is no dedicated DBP-high rule for those modes. For display we
 * fall back to the standard DBP alert (100) for HFrEF and goal+10 for
 * personalized. SBP (the source of the reported pregnancy bug) is exact.
 */
export function computeEffectiveThreshold(ctx: ResolvedContext): EffectiveThreshold {
  const custom = ctx.threshold
  const candidates: ThresholdCandidate[] = []

  if (ctx.pregnancyThresholdsActive) {
    candidates.push({ sbpAlert: PREG_SBP, dbpAlert: PREG_DBP, sbpGoal: PREG_SBP, dbpGoal: PREG_DBP, source: 'pregnancy' })
  }
  if (ctx.profile.resolvedHFType === 'HFREF') {
    const sbp = custom?.sbpUpperTarget ?? HFREF_DEFAULT_UPPER
    const dbp = custom?.dbpUpperTarget ?? STANDARD_HIGH_DBP // HFrEF is SBP-only in the engine
    candidates.push({ sbpAlert: sbp, dbpAlert: dbp, sbpGoal: sbp, dbpGoal: dbp, source: 'hfref' })
  }
  if (ctx.profile.hasCAD) {
    const sbp = custom?.sbpUpperTarget ?? cadDefaultUpper(ctx)
    const dbp = custom?.dbpUpperTarget ?? (cadRampApplies(ctx) ? CAD_DBP_HIGH : STANDARD_HIGH_DBP)
    candidates.push({ sbpAlert: sbp, dbpAlert: dbp, sbpGoal: sbp, dbpGoal: dbp, source: 'cad' })
  }
  if (ctx.personalizedEligible && custom?.sbpUpperTarget != null) {
    const gSbp = custom.sbpUpperTarget
    const gDbp = custom.dbpUpperTarget ?? STANDARD_GOAL_DBP
    candidates.push({
      sbpAlert: gSbp + SBP_TOLERANCE,
      dbpAlert: gDbp + DBP_TOLERANCE,
      sbpGoal: gSbp,
      dbpGoal: gDbp,
      source: 'personalized',
    })
  }
  if (candidates.length === 0) {
    candidates.push({
      sbpAlert: STANDARD_HIGH_SBP,
      dbpAlert: STANDARD_HIGH_DBP,
      sbpGoal: STANDARD_GOAL_SBP,
      dbpGoal: STANDARD_GOAL_DBP,
      source: 'standard',
    })
  }

  // Effective alert = MIN across applicable rules (the lowest fires first); the
  // displayed goal comes from the rule that binds the SBP alert.
  const sbpHighAlertThreshold = Math.min(...candidates.map((c) => c.sbpAlert))
  const dbpHighAlertThreshold = Math.min(...candidates.map((c) => c.dbpAlert))
  const driving = candidates.reduce((a, b) => (b.sbpAlert < a.sbpAlert ? b : a))

  const overrideReason: EffectiveThreshold['overrideReason'] = ctx.pregnancyThresholdsActive
    ? 'pregnancy'
    : ctx.profile.resolvedHFType === 'HFREF'
      ? 'hfref'
      : ctx.profile.hasCAD
        ? 'cad'
        : null

  return {
    sbpHighAlertThreshold,
    dbpHighAlertThreshold,
    sbpGoal: driving.sbpGoal,
    dbpGoal: driving.dbpGoal,
    toleranceMmHg: overrideReason ? 0 : SBP_TOLERANCE,
    basedOn: candidates.map((c) => c.source),
    overrideReason,
  }
}

/**
 * Phase/4 ProfileResolver — loads the patient's clinical context in a single
 * query and applies the safety-net biases from CLINICAL_SPEC §V2-A Step 3.
 *
 * The rule engine (phase/5) calls `resolve(userId)` once per reading and then
 * reads only from the returned `ResolvedContext`. No further DB access inside
 * the engine pipeline.
 */
@Injectable()
export class ProfileResolverService {
  private readonly logger = new Logger(ProfileResolverService.name)

  // Pre-Day-3 mode threshold (BUILD_PLAN §3.3).
  private static readonly PRE_DAY_3_MIN_READINGS = 7

  constructor(private readonly prisma: PrismaService) {}

  async resolve(userId: string, now: Date = new Date()): Promise<ResolvedContext> {
    // One fat query for everything the engine needs — no N+1.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        patientProfile: true,
        patientThreshold: true,
        // Cluster 8 — pull the practice name for the Q2 CAD-ramp Phase 2
        // ("Cedar Hill first") gate.
        providerAssignmentAsPatient: {
          include: { practice: { select: { name: true } } },
        },
        patientMedications: {
          where: { discontinuedAt: null },
        },
      },
    })

    if (!user || !user.patientProfile) {
      throw new ProfileNotFoundException(userId)
    }

    const readingCount = await this.prisma.journalEntry.count({
      where: { userId },
    })

    const { contextMeds, excludedMeds } = this.splitMedications(user.patientMedications)

    const profile = this.buildProfile(user.patientProfile)
    const threshold = this.buildThreshold(user.patientThreshold)
    const assignment = this.buildAssignment(user.providerAssignmentAsPatient)

    const preDay3Mode = readingCount < ProfileResolverService.PRE_DAY_3_MIN_READINGS
    /**
     * Personalization semantics (per Dr. Singal Q3, 2026-06-02):
     *
     * Personalization requires explicit provider-set PatientThreshold rows.
     * The "Personalization begins after 7 readings" copy in patient-facing UI
     * means providers CAN now set personalized thresholds — it does NOT mean
     * the engine auto-derives them. That is exactly what this line encodes:
     * `personalizedEligible` is true ONLY when a provider-set threshold exists
     * AND the patient has ≥7 readings; it is never derived from the readings.
     *
     * Patients with no condition flags (e.g., isolated essential hypertension)
     * remain on mode=STANDARD indefinitely unless a provider explicitly sets
     * PatientThreshold rows.
     *
     * Auto-derivation is off the table: it could normalize dangerously high BP
     * (example: 7 baseline readings averaging 155/95 → "personalized" threshold
     * at 155 → patient stops getting alerts for clearly out-of-target readings).
     * This crosses from alerting into clinical decision-making — the line we do
     * not cross.
     *
     * Phase 2 (post-MVP, optional): admin dashboard "7+ readings" provider
     * prompt to nudge them to review and consider personalization.
     */
    const personalizedEligible = threshold != null && !preDay3Mode

    // Safety-net: pregnancy thresholds + ACE/ARB contraindication fire even on
    // UNVERIFIED profiles (CLINICAL_SPEC §V2-A Step 3).
    const pregnancyThresholdsActive = profile.isPregnant
    const triggerPregnancyContraindicationCheck = profile.isPregnant

    return {
      userId,
      dateOfBirth: user.dateOfBirth ?? null,
      timezone: user.timezone ?? null,
      ageGroup: getAgeGroup(user.dateOfBirth ?? null, now),
      profile,
      contextMeds,
      excludedMeds,
      threshold,
      assignment,
      readingCount,
      preDay3Mode,
      personalizedEligible,
      pregnancyThresholdsActive,
      triggerPregnancyContraindicationCheck,
      // Cluster 8 — Q2 CAD-ramp + Q3 first-month-nudge inputs.
      enrolledAt: user.enrolledAt ?? null,
      practiceName:
        user.providerAssignmentAsPatient?.practice?.name ?? null,
      // Gap 5 — name the patient in caregiver-facing messages.
      patientName: user.name ?? null,
      resolvedAt: now,
    }
  }

  /**
   * Item C / Bug 24 — the effective high-alert threshold for the dashboard.
   * Resolves the patient's full clinical context, then applies the same rule
   * selection the engine uses, so the displayed alert point matches reality.
   */
  async getEffectiveThreshold(userId: string): Promise<EffectiveThreshold> {
    const ctx = await this.resolve(userId)
    return computeEffectiveThreshold(ctx)
  }

  /**
   * Splits active meds into:
   *  - contextMeds: known drug class, not rejected — engine considers for alerts
   *  - excludedMeds: OTHER_UNVERIFIED / unreviewed voice / photo / rejected —
   *    retained only for provider reconciliation (phase/12)
   *
   * Known-class UNVERIFIED meds stay in contextMeds so suppression logic
   * (beta-blocker HR 50–60) applies. Contraindications respect verification
   * status except the safety-critical ACE/ARB + pregnancy pair — the engine
   * checks `triggerPregnancyContraindicationCheck` for that case.
   *
   * Voice/photo-captured meds are held out of the engine until a provider
   * VERIFIES them — the speech/OCR input itself may be misread, so they
   * must not drive automated alerts on the strength of an unconfirmed
   * capture (CLINICAL_SPEC §V2-A Step 3; intake.service.ts:247-253). They
   * are created as AWAITING_PROVIDER but a later edit can leave them
   * UNVERIFIED, so the gate is "voice/photo AND not VERIFIED" rather than a
   * single status check (RESOLVER-AWAIT fix, 2026-05-21).
   */
  private splitMedications(
    meds: Array<{
      id: string
      drugName: string
      drugClass: string
      isCombination: boolean
      combinationComponents: string[]
      frequency: string
      source: string
      verificationStatus: string
      reportedAt: Date
      discontinuedAt: Date | null
    }>,
  ): { contextMeds: ContextMedication[]; excludedMeds: ContextMedication[] } {
    const contextMeds: ContextMedication[] = []
    const excludedMeds: ContextMedication[] = []

    for (const med of meds) {
      const normalised: ContextMedication = {
        id: med.id,
        drugName: med.drugName,
        drugClass: med.drugClass as DrugClassInput,
        isCombination: med.isCombination,
        combinationComponents: med.combinationComponents as DrugClassInput[],
        frequency: med.frequency as ContextMedication['frequency'],
        source: med.source as MedicationSourceInput,
        verificationStatus: med.verificationStatus as MedicationVerificationStatusInput,
        reportedAt: med.reportedAt,
      }

      const isRejected = normalised.verificationStatus === 'REJECTED'
      const isOtherUnverified = normalised.drugClass === 'OTHER_UNVERIFIED'
      // Voice/photo meds are excluded until a provider VERIFIES them. They are
      // persisted as AWAITING_PROVIDER (not UNVERIFIED), so keying off any
      // single status would miss them — gate on "not VERIFIED" instead.
      const isUnreviewedVoiceOrPhoto =
        normalised.verificationStatus !== 'VERIFIED' &&
        (normalised.source === 'PATIENT_VOICE' || normalised.source === 'PATIENT_PHOTO')

      if (isRejected || isOtherUnverified || isUnreviewedVoiceOrPhoto) {
        excludedMeds.push(normalised)
      } else {
        contextMeds.push(normalised)
      }
    }

    return { contextMeds, excludedMeds }
  }

  private buildProfile(p: {
    gender: string | null
    heightCm: number | null
    isPregnant: boolean
    pregnancyDueDate: Date | null
    historyHDP: boolean
    hasHeartFailure: boolean
    heartFailureType: string
    hasAFib: boolean
    hasCAD: boolean
    hasHCM: boolean
    hasDCM: boolean
    hasAorticStenosis: boolean
    hasTachycardia: boolean
    hasBradycardia: boolean
    diagnosedHypertension: boolean
    profileVerificationStatus: string
    profileVerifiedAt: Date | null
    profileLastEditedAt: Date
  }): ContextProfile {
    const declaredHFType = p.heartFailureType as HeartFailureTypeInput
    const resolvedHFType = this.resolveHFType({
      hasHeartFailure: p.hasHeartFailure,
      heartFailureType: declaredHFType,
      hasDCM: p.hasDCM,
    })

    return {
      gender: p.gender as ContextProfile['gender'],
      heightCm: p.heightCm,
      isPregnant: p.isPregnant,
      pregnancyDueDate: p.pregnancyDueDate,
      historyHDP: p.historyHDP,
      hasHeartFailure: p.hasHeartFailure,
      heartFailureType: declaredHFType,
      resolvedHFType,
      hasAFib: p.hasAFib,
      hasCAD: p.hasCAD,
      hasHCM: p.hasHCM,
      hasDCM: p.hasDCM,
      hasAorticStenosis: p.hasAorticStenosis,
      hasTachycardia: p.hasTachycardia,
      hasBradycardia: p.hasBradycardia,
      diagnosedHypertension: p.diagnosedHypertension,
      verificationStatus: p.profileVerificationStatus as ContextProfile['verificationStatus'],
      verifiedAt: p.profileVerifiedAt,
      lastEditedAt: p.profileLastEditedAt,
    }
  }

  /**
   * Safety-net for ambiguous heart-failure type (CLINICAL_SPEC §4.8, §V2-A).
   * - HF type UNKNOWN → HFREF (more conservative lower bound)
   * - DCM alone → HFREF (DCM is managed as HFrEF per §4.8)
   * - HFREF / HFPEF declared → honour as-is
   */
  private resolveHFType(args: {
    hasHeartFailure: boolean
    heartFailureType: HeartFailureTypeInput
    hasDCM: boolean
  }): HeartFailureTypeInput {
    if (args.hasHeartFailure) {
      if (args.heartFailureType === 'UNKNOWN') return 'HFREF'
      return args.heartFailureType
    }
    if (args.hasDCM) return 'HFREF'
    return 'NOT_APPLICABLE'
  }

  private buildThreshold(
    t: {
      sbpUpperTarget: number | null
      sbpLowerTarget: number | null
      dbpUpperTarget: number | null
      dbpLowerTarget: number | null
      hrUpperTarget: number | null
      hrLowerTarget: number | null
      setByProviderId: string
      setAt: Date
      notes: string | null
    } | null,
  ): ContextThreshold | null {
    if (!t) return null
    return {
      sbpUpperTarget: t.sbpUpperTarget,
      sbpLowerTarget: t.sbpLowerTarget,
      dbpUpperTarget: t.dbpUpperTarget,
      dbpLowerTarget: t.dbpLowerTarget,
      hrUpperTarget: t.hrUpperTarget,
      hrLowerTarget: t.hrLowerTarget,
      setByProviderId: t.setByProviderId,
      setAt: t.setAt,
      notes: t.notes,
    }
  }

  private buildAssignment(
    a: {
      practiceId: string
      primaryProviderId: string
      backupProviderId: string
      medicalDirectorId: string
    } | null,
  ): ContextAssignment | null {
    if (!a) return null
    return {
      practiceId: a.practiceId,
      primaryProviderId: a.primaryProviderId,
      backupProviderId: a.backupProviderId,
      medicalDirectorId: a.medicalDirectorId,
    }
  }
}
