import { getPatientSummary } from './provider.service'
import { correctPatientProfile, getPatientProfile } from './patient-detail.service'
import { isOutOfScopeError } from './http-error'
import { fetchWithAuth } from './token'

jest.mock('./token', () => ({ fetchWithAuth: jest.fn() }))

const mockFetch = fetchWithAuth as jest.MockedFunction<typeof fetchWithAuth>

/**
 * S1 — the service layer must carry the HTTP status into the thrown error.
 *
 * http-error.test.ts proves `isOutOfScopeError` branches on status. That is
 * only useful if the callers actually PRODUCE an error carrying one, and both
 * call sites used to throw `new Error(err.message)` — discarding the status and
 * silently forcing PatientDetailShell's out-of-scope bounce back onto prose
 * matching. Reverting either line would restore that coupling with every other
 * test still green, so these tests pin the wiring itself, not just the helper.
 *
 * Covers both shapes: provider.service's hand-rolled block and
 * patient-detail.service's shared `jsonOrThrow`.
 */
function res(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe.each([
  ['getPatientSummary (provider.service)', () => getPatientSummary('p-1')],
  ['getPatientProfile (patient-detail.service jsonOrThrow)', () => getPatientProfile('p-1')],
])('%s carries the HTTP status', (_label, call) => {
  beforeEach(() => mockFetch.mockReset())

  it('a 403 produces an error the out-of-scope check recognises by STATUS', async () => {
    // Deliberately a message with no scope wording at all — if this still
    // reads as out-of-scope, the decision came from the status, which is the
    // whole point of S1. A prose-matching implementation fails here.
    mockFetch.mockResolvedValue(res(403, { message: 'nope' }))

    const err = await call().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as { status?: number }).status).toBe(403)
    expect(isOutOfScopeError(err)).toBe(true)
  })

  it('preserves the backend message verbatim for the error banner', async () => {
    mockFetch.mockResolvedValue(
      res(403, { message: 'Requested record is outside your role scope' }),
    )
    const err = await call().catch((e: unknown) => e)
    expect((err as Error).message).toBe(
      'Requested record is outside your role scope',
    )
  })

  it('a 404 carries its status and is NOT out-of-scope', async () => {
    // The distinction the admin UI depends on: 404 must show an error, not
    // bounce the user to the patient list with an "unauthorized" reason.
    mockFetch.mockResolvedValue(res(404, { message: 'Patient not found' }))

    const err = await call().catch((e: unknown) => e)
    expect((err as { status?: number }).status).toBe(404)
    expect(isOutOfScopeError(err)).toBe(false)
  })

  it('a 500 carries its status and is NOT out-of-scope', async () => {
    mockFetch.mockResolvedValue(res(500, {}))

    const err = await call().catch((e: unknown) => e)
    expect((err as { status?: number }).status).toBe(500)
    expect(isOutOfScopeError(err)).toBe(false)
  })

  it('survives a non-JSON error body without losing the status', async () => {
    // A gateway/proxy 403 (HTML body) still has to bounce correctly — the
    // json() rejection must not swallow the status.
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON')
      },
    } as unknown as Response)

    const err = await call().catch((e: unknown) => e)
    expect((err as { status?: number }).status).toBe(403)
    expect(isOutOfScopeError(err)).toBe(true)
  })
})

describe('validation errors keep their class-validator text (spec 31.28)', () => {
  beforeEach(() => mockFetch.mockReset())

  it('correctPatientProfile surfaces the raw validator message, not a fallback', async () => {
    // The exact CI regression: a 400 from ValidationPipe carries
    // `message: string[]`. ProfileTab regex-matches that text to render
    // "Height must be a whole number." When httpErrorFrom accepted only
    // strings, this collapsed to "Could not correct profile: 400" and the
    // patient-facing guidance degraded to "Please check the value and try
    // again" — green in every unit test, caught only by the e2e spec.
    mockFetch.mockResolvedValue(
      res(400, { message: ['corrections.heightCm must be an integer number'] }),
    )

    const err = await correctPatientProfile(
      'p-1',
      { heightCm: 170.5 } as never,
      'qa',
    ).catch((e: unknown) => e)

    expect((err as Error).message).toMatch(/integer number/i)
    expect((err as { status?: number }).status).toBe(400)
    // A 400 is not a scope denial — it must not bounce the user out.
    expect(isOutOfScopeError(err)).toBe(false)
  })
})

describe('success paths are unaffected by the S1 change', () => {
  beforeEach(() => mockFetch.mockReset())

  it('getPatientSummary unwraps `data` and throws nothing', async () => {
    mockFetch.mockResolvedValue(res(200, { data: { id: 'p-1', name: 'Jane' } }))
    await expect(getPatientSummary('p-1')).resolves.toEqual({
      id: 'p-1',
      name: 'Jane',
    })
  })

  it('getPatientProfile unwraps `data` and throws nothing', async () => {
    mockFetch.mockResolvedValue(res(200, { data: { userId: 'p-1' } }))
    await expect(getPatientProfile('p-1')).resolves.toEqual({ userId: 'p-1' })
  })

  it('a 200 with `data: null` resolves rather than throwing', async () => {
    // The profile endpoint legitimately returns null for a patient who has not
    // completed intake. What matters for S1 is that this stays a RESOLVED
    // value — it must never be mistaken for a failure and bounce the user out.
    //
    // Pinning the quirk rather than hiding it: `jsonOrThrow` unwraps with
    // `json.data ?? json`, and `??` treats null as absent — so a null `data`
    // yields the whole envelope `{ data: null }`, not `null`. Pre-existing,
    // unrelated to S1, and shared by every jsonOrThrow caller, so it is
    // deliberately not "fixed" here; tightening it to an `'data' in json`
    // check would change behaviour across the whole patient-detail service.
    mockFetch.mockResolvedValue(res(200, { data: null }))
    await expect(getPatientProfile('p-1')).resolves.toEqual({ data: null })
  })
})
