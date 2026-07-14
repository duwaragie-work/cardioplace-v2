# Design Proposal — Option D (retake-to-confirm) + 5-min Edit Window

**Author:** Claude Code session (for Dev 3 / Duwaragie)
**Date:** 2026-06-15
**Status:** PROPOSAL — Steps 2 & 3 of the Edit-Window build. NOT yet implemented.
**Spec:** `docs/clinical-signoffs/MANISHA_2026_06_12_EDIT_WINDOW_AND_SESSION_POLICY_SIGNOFF.md` (Q1, Q2, Q4)
**Foundation already landed (this branch):** the two new rules + locked provider
wording (`RULE_UNCONFIRMED_EMERGENCY`, `RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL`),
the `AlertContext.initialSystolicBP/initialDiastolicBP` fields for the BP1/BP2
render, the Q3 prompt-selection helper, and the symptom-override-bypass
regression spec (`qa/tests/43-*`).

This proposal answers the four open architecture questions the checkpoint
flagged. Each recommendation cites the concrete existing code it builds on so
the implementation in Steps 2/3 reuses machinery rather than duplicating it.

---

## Key framing: Option D's first reading MUST be persisted (held), not buffered purely client-side

The sign-off says "App does NOT submit to backend immediately." Taken
literally that implies a pure client-side hold. But Q2 also says: *"If patient
declines / closes app → original reading submitted to backend after 5-minute
window expires"* and fires `RULE_UNCONFIRMED_EMERGENCY`. **For a server-side
safety net to fire after the app is closed, the first reading must already be
on the server.** A purely client-held reading is lost the instant the tab
closes — which is exactly the case Manisha wants to flag as Tier 1.

**Resolution:** the first-of-pair emergency reading is **persisted immediately
but with engine FIRING held** — identical to the existing Cluster 6 Q2
single-reading hold (`JournalEntry.singleReadingFinalized` + the held-alert
pattern + `SessionFinalizeService`). "Does NOT submit immediately" is honored
in spirit: no alert pages anyone until the confirmation flow resolves. This is
the single most important design decision and everything below follows from it.

This also cleanly reconciles the two buffering models in the handoff:
- **Non-emergency (Step 2):** persist immediately, defer engine *evaluation/firing*
  for the 5-min edit window (server-authoritative). Reuses the existing hold.
- **BP-only emergency (Step 3 / Option D):** persist immediately as `AWAITING`,
  hold firing, resolve via confirmatory reading / decline / cron expiry.

---

## Q1 — Where does the Option D state machine live?

**Recommendation: orchestration in the daily-journal service layer + a small
PURE decision helper `backend/src/daily_journal/engine/option-d.ts`. Do NOT put
it inside `absolute-emergency.ts`.**

Why not `absolute-emergency.ts`: rule functions have signature
`(session, ctx) => RuleResult | null` (`engine/types.ts`). They see only the
session average — never submission context like "is this the confirmatory
second-of-pair?" or "did the patient decline?". The Option D branch is
inherently cross-reading + submission-context-dependent, so it cannot be a pure
session rule.

The "state machine" decomposes into three outcomes, each with a natural home:

| Outcome | Trigger | Where it's decided |
|---|---|---|
| **Confirmed emergency** (2nd reading also ≥180/120) | confirmatory submission | The session now averages emergency-range → the **existing** `absoluteEmergencyRule` fires `RULE_ABSOLUTE_EMERGENCY` naturally. No new code in the rule. |
| **Confirmed normal** (2nd reading < threshold) | confirmatory submission | New pure helper `decideOptionDOutcome({ firstBp, secondBp })` → `RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL`, invoked by the service when a `CONFIRMATORY` entry lands. |
| **Unconfirmed** (declined / window expired) | decline endpoint OR `SessionFinalizeService` cron | New `finalizeUnconfirmedEmergency()` on `DailyJournalService` → `RULE_UNCONFIRMED_EMERGENCY`. |

So: a tiny **pure, unit-testable** `engine/option-d.ts` for the confirmed-normal
vs confirmed-emergency branch (mirrors how `decideOptionDOutcome` would be
tested like `delayBand`/`sessionPrompt`), wired by the **service layer** which
owns persistence + cross-reading lookup. The alert-engine pipeline
(`alert-engine.service.ts`) stays as-is except that the session-average
evaluation must be SUPPRESSED for a held `AWAITING` first-of-pair until the
flow resolves (same gate as the existing single-reading hold).

---

## Q2 — Schema fields

Two distinct needs. Proposed additions to `JournalEntry`
(`backend/prisma/schema/daily_journal.prisma`), all nullable/defaulted so the
single migration needs no backfill.

### (a) Non-emergency 5-min edit/defer window (Step 2)

```prisma
/// Option D / Edit-Window (Manisha 2026-06-12 Q1+Q4). Server-authoritative
/// deadline before this entry's engine evaluation commits. While now() < this,
/// the patient may edit/delete and no alert fires. Null = evaluate immediately
/// (legacy rows, emergencies that bypass the window). Stamped server-side at
/// create = createdAt + FIVE_MIN_MS. Cleared early when the patient taps "I'm done".
engineEvaluationDeferredUntil  DateTime?
```

- **Minimal-reuse alternative:** the existing single-reading hold already
  defers *firing* of a non-emergency single reading for `SINGLE_READING_FINALIZE_MS`
  (5 min) via `singleReadingFinalized` + the cron. Step 2's edit window can ride
  on that timer instead of a new column. **Recommendation:** still add
  `engineEvaluationDeferredUntil` as the explicit source of truth — it (1) makes
  "is this entry still editable / not yet committed?" a single server-checked
  value the readings page and admin can both read, and (2) supports the
  "I'm done" early-commit (set it to now()) which the implicit `createdAt +
  const` computation can't express. The frontend `readings/page.tsx` already has
  a `FIVE_MIN_MS` scaffold to drive the edit/delete affordance off this.

### (b) Option D pairing / outcome marker (Step 3)

```prisma
enum EmergencyConfirmationState {
  AWAITING       // first-of-pair emergency reading; held, awaiting confirmation
  CONFIRMATORY   // second-of-pair reading submitted to confirm the first
  UNCONFIRMED    // resolved: patient declined / window expired (→ Tier 1 flag)
}

/// Option D retake-to-confirm (Manisha 2026-06-12 Q2). Null for every
/// non-Option-D entry. AWAITING is set on the first emergency-range,
/// no-symptom reading; CONFIRMATORY on the second reading; the cron/decline
/// path flips AWAITING → UNCONFIRMED when no confirmation arrives.
emergencyConfirmation  EmergencyConfirmationState?

/// On a CONFIRMATORY entry, the first-of-pair entry id (the AWAITING reading).
/// Lets the engine read BP1 for the RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL
/// message (→ AlertContext.initialSystolicBP/initialDiastolicBP) without
/// re-deriving the pair from the session window.
confirmsEntryId  String?
```

Reuse the existing `singleReadingFinalized` boolean as the **idempotency guard**
for the cron (an `UNCONFIRMED` finalize sets it true, exactly like the
single-reading path), so no new "resolved" timestamp is needed.

**Net migration:** 1 enum + 3 nullable columns on `JournalEntry`. Name e.g.
`add_option_d_engine_deferral_fields`. Local DB only (`localhost:5433`).

---

## Q3 — How does `SessionFinalizeService` know to fire `UNCONFIRMED_EMERGENCY` vs simply finalize?

Today `runScan` (`backend/src/crons/session-finalize.service.ts`) finds held
single readings, calls `shouldFinalizeAsSingleReading` (excludes AFib/preDay3/
has-sibling), then `finalizeSingleReadingSession` (fires the held **non-emergency**
L1). The branch is: **read `emergencyConfirmation` on the candidate.**

```
for each expired held candidate:
  if emergencyConfirmation === 'AWAITING'
     and no CONFIRMATORY sibling in the session
     and window elapsed:
        → dailyJournal.finalizeUnconfirmedEmergency(userId, entryId)
          (fires RULE_UNCONFIRMED_EMERGENCY, tier TIER_1_CONTRAINDICATION,
           provider-only; sets singleReadingFinalized=true for idempotency)
  else if eligible non-emergency single reading:
        → existing finalizeSingleReadingSession()  (unchanged)
```

The candidate query in `runScan` widens from "BP/HR single readings" to also
include `emergencyConfirmation: 'AWAITING'` rows. The `RECENT_FLOOR_MS` 24h
guard and the 2-min cron cadence are unchanged — an unconfirmed emergency older
than 24h is no longer actionable in real time, same rationale as today. The
explicit client decline endpoint (below) fires the same path immediately; the
cron is only the app-closed safety net.

---

## Q4 — How does the frontend signal "I'm the second-of-pair"?

**Recommendation: a DTO field on the EXISTING create endpoint, not a new
endpoint and not implicit session inference.**

The check-in submit handler (`CheckIn.tsx handleSubmit`) already passes
`sessionId` through `createJournalEntry`. Extend that DTO:

- **First reading (Screen A → persist + hold):** `createJournalEntry({ ...,
  beginEmergencyConfirmation: true })`. Backend stamps `emergencyConfirmation =
  AWAITING`, holds firing. The client-side Option-D branch (BP ≥180/120 AND no
  symptom flags) is decided in `handleSubmit` right after the existing
  `DELAYED_ENTRY` pre-submit gate — that gate is the exact precedent for a
  client-side pre-submit interception that returns early and shows a screen.
- **Second reading (Screen B → confirm):** `createJournalEntry({ ..., sessionId:
  <same>, confirmsEntryId: <firstEntryId> })`. Backend marks it `CONFIRMATORY`,
  links the pair, runs `decideOptionDOutcome` → fires `RULE_ABSOLUTE_EMERGENCY`
  (still emergency) or `RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL` (normal), and
  releases the first reading's hold.
- **Decline / Screen C (explicit):** `POST daily-journal/:entryId/decline-confirmation`
  — mirrors the existing `POST daily-journal/:entryId/finalize-single-reading`
  endpoint. Fires `RULE_UNCONFIRMED_EMERGENCY` immediately. The cron is the
  fallback when the app is closed without hitting this.

Why not the alternatives:
- **Separate endpoint for the whole flow** → duplicates the create pipeline
  (validation, delay-band, session grouping, axis persistence). The create path
  is the single source of truth for persisting a reading; Option D is metadata
  on top of it.
- **Pure session-context inference** ("the session already has an AWAITING
  reading, so this must be the confirmation") → too implicit, hard to test,
  ambiguous across overlapping sessions and the cross-visit join. An explicit
  `confirmsEntryId` is self-documenting and unit-testable.

---

## Routing finding — provider-only requires a guard (verified, Step 3 must address)

`RULE_UNCONFIRMED_EMERGENCY` is mapped to tier `TIER_1_CONTRAINDICATION` (so it
inherits the standard Tier-1 ladder T0/T4H/T8H/T24H/T48H from
`ladderForTier` and the rationale-required Tier-1 resolution actions from
`resolutionActionsForTier` — both already route by tier, no change needed).

**But** `EscalationService.fireT0` (escalation.service.ts ~line 591) dispatches
`TIER_1_CONTRAINDICATION_PATIENT_T0` (a patient EMAIL) for **any** alert with
`tier === 'TIER_1_CONTRAINDICATION'`. Firing `RULE_UNCONFIRMED_EMERGENCY` under
that tier would therefore email the patient — violating the Q2 "provider-only
(no caregiver, no patient)" requirement.

**Step 3 must do ONE of:**
1. **(Recommended, minimal)** Guard that dispatch:
   `if (alert.tier === 'TIER_1_CONTRAINDICATION' && alert.ruleId !== RULE_IDS.UNCONFIRMED_EMERGENCY)`.
   The registry already returns an empty patient/caregiver message for this
   rule, so the only thing to suppress is this one explicit patient-T0 dispatch.
2. **(Cleaner, larger)** Introduce a dedicated tier value
   `TIER_1_UNCONFIRMED_EMERGENCY` that maps to the Tier-1 ladder + Tier-1
   resolution + `isNonDismissable` but carries no patient-T0 dispatch. Requires
   a Prisma `AlertTier` enum addition + wiring in `ladderForTier`,
   `resolutionActionsForTier`, `isNonDismissable`, and the engine's tier
   assignment. Better separation; defer unless the reused-tier guard proves
   leaky.

The `RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL` (Tier 3) has no ladder and no
resolution actions (`ladderForTier` → null, `resolutionActionsForTier` → []) —
correct as-is.

---

## Test plan for Steps 2/3 (when built)

- Pure unit: `engine/option-d.ts` `decideOptionDOutcome` (emergency→ABSOLUTE,
  normal→CONFIRMED_NORMAL, boundary 180/120).
- Engine/service unit: `AWAITING` hold suppresses firing; `CONFIRMATORY` resolves;
  cron finalizes `AWAITING`→`UNCONFIRMED_EMERGENCY`.
- Playwright (`qa/tests/`): `42-option-d-bp-only-emergency.spec.ts`
  (retake→2nd emergency→ABSOLUTE; 2nd normal→CONFIRMED_NORMAL Tier 3, no L2
  ladder; decline/expire→UNCONFIRMED Tier 1 provider-only with locked wording),
  `45-edit-window-non-emergency.spec.ts`. The Step-4 spec `43-*` already guards
  the symptom-override bypass and must stay green.
- Provider-only routing assertion: no PATIENT/CAREGIVER Notification row for an
  `UNCONFIRMED_EMERGENCY` alert.
