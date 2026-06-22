import { jest } from '@jest/globals'
import type { ConfigService } from '@nestjs/config'

// Mock the SDK BEFORE importing the factory so the factory's
// `new GoogleGenAI(...)` is captured by our spy. The constructor signature
// matters here: we want to assert the options object the factory passes,
// not actually open a network connection. Returning `this` from the mock
// keeps the production code path's downstream `instanceof` checks happy.
const constructorSpy = jest.fn()
jest.unstable_mockModule('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {
    constructor(opts: unknown) {
      constructorSpy(opts)
    }
  },
}))

// Dynamic import after the mock is registered.
const { buildGoogleGenAIClient, resolveGeminiProvider } = await import(
  './google-genai-client.factory.js'
)

function makeConfig(env: Record<string, string | undefined>): ConfigService {
  return {
    get: <T = string>(key: string): T | undefined => env[key] as T | undefined,
  } as unknown as ConfigService
}

beforeEach(() => {
  constructorSpy.mockClear()
})

// ─── resolveGeminiProvider ────────────────────────────────────────────────────

describe('resolveGeminiProvider', () => {
  it("defaults to 'ai_studio' when GEMINI_PROVIDER is unset (preserves pre-migration behavior)", () => {
    expect(resolveGeminiProvider(makeConfig({}))).toBe('ai_studio')
  })

  it("accepts 'ai_studio' verbatim", () => {
    expect(resolveGeminiProvider(makeConfig({ GEMINI_PROVIDER: 'ai_studio' }))).toBe(
      'ai_studio',
    )
  })

  it("accepts 'vertex' verbatim", () => {
    expect(resolveGeminiProvider(makeConfig({ GEMINI_PROVIDER: 'vertex' }))).toBe(
      'vertex',
    )
  })

  it("normalizes case ('VERTEX' → 'vertex', 'AI_Studio' → 'ai_studio')", () => {
    expect(resolveGeminiProvider(makeConfig({ GEMINI_PROVIDER: 'VERTEX' }))).toBe(
      'vertex',
    )
    expect(
      resolveGeminiProvider(makeConfig({ GEMINI_PROVIDER: 'AI_Studio' })),
    ).toBe('ai_studio')
  })

  it('throws actionable error on unrecognized provider (fails fast at startup)', () => {
    expect(() =>
      resolveGeminiProvider(makeConfig({ GEMINI_PROVIDER: 'openai' })),
    ).toThrow(/GEMINI_PROVIDER='openai' is invalid/)
  })
})

// ─── buildGoogleGenAIClient — AI Studio branch ────────────────────────────────

describe('buildGoogleGenAIClient — ai_studio branch', () => {
  it('passes { apiKey } to the SDK when GOOGLE_API_KEY is set', () => {
    buildGoogleGenAIClient(makeConfig({ GOOGLE_API_KEY: 'AIza-test-key' }))
    expect(constructorSpy).toHaveBeenCalledTimes(1)
    expect(constructorSpy).toHaveBeenCalledWith({ apiKey: 'AIza-test-key' })
  })

  it('honours apiVersion override (voice Live path pins v1alpha)', () => {
    buildGoogleGenAIClient(makeConfig({ GOOGLE_API_KEY: 'AIza-test-key' }), {
      apiVersion: 'v1alpha',
    })
    expect(constructorSpy).toHaveBeenCalledWith({
      apiKey: 'AIza-test-key',
      apiVersion: 'v1alpha',
    })
  })

  it('preserves the pre-migration error message when GOOGLE_API_KEY is unset', () => {
    expect(() => buildGoogleGenAIClient(makeConfig({}))).toThrow(
      'GOOGLE_API_KEY is not defined in environment',
    )
  })

  it('does NOT pass vertex/project/location to the SDK in the ai_studio branch (no provider leakage)', () => {
    buildGoogleGenAIClient(
      makeConfig({
        GOOGLE_API_KEY: 'AIza-test-key',
        // These are set in the env but provider=ai_studio (default) — they
        // must NOT reach the SDK constructor.
        GOOGLE_CLOUD_PROJECT: 'should-not-leak',
        GOOGLE_CLOUD_LOCATION: 'should-not-leak',
      }),
    )
    const opts = constructorSpy.mock.calls[0][0] as Record<string, unknown>
    expect(opts).not.toHaveProperty('vertexai')
    expect(opts).not.toHaveProperty('project')
    expect(opts).not.toHaveProperty('location')
  })
})

// ─── buildGoogleGenAIClient — Vertex branch ───────────────────────────────────

describe('buildGoogleGenAIClient — vertex branch', () => {
  it('passes { vertexai: true, project, location } to the SDK', () => {
    buildGoogleGenAIClient(
      makeConfig({
        GEMINI_PROVIDER: 'vertex',
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
      makeConfig({
        GEMINI_PROVIDER: 'vertex',
        GOOGLE_CLOUD_PROJECT: 'cardioplace-prod',
      }),
    )
    expect(constructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'us-central1' }),
    )
  })

  it('honours apiVersion override (voice Live on Vertex uses v1beta1)', () => {
    buildGoogleGenAIClient(
      makeConfig({
        GEMINI_PROVIDER: 'vertex',
        GOOGLE_CLOUD_PROJECT: 'cardioplace-prod',
      }),
      { apiVersion: 'v1beta1' },
    )
    expect(constructorSpy).toHaveBeenCalledWith({
      vertexai: true,
      project: 'cardioplace-prod',
      location: 'us-central1',
      apiVersion: 'v1beta1',
    })
  })

  it('throws actionable error when GOOGLE_CLOUD_PROJECT is unset', () => {
    expect(() =>
      buildGoogleGenAIClient(makeConfig({ GEMINI_PROVIDER: 'vertex' })),
    ).toThrow(
      'GEMINI_PROVIDER=vertex requires GOOGLE_CLOUD_PROJECT to be set',
    )
  })

  it('does NOT pass apiKey to the SDK in the vertex branch (no key leakage)', () => {
    buildGoogleGenAIClient(
      makeConfig({
        GEMINI_PROVIDER: 'vertex',
        GOOGLE_CLOUD_PROJECT: 'cardioplace-prod',
        // GOOGLE_API_KEY is set but we're on vertex — it must NOT leak
        // into the SDK constructor (would confuse the SDK + would show up
        // in error logs as a credential).
        GOOGLE_API_KEY: 'AIza-stale-key',
      }),
    )
    const opts = constructorSpy.mock.calls[0][0] as Record<string, unknown>
    expect(opts).not.toHaveProperty('apiKey')
  })
})

// ─── Rollback round-trip ─────────────────────────────────────────────────────

describe('rollback round-trip', () => {
  it('flipping GEMINI_PROVIDER vertex → ai_studio reverts to the apiKey constructor with no other changes (rollback proof)', () => {
    const baseEnv = {
      GEMINI_PROVIDER: 'vertex',
      GOOGLE_CLOUD_PROJECT: 'cardioplace-prod',
      GOOGLE_API_KEY: 'AIza-rollback-safety-net',
    }
    buildGoogleGenAIClient(makeConfig(baseEnv))
    expect(constructorSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ vertexai: true, project: 'cardioplace-prod' }),
    )

    // Flip the toggle. Everything else unchanged.
    buildGoogleGenAIClient(makeConfig({ ...baseEnv, GEMINI_PROVIDER: 'ai_studio' }))
    expect(constructorSpy).toHaveBeenLastCalledWith({
      apiKey: 'AIza-rollback-safety-net',
    })
  })
})
