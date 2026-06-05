import { render, screen } from '@testing-library/react'
import ThresholdsTab from './ThresholdsTab'
import type { PatientThreshold } from '@/lib/services/patient-detail.service'

// B1 — the engine fires RULE_PERSONALIZED_HIGH at sbpUpperTarget + 20
// (PERSONALIZED_BAND_MMHG). The editor must surface that band so a provider
// who sets 130 isn't surprised that high alerts begin at 150.

// canEditThresholds(user) reads useAuth(); a MEDICAL_DIRECTOR can edit, so the
// personalized-targets editor (where the helper lives) renders.
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'md-1', roles: ['MEDICAL_DIRECTOR'] } }),
}))

function makeThreshold(over: Partial<PatientThreshold> = {}): PatientThreshold {
  return {
    sbpUpperTarget: 140,
    sbpLowerTarget: 90,
    dbpUpperTarget: 90,
    dbpLowerTarget: 60,
    hrUpperTarget: null,
    hrLowerTarget: null,
    notes: null,
    setAt: new Date().toISOString(),
    setByProviderId: 'md-1',
    ...over,
  } as unknown as PatientThreshold
}

function renderTab(threshold: PatientThreshold | null) {
  return render(
    <ThresholdsTab
      patientId="patient-1"
      profile={null}
      threshold={threshold}
      loading={false}
      onChanged={() => {}}
    />,
  )
}

describe('ThresholdsTab — personalized +20 band helper (B1)', () => {
  it('shows "high alerts fire at target + 20" for a seeded SBP upper target', () => {
    renderTab(makeThreshold({ sbpUpperTarget: 140 }))
    const helper = screen.getByTestId('admin-threshold-sbp-band-helper')
    expect(helper).toBeInTheDocument()
    expect(helper).toHaveTextContent('160') // 140 + 20
    expect(helper).toHaveTextContent('140')
  })

  it('recomputes the band for a different target', () => {
    renderTab(makeThreshold({ sbpUpperTarget: 130 }))
    expect(screen.getByTestId('admin-threshold-sbp-band-helper')).toHaveTextContent('150')
  })

  it('renders no band helper when no SBP upper target is set', () => {
    renderTab(makeThreshold({ sbpUpperTarget: null }))
    expect(screen.queryByTestId('admin-threshold-sbp-band-helper')).not.toBeInTheDocument()
  })
})
