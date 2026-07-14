import { jest } from '@jest/globals'
import { UnattributedSystemDisclosureDetector } from './unattributed-system-disclosure.detector.js'
import type { DetectorContext } from '../detector.types.js'

function makeCtx(rows: any[]): DetectorContext {
  const findMany = jest.fn<any>().mockResolvedValue(rows)
  return {
    prisma: { emailDisclosureLog: { findMany } } as any,
    now: new Date('2026-07-10T12:00:00Z'),
    windowStart: new Date('2026-07-09T12:00:00Z'),
    windowEnd: new Date('2026-07-10T12:00:00Z'),
  }
}

function row(template: string, id: string, minutesAgo = 0) {
  return {
    id,
    template,
    patientUserId: 'p-1',
    recipientEmail: 'r@example.com',
    sentAt: new Date(Date.parse('2026-07-10T12:00:00Z') - minutesAgo * 60_000),
    subject: 'subj',
  }
}

describe('UnattributedSystemDisclosureDetector — N7', () => {
  it('no candidates when there are no unattributed rows', async () => {
    expect(await new UnattributedSystemDisclosureDetector().scan(makeCtx([]))).toEqual([])
  })

  it('groups by template — one candidate per unique template', async () => {
    const rows = [
      row('welcome', 'e-1', 60),
      row('welcome', 'e-2', 30),
      row('otp', 'e-3', 20),
    ]
    const candidates = await new UnattributedSystemDisclosureDetector().scan(makeCtx(rows))
    expect(candidates).toHaveLength(2)
    const templates = candidates.map((c) => c.subjectKey).sort()
    expect(templates).toEqual(['template:otp', 'template:welcome'])
  })

  it('caps evidence sample at 5 rows per template', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => row('welcome', `e-${i}`, i))
    const candidates = await new UnattributedSystemDisclosureDetector().scan(makeCtx(rows))
    const sample = candidates[0].evidence.sample as any[]
    expect(sample.length).toBe(5)
    expect(candidates[0].evidence.totalCount).toBe(20)
  })

  it('practiceContext is null (attribution failed at source)', async () => {
    const rows = [row('welcome', 'e-1')]
    const candidates = await new UnattributedSystemDisclosureDetector().scan(makeCtx(rows))
    expect(candidates[0].practiceContext).toBeNull()
  })
})
