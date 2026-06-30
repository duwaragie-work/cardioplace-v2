import { jest } from '@jest/globals'
import type { ConfigService } from '@nestjs/config'

// Mock the SDK BEFORE importing the factory so the factory's
// `new GoogleGenAI(...)` is captured by our spy. The constructor signature
// matters here: we want to assert the options object the factory passes,
// not actually open a network connection.
const constructorSpy = jest.fn()
jest.unstable_mockModule('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {
    constructor(opts: unknown) {
      constructorSpy(opts)
    }
  },
}))

// Dynamic import after the mock is registered.
const { buildGoogleGenAIClient } = await import('./google-genai-client.factory.js')

function makeConfig(env: Record<string, string | undefined>): ConfigService {
  return {
    get: <T = string>(key: string): T | undefined => env[key] as T | undefined,
  } as unknown as ConfigService
}

beforeEach(() => {
  constructorSpy.mockClear()
})

describe('buildGoogleGenAIClient — Vertex AI only', () => {
  it('passes { vertexai: true, project, location } to the SDK when env is configured', () => {
    buildGoogleGenAIClient(
      makeConfig({
        GOOGLE_CLOUD_PROJECT: 'cardioplace-prod',
        GOOGLE_CLOUD_LOCATION: 'us-central1',
      }),
    )
    expect(constructorSpy).toHaveBeenCalledTimes(1)
    expect(constructorSpy).toHaveBeenCalledWith({
      vertexai: true,
      project: 'cardioplace-prod',
      location: 'us-central1',
    })
  })

  it("defaults location to 'us-central1' when GOOGLE_CLOUD_LOCATION is unset", () => {
    buildGoogleGenAIClient(
      makeConfig({ GOOGLE_CLOUD_PROJECT: 'cardioplace-prod' }),
    )
    expect(constructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'us-central1' }),
    )
  })

  it('honours apiVersion override (voice Live on Vertex requires v1beta1)', () => {
    buildGoogleGenAIClient(
      makeConfig({ GOOGLE_CLOUD_PROJECT: 'cardioplace-prod' }),
      { apiVersion: 'v1beta1' },
    )
    expect(constructorSpy).toHaveBeenCalledWith({
      vertexai: true,
      project: 'cardioplace-prod',
      location: 'us-central1',
      apiVersion: 'v1beta1',
    })
  })

  it('omits apiVersion entirely when not specified (text-chat default path)', () => {
    buildGoogleGenAIClient(makeConfig({ GOOGLE_CLOUD_PROJECT: 'cardioplace-prod' }))
    const opts = constructorSpy.mock.calls[0][0] as Record<string, unknown>
    expect(opts).not.toHaveProperty('apiVersion')
  })

  it('throws actionable error when GOOGLE_CLOUD_PROJECT is unset (fails fast at startup, not on first request)', () => {
    expect(() => buildGoogleGenAIClient(makeConfig({}))).toThrow(
      /GOOGLE_CLOUD_PROJECT is not defined/,
    )
  })

  it('never threads an apiKey through to the SDK (no residual AI Studio path)', () => {
    // Even if a stale GOOGLE_API_KEY lingers in the env from a pre-migration
    // deployment, the factory must NOT pass it to the SDK constructor.
    buildGoogleGenAIClient(
      makeConfig({
        GOOGLE_CLOUD_PROJECT: 'cardioplace-prod',
        GOOGLE_API_KEY: 'AIza-stale-key-from-pre-migration',
      }),
    )
    const opts = constructorSpy.mock.calls[0][0] as Record<string, unknown>
    expect(opts).not.toHaveProperty('apiKey')
  })
})
