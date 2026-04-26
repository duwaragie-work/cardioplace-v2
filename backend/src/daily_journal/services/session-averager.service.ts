import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service.js'
import type {
  SessionAverage,
  SessionMissedMedication,
  SessionSymptoms,
} from '../engine/types.js'

/**
 * Phase/5 SessionAverager — groups readings that belong to the same "session"
 * and returns a single averaged SessionAverage the rule engine evaluates.
 *
 * Grouping rules (CLINICAL_SPEC Part 5 + BUILD_PLAN §2.2):
 * - readings with identical non-null `sessionId` are one session
 * - readings without a sessionId are grouped if their `measuredAt` values
 *   are within 30 minutes of each other
 * - AFib patients require ≥3 readings in the session before any alert fires;
 *   the engine checks `session.readingCount >= 3` itself — the averager just
 *   loads everything available so far in the window
 */
@Injectable()
export class SessionAveragerService {
  private readonly logger = new Logger(SessionAveragerService.name)

  private static readonly SESSION_WINDOW_MS = 30 * 60 * 1000

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the session containing the given entry. Returns a SessionAverage
   * with rounded mean vitals and OR-reduced symptoms.
   */
  async averageForEntry(entryId: string): Promise<SessionAverage | null> {
    const anchor = await this.prisma.journalEntry.findUnique({
      where: { id: entryId },
    })
    if (!anchor) {
      this.logger.warn(`averageForEntry: entry ${entryId} not found`)
      return null
    }

    const siblings = await this.loadSessionSiblings(anchor)
    return SessionAveragerService.aggregate(anchor, siblings)
  }

  private async loadSessionSiblings(anchor: {
    id: string
    userId: string
    sessionId: string | null
    measuredAt: Date
  }) {
    // If anchor has a sessionId, sibling grouping is exact.
    if (anchor.sessionId) {
      return this.prisma.journalEntry.findMany({
        where: { userId: anchor.userId, sessionId: anchor.sessionId },
        orderBy: { measuredAt: 'asc' },
      })
    }

    // Otherwise, pull entries within ±30 min and take the contiguous ones.
    const windowStart = new Date(
      anchor.measuredAt.getTime() - SessionAveragerService.SESSION_WINDOW_MS,
    )
    const windowEnd = new Date(
      anchor.measuredAt.getTime() + SessionAveragerService.SESSION_WINDOW_MS,
    )
    return this.prisma.journalEntry.findMany({
      where: {
        userId: anchor.userId,
        sessionId: null,
        measuredAt: { gte: windowStart, lte: windowEnd },
      },
      orderBy: { measuredAt: 'asc' },
    })
  }

  /**
   * Pure aggregation — separated so it can be unit-tested without the DB.
   * Includes the anchor itself (DB already returns it because siblings
   * includes `anchor.id`).
   */
  static aggregate(
    anchor: {
      id: string
      userId: string
      measuredAt: Date
      sessionId: string | null
    },
    siblings: Array<{
      id: string
      systolicBP: number | null
      diastolicBP: number | null
      pulse: number | null
      measuredAt: Date
      measurementConditions: unknown
      severeHeadache: boolean
      visualChanges: boolean
      alteredMentalStatus: boolean
      chestPainOrDyspnea: boolean
      focalNeuroDeficit: boolean
      severeEpigastricPain: boolean
      newOnsetHeadache: boolean
      ruqPain: boolean
      edema: boolean
      otherSymptoms: string[]
      medicationTaken?: boolean | null
      missedMedications?: unknown
    }>,
  ): SessionAverage | null {
    if (siblings.length === 0) return null

    const sbpVals = siblings
      .map((s) => s.systolicBP)
      .filter((v): v is number => v != null)
    const dbpVals = siblings
      .map((s) => s.diastolicBP)
      .filter((v): v is number => v != null)
    const pulseVals = siblings
      .map((s) => s.pulse)
      .filter((v): v is number => v != null)

    const symptoms = orReduceSymptoms(siblings)
    const suboptimal = siblings.some((s) => hasAnyFalseChecklistItem(s.measurementConditions))
    const latest = siblings.reduce((a, b) =>
      a.measuredAt > b.measuredAt ? a : b,
    )
    const medicationTaken = orReduceMedicationTaken(siblings)
    const missedMedications = unionMissedMedications(siblings)

    return {
      entryId: anchor.id,
      userId: anchor.userId,
      measuredAt: latest.measuredAt,
      systolicBP: mean(sbpVals),
      diastolicBP: mean(dbpVals),
      pulse: mean(pulseVals),
      readingCount: siblings.length,
      symptoms,
      suboptimalMeasurement: suboptimal,
      sessionId: anchor.sessionId,
      medicationTaken,
      missedMedications,
    }
  }
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  const sum = values.reduce((a, b) => a + b, 0)
  return Math.round(sum / values.length)
}

function orReduceSymptoms(
  entries: Array<{
    severeHeadache: boolean
    visualChanges: boolean
    alteredMentalStatus: boolean
    chestPainOrDyspnea: boolean
    focalNeuroDeficit: boolean
    severeEpigastricPain: boolean
    newOnsetHeadache: boolean
    ruqPain: boolean
    edema: boolean
    otherSymptoms: string[]
  }>,
): SessionSymptoms {
  const merged: SessionSymptoms = {
    severeHeadache: false,
    visualChanges: false,
    alteredMentalStatus: false,
    chestPainOrDyspnea: false,
    focalNeuroDeficit: false,
    severeEpigastricPain: false,
    newOnsetHeadache: false,
    ruqPain: false,
    edema: false,
    otherSymptoms: [],
  }
  const otherSet = new Set<string>()
  for (const e of entries) {
    merged.severeHeadache ||= e.severeHeadache
    merged.visualChanges ||= e.visualChanges
    merged.alteredMentalStatus ||= e.alteredMentalStatus
    merged.chestPainOrDyspnea ||= e.chestPainOrDyspnea
    merged.focalNeuroDeficit ||= e.focalNeuroDeficit
    merged.severeEpigastricPain ||= e.severeEpigastricPain
    merged.newOnsetHeadache ||= e.newOnsetHeadache
    merged.ruqPain ||= e.ruqPain
    merged.edema ||= e.edema
    for (const s of e.otherSymptoms) otherSet.add(s)
  }
  merged.otherSymptoms = [...otherSet]
  return merged
}

function hasAnyFalseChecklistItem(raw: unknown): boolean {
  if (raw == null) return false
  if (typeof raw !== 'object') return false
  for (const v of Object.values(raw as Record<string, unknown>)) {
    if (v === false) return true
  }
  return false
}

/**
 * OR-reduce the session's adherence signal. Any `false` wins; otherwise the
 * first non-null value (`true`) wins; else `null` (not asked).
 */
function orReduceMedicationTaken(
  entries: Array<{ medicationTaken?: boolean | null }>,
): boolean | null {
  let anyFalse = false
  let anyTrue = false
  for (const e of entries) {
    if (e.medicationTaken === false) anyFalse = true
    else if (e.medicationTaken === true) anyTrue = true
  }
  if (anyFalse) return false
  if (anyTrue) return true
  return null
}

/**
 * Union per-medication miss detail across the session's entries. If the same
 * medicationId appears twice, the latest entry's reason/missedDoses wins
 * (entries arrive sorted ascending by measuredAt, so iterate in order and
 * overwrite).
 */
function unionMissedMedications(
  entries: Array<{ missedMedications?: unknown }>,
): SessionMissedMedication[] {
  const byId = new Map<string, SessionMissedMedication>()
  for (const e of entries) {
    const raw = e.missedMedications
    if (!Array.isArray(raw)) continue
    for (const item of raw) {
      if (!isValidMissedMedication(item)) continue
      byId.set(item.medicationId, item)
    }
  }
  return [...byId.values()]
}

function isValidMissedMedication(v: unknown): v is SessionMissedMedication {
  if (v == null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.medicationId === 'string' &&
    typeof o.drugName === 'string' &&
    typeof o.drugClass === 'string' &&
    typeof o.reason === 'string' &&
    typeof o.missedDoses === 'number'
  )
}
