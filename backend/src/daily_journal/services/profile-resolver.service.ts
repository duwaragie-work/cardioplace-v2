import { Injectable, Logger } from '@nestjs/common'
import {
  getAgeGroup,
  ProfileNotFoundException,
  type ContextMedication,
  type ContextProfile,
  type ContextThreshold,
  type ContextAssignment,
  type DrugClassInput,
  type HeartFailureTypeInput,
  type MedicationSourceInput,
  type MedicationVerificationStatusInput,
  type ResolvedContext,
} from '@cardioplace/shared'
import { PrismaService } from '../../prisma/prisma.service.js'

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
        providerAssignmentAsPatient: true,
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
      resolvedAt: now,
    }
  }

  /**
   * Splits active meds into:
   *  - contextMeds: known drug class, not rejected — engine considers for alerts
   *  - excludedMeds: OTHER_UNVERIFIED / voice / photo unverified / rejected —
   *    retained only for provider reconciliation (phase/12)
   *
   * Known-class UNVERIFIED meds stay in contextMeds so suppression logic
   * (beta-blocker HR 50–60) applies. Contraindications respect verification
   * status except the safety-critical ACE/ARB + pregnancy pair — the engine
   * checks `triggerPregnancyContraindicationCheck` for that case.
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
      const isUnverifiedVoiceOrPhoto =
        normalised.verificationStatus === 'UNVERIFIED' &&
        (normalised.source === 'PATIENT_VOICE' || normalised.source === 'PATIENT_PHOTO')

      if (isRejected || isOtherUnverified || isUnverifiedVoiceOrPhoto) {
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
    historyPreeclampsia: boolean
    hasHeartFailure: boolean
    heartFailureType: string
    hasAFib: boolean
    hasCAD: boolean
    hasHCM: boolean
    hasDCM: boolean
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
      historyPreeclampsia: p.historyPreeclampsia,
      hasHeartFailure: p.hasHeartFailure,
      heartFailureType: declaredHFType,
      resolvedHFType,
      hasAFib: p.hasAFib,
      hasCAD: p.hasCAD,
      hasHCM: p.hasHCM,
      hasDCM: p.hasDCM,
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
