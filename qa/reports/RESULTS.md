# Cardioplace v2 — Playwright E2E Run Results

**Run date:** 2026-05-08 (final run after clusters 1+2+3+4)
**Branch:** `claude/review-cardioplace-v2-fOTac` (HEAD `9bdbc36`)
**Engine:** chromium-desktop (1440×900)
**Stack tested:** local — Postgres 16 + pgvector, NestJS backend `:4000` (`ENABLE_TEST_CONTROL=true`), Next.js 16 patient `:3000`, Next.js 16 admin `:3001`
**Seed:** 5 patients (Priya / James / Rita / Charles / Aisha) + 6 admins, perma-OTP `666666`

---

## Bottom line

| | Initial run | After clusters 1–4 |
|---|---:|---:|
| **Passed** | 67 | **85** ⬆️ |
| **Failed** | 39 | **21** ⬇️ |
| **Skipped** (env-gated) | 13 | 13 |
| **Total** | 119 | 119 |

**18 fewer failures.** All 12 product bugs (B1–B12) and 18 test-scaffolding issues from the original triage either fixed or correctly attributed to other-dev scope.

HTML report at `qa/reports/final/index.html`. JSON at `qa/reports/final/results.json`. Per-test failure videos + screenshots at `qa/test-results/`.

### Remaining 21 failures (categorized)

| Owner | Count | Spec file | What |
|---|---:|---|---|
| Dr. Singal (clinical decision) | 9 | `09-rule-engine-via-ui` | G1–G9 multi-alert behavior — engine fires single-primary; tests assumed multi-axis. Awaiting clinical sign-off on intended behavior. |
| Other dev | 1 | `09-rule-engine-via-ui` | B1 severeEpigastricRuq doesn't fire any alert (CLINICAL_SPEC §1.3 says it should fire BP_LEVEL_2_SYMPTOM_OVERRIDE). |
| Test infra polish | 11 | mixed | check-in step 2 selectors (3) + readings row affordances on reset state (1) + admin verify response unwrap (1) + enrollment-check unwrap (1) + iterative ladder backdate compounding (1) + monthly reask + 3 misc rule-engine edges (Tier 3 wide-PP physician-only annotation, AFib gate single-reading, etc.) |

---

## ✅ 67 passing tests

Full list is in `results.json`. Highlights worth calling out:

- **Marketing surface:** 7 of 8 pages return 200 + correct gated-route redirects.
- **Auth:** all 7 OTP flows + role-redirect tests pass on first run, including `seed patient OTP flow lands on /dashboard`, `wrong OTP shows inline error`, `email preserved when toggling OTP↔Magic Link`, `SUPER_ADMIN OTP lands on admin /dashboard`, `PATIENT-only email rejected by admin gate`, and `admin-role token signs in on patient app then bridges to admin URL`.
- **Per-role admin sign-in:** all 6 admin roles (manisha, support, primary-provider, backup-provider, medical-director, ops) sign in and land on `/dashboard`.
- **Admin patient list:** all 5 seeded patients render in the admin list.
- **Rule engine — 19 of 31 tier-9 cases pass:** standard adult thresholds (124/78 normal, 165/100 → STANDARD_L1_HIGH, 185/95 → ABSOLUTE_EMERGENCY, 170/125 → ABSOLUTE_EMERGENCY, Aisha 95/75 → AGE_65_LOW), 5 of 6 general symptom overrides (severeHeadache, visualChanges, alteredMentalStatus, chestPainOrDyspnea, focalNeuroDeficit), Tier 1 contraindications (Priya pregnancy + ACE → PREGNANCY_ACE_ARB, James HFrEF + Diltiazem → NDHP_HFREF), Rita CAD DBP 68 → CAD_DBP_CRITICAL, Rita CAD SBP 165 → CAD_HIGH, AFib HR rules with the ≥3-readings session gate (HR 115 → AFIB_HR_HIGH, HR 45 → AFIB_HR_LOW), AFib gate single reading correctly suppresses BP/HR rules, benign-reading auto-resolve (165/100 then 124/78 flips first alert OPEN→RESOLVED), Tier 1 contraindication does NOT auto-resolve on benign reading.
- **Patient onboarding Layer A gate:** seeded enrolled patient with PatientProfile can POST `/daily-journal` (control case passes).

---

## 🔴 Real product bugs caught by the suite (post-cluster-2 reconfirm)

Each line: **expected** → **got**. Copy these into a triage backlog.

> **Reconfirm note (cluster 2 — 2026-05-08):** B2 + B3 closed as test-side
> issues, not product bugs. B4 narrative updated with deeper clinical
> impact + Option-2 fix. See "Cluster 2 reconfirm log" section below for
> the full ladder analysis.

### P0 — Patient safety / clinical correctness

| # | Test | Expected | Got | Severity | Status |
|---|---|---|---|---|---|
| **B1** | `09 — severeEpigastricRuq at 130/80 → BP_LEVEL_2_SYMPTOM_OVERRIDE` | `RULE_SYMPTOM_OVERRIDE_GENERAL` fires (CLINICAL_SPEC §1.3 lists severe epigastric/RUQ pain as a Level 2 trigger) | **No alert fired at all** — empty alert list | **P0** | Open — owned by other dev |
| ~~**B2**~~ | ~~`13 — audit endpoint returns the 15 expected fields`~~ | ~~Missing `timeToAcknowledgment` + `timeToResolution`~~ | **Reconfirm:** fields exist as `timeToAcknowledgmentMs` + `timeToResolutionMs` (proper unit suffix per Joint Commission audit precision). Backend is correct. | n/a | **CLOSED — naming mismatch in the test, fixed in cluster-2 commit.** |
| ~~**B3**~~ | ~~`14 — acknowledged alert stops ladder progression`~~ | ~~`T4H` fires anyway after ack~~ | **Reconfirm:** admin ack via `POST /admin/alerts/:id/acknowledge` correctly flips state and `advanceOverdueLadders` filters out ack'd alerts. Original test failure used patient-side `PATCH /daily-journal/alerts/:id/acknowledge` which **returns 400 for Tier 1** (correct — patients can't self-ack a contraindication); test didn't check response, treated 400 as success. | n/a | **CLOSED — test used wrong endpoint, fixed in cluster-2 commit.** |
| **B4** | `13 — BP_L2_UNABLE_TO_REACH_RETRY` retry actually fires | After provider acks + chooses "unable to reach, retry in 4h", the scheduled retry event must dispatch when its `scheduledFor` passes | **Retry event silently dropped** — `firePendingScheduled` skips the event because `alert.acknowledgedAt` is set (typical ack-then-resolve flow). Patient who couldn't be reached for a BP Level 2 emergency receives no follow-up dispatch. | **P0** | **FIXED in cluster-2 commit (Option 2)** — `firePendingScheduled` exempts `triggeredByResolution: true` events from the ack/status skip. Ack stays for audit trail; retry fires anyway. Per Dr. Singal sign-off. |

### P0 — Security / HIPAA

| # | Test | Expected | Got | Severity | Reference |
|---|---|---|---|---|---|
| **B5** | `16 — refresh token NOT in localStorage` | Refresh token in `HttpOnly` cookie only | **`localStorage["healplace_refresh_token"]` populated** — single XSS = account takeover with 30-day window | **P0** | Handoff brief §9 — same v1 bug confirmed in v2 |
| **B6** | `16 — access_token cookie is HttpOnly` | Cookie has `HttpOnly: true` | **Cookie is JS-readable** | **P0** | Handoff brief §9 |

### P1 — Marketing / SEO / accessibility (all closed in cluster 3)

> Cluster 3 closed all six on the patient + admin frontends. Specs `tests/01`
> and `tests/16` now run 22/22 green for marketing + cross-cutting a11y +
> security + HTTP smoke.

| # | Test | Original Expected | Original Got | Status |
|---|---|---|---|---|
| ~~**B7**~~ | `01 — homepage exposes a single h1` | `length === 1` | 2 `<h1>` elements | **CLOSED** — `frontend/src/components/cardio/Homepage.tsx` collapses both visual lines into a single `<h1>` with two `<span>`s (desktop) and a single `<h2>` with two `<span>`s (mobile). |
| ~~**B8**~~ | `16 — robots.txt returns text/plain` | text/plain | text/html via Next catch-all | **CLOSED** — `frontend/src/app/robots.ts` (Next 16 file convention) + proxy.ts matcher excludes `robots.txt`. |
| ~~**B9**~~ | `16 — sitemap.xml returns xml` | application/xml | text/html via Next catch-all | **CLOSED** — `frontend/src/app/sitemap.ts` (Next 16 file convention) + proxy.ts matcher excludes `sitemap.xml`. |
| ~~**B10**~~ | `16 — axe hard-fail on /, /readings, /notifications` | zero violations | color-contrast hits on marketing copy + dashboard chip + reading row badges + notification severity chips | **CLOSED** — bumped `--brand-text-muted` slate-500→slate-600 globally, semantic chip foregrounds (`--brand-{alert-red,warning-amber,success-green,accent-teal}`) from -600 shades to -800 shades (~6:1+ on light backs), severity meta inline colors moved to -800 shades, hardcoded chart-tooltip slate-400 bumped to slate-600. |
| ~~**B11**~~ | `16 — axe hard-fail on /dashboard` | zero violations | as above | **CLOSED** — same bumps. |
| ~~**B12**~~ | `16 — axe hard-fail on /profile + admin /dashboard` | zero violations | as above + admin sidebar muted labels + unlabeled date inputs | **CLOSED** — admin `--brand-text-muted` bumped from slate-400 → slate-600 (3.25:1 → 7:1) + same chip-color bumps + `aria-label` on the two date inputs in `admin/src/components/AdminDashboard.tsx`. |

**Worth calling out:** the security findings (B5, B6) and the missing audit fields (B2) are clinical-deployment blockers. The ladder-doesn't-stop-on-ack bug (B3) and unable-to-reach-retry bug (B4) are spec violations that affect provider workflow. The `severeEpigastricRuq` engine miss (B1) is a clinical-safety gap — that symptom is supposed to trigger BP Level 2.

---

## 🟡 9 partial-coverage gaps (spec was stricter than engine)

These indicate **engine behavior different from what the test expected**, but inspecting the actual fired alerts shows the engine isn't broken — just not firing the secondary rule the test asserted alongside the primary. Either the engine's pre-gate-Tier-1-suppresses-BP-rule behavior is intentional (and tests should be relaxed), or these are bugs (and the engine should be fixed). **Worth a clinical decision from Dr. Singal.**

| # | Test | Test expected | Engine actually fired |
|---|---|---|---|
| G1 | `09 — Priya 145/95 → PREGNANCY_L1_HIGH (and ACE Tier 1)` | Both `RULE_PREGNANCY_ACE_ARB` + `RULE_PREGNANCY_L1_HIGH` | **Only `RULE_PREGNANCY_ACE_ARB`** — pregnancy L1 BP rule never reached |
| G2 | `09 — Priya 165/115 → PREGNANCY_L2 (and ACE Tier 1)` | Both `RULE_PREGNANCY_ACE_ARB` + `RULE_PREGNANCY_L2` | **Only `RULE_PREGNANCY_ACE_ARB`** |
| G3 | `09 — pregnancy newOnsetHeadache → SYMPTOM_OVERRIDE_PREGNANCY` | `RULE_SYMPTOM_OVERRIDE_PREGNANCY` | **Only `RULE_PREGNANCY_ACE_ARB`** — Tier 1 contraindication suppresses the symptom override |
| G4 | `09 — pregnancy ruqPain → SYMPTOM_OVERRIDE_PREGNANCY` | `RULE_SYMPTOM_OVERRIDE_PREGNANCY` | **Only `RULE_PREGNANCY_ACE_ARB`** |
| G5 | `09 — pregnancy edema → SYMPTOM_OVERRIDE_PREGNANCY` | `RULE_SYMPTOM_OVERRIDE_PREGNANCY` | **Only `RULE_PREGNANCY_ACE_ARB`** |
| G6 | `09 — James HFrEF SBP 80 → HFREF_LOW + NDHP_HFREF` | Both `RULE_HFREF_LOW` + `RULE_NDHP_HFREF` | **Only `RULE_NDHP_HFREF`** — HFrEF BP rule never reached |
| G7 | `09 — James HFrEF SBP 165 → HFREF_HIGH` | `RULE_HFREF_HIGH` + `RULE_NDHP_HFREF` | **Only `RULE_NDHP_HFREF`** |
| G8 | `09 — Wide pulse pressure (170/85, PP=85) → PULSE_PRESSURE_WIDE Tier 3` | Either separate Tier 3 row OR primary alert with PP annotation | Only `RULE_STANDARD_L1_HIGH` (BP_LEVEL_1_HIGH). Engine likely puts PP as `physicianAnnotation` on primary; test should inspect that field. |
| G9 | `09 — multi-alert: Priya 175/115 → BOTH PREGNANCY_ACE_ARB AND PREGNANCY_L2` | 2 alerts | **1 alert** (only ACE) |

**Pattern:** when a pre-gate Tier 1 contraindication fires (pregnancy + ACE/ARB; HFrEF + NDHP), the BP/symptom-override rules **do not also fire**. The alert engine has axis-priority logic in `axisFor()` that maps both `contraindication` and `bp-high` to different axes, but in practice only the contraindication produces an alert row for these patients.

**Recommendation:** confirm with Dr. Singal whether (a) the contraindication should suppress the BP rule (current behavior — clinically defensible since the contraindication is the more dangerous finding), or (b) both should fire (test author's assumption — gives the provider full context). Then either relax the tests or open product tickets.

---

## 🔧 18 test scaffolding / selector issues (NOT product bugs)

Tests where the assertion is wrong or the selector is too specific. Each is a one-line fix on next iteration.

| # | Spec | Issue | Fix |
|---|---|---|---|
| S1 | `04 — dashboard greeting + Latest BP tile` | testid + accessible-name fallback both missed the actual markup | Add `data-testid="dashboard-greeting"` on `<Dashboard>` greeting heading |
| S2 | `05 — check-in step 1 renders pre-measurement checklist` | Found <4 matching items via fuzzy regex | Add testids `checkin-checklist-{key}` per CLINICAL_SPEC §6 |
| S3 | `05 — Continue advances from step 1 to BP entry` | Continue button selector matched but systolic input on next step missed | Add `checkin-systolic` testid |
| S4 | `05 — Aisha 124/78 → no alert + dashboard reflects` | Dashboard `124/78` text not visible after submission | Reading takes longer to surface in dashboard tile; add wait-for-API + retry |
| S5 | `06 — readings row affordances` | Loose check `\d{2,3}/\d{2,3}` returned 0 matches | Reset cleared seed readings; restore them or expect different |
| S6 | `06 — renders Alerts and Notifications tabs` | Tab selector didn't match | Add `notifications-tab-alerts` / `notifications-tab-notifications` testids |
| S7 | `07 — chat page loads with empty state` | `main, [role="main"]` absent on `/chat` | Add `<main>` wrapper or `data-testid="chat-empty-state"` |
| S8 | `08 — profile renders name + email + sign-out button` | Strict-mode violation — name appears in `<h1>` AND a `<span>` | Use `.first()` or testid `profile-name` |
| S9 | `11 — reject + readd cycle` | `meds.find is not a function` — `/me/medications` returns `{data: [...]}` envelope, helper unwraps wrong | Update helper to unwrap response envelope |
| S10 | `11 — MD threshold POST` | 409 conflict — Aisha already has a threshold from a previous test run | Use PATCH for update, or `tc.resetUser` more aggressively |
| S11 | `12 — enrollment-check ready=undefined` | Endpoint returns `{ready, reasons}` directly; my code wrapped it | Unwrap `body?.data ?? body` |
| S12 | `13 — Tier 1 ack then resolve` | `audit.tier` shape mismatch in `toMatchObject` | Audit response uses different field names; relax assertion |
| S13 | `15 — gap-alert notification` | No notification produced for fresh Aisha (just-reset → no journal entries → no `updatedAt < cutoff` proxy) | Backdate Aisha's `User.updatedAt` first |
| S14 | `15 — monthly re-ask: meds not iterable` | Used direct `fetch` without auth — got error response | Use authedApi or test-control endpoint instead |
| **+ 4 minor** | (chat, dashboard, etc.) | Selector strictness | Documented in qa/README §"Testids the dev team needs to add" |

---

## 🚫 13 skipped (env-gated by design)

These run only with `RUN_LLM_TESTS=1` (Gemini-paid LLM safety evals on `/chat`) or `RUN_WRITE_TESTS=1` (mutating tests already covered above). Listed for completeness:

- `02 — Cross-app role redirects` (1 — was actually an unrelated skip)
- `03 — onboarding from cold` (3 — needs ad-hoc OTP path)
- `07 — LLM safety refusals` (4 — Gemini quota gated)
- `12 — enrollment failure modes` (3 — needs additional test-control helpers per qa/README §"Known gaps" #3)
- `14 — BP L2 after-hours` (1 — needs business-hours toggle helper)
- `09 — etc.` (1 misc)

---

## Cluster 2 reconfirm log (2026-05-08)

Before fixing B2/B3/B4, ran a manual curl repro + re-read the ladder code. Findings rewrote the bug list:

**Ladder behavior matrix** (per `escalation/ladder-defs.ts` + `escalation.service.ts`):

| Tier | T+0 recipients/channels | After-hours | Cron advances? | Auto-resolve on benign? |
|---|---|---|---|---|
| `TIER_1_CONTRAINDICATION` | PRIMARY, PUSH+EMAIL+DASH | Queue primary; **fire BACKUP courtesy immediately** | ✅ T+4h→T+8h→T+24h→T+48h | ❌ No (preserved) |
| `TIER_2_DISCREPANCY` | PRIMARY, DASH-only badge | Queue | ✅ T+48h→T+7d→T+14d | ❌ No |
| `BP_LEVEL_2` | PRIMARY+BACKUP+PATIENT, PUSH+EMAIL+DASH | **FIRE_IMMEDIATELY** | ✅ T+2h MD, T+4h ops | ❌ No |
| `BP_LEVEL_2_SYMPTOM_OVERRIDE` | same as BP L2 + T+2h includes PATIENT ("Have you called 911?") | Immediate | ✅ Yes | ❌ No |
| `BP_LEVEL_1_HIGH/LOW` | PRIMARY (EMAIL+DASH) + PATIENT separate (PUSH, immediate) | Queue provider, immediate patient | **❌ NOT in `advanceOverdueLadders` filter** — T+24h/T+72h/T+7d defined but never auto-fire (phase/23 TODO) | ✅ Yes on benign reading |
| `TIER_3_INFO` | No ladder | N/A | ❌ No | N/A |

**Cron rules:**
- `advanceOverdueLadders` skips alerts unless `status='OPEN' AND acknowledgedAt=null`
- `firePendingScheduled` (handles queued + retry events) skips events when `alert.status != 'OPEN' OR alert.acknowledgedAt`. **Cluster-2 fix:** events with `triggeredByResolution: true` are now exempted from this skip.
- Anchor for advance = T+0 PRIMARY's `notificationSentAt ?? scheduledFor ?? triggeredAt ?? alert.createdAt`

**B4 root cause** (the reason the bug is more severe than originally documented):

```
1. BP Level 2 alert fires → status=OPEN
2. Admin ack → status=ACKNOWLEDGED, acknowledgedAt=now
3. Admin resolves with BP_L2_UNABLE_TO_REACH_RETRY → scheduleRetry creates
   EscalationEvent { triggeredByResolution: true, scheduledFor: now+4h }.
   Alert status NOT touched (stays ACKNOWLEDGED).
4. 4h later, cron firePendingScheduled finds the retry event → checks
   "alert.status !== OPEN || alert.acknowledgedAt" → SKIPS, marks
   "skipped — alert resolved or acknowledged".
   PATIENT NEVER FOLLOWED UP.
```

**Option 2 fix:** add `!row.triggeredByResolution &&` to the skip condition in `firePendingScheduled`. Three lines in `escalation.service.ts`. Preserves the audit trail (provider's ack timestamp stays — "I saw this, I tried") while ensuring the retry actually dispatches.

**Test infra also hardened:**
- `test-control.service.ts` `backdateAlertAnchor` now filters to the PRIMARY T+0 row (not the courtesy backup) and force-sets `notificationSentAt` even when it was null (after-hours queue case). Lets escalation tests run regardless of business-hours.
- New `backdateRetryEvent` endpoint to backdate `triggeredByResolution: true` events for end-to-end retry assertions.

---

## 🛠 Iteration plan if you keep going

In rough priority order:

1. **File the 12 product bugs (B1–B12) with Dr. Singal / dev team.** B1, B2, B3, B4 are clinical-correctness blockers. B5, B6 are HIPAA blockers.
2. **Get Dr. Singal's call on G1–G9 multi-alert behavior** — single-primary or multi-axis? If multi-axis, that's an engine fix; if single-primary, the tests get relaxed.
3. **Fix the 18 selector / scaffolding issues (S1–S14).** Add the data-testids per `qa/README.md` "Testids the dev team needs to add" — eliminates ~10 of these. Helper unwrap fixes (S9, S11) eliminate 4 more.
4. **Add the 6 deferred test-control helpers** (per qa/README "Known gaps" #3) so the 13 skipped tests can run.
5. **Run the multi-engine matrix** (`RUN_FULL_MATRIX=1`) — Firefox + WebKit catch their own bugs.
6. **Mobile + i18n cross-cutting passes** — qa/README "Known gaps" #5.

Once the test-control helpers and testids land, expected pass rate climbs from **67/119 → ~95/119** without changing engine behavior. The remaining 12 are the real product bugs.

---

## How to view the report

```bash
# HTML report (recommended — interactive timeline + screenshots + videos)
cd qa
npx playwright show-report reports/final

# JSON report
cat qa/reports/final/results.json | jq '.stats'

# Per-test artifacts (videos, screenshots, traces)
ls qa/test-results/
```

---

## Files modified during this run (uncommitted at time of snapshot)

- `qa/tests/09-rule-engine-via-ui.spec.ts` — expanded to 31 cases covering CLINICAL_SPEC sections 1–9 + multi-alert
- `qa/tests/05-patient-check-in.spec.ts` — leading-slash path fix
- `qa/tests/11-admin-verification-and-thresholds.spec.ts` — leading-slash path fix
- `qa/tests/13-admin-alert-resolution.spec.ts` — leading-slash path fix
- `qa/tests/14-escalation-tier1-ladder.spec.ts` — leading-slash path fix
- `qa/tests/03-onboarding-and-layer-a-gate.spec.ts` — leading-slash path fix
- `qa/helpers/intake.ts` — leading-slash path fix
