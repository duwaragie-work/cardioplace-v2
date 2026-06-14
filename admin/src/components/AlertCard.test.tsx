import { render, screen, fireEvent } from '@testing-library/react'
import AlertCard from './AlertCard'
import type { PatientAlert } from '@/lib/services/patient-detail.service'

// B3 — STANDARD / PERSONALIZED mode badge on the admin alert row. The value is
// already on the alert; the badge surfaces it so a clinician scanning the list
// can tell at a glance which thresholds the alert was evaluated against.

// AlertCard reads useAuth() for the resolve-permission gate. Mock it to a
// provider so the component renders without the real auth context/network.
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'admin-1', roles: ['MEDICAL_DIRECTOR'] } }),
}))

function makeAlert(over: Partial<PatientAlert> = {}): PatientAlert {
  return {
    id: 'alert-1',
    tier: 'BP_LEVEL_1_HIGH',
    ruleId: 'RULE_STANDARD_L1_HIGH',
    mode: 'STANDARD',
    status: 'OPEN',
    severity: 'HIGH',
    escalated: false,
    acknowledgedAt: null,
    resolvedAt: null,
    createdAt: new Date().toISOString(),
    patientMessage: 'p',
    caregiverMessage: 'c',
    physicianMessage: 'phys',
    journalEntry: {
      id: 'je-1',
      systolicBP: 150,
      diastolicBP: 95,
      pulse: 80,
      weight: null,
      measuredAt: new Date().toISOString(),
    },
    ...over,
  } as unknown as PatientAlert
}

const noop = () => {}

function renderCard(alert: PatientAlert) {
  return render(
    <AlertCard
      alert={alert}
      expanded={false}
      onRowClick={noop}
      onToggleExpand={noop}
      onResolve={noop}
      onAcknowledge={noop}
    />,
  )
}

// Manual-test round 2 Group A2 — empty three-tier cards must not render the
// "No message generated for this audience." placeholder. A Tier-3
// caregiver/physician-only alert (empty patientMessage) shows only the
// Caregiver + Physician cards in the expanded grid.
function renderExpanded(alert: PatientAlert) {
  // EscalationAuditTrail (rendered inside the expanded block) iterates
  // alert.escalationEvents. The base fixture omits the field — add an empty
  // array here so the audit-trail renders without throwing.
  const withEvents: PatientAlert = {
    ...alert,
    escalationEvents: [],
  } as unknown as PatientAlert
  return render(
    <AlertCard
      alert={withEvents}
      expanded={true}
      onRowClick={noop}
      onToggleExpand={noop}
      onResolve={noop}
      onAcknowledge={noop}
    />,
  )
}

describe('AlertCard — three-tier grid (Round 2 A2)', () => {
  it('hides the Patient card when patientMessage is null', () => {
    renderExpanded(
      makeAlert({
        tier: 'TIER_3_INFO',
        ruleId: 'RULE_HF_CAREGIVER_EDEMA',
        patientMessage: null,
        caregiverMessage: 'Watch for fluid build-up.',
        physicianMessage: 'HF decompensation surveillance.',
      } as Partial<PatientAlert>),
    )
    expect(screen.queryByTestId('admin-alert-msg-patient-alert-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('admin-alert-msg-caregiver-alert-1')).toBeInTheDocument()
    expect(screen.getByTestId('admin-alert-msg-physician-alert-1')).toBeInTheDocument()
  })

  it('hides the Patient card when patientMessage is whitespace-only', () => {
    renderExpanded(
      makeAlert({
        patientMessage: '   ',
        caregiverMessage: 'c',
        physicianMessage: 'phys',
      }),
    )
    expect(screen.queryByTestId('admin-alert-msg-patient-alert-1')).not.toBeInTheDocument()
  })

  it('renders all three cards when all messages are populated', () => {
    renderExpanded(makeAlert())
    expect(screen.getByTestId('admin-alert-msg-patient-alert-1')).toBeInTheDocument()
    expect(screen.getByTestId('admin-alert-msg-caregiver-alert-1')).toBeInTheDocument()
    expect(screen.getByTestId('admin-alert-msg-physician-alert-1')).toBeInTheDocument()
  })
})

describe('AlertCard — mode badge (B3)', () => {
  it('renders a "Personalized" badge when mode is PERSONALIZED', () => {
    renderCard(makeAlert({ mode: 'PERSONALIZED' }))
    const badge = screen.getByTestId('admin-alert-mode-badge-alert-1')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent(/personalized/i)
  })

  it('renders a "Standard" badge when mode is STANDARD', () => {
    renderCard(makeAlert({ mode: 'STANDARD' }))
    const badge = screen.getByTestId('admin-alert-mode-badge-alert-1')
    expect(badge).toHaveTextContent(/standard/i)
  })

  it('renders no mode badge when mode is null', () => {
    renderCard(makeAlert({ mode: null }))
    expect(screen.queryByTestId('admin-alert-mode-badge-alert-1')).not.toBeInTheDocument()
  })
})

// F22 — the "Personalized" badge is semantically ambiguous: it reflects the
// patient's monitoring stage, not which rule's threshold fired. A hover tooltip
// disambiguates it so a clinician doesn't read it as "personalized threshold
// fired".
describe('AlertCard — PERSONALIZED badge tooltip (F22)', () => {
  it('explains that the PERSONALIZED badge reflects monitoring stage, not the rule that fired', () => {
    renderCard(makeAlert({ mode: 'PERSONALIZED' }))
    const badge = screen.getByTestId('admin-alert-mode-badge-alert-1')
    expect(badge).toHaveAttribute('title', expect.stringContaining('not necessarily which rule'))
    expect(badge.getAttribute('aria-label')).toMatch(/monitoring stage/i)
  })

  it('explains that the STANDARD badge means standard AHA thresholds', () => {
    renderCard(makeAlert({ mode: 'STANDARD' }))
    const badge = screen.getByTestId('admin-alert-mode-badge-alert-1')
    expect(badge).toHaveAttribute('title', expect.stringContaining('standard AHA thresholds'))
  })
})

// P3 — the per-alert pre-personalization note is hoisted to a single
// patient-header band by AlertsTab; AlertCard suppresses its own copy when
// `hideDisclaimer` is set so a cofire group doesn't repeat it on every member.
describe('AlertCard — pre-personalization disclaimer suppression (P3)', () => {
  const preDay = {
    preDay3: true,
    personalizationThreshold: 7,
    baselineReadingCount: 3,
  } as Partial<PatientAlert>

  function renderExpandedWith(over: Partial<PatientAlert>, hideDisclaimer: boolean) {
    const alert = {
      ...makeAlert(over),
      escalationEvents: [],
    } as unknown as PatientAlert
    return render(
      <AlertCard
        alert={alert}
        expanded={true}
        onRowClick={noop}
        onToggleExpand={noop}
        onResolve={noop}
        onAcknowledge={noop}
        hideDisclaimer={hideDisclaimer}
      />,
    )
  }

  it('renders the note by default', () => {
    renderExpandedWith(preDay, false)
    expect(screen.getByTestId('admin-alert-prepersonalization-alert-1')).toBeInTheDocument()
  })

  it('suppresses the note when hideDisclaimer is true', () => {
    renderExpandedWith(preDay, true)
    expect(
      screen.queryByTestId('admin-alert-prepersonalization-alert-1'),
    ).not.toBeInTheDocument()
  })
})


describe('enrollment badges (Manisha 2026-06-12)', () => {
  function renderBadgeCard(over: {
    previouslyEnrolled?: boolean
    patientPreEnrollment?: boolean
    onThresholdAction?: () => void
  }) {
    return render(
      <AlertCard
        alert={makeAlert({ status: 'OPEN' })}
        expanded={false}
        onRowClick={noop}
        onToggleExpand={noop}
        onResolve={noop}
        onAcknowledge={noop}
        patientPreEnrollment={over.patientPreEnrollment ?? false}
        previouslyEnrolled={over.previouslyEnrolled ?? false}
        onThresholdAction={over.onThresholdAction}
      />,
    )
  }

  it('previously-enrolled NOT_ENROLLED → threshold-pending badge, not no-dispatch', () => {
    renderBadgeCard({ patientPreEnrollment: true, previouslyEnrolled: true })
    expect(
      screen.getByTestId('admin-alert-threshold-pending-badge-alert-1'),
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('admin-alert-no-dispatch-badge-alert-1'),
    ).not.toBeInTheDocument()
  })

  it('never-enrolled NOT_ENROLLED → no-dispatch badge (F27 preserved)', () => {
    renderBadgeCard({ patientPreEnrollment: true, previouslyEnrolled: false })
    expect(
      screen.getByTestId('admin-alert-no-dispatch-badge-alert-1'),
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('admin-alert-threshold-pending-badge-alert-1'),
    ).not.toBeInTheDocument()
  })

  it('enrolled patient (not pre-enrollment) → neither badge', () => {
    renderBadgeCard({ patientPreEnrollment: false, previouslyEnrolled: false })
    expect(
      screen.queryByTestId('admin-alert-no-dispatch-badge-alert-1'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('admin-alert-threshold-pending-badge-alert-1'),
    ).not.toBeInTheDocument()
  })

  it('clicking the threshold-pending badge invokes onThresholdAction', () => {
    const onThresholdAction = jest.fn()
    renderBadgeCard({
      patientPreEnrollment: true,
      previouslyEnrolled: true,
      onThresholdAction,
    })
    fireEvent.click(
      screen.getByTestId('admin-alert-threshold-pending-badge-alert-1'),
    )
    expect(onThresholdAction).toHaveBeenCalledTimes(1)
  })
})
