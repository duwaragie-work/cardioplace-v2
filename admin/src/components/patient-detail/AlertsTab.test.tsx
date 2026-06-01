import { render, screen, fireEvent } from '@testing-library/react'
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

// Manual-test round 2 Group A3 — "All" must mean ALL. The previous count + list
// excluded Tier 3, so "All (6)" omitted 4 Physician-notes rows. Tier 3 alerts
// now render inline in the main list under ALL; the Physician-notes section
// stays as a curated view available via the TIER_3 chip (and is suppressed
// under ALL so rows don't render twice).

describe('AlertsTab — Tier-3 in ALL filter (Round 2 A3)', () => {
  function bpL1Alert(id: string): PatientAlert {
    return makeAlert({
      id,
      tier: 'BP_LEVEL_1_HIGH',
      ruleId: 'RULE_STANDARD_L1_HIGH',
    })
  }
  function tier3Alert(id: string, ruleId: string): PatientAlert {
    return makeAlert({
      id,
      tier: 'TIER_3_INFO',
      ruleId,
    })
  }

  const mixed: PatientAlert[] = [
    bpL1Alert('bp1'),
    bpL1Alert('bp2'),
    bpL1Alert('bp3'),
    tier3Alert('t3a', 'RULE_HCM_VASODILATOR'),
    tier3Alert('t3b', 'RULE_PULSE_PRESSURE_NARROW'),
  ]

  it('ALL chip count includes Tier 3 rows', () => {
    render(<AlertsTab alerts={mixed} loading={false} onResolved={() => {}} />)
    const allChip = screen.getByTestId('admin-alerts-tier-filter-ALL')
    // 3 BP-L1 + 2 Tier 3 = 5. The chip renders "All" + a count span (the
    // count text is adjacent to the label, so the combined text reads "All5").
    expect(allChip).toHaveTextContent(/All/i)
    expect(allChip).toHaveTextContent(/5/)
  })

  it('ALL filter renders Tier 3 alerts inline alongside other tiers', () => {
    render(<AlertsTab alerts={mixed} loading={false} onResolved={() => {}} />)
    // Every alert id should render a row (data-testid="admin-alert-row-${id}").
    for (const id of ['bp1', 'bp2', 'bp3', 't3a', 't3b']) {
      expect(screen.getByTestId(`admin-alert-row-${id}`)).toBeInTheDocument()
    }
  })

  it('ALL filter suppresses the Physician-notes section (no duplicate Tier 3 rows)', () => {
    render(<AlertsTab alerts={mixed} loading={false} onResolved={() => {}} />)
    expect(screen.queryByText(/physician notes/i)).not.toBeInTheDocument()
  })

  it('TIER_3 chip surfaces the Physician-notes section and renders only Tier 3 in the main list', () => {
    render(<AlertsTab alerts={mixed} loading={false} onResolved={() => {}} />)
    const tier3Chip = screen.getByTestId('admin-alerts-tier-filter-TIER_3')
    fireEvent.click(tier3Chip)
    // Main list shows only Tier 3.
    expect(screen.queryByTestId('admin-alert-row-bp1')).not.toBeInTheDocument()
    expect(screen.getByTestId('admin-alert-row-t3a')).toBeInTheDocument()
    expect(screen.getByTestId('admin-alert-row-t3b')).toBeInTheDocument()
  })
})

// F4 — the pre-personalization note is patient-state metadata, hoisted to a
// header band that renders once per page across every filter (it used to be
// buried inside each expanded AlertCard).
describe('AlertsTab — personalization header band (F4)', () => {
  function preDayAlert(id: string, tier = 'BP_LEVEL_1_HIGH'): PatientAlert {
    return makeAlert({
      id,
      tier: tier as PatientAlert['tier'],
      preDay3: true,
      personalizationThreshold: 7,
      baselineReadingCount: 3,
    } as Partial<PatientAlert>)
  }

  it('renders the band exactly once even with multiple pre-personalization alerts', () => {
    render(
      <AlertsTab
        alerts={[preDayAlert('a1'), preDayAlert('a2'), preDayAlert('a3')]}
        loading={false}
        onResolved={() => {}}
      />,
    )
    const bands = screen.getAllByTestId('admin-alerts-personalization-band')
    expect(bands).toHaveLength(1)
    expect(bands[0]).toHaveTextContent(/completed 3 of 7 baseline readings/i)
  })

  it('keeps the band visible after switching to the ALL filter', () => {
    render(
      <AlertsTab alerts={[preDayAlert('a1')]} loading={false} onResolved={() => {}} />,
    )
    fireEvent.click(screen.getByTestId('admin-alerts-tier-filter-ALL'))
    expect(screen.getByTestId('admin-alerts-personalization-band')).toBeInTheDocument()
  })

  it('renders no band when no alert is pre-personalization', () => {
    render(
      <AlertsTab alerts={[makeAlert({ id: 'solo' })]} loading={false} onResolved={() => {}} />,
    )
    expect(screen.queryByTestId('admin-alerts-personalization-band')).not.toBeInTheDocument()
  })
})
