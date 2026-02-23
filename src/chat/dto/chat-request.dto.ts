import { SystemPromptConfig } from './system-prompt-config.dto.js'

export class ChatRequestDto implements SystemPromptConfig {
  sessionId: string
  prompt: string
  date: string
  medicalLens: string
  tone: string
  detailLevel: string
  careApproach: string
  spirituality: boolean
}
