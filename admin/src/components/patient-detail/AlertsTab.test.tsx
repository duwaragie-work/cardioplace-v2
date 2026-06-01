import { render, screen, fireEvent, within } from '@testing-library/react'
import AlertsTab, { groupAlertsByReading } from './AlertsTab'
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

// F5 — co-fired alerts get a bordered container scoping the group apart from
// the standalone alerts; singletons stay as their own cards.
describe('AlertsTab — cofire group container (F5)', () => {
  function readingAlert(id: string, measuredAt: string, tier = 'BP_LEVEL_1_HIGH'): PatientAlert {
    const iso = new Date(measuredAt).toISOString()
    return makeAlert({
      id,
      tier: tier as PatientAlert['tier'],
      createdAt: iso,
      journalEntry: {
        id: `je-${id}`,
        systolicBP: 165,
        diastolicBP: 95,
        pulse: 74,
        weight: null,
        measuredAt: iso,
      },
    } as Partial<PatientAlert>)
  }

  it('wraps a 3-alert cofire group in one container and leaves standalones uncontained', () => {
    const shared = '2026-05-22T10:00:00Z'
    const alerts = [
      readingAlert('cf1', shared, 'BP_LEVEL_1_HIGH'),
      readingAlert('cf2', shared, 'BP_LEVEL_1_LOW'),
      readingAlert('cf3', shared, 'TIER_2_DISCREPANCY'),
      readingAlert('solo1', '2026-05-21T08:00:00Z'),
      readingAlert('solo2', '2026-05-20T08:00:00Z'),
    ]
    render(<AlertsTab alerts={alerts} loading={false} onResolved={() => {}} />)
    // Exactly one cofire container + its header.
    expect(screen.getAllByTestId('admin-alert-cofire-group')).toHaveLength(1)
    expect(screen.getAllByTestId('admin-alert-group-header')).toHaveLength(1)
    // All five alerts still render.
    for (const id of ['cf1', 'cf2', 'cf3', 'solo1', 'solo2']) {
      expect(screen.getByTestId(`admin-alert-row-${id}`)).toBeInTheDocument()
    }
  })

  it('renders no cofire container when every alert is from a distinct reading', () => {
    const alerts = [
      readingAlert('a', '2026-05-22T10:00:00Z'),
      readingAlert('b', '2026-05-21T10:00:00Z'),
    ]
    render(<AlertsTab alerts={alerts} loading={false} onResolved={() => {}} />)
    expect(screen.queryByTestId('admin-alert-cofire-group')).not.toBeInTheDocument()
  })
})

// F6 — within a cofire group the most urgent finding leads. Previously the
// informational Tier 3 row could sort above BP Level 1.
describe('AlertsTab — cofire group priority sort (F6)', () => {
  const shared = '2026-05-22T10:00:00Z'
  function readingAlert(id: string, tier: string): PatientAlert {
    const iso = new Date(shared).toISOString()
    return makeAlert({
      id,
      tier: tier as PatientAlert['tier'],
      createdAt: iso,
      journalEntry: {
        id: `je-${id}`,
        systolicBP: 185,
        diastolicBP: 100,
        pulse: 74,
        weight: null,
        measuredAt: iso,
      },
    } as Partial<PatientAlert>)
  }

  it('orders [Tier 3, BP L1, BP L2] as [BP L2, BP L1, Tier 3]', () => {
    const groups = groupAlertsByReading([
      readingAlert('t3', 'TIER_3_INFO'),
      readingAlert('bp1', 'BP_LEVEL_1_HIGH'),
      readingAlert('l2', 'BP_LEVEL_2'),
    ])
    expect(groups).toHaveLength(1)
    const group = groups[0]
    expect(group.kind).toBe('cofire')
    if (group.kind === 'cofire') {
      expect(group.alerts.map((a) => a.id)).toEqual(['l2', 'bp1', 't3'])
    }
  })

  it('puts Tier 1 first when present', () => {
    const groups = groupAlertsByReading([
      readingAlert('bp1', 'BP_LEVEL_1_HIGH'),
      readingAlert('t1', 'TIER_1_CONTRAINDICATION'),
      readingAlert('t3', 'TIER_3_INFO'),
    ])
    const group = groups[0]
    if (group.kind === 'cofire') {
      expect(group.alerts[0].id).toBe('t1')
      expect(group.alerts[group.alerts.length - 1].id).toBe('t3')
    }
  })

  it('renders the cofire rows in priority order in the DOM', () => {
    render(
      <AlertsTab
        alerts={[
          readingAlert('t3', 'TIER_3_INFO'),
          readingAlert('bp1', 'BP_LEVEL_1_HIGH'),
          readingAlert('l2', 'BP_LEVEL_2'),
        ]}
        loading={false}
        onResolved={() => {}}
      />,
    )
    const group = screen.getByTestId('admin-alert-cofire-group')
    const rows = within(group).getAllByTestId(/admin-alert-row-/)
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'admin-alert-row-l2',
      'admin-alert-row-bp1',
      'admin-alert-row-t3',
    ])
  })
})

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
      // EscalationAuditTrail (rendered when a card is expanded) iterates this.
      escalationEvents: [],
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

  // P3 — a cofire group (3 alerts, same reading, same baseline count) must show
  // the disclaimer text exactly once, not once per grouped alert.
  it('shows the disclaimer text exactly once for a 3-alert cofire group', () => {
    const cofire = [
      preDayAlert('c1', 'BP_LEVEL_1_HIGH'),
      preDayAlert('c2', 'BP_LEVEL_1_LOW'),
      preDayAlert('c3', 'TIER_2_DISCREPANCY'),
    ]
    render(<AlertsTab alerts={cofire} loading={false} onResolved={() => {}} />)
    // Expand every member so each card's own disclaimer would render if present.
    for (const id of ['c1', 'c2', 'c3']) {
      fireEvent.click(screen.getByTestId(`admin-alert-row-${id}`))
    }
    expect(screen.getAllByText(/personalization begins after/i)).toHaveLength(1)
  })
})
