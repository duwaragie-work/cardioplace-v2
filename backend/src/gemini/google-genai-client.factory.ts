import { GoogleGenAI } from '@google/genai'
import type { ConfigService } from '@nestjs/config'

/**
 * Cardioplace is Vertex-AI-only. The chat surfaces (text + voice) talk
 * exclusively to Vertex AI in Google Cloud — there is no AI Studio
 * fallback path anymore. The `@google/genai` SDK supports both providers
 * behind the same `GoogleGenAI` constructor, so the call sites
 * (`client.models.generateContent`, `client.live.connect`, the
 * tool-declaration shape, etc.) are unchanged from the pre-migration
 * code. Only the constructor arguments differ — those live here.
 *
 * Auth is via Application Default Credentials (ADC):
 *   • Local dev / CI: set GOOGLE_APPLICATION_CREDENTIALS to the absolute
 *     path of a service-account JSON key.
 *   • Cloud Run / GKE / GCE: attach a service account to the runtime;
 *     ADC picks it up automatically — leave the env var unset.
 *
 * The SA needs `roles/aiplatform.user` on the project.
 */

export interface BuildGoogleGenAIClientOptions {
  /**
   * Optional API version override. The Voice/Live API path needs
   * `apiVersion: 'v1beta1'` on Vertex (Vertex ships Live under v1beta1,
   * not the SDK default). Text-chat consumers leave this unset and let
   * the SDK pick its default.
   */
  apiVersion?: string
}

/**
 * Build a Vertex-AI `GoogleGenAI` client.
 *
 * Required env:
 *   • GOOGLE_CLOUD_PROJECT          — GCP project id
 *   • GOOGLE_CLOUD_LOCATION         — optional, defaults to us-central1
 *   • GOOGLE_APPLICATION_CREDENTIALS — local dev / CI only; ignored when
 *     ADC resolves from an attached runtime service account.
 *
 * Throws with a specific, actionable message when GOOGLE_CLOUD_PROJECT is
 * missing — fails fast at startup rather than 401-ing on the first
 * request.
 */
export function buildGoogleGenAIClient(
  config: ConfigService,
  opts: BuildGoogleGenAIClientOptions = {},
): GoogleGenAI {
  const project = config.get<string>('GOOGLE_CLOUD_PROJECT')
  if (!project) {
    throw new Error(
      'GOOGLE_CLOUD_PROJECT is not defined — Cardioplace runs Gemini exclusively on Vertex AI in GCP. ' +
        'Set GOOGLE_CLOUD_PROJECT (and GOOGLE_APPLICATION_CREDENTIALS for local dev) in your env.',
    )
  }
  const location = config.get<string>('GOOGLE_CLOUD_LOCATION') ?? 'us-central1'
  return new GoogleGenAI({
    vertexai: true,
    project,
    location,
    ...(opts.apiVersion ? { apiVersion: opts.apiVersion } : {}),
  })
}
