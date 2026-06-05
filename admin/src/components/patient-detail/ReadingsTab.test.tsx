import { render, screen } from '@testing-library/react'
import ReadingsTab, { groupReadingsBySession, type ReadingGroup } from './ReadingsTab'
import type { PatientJournalEntry } from '@/lib/services/provider.service'
import * as providerService from '@/lib/services/provider.service'

// F25 — admin Readings tab groups consecutive entries that share a sessionId
// into one bordered session card so a 3-reading BP check reads as one sitting,
// not three indistinguishable rows.

jest.mock('@/lib/services/provider.service', () => ({
  getPatientJournalEntries: jest.fn(),
  getPatientRejectedReadings: jest.fn(),
}))

const getEntries = providerService.getPatientJournalEntries as jest.MockedFunction<
  typeof providerService.getPatientJournalEntries
>
const getRejected = providerService.getPatientRejectedReadings as jest.MockedFunction<
  typeof providerService.getPatientRejectedReadings
>

function entry(over: Partial<PatientJournalEntry> = {}): PatientJournalEntry {
  return {
    id: 'je-x',
    measuredAt: '2026-05-22T03:00:00Z',
    sessionId: null,
    systolicBP: 130,
    diastolicBP: 80,
    pulse: 72,
    source: 'manual',
    deviations: [],
    otherSymptoms: [],
    failedConditions: [],
    missedMedications: [],
    ...over,
  } as unknown as PatientJournalEntry
}

describe('groupReadingsBySession (F25)', () => {
  it('groups 3 same-session readings and keeps a standalone separate', () => {
    const entries = [
      entry({ id: 'a', sessionId: 's1' }),
      entry({ id: 'b', sessionId: 's1' }),
      entry({ id: 'c', sessionId: 's1' }),
      entry({ id: 'd', sessionId: null }),
    ]
    const groups = groupReadingsBySession(entries)
    expect(groups).toHaveLength(2)
    const session = groups[0] as Extract<ReadingGroup, { kind: 'session' }>
    expect(session.kind).toBe('session')
    expect(session.entries).toHaveLength(3)
    expect(groups[1].kind).toBe('single')
  })

  it('treats a lone sessionId reading as a single, not a session card', () => {
    const groups = groupReadingsBySession([entry({ id: 'solo', sessionId: 's9' })])
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('single')
  })

  it('does not merge non-consecutive readings that reuse a sessionId', () => {
    const groups = groupReadingsBySession([
      entry({ id: 'a', sessionId: 's1' }),
      entry({ id: 'b', sessionId: 's2' }),
      entry({ id: 'c', sessionId: 's1' }),
    ])
    expect(groups).toHaveLength(3)
    expect(groups.every((g) => g.kind === 'single')).toBe(true)
  })
})

describe('ReadingsTab — session grouping render (F25)', () => {
  beforeEach(() => {
    getRejected.mockResolvedValue([])
  })

  it('renders a session card around 3 same-session readings + a standalone row', async () => {
    getEntries.mockResolvedValue([
      entry({ id: 'a', sessionId: 's1', measuredAt: '2026-05-22T03:03:00Z' }),
      entry({ id: 'b', sessionId: 's1', measuredAt: '2026-05-22T03:01:00Z' }),
      entry({ id: 'c', sessionId: 's1', measuredAt: '2026-05-22T02:59:00Z' }),
      entry({ id: 'd', sessionId: null, measuredAt: '2026-05-21T09:00:00Z' }),
    ])
    render(<ReadingsTab patientId="p1" />)

    const header = await screen.findByTestId('admin-readings-session-header')
    expect(header).toHaveTextContent(/session: 3 readings/i)
    expect(screen.getByTestId('admin-readings-session-s1')).toBeInTheDocument()
    // All three session rows + the standalone row still render their cards.
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(screen.getByTestId(`admin-readings-card-${id}`)).toBeInTheDocument()
    }
    // Only one session container exists (the standalone is not wrapped).
    expect(screen.getAllByTestId('admin-readings-session-header')).toHaveLength(1)
  })
})
