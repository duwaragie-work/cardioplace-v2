// Manisha 5/24 Q1 — the backend rejects a physiologically-impossible reading
// (diastolic ≥ systolic) with 422 `implausible-reading`. createJournalEntry
// must surface that as a typed ImplausibleReadingError so CheckIn can show the
// re-take prompt instead of a generic failure.

import {
  createJournalEntry,
  ImplausibleReadingError,
  ClinicalIntakeRequiredError,
  getAlerts,
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

// Manual-test round 2 Group C frontend safety net — the backend already
// filters Tier-3 caregiver-only alerts (empty patientMessage) out of the
// patient list; this guard is defense-in-depth so a backend regression can't
// leak a "FOR YOUR INFORMATION" green card or an empty notification row onto
// the patient.
describe('getAlerts — Tier-3 empty-patientMessage safety-net filter (Round 2 Group C)', () => {
  beforeEach(() => mockFetch.mockReset())

  function payload(...rows: Array<Partial<{ id: string; tier: string; ruleId: string; patientMessage: string | null }>>) {
    return {
      data: rows.map((r, i) => ({
        id: r.id ?? `a${i}`,
        userId: 'p1',
        journalEntryId: 'je1',
        tier: r.tier ?? 'BP_LEVEL_1_HIGH',
        ruleId: r.ruleId ?? 'RULE_STANDARD_L1_HIGH',
        patientMessage: r.patientMessage === undefined ? 'p' : r.patientMessage,
        caregiverMessage: null,
        physicianMessage: null,
        status: 'OPEN',
        createdAt: new Date().toISOString(),
      })),
    }
  }

  it('drops Tier-3 alerts with null/empty/whitespace patientMessage', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(
        200,
        payload(
          { id: 'bp', tier: 'BP_LEVEL_1_HIGH', patientMessage: 'elevated' },
          { id: 't3-null', tier: 'TIER_3_INFO', patientMessage: null, ruleId: 'RULE_HF_CAREGIVER_EDEMA' },
          { id: 't3-blank', tier: 'TIER_3_INFO', patientMessage: '   ', ruleId: 'RULE_HCM_VASODILATOR' },
        ),
      ),
    )
    const out = await getAlerts()
    expect(out.map((a) => a.id)).toEqual(['bp'])
  })

  it('keeps Tier-3 alerts that DO carry a patient message (e.g. first-month nudge)', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(
        200,
        payload({
          id: 'nudge',
          tier: 'TIER_3_INFO',
          ruleId: 'RULE_FIRST_MONTH_ADHERENCE_NUDGE',
          patientMessage: 'A gentle reminder…',
        }),
      ),
    )
    const out = await getAlerts()
    expect(out.map((a) => a.id)).toEqual(['nudge'])
  })

  it('passes non-Tier-3 tiers through untouched', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(
        200,
        payload(
          { id: 'l2', tier: 'BP_LEVEL_2', patientMessage: 'emergency' },
          { id: 't1', tier: 'TIER_1_CONTRAINDICATION', patientMessage: 'contraindication' },
          { id: 'low', tier: 'BP_LEVEL_1_LOW', patientMessage: 'low BP' },
        ),
      ),
    )
    const out = await getAlerts()
    expect(out.map((a) => a.id)).toEqual(['l2', 't1', 'low'])
  })
})
