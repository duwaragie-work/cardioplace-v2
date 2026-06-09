import { Injectable, Logger } from '@nestjs/common'
import { SESSION_WINDOW_MS } from '@cardioplace/shared'
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
 * Grouping rules (CLINICAL_SPEC §5.2 — 5-minute rolling window):
 * - readings are grouped if their `measuredAt` values are within
 *   `SESSION_WINDOW_MS` (5 min) of the anchor — this bounds BOTH the
 *   same-`sessionId` branch and the no-`sessionId` proximity branch, so a
 *   stale/reused sessionId can't average readings taken far apart
 * - AFib patients require ≥3 readings in the session before any alert fires;
 *   the engine checks `session.readingCount >= 3` itself — the averager just
 *   loads everything available so far in the window
 */
@Injectable()
export class SessionAveragerService {
  private readonly logger = new Logger(SessionAveragerService.name)

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
    // Window is anchored on this entry: readings only average together when
    // they fall within ±SESSION_WINDOW_MS of the anchor's measuredAt.
    const windowStart = new Date(
      anchor.measuredAt.getTime() - SESSION_WINDOW_MS,
    )
    const windowEnd = new Date(
      anchor.measuredAt.getTime() + SESSION_WINDOW_MS,
    )

    // If anchor has a sessionId, sibling grouping is by id — but still bounded
    // by the session window so a stale/reused sessionId can't average readings
    // taken hours apart (which could mask a hypertensive emergency).
    if (anchor.sessionId) {
      return this.prisma.journalEntry.findMany({
        where: {
          userId: anchor.userId,
          sessionId: anchor.sessionId,
          measuredAt: { gte: windowStart, lte: windowEnd },
        },
        orderBy: { measuredAt: 'asc' },
      })
    }

    // Otherwise, pull null-session entries within the same window.
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
      singleReadingFinalized?: boolean
      delayBand?: string
    },
    siblings: Array<{
      id: string
      systolicBP: number | null
      diastolicBP: number | null
      pulse: number | null
      weight: { toNumber?: () => number } | number | null
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
      dizziness: boolean
      syncope: boolean
      palpitations: boolean
      legSwelling: boolean
      fatigue: boolean
      shortnessOfBreath: boolean
      dryCough: boolean
      nsaidUse: boolean
      faceSwelling: boolean
      throatTightness: boolean
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
    const weightVals = siblings
      .map((s) => {
        const w = s.weight
        if (w == null) return null
        if (typeof w === 'number') return w
        return typeof w.toNumber === 'function' ? w.toNumber() : null
      })
      .filter((v): v is number => v != null)

    const symptoms = orReduceSymptoms(siblings)
    const suboptimal = siblings.some((s) => hasAnyFalseChecklistItem(s.measurementConditions))
    const latest = siblings.reduce((a, b) =>
      a.measuredAt > b.measuredAt ? a : b,
    )
    // F7 — the anchor entry's RAW reading (the one the patient just submitted),
    // for patient/caregiver message bodies. Falls back to `latest` if siblings
    // somehow lack the anchor row.
    const anchorEntry = siblings.find((s) => s.id === anchor.id) ?? latest
    const medicationTaken = orReduceMedicationTaken(siblings)
    const missedMedications = unionMissedMedications(siblings)

    return {
      entryId: anchor.id,
      userId: anchor.userId,
      measuredAt: latest.measuredAt,
      systolicBP: mean(sbpVals),
      diastolicBP: mean(dbpVals),
      submittedSystolicBP: anchorEntry.systolicBP,
      submittedDiastolicBP: anchorEntry.diastolicBP,
      weight: weightVals.length > 0 ? weightVals.reduce((a, b) => a + b, 0) / weightVals.length : null,
      pulse: mean(pulseVals),
      readingCount: siblings.length,
      symptoms,
      suboptimalMeasurement: suboptimal,
      sessionId: anchor.sessionId,
      medicationTaken,
      missedMedications,
      // Cluster 6 Q2 — bypass the non-emergency single-reading gate when
      // the anchor entry has been finalized by the frontend 5-min timeout.
      singleReadingFinalized: anchor.singleReadingFinalized ?? false,
      // Chunk B (Manisha Backdated Readings sign-off 2026-06-06) — carry the
      // anchor entry's measurement-lag band so the engine can suppress L2 on
      // HISTORICAL_ENTRY and the registry can drop the 911 CTA on DELAYED_ENTRY.
      delayBand: anchor.delayBand,
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
    dizziness: boolean
    syncope: boolean
    palpitations: boolean
    legSwelling: boolean
    fatigue: boolean
    shortnessOfBreath: boolean
    dryCough: boolean
    nsaidUse: boolean
    faceSwelling: boolean
    throatTightness: boolean
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
    merged.dizziness ||= e.dizziness
    merged.syncope ||= e.syncope
    merged.palpitations ||= e.palpitations
    merged.legSwelling ||= e.legSwelling
    merged.fatigue ||= e.fatigue
    merged.shortnessOfBreath ||= e.shortnessOfBreath
    merged.dryCough ||= e.dryCough
    merged.nsaidUse ||= e.nsaidUse
    merged.faceSwelling ||= e.faceSwelling
    merged.throatTightness ||= e.throatTightness
    for (const s of e.otherSymptoms) otherSet.add(s)
  }
  merged.otherSymptoms = [...otherSet]
  return merged
}

function hasAnyFalseChecklistItem(raw: unknown): boolean {
  if (raw == null) return false
  if (typeof raw !== 'object') return false
  const values = Object.values(raw as Record<string, unknown>)
  // Bug #5 (inverted-boolean / missing-data default): the check-in form
  // ALWAYS sends all 8 checklist keys, each defaulting to `false` when the
  // box is left unchecked. A patient who skips the optional pre-measurement
  // checklist entirely therefore sends an all-`false` object — that means
  // "checklist not completed", NOT "measured suboptimally". Only treat a
  // `false` as a genuine measurement deviation when the patient engaged
  // with the checklist (confirmed at least one item `true`). All-true
  // (perfect) and all-false (skipped) both → not suboptimal; a mixed
  // object (engaged but a condition unmet) → suboptimal.
  const engaged = values.some((v) => v === true)
  if (!engaged) return false
  return values.some((v) => v === false)
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
