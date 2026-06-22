import { GoogleGenAI } from '@google/genai'
import type { ConfigService } from '@nestjs/config'

/**
 * Provider toggle for the `@google/genai` SDK — picks between Google AI
 * Studio (the original/default, authenticated by GOOGLE_API_KEY) and
 * Vertex AI in Google Cloud (authenticated by Application Default
 * Credentials, scoped to a GCP project + region).
 *
 * The SDK supports both providers behind the same `GoogleGenAI` constructor
 * — only the constructor arguments differ. All downstream call sites
 * (`client.models.generateContent`, `client.live.connect`, the
 * tool-declaration shape, etc.) are identical across providers.
 *
 * The toggle lives as an explicit env var (`GEMINI_PROVIDER`) instead of
 * the SDK's implicit `GOOGLE_GENAI_USE_VERTEXAI` auto-detect so the
 * migration intent is visible in code review and the rollback path is a
 * single env-var flip.
 *
 * Defaults to `ai_studio` so an unset env preserves pre-migration behavior.
 */
export type GeminiProvider = 'ai_studio' | 'vertex'

export interface BuildGoogleGenAIClientOptions {
  /**
   * Optional API version override. The Voice/Live API path pins
   * `apiVersion: 'v1alpha'` against AI Studio (the only published Live
   * surface there) and `apiVersion: 'v1beta1'` against Vertex (Vertex's
   * Live API ships under v1beta1, not v1alpha). Text-chat consumers leave
   * this unset and let the SDK pick its default.
   */
  apiVersion?: string
}

/**
 * Resolve the configured provider. Default `ai_studio` so unset envs
 * preserve pre-migration behavior across local dev, CI, and prod.
 */
export function resolveGeminiProvider(config: ConfigService): GeminiProvider {
  const raw = (config.get<string>('GEMINI_PROVIDER') ?? 'ai_studio').toLowerCase()
  if (raw === 'vertex') return 'vertex'
  if (raw === 'ai_studio') return 'ai_studio'
  throw new Error(
    `GEMINI_PROVIDER='${raw}' is invalid — expected 'ai_studio' or 'vertex'`,
  )
}

/**
 * Build a `GoogleGenAI` client for the configured provider.
 *
 * Required env per provider:
 *   • ai_studio → GOOGLE_API_KEY
 *   • vertex    → GOOGLE_CLOUD_PROJECT (+ optional GOOGLE_CLOUD_LOCATION,
 *                 defaults to us-central1). Authentication uses Application
 *                 Default Credentials (ADC) — set
 *                 GOOGLE_APPLICATION_CREDENTIALS in dev / CI; on Cloud Run
 *                 / GKE / GCE with an attached service account ADC picks
 *                 it up automatically.
 *
 * Throws with a specific, actionable message when a provider-required env
 * is missing — mirrors the existing fail-fast pattern in the pre-migration
 * code (`'GOOGLE_API_KEY is not defined in environment'`).
 */
export function buildGoogleGenAIClient(
  config: ConfigService,
  opts: BuildGoogleGenAIClientOptions = {},
): GoogleGenAI {
  const provider = resolveGeminiProvider(config)

  if (provider === 'vertex') {
    const project = config.get<string>('GOOGLE_CLOUD_PROJECT')
    if (!project) {
      throw new Error(
        'GEMINI_PROVIDER=vertex requires GOOGLE_CLOUD_PROJECT to be set',
      )
    }
    const location =
      config.get<string>('GOOGLE_CLOUD_LOCATION') ?? 'us-central1'
    return new GoogleGenAI({
      vertexai: true,
      project,
      location,
      ...(opts.apiVersion ? { apiVersion: opts.apiVersion } : {}),
    })
  }

  // provider === 'ai_studio'
  const apiKey = config.get<string>('GOOGLE_API_KEY')
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY is not defined in environment')
  }
  return new GoogleGenAI({
    apiKey,
    ...(opts.apiVersion ? { apiVersion: opts.apiVersion } : {}),
  })
}
