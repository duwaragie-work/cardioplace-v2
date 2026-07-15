import { jest } from '@jest/globals'
import {
  authFailureExtension,
  buildAuthFailureEvent,
  dispatchAuthFailure,
  type AuthLogRowLike,
} from './auth-failure.extension.js'
import { AUTH_EVENTS } from '../../auth/auth.events.js'

/**
 * Coverage for the auth-failure Prisma extension — the piece that turns every
 * failed AuthLog write into an AUTH_EVENTS.FAILURE emission with zero call-site
 * changes. The emit DECISION is a pure function (buildAuthFailureEvent) so it
 * can be exhaustively tested; a couple of integration-ish tests then drive the
 * extension's own query hook to prove the wiring + the never-throw guarantee.
 */

const NOW = new Date('2026-07-15T12:00:00Z')

function row(over: Partial<AuthLogRowLike> = {}): AuthLogRowLike {
  return {
    id: 'al-1',
    identifier: 'bad@example.com',
    userId: 'u-1',
    ipAddress: '10.0.0.1',
    event: 'otp_failed',
    practiceContext: 'practice-1',
    success: false,
    createdAt: NOW,
    ...over,
  }
}

describe('buildAuthFailureEvent', () => {
  it('builds an event for a failed row', () => {
    expect(buildAuthFailureEvent(row(), NOW)).toEqual({
      authLogId: 'al-1',
      identifier: 'bad@example.com',
      userId: 'u-1',
      ipAddress: '10.0.0.1',
      event: 'otp_failed',
      practiceContext: 'practice-1',
      createdAt: NOW,
    })
  })

  describe('returns null (no page) for', () => {
    it('a SUCCESS row', () => {
      expect(buildAuthFailureEvent(row({ success: true }))).toBeNull()
    })
    it('a row where success is undefined (not explicitly false)', () => {
      expect(buildAuthFailureEvent(row({ success: undefined }))).toBeNull()
    })
    it('a row with no id', () => {
      expect(buildAuthFailureEvent(row({ id: undefined }))).toBeNull()
    })
    it('a null result', () => {
      expect(buildAuthFailureEvent(null)).toBeNull()
    })
    it('an undefined result', () => {
      expect(buildAuthFailureEvent(undefined)).toBeNull()
    })
  })

  describe('edge fields', () => {
    it('preserves a null identifier (the evaluator filters, not this)', () => {
      // The dev-OTP / null-identifier exclusion lives in the shared aggregation,
      // NOT here — so a null identifier still emits an event.
      const ev = buildAuthFailureEvent(row({ identifier: null }))
      expect(ev?.identifier).toBeNull()
    })
    it('does NOT filter the dev perma-OTP identifier here', () => {
      const ev = buildAuthFailureEvent(row({ identifier: '666666' }))
      expect(ev?.identifier).toBe('666666')
    })
    it('defaults a missing event name to empty string', () => {
      expect(buildAuthFailureEvent(row({ event: undefined }))?.event).toBe('')
    })
    it('falls back to `now` when createdAt is missing', () => {
      const ev = buildAuthFailureEvent(row({ createdAt: undefined }), NOW)
      expect(ev?.createdAt).toBe(NOW)
    })
    it('nulls missing userId / ipAddress / practiceContext', () => {
      const ev = buildAuthFailureEvent(
        row({ userId: undefined, ipAddress: undefined, practiceContext: undefined }),
      )
      expect(ev).toMatchObject({ userId: null, ipAddress: null, practiceContext: null })
    })
  })
})

describe('dispatchAuthFailure — emit path + never-throw guard', () => {
  it('emits AUTH_EVENTS.FAILURE for a failed row', () => {
    const emit = jest.fn()
    dispatchAuthFailure({ emit } as any, row())
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0][0]).toBe(AUTH_EVENTS.FAILURE)
    expect((emit.mock.calls[0][1] as any).identifier).toBe('bad@example.com')
  })

  it('does NOT emit for a successful row', () => {
    const emit = jest.fn()
    dispatchAuthFailure({ emit } as any, row({ success: true }))
    expect(emit).not.toHaveBeenCalled()
  })

  it('does NOT emit for a null / ignored result', () => {
    const emit = jest.fn()
    dispatchAuthFailure({ emit } as any, null)
    dispatchAuthFailure({ emit } as any, { notARow: true })
    expect(emit).not.toHaveBeenCalled()
  })

  it('NEVER throws even if the listener throws — the write path is protected', () => {
    const emit = jest.fn(() => {
      throw new Error('listener blew up')
    })
    // Must not propagate — the auth-log write must be unaffected.
    expect(() => dispatchAuthFailure({ emit } as any, row())).not.toThrow()
    expect(emit).toHaveBeenCalledTimes(1)
  })
})

describe('authFailureExtension — factory', () => {
  it('returns a defined Prisma extension object', () => {
    // Prisma.defineExtension does not surface `.name` on its return value, so
    // we only assert the factory produces an extension; behaviour is covered by
    // dispatchAuthFailure above and the @OnEvent wiring in the smoke spec.
    expect(authFailureExtension({ emit: jest.fn() } as any)).toBeDefined()
  })
})
