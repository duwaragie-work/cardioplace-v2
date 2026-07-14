import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AlertResolutionModal, { type ResolvableAlert } from './AlertResolutionModal'
import { resolveAlert } from '@/lib/services/provider.service'

// Manisha 5/24 Q4 — angioedema resolution renders the bespoke 6-option catalog
// with conditional sub-fields and posts them as resolutionDetails. Keep the real
// catalog (actionsForTier / RESOLUTION_CATALOG / resolutionTierFor) and mock only
// the network call.

jest.mock('@/lib/services/provider.service', () => ({
  ...jest.requireActual('@/lib/services/provider.service'),
  resolveAlert: jest.fn(),
}))

const mockResolve = resolveAlert as jest.MockedFunction<typeof resolveAlert>

function makeAlert(over: Partial<ResolvableAlert> = {}): ResolvableAlert {
  return {
    id: 'alert-1',
    tier: 'TIER_1_ANGIOEDEMA',
    patient: { name: 'Jane Doe' },
    journalEntry: { systolicBP: 150, diastolicBP: 95 },
    createdAt: new Date('2026-05-24T10:00:00Z').toISOString(),
    ...over,
  }
}

function renderModal(over: Partial<ResolvableAlert> = {}) {
  const onResolved = jest.fn()
  const onClose = jest.fn()
  render(
    <AlertResolutionModal
      alert={makeAlert(over)}
      open
      onClose={onClose}
      onResolved={onResolved}
    />,
  )
  return { onResolved, onClose }
}

describe('AlertResolutionModal — angioedema sub-fields (Q4)', () => {
  beforeEach(() => {
    mockResolve.mockReset()
    mockResolve.mockResolvedValue({ status: 'RESOLVED', resolvedAt: new Date().toISOString() })
  })

  it('renders the bespoke angioedema actions', () => {
    renderModal()
    expect(screen.getByTestId('admin-resolve-action-ANGIO_ADVISED_ED')).toBeInTheDocument()
    expect(screen.getByTestId('admin-resolve-action-ANGIO_ACE_DISCONTINUED')).toBeInTheDocument()
    // Generic Tier 1 actions must NOT appear for an angioedema alert.
    expect(screen.queryByTestId('admin-resolve-action-TIER1_DISCONTINUED')).not.toBeInTheDocument()
  })

  it('requires the willGo sub-field before submit is enabled', () => {
    renderModal()
    fireEvent.click(screen.getByTestId('admin-resolve-action-ANGIO_ADVISED_ED'))
    fireEvent.change(screen.getByTestId('admin-resolve-rationale'), {
      target: { value: 'Advised ED' },
    })
    // willGo not yet answered → still disabled.
    expect(screen.getByTestId('admin-resolve-confirm')).toBeDisabled()
    fireEvent.click(screen.getByTestId('admin-resolve-subfield-willGo-no'))
    expect(screen.getByTestId('admin-resolve-confirm')).not.toBeDisabled()
  })

  it('posts willGo in resolutionDetails', async () => {
    renderModal()
    fireEvent.click(screen.getByTestId('admin-resolve-action-ANGIO_ADVISED_ED'))
    fireEvent.change(screen.getByTestId('admin-resolve-rationale'), {
      target: { value: 'Patient refuses ED' },
    })
    fireEvent.click(screen.getByTestId('admin-resolve-subfield-willGo-no'))
    fireEvent.click(screen.getByTestId('admin-resolve-confirm'))
    await waitFor(() => expect(mockResolve).toHaveBeenCalledTimes(1))
    expect(mockResolve).toHaveBeenCalledWith(
      'alert-1',
      'ANGIO_ADVISED_ED',
      'Patient refuses ED',
      { willGo: false },
    )
  })

  it('shows the side-effect warning for ACE/ARB discontinue', () => {
    renderModal()
    expect(screen.queryByTestId('admin-resolve-side-effect-warning')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('admin-resolve-action-ANGIO_ACE_DISCONTINUED'))
    expect(screen.getByTestId('admin-resolve-side-effect-warning')).toHaveTextContent(/contraindication/i)
  })

  it('text sub-field (false alarm) gates submit until filled', async () => {
    renderModal()
    fireEvent.click(screen.getByTestId('admin-resolve-action-ANGIO_FALSE_ALARM'))
    fireEvent.change(screen.getByTestId('admin-resolve-rationale'), {
      target: { value: 'Not angioedema' },
    })
    expect(screen.getByTestId('admin-resolve-confirm')).toBeDisabled()
    fireEvent.change(screen.getByTestId('admin-resolve-subfield-actualCause'), {
      target: { value: 'food allergy' },
    })
    expect(screen.getByTestId('admin-resolve-confirm')).not.toBeDisabled()
  })
})
