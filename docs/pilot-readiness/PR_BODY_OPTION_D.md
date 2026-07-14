# Edit-Window + Option D + Q3 Hybrid (Manisha 2026-06-12 sign-off)

Implements the full edit-window + emergency-handling + sessioning build from
`docs/clinical-signoffs/MANISHA_2026_06_12_EDIT_WINDOW_AND_SESSION_POLICY_SIGNOFF.md`
(Q1–Q4 + the 5 Implementation Notes) and the Option-D wording sign-off.

## What's in here

- **Step 5 — two new rules** `RULE_UNCONFIRMED_EMERGENCY` (Tier 1, provider-only)
  + `RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL` (Tier 3). Locked Manisha physician
  wording, snapshot-gated. Tier routing reuses `TIER_1_CONTRAINDICATION` (ladder
  + resolution) and `TIER_3_INFO` (no ladder).
- **Step 1 — Q3 hybrid prompt** consolidated into a pure, unit-tested
  `selectReadingPrompt` helper (AFib 3-reading vs non-AFib 2nd-reading). Existing
  signed wording kept (Cluster 6 Q2 / #90); 2026-06-12 drafts are restatements —
  not swapped. (Swap target if Manisha redlines: `checkin.confirm.takeSecondReading*`
  + `checkin.afib.state*`.)
- **Step 4 — symptom-override bypass** regression spec (symptom emergencies fire
  immediately, never enter Option D).
- **Step 2 — 5-min edit window** `engineEvaluationDeferredUntil` column +
  readings-page "editable / not yet sent" affordance.
- **Step 3 — Option D retake-to-confirm** engine state machine
  (`engine/option-d.ts` + service orchestration), `EmergencyConfirmationState`
  enum + `confirmsEntryId`, held-AWAITING-first-of-pair (engine emit skipped),
  CONFIRMATORY resolution (ABSOLUTE_EMERGENCY vs CONFIRMED_NORMAL decided on the
  **second reading's own band**, not the average), `decline-confirmation`
  endpoint, `SessionFinalizeService` cron branch (app-closed safety net),
  `fireT0` provider-only guard, and the 3-screen patient flow (`OptionDFlow.tsx`)
  + i18n ×5 locales.
- **Step 6 — provider one-pager** `PROVIDER_TYPO_EMERGENCY_HANDLING.md`.
- **Design doc** `docs/design/OPTION_D_AND_EDIT_WINDOW_DESIGN.md`.

## Wording status

Provider messages for the two new rules are **LOCKED** to Manisha's 2026-06-12
sign-off (snapshot-gated). The Option-D patient screens (A/B/C) are
**PLACEHOLDER** (Manisha-drafted, pending formal CONFIRM), centralized under
`checkin.optionD.*` so a redline is a one-commit swap.

## Tests

- Backend unit: **1721 pass** (71 suites, 336 snapshots) incl. 3 Option D engine
  scenarios, the `decideOptionDOutcome` decision spec, 2 BP1-robustness averager
  specs.
- Frontend: tsc clean; `selectReadingPrompt` unit spec; i18n-completeness gate green.
- E2E (Playwright, RUN_WRITE_TESTS): `42-option-d` (3), `43-symptom-override` (2),
  `45-edit-window` (1) — all green.
- **Browser smoke**: drove the full patient flow (login → check-in → 195/120 →
  Option D Screen A → Screen B → confirmatory 135/85 → CONFIRMED_NORMAL fired).
  This surfaced + fixed a BP1 robustness bug (first-of-pair now fetched directly
  by `confirmsEntryId`, robust to a slow retake leaving the session window).

### Pre-existing / unrelated full-suite failures (NOT introduced here)
The full local suite ran 445 pass / 21 fail; every failure was triaged as
unrelated to this change:
- `17`, `13`: transient `nest --watch` restart mid-run — pass on re-run.
- `14c §C.4`: pre-existing (angioedema `TIER_1_ANGIOEDEMA` dispatch, untouched here).
- `08`, `26`, `30b/30o/30u`, `16`: admin/profile/dashboard areas not touched —
  pre-existing baseline + shared-DB cross-spec state pollution.
CI's fresh per-shard DB should not see the restart flakiness.

## Accessibility (per `docs/ACCESSIBILITY_CHECK_GUIDE.md`)

| Check | Area | Result | Notes |
|---|---|---|---|
| C1 | Image alt | Pass | Decorative icons `aria-hidden="true"` (AlertTriangle/Activity/Phone). |
| C2 | Text size & contrast | Pass | Brand tokens; matches surrounding check-in scale. |
| C3 | Touch targets | Pass | 48px (h-12) buttons/inputs; 8px spacing. |
| C4 | Form labels | Pass | BP/pulse inputs labelled via `htmlFor`; error linked via `aria-describedby`/`aria-invalid`. |
| C5 | Keyboard | Pass | Native `<button>`/`<input>`; focus moves to each screen's heading on transition. |
| C6 | 200% zoom | Pass | rem/flex, max-w-md; no fixed-px breaks. |
| C7 | No color-only | Pass | Warning icon + text; safety footer icon + text. |
| C8 | Focus indicators | Pass | Buttons use global `:focus-visible`; inputs follow existing check-in convention. |
| C9 | SR names & ARIA | Pass | `role="group"` + `aria-labelledby`; `role="alert"` on validation; meaningful button text. |
| C-Skip | Skip-to-main | N/A | Reuses `id="main"`; not a new route/layout. |

**Remaining risks:** Option-D patient wording is placeholder pending Manisha CONFIRM.
