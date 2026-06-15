import { render, screen, fireEvent, within } from '@testing-library/react'
import TimelineTab from './TimelineTab'
import type {
  PatientAlert,
  ProfileVerificationLog,
} from '@/lib/services/patient-detail.service'

// READINGS Timeline filter — journal-entry audit rows (the 6
// *_READING_* changeTypes written by DailyJournalService.writeJournalAudit)
// merge into the existing ProfileVerificationLog stream and surface under
// their own filter chip, separate from PROFILE / MEDICATION / ALERT.

function readingSnapshot(over: Record<string, unknown> = {}) {
  return {
    entryId: 'entry-1',
    measuredAt: '2026-06-12T10:00:00.000Z',
    systolicBP: 140,
    diastolicBP: 90,
    pulse: 72,
    weight: null,
    position: 'SITTING',
    sessionId: 's1',
    medicationTaken: null,
    missedDoses: null,
    symptoms: [],
    notes: null,
    source: 'manual',
    ...over,
  }
}

function makeLog(over: Partial<ProfileVerificationLog>): ProfileVerificationLog {
  return {
    id: 'log-1',
    userId: 'patient-1',
    fieldPath: 'journal_entry.created',
    previousValue: null,
    newValue: readingSnapshot(),
    changedBy: 'patient-1',
    changedByName: 'Pat Patient',
    changedByRole: 'PATIENT',
    changedByRoleResolved: 'PATIENT',
    changeType: 'PATIENT_READING_CREATED',
    discrepancyFlag: false,
    rationale: null,
    createdAt: '2026-06-12T10:00:05.000Z',
    ...over,
  } as ProfileVerificationLog
}

const READING_LOGS: ProfileVerificationLog[] = [
  makeLog({ id: 'r1' }),
  makeLog({
    id: 'r2',
    fieldPath: 'journal_entry.edited',
    changeType: 'PATIENT_READING_EDITED',
    previousValue: readingSnapshot({ systolicBP: 138, diastolicBP: 88 }),
    newValue: readingSnapshot({ systolicBP: 145, diastolicBP: 92 }),
    createdAt: '2026-06-12T10:05:00.000Z',
  }),
  makeLog({
    id: 'r3',
    fieldPath: 'journal_entry.deleted',
    changeType: 'PATIENT_READING_DELETED',
    previousValue: readingSnapshot(),
    newValue: null,
    createdAt: '2026-06-12T10:10:00.000Z',
  }),
  makeLog({
    id: 'r4',
    fieldPath: 'journal_entry.admin_added',
    changeType: 'ADMIN_READING_ADDED',
    changedBy: 'md-1',
    changedByName: 'Manisha Patel',
    changedByRole: 'ADMIN',
    changedByRoleResolved: 'MEDICAL_DIRECTOR',
    newValue: readingSnapshot({ entryId: 'entry-2', systolicBP: 142, diastolicBP: 88 }),
    createdAt: '2026-06-12T11:00:00.000Z',
  }),
  makeLog({
    id: 'r5',
    fieldPath: 'journal_entry.admin_edited',
    changeType: 'ADMIN_READING_EDITED',
    changedBy: 'md-1',
    changedByName: 'Manisha Patel',
    changedByRole: 'ADMIN',
    changedByRoleResolved: 'MEDICAL_DIRECTOR',
    previousValue: readingSnapshot({ entryId: 'entry-2', systolicBP: 142, diastolicBP: 88 }),
    newValue: readingSnapshot({ entryId: 'entry-2', systolicBP: 150, diastolicBP: 95 }),
    createdAt: '2026-06-12T11:05:00.000Z',
  }),
  makeLog({
    id: 'r6',
    fieldPath: 'journal_entry.admin_deleted',
    changeType: 'ADMIN_READING_DELETED',
    changedBy: 'prov-1',
    changedByName: 'Ruhim Akhtar',
    changedByRole: 'PROVIDER',
    changedByRoleResolved: 'PROVIDER',
    previousValue: readingSnapshot({ entryId: 'entry-3' }),
    newValue: null,
    createdAt: '2026-06-12T11:10:00.000Z',
  }),
]

const PROFILE_LOG = makeLog({
  id: 'p1',
  fieldPath: 'profile.hasCAD',
  changeType: 'PATIENT_REPORT',
  previousValue: false,
  newValue: true,
  createdAt: '2026-06-12T09:00:00.000Z',
})

const ALERT: PatientAlert = {
  id: 'alert-1',
  tier: 'BP_LEVEL_1_HIGH',
  status: 'OPEN',
  createdAt: '2026-06-12T09:30:00.000Z',
  patientMessage: 'Your blood pressure is above your goal.',
  escalationEvents: [],
} as unknown as PatientAlert

function renderTab(logs: ProfileVerificationLog[] = [...READING_LOGS, PROFILE_LOG]) {
  return render(
    <TimelineTab
      logs={logs}
      alerts={[ALERT]}
      medications={[]}
      logsLoading={false}
      alertsLoading={false}
    />,
  )
}

describe('TimelineTab — READINGS filter', () => {
  it('renders the Readings chip with the reading-event count', () => {
    renderTab()
    const chip = screen.getByTestId('admin-timeline-filter-READINGS')
    expect(chip).toHaveTextContent('Readings')
    expect(chip).toHaveTextContent('6')
  })

  it('READINGS filter shows only the 6 reading event types', () => {
    renderTab()
    fireEvent.click(screen.getByTestId('admin-timeline-filter-READINGS'))

    const list = screen.getByTestId('admin-timeline-list')
    // All six reading events visible…
    for (const id of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) {
      expect(within(list).getByTestId(`admin-timeline-entry-verif-${id}`)).toBeInTheDocument()
    }
    // …profile + alert events filtered out.
    expect(within(list).queryByTestId('admin-timeline-entry-verif-p1')).not.toBeInTheDocument()
    expect(within(list).queryByTestId('admin-timeline-entry-alert-created-alert-1')).not.toBeInTheDocument()
  })

  it('renders each reading event with verb + actor wording', () => {
    renderTab()
    fireEvent.click(screen.getByTestId('admin-timeline-filter-READINGS'))

    expect(screen.getByText('Reading 140/90 logged by patient')).toBeInTheDocument()
    expect(screen.getByText('Reading 145/92 edited by patient')).toBeInTheDocument()
    expect(screen.getByText('Reading 140/90 deleted by patient')).toBeInTheDocument()
    expect(screen.getByText('Reading 142/88 entered by medical director')).toBeInTheDocument()
    expect(screen.getByText('Reading 150/95 edited by medical director')).toBeInTheDocument()
    expect(screen.getByText('Reading 140/90 deleted by provider')).toBeInTheDocument()
  })

  it('shows the prior → new diff line on edits and the actor name on admin rows', () => {
    renderTab()
    fireEvent.click(screen.getByTestId('admin-timeline-filter-READINGS'))

    // Edit diff (patient edit r2: 138/88 → 145/92).
    expect(screen.getByText(/138\/88 → 145\/92/)).toBeInTheDocument()
    // Admin actor names rendered on the actor line. Scoped to the list —
    // the same names also appear as <option>s in the actor dropdown.
    const list = screen.getByTestId('admin-timeline-list')
    expect(within(list).getAllByText(/Manisha Patel \(medical director\)/).length).toBeGreaterThanOrEqual(2)
    expect(within(list).getByText(/Ruhim Akhtar \(provider\)/)).toBeInTheDocument()
  })

  it('ALL filter still merges readings + profile + alert streams', () => {
    renderTab()
    // Default state — no category selected = ALL.
    const list = screen.getByTestId('admin-timeline-list')
    expect(within(list).getByTestId('admin-timeline-entry-verif-r1')).toBeInTheDocument()
    expect(within(list).getByTestId('admin-timeline-entry-verif-p1')).toBeInTheDocument()
    expect(within(list).getByTestId('admin-timeline-entry-alert-created-alert-1')).toBeInTheDocument()
    // ALL chip counts every entry (6 readings + 1 profile + 1 alert).
    expect(screen.getByTestId('admin-timeline-filter-ALL')).toHaveTextContent('8')
  })

  it('two same-second admin session adds stay as separate rows (no burst collapse)', () => {
    const sameSecond = [
      makeLog({
        id: 's1',
        fieldPath: 'journal_entry.admin_added',
        changeType: 'ADMIN_READING_ADDED',
        changedBy: 'md-1',
        changedByName: 'Manisha Patel',
        changedByRoleResolved: 'MEDICAL_DIRECTOR',
        newValue: readingSnapshot({ systolicBP: 140, diastolicBP: 90 }),
        createdAt: '2026-06-12T11:00:00.200Z',
      }),
      makeLog({
        id: 's2',
        fieldPath: 'journal_entry.admin_added',
        changeType: 'ADMIN_READING_ADDED',
        changedBy: 'md-1',
        changedByName: 'Manisha Patel',
        changedByRoleResolved: 'MEDICAL_DIRECTOR',
        newValue: readingSnapshot({ systolicBP: 142, diastolicBP: 88 }),
        createdAt: '2026-06-12T11:00:00.900Z',
      }),
    ]
    renderTab(sameSecond)

    expect(screen.getByTestId('admin-timeline-entry-verif-s1')).toBeInTheDocument()
    expect(screen.getByTestId('admin-timeline-entry-verif-s2')).toBeInTheDocument()
    expect(screen.queryByTestId('admin-timeline-group-group-verif-s1')).not.toBeInTheDocument()
  })
})
