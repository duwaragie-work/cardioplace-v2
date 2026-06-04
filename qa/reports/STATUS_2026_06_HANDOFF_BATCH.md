# STATUS — 2026-06 Handoff Batch (Regression Net Rebuild, Handoff 5)

**Branch:** `duwaragie-round2-fixes` · **LAST_GREEN:** `55e93fb` (2026-05-21, last `qa/reports/` update) · **Window:** 48 unique commits on dev∪main since LAST_GREEN.

**Scope (Path A, confirmed 2026-06-04):** H5 covers the IN-BRANCH window — H1–H4 baseline + W1–W10 (Duwaragie's 05-22 threshold/verification/med-hold batch + Lakshitha's Reading-model). **Deferred to Handoff 6** (on dev/main but NOT in this branch — can't test code not in the tree): X1 COORDINATOR role + invite/activation + migration, X2 privacy-trust/consent, X3 magic-link fix, X4 low-literacy icons, X5 admin sidebar/chart, X6 demo video, X7 styling sweeps.

**Attribution note:** No Niva/Nivakaran commits in the window (confirmed by author+email enumeration + content grep + merge-commit inspection). Cluster 8 / Gap5 / B1-B5 landed **pre-LAST_GREEN (2026-05-20 < 05-21)** — already in the green baseline, not the catch-up window.

## Status legend
✅ verified green this turn (backend tsc + jest) · 🟡 authored, pending live Playwright run (Duwaragie's seeded 3-server stack — cloud DB here can't host it) · ⚪ no test needed · 🔎 Wave G investigation (held)

## Wave outcomes
| Wave | Outcome | Commit |
|---|---|---|
| A — snapshot roll | Snapshots already current (rolled in H4 `0babc1b`); `--updateSnapshot` produced **zero diff**; 324 snapshots pass. No new commit. | — (H4 `0babc1b`) |
| B — engine units | H1–H4 + W4/W5 locks **already existed** (verified). Only genuine gap was **W9 journal-limits** → 8 new tests. | `704d425` |
| C — Playwright | C.1 no-op (Q7 rename uses stable testIds; changed copy not asserted by existing specs). C.2 new H4 copy smoke (3 tests, compiles + lists). | `fe6743b` |
| D — fixtures | `historyPreeclampsia` rename already complete (H2 `90f3870`; only migration-SQL history retains the old name, correctly). Added HDP-only (not-pregnant) persona. | `0ff4036` |
| E — CI audit | e2e.yml **already memory-compliant** (Playwright on PR→dev/main; `CI:true` reporter marker; `npm run build`+compiled start; `migrate deploy`+`generate`; `build:shared` first). No repair. **Finding surfaced:** backend unit gate (`llm-tests.yml`) doesn't trigger on PR→dev (only push:phase/* + PR:main); adding `dev` would also pull in costly LLM-judge jobs — surfaced for decision. | — (no repair) |
| F — STATUS doc | This file. | (this commit) |
| G — notification tab | Investigation-first; G.2 matrix below; **held** for confirmation before any patch. | 🔎 held |

## Ledger — H1–H4 baseline
| Handoff | Item | Code commit | Test | Status |
|---|---|---|---|---|
| 1 | Q2 HFREF_HIGH single-reading firing | 5debd2c | unit (alert-engine.service.spec ×8) | ✅ |
| 1 | #82 F9 immutability | d9ea2ae | unit (shipped) | ✅ |
| 1 | #84 ACE/ARB retro-upgrade | d4b661d | unit (ace-contraindication.spec ×13) | ✅ |
| 2 | Q1 first-month nudge wording | 807751a | snapshot lock | ✅ |
| 2 | Q5 axis-specific Stage 2 | 807751a | unit + snapshot (Q5 describe block) | ✅ |
| 2 | #83 single-reading suffix scope | be5b260 | snapshot + #83 describe block | ✅ |
| 2 | #93 β-blocker sentence | be5b260 | rules.spec + snapshot | ✅ |
| 2 | Q7 historyHDP rename | 90f3870 | migration history + stable testIds | ✅ / 🟡 e2e |
| 2 | Q3 personalization comment | e959bcb | n/a (comment only) | ⚪ |
| 3 | #79–#94 base + addendum | c753a04 (squash) | mixed (snapshot/unit shipped) | ✅ / 🟡 e2e |
| 4 | Document 1 + 2 copy (26 rules×3 + fragments) | 962a5ac (squash) | 146 snapshots + 8 verbatim locks | ✅ |
| 4 | caregiver SMS gate (Decision 2) | 1027152 | gate test (suppressed-default + flag-on) | ✅ |
| 4 | A1/A2/A3/A5/A7/A9 + caregivers i18n | 962a5ac | — | 🟡 e2e (smoke `fe6743b`) |
| post-H4 | caregiver checkbox sizing + es/fr/de/am translations | a094631 | — | 🟡 e2e |

## Ledger — W1–W10 (in-branch window, NEW coverage)
| # | Change | Author | Code commit(s) | Test shipped w/ code? | H5 test | Status |
|---|---|---|---|---|---|---|
| W1 | Threshold clear/delete + enrollment-revert cascade + patient-notify (THR-032/3/4) | Duw | 2ae5dde, 87f8a06, a3aedcd, a0668e6, 1970db4, 1046112 | partial (bb3b7fb, 664206f) | existing e2e (31) | ✅ unit / 🟡 e2e |
| W2 | Per-field profile verification + reject-gate + re-check + real actor role | Duw | 8817eab, 0aafd2b, 376b88e, 9e887b3, 3ea9d5e, 1c5189a | partial (d700d9a, a9cc61b, 1fdd6b2) | existing e2e | ✅ unit / 🟡 e2e |
| W3 | Med hold/reject/re-add + canonical match + patient inbox notice | Duw | 042a45c, 4b2ef8f, e1ba3af, 134a055, fdd9c38 | NO | existing e2e (28/29) | 🟡 e2e |
| W4 | Adherence: exclude HOLD meds from miss count | Duw | 536d7e0 | **YES** (adherence-window.spec +92) | — | ✅ |
| W5 | Engine: exclude unreviewed voice/photo meds | Duw | eeb6b08 | **YES** (profile-resolver.spec +37) | — | ✅ |
| W6 | Auth: JWT cookie scoped by origin | Duw | f1cf1d7 | NO | existing auth e2e (02) | 🟡 e2e |
| W7 | Backend build: exclude prisma from nest tsconfig | Duw | 50699a7 | NO | Wave E (CI build green) | ✅ (CI) |
| W8 | Seed + role-scope alignment | Duw | ec9c5ae, 4a539ac, ca81e5e | partial | existing role-scope (30r/30s) | 🟡 e2e |
| W9 | Reading new model + custom-symptom input + journal-limits | Lak | c51264a | NO | **`704d425`** (8 DTO/limit tests) + migration verify | ✅ unit / 🟡 migration+e2e |
| W10 | Frontend bug sweeps (intake/checkin/readings/dashboard/profile) | Lak | 16f9e2e, d9f0213, 791bb83, 1cba18b | NO | affected pages already covered by existing specs (01/04/05/06/08/20b/20e) | 🟡 e2e |
| W10 | Viewport meta only | Lak | 0faa94c | NO | pure meta — no behavior | ⚪ |

## Wave G — notification-tab investigation (G.1 / G.2 / G.3) — HELD before patch

**Corrected scope (Duwaragie 2026-06-04):** the mirror is on the **escalation T+0 dispatch** path, not the alert-fire path. Dispatch TO PROVIDERS stays; dispatch TO PATIENT on a bell-visible channel must not land in the Notifications tab. Patient still sees the alert in the Alerts tab + dashboard banner.

**G.1 — fire path (confirmed clean):** `persistAlert` writes a DeviationAlert only — no patient Notification. alert-engine `:1076` is a **provider** CAD-ramp notice. So the FIRE path does not mirror.

**G.1 — escalation T+0 path (the real mirror):** `writeNotificationsAndEmit` (escalation.service.ts ~815) fans out one `Notification` row per (recipient × channel) for the step's `channels`. The patient is a **T+0 recipient** for the emergency-class ladders (per the F12 comment + ladder-defs.spec): `BP_LEVEL_2`, `BP_LEVEL_2_SYMPTOM_OVERRIDE`, `TIER_1_ANGIOEDEMA` (and the retired BP_LEVEL_1 patient row). T+0 `channels` include `PUSH`, `EMAIL`, `DASHBOARD`.
- **Line 852 already skips `PATIENT + DASHBOARD`** (F12) → so DASHBOARD is NOT the leak (Duwaragie's proposed G.4 target is already a no-op).
- **`PUSH` and `EMAIL` rows ARE written** for the patient (line 856).
- `getNotifications` (daily_journal.service.ts:591) filters **`channel != 'EMAIL'`** → EMAIL is hidden from the tab (#80), but **`PUSH` is NOT** → **the patient's T+0 PUSH Notification row is what appears in the Notifications tab.** This is the mirror (Aisha 185/125 → BP_LEVEL_2 → patient PUSH row).
- **There is NO real push service** (no web-push/FCM/APNs/PushService in the codebase) — `channel:'PUSH'` is *only* a Notification row that the in-app bell renders. So "PUSH still reaches the patient out-of-app" is not currently true; the PUSH row **is** the in-app tab entry.

**G.3 — prior work:** `de7b543` (F12 — strip fire-path bell mirror), `d9e52dd` (Round 2 Group B — inbox = care-team actions only; −63 alert-engine/−28 escalation), `e6eaa4d` (F16 hold dedupe), `1f7effe` (rule-aware bucket), H3 `#80` (EMAIL-channel tab/bell filter). Frontend `/notifications` = two-top-tab split (Alerts | Notifications). **F12/#80 covered fire-path + DASHBOARD + EMAIL, but not the patient T+0 PUSH row.**

**G.2 — AlertTier × T+0 patient dispatch matrix (corrected):**
| AlertTier | Sample rule | Patient a T+0 recipient? | Channels patient gets | Patient PUSH row in Notifications tab today? | What we want |
|---|---|---|---|---|---|
| TIER_1_ANGIOEDEMA | RULE_ACE_ANGIOEDEMA | **Yes** (ANGIOEDEMA_PATIENT_T0) | PUSH (+EMAIL) | **YES — mirror** | Alerts tab only |
| BP_LEVEL_2 | RULE_ABSOLUTE_EMERGENCY | **Yes** | PUSH, EMAIL, DASHBOARD | **YES — mirror** | Alerts tab only |
| BP_LEVEL_2_SYMPTOM_OVERRIDE | RULE_SYMPTOM_OVERRIDE_GENERAL | **Yes** (T+0 and T+2H) | PUSH, EMAIL, DASHBOARD | **YES — mirror** | Alerts tab only |
| TIER_1_CONTRAINDICATION | RULE_PREGNANCY_ACE_ARB | No | — | No | No |
| BP_LEVEL_1_HIGH | RULE_STANDARD_L1_HIGH | No (patient row retired) | — | No | No |
| BP_LEVEL_1_LOW | RULE_STANDARD_L1_LOW | No | — | No | No |
| TIER_3_INFO | RULE_PULSE_PRESSURE_WIDE | No (physician-only) | — | No | No |
| TIER_2_DISCREPANCY | RULE_MEDICATION_MISSED | No | — | No | No |

**G.2 conclusion:** exactly the 3 emergency-class tiers where the patient is a T+0 PUSH recipient mirror into the Notifications tab — matching the "higher-tier mirrors, lower-tier doesn't" observation. The EscalationEvent audit row ("T+0 · Primary + backup + PATIENT · Push+Email+Dashboard") is separate and unaffected by any Notification-row change.

**G.4 decision needed (the implementation surface differs from the original instruction — surfacing, NOT patching):** suppressing only DASHBOARD = no-op (already done). To actually stop the tab mirror, two channel-aware options (both keep the EscalationEvent audit + Alerts tab + provider rows):
- **Option A — query filter (best match to Duwaragie's "mirror #80 / keep PUSH" intent):** extend `getNotifications` + unread-count to also exclude **alert-linked PATIENT PUSH rows** (`alertId != null AND channel = 'PUSH'`). Keeps the row in the DB as the hook for a future real push service; hides it from the in-app tab. Pure read-side, mirrors #80.
- **Option B — suppress the write:** extend line 852 guard to skip `PATIENT + ('DASHBOARD'|'PUSH')`. Drops the row entirely (no loss today since no push service exists). Closer to F12.

Recommend **Option A** (read-side, reversible, preserves the future-push hook, mirrors the #80 pattern Duwaragie cited). **HELD** for Duwaragie to confirm the corrected matrix + pick Option A vs B before G.4/G.5.

## Wave G.4 / G.5 — patch + tests (Option A, read-side filter)

| Item | Code commit | Test | Test commit | Status |
|---|---|---|---|---|
| G.4 — exclude alert-linked PATIENT PUSH rows from bell list + unread count (read-side; #80 pattern) | `35ade09` | unit (query-construction lock) + unit (email-path-intact) + e2e | `35ade09` / G.5 | ✅ unit / 🟡 e2e (see stack note) |

- **G.4** (`35ade09`): shared `BELL_VISIBLE_NOTIFICATION_FILTER` predicate used by BOTH `getNotifications` + `getNotificationsUnreadCount`. Excludes EMAIL (#80) **and** `{alertId != null AND channel='PUSH'}` (H5 G.4). **Read-side only** — `Notification.create` (escalation.service.ts:856-867) and `emailService.sendEmail` (:892) untouched; no schema migration. System-action PUSH rows (`alertId` null) stay visible.
- **G.5 units** (backend, +4 tests): `daily_journal.service.spec` — getNotifications + unread-count both apply the exclusion predicate (query-construction lock) + scoping note (alertId-null PUSH stays); `escalation.service.spec` — **email-path regression lock**: BP_LEVEL_2 T+0 still WRITES the patient PUSH + EMAIL Notification rows and still calls `emailService.sendEmail` (proves the read filter never suppresses the actual send).
- **G.5 e2e** (`22-notifications-no-alert-mirror.spec.ts`): fires real 185/125 → BP_LEVEL_2, confirms the alert-linked patient PUSH row exists in DB (write intact), asserts the patient notifications API + Notifications tab exclude it while the Alerts tab shows the alert.

### Verification battery (this turn)
- backend `tsc --noEmit -p tsconfig.build.json` — clean
- backend `jest` — **1290 passed / 62 suites** (was 1278 at H4; +8 W9 + 4 G.5)
- admin `tsc --noEmit` — clean · frontend `tsc --noEmit` — clean

### Playwright run — stack note (surfaced)
The running localhost stack is **mixed across two clones** (confirmed via OS process inspection): frontend `:3000` = `cardioplace-v2` (this branch), **backend `:4000` + admin `:3001` = a separate `_niva_audit` clone**. So the live backend does **not** contain G.4. Smoke run (`--reporter=list`, 11 tests): **10 passed**; the 1 "failure" is the new `22-notifications-no-alert-mirror` spec **correctly detecting the un-patched mirror** on the `_niva_audit` backend (the alert-linked PUSH row was returned) — i.e. the guard works. Not a fix defect (the unit tests prove the predicate). NOT restarted the user's separate-clone backend (cross-tree + unapplied-migration drift vs the shared cloud DB). The e2e goes green once a `cardioplace-v2` backend with G.4 serves `:4000`. Full suite deferred per the "smoke green → full suite" gate (smoke blocked by the cross-clone backend, not by the change).

## Wave C — completed (Category 1 test-debt, authorized 2026-06-04)

| Cluster | Spec(s) | Root cause | Fix | Commit |
|---|---|---|---|---|
| G.4 — alerts not in bell | `06` 20h.2 + 20h.3 | NOT G.4-mirror (those use seedAlerts→Alerts tab). Stale testIds: `PatientAlertCard` exposes `notification-row-ack-{id}` / `notification-row-detail-{id}`, specs used old `notification-dismiss-button-`/`notification-link-`. | Rename testIds + add defensive "not in Notifications sub-tab" assertion. | `06` commit |
| W10 TZ casing | `06` group-header | Readings restyle made the weekday header UPPERCASE; assertion was case-sensitive. | Case-insensitive weekday compare. | `06` commit |
| H4 wording | `19` A.5 | Manisha Doc 2 superseded the Cluster-7 HCM_LOW "under-perfusion" wording. | Assert the Doc-2 hydration/slow-stand phrase. | `19` commit |
| #91 sessionId | `05a` | #91 made an expired sessionId mint a fresh UUID (never null); spec asserted null. | Assert non-null fresh UUID ≠ expired id. | `05a` commit |

Targeted re-run (`05a` + `06` + `19`): **22 passed, 1 failed** — the 1 is `19 A.7` (below, intentionally not touched).

### NOT fixed — surfaced (NOT Category-1 wording; out of authorized scope)
- **`19` A.7 — HOLD endpoint contract change:** `400 "A hold reason is required to place a medication on hold"`. The verify-medication HOLD endpoint now requires a `reason` (likely W3 med-hold work). Fix = pass a hold reason in the request; it's a contract change, not wording — left for confirmation.
- **`09` (6) + `17` (4) — engine rule-firing BEHAVIOR, not copy:** specs assert co-fire / single-reading outcomes that no longer match (e.g. `17 Q2`: single reading fired `BP_LEVEL_1_HIGH` instead of being HELD; `17 brady`: brady HR rule didn't co-fire; `09 Mike/James/Kate`: symptom-override fired without the expected BP-axis co-fire; `09 Olive`: AGE_65_LOW + loop-diuretic preemption). These assert WHICH RULES fire — editing them blind could mask a regression. Ambiguous root cause (cross-clone `_niva_audit` engine vs real change). **Defer to the Phase-3 clean-stack re-run to disambiguate; do not edit literals.**
- **`05` (2) check-in step-1 testId timeout:** 12s timeout finding the pre-measurement-checklist step; likely W10 CheckIn restructure or flake (passed/failed inconsistently). Not wording. Defer to clean re-run.

### Wave C — `19 A.7` HOLD-contract fix (authorized follow-up)
H3 #92 (`d897040`) tightened the verify-medication HOLD endpoint to require a structured `holdReason` (Manisha §3 codes) AND renamed the patient notice: a `PROVIDER_DIRECTED_HOLD` now dispatches title **"Please pause a medication"** with a drug-naming "…pause {drug}…" body (no longer "Medication on hold"/"hold"). Spec updated to pass `holdReason: 'PROVIDER_DIRECTED_HOLD'` and match the new title/body. **`19` now fully green (9/9).** Commit: `19 A.7`.

## Phase 3 validation (clean-ish stack: _niva_audit@29f59b4 + reseed)
- **Step 1 health:** backend/frontend/admin all 200.
- **Step 2 — Category-1 fixes still green post-reseed:** ✅ 23/23 (05a 7/7, 06 incl 20h.1/2/3, 19 9/9 incl A.5 + A.7).
- **Step 3 — re-seed hypothesis PARTIALLY confirmed:**
  - ✅ **FIXED by reseed:** `17` Q2 single-reading (3) + `05` check-in (2) — were seed/state pollution.
  - ❌ **Still failing (7) — investigated, NOT patched, NOT regressions:**
    - **F20 emergency-exclusive (4):** `09:1029` (Mike HFpEF+headache), `09:1053` (James HFrEF+chestPain), `09:1104` (Kate HCM+visualChanges), `17:592` (brady+AMS). Root cause = **`bf838ff` "fix(engine): emergency-exclusive short-circuit prevents cofire with lower-tier (F20)"** — an INTENTIONAL window change making an emergency/symptom-override exclusive (no lower-tier co-fire). These specs assert the *pre-F20* co-fire. **Test-debt from a deliberate behavior change, not a regression.** Fix = update the specs to expect emergency-exclusive (only the override fires). Held for decision.
    - **Olive persona/seed drift (3):** `09:563/585/602` — `r.fired = []` (nothing fires) for Olive at SBP 88/91/95. `09:957` "Jane (65+) SBP 95 → AGE_65_LOW" **passes** on an identical single reading → **Olive-persona-specific**, not engine. Candidate: Olive's reseeded DOB no longer resolves to 65+, or her loop/profile differs. Needs persona inspection (seed), not an engine fix.
- **Steps 4 (admin) + 5 (full):** NOT run — halted at Step 3 per the "if Step 3 still fails, STOP" directive. Held for Duwaragie.

**No real engine regression found.** The 7 remaining Step-3 failures are (a) stale specs from the intentional F20 emergency-exclusive change and (b) Olive seed drift.

## Phase 3 — investigate-and-fix the 7 remaining Step-3 failures (authorized)

### Part 1 — F20 emergency-exclusive (4 specs) → FIXED (Path A)
`bf838ff` "fix(engine): emergency-exclusive short-circuit (F20)" (Duwaragie, 2026-06-01, shipped WITH spec updates, cites v2 addendum D.5) is INTENTIONAL and clinically sound: once an emergency/symptom-override claims the 'emergency' axis, lower-tier Stage-C BP/HR rules are suppressed (a "see provider tomorrow" L1 alongside a "call 911" emergency is the harm path). **Safety verified:** Stage A/B survive the short-circuit — Tier 1 contraindication (NDHP_HFREF co-fired in James's case), angioedema, and the emergency itself. HFREF_HIGH fires normally absent an emergency (`09:292` green) and is only subsumed when a co-occurring emergency already conveys the BP — not a Q2 violation. No engine carve-out needed. Updated 4 specs (09 Mike/James/Kate + 17:592) to expect emergency-exclusive (`exclusive: true`). Commit: `test(qa): update F20-affected specs`.

### Part 2 — Olive (3 specs) → FIXED (Path B, seed/DB drift hygiene)
Root cause via DB query: Olive's profile had **`hasAFib=true` + `hasCAD=true`** (and `diagnosedHypertension=false`) — but her seed persona sets NONE of those (only `diagnosedHypertension: true`). The spurious `hasAFib=true` tripped the **AFib `<3-reading` gate** (alert-engine.service.ts:597), suppressing EVERY single-reading BP/HR rule incl. AGE_65_LOW → `r.fired=[]`. Jane (65+, clean flags) fires AGE_65_LOW on an identical reading — confirming it's Olive-DB-specific, not engine/spec. Seed persona is correct; the reseed didn't reset the drifted flags (create-only upsert and/or prior-test pollution). Fixed in-spec: a `beforeAll` resets Olive's AFib/CAD/htn to her seed baseline (a condition-specific test must own its preconditions). Commit: `test(qa): 09 Olive — reset AFib/CAD baseline`.
**Seed-hygiene note for Duwaragie:** the reseed left Olive's profile flags drifted (hasAFib/hasCAD true, diagnosedHypertension false vs seed). Worth checking whether the seed upsert overwrites existing PatientProfile condition flags, or whether a prior test mutates Olive without reset — otherwise other personas may carry similar drift. (Not blocking H5; surfaced.)

All 7 previously-failing Step-3 specs now green. Proceeding to Phase-3 Steps 4 (admin) + 5 (full suite).
