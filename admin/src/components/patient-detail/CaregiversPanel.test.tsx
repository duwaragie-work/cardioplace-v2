import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CaregiversPanel from './CaregiversPanel'
import {
  listCaregivers,
  createCaregiver,
} from '@/lib/services/caregiver.service'

// Manual-test round 2 Group D2 smoke test — Caregivers is now its own
// first-class patient-detail tab (out of Care Team). The shell wiring is
// admin-tsc-verified; this test confirms the panel content the tab mounts
// renders correctly (header + Add button, empty state, loaded state,
// add-flow round-trip).

jest.mock('@/lib/services/caregiver.service', () => ({
  listCaregivers: jest.fn(),
  createCaregiver: jest.fn(),
  updateCaregiver: jest.fn(),
  disableCaregiver: jest.fn(),
}))
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'md-1', roles: ['MEDICAL_DIRECTOR'] } }),
}))

const mockList = listCaregivers as jest.MockedFunction<typeof listCaregivers>
const mockCreate = createCaregiver as jest.MockedFunction<typeof createCaregiver>

describe('CaregiversPanel — D2 tab content smoke', () => {
  beforeEach(() => {
    mockList.mockReset()
    mockCreate.mockReset()
  })

  it('renders the panel header + Add button when mounted (the tab "smoke")', async () => {
    mockList.mockResolvedValue([])
    render(<CaregiversPanel patientId="p1" />)
    expect(screen.getByTestId('admin-caregivers-panel')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByTestId('admin-caregiver-add-button')).toBeInTheDocument(),
    )
    expect(screen.getByText(/Caregivers/)).toBeInTheDocument()
  })

  it('shows the empty-state copy when no caregivers exist', async () => {
    mockList.mockResolvedValue([])
    render(<CaregiversPanel patientId="p1" />)
    await waitFor(() => expect(mockList).toHaveBeenCalledWith('p1'))
    expect(screen.getByText(/No caregivers on file/i)).toBeInTheDocument()
  })

  it('renders each caregiver row with name + relationship', async () => {
    mockList.mockResolvedValue([
      {
        id: 'cg-1',
        patientUserId: 'p1',
        name: 'Jane Doe',
        relationship: 'daughter',
        phone: null,
        email: 'jane@example.com',
        notifyChannel: 'EMAIL',
        consentGivenAt: new Date().toISOString(),
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    render(<CaregiversPanel patientId="p1" />)
    const row = await screen.findByTestId('admin-caregiver-row-cg-1')
    expect(row).toHaveTextContent(/Jane Doe/)
    expect(row).toHaveTextContent(/daughter/)
    expect(row).toHaveTextContent(/Consent on file/i)
  })

  it('add-flow posts the patientId-scoped payload via createCaregiver', async () => {
    mockList.mockResolvedValue([])
    mockCreate.mockResolvedValue({
      id: 'cg-new',
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
    render(<CaregiversPanel patientId="p1" />)
    await waitFor(() => expect(mockList).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('admin-caregiver-add-button'))
    fireEvent.change(screen.getByTestId('admin-caregiver-name-input'), {
      target: { value: 'Sam' },
    })
    fireEvent.change(screen.getByTestId('admin-caregiver-email-input'), {
      target: { value: 'sam@example.com' },
    })
    fireEvent.click(screen.getByTestId('admin-caregiver-save-button'))
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        name: 'Sam',
        email: 'sam@example.com',
        notifyChannel: 'EMAIL',
      }),
    )
  })
})
