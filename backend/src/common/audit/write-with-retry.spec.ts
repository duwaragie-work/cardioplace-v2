import { jest } from '@jest/globals'

// Mock the tracer so we can assert the failure-span was opened without wiring
// a real OTEL exporter. The mock module MUST be registered before the code
// under test imports it — jest.unstable_mockModule (ESM) is the current shape.
const startSpan = jest.fn()
const setStatus = jest.fn()
const recordException = jest.fn()
const endSpan = jest.fn()

const fakeSpan = {
  setAttribute: jest.fn(),
  setStatus,
  recordException,
  end: endSpan,
}

jest.unstable_mockModule('./audit-tracer.js', () => ({
  auditTracer: {
    startSpan: (...args: unknown[]) => {
      startSpan(...args)
      return fakeSpan
    },
  },
}))

// Import AFTER the mock is registered so writeAuditWithRetry picks up the
// mocked tracer. This dance is required for ESM jest mocks.
const { writeAuditWithRetry: writeAuditWithRetryMocked } = await import('./write-with-retry.js')

describe('writeAuditWithRetry', () => {
  const originalError = console.error
  beforeEach(() => {
    startSpan.mockClear()
    setStatus.mockClear()
    recordException.mockClear()
    endSpan.mockClear()
    // Silence the structured-error console.error so Jest output stays clean;
    // we still assert it was called by wrapping it.
    console.error = jest.fn()
  })
  afterAll(() => {
    console.error = originalError
  })

  it('succeeds on first attempt → op called once, no span opened', async () => {
    const op = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)

    await writeAuditWithRetryMocked(op, { kind: 'access-log', modelName: 'JournalEntry', action: 'READ' })

    expect(op).toHaveBeenCalledTimes(1)
    expect(startSpan).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('retries on failure and succeeds on second attempt → op called twice, no span', async () => {
    const op = jest
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('transient DB blip'))
      .mockResolvedValueOnce(undefined)

    await writeAuditWithRetryMocked(op, { kind: 'auth-log', event: 'otp_verify_failed' })

    expect(op).toHaveBeenCalledTimes(2)
    expect(startSpan).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('exhausts retries → op called 3 times, span opened with ERROR status, JSON console.error emitted', async () => {
    const bang = new Error('DB unreachable')
    const op = jest.fn<() => Promise<void>>().mockRejectedValue(bang)

    // Must NOT throw — the caller's request path stays resilient.
    await expect(
      writeAuditWithRetryMocked(op, { kind: 'access-log', modelName: 'JournalEntry', action: 'READ', recordId: 'j-1' }),
    ).resolves.toBeUndefined()

    expect(op).toHaveBeenCalledTimes(3)

    // Span was opened once, with the audit.write.failed name + attributes.
    expect(startSpan).toHaveBeenCalledTimes(1)
    expect(startSpan).toHaveBeenCalledWith(
      'audit.write.failed',
      expect.objectContaining({
        attributes: expect.objectContaining({
          'audit.kind': 'access-log',
          'audit.model': 'JournalEntry',
          'audit.action': 'READ',
          'audit.recordId': 'j-1',
          'audit.error.message': 'DB unreachable',
        }),
      }),
    )
    // Span status was set to ERROR.
    expect(setStatus).toHaveBeenCalledWith({ code: 2, message: 'DB unreachable' }) // 2 = SpanStatusCode.ERROR
    // recordException was called with the underlying error.
    expect(recordException).toHaveBeenCalledWith(bang)
    // Span ended (must always end to release the resource).
    expect(endSpan).toHaveBeenCalledTimes(1)

    // Structured console.error emitted for greppability.
    expect(console.error).toHaveBeenCalledTimes(1)
    const firstCall = (console.error as jest.Mock).mock.calls[0]
    const errArg = firstCall?.[0] as string
    const parsed = JSON.parse(errArg)
    expect(parsed).toMatchObject({
      audit_write_failed: true,
      kind: 'access-log',
      error_message: 'DB unreachable',
      'audit.model': 'JournalEntry',
    })
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/) // ISO-8601
  })

  it('auth-log context is preserved through the failure report', async () => {
    const op = jest.fn<() => Promise<void>>().mockRejectedValue(new Error('boom'))

    await writeAuditWithRetryMocked(op, {
      kind: 'auth-log',
      event: 'refresh_failed',
      userId: 'u-1',
      identifier: 'x@example.com',
    })

    expect(startSpan).toHaveBeenCalledWith(
      'audit.write.failed',
      expect.objectContaining({
        attributes: expect.objectContaining({
          'audit.kind': 'auth-log',
          'audit.event': 'refresh_failed',
          'audit.userId': 'u-1',
          'audit.identifier': 'x@example.com',
        }),
      }),
    )
  })

  it('never rethrows even when the tracer itself errors', async () => {
    // Belt-and-suspenders: if the OTEL wiring is misconfigured and the tracer
    // throws, we must still not break the request path. Impl wraps reportFailure
    // in try/catch precisely for this case.
    startSpan.mockImplementationOnce(() => {
      throw new Error('tracer misconfigured')
    })
    const op = jest.fn<() => Promise<void>>().mockRejectedValue(new Error('op failed'))

    await expect(
      writeAuditWithRetryMocked(op, { kind: 'auth-log', event: 'e' }),
    ).resolves.toBeUndefined()
    // The DB write was attempted the full 3 times regardless.
    expect(op).toHaveBeenCalledTimes(3)
  })
})
