import { render, screen } from '@testing-library/react'
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
