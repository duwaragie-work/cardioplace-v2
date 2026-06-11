import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * Patient dictates into the chat input by recording audio in the browser
 * (MediaRecorder). The frontend base64-encodes the audio blob and POSTs it
 * here; backend forwards to Gemini for transcription and returns the text.
 *
 * Limits:
 *   • audioBase64 capped at ~13.5 MB (≈10 MB raw audio). At opus/voice
 *     ~32 kbps that's ~40 minutes of speech — way past any one-shot
 *     dictation. Anything longer is almost certainly abuse / accident.
 *   • mimeType allow-listed to the formats Gemini accepts AND that
 *     MediaRecorder commonly produces. Anything else → 400.
 *   • languageHint is an OPTIONAL BCP-47 tag used to nudge Gemini toward
 *     the patient's preferredLanguage when the audio is ambiguous.
 */
export const ALLOWED_TRANSCRIBE_MIME_TYPES = [
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/wav',
  'audio/mp4',
  'audio/mpeg',
] as const

export class TranscribeRequestDto {
  @IsNotEmpty({ message: 'audioBase64 is required' })
  @IsString()
  // ~13.5 MB base64-encoded → ~10 MB raw audio
  @MaxLength(13_500_000, {
    message: 'audioBase64 exceeds maximum allowed size (~10 MB raw audio)',
  })
  audioBase64!: string

  @IsNotEmpty({ message: 'mimeType is required' })
  @IsString()
  @IsIn(ALLOWED_TRANSCRIBE_MIME_TYPES, {
    message: 'mimeType must be one of the supported audio formats',
  })
  mimeType!: string

  @IsOptional()
  @IsString()
  @MaxLength(20, {
    message: 'languageHint must be a BCP-47 tag (e.g. en-US, es-ES)',
  })
  languageHint?: string
}

export interface TranscribeResponse {
  transcript: string
}
