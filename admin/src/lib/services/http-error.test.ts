import { HttpError, httpErrorFrom, isOutOfScopeError } from './http-error'

/**
 * S1 (alert-resolve IDOR review, 2026-07-21).
 *
 * The behaviour under test is what makes the backend's 403 wording safe to
 * change: PatientDetailShell's out-of-scope bounce keys off the STATUS. It used
 * to key off the message prose, so a server-side rewording could silently
 * downgrade a clean "not authorized" redirect into a raw error banner with
 * nothing failing at compile time.
 *
 * The prose fallback is tested too — not as decoration, but because errors can
 * still arrive from call sites that haven't moved to httpErrorFrom, and a 403
 * must not be missed just because the status was dropped upstream.
 */
describe('httpErrorFrom', () => {
  it('keeps the server message and carries the status', () => {
    const e = httpErrorFrom(
      { message: 'Requested record is outside your role scope' },
      403,
    )
    expect(e).toBeInstanceOf(HttpError)
    expect(e.message).toBe('Requested record is outside your role scope')
    expect(e.status).toBe(403)
  })

  it('falls back to "<fallback>: <status>" when the body has no message', () => {
    const e = httpErrorFrom({}, 500, 'Could not load profile')
    expect(e.message).toBe('Could not load profile: 500')
    expect(e.status).toBe(500)
  })

  // Nest sends `message` as a STRING for a thrown HttpException and a STRING[]
  // for a ValidationPipe failure. The array case is load-bearing, not cosmetic:
  // ProfileTab's friendlyCorrectionError() regex-matches the raw class-validator
  // text to render "Height must be a whole number." An earlier version of this
  // helper accepted only strings, so arrays fell through to the generic fallback
  // and that guidance silently degraded — caught by spec 31.28 in CI, not here.
  // These tests exist so it is caught here next time.
  it('preserves a class-validator message array so field guidance still resolves', () => {
    const e = httpErrorFrom(
      { message: ['corrections.heightCm must be an integer number'] },
      400,
      'Could not correct profile',
    )
    expect(e.message).toBe('corrections.heightCm must be an integer number')
    // The property ProfileTab actually depends on.
    expect(e.message).toMatch(/integer|number/i)
    expect(e.status).toBe(400)
  })

  it('joins a multi-error validator array', () => {
    const e = httpErrorFrom(
      { message: ['heightCm must not be less than 50', 'heightCm must not be greater than 250'] },
      400,
    )
    expect(e.message).toBe(
      'heightCm must not be less than 50, heightCm must not be greater than 250',
    )
  })

  it('still refuses a plain object rather than rendering "[object Object]"', () => {
    const e = httpErrorFrom({ message: { nested: 'oops' } }, 400)
    expect(e.message).toBe('Request failed: 400')
  })
})

describe('isOutOfScopeError', () => {
  it('is true for a 403 HttpError regardless of wording', () => {
    // The whole point: no prose is consulted on this path.
    expect(isOutOfScopeError(new HttpError('anything at all', 403))).toBe(true)
  })

  it('is false for other statuses, including 404 and 500', () => {
    expect(isOutOfScopeError(new HttpError('Not found', 404))).toBe(false)
    expect(isOutOfScopeError(new HttpError('Server error', 500))).toBe(false)
  })

  it('does NOT treat a 404 as out-of-scope even if the text mentions scope', () => {
    // Status wins over prose for an HttpError — otherwise an unscoped OPS
    // hitting an absent patient (404) would get bounced with the wrong reason,
    // which is exactly what qa/tests/30s asserts must not happen.
    expect(
      isOutOfScopeError(new HttpError('outside your role scope', 404)),
    ).toBe(false)
  })

  describe('legacy fallback for errors thrown without a status', () => {
    it.each([
      ['post-S1 generic message', 'Requested record is outside your role scope'],
      ['pre-S1 interpolated message', 'Patient 01J8XYZ is outside your role scope'],
      ['MED_DIR variant', 'Requested record is outside your MED_DIR scope'],
      ['management variant', 'Requested record is outside your management scope'],
      ['bare status text', 'Request failed: 403'],
      ['Nest error field echoed into the message', 'Forbidden resource'],
    ])('matches %s', (_label, message) => {
      expect(isOutOfScopeError(new Error(message))).toBe(true)
    })

    it('does not match unrelated failures', () => {
      expect(isOutOfScopeError(new Error('Network error — please retry.'))).toBe(
        false,
      )
      expect(isOutOfScopeError(new Error('Could not load profile: 500'))).toBe(
        false,
      )
    })
  })

  it('tolerates non-Error throwables without blowing up', () => {
    expect(isOutOfScopeError(null)).toBe(false)
    expect(isOutOfScopeError(undefined)).toBe(false)
    expect(isOutOfScopeError('outside your role scope')).toBe(true)
  })
})
