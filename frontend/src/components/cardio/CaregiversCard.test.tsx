import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CaregiversCard from './CaregiversCard'
import {
  getCaregivers,
  addCaregiver,
} from '@/lib/services/caregiver.service'

// F14 — patient CaregiversCard now mirrors admin CaregiversPanel's row layout:
// consent renders as a compact STATUS line on the left (no longer an oversized
// full-width toggle button) plus a right-side action group (consent toggle +
// remove). Per Duwaragie the patient-friendly wording is kept — the intro
// paragraph stays and the consent CTA reads "Allow alerts"/"Revoke" rather than
// admin's "Record consent".

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

  it('mirrors admin row layout: compact consent STATUS span + action toggle (patient wording)', async () => {
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
    // Consent is now a compact status line (mirrors admin), not a full-width
    // toggle button.
    const status = await screen.findByTestId('profile-caregiver-consent-status-c1')
    expect(status).toHaveTextContent(/no consent/i)
    // The action toggle keeps patient-friendly wording — NOT admin's "Record consent".
    const consentBtn = screen.getByTestId('profile-caregiver-consent-c1')
    expect(consentBtn).toHaveTextContent(/allow alerts/i)
    expect(screen.queryByText(/^Record consent$/)).not.toBeInTheDocument()
  })

  it('shows "Revoke" wording once consent is on file', async () => {
    mockGet.mockResolvedValue([
      {
        id: 'c2',
        patientUserId: 'p1',
        name: 'Sam Roe',
        relationship: null,
        phone: null,
        email: 'sam@example.com',
        notifyChannel: 'EMAIL',
        consentGivenAt: new Date().toISOString(),
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    render(<CaregiversCard />)
    const status = await screen.findByTestId('profile-caregiver-consent-status-c2')
    expect(status).toHaveTextContent(/consent given/i)
    expect(screen.getByTestId('profile-caregiver-consent-c2')).toHaveTextContent(/revoke/i)
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
