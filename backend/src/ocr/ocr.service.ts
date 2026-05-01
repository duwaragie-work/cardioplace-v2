// Phase/27 BP photo OCR (NIVA_SILENT_LITERACY_PLAN §3) — wraps GeminiService's
// vision call with clinical range validation, an in-memory per-user daily
// rate limit, and a structured audit log entry. No image persistence — the
// buffer is base64-encoded, sent to Gemini, then discarded.

import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GeminiService } from '../gemini/gemini.service.js'
import type {
  BpOcrResult,
  MedicationOcrResult,
  MedicationOcrItem,
} from '../gemini/gemini.service.js'

// Clinical ranges — match the rule engine's bounds in
// backend/src/daily_journal/engine/standard.ts so OCR can never seed values
// the rule engine would itself reject.
const SBP_MIN = 60
const SBP_MAX = 250
const DBP_MIN = 40
const DBP_MAX = 150
const PULSE_MIN = 30
const PULSE_MAX = 220

const MIN_CONFIDENCE = 0.6

export type BpOcrFailureCode =
  | 'LOW_CONFIDENCE'
  | 'OUT_OF_RANGE'
  | 'GEMINI_ERROR'
  | 'RATE_LIMITED'

export class BpOcrFailure extends Error {
  constructor(public readonly code: BpOcrFailureCode, message: string) {
    super(message)
    this.name = 'BpOcrFailure'
  }
}

export interface BpOcrSuccess {
  sbp: number
  dbp: number
  pulse: number | null
  confidence: number
}

// ─── Medication OCR (Phase/27 follow-up) ────────────────────────────────────

export type MedOcrFailureCode =
  | 'LOW_CONFIDENCE'
  | 'EMPTY_EXTRACTION'
  | 'GEMINI_ERROR'
  | 'RATE_LIMITED'

export class MedOcrFailure extends Error {
  constructor(public readonly code: MedOcrFailureCode, message: string) {
    super(message)
    this.name = 'MedOcrFailure'
  }
}

export interface MedOcrSuccess {
  medications: MedicationOcrItem[]
  confidence: number
}

/**
 * In-memory rate-limit counter key — kind isolates BP scans from med scans
 * so a busy day on one doesn't lock out the other.
 */
type CounterKind = 'bp' | 'med'

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name)
  private readonly maxPerDay: Record<CounterKind, number>

  // `${kind}:${userId}` → { date: 'YYYY-MM-DD', count }. UTC midnight reset.
  // Kinds isolated so a heavy BP scan day doesn't block a med scan and vice
  // versa.
  private readonly counters = new Map<string, { date: string; count: number }>()

  constructor(
    private readonly gemini: GeminiService,
    private readonly config: ConfigService,
  ) {
    this.maxPerDay = {
      bp: this.readEnvLimit('OCR_BP_MAX_PER_DAY', 20),
      med: this.readEnvLimit('OCR_MED_MAX_PER_DAY', 10),
    }
  }

  private readEnvLimit(key: string, fallback: number): number {
    const raw = this.config.get<string>(key)
    const parsed = raw ? parseInt(raw, 10) : fallback
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  async extractBp(
    userId: string,
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<BpOcrSuccess> {
    this.checkRateLimit('bp', userId)

    const base64 = imageBuffer.toString('base64')
    let result: BpOcrResult
    try {
      result = await this.gemini.extractBpFromImage(base64, mimeType)
    } catch (err) {
      this.logger.error(
        `BP OCR — Gemini call failed for user ${userId}: ${(err as Error).message}`,
      )
      throw new BpOcrFailure('GEMINI_ERROR', 'OCR provider failed')
    }

    // Increment counter only after a successful round-trip — failed Gemini
    // calls (5xx) shouldn't burn a quota slot.
    this.bumpCounter('bp', userId)

    if (result.confidence === 0 || result.sbp == null || result.dbp == null) {
      this.logger.log(
        `BP OCR — Gemini reported unreadable image for user ${userId} (confidence=${result.confidence})`,
      )
      throw new BpOcrFailure('LOW_CONFIDENCE', 'Image not readable')
    }

    if (result.confidence < MIN_CONFIDENCE) {
      this.logger.log(
        `BP OCR — confidence ${result.confidence} below threshold for user ${userId}`,
      )
      throw new BpOcrFailure('LOW_CONFIDENCE', 'Confidence too low')
    }

    if (
      result.sbp < SBP_MIN || result.sbp > SBP_MAX ||
      result.dbp < DBP_MIN || result.dbp > DBP_MAX
    ) {
      this.logger.warn(
        `BP OCR — out-of-range values rejected for user ${userId}: ${result.sbp}/${result.dbp}`,
      )
      throw new BpOcrFailure('OUT_OF_RANGE', 'Numbers outside expected range')
    }

    // Pulse is optional. Drop it silently if out of range so we keep sbp/dbp.
    const pulseValid =
      result.pulse != null &&
      result.pulse >= PULSE_MIN &&
      result.pulse <= PULSE_MAX

    this.logger.log(
      `BP OCR success for user ${userId}: ${result.sbp}/${result.dbp}` +
        (pulseValid ? ` p${result.pulse}` : '') +
        ` confidence=${result.confidence.toFixed(2)}`,
    )

    return {
      sbp: result.sbp,
      dbp: result.dbp,
      pulse: pulseValid ? result.pulse! : null,
      confidence: result.confidence,
    }
  }

  /**
   * Phase/27 medication-list OCR. Same shape as extractBp: rate-limit →
   * Gemini call → confidence gate → throw a typed failure for the controller
   * to map to HTTP status. No clinical range validation here — the catalog
   * matching + provider-verification flow happen on the frontend / on submit.
   */
  async extractMedications(
    userId: string,
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<MedOcrSuccess> {
    this.checkRateLimit('med', userId)

    const base64 = imageBuffer.toString('base64')
    let result: MedicationOcrResult
    try {
      result = await this.gemini.extractMedicationsFromImage(base64, mimeType)
    } catch (err) {
      this.logger.error(
        `Med OCR — Gemini call failed for user ${userId}: ${(err as Error).message}`,
      )
      throw new MedOcrFailure('GEMINI_ERROR', 'OCR provider failed')
    }

    // Successful round-trip burns a quota slot regardless of how many meds
    // came back — the cost is the API call, not the number of items.
    this.bumpCounter('med', userId)

    if (result.confidence === 0 || result.medications.length === 0) {
      this.logger.log(
        `Med OCR — empty extraction for user ${userId} (confidence=${result.confidence})`,
      )
      throw new MedOcrFailure(
        'EMPTY_EXTRACTION',
        'No medications detected in the photo',
      )
    }

    if (result.confidence < MIN_CONFIDENCE) {
      this.logger.log(
        `Med OCR — confidence ${result.confidence} below threshold for user ${userId}`,
      )
      throw new MedOcrFailure('LOW_CONFIDENCE', 'Confidence too low')
    }

    this.logger.log(
      `Med OCR success for user ${userId}: ${result.medications.length} meds, confidence=${result.confidence.toFixed(2)}`,
    )

    return {
      medications: result.medications,
      confidence: result.confidence,
    }
  }

  private checkRateLimit(kind: CounterKind, userId: string) {
    const today = new Date().toISOString().slice(0, 10)
    const key = `${kind}:${userId}`
    const entry = this.counters.get(key)
    const limit = this.maxPerDay[kind]
    if (entry && entry.date === today && entry.count >= limit) {
      // Surface the matching failure type so the controller can return the
      // right HTTP status without sniffing the error class.
      if (kind === 'bp') {
        throw new BpOcrFailure('RATE_LIMITED', `Daily OCR limit (${limit}) reached`)
      }
      throw new MedOcrFailure('RATE_LIMITED', `Daily OCR limit (${limit}) reached`)
    }
  }

  private bumpCounter(kind: CounterKind, userId: string) {
    const today = new Date().toISOString().slice(0, 10)
    const key = `${kind}:${userId}`
    const entry = this.counters.get(key)
    if (!entry || entry.date !== today) {
      this.counters.set(key, { date: today, count: 1 })
    } else {
      entry.count += 1
    }
  }
}
