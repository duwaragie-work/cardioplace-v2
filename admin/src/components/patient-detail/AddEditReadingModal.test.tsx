import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AddEditReadingModal, { DeleteReadingDialog } from './AddEditReadingModal'
import type { PatientJournalEntry } from '@/lib/services/provider.service'
import * as providerService from '@/lib/services/provider.service'

jest.mock('@/lib/services/provider.service', () => ({
  addReading: jest.fn(),
  editReading: jest.fn(),
  deleteReading: jest.fn(),
}))

const addReading = providerService.addReading as jest.MockedFunction<typeof providerService.addReading>
const editReading = providerService.editReading as jest.MockedFunction<typeof providerService.editReading>
const deleteReading = providerService.deleteReading as jest.MockedFunction<typeof providerService.deleteReading>

function fillVitals(sbp: string, dbp: string) {
  fireEvent.change(screen.getByTestId('admin-reading-systolic'), { target: { value: sbp } })
  fireEvent.change(screen.getByTestId('admin-reading-diastolic'), { target: { value: dbp } })
}

function entry(over: Partial<PatientJournalEntry> = {}): PatientJournalEntry {
  return {
    id: 'je-1',
    measuredAt: '2026-06-12T10:00:00.000Z',
    sessionId: 's1',
    systolicBP: 132,
    diastolicBP: 84,
    pulse: 70,
    weight: 68.04,
    position: 'SITTING',
    notes: 'pre-visit',
    severeHeadache: false,
    dizziness: true,
    otherSymptoms: ['nausea'],
    deviations: [],
    source: 'manual',
    ...over,
  } as unknown as PatientJournalEntry
}

describe('AddEditReadingModal — add mode + session flow', () => {
  beforeEach(() => jest.clearAllMocks())

  it('validates required BP before calling the API', async () => {
    render(<AddEditReadingModal patientUserId="p1" onClose={jest.fn()} onSaved={jest.fn()} />)
    fireEvent.click(screen.getByTestId('admin-reading-save'))
    expect(await screen.findByTestId('admin-reading-modal-error')).toHaveTextContent(/systolic and diastolic/i)
    expect(addReading).not.toHaveBeenCalled()
  })

  it('rejects a transposed reading (DBP >= SBP) client-side', async () => {
    render(<AddEditReadingModal patientUserId="p1" onClose={jest.fn()} onSaved={jest.fn()} />)
    fillVitals('120', '140')
    fireEvent.click(screen.getByTestId('admin-reading-save'))
    expect(await screen.findByTestId('admin-reading-modal-error')).toHaveTextContent(/bottom number must be lower/i)
    expect(addReading).not.toHaveBeenCalled()
  })

  it('submits the payload, refreshes the list, then offers the session follow-up', async () => {
    addReading.mockResolvedValueOnce({ id: 'new-1', sessionId: 's-new' } as PatientJournalEntry)
    const onSaved = jest.fn()
    render(<AddEditReadingModal patientUserId="p1" onClose={jest.fn()} onSaved={onSaved} />)

    fillVitals('140', '90')
    fireEvent.change(screen.getByTestId('admin-reading-pulse'), { target: { value: '76' } })
    fireEvent.click(screen.getByTestId('admin-reading-symptom-dizziness'))
    fireEvent.click(screen.getByTestId('admin-reading-save'))

    expect(await screen.findByTestId('admin-reading-followup')).toHaveTextContent(/reading 1 saved/i)
    expect(onSaved).toHaveBeenCalledTimes(1)

    const payload = addReading.mock.calls[0][1]
    expect(addReading.mock.calls[0][0]).toBe('p1')
    expect(payload).toMatchObject({ systolicBP: 140, diastolicBP: 90, pulse: 76, dizziness: true })
    expect(typeof payload.measuredAt).toBe('string')
    // First reading of a sitting — backend assigns the session.
    expect(payload.sessionId).toBeUndefined()
  })

  it('[Add another] keeps the modal open and the second submit carries the sessionId', async () => {
    addReading
      .mockResolvedValueOnce({ id: 'new-1', sessionId: 's-new' } as PatientJournalEntry)
      .mockResolvedValueOnce({ id: 'new-2', sessionId: 's-new' } as PatientJournalEntry)
    render(<AddEditReadingModal patientUserId="p1" onClose={jest.fn()} onSaved={jest.fn()} />)

    fillVitals('140', '90')
    fireEvent.click(screen.getByTestId('admin-reading-save'))
    fireEvent.click(await screen.findByTestId('admin-reading-add-another'))

    // Back on the form, vitals cleared, title reflects the session position.
    expect(screen.getByTestId('admin-reading-systolic')).toHaveValue(null)
    expect(screen.getByText(/add reading 2 to this session/i)).toBeInTheDocument()

    fillVitals('142', '88')
    fireEvent.click(screen.getByTestId('admin-reading-save'))

    await waitFor(() => expect(addReading).toHaveBeenCalledTimes(2))
    expect(addReading.mock.calls[1][1]).toMatchObject({
      systolicBP: 142,
      diastolicBP: 88,
      sessionId: 's-new',
    })
  })

  it('auto-closes after the third reading of a session', async () => {
    addReading.mockResolvedValue({ id: 'new-x', sessionId: 's-new' } as PatientJournalEntry)
    const onClose = jest.fn()
    render(<AddEditReadingModal patientUserId="p1" onClose={onClose} onSaved={jest.fn()} />)

    for (let i = 0; i < 2; i++) {
      fillVitals('140', '90')
      fireEvent.click(screen.getByTestId('admin-reading-save'))
      fireEvent.click(await screen.findByTestId('admin-reading-add-another'))
    }
    fillVitals('141', '89')
    fireEvent.click(screen.getByTestId('admin-reading-save'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(addReading).toHaveBeenCalledTimes(3)
  })

  it('splits symptoms like the patient check-in: core grid + gated Pregnancy-specific + other + NSAID', () => {
    render(
      <AddEditReadingModal patientUserId="p1" isPregnant onClose={jest.fn()} onSaved={jest.fn()} />,
    )

    expect(screen.getByTestId('admin-reading-pregnancy-header')).toHaveTextContent(/pregnancy-specific/i)
    // Pregnancy symptoms live under their own header, core ones in the main grid.
    expect(screen.getByTestId('admin-reading-symptom-newOnsetHeadache')).toBeInTheDocument()
    expect(screen.getByTestId('admin-reading-symptom-ruqPain')).toBeInTheDocument()
    expect(screen.getByTestId('admin-reading-symptom-edema')).toBeInTheDocument()
    // NSAID is a medication-use checkbox, not a symptom checkbox.
    expect(screen.queryByTestId('admin-reading-symptom-nsaidUse')).not.toBeInTheDocument()
    expect(screen.getByTestId('admin-reading-nsaid')).toBeInTheDocument()
    expect(screen.getByTestId('admin-reading-other-symptoms')).toBeInTheDocument()
  })

  it('hides the Pregnancy-specific section for non-pregnant patients (patient-side parity)', () => {
    render(<AddEditReadingModal patientUserId="p1" onClose={jest.fn()} onSaved={jest.fn()} />)
    expect(screen.queryByTestId('admin-reading-pregnancy-header')).not.toBeInTheDocument()
    expect(screen.queryByTestId('admin-reading-symptom-newOnsetHeadache')).not.toBeInTheDocument()
  })

  it('still shows Pregnancy-specific on an entry that already carries a pregnancy symptom', () => {
    render(
      <AddEditReadingModal
        patientUserId="p1"
        entry={entry({ edema: true } as Partial<PatientJournalEntry>)}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    )
    expect(screen.getByTestId('admin-reading-pregnancy-header')).toBeInTheDocument()
    expect(screen.getByTestId('admin-reading-symptom-edema')).toBeChecked()
  })

  it('converts lbs → kg and sends chip-added otherSymptoms + nsaidUse in the payload', async () => {
    addReading.mockResolvedValueOnce({ id: 'new-1', sessionId: 's-new' } as PatientJournalEntry)
    render(<AddEditReadingModal patientUserId="p1" onClose={jest.fn()} onSaved={jest.fn()} />)

    fillVitals('140', '90')
    fireEvent.change(screen.getByTestId('admin-reading-weight'), { target: { value: '150' } })
    // Chip input — one symptom per Add, stacked below (patient-side parity).
    fireEvent.change(screen.getByTestId('admin-reading-other-symptoms'), { target: { value: 'nausea' } })
    fireEvent.click(screen.getByTestId('admin-reading-other-symptoms-add'))
    fireEvent.change(screen.getByTestId('admin-reading-other-symptoms'), { target: { value: 'blurred vision' } })
    fireEvent.click(screen.getByTestId('admin-reading-other-symptoms-add'))
    expect(screen.getByTestId('admin-reading-other-symptoms-list')).toHaveTextContent('nausea')
    expect(screen.getByTestId('admin-reading-other-symptoms-list')).toHaveTextContent('blurred vision')
    fireEvent.click(screen.getByTestId('admin-reading-nsaid'))
    fireEvent.click(screen.getByTestId('admin-reading-save'))

    await screen.findByTestId('admin-reading-followup')
    const payload = addReading.mock.calls[0][1]
    // Weight is entered in lbs (US standard, no unit selector) and stored as
    // kg: 150 lbs × 0.45359237 = 68.04 kg (2-dp, same as the patient app).
    expect(payload.weight).toBeCloseTo(68.04, 2)
    expect(payload.otherSymptoms).toEqual(['nausea', 'blurred vision'])
    expect(payload.nsaidUse).toBe(true)
  })

  it('has no unit selector — weight is lbs-only like the patient readings edit', () => {
    render(<AddEditReadingModal patientUserId="p1" onClose={jest.fn()} onSaved={jest.fn()} />)
    expect(screen.queryByTestId('admin-reading-weight-unit')).not.toBeInTheDocument()
    expect(screen.getByText(/weight in lbs/i)).toBeInTheDocument()
  })

  it('surfaces the backend session-expiry 400 message', async () => {
    addReading.mockRejectedValueOnce(new Error('Session expired or invalid'))
    render(<AddEditReadingModal patientUserId="p1" onClose={jest.fn()} onSaved={jest.fn()} />)
    fillVitals('140', '90')
    fireEvent.click(screen.getByTestId('admin-reading-save'))
    expect(await screen.findByTestId('admin-reading-modal-error')).toHaveTextContent('Session expired or invalid')
  })
})

describe('AddEditReadingModal — edit mode', () => {
  beforeEach(() => jest.clearAllMocks())

  it('pre-populates from the entry and submits a PUT with the changed values', async () => {
    editReading.mockResolvedValueOnce({ id: 'je-1' } as PatientJournalEntry)
    const onSaved = jest.fn()
    const onClose = jest.fn()
    render(
      <AddEditReadingModal patientUserId="p1" entry={entry()} onClose={onClose} onSaved={onSaved} />,
    )

    expect(screen.getByText('Edit reading')).toBeInTheDocument()
    expect(screen.getByTestId('admin-reading-systolic')).toHaveValue(132)
    expect(screen.getByTestId('admin-reading-diastolic')).toHaveValue(84)
    expect(screen.getByTestId('admin-reading-pulse')).toHaveValue(70)
    // Stored kg (68.04) converted to lbs for display (US standard): 150 lbs.
    expect(screen.getByTestId('admin-reading-weight')).toHaveValue(150)
    // Existing freeform symptoms render as chips; the draft input stays empty.
    expect(screen.getByTestId('admin-reading-other-symptoms-list')).toHaveTextContent('nausea')
    expect(screen.getByTestId('admin-reading-other-symptoms')).toHaveValue('')
    expect(screen.getByTestId('admin-reading-notes')).toHaveValue('pre-visit')
    expect(screen.getByTestId('admin-reading-symptom-dizziness')).toBeChecked()

    fireEvent.change(screen.getByTestId('admin-reading-systolic'), { target: { value: '145' } })
    fireEvent.click(screen.getByTestId('admin-reading-save'))

    await waitFor(() => expect(editReading).toHaveBeenCalledTimes(1))
    expect(editReading.mock.calls[0][0]).toBe('p1')
    expect(editReading.mock.calls[0][1]).toBe('je-1')
    expect(editReading.mock.calls[0][2]).toMatchObject({ systolicBP: 145, diastolicBP: 84 })
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    // Edit mode never enters the session follow-up flow.
    expect(screen.queryByTestId('admin-reading-followup')).not.toBeInTheDocument()
  })

  it('rejects a no-change "Save changes" before any API call', async () => {
    render(
      <AddEditReadingModal patientUserId="p1" entry={entry()} onClose={jest.fn()} onSaved={jest.fn()} />,
    )

    fireEvent.click(screen.getByTestId('admin-reading-save'))

    expect(await screen.findByTestId('admin-reading-modal-error')).toHaveTextContent(/no changes to save/i)
    expect(editReading).not.toHaveBeenCalled()

    // Reverting a change back to the original is still a no-op.
    fireEvent.change(screen.getByTestId('admin-reading-systolic'), { target: { value: '145' } })
    fireEvent.change(screen.getByTestId('admin-reading-systolic'), { target: { value: '132' } })
    fireEvent.click(screen.getByTestId('admin-reading-save'))
    expect(await screen.findByTestId('admin-reading-modal-error')).toHaveTextContent(/no changes to save/i)
    expect(editReading).not.toHaveBeenCalled()
  })
})

describe('AddEditReadingModal — medication adherence (patient check-in parity)', () => {
  beforeEach(() => jest.clearAllMocks())

  const MEDS = [
    { id: 'med-1', drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR' },
    { id: 'med-2', drugName: 'Amlodipine', drugClass: 'DHP_CCB' },
  ]

  it('renders Yes / No / Not due yet per med; No reveals reason + missed doses', () => {
    render(
      <AddEditReadingModal patientUserId="p1" medications={MEDS} onClose={jest.fn()} onSaved={jest.fn()} />,
    )

    expect(screen.getByTestId('admin-reading-med-med-1')).toHaveTextContent('Lisinopril')
    expect(screen.getByTestId('admin-reading-med-med-1-scheduledLater')).toHaveTextContent(/not due yet/i)
    // Reason + doses hidden until "No" is chosen.
    expect(screen.queryByTestId('admin-reading-med-med-1-reason')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('admin-reading-med-med-1-no'))
    expect(screen.getByTestId('admin-reading-med-med-1-reason')).toBeInTheDocument()
    expect(screen.getByTestId('admin-reading-med-med-1-doses')).toBeInTheDocument()
  })

  it('derives the same aggregates as the patient check-in (yes + missed mix)', async () => {
    addReading.mockResolvedValueOnce({ id: 'new-1', sessionId: 's-new' } as PatientJournalEntry)
    render(
      <AddEditReadingModal patientUserId="p1" medications={MEDS} onClose={jest.fn()} onSaved={jest.fn()} />,
    )

    fillVitals('140', '90')
    fireEvent.click(screen.getByTestId('admin-reading-med-med-1-yes'))
    fireEvent.click(screen.getByTestId('admin-reading-med-med-2-no'))
    fireEvent.change(screen.getByTestId('admin-reading-med-med-2-reason'), { target: { value: 'FORGOT' } })
    fireEvent.change(screen.getByTestId('admin-reading-med-med-2-doses'), { target: { value: '2' } })
    fireEvent.click(screen.getByTestId('admin-reading-save'))

    await screen.findByTestId('admin-reading-followup')
    const payload = addReading.mock.calls[0][1]
    expect(payload.medicationTaken).toBe(false)
    expect(payload.medicationScheduledLater).toBe(false)
    expect(payload.missedMedications).toEqual([
      { medicationId: 'med-2', drugName: 'Amlodipine', drugClass: 'DHP_CCB', reason: 'FORGOT', missedDoses: 2 },
    ])
    expect(payload.medicationStatuses).toEqual([
      { medicationId: 'med-1', drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR', taken: 'yes' },
      { medicationId: 'med-2', drugName: 'Amlodipine', drugClass: 'DHP_CCB', taken: 'no', reason: 'FORGOT', missedDoses: 2 },
    ])
  })

  it('all "not due yet" → scheduledLater flag, no taken/missed signal', async () => {
    addReading.mockResolvedValueOnce({ id: 'new-1', sessionId: 's-new' } as PatientJournalEntry)
    render(
      <AddEditReadingModal patientUserId="p1" medications={MEDS} onClose={jest.fn()} onSaved={jest.fn()} />,
    )

    fillVitals('140', '90')
    fireEvent.click(screen.getByTestId('admin-reading-med-med-1-scheduledLater'))
    fireEvent.click(screen.getByTestId('admin-reading-med-med-2-scheduledLater'))
    fireEvent.click(screen.getByTestId('admin-reading-save'))

    await screen.findByTestId('admin-reading-followup')
    const payload = addReading.mock.calls[0][1]
    expect(payload.medicationTaken).toBeUndefined()
    expect(payload.medicationScheduledLater).toBe(true)
    expect(payload.medicationStatuses).toHaveLength(2)
  })

  it('sends no medication fields when nothing was answered', async () => {
    addReading.mockResolvedValueOnce({ id: 'new-1', sessionId: 's-new' } as PatientJournalEntry)
    render(
      <AddEditReadingModal patientUserId="p1" medications={MEDS} onClose={jest.fn()} onSaved={jest.fn()} />,
    )

    fillVitals('140', '90')
    fireEvent.click(screen.getByTestId('admin-reading-save'))

    await screen.findByTestId('admin-reading-followup')
    const payload = addReading.mock.calls[0][1]
    expect(payload.medicationTaken).toBeUndefined()
    expect(payload.medicationScheduledLater).toBeUndefined()
    expect(payload.medicationStatuses).toBeUndefined()
  })

  it('edit mode rebuilds each answer from entry.medicationStatuses; changing one is saveable', async () => {
    editReading.mockResolvedValueOnce({ id: 'je-1' } as PatientJournalEntry)
    const withStatuses = entry({
      medicationStatuses: [
        { medicationId: 'med-1', drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR', taken: 'yes' },
        { medicationId: 'med-2', drugName: 'Amlodipine', drugClass: 'DHP_CCB', taken: 'no', reason: 'FORGOT', missedDoses: 2 },
      ],
    } as Partial<PatientJournalEntry>)
    render(
      <AddEditReadingModal
        patientUserId="p1"
        entry={withStatuses}
        medications={MEDS}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    )

    // Rebuilt: med-2's missed detail visible with the stored reason + doses.
    expect(screen.getByTestId('admin-reading-med-med-2-reason')).toHaveValue('FORGOT')
    expect(screen.getByTestId('admin-reading-med-med-2-doses')).toHaveValue(2)

    // Changing only a med answer counts as a change (no-op guard passes).
    fireEvent.click(screen.getByTestId('admin-reading-med-med-2-yes'))
    fireEvent.click(screen.getByTestId('admin-reading-save'))

    await waitFor(() => expect(editReading).toHaveBeenCalledTimes(1))
    const payload = editReading.mock.calls[0][2]
    expect(payload.medicationTaken).toBe(true)
    // Edit clears the previously stored miss detail (explicit empty array).
    expect(payload.missedMedications).toEqual([])
  })
})

describe('AddEditReadingModal — read-only view mode', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders disabled fields with Close + Edit switch; Edit flips to the editable form', () => {
    render(
      <AddEditReadingModal
        patientUserId="p1"
        entry={entry()}
        viewOnly
        canEdit
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    )

    expect(screen.getByText('Reading details')).toBeInTheDocument()
    expect(screen.getByTestId('admin-reading-systolic')).toBeDisabled()
    expect(screen.getByTestId('admin-reading-notes')).toBeDisabled()
    expect(screen.getByText('Close')).toBeInTheDocument()
    expect(screen.queryByTestId('admin-reading-save')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('admin-reading-edit-switch'))
    expect(screen.getByText('Edit reading')).toBeInTheDocument()
    expect(screen.getByTestId('admin-reading-systolic')).not.toBeDisabled()
    expect(screen.getByTestId('admin-reading-save')).toBeInTheDocument()
  })

  it('offers no Edit switch when the viewer cannot manage readings', () => {
    render(
      <AddEditReadingModal
        patientUserId="p1"
        entry={entry()}
        viewOnly
        canEdit={false}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    )
    expect(screen.getByTestId('admin-reading-systolic')).toBeDisabled()
    expect(screen.queryByTestId('admin-reading-edit-switch')).not.toBeInTheDocument()
  })
})

describe('DeleteReadingDialog', () => {
  beforeEach(() => jest.clearAllMocks())

  it('confirms with date/time wording and calls DELETE on confirm', async () => {
    deleteReading.mockResolvedValueOnce(undefined)
    const onDeleted = jest.fn()
    const onClose = jest.fn()
    render(
      <DeleteReadingDialog patientUserId="p1" entry={entry()} onClose={onClose} onDeleted={onDeleted} />,
    )

    expect(screen.getByTestId('admin-delete-reading-dialog')).toHaveTextContent(/delete reading from/i)
    expect(screen.getByTestId('admin-delete-reading-dialog')).toHaveTextContent(/cannot be undone/i)

    fireEvent.click(screen.getByTestId('admin-reading-delete-confirm'))
    await waitFor(() => expect(deleteReading).toHaveBeenCalledWith('p1', 'je-1'))
    expect(onDeleted).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
