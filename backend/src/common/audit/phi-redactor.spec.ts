import { NullRedactor } from './phi-redactor.js'
import type { AccessLogData } from '../prisma-extensions/access-log.extension.js'

// V-17 — the default binding must ALWAYS drop; if this spec ever fails it means
// someone flipped the default to a permissive redactor before V-05 landed and
// PHI would start leaking to disk. Trivial + high-consequence.

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
