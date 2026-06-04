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

**G.1 — `Notification.create` call sites (non-spec):** alert-engine `:1076` (CAD threshold-ramp → **provider** DASHBOARD notice, `userId=providerId`, idempotent, CAD-only — NOT a patient mirror); escalation `:1072` (caregiver DASHBOARD inbox); crons gap-alert / med-hold-escalation / monthly-reask (patient **system actions**); intake ×4 (profile correction / med-hold / condition-review — patient **system actions**); threshold `:214` (threshold-update notice — system action); provider ×2 (provider actions); test-control (seeding). **No patient-facing alert-fire mirror remains.**

**G.3 — prior work:** the mirror was **already stripped** — `de7b543` ("strip patient bell mirror across all clinical-alert paths", F12) and `d9e52dd` ("patient inbox carries care-team actions only; clinical alerts no longer mirror", Round 2 Group B, removed 63 lines from alert-engine + 28 from escalation), plus `e6eaa4d` (F16 hold dedupe), `1f7effe` (rule-aware bucket label), H3 #80 (EMAIL-channel bell filter). Frontend `/notifications` is a **two-top-tab split (Alerts | Notifications)**: clinical alerts render in the **Alerts** sub-tab (`PatientAlertCard`), `Notification` rows in the **Notifications** sub-tab.

**G.2 — AlertTier × notification-on-fire matrix (current state):**
| AlertTier | Sample rule | Creates patient Notification on FIRE? | What we want |
|---|---|---|---|
| TIER_1_ANGIOEDEMA | RULE_ACE_ANGIOEDEMA | **No** (stripped d9e52dd; `persistAlert` makes DeviationAlert only) | No ✓ already |
| BP_LEVEL_2 | RULE_ABSOLUTE_EMERGENCY | **No** | No ✓ |
| BP_LEVEL_2_SYMPTOM_OVERRIDE | RULE_SYMPTOM_OVERRIDE_GENERAL | **No** | No ✓ |
| TIER_1_CONTRAINDICATION | RULE_PREGNANCY_ACE_ARB | **No** | No ✓ |
| BP_LEVEL_1_HIGH | RULE_STANDARD_L1_HIGH | **No** | No ✓ |
| BP_LEVEL_1_LOW | RULE_STANDARD_L1_LOW | **No** | No ✓ |
| TIER_3_INFO | RULE_PULSE_PRESSURE_WIDE | **No** (physician-only; patient/caregiver msgs empty) | not patient-facing ✓ |
| TIER_2_DISCREPANCY | RULE_MEDICATION_MISSED | **No** | No ✓ |

**G.2 conclusion:** the alert-FIRE path already matches the desired end-state — **no tier mirrors a clinical alert into a patient Notification row.** The residual "still mirroring" perception is most likely (a) the **Alerts** sub-tab on the same `/notifications` route (correct — clinical alerts SHOULD be patient-visible there), (b) escalation-event notifications (anti-scope: STAY), or (c) stale seeded notification rows (`13234dc` seeded 27). **HELD** pending Duwaragie's confirmation of the matrix + clarification of which surface the residual was observed on, before any G.4/G.5 work (which may be a no-op strip, or the optional G.4-path-2 system-action emissions — e.g. wiring the H4 `systemMsgProfileFieldCorrected` emission left as backlog).
