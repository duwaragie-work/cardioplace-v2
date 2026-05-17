// Phase 0 §G — pre-seeded mixed state (alerts / notifications / audit).
//
// DEV/TEST ONLY. run.ts only calls this when NODE_ENV !== 'production';
// the early return below is a belt-and-braces second guard.
//
// Idempotency strategy: every row this module owns carries a stable
// `seed-{alert,notif,audit}-*` id. We wipe-by-id-prefix then recreate the
// exact set, so re-running is a deterministic no-op regardless of the
// JournalEntry cascade (seedPatients wipes+recreates persona entries each
// run, which onDelete:Cascade-drops any alert bound to them — recreated
// here afterwards). Filler-alert entries use a FIXED measuredAt so their
// upsert matches across runs.
//
// Enum note: real schema enums, NOT the plan's strings —
//   AlertStatus  = OPEN | ACKNOWLEDGED | RESOLVED      (no "ACTIVE")
//   AlertTier    = …BP_LEVEL_1_HIGH | BP_LEVEL_2 …      (no "BP_L1_HIGH")
//   VerificationChangeType has NO ALERT_* members — alert lifecycle audit
//   lives on DeviationAlert.{acknowledged,resolved}*; ProfileVerificationLog
//   only records profile/medication/threshold/assignment changes. The plan's
//   ALERT_ACKNOWLEDGED / ALERT_RESOLVED audit rows are therefore adapted to
//   ADMIN_ASSIGNMENT_CHANGE / ADMIN_CORRECT (see STATUS_2026_05_17.md §G).
import {
  prisma,
  daysAgo,
  hoursAgo,
  minutesAgo,
} from './helpers.js'
import type { SeededPractices } from './practices.js'
import type { SeededAdmins } from './admins.js'
import { fillerEmail } from './fillers.js'

const FILLER_ALERT_MEASURED_AT = new Date('2026-05-15T12:00:00.000Z')

type AlertSpec = {
  id: string
  userId: string
  journalEntryId: string
  tier:
    | 'TIER_1_CONTRAINDICATION'
    | 'TIER_2_DISCREPANCY'
    | 'TIER_3_INFO'
    | 'BP_LEVEL_1_HIGH'
    | 'BP_LEVEL_2'
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'
  ruleId: string
  createdAt: Date
  acknowledgedAt?: Date
  acknowledgedByUserId?: string
  resolvedAt?: Date
  resolvedBy?: string
  resolutionAction?: string
  resolutionRationale?: string
}

export async function seedState(
  _practices: SeededPractices,
  admins: SeededAdmins,
): Promise<void> {
  if (process.env.NODE_ENV === 'production') return

  const { medicalDirector, supportAdmin, manishaPatel, primaryProvider } =
    admins

  const byEmail = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (!u) throw new Error(`seedState: user not found ${email}`)
    return u.id
  }
  const latestEntryId = async (userId: string) => {
    const e = await prisma.journalEntry.findFirst({
      where: { userId },
      orderBy: { measuredAt: 'desc' },
      select: { id: true },
    })
    if (!e) throw new Error(`seedState: no journal entry for ${userId}`)
    return e.id
  }

  const aishaId = await byEmail('aisha.johnson@cardioplace.test')
  const jamesId = await byEmail('james.okafor@cardioplace.test')
  const mikeId = await byEmail('mike.peterson@cardioplace.test')

  // ─── Wipe prior seed-state (idempotency) ─────────────────────────────────
  await prisma.deviationAlert.deleteMany({ where: { id: { startsWith: 'seed-alert-' } } })
  await prisma.notification.deleteMany({ where: { id: { startsWith: 'seed-notif-' } } })
  await prisma.profileVerificationLog.deleteMany({ where: { id: { startsWith: 'seed-audit-' } } })

  // ─── G.1 — mixed-state alerts (7 personas + 5 fillers = 12) ──────────────
  const aishaEntry = await latestEntryId(aishaId)
  const jamesEntry = await latestEntryId(jamesId)
  const mikeEntry = await latestEntryId(mikeId)

  const specs: AlertSpec[] = [
    // Aisha — one of every status × representative tiers
    {
      id: 'seed-alert-aisha-1', userId: aishaId, journalEntryId: aishaEntry,
      tier: 'BP_LEVEL_1_HIGH', status: 'OPEN', ruleId: 'SEED_BP_L1_HIGH',
      createdAt: hoursAgo(2),
    },
    {
      id: 'seed-alert-aisha-2', userId: aishaId, journalEntryId: aishaEntry,
      tier: 'TIER_1_CONTRAINDICATION', status: 'ACKNOWLEDGED', ruleId: 'SEED_TIER1',
      createdAt: daysAgo(2), acknowledgedAt: daysAgo(1),
      acknowledgedByUserId: medicalDirector.id,
    },
    {
      id: 'seed-alert-aisha-3', userId: aishaId, journalEntryId: aishaEntry,
      tier: 'TIER_2_DISCREPANCY', status: 'RESOLVED', ruleId: 'SEED_TIER2',
      createdAt: daysAgo(4), resolvedAt: daysAgo(3), resolvedBy: medicalDirector.id,
      resolutionAction: 'REPEAT_NORMAL', resolutionRationale: 'Reading repeated, normal',
    },
    {
      id: 'seed-alert-aisha-4', userId: aishaId, journalEntryId: aishaEntry,
      tier: 'BP_LEVEL_2', status: 'OPEN', ruleId: 'SEED_BP_L2',
      createdAt: minutesAgo(30),
    },
    // James — open Tier 1 + resolved Tier 3
    {
      id: 'seed-alert-james-1', userId: jamesId, journalEntryId: jamesEntry,
      tier: 'TIER_1_CONTRAINDICATION', status: 'OPEN', ruleId: 'SEED_TIER1',
      createdAt: hoursAgo(3),
    },
    {
      id: 'seed-alert-james-2', userId: jamesId, journalEntryId: jamesEntry,
      tier: 'TIER_3_INFO', status: 'RESOLVED', ruleId: 'SEED_TIER3',
      createdAt: daysAgo(6), resolvedAt: daysAgo(5), resolvedBy: medicalDirector.id,
      resolutionAction: 'ACKNOWLEDGE', resolutionRationale: 'Informational — no action needed',
    },
    // Mike — single open Tier 2
    {
      id: 'seed-alert-mike-1', userId: mikeId, journalEntryId: mikeEntry,
      tier: 'TIER_2_DISCREPANCY', status: 'OPEN', ruleId: 'SEED_TIER2',
      createdAt: hoursAgo(5),
    },
  ]

  // 5 filler-alert-* patients each get one OPEN BP L1 alert. They have no
  // readings, so create their (single) JournalEntry here at a FIXED time so
  // the upsert is idempotent across re-seeds.
  for (let n = 1; n <= 5; n++) {
    const fid = await byEmail(fillerEmail('filler-alert', n))
    const je = await prisma.journalEntry.upsert({
      where: { userId_measuredAt: { userId: fid, measuredAt: FILLER_ALERT_MEASURED_AT } },
      update: {},
      create: {
        userId: fid,
        measuredAt: FILLER_ALERT_MEASURED_AT,
        systolicBP: 148,
        diastolicBP: 94,
        pulse: 78,
        position: 'SITTING',
        medicationTaken: true,
      },
      select: { id: true },
    })
    specs.push({
      id: `seed-alert-filler-${n}`, userId: fid, journalEntryId: je.id,
      tier: 'BP_LEVEL_1_HIGH', status: 'OPEN', ruleId: 'SEED_BP_L1_HIGH',
      createdAt: hoursAgo(6),
    })
  }

  for (const s of specs) {
    await prisma.deviationAlert.create({
      data: {
        id: s.id,
        userId: s.userId,
        journalEntryId: s.journalEntryId,
        tier: s.tier,
        mode: 'STANDARD',
        ruleId: s.ruleId,
        status: s.status,
        dismissible: true,
        createdAt: s.createdAt,
        acknowledgedAt: s.acknowledgedAt ?? null,
        acknowledgedByUserId: s.acknowledgedByUserId ?? null,
        resolvedAt: s.resolvedAt ?? null,
        resolvedBy: s.resolvedBy ?? null,
        resolutionAction: s.resolutionAction ?? null,
        resolutionRationale: s.resolutionRationale ?? null,
        patientMessage: `[seed] ${s.tier} ${s.status} — patient copy`,
        caregiverMessage: `[seed] ${s.tier} ${s.status} — caregiver copy`,
        physicianMessage: `[seed] ${s.tier} ${s.status} — physician copy`,
      },
    })
  }

  // ─── G.2 — notifications (badge-count fixtures) ──────────────────────────
  // medical-director: 9 (exact "9" badge) · manisha.patel: 15 ("9+") ·
  // primary-provider: 3 (small, no overflow) · backup-provider: 0 (empty).
  const CHANNELS = ['DASHBOARD', 'PUSH', 'EMAIL'] as const
  const mkNotifs = async (prefix: string, userId: string, count: number) => {
    for (let i = 1; i <= count; i++) {
      await prisma.notification.create({
        data: {
          id: `${prefix}-${i}`,
          userId,
          channel: CHANNELS[i % CHANNELS.length],
          title: `Seed notification ${i}`,
          body: `Pre-seeded unread notification ${i} for badge-count tests.`,
          tips: [],
          sentAt: minutesAgo(count - i + 1),
          readAt: null,
        },
      })
    }
  }
  await mkNotifs('seed-notif-md', medicalDirector.id, 9)
  await mkNotifs('seed-notif-manisha', manishaPatel.id, 15)
  await mkNotifs('seed-notif-primary', primaryProvider.id, 3)
  // backup-provider intentionally gets none → empty-state test.

  // ─── G.3 — audit trail (5 ProfileVerificationLog rows, ~14d span) ────────
  const auditRows = [
    {
      id: 'seed-audit-aisha-1', changeType: 'ADMIN_VERIFY' as const,
      changedByRole: 'ADMIN' as const, changedBy: supportAdmin.id,
      fieldPath: 'profile', previousValue: null, newValue: { profileVerificationStatus: 'VERIFIED' },
      createdAt: daysAgo(14), rationale: 'Initial profile verification',
    },
    {
      id: 'seed-audit-aisha-2', changeType: 'ADMIN_VERIFY' as const,
      changedByRole: 'ADMIN' as const, changedBy: supportAdmin.id,
      fieldPath: 'medication.Lisinopril', previousValue: { verificationStatus: 'UNVERIFIED' },
      newValue: { verificationStatus: 'VERIFIED' },
      createdAt: daysAgo(10), rationale: 'Lisinopril verified against pharmacy fill',
    },
    {
      id: 'seed-audit-aisha-3', changeType: 'ADMIN_THRESHOLD_UPDATE' as const,
      changedByRole: 'PROVIDER' as const, changedBy: medicalDirector.id,
      fieldPath: 'threshold.sbpUpperTarget', previousValue: { sbpUpperTarget: 140 },
      newValue: { sbpUpperTarget: 135 },
      createdAt: daysAgo(7), rationale: 'Tightened SBP target after office visit',
    },
    {
      id: 'seed-audit-aisha-4', changeType: 'ADMIN_ASSIGNMENT_CHANGE' as const,
      changedByRole: 'ADMIN' as const, changedBy: supportAdmin.id,
      fieldPath: 'assignment.primaryProvider', previousValue: null,
      newValue: { primaryProviderId: primaryProvider.id },
      createdAt: daysAgo(5), rationale: 'Care-team assignment confirmed',
    },
    {
      id: 'seed-audit-aisha-5', changeType: 'ADMIN_CORRECT' as const,
      changedByRole: 'PROVIDER' as const, changedBy: medicalDirector.id,
      fieldPath: 'profile.heightCm', previousValue: { heightCm: 165 },
      newValue: { heightCm: 163 }, discrepancyFlag: true,
      createdAt: daysAgo(3), rationale: 'Height corrected from chart',
    },
  ]
  for (const a of auditRows) {
    await prisma.profileVerificationLog.create({
      data: {
        id: a.id,
        userId: aishaId,
        fieldPath: a.fieldPath,
        previousValue: a.previousValue ?? undefined,
        newValue: a.newValue ?? undefined,
        changedBy: a.changedBy,
        changedByRole: a.changedByRole,
        changeType: a.changeType,
        discrepancyFlag: 'discrepancyFlag' in a ? Boolean(a.discrepancyFlag) : false,
        rationale: a.rationale,
        createdAt: a.createdAt,
      },
    })
  }

  console.log(
    `  state: ${specs.length} alerts, ${9 + 15 + 3} notifications, ${auditRows.length} audit rows`,
  )
}
