import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ReadingsTab, {
  groupReadingsBySession,
  sameMinuteCollisionIds,
  type ReadingGroup,
} from './ReadingsTab'
import type { PatientJournalEntry } from '@/lib/services/provider.service'
import * as providerService from '@/lib/services/provider.service'

// F25 — admin Readings tab groups consecutive entries that share a sessionId
// into one bordered session card so a 3-reading BP check reads as one sitting,
// not three indistinguishable rows.

jest.mock('@/lib/services/provider.service', () => ({
  getPatientJournalEntries: jest.fn(),
  getPatientRejectedReadings: jest.fn(),
  addReading: jest.fn(),
  editReading: jest.fn(),
  deleteReading: jest.fn(),
}))

// Role-gated CRUD — default to the broadest write role; per-test overrides
// flip to OPS to assert the read-only rendering.
let mockUser: { id: string; roles: string[] } = { id: 'admin-1', roles: ['SUPER_ADMIN'] }
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: mockUser }),
}))

// Profile fetch gates the modal's Pregnancy-specific section; medication
// fetch drives the per-med adherence question. Defaults: not pregnant, no
// meds on file.
jest.mock('@/lib/services/patient-detail.service', () => ({
  getPatientProfile: jest.fn(() => Promise.resolve({ isPregnant: false })),
  getPatientMedications: jest.fn(() => Promise.resolve([])),
}))

const getEntries = providerService.getPatientJournalEntries as jest.MockedFunction<
  typeof providerService.getPatientJournalEntries
>
const getRejected = providerService.getPatientRejectedReadings as jest.MockedFunction<
  typeof providerService.getPatientRejectedReadings
>
const deleteReading = providerService.deleteReading as jest.MockedFunction<
  typeof providerService.deleteReading
>

/**
 * Fixture timestamps, anchored to "3 days ago" and expressed as minute offsets.
 *
 * These were previously hardcoded to 2026-05-2x. ReadingsTab defaults its date
 * filter to '30D' (see the `useState<DateFilter>('30D')` in the component), so
 * once wall-clock time drifted more than 30 days past those literals every
 * fixture row was filtered out, no `data-testid` rendered, and 9 tests went red
 * without a single line of source changing. Anchoring to `Date.now()` keeps the
 * relative gaps the session-grouping assertions rely on while making the suite
 * immune to that rot.
 */
const ANCHOR_MS = Date.now() - 3 * 24 * 60 * 60 * 1000
const mins = (offset: number): string =>
  new Date(ANCHOR_MS + offset * 60_000).toISOString()

function entry(over: Partial<PatientJournalEntry> = {}): PatientJournalEntry {
  return {
    id: 'je-x',
    measuredAt: mins(0),
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

  it('Bug 5 — groups consecutive NULL-session readings within the 5-min window (legacy / chat rows)', () => {
    const groups = groupReadingsBySession([
      entry({ id: 'a', sessionId: null, measuredAt: mins(0) }),
      entry({ id: 'b', sessionId: null, measuredAt: mins(2) }),
      entry({ id: 'c', sessionId: null, measuredAt: mins(4) }),
    ])
    expect(groups).toHaveLength(1)
    const session = groups[0] as Extract<ReadingGroup, { kind: 'session' }>
    expect(session.kind).toBe('session')
    expect(session.entries).toHaveLength(3)
  })

  it('Bug 5 — does NOT group NULL-session readings more than 5 min apart', () => {
    const groups = groupReadingsBySession([
      entry({ id: 'a', sessionId: null, measuredAt: mins(0) }),
      entry({ id: 'b', sessionId: null, measuredAt: mins(8) }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.kind === 'single')).toBe(true)
  })

  it('Bug 5 — a NULL-session reading never merges into an adjacent sessioned group', () => {
    const groups = groupReadingsBySession([
      entry({ id: 'a', sessionId: 's1', measuredAt: mins(0) }),
      entry({ id: 'b', sessionId: 's1', measuredAt: mins(1) }),
      entry({ id: 'c', sessionId: null, measuredAt: mins(2) }),
    ])
    expect(groups).toHaveLength(2)
    expect((groups[0] as Extract<ReadingGroup, { kind: 'session' }>).entries).toHaveLength(2)
    expect(groups[1].kind).toBe('single')
  })

  it('groups an admin-entered session exactly like a patient session (source-agnostic)', () => {
    // Patient logs 2 readings in one sitting, later an admin keys in 2 more
    // via the modal session flow — both pairs must render as session cards.
    const groups = groupReadingsBySession([
      entry({ id: 'adm-1', sessionId: 's-admin', source: 'admin', addedByUserId: 'md-1' }),
      entry({ id: 'adm-2', sessionId: 's-admin', source: 'admin', addedByUserId: 'md-1' }),
      entry({ id: 'pat-1', sessionId: 's-patient', source: 'manual' }),
      entry({ id: 'pat-2', sessionId: 's-patient', source: 'manual' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.kind === 'session')).toBe(true)
    const [admin, patient] = groups as Extract<ReadingGroup, { kind: 'session' }>[]
    expect(admin.sessionId).toBe('s-admin')
    expect(admin.entries).toHaveLength(2)
    expect(patient.sessionId).toBe('s-patient')
    expect(patient.entries).toHaveLength(2)
  })

  it('groups a mixed patient + admin-joined session as one card', () => {
    // Admin reading proximity-joined the patient's open session (same
    // sessionId) — one sitting, one card, regardless of who keyed each row.
    const groups = groupReadingsBySession([
      entry({ id: 'pat-1', sessionId: 's-mixed', source: 'manual' }),
      entry({ id: 'adm-1', sessionId: 's-mixed', source: 'admin', addedByUserId: 'md-1' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('session')
  })
})

describe('ReadingsTab — session grouping render (F25)', () => {
  beforeEach(() => {
    getRejected.mockResolvedValue([])
  })

  it('renders a session card around 3 same-session readings + a standalone row', async () => {
    getEntries.mockResolvedValue([
      entry({ id: 'a', sessionId: 's1', measuredAt: mins(3) }),
      entry({ id: 'b', sessionId: 's1', measuredAt: mins(1) }),
      entry({ id: 'c', sessionId: 's1', measuredAt: mins(-1) }),
      entry({ id: 'd', sessionId: null, measuredAt: mins(-18 * 60) }),
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

// ─── Admin readings CRUD (Add button / kebab / delete confirm) ───────────────

describe('ReadingsTab — role-gated CRUD affordances', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getRejected.mockResolvedValue([])
    mockUser = { id: 'admin-1', roles: ['SUPER_ADMIN'] }
  })

  it('shows the Add Reading button + per-row kebab for a write role', async () => {
    getEntries.mockResolvedValue([entry({ id: 'a' })])
    render(<ReadingsTab patientId="p1" />)

    await screen.findByTestId('admin-readings-card-a')
    expect(screen.getByTestId('admin-readings-add')).toBeInTheDocument()
    expect(screen.getByTestId('admin-reading-kebab-a')).toBeInTheDocument()
  })

  it('hides the Add Reading button + kebab for HEALPLACE_OPS (read-only)', async () => {
    mockUser = { id: 'ops-1', roles: ['HEALPLACE_OPS'] }
    getEntries.mockResolvedValue([entry({ id: 'a' })])
    render(<ReadingsTab patientId="p1" />)

    await screen.findByTestId('admin-readings-card-a')
    expect(screen.queryByTestId('admin-readings-add')).not.toBeInTheDocument()
    expect(screen.queryByTestId('admin-reading-kebab-a')).not.toBeInTheDocument()
  })

  it('Add Reading opens the add modal', async () => {
    getEntries.mockResolvedValue([])
    render(<ReadingsTab patientId="p1" />)

    fireEvent.click(await screen.findByTestId('admin-readings-add'))
    expect(screen.getByTestId('admin-add-edit-reading-modal')).toBeInTheDocument()
    expect(screen.getByText('Add reading')).toBeInTheDocument()
  })

  it('kebab → Edit opens the modal pre-populated with the row values', async () => {
    getEntries.mockResolvedValue([entry({ id: 'a', systolicBP: 151, diastolicBP: 93 })])
    render(<ReadingsTab patientId="p1" />)

    fireEvent.click(await screen.findByTestId('admin-reading-kebab-a'))
    fireEvent.click(screen.getByTestId('admin-reading-edit-a'))

    expect(screen.getByTestId('admin-add-edit-reading-modal')).toBeInTheDocument()
    expect(screen.getByTestId('admin-reading-systolic')).toHaveValue(151)
    expect(screen.getByTestId('admin-reading-diastolic')).toHaveValue(93)
  })

  it('kebab → Delete opens the confirmation; confirm calls DELETE and refreshes', async () => {
    getEntries.mockResolvedValue([entry({ id: 'a' })])
    deleteReading.mockResolvedValue(undefined)
    render(<ReadingsTab patientId="p1" />)

    fireEvent.click(await screen.findByTestId('admin-reading-kebab-a'))
    fireEvent.click(screen.getByTestId('admin-reading-delete-a'))
    expect(screen.getByTestId('admin-delete-reading-dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('admin-reading-delete-confirm'))
    await waitFor(() => expect(deleteReading).toHaveBeenCalledWith('p1', 'a'))
    // List refetched after the mutation (initial load + reload).
    await waitFor(() => expect(getEntries).toHaveBeenCalledTimes(2))
  })

  it('card press opens the modal read-only with an Edit switch (write role)', async () => {
    getEntries.mockResolvedValue([entry({ id: 'a', systolicBP: 151, diastolicBP: 93 })])
    render(<ReadingsTab patientId="p1" />)

    fireEvent.click(await screen.findByTestId('admin-readings-card-a'))

    expect(screen.getByTestId('admin-add-edit-reading-modal')).toBeInTheDocument()
    expect(screen.getByText('Reading details')).toBeInTheDocument()
    // Read-only: fields disabled, no Save — but the Edit switch is offered.
    expect(screen.getByTestId('admin-reading-systolic')).toBeDisabled()
    expect(screen.queryByTestId('admin-reading-save')).not.toBeInTheDocument()
    expect(screen.getByTestId('admin-reading-edit-switch')).toBeInTheDocument()

    // Edit switch flips the same modal into the editable form.
    fireEvent.click(screen.getByTestId('admin-reading-edit-switch'))
    expect(screen.getByText('Edit reading')).toBeInTheDocument()
    expect(screen.getByTestId('admin-reading-systolic')).not.toBeDisabled()
    expect(screen.getByTestId('admin-reading-save')).toBeInTheDocument()
  })

  it('card press for HEALPLACE_OPS opens read-only view WITHOUT the Edit switch', async () => {
    mockUser = { id: 'ops-1', roles: ['HEALPLACE_OPS'] }
    getEntries.mockResolvedValue([entry({ id: 'a' })])
    render(<ReadingsTab patientId="p1" />)

    fireEvent.click(await screen.findByTestId('admin-readings-card-a'))

    expect(screen.getByTestId('admin-add-edit-reading-modal')).toBeInTheDocument()
    expect(screen.getByTestId('admin-reading-systolic')).toBeDisabled()
    expect(screen.queryByTestId('admin-reading-edit-switch')).not.toBeInTheDocument()
  })

  it('kebab clicks do not bubble into the card view modal', async () => {
    getEntries.mockResolvedValue([entry({ id: 'a' })])
    render(<ReadingsTab patientId="p1" />)

    fireEvent.click(await screen.findByTestId('admin-reading-kebab-a'))
    // Menu opened; the view modal did NOT.
    expect(screen.getByTestId('admin-reading-edit-a')).toBeInTheDocument()
    expect(screen.queryByTestId('admin-add-edit-reading-modal')).not.toBeInTheDocument()
  })

  it('renders the Staff source pill with the actor name on admin-entered rows', async () => {
    getEntries.mockResolvedValue([
      entry({ id: 'a', source: 'admin', addedByUserId: 'md-1', addedByName: 'Manisha Patel' }),
    ])
    render(<ReadingsTab patientId="p1" />)

    const pill = await screen.findByTestId('admin-readings-staff-pill')
    expect(pill).toHaveTextContent(/staff · manisha patel/i)
  })
})

// Bug 15 — adaptive HH:MM:SS: only entries sharing a minute get flagged for seconds.
describe('sameMinuteCollisionIds (Bug 15)', () => {
  const at = (m: string) => `2026-06-16T${m}`

  it('no shared minute → empty set', () => {
    const ids = sameMinuteCollisionIds([
      { id: 'a', measuredAt: at('14:05:00') },
      { id: 'b', measuredAt: at('14:10:00') },
    ])
    expect(ids.size).toBe(0)
  })

  it('two readings in the same minute → both flagged', () => {
    const ids = sameMinuteCollisionIds([
      { id: 'a', measuredAt: at('14:10:23') },
      { id: 'b', measuredAt: at('14:10:47') },
    ])
    expect(ids).toEqual(new Set(['a', 'b']))
  })

  it('mixed: only the colliding pair is flagged', () => {
    const ids = sameMinuteCollisionIds([
      { id: 'a', measuredAt: at('14:05:00') },
      { id: 'b', measuredAt: at('14:10:23') },
      { id: 'c', measuredAt: at('14:10:47') },
      { id: 'd', measuredAt: at('14:15:00') },
    ])
    expect(ids).toEqual(new Set(['b', 'c']))
  })
})
