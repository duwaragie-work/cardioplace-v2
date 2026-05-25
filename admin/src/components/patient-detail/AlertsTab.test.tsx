import { render, screen } from '@testing-library/react'
import AlertsTab from './AlertsTab'
import type { PatientAlert } from '@/lib/services/patient-detail.service'

// B2 — co-fired alert rows (multiple DeviationAlert rows from ONE reading,
// sharing a journalEntry) render under a "same reading" group header so a
// clinician sees they came from a single reading.

jest.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
}))
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'md-1', roles: ['MEDICAL_DIRECTOR'] } }),
}))

const SHARED_READING = new Date('2026-05-22T10:00:00Z').toISOString()

function makeAlert(over: Partial<PatientAlert> = {}): PatientAlert {
  return {
    id: 'alert-1',
    tier: 'BP_LEVEL_1_HIGH',
    ruleId: 'RULE_CAD_HIGH',
    mode: 'STANDARD',
    status: 'OPEN',
    severity: 'HIGH',
    escalated: false,
    acknowledgedAt: null,
    resolvedAt: null,
    createdAt: SHARED_READING,
    patientMessage: 'p',
    caregiverMessage: 'c',
    physicianMessage: 'phys',
    journalEntry: {
      id: 'je-1',
      systolicBP: 165,
      diastolicBP: 65,
      pulse: 74,
      weight: null,
      measuredAt: SHARED_READING,
    },
    ...over,
  } as unknown as PatientAlert
}

describe('AlertsTab — co-fired grouping (B2)', () => {
  it('renders a "same reading" header when ≥2 alerts share a journal entry', () => {
    // Two rows, same reading (same journalEntry.measuredAt), different axes.
    const alerts = [
      makeAlert({ id: 'alert-1', ruleId: 'RULE_CAD_HIGH', tier: 'BP_LEVEL_1_HIGH' }),
      makeAlert({ id: 'alert-2', ruleId: 'RULE_CAD_DBP_CRITICAL', tier: 'BP_LEVEL_1_LOW' }),
    ]
    render(<AlertsTab alerts={alerts} loading={false} onResolved={() => {}} />)

    const header = screen.getByTestId('admin-alert-group-header')
    expect(header).toBeInTheDocument()
    expect(header).toHaveTextContent(/2 alerts from the same reading/i)
  })

  it('renders no group header for a single standalone alert', () => {
    render(
      <AlertsTab
        alerts={[makeAlert({ id: 'solo' })]}
        loading={false}
        onResolved={() => {}}
      />,
    )
    expect(screen.queryByTestId('admin-alert-group-header')).not.toBeInTheDocument()
  })
})
