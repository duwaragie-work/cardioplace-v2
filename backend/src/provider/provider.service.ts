import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { getAgeGroup } from '@cardioplace/shared'
import {
  ActorUser,
  PatientAccessService,
} from '../common/patient-access.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { wasEverEnrolled } from '../practice/enrollment-helpers.js'
import { EmailService } from '../email/email.service.js'
import { scheduleCallEmailHtml } from '../email/email-templates.js'
import { UserRole } from '../generated/prisma/enums.js'
import {
  pickDisplayName,
  resolveUserDisplays,
} from '../common/user-name-resolver.js'
import {
  computeNeedsThreshold,
  MANDATORY_CONDITION_FIELDPATHS,
  type ConditionChangeLog,
} from './threshold-need.js'

const SEVERITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }

type DerivedRiskTier = 'STANDARD' | 'ELEVATED' | 'HIGH'

// v2 condition tags surfaced on patient-row payloads. Each tag is a
// distinct comorbidity from the spec — patients can have several. Severity
// drives the admin UI pill color and orders the array within each tier.
//
//   critical  → CLINICAL_SPEC §3 / §4.2 / §4.6 / §4.8: pregnancy, HFrEF,
//               HF subtype-unknown (defaults to HFrEF behavior),
//               HCM, DCM. Threshold table is fundamentally different
//               and/or provider configuration is mandatory.
//   elevated  → §3 preeclampsia-history flag, §4.9 HFpEF: enhanced
//               monitoring or recommended (not mandatory) provider config.
//   standard  → CAD, AFib, diagnosedHypertension: standard adult
//               threshold table applies, no special configuration.
//
// Tachycardia/Bradycardia are NOT included — they're not in the v2 intake
// step (CLINICAL_SPEC §5 step 5: HF/AFib/CAD/HCM/DCM/None), so surfacing
// them here would render fields the patient never had a chance to set.
export type ConditionSeverity = 'critical' | 'elevated' | 'standard'

export interface ConditionTag {
  id: string
  label: string
  severity: ConditionSeverity
}

interface PatientProfileShape {
  // Gender drives pregnancy gating — non-FEMALE patients can't carry an
  // active "Pregnancy" or "Preeclampsia history" condition even if a stale
  // boolean lingers in the row from a prior FEMALE selection.
  gender: string | null
  hasHeartFailure: boolean
  heartFailureType: string | null
  hasAFib: boolean
  hasCAD: boolean
  hasHCM: boolean
  hasDCM: boolean
  hasTachycardia: boolean
  hasBradycardia: boolean
  diagnosedHypertension: boolean
  isPregnant: boolean
  historyHDP: boolean
}

@Injectable()
export class ProviderService {
  private readonly logger = new Logger(ProviderService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly access: PatientAccessService,
  ) {}

  // Age bucketing now delegated to shared/derivatives.ts::getAgeGroup (phase/4).
  // The v1 `derivePrimaryCondition` / `deriveRiskTier` helpers below stay
  // inline — v2 alert rules read structured booleans directly and don't need
  // a "primary condition" string, but the v1 provider dashboard still
  // consumes these. They collapse when Dev 1 rebuilds that surface in
  // phase/11.
  private derivePrimaryCondition(
    profile: PatientProfileShape | null,
  ): string | null {
    if (!profile) return null
    // Pregnancy + preeclampsia history are clinically meaningful only for
    // FEMALE patients — gating here means a stale isPregnant=true boolean
    // on a non-FEMALE row (e.g., a patient who picked FEMALE earlier and
    // later switched to OTHER) doesn't surface a "Pregnancy" pill in the
    // admin patient list / detail header.
    if (profile.gender === 'FEMALE' && profile.isPregnant) return 'Pregnancy'
    if (profile.gender === 'FEMALE' && profile.historyHDP)
      return 'HDP history'
    if (profile.hasHeartFailure) {
      const t = profile.heartFailureType
      if (t === 'HFREF') return 'Heart Failure (HFrEF)'
      if (t === 'HFPEF') return 'Heart Failure (HFpEF)'
      return 'Heart Failure'
    }
    if (profile.hasCAD) return 'CAD'
    if (profile.hasAFib) return 'AFib'
    if (profile.hasHCM) return 'HCM'
    if (profile.hasDCM) return 'DCM'
    if (profile.hasTachycardia) return 'Tachycardia'
    if (profile.hasBradycardia) return 'Bradycardia'
    if (profile.diagnosedHypertension) return 'Hypertension'
    return null
  }

  // v2 replacement for derivePrimaryCondition. Returns every comorbidity
  // the patient carries, ordered by clinical priority (critical → elevated
  // → standard, then the spec's intra-tier ordering). The admin patient
  // header renders these as colored pills so providers see the full
  // clinical picture instead of one synthesised "primary condition" string.
  // Replaces the v1 helper once phase/11's dashboard rebuild lands.
  private derivePatientConditions(
    profile: PatientProfileShape | null,
  ): ConditionTag[] {
    if (!profile) return []
    const tags: ConditionTag[] = []

    // Critical tier — different threshold tables / mandatory provider config.
    if (profile.gender === 'FEMALE' && profile.isPregnant) {
      tags.push({ id: 'pregnancy', label: 'Pregnancy', severity: 'critical' })
    }
    if (profile.hasHeartFailure) {
      if (profile.heartFailureType === 'HFREF') {
        tags.push({ id: 'hfref', label: 'HF (HFrEF)', severity: 'critical' })
      } else if (profile.heartFailureType === 'HFPEF') {
        tags.push({ id: 'hfpef', label: 'HF (HFpEF)', severity: 'elevated' })
      } else {
        // UNKNOWN / NOT_APPLICABLE / null. CLINICAL_SPEC §5: "Heart failure,
        // type unknown → apply HFrEF defaults" — so it's still critical.
        tags.push({ id: 'hf-unknown', label: 'HF (subtype TBD)', severity: 'critical' })
      }
    }
    if (profile.hasHCM) {
      tags.push({ id: 'hcm', label: 'HCM', severity: 'critical' })
    }
    if (profile.hasDCM) {
      tags.push({ id: 'dcm', label: 'DCM', severity: 'critical' })
    }

    // Elevated tier — recommended provider config / notation flag.
    if (profile.gender === 'FEMALE' && profile.historyHDP && !profile.isPregnant) {
      // Hidden during active pregnancy because the Pregnancy tag above
      // already conveys the clinical state — avoids double-flagging the
      // same patient with two related pills.
      tags.push({
        id: 'preeclampsia-history',
        label: 'HDP history',
        severity: 'elevated',
      })
    }

    // Standard tier — standard adult threshold table applies.
    if (profile.hasCAD) {
      tags.push({ id: 'cad', label: 'CAD', severity: 'standard' })
    }
    if (profile.hasAFib) {
      tags.push({ id: 'afib', label: 'AFib', severity: 'standard' })
    }
    if (profile.diagnosedHypertension) {
      tags.push({
        id: 'hypertension',
        label: 'Hypertension',
        severity: 'standard',
      })
    }

    return tags
  }

  private deriveRiskTier(
    profile: PatientProfileShape | null,
    dob: Date | null,
  ): DerivedRiskTier {
    // Preserve v1 default: missing DOB falls through as 40-64 (no
    // age-based escalation). getAgeGroup returns null for null/invalid/
    // under-18 DOBs; `??` keeps that defaulted to the middle bucket.
    const ageGroup = getAgeGroup(dob) ?? '40-64'
    if (!profile) {
      return ageGroup === '65+' ? 'ELEVATED' : 'STANDARD'
    }
    const femalePregnancyRisk =
      profile.gender === 'FEMALE' &&
      (profile.isPregnant || profile.historyHDP)
    if (
      femalePregnancyRisk ||
      profile.hasHeartFailure ||
      profile.hasHCM ||
      profile.hasDCM
    ) {
      return 'HIGH'
    }
    if (
      profile.hasCAD ||
      profile.hasAFib ||
      profile.diagnosedHypertension ||
      ageGroup === '65+'
    ) {
      return 'ELEVATED'
    }
    return 'STANDARD'
  }

  // Translate an incoming `riskTier` filter (string) into a PatientProfile
  // `where` clause equivalent — HIGH → any major cardiac/pregnancy condition,
  // ELEVATED → CAD/AFib/diagnosedHypertension, STANDARD → no conditions.
  private profileWhereForRiskTier(
    riskTier: string,
  ): Record<string, unknown> | null {
    if (riskTier === 'HIGH') {
      return {
        OR: [
          { isPregnant: true },
          { historyHDP: true },
          { hasHeartFailure: true },
          { hasHCM: true },
          { hasDCM: true },
        ],
      }
    }
    if (riskTier === 'ELEVATED') {
      return {
        OR: [
          { hasCAD: true },
          { hasAFib: true },
          { diagnosedHypertension: true },
        ],
      }
    }
    if (riskTier === 'STANDARD') {
      return {
        AND: [
          { isPregnant: false },
          { historyHDP: false },
          { hasHeartFailure: false },
          { hasHCM: false },
          { hasDCM: false },
          { hasCAD: false },
          { hasAFib: false },
          { diagnosedHypertension: false },
        ],
      }
    }
    return null
  }

  private readonly profileSelect = {
    // Gender drives FEMALE-only condition gating (Pregnancy + Preeclampsia
    // history) in derivePatientConditions / derivePrimaryCondition /
    // deriveRiskTier. Without it the Prisma row arrives with `gender`
    // undefined and every `gender === 'FEMALE'` check silently fails — the
    // pregnancy + preeclampsia pills then never render even when the
    // patient is correctly marked pregnant.
    gender: true,
    hasHeartFailure: true,
    heartFailureType: true,
    hasAFib: true,
    hasCAD: true,
    hasHCM: true,
    hasDCM: true,
    hasTachycardia: true,
    hasBradycardia: true,
    diagnosedHypertension: true,
    isPregnant: true,
    historyHDP: true,
    // Phase/8 — Flow K patient list shows the verification status pill in
    // its own column. Including it here keeps downstream callers happy too
    // (they can just ignore the field).
    profileVerificationStatus: true,
  } as const

  // ─── GET /provider/stats ──────────────────────────────────────────────────────

  async getStats(actor: ActorUser) {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    // Role scoping mirrors getPatients / getAlerts. PROVIDER counts only
    // their panel; MED_DIR counts only their practice's patients; OPS/SUPER
    // count everyone. Same patientScopeFilter shape both for direct user
    // queries (totalActivePatients) and for joined queries (alerts/journals
    // need the filter under `user: { is: ... }`).
    const patientScope = await this.access.patientScopeFilter(actor)
    const userWhereScope = patientScope ?? {}
    const joinedWhereScope = patientScope ? { user: { is: patientScope } } : {}

    const [totalActivePatients, monthlyInteractions, activeAlertsCount, readingsThisMonth, recentAlertPatients] =
      await Promise.all([
        // "Enrolled patients" = admin has passed the 4-piece clinical gate,
        // not just that the patient filled their identity onboarding form.
        this.prisma.user.count({
          where: { enrollmentStatus: 'ENROLLED', ...userWhereScope },
        }),
        this.prisma.journalEntry.count({
          where: { createdAt: { gte: startOfMonth }, ...joinedWhereScope },
        }),
        this.prisma.deviationAlert.count({
          where: { status: 'OPEN', ...joinedWhereScope },
        }),
        this.prisma.journalEntry.count({
          where: {
            measuredAt: { gte: startOfMonth },
            systolicBP: { not: null },
            ...joinedWhereScope,
          },
        }),
        this.prisma.deviationAlert.findMany({
          where: {
            status: 'OPEN',
            createdAt: { gte: twentyFourHoursAgo },
            ...joinedWhereScope,
          },
          select: { userId: true },
          distinct: ['userId'],
        }),
      ])

    const usersWithEntries = await this.prisma.user.findMany({
      where: {
        enrollmentStatus: 'ENROLLED',
        journalEntries: { some: {} },
        ...userWhereScope,
      },
      include: {
        journalEntries: {
          orderBy: [{ measuredAt: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          select: { systolicBP: true },
        },
      },
    })

    const totalWithEntries = usersWithEntries.length
    const controlled = usersWithEntries.filter(
      (u) =>
        u.journalEntries[0]?.systolicBP != null &&
        u.journalEntries[0].systolicBP < 130,
    ).length

    const bpControlledPercent =
      totalWithEntries > 0
        ? Math.round((controlled / totalWithEntries) * 100)
        : 0

    return {
      statusCode: 200,
      data: {
        totalActivePatients,
        readingsThisMonth,
        monthlyInteractions,
        activeAlertsCount,
        patientsNeedingAttention: recentAlertPatients.length,
        bpControlledPercent,
      },
    }
  }

  // ─── GET /provider/patients ───────────────────────────────────────────────────

  async getPatients(filters: {
    riskTier?: string
    hasActiveAlerts?: boolean
    /** Caller — drives role-based data scoping via PatientAccessService.
     *  PROVIDER → assigned panel. MED_DIR → patients in headed practices.
     *  OPS / SUPER_ADMIN → unfiltered. May 2026 scope decision. */
    actor: ActorUser
  }) {
    const where: Record<string, unknown> = {
      roles: { has: UserRole.PATIENT },
    }
    if (filters.riskTier) {
      const profileWhere = this.profileWhereForRiskTier(filters.riskTier)
      if (profileWhere) {
        where.patientProfile = { is: profileWhere }
      }
    }
    // Role-scoped filter — see PatientAccessService.patientScopeFilter.
    // Returns undefined for OPS/SUPER (no filter); a Prisma fragment otherwise.
    const scope = await this.access.patientScopeFilter(filters.actor)
    if (scope) {
      Object.assign(where, scope)
    }

    const users = await this.prisma.user.findMany({
      where,
      include: {
        patientProfile: { select: this.profileSelect },
        // Threshold setAt drives the "needs threshold" list signal (missing /
        // stale). Only the timestamp is needed here.
        patientThreshold: { select: { setAt: true } },
        journalEntries: {
          orderBy: [{ measuredAt: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          select: {
            measuredAt: true,
            systolicBP: true,
            diastolicBP: true,
          },
        },
        deviationAlerts: {
          where: { status: 'OPEN' },
          // Tier is needed for the Flow K row badge so the highest-severity
          // open alert can paint the count chip the right color.
          select: { id: true, tier: true },
        },
        escalationEvents: {
          orderBy: { triggeredAt: 'desc' },
          take: 1,
          select: { escalationLevel: true },
        },
      },
    })

    // "Needs threshold" (missing OR stale) signal for the list row tint +
    // filter. One batched query for the condition-change logs of every listed
    // patient, grouped by user, then compared against each threshold's setAt.
    const userIds = users.map((u) => u.id)
    const conditionLogs = userIds.length
      ? await this.prisma.profileVerificationLog.findMany({
          where: {
            userId: { in: userIds },
            fieldPath: { in: [...MANDATORY_CONDITION_FIELDPATHS] },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            userId: true,
            fieldPath: true,
            previousValue: true,
            newValue: true,
            createdAt: true,
          },
        })
      : []
    const logsByUser = new Map<string, ConditionChangeLog[]>()
    for (const l of conditionLogs) {
      const arr = logsByUser.get(l.userId) ?? []
      arr.push(l)
      logsByUser.set(l.userId, arr)
    }

    let patients = users.map((u) => {
      const latestEntry = u.journalEntries[0] ?? null
      const activeAlertsCount = u.deviationAlerts.length
      const escalationLevel = u.escalationEvents[0]?.escalationLevel ?? null
      const profile = (u.patientProfile ?? null) as PatientProfileShape | null

      // Per-tier breakdown used by the Flow K patient list. The frontend
      // colors the alert-count badge by the highest-severity tier present
      // (BP_LEVEL_2 / TIER_1 → red, TIER_2 / BP_LEVEL_1 → amber, TIER_3 → teal).
      const alertsByTier: Record<string, number> = {}
      for (const a of u.deviationAlerts) {
        const key = a.tier ?? 'UNTIERED'
        alertsByTier[key] = (alertsByTier[key] ?? 0) + 1
      }

      return {
        id: u.id,
        // Permanent public identifier (CP-PAT-...). Used by admin UI as the
        // patient's at-a-glance handle and quoted in escalation emails. See
        // docs/UNIQUE_IDENTIFIER_PROPOSAL_2026_06_24.md.
        displayId: u.displayId,
        name: u.name,
        email: u.email,
        riskTier: this.deriveRiskTier(profile, u.dateOfBirth),
        communicationPreference: u.communicationPreference ?? null,
        primaryCondition: this.derivePrimaryCondition(profile),
        // v2 replacement for primaryCondition. Surfaces every comorbidity
        // the patient carries so the admin header can render a row of
        // colored pills instead of one synthesised string. primaryCondition
        // stays in the payload during transition — both fields will live
        // here until phase/11's dashboard rebuild retires the legacy one.
        conditions: this.derivePatientConditions(profile),
        // Surface pregnancy + preeclampsia-history flags directly so the
        // patient list can render the "Preeclampsia history" notation per
        // CLINICAL_SPEC §3 (enhanced-monitoring marker for women with
        // history, even outside pregnancy). Frontend hides the history
        // badge when isPregnant=true so the pregnancy banner takes
        // priority and the row doesn't double-flag. Gated on FEMALE so
        // stale rows from a previously-FEMALE patient don't surface here.
        isPregnant: profile?.gender === 'FEMALE' ? (profile?.isPregnant ?? false) : false,
        historyHDP:
          profile?.gender === 'FEMALE' ? (profile?.historyHDP ?? false) : false,
        onboardingStatus: u.onboardingStatus,
        enrollmentStatus: u.enrollmentStatus,
        // Flow K — surface the patient's profile verification state so the
        // list can render a status pill + power the "Awaiting Verification"
        // quick filter chip without a second round-trip.
        profileVerificationStatus:
          (profile as { profileVerificationStatus?: string } | null)
            ?.profileVerificationStatus ?? null,
        // Threshold-attention signal for the list (missing OR stale). Drives
        // the subtle red row tint + the "Threshold needed" filter chip; matches
        // the per-patient detail-page banner.
        needsThreshold: computeNeedsThreshold({
          profile,
          thresholdSetAt: u.patientThreshold?.setAt ?? null,
          conditionLogs: logsByUser.get(u.id) ?? [],
        }),
        // latestBaseline (rolling snapshot) is gone in v2. Frontend should
        // request the BP trend endpoint when it needs averages.
        latestBaseline: null,
        activeAlertsCount,
        alertsByTier,
        lastEntryDate: latestEntry?.measuredAt ?? null,
        latestBP: latestEntry
          ? {
              systolicBP: latestEntry.systolicBP,
              diastolicBP: latestEntry.diastolicBP,
              entryDate: latestEntry.measuredAt,
              measurementTime: null,
            }
          : null,
        escalationLevel,
      }
    })

    if (filters.hasActiveAlerts != null) {
      patients = patients.filter((p) =>
        filters.hasActiveAlerts
          ? p.activeAlertsCount > 0
          : p.activeAlertsCount === 0,
      )
    }

    return { statusCode: 200, data: patients }
  }

  // ─── GET /provider/patients/:userId/alerts ───────────────────────────────────
  // Per-patient alerts feed with three-tier messages and linked escalation
  // events — used by the Flow H "Alerts" tab. Supports tier + status filters
  // so the UI can flip between OPEN / RESOLVED / All.
  async getPatientAlerts(
    userId: string,
    filters: { status?: string; tier?: string } = {},
  ) {
    const where: Record<string, unknown> = { userId }
    if (filters.status) where.status = filters.status
    if (filters.tier) where.tier = filters.tier

    const alerts = await this.prisma.deviationAlert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        journalEntry: {
          select: {
            measuredAt: true,
            systolicBP: true,
            diastolicBP: true,
            // Weight in kg — admin patient detail computes BMI from
            // weight + PatientProfile.heightCm.
            weight: true,
          },
        },
        escalationEvents: {
          orderBy: { triggeredAt: 'asc' },
          // Flow I — vertical audit-trail timeline needs the recipient list,
          // role list, channel, after-hours flag and per-step Notification
          // children (one per channel/recipient combo).
          select: {
            id: true,
            escalationLevel: true,
            ladderStep: true,
            reason: true,
            triggeredAt: true,
            scheduledFor: true,
            notificationSentAt: true,
            notificationChannel: true,
            recipientIds: true,
            recipientRoles: true,
            acknowledgedAt: true,
            acknowledgedBy: true,
            resolvedAt: true,
            resolvedBy: true,
            afterHours: true,
            triggeredByResolution: true,
            dispatchedBySystem: true,
            notifications: {
              orderBy: { sentAt: 'asc' },
              select: {
                id: true,
                userId: true,
                channel: true,
                title: true,
                sentAt: true,
                readAt: true,
              },
            },
          },
        },
      },
    })

    // Resolve every "by" user-id appearing on the alert (acknowledgedByUserId
    // + resolvedBy) or its escalation events (acknowledgedBy + resolvedBy)
    // into a display name so the admin UI can show "Acknowledged by Aisha
    // Johnson" / "Resolved by Dr. Singal" instead of a truncated UUID. One
    // batched lookup, no N+1.
    const idsToResolve: string[] = []
    for (const a of alerts) {
      if (a.acknowledgedByUserId) idsToResolve.push(a.acknowledgedByUserId)
      if (a.resolvedBy) idsToResolve.push(a.resolvedBy)
      for (const e of a.escalationEvents) {
        if (e.acknowledgedBy) idsToResolve.push(e.acknowledgedBy)
        if (e.resolvedBy) idsToResolve.push(e.resolvedBy)
      }
    }
    const names = await resolveUserDisplays(this.prisma, idsToResolve)

    // Manisha 5/24 Q3 — provider "X of 7" pre-personalization surface. The
    // patient's lifetime reading count drives the admin alert-detail note
    // ("personalization begins after 7 readings; completed X of 7"). One count,
    // attached to every alert in the list.
    const PERSONALIZATION_READINGS = 7
    const lifetimeReadingCount = await this.prisma.journalEntry.count({
      where: { userId },
    })
    const preDay3 = lifetimeReadingCount < PERSONALIZATION_READINGS

    return {
      statusCode: 200,
      data: alerts.map((a) => ({
        id: a.id,
        type: a.type,
        severity: a.severity,
        tier: a.tier,
        ruleId: a.ruleId,
        mode: a.mode,
        pulsePressure: a.pulsePressure,
        suboptimalMeasurement: a.suboptimalMeasurement,
        magnitude: a.magnitude != null ? Number(a.magnitude) : null,
        baselineValue: a.baselineValue ? Number(a.baselineValue) : null,
        actualValue: a.actualValue ? Number(a.actualValue) : null,
        patientMessage: a.patientMessage,
        caregiverMessage: a.caregiverMessage,
        physicianMessage: a.physicianMessage,
        dismissible: a.dismissible,
        escalated: a.escalated,
        status: a.status,
        resolutionAction: a.resolutionAction,
        resolutionRationale: a.resolutionRationale,
        // Alert-level actor identity. acknowledgedByUserId is the patient (or
        // clinician) who acked; resolvedBy is the clinician who resolved.
        // Both resolved to display names so the 15-field audit footer shows
        // "Acknowledged by …" / "Resolved by …" (bug: patient-ack name was
        // previously missing). resolvedAt distinct from acknowledgedAt so the
        // footer can show both timestamps instead of conflating them.
        acknowledgedBy: a.acknowledgedByUserId,
        acknowledgedByName: pickDisplayName(a.acknowledgedByUserId, names),
        resolvedBy: a.resolvedBy,
        resolvedByName: pickDisplayName(a.resolvedBy, names),
        createdAt: a.createdAt,
        acknowledgedAt: a.acknowledgedAt,
        resolvedAt: a.resolvedAt,
        // Manisha 5/24 Q3 — pre-personalization "X of 7" provider surface.
        baselineReadingCount: lifetimeReadingCount,
        personalizationThreshold: PERSONALIZATION_READINGS,
        preDay3,
        journalEntry: a.journalEntry
          ? {
              ...a.journalEntry,
              // Prisma Decimal → number for JSON.
              weight:
                a.journalEntry.weight != null
                  ? Number(a.journalEntry.weight)
                  : null,
            }
          : null,
        escalationEvents: a.escalationEvents.map((e) => ({
          ...e,
          acknowledgedByName: pickDisplayName(e.acknowledgedBy, names),
          resolvedByName: pickDisplayName(e.resolvedBy, names),
        })),
      })),
    }
  }

  // ─── GET /provider/patients/:userId/summary ───────────────────────────────────

  async getPatientSummary(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        patientProfile: { select: this.profileSelect },
        journalEntries: {
          orderBy: [{ measuredAt: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          select: {
            measuredAt: true,
            systolicBP: true,
            diastolicBP: true,
            // Weight is needed for the admin BMI display on the header.
            // BMI = weight ÷ height²; height comes from PatientProfile.
            weight: true,
          },
        },
        deviationAlerts: {
          where: { status: 'OPEN' },
          select: { id: true },
        },
        escalationEvents: {
          orderBy: { triggeredAt: 'desc' },
          take: 1,
          select: { escalationLevel: true },
        },
      },
    })

    if (!user) throw new NotFoundException('Patient not found')

    const latestEntry = user.journalEntries[0] ?? null
    const profile = (user.patientProfile ?? null) as PatientProfileShape | null

    // v2 baseline: trailing 7-day mean, computed inline (not stored).
    const baseline = await this.trailing7dayMean(userId)

    // Manisha sign-off 2026-06-12 — drives the alert-card badge: a NOT_ENROLLED
    // patient who was previously enrolled (auto-un-enrolled on serious-condition
    // add) shows "threshold pending" (dispatch DID fire) rather than the
    // "awaiting enrollment / no dispatch" badge. Only query when un-enrolled.
    const previouslyEnrolled =
      user.enrollmentStatus === 'ENROLLED'
        ? false
        : await wasEverEnrolled(this.prisma, userId)

    const patient = {
      id: user.id,
      // Permanent public identifier (CP-PAT-...). See
      // docs/UNIQUE_IDENTIFIER_PROPOSAL_2026_06_24.md.
      displayId: user.displayId,
      name: user.name,
      email: user.email,
      riskTier: this.deriveRiskTier(profile, user.dateOfBirth),
      communicationPreference: user.communicationPreference ?? null,
      primaryCondition: this.derivePrimaryCondition(profile),
      conditions: this.derivePatientConditions(profile),
      onboardingStatus: user.onboardingStatus,
      enrollmentStatus: user.enrollmentStatus,
      previouslyEnrolled,
      latestBaseline: baseline,
      activeAlertsCount: user.deviationAlerts.length,
      lastEntryDate: latestEntry?.measuredAt ?? null,
      latestBP: latestEntry
        ? {
            systolicBP: latestEntry.systolicBP,
            diastolicBP: latestEntry.diastolicBP,
            // Weight in kg (Prisma Decimal). Converted to plain number so
            // the JSON payload is consumable without a Decimal helper.
            weight: latestEntry.weight != null ? Number(latestEntry.weight) : null,
            entryDate: latestEntry.measuredAt,
            measurementTime: null,
          }
        : null,
      escalationLevel:
        user.escalationEvents[0]?.escalationLevel ?? null,
    }

    const recentEntries = await this.prisma.journalEntry.findMany({
      where: { userId },
      orderBy: [{ measuredAt: 'desc' }, { createdAt: 'desc' }],
      take: 14,
      select: {
        id: true,
        measuredAt: true,
        systolicBP: true,
        diastolicBP: true,
        weight: true,
        medicationTaken: true,
        otherSymptoms: true,
      },
    })

    const activeAlerts = await this.prisma.deviationAlert.findMany({
      where: { userId, status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      include: {
        journalEntry: {
          select: {
            measuredAt: true,
            systolicBP: true,
            diastolicBP: true,
          },
        },
      },
    })

    const activeEscalations = await this.prisma.escalationEvent.findMany({
      where: { userId },
      orderBy: { triggeredAt: 'desc' },
      select: {
        id: true,
        escalationLevel: true,
        reason: true,
        triggeredAt: true,
        notificationSentAt: true,
      },
    })

    return {
      statusCode: 200,
      data: {
        patient,
        recentEntries: recentEntries.map((e) => ({
          id: e.id,
          entryDate: e.measuredAt,
          measurementTime: null,
          systolicBP: e.systolicBP,
          diastolicBP: e.diastolicBP,
          weight: e.weight != null ? Number(e.weight) : null,
          medicationTaken: e.medicationTaken,
          symptoms: e.otherSymptoms,
        })),
        activeAlerts: activeAlerts.map((a) => ({
          id: a.id,
          type: a.type,
          severity: a.severity,
          magnitude: a.magnitude != null ? Number(a.magnitude) : null,
          baselineValue: a.baselineValue ? Number(a.baselineValue) : null,
          actualValue: a.actualValue ? Number(a.actualValue) : null,
          escalated: a.escalated,
          status: a.status,
          createdAt: a.createdAt,
          journalEntry: a.journalEntry
            ? {
                entryDate: a.journalEntry.measuredAt,
                systolicBP: a.journalEntry.systolicBP,
                diastolicBP: a.journalEntry.diastolicBP,
              }
            : null,
        })),
        activeEscalations: activeEscalations.map((e) => ({
          id: e.id,
          level: e.escalationLevel,
          reason: e.reason,
          careTeamMessage: e.reason,
          patientMessage: null,
          createdAt: e.triggeredAt,
        })),
        baseline,
      },
    }
  }

  // ─── GET /provider/patients/:userId/journal ───────────────────────────────────

  async getPatientJournal(userId: string, page: number, limit: number) {
    const skip = (page - 1) * limit

    const [entries, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where: { userId },
        orderBy: [{ measuredAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
        include: {
          // Care-team actor on admin-entered readings (source = ADMIN) —
          // drives the "entered by [staff]" display on the Readings tab.
          addedBy: { select: { name: true, email: true } },
          deviationAlerts: {
            // Tier is required so the admin Readings tab can render the
            // tier badge per linked alert (V2-C). Severity stays for
            // backward compatibility with the dashboard BP-trend panel
            // that already consumes this endpoint.
            select: {
              id: true,
              type: true,
              tier: true,
              // Cluster 8.1 Gap 5 — ruleId lets the admin Readings tab flag a
              // brady-surveillance reading distinctly (the doc's "reading
              // flagged on the trend chart"; admin has no chart so it's a
              // pill on the reading card).
              ruleId: true,
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
      data: entries.map((entry) => {
        // Mirrors session-averager.service.ts hasAnyFalseChecklistItem so
        // the admin Readings tab shows the same flag the rule engine
        // attached when it evaluated the session.
        //
        // Bug #5: the check-in form always sends all 8 checklist keys
        // defaulting to `false`. An all-`false` object means the patient
        // skipped the optional checklist ("not completed"), NOT a suboptimal
        // measurement. Only flag suboptimal when the patient engaged with
        // the checklist (confirmed ≥1 item `true`) and a condition was unmet.
        const conditions = (entry.measurementConditions ?? null) as
          | Record<string, unknown>
          | null
        const failedConditions: string[] = conditions
          ? Object.entries(conditions)
              .filter(([, v]) => v === false)
              .map(([k]) => k)
          : []
        const engagedWithChecklist = conditions
          ? Object.values(conditions).some((v) => v === true)
          : false
        const suboptimalMeasurement =
          engagedWithChecklist && failedConditions.length > 0
        const pulsePressure =
          entry.systolicBP != null && entry.diastolicBP != null
            ? entry.systolicBP - entry.diastolicBP
            : null
        return {
          id: entry.id,
          entryDate: entry.measuredAt,
          measurementTime: null,
          measuredAt: entry.measuredAt,
          sessionId: entry.sessionId,
          systolicBP: entry.systolicBP,
          diastolicBP: entry.diastolicBP,
          pulse: entry.pulse,
          pulsePressure,
          position: entry.position,
          weight: entry.weight != null ? Number(entry.weight) : null,
          medicationTaken: entry.medicationTaken,
          medicationScheduledLater: entry.medicationScheduledLater,
          missedDoses: entry.missedDoses,
          missedMedications: entry.missedMedications,
          // Per-med yes/no/not-due-yet snapshot — lets the admin reading
          // modal rebuild each med's exact answer on edit (same role it
          // plays for the patient app's edit modal).
          medicationStatuses: entry.medicationStatuses,
          // Structured Level-2 symptom booleans (the Readings tab renders
          // these as chips; only true ones are shown).
          severeHeadache: entry.severeHeadache,
          visualChanges: entry.visualChanges,
          alteredMentalStatus: entry.alteredMentalStatus,
          chestPainOrDyspnea: entry.chestPainOrDyspnea,
          focalNeuroDeficit: entry.focalNeuroDeficit,
          severeEpigastricPain: entry.severeEpigastricPain,
          newOnsetHeadache: entry.newOnsetHeadache,
          ruqPain: entry.ruqPain,
          edema: entry.edema,
          symptoms: entry.otherSymptoms,
          otherSymptoms: entry.otherSymptoms,
          measurementConditions: conditions,
          suboptimalMeasurement,
          // Manisha 5/24 Q1 — narrow pulse pressure (<15) recorded at entry as a
          // possible measurement artifact. Physician-only flag, no patient tier.
          narrowPpArtifact: entry.narrowPpArtifact,
          // Option D (Item B) — the AWAITING first-of-pair / CONFIRMATORY
          // second-reading state lets the Readings tab pair them up and flag a
          // large BP discrepancy between the two for provider review.
          emergencyConfirmation: entry.emergencyConfirmation,
          confirmsEntryId: entry.confirmsEntryId,
          failedConditions,
          teachBackAnswer: entry.teachBackAnswer,
          teachBackCorrect: entry.teachBackCorrect,
          notes: entry.notes,
          source: entry.source.toLowerCase(),
          sourceMetadata: entry.sourceMetadata,
          addedByUserId: entry.addedByUserId,
          addedByName: entry.addedBy
            ? (entry.addedBy.name ?? entry.addedBy.email)
            : null,
          baseline: null,
          deviations: entry.deviationAlerts.map((a) => ({
            id: a.id,
            type: a.type,
            tier: a.tier,
            ruleId: a.ruleId,
            severity: a.severity,
            magnitude: a.magnitude != null ? Number(a.magnitude) : null,
            baselineValue: a.baselineValue ? Number(a.baselineValue) : null,
            actualValue: a.actualValue ? Number(a.actualValue) : null,
            escalated: a.escalated,
            status: a.status,
          })),
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        }
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  // ─── GET /provider/patients/:userId/rejected-readings ───────────────────────

  // Manisha 5/24 Q1 — readings rejected at entry (DBP ≥ SBP) are never persisted
  // as JournalEntry rows (they'd trip a false Level-2 emergency), but they ARE
  // logged for QA + provider visibility. The Readings tab surfaces these as an
  // informational note so a provider can see the patient attempted an
  // implausible reading and prompt re-measurement / cuff check.
  async getPatientRejectedReadings(userId: string, limit: number) {
    const logs = await this.prisma.rejectedReadingLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return {
      statusCode: 200,
      message: 'Rejected readings retrieved successfully',
      data: logs.map((log) => ({
        id: log.id,
        systolicBP: log.systolicBP,
        diastolicBP: log.diastolicBP,
        pulse: log.pulse,
        reason: log.reason,
        createdAt: log.createdAt,
      })),
    }
  }

  // ─── GET /provider/patients/:userId/bp-trend ────────────────────────────────

  async getPatientBpTrend(userId: string, startDate: string, endDate: string) {
    // F1: endDate arrives as a calendar date (e.g. "2026-06-01"), which parses to
    // UTC midnight and would exclude every reading taken during that day. Extend
    // the upper bound to the end of the calendar day so the current day is included.
    const endDateObj = new Date(endDate)
    endDateObj.setUTCHours(23, 59, 59, 999)
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        userId,
        measuredAt: {
          gte: new Date(startDate),
          lte: endDateObj,
        },
        systolicBP: { not: null },
      },
      orderBy: [{ measuredAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        measuredAt: true,
        systolicBP: true,
        diastolicBP: true,
      },
    })

    const dateCounts = new Map<string, number>()

    return {
      statusCode: 200,
      data: entries.map((e, i) => {
        const dateLabel = new Date(e.measuredAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })
        const count = (dateCounts.get(dateLabel) ?? 0) + 1
        dateCounts.set(dateLabel, count)
        const day = count > 1 ? `${dateLabel} #${count}` : dateLabel
        return {
          day,
          systolic: e.systolicBP,
          diastolic: e.diastolicBP,
          date: e.measuredAt,
          time: new Date(e.measuredAt).toISOString().slice(11, 16),
          _index: i,
        }
      }),
    }
  }

  // ─── GET /provider/alerts ─────────────────────────────────────────────────────

  async getAlerts(filters: {
    severity?: string
    escalated?: boolean
    /** Caller — drives role-based data scoping. See getPatients. */
    actor: ActorUser
  }) {
    const where: Record<string, unknown> = { status: 'OPEN' }
    if (filters.severity) {
      where.severity = filters.severity
    }
    if (filters.escalated != null) {
      where.escalated = filters.escalated
    }
    // Role-scoped filter — same path as getPatients. patientScopeFilter
    // returns a `providerAssignmentAsPatient` fragment; nest it under `user`
    // because Alert.user is the patient User row.
    const patientScope = await this.access.patientScopeFilter(filters.actor)
    if (patientScope) {
      where.user = { is: patientScope }
    }

    const alerts = await this.prisma.deviationAlert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            dateOfBirth: true,
            communicationPreference: true,
            patientProfile: { select: this.profileSelect },
          },
        },
        journalEntry: {
          select: {
            measuredAt: true,
            systolicBP: true,
            diastolicBP: true,
            // Weight feeds the BMI computation in the resolution audit
            // footer when an alert is expanded inline on /admin/notifications.
            weight: true,
          },
        },
        // CLINICAL_SPEC V2-C Layer 1 — /admin/notifications expands each
        // alert inline with the full escalation audit trail. Mirror the
        // per-patient endpoint's shape so the same AlertCard component
        // works across both surfaces.
        escalationEvents: {
          orderBy: { triggeredAt: 'asc' },
          select: {
            id: true,
            escalationLevel: true,
            ladderStep: true,
            reason: true,
            triggeredAt: true,
            scheduledFor: true,
            notificationSentAt: true,
            notificationChannel: true,
            recipientIds: true,
            recipientRoles: true,
            acknowledgedAt: true,
            acknowledgedBy: true,
            resolvedAt: true,
            resolvedBy: true,
            afterHours: true,
            triggeredByResolution: true,
            dispatchedBySystem: true,
            notifications: {
              orderBy: { sentAt: 'asc' },
              select: {
                id: true,
                userId: true,
                channel: true,
                title: true,
                sentAt: true,
                readAt: true,
              },
            },
          },
        },
      },
    })

    alerts.sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity ?? ''] ?? 3) -
        (SEVERITY_ORDER[b.severity ?? ''] ?? 3),
    )

    const alertIds = alerts.map((a) => a.id)
    const scheduledCalls = alertIds.length
      ? await this.prisma.scheduledCall.findMany({
          where: { alertId: { in: alertIds } },
          orderBy: { createdAt: 'desc' },
          select: {
            alertId: true,
            callDate: true,
            callTime: true,
            callType: true,
            status: true,
            createdAt: true,
          },
        })
      : []

    const followUpMap = new Map<string, (typeof scheduledCalls)[0]>()
    for (const sc of scheduledCalls) {
      if (sc.alertId && !followUpMap.has(sc.alertId)) {
        followUpMap.set(sc.alertId, sc)
      }
    }

    // Resolve every "by" UUID into a display name in one batched lookup so
    // the audit footer + escalation timeline can render "Acknowledged by …"
    // / "Resolved by Dr. Singal" instead of a truncated UUID. Mirrors
    // getPatientAlerts above.
    const idsToResolve: string[] = []
    for (const a of alerts) {
      if (a.acknowledgedByUserId) idsToResolve.push(a.acknowledgedByUserId)
      if (a.resolvedBy) idsToResolve.push(a.resolvedBy)
      for (const e of a.escalationEvents) {
        if (e.acknowledgedBy) idsToResolve.push(e.acknowledgedBy)
        if (e.resolvedBy) idsToResolve.push(e.resolvedBy)
      }
    }
    const names = await resolveUserDisplays(this.prisma, idsToResolve)

    return {
      statusCode: 200,
      data: alerts.map((a) => {
        const followUp = followUpMap.get(a.id)
        const profile = (a.user?.patientProfile ?? null) as PatientProfileShape | null
        return {
          id: a.id,
          type: a.type,
          severity: a.severity,
          magnitude: a.magnitude != null ? Number(a.magnitude) : null,
          baselineValue: a.baselineValue ? Number(a.baselineValue) : null,
          actualValue: a.actualValue ? Number(a.actualValue) : null,
          escalated: a.escalated,
          status: a.status,
          // V2 tier fields — needed by the admin Flow F dashboard for the
          // 3-layer architecture (Layer 1 banners, Layer 2 queue filter,
          // Layer 3 tier-based stats) and the tier-aware resolution modals.
          tier: a.tier,
          ruleId: a.ruleId,
          mode: a.mode,
          pulsePressure: a.pulsePressure,
          suboptimalMeasurement: a.suboptimalMeasurement,
          patientMessage: a.patientMessage,
          // Three-tier messages — V2-C Layer 1 mandates inline rendering
          // on the alert detail surface (PATIENT / CAREGIVER / PHYSICIAN).
          caregiverMessage: a.caregiverMessage,
          physicianMessage: a.physicianMessage,
          dismissible: a.dismissible,
          // 15-field Joint-Commission audit fields. Most are null on OPEN
          // alerts but the shape stays consistent so the AlertCard's
          // expanded body / footer renders the same on both surfaces.
          resolutionAction: a.resolutionAction,
          resolutionRationale: a.resolutionRationale,
          // Alert-level actor identity — mirrors getPatientAlerts so the
          // inline audit footer on /admin/notifications shows the patient who
          // acked + the clinician who resolved, plus a distinct resolvedAt.
          acknowledgedBy: a.acknowledgedByUserId,
          acknowledgedByName: pickDisplayName(a.acknowledgedByUserId, names),
          resolvedBy: a.resolvedBy,
          resolvedByName: pickDisplayName(a.resolvedBy, names),
          createdAt: a.createdAt,
          acknowledgedAt: a.acknowledgedAt,
          resolvedAt: a.resolvedAt,
          followUpScheduledAt: followUp?.createdAt ?? null,
          followUpCallDate: followUp?.callDate ?? null,
          followUpCallTime: followUp?.callTime ?? null,
          followUpCallType: followUp?.callType ?? null,
          followUpStatus: followUp?.status ?? null,
          patient: a.user
            ? {
                id: a.user.id,
                name: a.user.name,
                riskTier: this.deriveRiskTier(profile, a.user.dateOfBirth),
                communicationPreference: a.user.communicationPreference,
              }
            : null,
          journalEntry: a.journalEntry
            ? {
                // entryDate is the legacy field name — kept so the
                // dashboard AlertPanel + scheduled-calls page keep working.
                // measuredAt mirrors the per-patient endpoint shape so
                // AlertCard + EscalationAuditTrail consume the same field.
                entryDate: a.journalEntry.measuredAt,
                measuredAt: a.journalEntry.measuredAt,
                systolicBP: a.journalEntry.systolicBP,
                diastolicBP: a.journalEntry.diastolicBP,
                weight:
                  a.journalEntry.weight != null
                    ? Number(a.journalEntry.weight)
                    : null,
              }
            : null,
          escalationEvents: a.escalationEvents.map((e) => ({
            ...e,
            acknowledgedByName: pickDisplayName(e.acknowledgedBy, names),
            resolvedByName: pickDisplayName(e.resolvedBy, names),
          })),
        }
      }),
    }
  }

  // ─── GET /provider/alerts/:alertId/detail ─────────────────────────────────────

  async getAlertDetail(alertId: string) {
    const alert = await this.prisma.deviationAlert.findUnique({
      where: { id: alertId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            dateOfBirth: true,
            communicationPreference: true,
            patientProfile: { select: this.profileSelect },
          },
        },
        journalEntry: {
          select: {
            measuredAt: true,
            systolicBP: true,
            diastolicBP: true,
            weight: true,
            medicationTaken: true,
          },
        },
        escalationEvents: {
          orderBy: { triggeredAt: 'desc' },
          take: 1,
          select: {
            id: true,
            escalationLevel: true,
            reason: true,
            triggeredAt: true,
          },
        },
      },
    })

    if (!alert) throw new NotFoundException('Alert not found')

    const userId = alert.userId

    const latestBaseline = await this.trailing7dayMean(userId)

    const recentEntries = await this.prisma.journalEntry.findMany({
      where: { userId, systolicBP: { not: null } },
      orderBy: [{ measuredAt: 'desc' }, { createdAt: 'desc' }],
      take: 7,
      select: {
        measuredAt: true,
        systolicBP: true,
        diastolicBP: true,
      },
    })

    const threeDaysAgo = new Date()
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
    const consecutiveAlerts = await this.prisma.deviationAlert.findMany({
      where: {
        userId,
        type: alert.type,
        createdAt: { gte: threeDaysAgo },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        journalEntry: {
          select: { measuredAt: true },
        },
      },
    })

    const medEntries = await this.prisma.journalEntry.findMany({
      where: {
        userId,
        measuredAt: { gte: threeDaysAgo },
        medicationTaken: { not: null },
      },
      orderBy: { measuredAt: 'desc' },
      take: 3,
      select: {
        measuredAt: true,
        medicationTaken: true,
      },
    })

    const baselineSystolic = latestBaseline?.baselineSystolic ?? null
    const baselineDiastolic = latestBaseline?.baselineDiastolic ?? null

    const triggerReasons: string[] = []

    const baselineStr =
      baselineSystolic != null && baselineDiastolic != null
        ? `${Math.round(baselineSystolic)}/${Math.round(baselineDiastolic)}`
        : 'N/A'
    const readingStr =
      alert.journalEntry?.systolicBP != null &&
      alert.journalEntry?.diastolicBP != null
        ? `${alert.journalEntry.systolicBP}/${alert.journalEntry.diastolicBP}`
        : '—'
    triggerReasons.push(
      `Elevated BP: ${readingStr} (Baseline: ${baselineStr})`,
    )

    if (consecutiveAlerts.length >= 2) {
      const dates = consecutiveAlerts
        .map((a) => {
          const d = a.journalEntry?.measuredAt ?? a.createdAt
          return new Date(d).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })
        })
        .join(', ')
      triggerReasons.push(
        `${consecutiveAlerts.length} consecutive elevated readings — ${dates}`,
      )
    }

    const missedCount = medEntries.filter((e) => e.medicationTaken === false).length
    if (missedCount > 0) {
      triggerReasons.push(
        `Medication missed: ${missedCount} of last ${medEntries.length} days`,
      )
    }

    const entryCount = recentEntries.length
    const bpValues = recentEntries
      .filter((e) => e.systolicBP != null)
      .map((e) => e.systolicBP as number)
    let trendDirection = 'stable'
    if (bpValues.length >= 3) {
      const first = bpValues[bpValues.length - 1]
      const last = bpValues[0]
      if (last - first > 5) trendDirection = 'an upward'
      else if (first - last > 5) trendDirection = 'a downward'
    }

    const medAdherence =
      missedCount > 0
        ? `concurrent medication non-adherence (${missedCount} missed doses)`
        : 'consistent medication adherence'

    const action =
      alert.severity === 'HIGH'
        ? 'Recommend immediate clinical review and patient contact'
        : 'Recommend proactive care team outreach within 24 hours'

    const aiSummary = `Patient shows ${trendDirection} BP trend over the last ${entryCount} readings with ${medAdherence}. ${action} to assess current cardiovascular status.`

    const commPref = alert.user?.communicationPreference ?? 'STANDARD'

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const bpTrend = [...recentEntries].reverse().map((e) => ({
      day: dayNames[new Date(e.measuredAt).getDay()],
      systolic: e.systolicBP,
      diastolic: e.diastolicBP,
      date: e.measuredAt,
    }))

    const profile = (alert.user?.patientProfile ?? null) as PatientProfileShape | null

    return {
      statusCode: 200,
      data: {
        id: alert.id,
        type: alert.type,
        severity: alert.severity,
        magnitude: alert.magnitude != null ? Number(alert.magnitude) : null,
        baselineValue: alert.baselineValue
          ? Number(alert.baselineValue)
          : null,
        actualValue: alert.actualValue ? Number(alert.actualValue) : null,
        escalated: alert.escalated,
        status: alert.status,
        createdAt: alert.createdAt,
        patient: {
          id: alert.user?.id ?? '',
          name: alert.user?.name ?? 'Unknown',
          dateOfBirth: alert.user?.dateOfBirth ?? null,
          communicationPreference: commPref ?? null,
          riskTier: this.deriveRiskTier(profile, alert.user?.dateOfBirth ?? null),
        },
        journalEntry: alert.journalEntry
          ? {
              entryDate: alert.journalEntry.measuredAt,
              systolicBP: alert.journalEntry.systolicBP,
              diastolicBP: alert.journalEntry.diastolicBP,
            }
          : null,
        baseline: {
          systolic: baselineSystolic,
          diastolic: baselineDiastolic,
        },
        triggerReasons,
        aiSummary,
        communication: {
          preference: commPref,
        },
        bpTrend,
        escalation: alert.escalationEvents[0]
          ? {
              level: alert.escalationEvents[0].escalationLevel,
              reason: alert.escalationEvents[0].reason,
            }
          : null,
      },
    }
  }

  // ─── POST /provider/schedule-call ───────────────────────────────────────────────

  async scheduleCall(body: {
    patientUserId: string
    alertId?: string
    callDate: string
    callTime: string
    callType: string
    notes?: string
  }) {
    const patient = await this.prisma.user.findUnique({
      where: { id: body.patientUserId },
      select: { id: true, email: true, name: true },
    })
    if (!patient) throw new NotFoundException('Patient not found')

    const scheduledCall = await this.prisma.scheduledCall.create({
      data: {
        userId: body.patientUserId,
        alertId: body.alertId ?? null,
        callDate: body.callDate,
        callTime: body.callTime,
        callType: body.callType,
        notes: body.notes ?? null,
        status: 'UPCOMING',
      },
    })

    const notifTitle = 'Follow-up Call Scheduled'
    const notifBody = `Your care team has scheduled a ${body.callType} call on ${body.callDate} at ${body.callTime}.${body.notes ? ` Note: ${body.notes}` : ''}`

    await this.prisma.notification.create({
      data: {
        userId: body.patientUserId,
        alertId: body.alertId ?? null,
        channel: 'PUSH',
        title: notifTitle,
        body: notifBody,
        tips: [],
      },
    })

    if (patient.email) {
      await this.prisma.notification.create({
        data: {
          userId: body.patientUserId,
          alertId: body.alertId ?? null,
          channel: 'EMAIL',
          title: notifTitle,
          body: notifBody,
          tips: [],
        },
      })

      await this.emailService.sendEmail(
        patient.email,
        'Follow-up Call Scheduled — Cardioplace',
        scheduleCallEmailHtml(
          patient.name ?? 'Patient',
          body.callType,
          body.callDate,
          body.callTime,
        ),
      )
    } else {
      this.logger.warn(
        `No email for patient ${body.patientUserId} — skipping email notification`,
      )
    }

    return {
      statusCode: 201,
      message: 'Call scheduled. Patient notified.',
      data: { scheduledCallId: scheduledCall.id },
    }
  }

  // ─── PATCH /provider/alerts/:alertId/acknowledge ──────────────────────────────

  async acknowledgeAlert(alertId: string, adminId: string) {
    const alert = await this.prisma.deviationAlert.findUnique({
      where: { id: alertId },
    })

    if (!alert) throw new NotFoundException('Alert not found')

    if (alert.status === 'ACKNOWLEDGED') {
      return {
        statusCode: 200,
        message: 'Alert already acknowledged',
        data: {
          id: alert.id,
          status: alert.status,
          acknowledgedAt: alert.acknowledgedAt,
        },
      }
    }

    const now = new Date()
    const updated = await this.prisma.deviationAlert.update({
      where: { id: alertId },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: now,
        // Phase 1 polish Finding 1 — record WHO acked at the alert level so
        // the 15-field audit footer resolves "Acknowledged by Dr. …". Was
        // omitted: only patient-ack (daily_journal.service) set this.
        acknowledgedByUserId: adminId,
      },
    })
    // Phase 1 polish Finding 3 — propagate the ack to every open
    // EscalationEvent so the audit timeline + step badges reflect it
    // (mirrors the patient-ack propagation + alert-resolution.service).
    await this.prisma.escalationEvent.updateMany({
      where: { alertId, acknowledgedAt: null, resolvedAt: null },
      data: { acknowledgedAt: now, acknowledgedBy: adminId },
    })

    return {
      statusCode: 200,
      message: 'Alert acknowledged',
      data: {
        id: updated.id,
        status: updated.status,
        acknowledgedAt: updated.acknowledgedAt,
      },
    }
  }

  // ─── GET /provider/scheduled-calls ──────────────────────────────────────────

  async getScheduledCalls(filters: { status?: string }) {
    const where: Record<string, unknown> = {}
    if (filters.status) {
      where.status = filters.status.toUpperCase()
    }

    const calls = await this.prisma.scheduledCall.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            dateOfBirth: true,
            patientProfile: { select: this.profileSelect },
          },
        },
        deviationAlert: {
          select: {
            id: true,
            type: true,
            severity: true,
            status: true,
            createdAt: true,
            journalEntry: {
              select: { systolicBP: true, diastolicBP: true, measuredAt: true },
            },
          },
        },
      },
    })

    return {
      statusCode: 200,
      data: calls.map((c) => {
        const profile = (c.user?.patientProfile ?? null) as PatientProfileShape | null
        return {
          id: c.id,
          callDate: c.callDate,
          callTime: c.callTime,
          callType: c.callType,
          notes: c.notes,
          status: c.status.toLowerCase(),
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          patient: c.user
            ? {
                id: c.user.id,
                name: c.user.name,
                email: c.user.email,
                riskTier: this.deriveRiskTier(profile, c.user.dateOfBirth),
              }
            : null,
          alert: c.deviationAlert
            ? {
                id: c.deviationAlert.id,
                type: c.deviationAlert.type,
                severity: c.deviationAlert.severity,
                alertStatus: c.deviationAlert.status,
                createdAt: c.deviationAlert.createdAt,
                journalEntry: c.deviationAlert.journalEntry
                  ? {
                      systolicBP: c.deviationAlert.journalEntry.systolicBP,
                      diastolicBP: c.deviationAlert.journalEntry.diastolicBP,
                      entryDate: c.deviationAlert.journalEntry.measuredAt,
                    }
                  : null,
              }
            : null,
        }
      }),
    }
  }

  // ─── PATCH /provider/scheduled-calls/:id/status ─────────────────────────────

  async updateCallStatus(id: string, status: string) {
    const validStatuses = ['UPCOMING', 'COMPLETED', 'MISSED', 'CANCELLED']
    const upper = status.toUpperCase()
    if (!validStatuses.includes(upper)) {
      throw new NotFoundException(`Invalid status: ${status}`)
    }

    const call = await this.prisma.scheduledCall.findUnique({ where: { id } })
    if (!call) throw new NotFoundException('Scheduled call not found')

    const updated = await this.prisma.scheduledCall.update({
      where: { id },
      data: { status: upper as 'UPCOMING' | 'COMPLETED' | 'MISSED' | 'CANCELLED' },
    })

    return { statusCode: 200, data: { id: updated.id, status: updated.status } }
  }

  // ─── DELETE /provider/scheduled-calls/:id ───────────────────────────────────

  async deleteScheduledCall(id: string) {
    const call = await this.prisma.scheduledCall.findUnique({ where: { id } })
    if (!call) throw new NotFoundException('Scheduled call not found')

    await this.prisma.scheduledCall.delete({ where: { id } })
    return { statusCode: 200, message: 'Scheduled call deleted' }
  }

  // ─── Private: trailing 7-day BP mean (v2 replacement for BaselineSnapshot) ─
  private async trailing7dayMean(
    userId: string,
  ): Promise<{ baselineSystolic: number; baselineDiastolic: number } | null> {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const entries = await this.prisma.journalEntry.findMany({
      where: {
        userId,
        measuredAt: { gte: sevenDaysAgo },
        systolicBP: { not: null },
        diastolicBP: { not: null },
      },
      select: { systolicBP: true, diastolicBP: true },
    })

    if (entries.length === 0) return null

    const sbp = Math.round(
      entries.reduce((a, e) => a + (e.systolicBP as number), 0) / entries.length,
    )
    const dbp = Math.round(
      entries.reduce((a, e) => a + (e.diastolicBP as number), 0) / entries.length,
    )
    return { baselineSystolic: sbp, baselineDiastolic: dbp }
  }
}
