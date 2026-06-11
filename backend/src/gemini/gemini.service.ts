import { GoogleGenAI } from '@google/genai'
import type { Content, FunctionDeclaration, GenerateContentResponse } from '@google/genai'
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { LangSmithService } from '../common/langsmith.service.js'

const MAX_RETRIES = 5
const BASE_DELAY_MS = 2000

// ─── BP OCR (NIVA_SILENT_LITERACY_PLAN §3) ──────────────────────────────────

export interface BpOcrResult {
  /** Systolic (top number on the cuff). null when Gemini couldn't read it. */
  sbp: number | null
  /** Diastolic (middle number on the cuff). null when Gemini couldn't read it. */
  dbp: number | null
  /** Pulse (bottom number / heart icon). Optional — many cuffs hide it. */
  pulse: number | null
  /** Gemini's self-reported confidence 0..1. 0 = explicit "couldn't read it". */
  confidence: number
  /** Raw Gemini JSON for debugging + audit. */
  raw: string
}

const BP_OCR_PROMPT = `You are reading a home blood pressure cuff display.
Extract these three numbers from the image, in this exact order:
1. Systolic (SYS, top number, usually largest, range 60-250)
2. Diastolic (DIA, middle number, range 40-150)
3. Pulse (PUL or heart icon, bottom number, range 30-220, optional)

Respond with strict JSON only, no prose, no markdown:
{ "sbp": <number>, "dbp": <number>, "pulse": <number|null>, "confidence": <0..1> }

confidence reflects how clearly the digits were visible. If you cannot
identify both sbp and dbp, return:
{ "sbp": null, "dbp": null, "pulse": null, "confidence": 0 }
Never guess. Never return values outside the ranges above.`

/**
 * Parse Gemini's JSON-mode response for BP OCR. Strict shape check; throws
 * on missing keys or non-numeric values so the controller can return 502 to
 * the caller. The OcrService applies clinical range validation downstream.
 */
function parseBpOcrResponse(raw: string): BpOcrResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`BP OCR — non-JSON response from Gemini: ${raw.slice(0, 200)}`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('BP OCR — Gemini response is not an object')
  }
  const obj = parsed as Record<string, unknown>
  const sbp = numericOrNull(obj.sbp)
  const dbp = numericOrNull(obj.dbp)
  const pulse = numericOrNull(obj.pulse)
  const confidence = typeof obj.confidence === 'number' ? obj.confidence : 0
  return { sbp, dbp, pulse, confidence, raw }
}

function numericOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return null
}

// ─── Medication OCR (Phase/27 Niva plan §3 — prescription scan) ─────────────

export interface MedicationOcrItem {
  /** Drug name as printed (Gemini extracts brand or generic verbatim). */
  drugName: string
  /** Free-text frequency from the label (e.g. "once daily", "BID",
   *  "every 8 hours"). Empty string when not stated. Caller normalises. */
  frequency: string
  /** Dose as printed (e.g. "10 mg"). Informational — not persisted today. */
  doseText: string
  /** Exact text snippet Gemini extracted, stored on PatientMedication.rawInputText. */
  raw: string
}

export interface MedicationOcrResult {
  medications: MedicationOcrItem[]
  /** Gemini's self-reported confidence 0..1. 0 = explicit "couldn't read it". */
  confidence: number
  /** Raw Gemini JSON for debugging + audit. */
  rawJson: string
}

const MED_OCR_PROMPT = `You are reading a prescription, pharmacy printout, or pill-bottle label.
Extract every medication you can see, in the order they appear.

For each medication, return:
- drugName: brand or generic name as printed (e.g., "Lisinopril", "Norvasc")
- frequency: free text from the label (e.g., "once daily", "twice a day",
  "BID", "every 8 hours", "as needed"). Pass through whatever you read —
  the system will normalise it. Empty string if not stated.
- doseText: dose as printed (e.g., "10 mg", "25 mg twice"). Empty string
  if not stated.
- raw: the exact text snippet you extracted this from, for audit.

Respond with strict JSON only, no prose, no markdown:
{
  "medications": [
    { "drugName": <string>, "frequency": <string>, "doseText": <string>, "raw": <string> }
  ],
  "confidence": <0..1>
}

confidence reflects how clearly the print was visible. If the image is
unreadable, return:
{ "medications": [], "confidence": 0 }
Never invent drug names. If unsure of a single character, mark the whole
drugName empty rather than guessing.`

/**
 * Strict-shape parser for Gemini's JSON-mode med-OCR response. Throws on
 * malformed JSON or missing top-level keys so the OcrService layer can map
 * to a friendly 502. Item-level garbage (missing drugName) is filtered, not
 * thrown — patient gets the readable rows without a hard error.
 */
function parseMedicationOcrResponse(raw: string): MedicationOcrResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(
      `Medication OCR — non-JSON response from Gemini: ${raw.slice(0, 200)}`,
    )
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Medication OCR — Gemini response is not an object')
  }
  const obj = parsed as Record<string, unknown>
  const confidence =
    typeof obj.confidence === 'number' && Number.isFinite(obj.confidence)
      ? obj.confidence
      : 0
  const arr = Array.isArray(obj.medications) ? obj.medications : []
  const medications: MedicationOcrItem[] = []
  for (const row of arr) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const drugName = typeof r.drugName === 'string' ? r.drugName.trim() : ''
    if (!drugName) continue // drop empty-name rows so the patient doesn't see junk
    medications.push({
      drugName,
      frequency: typeof r.frequency === 'string' ? r.frequency.trim() : '',
      doseText: typeof r.doseText === 'string' ? r.doseText.trim() : '',
      raw: typeof r.raw === 'string' ? r.raw.trim() : drugName,
    })
  }
  return { medications, confidence, rawJson: raw }
}

@Injectable()
export class GeminiService implements OnModuleInit {
  private readonly logger = new Logger(GeminiService.name)
  private client!: GoogleGenAI
  private chatModel!: string

  constructor(
    private configService: ConfigService,
    @Optional() private langsmith?: LangSmithService,
  ) {}

  onModuleInit() {
    const apiKey = this.configService.get<string>('GOOGLE_API_KEY')
    this.chatModel = this.configService.get<string>('GEMINI_CHAT_MODEL') || 'gemini-2.5-flash'

    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY is not defined in environment')
    }

    this.client = new GoogleGenAI({ apiKey })
  }

  /**
   * Retry helper for transient 429 / 5xx errors with exponential backoff.
   * Parses the retryDelay from 429 responses when available.
   */
  private async withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn()
      } catch (err: any) {
        const status = err?.statusCode ?? err?.status ?? err?.code ?? 0
        const retryable = status === 429 || (typeof status === 'number' && status >= 500)
        if (!retryable || attempt === MAX_RETRIES) throw err

        // Try to extract retryDelay from the error message (e.g. "Please retry in 14.5s")
        let delay = BASE_DELAY_MS * 2 ** attempt
        const retryMatch = String(err?.message ?? '').match(/retry in (\d+\.?\d*)s/i)
        if (retryMatch) {
          delay = Math.ceil(parseFloat(retryMatch[1]) * 1000) + 500
        }

        this.logger.warn(
          `${label} failed with ${status}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
        )
        await new Promise((r) => setTimeout(r, delay))
      }
    }
    throw new Error('unreachable')
  }

  get clientInstance(): GoogleGenAI {
    return this.client
  }

  get chatModelName(): string {
    return this.chatModel
  }

  /**
   * Extract a medication list from a photo of a prescription, pharmacy
   * printout, or pill-bottle label (NIVA_SILENT_LITERACY_PLAN §3 follow-up).
   * Mirrors extractBpFromImage: same retry helper, same inlineData part,
   * JSON-mode response. Caller (OcrService) is responsible for catalog
   * matching, frequency normalisation, and persisting to PatientMedication.
   */
  async extractMedicationsFromImage(
    imageBase64: string,
    mimeType: string,
  ): Promise<MedicationOcrResult> {
    return this.withRetry('extractMedicationsFromImage', async () => {
      const response = await this.client.models.generateContent({
        model: this.chatModel,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: imageBase64 } },
            { text: MED_OCR_PROMPT },
          ],
        }],
        config: { responseMimeType: 'application/json' },
      })
      const raw = response.text?.trim() ?? ''

      const usage = response.usageMetadata
      this.langsmith?.traceRun('extractMedicationsFromImage', {
        model: this.chatModel,
        inputTokens: usage?.promptTokenCount,
        outputTokens: usage?.candidatesTokenCount,
        totalTokens: usage?.totalTokenCount,
        latencyMs: 0,
        source: 'text',
      })

      return parseMedicationOcrResponse(raw)
    })
  }

  /**
   * Simplify an FDA drug indication into a 6th-grade-reading-level patient
   * sentence. Used by DrugEnrichmentService for freeform meds (catalog meds
   * already carry a hand-written `purpose` string in shared/medications.ts).
   * Returns null if Gemini fails or returns junk — caller falls back to
   * showing no description rather than the raw clinical text.
   */
  async simplifyDrugIndication(
    rawIndication: string,
    locale: string = 'en',
  ): Promise<string | null> {
    if (!rawIndication.trim()) return null
    try {
      return await this.withRetry('simplifyDrugIndication', async () => {
        const prompt = `You are simplifying an FDA drug indication for a patient with a 6th-grade reading level.
Rules:
- Maximum 2 sentences.
- Do not recommend changes to the prescription.
- Pick the primary indication; do not enumerate every condition.
- Be warm and reassuring, never alarming.
- Locale: ${locale}. Reply in that language.

Input:
${rawIndication.slice(0, 2000)}

Reply with strict JSON only:
{ "plainLanguage": "<your simplified sentence>" }`

        const response = await this.client.models.generateContent({
          model: this.chatModel,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { responseMimeType: 'application/json' },
        })
        const raw = response.text?.trim() ?? ''
        const parsed = JSON.parse(raw) as { plainLanguage?: unknown }
        const out = typeof parsed.plainLanguage === 'string' ? parsed.plainLanguage.trim() : ''
        return out || null
      })
    } catch (err) {
      this.logger.warn(`simplifyDrugIndication failed: ${(err as Error).message}`)
      return null
    }
  }

  /**
   * Chat completion — returns a normalised shape:
   * { choices: [{ message: { content: string } }] }
   */
  async getChatCompletion(messages: Array<{ role: string; content: string }>) {
    return this.withRetry('getChatCompletion', async () => {
      const systemParts = messages.filter((m) => m.role === 'system')
      const conversationParts = messages.filter((m) => m.role !== 'system')

      const contents = conversationParts.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))

      const response = await this.client.models.generateContent({
        model: this.chatModel,
        contents,
        config: {
          systemInstruction: systemParts.length > 0
            ? systemParts.map((m) => m.content).join('\n')
            : undefined,
        },
      })

      const text = response.text ?? ''

      const usage = response.usageMetadata
      this.langsmith?.traceRun('getChatCompletion', {
        model: this.chatModel,
        inputTokens: usage?.promptTokenCount,
        outputTokens: usage?.candidatesTokenCount,
        totalTokens: usage?.totalTokenCount,
        latencyMs: 0,
        source: 'text',
      })

      return {
        choices: [{ message: { content: text, role: 'assistant' as const } }],
      }
    })
  }

  /**
   * Extract systolic/diastolic/pulse numbers from a photo of a home BP cuff
   * display (NIVA_SILENT_LITERACY_PLAN §3). Mirrors the transcribeAudio
   * pattern: inlineData part + structured prompt + JSON-mode output. Caller
   * is responsible for range-validating the returned numbers — this method
   * trusts Gemini's response shape but not its values.
   *
   * Throws on unparseable JSON or missing required fields. Returns
   * confidence=0 + null numbers when Gemini explicitly couldn't read the
   * display (acceptable, distinguished from a parse failure).
   */
  async extractBpFromImage(
    imageBase64: string,
    mimeType: string,
  ): Promise<BpOcrResult> {
    return this.withRetry('extractBpFromImage', async () => {
      const response = await this.client.models.generateContent({
        model: this.chatModel,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: imageBase64 } },
            { text: BP_OCR_PROMPT },
          ],
        }],
        config: { responseMimeType: 'application/json' },
      })
      const raw = response.text?.trim() ?? ''

      const usage = response.usageMetadata
      this.langsmith?.traceRun('extractBpFromImage', {
        model: this.chatModel,
        inputTokens: usage?.promptTokenCount,
        outputTokens: usage?.candidatesTokenCount,
        totalTokens: usage?.totalTokenCount,
        latencyMs: 0,
        source: 'text',
      })

      return parseBpOcrResponse(raw)
    })
  }

  /**
   * Transcribe audio using Gemini Flash.
   * Accepts a base64-encoded audio blob and returns the transcription text.
   * `languageHint` is a BCP-47 tag (e.g. 'en-US', 'es-ES'). When provided,
   * the prompt nudges the model to interpret the audio in that language —
   * useful for chat dictation where the patient's preferredLanguage gives a
   * strong prior. Defaults to none (model auto-detects).
   */
  async transcribeAudio(
    audioBase64: string,
    mimeType = 'audio/wav',
    languageHint?: string,
  ): Promise<string> {
    return this.withRetry('transcribeAudio', async () => {
      const langClause = languageHint
        ? ` The speaker's preferred language is ${languageHint}; treat that as a strong prior when the audio is ambiguous, but transcribe in the language actually spoken.`
        : ''
      const response = await this.client.models.generateContent({
        model: this.chatModel,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: audioBase64 } },
            { text: `Transcribe this audio exactly as spoken. Return ONLY the transcription text — no preamble, no quotes, no formatting, no commentary. If the audio is silent or unintelligible, return an empty string.${langClause}` },
          ],
        }],
      })
      return response.text?.trim() ?? ''
    })
  }

  /**
   * Generate content with function calling support.
   * Returns the raw Gemini response so the caller can inspect functionCall parts.
   */
  async generateContentWithTools(opts: {
    contents: Content[]
    systemInstruction?: string
    tools?: FunctionDeclaration[]
  }): Promise<GenerateContentResponse> {
    return this.withRetry('generateContentWithTools', async () => {
      const response = await this.client.models.generateContent({
        model: this.chatModel,
        contents: opts.contents,
        config: {
          systemInstruction: opts.systemInstruction || undefined,
          tools: opts.tools?.length
            ? [{ functionDeclarations: opts.tools }]
            : undefined,
        },
      })

      const usage = response.usageMetadata
      this.langsmith?.traceRun('generateContentWithTools', {
        model: this.chatModel,
        inputTokens: usage?.promptTokenCount,
        outputTokens: usage?.candidatesTokenCount,
        totalTokens: usage?.totalTokenCount,
        latencyMs: 0,
        source: 'text',
      })

      return response
    })
  }

  /**
   * Streaming variant of generateContentWithTools. Yields raw chunks from
   * Gemini's generateContentStream so the caller can emit text as it arrives
   * and still inspect functionCall parts at end-of-stream.
   *
   * Retry wraps the initial handshake only — once the stream begins, mid-stream
   * failures bubble up to the caller (retrying a partial stream doesn't make
   * sense; tokens already emitted can't be undone).
   */
  async *streamContentWithTools(opts: {
    contents: Content[]
    systemInstruction?: string
    tools?: FunctionDeclaration[]
  }): AsyncIterable<GenerateContentResponse> {
    const stream = await this.withRetry('streamContentWithTools', () =>
      this.client.models.generateContentStream({
        model: this.chatModel,
        contents: opts.contents,
        config: {
          systemInstruction: opts.systemInstruction || undefined,
          tools: opts.tools?.length
            ? [{ functionDeclarations: opts.tools }]
            : undefined,
        },
      }),
    )

    let lastUsage: GenerateContentResponse['usageMetadata'] | undefined
    for await (const chunk of stream) {
      if (chunk.usageMetadata) lastUsage = chunk.usageMetadata
      yield chunk
    }

    this.langsmith?.traceRun('streamContentWithTools', {
      model: this.chatModel,
      inputTokens: lastUsage?.promptTokenCount,
      outputTokens: lastUsage?.candidatesTokenCount,
      totalTokens: lastUsage?.totalTokenCount,
      latencyMs: 0,
      source: 'text',
    })
  }
}
