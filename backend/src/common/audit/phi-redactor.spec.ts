import { jest } from '@jest/globals'
import { Logger } from '@nestjs/common'
import { NullRedactor, StrictMetadataRedactor } from './phi-redactor.js'
import type { AccessLogData } from '../prisma-extensions/access-log.extension.js'

// V-17 redactors.
//
// NullRedactor was the default until 2026-07-17 (dropped everything pending
// V-05). It is retained as an explicit "write nothing" escape hatch, so its
// drop-everything contract still needs guarding.
//
// StrictMetadataRedactor is the live binding. Its job is NOT to strip clinical
// values — AccessLogData is a closed metadata-only struct, so none can reach it
// (computeAccessLogData only lifts `args.where.id` + actor/ip/UA context). Its
// job is defence in depth: whitelist-project the known keys so a future
// widening of AccessLogData, or a caller passing an extra field, cannot ride
// along to disk unreviewed.

const SAMPLE_PAYLOAD: AccessLogData = {
  actorId: 'user-1',
  actorType: 'USER',
  systemActorLabel: null,
  runId: 'req-abc',
  practiceContext: 'practice-1',
  action: 'READ',
  modelName: 'JournalEntry',
  recordId: 'entry-42',
  ip: '127.0.0.1',
  userAgent: 'jest',
}

describe('NullRedactor (V-17 default PHI_REDACTOR binding)', () => {
  it('always returns null (drops every payload)', () => {
    const r = new NullRedactor()
    expect(r.redact(SAMPLE_PAYLOAD)).toBeNull()
  })

  it('returns null even for a minimal payload (no fields to strip)', () => {
    const r = new NullRedactor()
    const minimal: AccessLogData = {
      actorId: null,
      actorType: 'SYSTEM_ACTOR',
      systemActorLabel: null,
      runId: null,
      practiceContext: null,
      action: 'READ',
      modelName: 'PatientProfile',
      recordId: null,
      ip: null,
      userAgent: null,
    }
    expect(r.redact(minimal)).toBeNull()
  })
})

describe('StrictMetadataRedactor (V-17 live PHI_REDACTOR binding)', () => {
  it('passes the full metadata payload through unchanged', () => {
    const r = new StrictMetadataRedactor()
    expect(r.redact(SAMPLE_PAYLOAD)).toEqual(SAMPLE_PAYLOAD)
  })

  it('never drops a well-formed record (an audit outage is itself a §164.312(b) failure)', () => {
    const r = new StrictMetadataRedactor()
    expect(r.redact(SAMPLE_PAYLOAD)).not.toBeNull()
  })

  it('preserves nulls rather than coercing them', () => {
    const r = new StrictMetadataRedactor()
    const minimal: AccessLogData = {
      actorId: null,
      actorType: 'SYSTEM_ACTOR',
      systemActorLabel: null,
      runId: null,
      practiceContext: null,
      action: 'READ',
      modelName: 'PatientProfile',
      recordId: null,
      ip: null,
      userAgent: null,
    }
    expect(r.redact(minimal)).toEqual(minimal)
  })

  it('drops an unexpected key rather than writing it to disk (shape-drift guard)', () => {
    const r = new StrictMetadataRedactor()
    // Simulates someone widening AccessLogData with a clinical field and not
    // reviewing the redactor — the exact leak this class exists to prevent.
    const drifted = {
      ...SAMPLE_PAYLOAD,
      resolutionNotes: 'patient reports crushing chest pain',
    } as unknown as AccessLogData

    const out = r.redact(drifted)

    expect(out).toEqual(SAMPLE_PAYLOAD)
    expect(out).not.toHaveProperty('resolutionNotes')
    expect(JSON.stringify(out)).not.toContain('chest pain')
  })

  it('warns once per unknown key, not once per record', () => {
    const r = new StrictMetadataRedactor()
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {})

    const drifted = {
      ...SAMPLE_PAYLOAD,
      symptomText: 'dizzy',
    } as unknown as AccessLogData

    r.redact(drifted)
    r.redact(drifted)
    r.redact(drifted)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('symptomText')
    // The warning must name the key, never echo its value.
    expect(String(warn.mock.calls[0][0])).not.toContain('dizzy')

    warn.mockRestore()
  })
})
