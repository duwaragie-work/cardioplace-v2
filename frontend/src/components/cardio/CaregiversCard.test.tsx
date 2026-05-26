import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CaregiversCard from './CaregiversCard'
import {
  getCaregivers,
  addCaregiver,
} from '@/lib/services/caregiver.service'

// Manual-test round 2 Group D1 — patient CaregiversCard restyle. The structural
// mirror with admin CaregiversPanel was already in place; this commit lifted
// the loading-state spinner and the no-consent ShieldOff icon for visual
// parity. The patient-friendly intro paragraph + toggleable-consent badge UX
// are intentionally preserved (clearer than admin's dual Revoke/Record-consent
// buttons).

jest.mock('@/lib/services/caregiver.service', () => ({
  getCaregivers: jest.fn(),
  addCaregiver: jest.fn(),
  updateCaregiver: jest.fn(),
  removeCaregiver: jest.fn(),
}))

const mockGet = getCaregivers as jest.MockedFunction<typeof getCaregivers>
const mockAdd = addCaregiver as jest.MockedFunction<typeof addCaregiver>

describe('CaregiversCard — patient restyle (Round 2 D1)', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockAdd.mockReset()
  })

  it('shows the patient-friendly intro paragraph (preserved over admin chrome)', async () => {
    mockGet.mockResolvedValue([])
    render(<CaregiversCard />)
    await waitFor(() => expect(mockGet).toHaveBeenCalled())
    expect(
      screen.getByText(/A caregiver is someone you trust/i),
    ).toBeInTheDocument()
  })

  it('renders the toggleable consent badge (NOT the admin dual button pair)', async () => {
    mockGet.mockResolvedValue([
      {
        id: 'c1',
        patientUserId: 'p1',
        name: 'Jane Doe',
        relationship: 'daughter',
        phone: null,
        email: 'jane@example.com',
        notifyChannel: 'EMAIL',
        consentGivenAt: null,
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    render(<CaregiversCard />)
    const consent = await screen.findByTestId('profile-caregiver-consent-c1')
    expect(consent).toHaveTextContent(/tap to allow alerts/i)
    // Admin's "Revoke"/"Record consent" buttons must NOT appear on the patient side.
    expect(screen.queryByText(/^Revoke$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Record consent$/)).not.toBeInTheDocument()
  })

  it('shows the spinner loading state (parity with admin panel)', () => {
    mockGet.mockReturnValue(new Promise(() => {})) // never resolves
    render(<CaregiversCard />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('add flow posts the patient payload via addCaregiver (no patientId param)', async () => {
    mockGet.mockResolvedValue([])
    mockAdd.mockResolvedValue({
      id: 'c-new',
      patientUserId: 'p1',
      name: 'Sam',
      relationship: null,
      phone: null,
      email: 'sam@example.com',
      notifyChannel: 'EMAIL',
      consentGivenAt: new Date().toISOString(),
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    render(<CaregiversCard />)
    await waitFor(() => expect(mockGet).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('profile-caregiver-add-button'))
    fireEvent.change(screen.getByTestId('profile-caregiver-name-input'), {
      target: { value: 'Sam' },
    })
    fireEvent.change(screen.getByTestId('profile-caregiver-email-input'), {
      target: { value: 'sam@example.com' },
    })
    fireEvent.click(screen.getByTestId('profile-caregiver-consent-checkbox'))
    fireEvent.click(screen.getByTestId('profile-caregiver-save-button'))
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1))
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Sam',
        email: 'sam@example.com',
        notifyChannel: 'EMAIL',
        consentGiven: true,
      }),
    )
  })
})
