// Rolling-window aggregator for Cluster 6 adherence rule. Computes the
// 3-day "current pattern" + 7-day "escalation" counts in one Prisma pass.

import { Prisma } from '../../generated/prisma/client.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { SessionMissedMedication } from './types.js'

type MissReason = SessionMissedMedication['reason']
const VALID_REASONS: MissReason[] = [
  'FORGOT', 'SIDE_EFFECTS', 'RAN_OUT', 'COST', 'INTENTIONAL', 'OTHER',
]
function coerceReason(raw: string | undefined): MissReason {
  if (raw && (VALID_REASONS as string[]).includes(raw)) return raw as MissReason
  return 'OTHER'
}

const RECENT_DAYS = 3
const EXTENDED_DAYS = 7

export interface MissedMedicationRow {
  medicationId?: string
  drugName?: string
  drugClass?: string
  reason?: string
  missedDoses?: number
}

export interface AdherenceWindow {
  /** Unique calendar-day count where the patient logged ANY miss in the
   *  rolling 3-day window (patient timezone). */
  daysWithMiss: number
  /** Same shape over the 7-day window — drives the push-escalation flag. */
  daysWithMissOver7d: number
  /** Tally of misses per `drugClass` over the 3-day window (one miss per
   *  drug per calendar day max, dedup'd across multiple session entries on
   *  the same day). */
  missesByDrugClass: Map<string, number>
  /** Per-medication detail used by the three-tier message templates.
   *  Shape matches RuleResultMetadata.missedMedications. */
  missedMedications: SessionMissedMedication[]
}

export const EMPTY_WINDOW: AdherenceWindow = {
  daysWithMiss: 0,
  daysWithMissOver7d: 0,
  missesByDrugClass: new Map(),
  missedMedications: [],
}

/**
 * Query the patient's last 7 days of JournalEntry rows and aggregate misses.
 * Bounded by 7 × 1-3 entries/day; uses the existing
 * `(userId, measuredAt desc)` index. The current session entry is included
 * naturally because the query window straddles `anchorDate`.
 */
export async function loadAdherenceWindow(
  prisma: PrismaService,
  userId: string,
  anchorDate: Date,
  timezone: string,
): Promise<AdherenceWindow> {
  const sevenDaysAgo = new Date(anchorDate.getTime() - EXTENDED_DAYS * 24 * 60 * 60 * 1000)

  const entries = await prisma.journalEntry.findMany({
    where: {
      userId,
      measuredAt: { gte: sevenDaysAgo, lte: anchorDate },
      OR: [
        { medicationTaken: false },
        { missedMedications: { not: Prisma.DbNull } },
      ],
    },
    select: {
      id: true,
      measuredAt: true,
      medicationTaken: true,
      missedMedications: true,
    },
    orderBy: { measuredAt: 'desc' },
  })

  // HOLD-ADHERENCE (CLINICAL_SPEC §14.2) — meds the care team has placed on
  // hold must be excluded from the miss count: the patient is correctly NOT
  // taking them, so a logged "miss" for a held med is not non-adherence.
  const heldMeds = await prisma.patientMedication.findMany({
    where: { userId, verificationStatus: 'HOLD', discontinuedAt: null },
    select: { id: true },
  })
  const heldMedIds = new Set(heldMeds.map((m) => m.id))

  // Bucket by calendar day in patient timezone so two sessions on the same
  // day don't double-count.
  const recentCutoff = new Date(anchorDate.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000)
  const recentDays = new Set<string>()
  const extendedDays = new Set<string>()
  const recentMissesByClass = new Map<string, Set<string>>()
  // Per-medication detail — keyed by medicationId (or drugName fallback)
  // so a drug reported in multiple sessions surfaces with the most-recent
  // reason + summed missed_doses count.
  const perMedAccum = new Map<string, SessionMissedMedication>()

  for (const e of entries) {
    const day = calendarDayKey(e.measuredAt, timezone)
    const inRecent = e.measuredAt >= recentCutoff

    // Unroll missedMedications JSON. Per-med detail flows into perMedAccum
    // (drives the three-tier message wording). Legacy `medicationTaken=false`
    // alone (no per-med array) still counts toward the miss-day total but
    // does NOT add a synthetic "Medication" row — preserves the
    // "no medication specified" branch of the physician message.
    const allRows = parseMissedMedications(e.missedMedications) ?? []
    // Drop held meds before tallying (HOLD-ADHERENCE). If an entry's only
    // misses were held meds, it no longer counts as a miss-day at all.
    const rows = allRows.filter(
      (r) => !(r.medicationId && heldMedIds.has(r.medicationId)),
    )
    const legacyMissOnly = allRows.length === 0 && e.medicationTaken === false

    if (rows.length === 0 && !legacyMissOnly) continue

    extendedDays.add(day)
    if (inRecent) recentDays.add(day)

    for (const row of rows) {
      const drugClass = row.drugClass ?? 'UNKNOWN'
      if (inRecent) {
        let daysForClass = recentMissesByClass.get(drugClass)
        if (!daysForClass) {
          daysForClass = new Set()
          recentMissesByClass.set(drugClass, daysForClass)
        }
        daysForClass.add(day)
      }
      const key = row.medicationId ?? row.drugName ?? drugClass
      const existing = perMedAccum.get(key)
      if (existing) {
        existing.missedDoses += row.missedDoses ?? 1
        if (row.reason) existing.reason = coerceReason(row.reason)
      } else {
        perMedAccum.set(key, {
          medicationId: row.medicationId ?? key,
          drugName: row.drugName ?? 'Medication',
          drugClass,
          reason: coerceReason(row.reason),
          missedDoses: row.missedDoses ?? 1,
        })
      }
    }
  }

  const missesByDrugClass = new Map<string, number>()
  for (const [cls, dayKeys] of recentMissesByClass.entries()) {
    missesByDrugClass.set(cls, dayKeys.size)
  }

  return {
    daysWithMiss: recentDays.size,
    daysWithMissOver7d: extendedDays.size,
    missesByDrugClass,
    missedMedications: [...perMedAccum.values()],
  }
}

function parseMissedMedications(raw: unknown): MissedMedicationRow[] | null {
  if (!Array.isArray(raw)) return null
  const rows: MissedMedicationRow[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const row = r as Record<string, unknown>
    rows.push({
      medicationId: typeof row.medicationId === 'string' ? row.medicationId : undefined,
      drugName: typeof row.drugName === 'string' ? row.drugName : undefined,
      drugClass: typeof row.drugClass === 'string' ? row.drugClass : undefined,
      reason: typeof row.reason === 'string' ? row.reason : undefined,
      missedDoses: typeof row.missedDoses === 'number' ? row.missedDoses : undefined,
    })
  }
  return rows
}

function calendarDayKey(d: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d)
    const y = parts.find((p) => p.type === 'year')?.value
    const m = parts.find((p) => p.type === 'month')?.value
    const dd = parts.find((p) => p.type === 'day')?.value
    return `${y}-${m}-${dd}`
  } catch {
    // Fallback to UTC day if timezone is invalid — match what other engine
    // helpers do on TZ failures.
    return d.toISOString().slice(0, 10)
  }
}
