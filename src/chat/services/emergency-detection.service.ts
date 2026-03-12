import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ChatMistralAI } from '@langchain/mistralai'

export interface EmergencyDetectionResult {
  isEmergency: boolean
  emergencySituation: string | null
}

@Injectable()
export class EmergencyDetectionService {
  private readonly logger = new Logger(EmergencyDetectionService.name)
  private detectorModel: string

  constructor(private readonly configService: ConfigService) {
    this.detectorModel =
      this.configService.get<string>('MISTRAL_EMERGENCY_MODEL') ||
      this.configService.get<string>('MISTRAL_CHAT_MODEL') ||
      'ministral-3b-2512'
  }

  async detectEmergency(prompt: string): Promise<EmergencyDetectionResult> {
    try {
      const apiKey = this.configService.get<string>('MISTRAL_API_KEY')
      const llm = new ChatMistralAI({
        apiKey,
        model: this.detectorModel,
        maxTokens: 512,
      })

      const systemPrompt = `
        You are a safety classifier for mental and physical health emergencies.

        Given the user's message, you MUST decide if this is an emergency situation in which the user is in immediate danger. That situation must be either physical or mental.

        Return ONLY a single JSON object with this exact shape and field names:
        {
          "is_emergency": boolean,
          "emergency_situation": string | null
        }

        - "is_emergency": true if this is an emergency, false otherwise.
        - "emergency_situation": a short description of the emergency situation, or null if there is no emergency.

        Do not include any extra keys, comments, or explanations.
      `

      const response = await llm.invoke([
        ['system', systemPrompt],
        ['human', prompt],
      ])

      let raw =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content)

      // Some models wrap JSON in markdown code fences (``` or ```json).
      // Strip common fence patterns before attempting to parse.
      raw = raw.trim()
      if (raw.startsWith('```')) {
        // Remove leading ``` or ```json (plus optional newline/space)
        raw = raw.replace(/^```[a-zA-Z0-9]*\s*/,'')
        // Remove trailing ```
        raw = raw.replace(/```$/, '').trim()
      }

      // As a safeguard, if there is extra text around the JSON, try to
      // extract the first {...} block.
      const firstBrace = raw.indexOf('{')
      const lastBrace = raw.lastIndexOf('}')
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        raw = raw.slice(firstBrace, lastBrace + 1)
      }

      let parsed: any
      try {
        parsed = JSON.parse(raw)
      } catch (err) {
        this.logger.warn(`Failed to parse emergency detector JSON, treating as non-emergency. Raw: ${raw}`)
        return { isEmergency: false, emergencySituation: null }
      }

      const isEmergency =
        typeof parsed.is_emergency === 'boolean' ? parsed.is_emergency : false
      const emergencySituation =
        typeof parsed.emergency_situation === 'string' ? parsed.emergency_situation : null

      return { isEmergency, emergencySituation }
    } catch (error) {
      this.logger.error('Emergency detection failed', error as Error)
      return { isEmergency: false, emergencySituation: null }
    }
  }
}

