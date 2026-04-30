// Phase/27 BP photo OCR (NIVA_SILENT_LITERACY_PLAN §3) — wraps GeminiService's
// vision call with clinical range validation, an in-memory per-user daily
// rate limit, and a structured audit log entry. No image persistence — the
// buffer is base64-encoded, sent to Gemini, then discarded.

import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GeminiService } from '../gemini/gemini.service.js'
import type { BpOcrResult } from '../gemini/gemini.service.js'

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

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name)
  private readonly maxPerDay: number

  // userId → { date: 'YYYY-MM-DD', count }. UTC midnight reset.
  private readonly counters = new Map<string, { date: string; count: number }>()

  constructor(
    private readonly gemini: GeminiService,
    private readonly config: ConfigService,
  ) {
    const raw = this.config.get<string>('OCR_BP_MAX_PER_DAY')
    const parsed = raw ? parseInt(raw, 10) : 20
    this.maxPerDay = Number.isFinite(parsed) && parsed > 0 ? parsed : 20
  }

  async extractBp(
    userId: string,
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<BpOcrSuccess> {
    this.checkRateLimit(userId)

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
    this.bumpCounter(userId)

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

  private checkRateLimit(userId: string) {
    const today = new Date().toISOString().slice(0, 10)
    const entry = this.counters.get(userId)
    if (entry && entry.date === today && entry.count >= this.maxPerDay) {
      throw new BpOcrFailure(
        'RATE_LIMITED',
        `Daily OCR limit (${this.maxPerDay}) reached`,
      )
    }
  }

  private bumpCounter(userId: string) {
    const today = new Date().toISOString().slice(0, 10)
    const entry = this.counters.get(userId)
    if (!entry || entry.date !== today) {
      this.counters.set(userId, { date: today, count: 1 })
    } else {
      entry.count += 1
    }
  }
}
