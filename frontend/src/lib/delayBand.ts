// Chunk C (Manisha Backdated Readings sign-off 2026-06-06) — client-side mirror
// of the backend `computeDelayBand` helper (backend/src/daily_journal/
// daily_journal.service.ts, Chunk A). The BACKEND is authoritative on persist;
// this copy only PREDICTS the band BEFORE submit so the check-in can show the
// DELAYED_ENTRY soft warning without a server round-trip. Keep the thresholds
// in sync with the backend helper (5 min / 1 h / 24 h).

export type DelayBand =
  | 'REAL_TIME'
  | 'NEAR_REAL_TIME'
  | 'DELAYED_ENTRY'
  | 'HISTORICAL_ENTRY'

const NEAR_MS = 5 * 60 * 1000
const DELAYED_MS = 60 * 60 * 1000
const HISTORICAL_MS = 24 * 60 * 60 * 1000

/**
 * Classify the lag between when the patient says they measured (`measuredAtMs`)
 * and now (`nowMs`). Negative lag (clock skew / tiny future drift) falls into
 * REAL_TIME — the DTO validator rejects >5 min future at the controller.
 */
export function delayBandFor(measuredAtMs: number, nowMs: number): DelayBand {
  const lagMs = nowMs - measuredAtMs
  if (lagMs < NEAR_MS) return 'REAL_TIME'
  if (lagMs < DELAYED_MS) return 'NEAR_REAL_TIME'
  if (lagMs < HISTORICAL_MS) return 'DELAYED_ENTRY'
  return 'HISTORICAL_ENTRY'
}
