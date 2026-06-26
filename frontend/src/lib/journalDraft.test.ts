import {
  BUFFER_WINDOW_MS,
  createDraft,
  addReading,
  updateReading,
  removeReading,
  remainingMs,
  isExpired,
  commitPayloads,
  loadDraft,
  saveDraft,
  clearDraft,
  type BufferedReading,
  type JournalDraft,
} from './journalDraft'

const reading = (localId: string, sys: number): BufferedReading => ({
  localId,
  payload: { measuredAt: '2026-06-16T15:00:00.000Z', systolicBP: sys, diastolicBP: 80 },
})

describe('journalDraft — pure reducers (Part 1 buffer)', () => {
  it('createDraft seeds a single-reading session', () => {
    const d = createDraft('s1', 1000, reading('a', 130))
    expect(d).toEqual({
      sessionId: 's1',
      createdAt: 1000,
      readings: [reading('a', 130)],
    })
  })

  it('addReading appends without mutating the original', () => {
    const d1 = createDraft('s1', 1000, reading('a', 130))
    const d2 = addReading(d1, reading('b', 128))
    expect(d2.readings).toHaveLength(2)
    expect(d1.readings).toHaveLength(1) // immutable
  })

  it('addReading does NOT change createdAt (countdown must not reset)', () => {
    const d1 = createDraft('s1', 1000, reading('a', 130))
    const d2 = addReading(d1, reading('b', 128))
    expect(d2.createdAt).toBe(1000)
  })

  it('updateReading replaces only the matching reading', () => {
    const d = addReading(createDraft('s1', 1000, reading('a', 130)), reading('b', 128))
    const updated = updateReading(d, 'b', {
      measuredAt: '2026-06-16T15:01:00.000Z',
      systolicBP: 200,
      diastolicBP: 110,
    })
    expect(updated.readings.find((r) => r.localId === 'b')!.payload.systolicBP).toBe(200)
    expect(updated.readings.find((r) => r.localId === 'a')!.payload.systolicBP).toBe(130)
  })

  it('removeReading drops the matching reading', () => {
    const d = addReading(createDraft('s1', 1000, reading('a', 130)), reading('b', 128))
    const out = removeReading(d, 'a')
    expect(out.readings.map((r) => r.localId)).toEqual(['b'])
  })

  it('remainingMs counts down from the window and clamps at 0', () => {
    const d = createDraft('s1', 1000, reading('a', 130))
    expect(remainingMs(d, 1000)).toBe(BUFFER_WINDOW_MS)
    expect(remainingMs(d, 1000 + 60_000)).toBe(BUFFER_WINDOW_MS - 60_000)
    expect(remainingMs(d, 1000 + BUFFER_WINDOW_MS + 5_000)).toBe(0)
  })

  it('isExpired flips at createdAt + window', () => {
    const d = createDraft('s1', 1000, reading('a', 130))
    expect(isExpired(d, 1000 + BUFFER_WINDOW_MS - 1)).toBe(false)
    expect(isExpired(d, 1000 + BUFFER_WINDOW_MS)).toBe(true)
  })

  it('commitPayloads stamps every reading with the draft session id', () => {
    const d = addReading(
      createDraft('shared-session', 1000, reading('a', 130)),
      // a reading composed with a stale/other sessionId must be overridden
      { localId: 'b', payload: { measuredAt: 'x', systolicBP: 128, diastolicBP: 80, sessionId: 'stale' } },
    )
    const payloads = commitPayloads(d)
    expect(payloads.every((p) => p.sessionId === 'shared-session')).toBe(true)
  })
})

describe('journalDraft — sessionStorage I/O', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('save → load round-trips the draft', () => {
    const d = createDraft('s1', 1000, reading('a', 130))
    saveDraft('u1', d)
    expect(loadDraft('u1')).toEqual(d)
  })

  it('loadDraft returns null when nothing is stored', () => {
    expect(loadDraft('nobody')).toBeNull()
  })

  it('clearDraft removes the stored draft', () => {
    saveDraft('u1', createDraft('s1', 1000, reading('a', 130)))
    clearDraft('u1')
    expect(loadDraft('u1')).toBeNull()
  })

  it('loadDraft rejects a malformed / empty-readings draft', () => {
    window.sessionStorage.setItem('cardioplace_buffer_draft:u1', JSON.stringify({ sessionId: 's', createdAt: 1, readings: [] }))
    expect(loadDraft('u1')).toBeNull()
    window.sessionStorage.setItem('cardioplace_buffer_draft:u2', '{not json')
    expect(loadDraft('u2')).toBeNull()
  })

  it('drafts are scoped per user', () => {
    saveDraft('u1', createDraft('s1', 1000, reading('a', 130)))
    expect(loadDraft('u2')).toBeNull()
  })
})
