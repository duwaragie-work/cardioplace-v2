// Manisha 5/24 Q1 — the backend rejects a physiologically-impossible reading
// (diastolic ≥ systolic) with 422 `implausible-reading`. createJournalEntry
// must surface that as a typed ImplausibleReadingError so CheckIn can show the
// re-take prompt instead of a generic failure.

import {
  createJournalEntry,
  ImplausibleReadingError,
  ClinicalIntakeRequiredError,
} from './journal.service'
import { fetchWithAuth } from './token'

jest.mock('./token', () => ({
  fetchWithAuth: jest.fn(),
}))

const mockFetch = fetchWithAuth as jest.MockedFunction<typeof fetchWithAuth>

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const VALID_PAYLOAD = { measuredAt: new Date().toISOString(), systolicBP: 120, diastolicBP: 80 }

describe('createJournalEntry — implausible-reading handling (Q1)', () => {
  beforeEach(() => mockFetch.mockReset())

  it('throws ImplausibleReadingError on 422 implausible-reading with the server reason', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(422, { message: 'implausible-reading', reason: 'diastolic-not-below-systolic' }),
    )
    await expect(createJournalEntry(VALID_PAYLOAD)).rejects.toBeInstanceOf(ImplausibleReadingError)
    await expect(createJournalEntry(VALID_PAYLOAD)).rejects.toMatchObject({
      code: 'implausible-reading',
      message: 'diastolic-not-below-systolic',
    })
  })

  it('still throws ClinicalIntakeRequiredError on 403, not the implausible error', async () => {
    mockFetch.mockResolvedValue(jsonResponse(403, { message: 'clinical-intake-required' }))
    await expect(createJournalEntry(VALID_PAYLOAD)).rejects.toBeInstanceOf(ClinicalIntakeRequiredError)
  })

  it('returns the created entry + pendingSecondReading on success', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(201, { data: { id: 'je-1' }, pendingSecondReading: true }),
    )
    const result = await createJournalEntry(VALID_PAYLOAD)
    expect(result.entry.id).toBe('je-1')
    expect(result.pendingSecondReading).toBe(true)
  })

  it('throws a generic Error for other non-OK statuses', async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, { message: 'boom' }))
    await expect(createJournalEntry(VALID_PAYLOAD)).rejects.not.toBeInstanceOf(ImplausibleReadingError)
    await expect(createJournalEntry(VALID_PAYLOAD)).rejects.toThrow('boom')
  })
})
