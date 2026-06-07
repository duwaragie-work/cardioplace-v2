import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MedicationHoldModal from './MedicationHoldModal'
import type { PatientMedication } from '@/lib/services/patient-detail.service'
import { verifyMedication } from '@/lib/services/patient-detail.service'

// Manisha 5/24 Med §3 — structured HOLD reason codes. The modal forces a reason
// pick (no free-text-only hold), reveals the provider-directed clinical warning,
// and requires a rationale only for OTHER. These guard the two-path contract.

jest.mock('@/lib/services/patient-detail.service', () => ({
  verifyMedication: jest.fn(),
}))

const mockVerify = verifyMedication as jest.MockedFunction<typeof verifyMedication>

const MED = {
  id: 'med-1',
  drugName: 'Lisinopril 10mg',
} as unknown as PatientMedication

function renderModal(over: Partial<React.ComponentProps<typeof MedicationHoldModal>> = {}) {
  const onConfirmed = jest.fn()
  const onClose = jest.fn()
  render(
    <MedicationHoldModal
      med={MED}
      open
      onClose={onClose}
      onConfirmed={onConfirmed}
      {...over}
    />,
  )
  return { onConfirmed, onClose }
}

describe('MedicationHoldModal — structured reason codes (Med §3)', () => {
  beforeEach(() => {
    mockVerify.mockReset()
    mockVerify.mockResolvedValue(MED)
  })

  it('disables submit until a reason is picked', () => {
    renderModal()
    expect(screen.getByTestId('admin-med-hold-confirm')).toBeDisabled()
    expect(screen.getByText(/select a reason to place on hold/i)).toBeInTheDocument()
  })

  it('shows the provider-directed clinical warning naming the drug', () => {
    renderModal()
    expect(screen.queryByTestId('admin-med-hold-clinical-note')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('admin-med-hold-pick-PROVIDER_DIRECTED_HOLD'))
    const note = screen.getByTestId('admin-med-hold-clinical-note')
    expect(note).toHaveTextContent(/pause Lisinopril 10mg/i)
  })

  it('submits an administrative hold without requiring a rationale', async () => {
    const { onConfirmed } = renderModal()
    fireEvent.click(screen.getByTestId('admin-med-hold-pick-AWAITING_RECORDS'))
    const confirm = screen.getByTestId('admin-med-hold-confirm')
    expect(confirm).not.toBeDisabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(mockVerify).toHaveBeenCalledTimes(1))
    expect(mockVerify).toHaveBeenCalledWith('med-1', 'HOLD', undefined, 'AWAITING_RECORDS')
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled())
  })

  it('requires a rationale for OTHER before enabling submit', () => {
    renderModal()
    fireEvent.click(screen.getByTestId('admin-med-hold-pick-OTHER'))
    expect(screen.getByTestId('admin-med-hold-confirm')).toBeDisabled()
    fireEvent.change(screen.getByTestId('admin-med-hold-rationale'), {
      target: { value: 'patient is travelling' },
    })
    expect(screen.getByTestId('admin-med-hold-confirm')).not.toBeDisabled()
  })

  it('passes the rationale through for a provider-directed hold', async () => {
    renderModal()
    fireEvent.click(screen.getByTestId('admin-med-hold-pick-PROVIDER_DIRECTED_HOLD'))
    fireEvent.change(screen.getByTestId('admin-med-hold-rationale'), {
      target: { value: 'cough — switching to ARB' },
    })
    fireEvent.click(screen.getByTestId('admin-med-hold-confirm'))
    await waitFor(() => expect(mockVerify).toHaveBeenCalledTimes(1))
    expect(mockVerify).toHaveBeenCalledWith(
      'med-1',
      'HOLD',
      'cough — switching to ARB',
      'PROVIDER_DIRECTED_HOLD',
    )
  })
})
