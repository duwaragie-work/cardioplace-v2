import { render, screen, fireEvent } from '@testing-library/react'
import PatientAlertCard, { type PatientAlertCardAlert } from './PatientAlertCard'

// Round 2 H — patient AlertCard parity with admin chrome. The key invariant:
// the chrome is driven by getAlertPresentation({ tier, ruleId }) so
// RULE_HF_DECOMPENSATION (engine tier BP_LEVEL_1_LOW) doesn't inherit the
// blue low-BP template. Before this card existed, the alerts list on
// /notifications keyed off a local TIER_META table that missed the rule-id
// override — HF-decomp rendered as a blue low-BP card in the list even though
// the dashboard banner + alert detail page had been fixed.

jest.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    locale: 'en',
  }),
}))

jest.mock('next/link', () => {
  const MockLink = ({ children, href, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>{children}</a>
  )
  MockLink.displayName = 'MockLink'
  return { __esModule: true, default: MockLink }
})

function makeAlert(over: Partial<PatientAlertCardAlert> = {}): PatientAlertCardAlert {
  return {
    id: 'alert-1',
    tier: 'BP_LEVEL_1_LOW',
    ruleId: 'RULE_HFREF_LOW',
    type: null,
    mode: 'STANDARD',
    status: 'OPEN',
    patientMessage: 'Your blood pressure is lower than the goal.',
    severity: 'MEDIUM',
    escalated: false,
    dismissible: true,
    resolvedBy: null,
    createdAt: new Date().toISOString(),
    acknowledgedAt: null,
    journalEntry: {
      measuredAt: new Date().toISOString(),
      systolicBP: 88,
      diastolicBP: 56,
    },
    ...over,
  }
}

const noop = () => {}

function renderCard(alert: PatientAlertCardAlert) {
  return render(
    <PatientAlertCard alert={alert} onAcknowledge={noop} acknowledging={null} />,
  )
}

describe('PatientAlertCard — rule-aware chrome (Round 2 H)', () => {
  it('literal RULE_HFREF_LOW on BP_LEVEL_1_LOW renders the blue low-BP chrome (title contains "low")', () => {
    renderCard(makeAlert())
    const title = screen.getByTestId('patient-alert-card-title-alert-1')
    expect(title).toHaveTextContent(/low/i)
    // Sanity: severity chip rendered.
    expect(screen.getByTestId('patient-alert-card-severity-alert-1')).toBeInTheDocument()
  })

  it('RULE_HF_DECOMPENSATION on BP_LEVEL_1_LOW renders the amber/Heart attention chrome (NOT "low")', () => {
    renderCard(
      makeAlert({
        ruleId: 'RULE_HF_DECOMPENSATION',
        patientMessage: 'You reported swelling — your care team is watching for fluid build-up.',
        journalEntry: { measuredAt: new Date().toISOString(), systolicBP: 151, diastolicBP: 86 },
      }),
    )
    const title = screen.getByTestId('patient-alert-card-title-alert-1')
    // Per Round 2 A1: title is "Your care team needs to know about this." (with trailing period stripped)
    expect(title).toHaveTextContent(/care team needs to know/i)
    expect(title).not.toHaveTextContent(/low/i)
    // Body shows the rule's patientMessage verbatim.
    expect(screen.getByTestId('patient-alert-card-message-alert-1')).toHaveTextContent(/swelling/i)
  })

  it('renders the mode badge ("Personalized") when alert.mode === PERSONALIZED', () => {
    renderCard(makeAlert({ mode: 'PERSONALIZED' }))
    const mode = screen.getByTestId('patient-alert-card-mode-alert-1')
    expect(mode).toHaveTextContent(/personalized/i)
  })

  it('hides the Acknowledge button when dismissible === false (Tier 1 + BP L2 non-dismissable)', () => {
    renderCard(
      makeAlert({
        tier: 'TIER_1_CONTRAINDICATION',
        ruleId: 'RULE_PREGNANCY_ACE_ARB',
        dismissible: false,
      }),
    )
    expect(screen.queryByTestId('patient-alert-card-ack-alert-1')).not.toBeInTheDocument()
    // View Details deep-link still rendered.
    expect(screen.getByTestId('patient-alert-card-detail-alert-1')).toBeInTheDocument()
  })

  it('shows the Acknowledge button + invokes onAcknowledge for dismissible alerts', () => {
    const onAcknowledge = jest.fn()
    render(
      <PatientAlertCard alert={makeAlert()} onAcknowledge={onAcknowledge} acknowledging={null} />,
    )
    const ack = screen.getByTestId('patient-alert-card-ack-alert-1')
    fireEvent.click(ack)
    expect(onAcknowledge).toHaveBeenCalledWith('alert-1')
  })

  it('footer does NOT leak the internal rule-id to the patient', () => {
    // Intentionally suppressed — RULE_* identifiers are admin-only support
    // metadata. The admin AlertCard still surfaces them; the patient card
    // must not, because they were confusing patients reading their alerts.
    renderCard(makeAlert({ ruleId: 'RULE_HFREF_LOW' }))
    const date = screen.getByTestId('patient-alert-card-date-alert-1')
    expect(date).not.toHaveTextContent(/RULE_/)
  })

  it('compact variant drops the patient message body + the action buttons', () => {
    render(
      <PatientAlertCard
        alert={makeAlert()}
        onAcknowledge={noop}
        acknowledging={null}
        compact
      />,
    )
    expect(screen.queryByTestId('patient-alert-card-message-alert-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('patient-alert-card-ack-alert-1')).not.toBeInTheDocument()
    // Title + severity chip still render (the strip's purpose is at-a-glance scan).
    expect(screen.getByTestId('patient-alert-card-title-alert-1')).toBeInTheDocument()
    expect(screen.getByTestId('patient-alert-card-severity-alert-1')).toBeInTheDocument()
  })

  it('shows the "Reviewed by care team" badge when alert.resolvedBy is set', () => {
    renderCard(makeAlert({ status: 'RESOLVED', resolvedBy: 'admin-1' }))
    expect(screen.getByTestId('patient-alert-card-reviewed-alert-1')).toBeInTheDocument()
    expect(screen.getByTestId('patient-alert-card-status-alert-1')).toBeInTheDocument()
  })
})
