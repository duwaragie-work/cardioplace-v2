# Test Plan — Cardioplace v2

Canonical map of every testable surface in the system. One row per flow, priority-ranked by patient-safety risk. Every test we write — unit, integration, e2e, manual — cites a `TF-X.Y` ID from this doc so coverage is traceable.

- **Primary audience:** Dev 3 (backend infra + test infra owner), but Devs 1–2 check off their own flows
- **Canonical source of truth:** this file. If a requirement is missing here, it's not in scope.
- **Cross-reference:** clinical rules live in `CLINICAL_SPEC.md`; schema lives in `ARCHITECTURE.md`; phase ownership lives in `BUILD_PLAN.md`.

---

## Priority legend

| Priority | Definition | Failure impact |
|---|---|---|
| **P0** | Clinical safety | Wrong alerts / missed alerts / patients harmed |
| **P1** | Data integrity + auth | Audit fails, cross-tenant leak, bad data persists |
| **P2** | UX polish / cross-cutting | Admin annoyance, no clinical impact |

**Release gate:** no `main` merge while any P0 is red. P1 reds need Dev 3 sign-off. P2 reds ship with a tracking issue.

---

## Coverage-status legend

When filling the matrix, use these exact tokens in the Coverage column:

| Token | Meaning |
|---|---|
| `unit` | Jest service/pure-function test |
| `int` | Jest integration test (real Prisma, real DB, real controller) |
| `e2e` | Playwright end-to-end (real browser + real API) |
| `manual` | Documented in `QA_TESTING_GUIDE.md` checklist, run by human |
| `❌` | No coverage yet |

Multiple tokens separated by `+` (e.g. `unit + e2e`). Row is "covered" when at least one token is present **and** at the correct layer for the risk — P0 requires at minimum `int`, P1 requires `int` or `e2e`, P2 can be `manual`.

---

## How to use this doc

1. **Pick a flow** to work on. Create a branch `test/TF-X.Y-short-name`.
2. **Write the tests**, cite the TF-ID in every `describe` / `it` / Playwright title so `grep "TF-1.4"` finds them all.
3. **Update this file** — change the Coverage column for the rows your PR covers; set Status to ✅.
4. **Open a PR** that includes the doc update + the test code. Reviewer diffs the matrix to see what moved.
5. **Never weaken coverage** without explicit user sign-off (`unit + int` → `unit` alone is a regression).

---

## P0 — Clinical Safety

### TF-1. Alert Engine — Rule Evaluation
Every BP reading runs through this engine. Single highest-risk surface.

| ID | Scenario | Spec ref | Coverage | Status | Notes |
|---|---|---|---|---|---|
| TF-1.1 | Standard mode thresholds: BP L1 high (≥140/90), BP L1 low (<90/60), BP L2 (≥160/100) | CS §4.1 | ❌ | ⬜ | |
| TF-1.2 | Personalized mode uses PatientThreshold (SBP/DBP upper/lower) | CS §4.1b | ❌ | ⬜ | |
| TF-1.3 | Tier 1 medication-condition contraindications (every row in spec) | CS §5 | ❌ | ⬜ | Parameterize one test per row |
| TF-1.4 | Tier 2 discrepancy rules (non-adherence, missing prescription) | CS §5.2 | ❌ | ⬜ | |
| TF-1.5 | Tier 3 informational (pulse pressure, suboptimal measurement flag) | CS §5.3 | ❌ | ⬜ | |
| TF-1.6 | Boundary conditions: missing diastolic, ortho-static drops, decimals vs ints | CS §4.4 | ❌ | ⬜ | |
| TF-1.7 | Pregnancy / preeclampsia override thresholds | CS §4.6 | ❌ | ⬜ | |
| TF-1.8 | HFrEF SBP floor 85, HCM SBP floor 100, CAD DBP floor 70 as personalized defaults | CS §4.2 / §4.7 / §4.5 | ❌ | ⬜ | |
| TF-1.9 | Dedup: same `(journalEntryId, ruleId)` never creates two alerts | ARCH §alert-engine | ❌ | ⬜ | |
| TF-1.10 | Three-tier message generation — patient/caregiver/physician copy correctness | CS §7 | ❌ | ⬜ | Snapshot tests |

### TF-2. Escalation Ladder & Cron Dispatch

| ID | Scenario | Spec ref | Coverage | Status | Notes |
|---|---|---|---|---|---|
| TF-2.1 | T+0 fires immediately on alert creation | CS §6 | ❌ | ⬜ | |
| TF-2.2 | T+2H / T+4H / T+8H / T+24H / T+48H fire at correct offsets when OPEN | CS §6 | ❌ | ⬜ | Mock clock |
| TF-2.3 | Tier 2 ladder: T+48H / T+7d / T+14d | CS §6.2 | ❌ | ⬜ | |
| TF-2.4 | Acknowledgement stops escalation | CS §6.3 | ❌ | ⬜ | |
| TF-2.5 | Resolution stops escalation (all linked EscalationEvents cascade-resolve) | CS §6.3 | ❌ | ⬜ | |
| TF-2.6 | `BP_L2_UNABLE_TO_REACH_RETRY` writes new EscalationEvent with `scheduledFor=now+4h` + `triggeredByResolution=true` | CS §6.4 | ❌ | ⬜ | |
| TF-2.7 | `afterHours` flag flips per practice hours + timezone (DST tested) | CS §6.5 | ❌ | ⬜ | America/New_York + America/Phoenix |
| TF-2.8 | Recipient resolution per step (T+0 Primary, T+8h +Backup, T+24h +MD) | CS §6 | ❌ | ⬜ | |
| TF-2.9 | Idempotency — cron rerun never double-sends (@@unique constraint tested) | ARCH §notification | ❌ | ⬜ | |
| TF-2.10 | Patient with no assignment — alert still creates, escalation degrades gracefully | CS §6 | ❌ | ⬜ | |

### TF-3. Notification Dispatch

| ID | Scenario | Spec ref | Coverage | Status | Notes |
|---|---|---|---|---|---|
| TF-3.1 | Channel selection per recipient (Push / Email / Phone / Dashboard) | CS §6.6 | ❌ | ⬜ | |
| TF-3.2 | Unique constraint per `(alertId, escalationEventId, userId, channel)` | ARCH §notification | ❌ | ⬜ | |
| TF-3.3 | Correct three-tier message per recipient (patient copy to patient, physician copy to MD) | CS §7 | ❌ | ⬜ | |
| TF-3.4 | Read receipt tracking (`readAt` writes on dashboard view) | — | ❌ | ⬜ | |
| TF-3.5 | One channel failure doesn't kill others in the same dispatch | — | ❌ | ⬜ | |

### TF-4. Resolution Flow

| ID | Scenario | Spec ref | Coverage | Status | Notes |
|---|---|---|---|---|---|
| TF-4.1 | All 16 resolution actions accepted/rejected by tier validator | CS §8 | ❌ | ⬜ | |
| TF-4.2 | Rationale-required actions reject empty rationale | CS §8 | ❌ | ⬜ | |
| TF-4.3 | All `TIER1_*` actions require rationale (Joint Commission) | CS §8.1 | ❌ | ⬜ | |
| TF-4.4 | `BP_L2_UNABLE_TO_REACH_RETRY` keeps alert OPEN, others mark RESOLVED | CS §8.3 | ❌ | ⬜ | |
| TF-4.5 | Resolution writes `resolutionAction`, `resolutionRationale`, `resolvedBy`, `resolvedAt` | CS §8 | ❌ | ⬜ | |
| TF-4.6 | Linked EscalationEvents cascade-resolve on alert resolve | — | ❌ | ⬜ | |

---

## P1 — Data Integrity / Audit / Authorization

### TF-5. Authentication & Authorization

| ID | Scenario | Spec ref | Coverage | Status | Notes |
|---|---|---|---|---|---|
| TF-5.1 | Magic link signup + login | AUTH §2 | ❌ | ⬜ | |
| TF-5.2 | JWT issuance, refresh, expiry | AUTH §3 | ❌ | ⬜ | |
| TF-5.3 | Role gates per endpoint (PATIENT can't hit `/admin/*`; PROVIDER can't write thresholds) | AUTH §4 | ❌ | ⬜ | |
| TF-5.4 | Cross-tenant isolation (Provider A can't read Patient B if B not in their assignments) | AUTH §4 | ❌ | ⬜ | |
| TF-5.5 | Frontend `proxy.ts` route guards (Next 16 middleware) | — | ❌ | ⬜ | |
| TF-5.6 | SUPER_ADMIN lockdown (only `support@healplace.com`) | AUTH §5 | ❌ | ⬜ | |

### TF-6. Enrollment Gate

| ID | Scenario | Spec ref | Coverage | Status | Notes |
|---|---|---|---|---|---|
| TF-6.1 | All 4 reasons surface independently | ARCH §enrollment-gate | ❌ | ⬜ | |
| TF-6.2 | Reason combinations — all surfaced in `reasons[]` | — | ❌ | ⬜ | |
| TF-6.3 | HFrEF / HCM / DCM mandatory threshold enforcement | CS §4.2 / §4.7 / §4.8 | ❌ | ⬜ | |
| TF-6.4 | HFpEF threshold recommended-but-not-required (does NOT block) | CS §4.9 | ❌ | ⬜ | |
| TF-6.5 | Idempotent — completing an already-COMPLETED user returns 200, not 409 | — | ❌ | ⬜ | |
| TF-6.6 | 409 response shape includes `reasons[]` array (Flow K tooltip depends on it) | — | ❌ | ⬜ | |

### TF-7. Profile Verification Audit Trail

| ID | Scenario | Spec ref | Coverage | Status | Notes |
|---|---|---|---|---|---|
| TF-7.1 | Patient self-report writes PATIENT_REPORT log per changed field | — | ❌ | ⬜ | |
| TF-7.2 | Admin verify writes ADMIN_VERIFY + flips status to VERIFIED | — | ❌ | ⬜ | |
| TF-7.3 | Admin correct writes ADMIN_CORRECT per changed field + flips to CORRECTED | — | ❌ | ⬜ | |
| TF-7.4 | Admin reject (Flow K) writes ADMIN_REJECT + flips back to UNVERIFIED | — | ❌ | ⬜ | |
| TF-7.5 | Field-level diff (previousValue / newValue) preserved as JSON | — | ❌ | ⬜ | |
| TF-7.6 | Medication changes log under `medication:{uuid}.{field}` path format | — | ❌ | ⬜ | |

### TF-8. Threshold Management

| ID | Scenario | Spec ref | Coverage | Status | Notes |
|---|---|---|---|---|---|
| TF-8.1 | Validation: SBP 60–250, DBP 40–150, HR 30–220 | — | ❌ | ⬜ | |
| TF-8.2 | IANA timezone validation (Intl-based) | — | ❌ | ⬜ | |
| TF-8.3 | Setting threshold for HFrEF / HCM / DCM patient unblocks enrollment gate | — | ❌ | ⬜ | |
| TF-8.4 | Update preserves `setByProviderId`, `setAt` fields | — | ❌ | ⬜ | |
| TF-8.5 | Threshold drives personalized-mode alert engine | — | ❌ | ⬜ | |

### TF-9. Practice Configuration

| ID | Scenario | Spec ref | Coverage | Status | Notes |
|---|---|---|---|---|---|
| TF-9.1 | Create with default business hours (8am–6pm America/New_York) | — | ❌ | ⬜ | |
| TF-9.2 | Business hours start < end validation | — | ❌ | ⬜ | |
| TF-9.3 | IANA timezone validation | — | ❌ | ⬜ | |
| TF-9.4 | Patient + staff counts derived correctly (dedup across slots) | — | ❌ | ⬜ | |
| TF-9.5 | After-hours protocol stored (5000 char max) | — | ❌ | ⬜ | |

### TF-10. Care Team Assignment

| ID | Scenario | Spec ref | Coverage | Status | Notes |
|---|---|---|---|---|---|
| TF-10.1 | Primary / Backup slots accept PROVIDER or MEDICAL_DIRECTOR | — | ❌ | ⬜ | |
| TF-10.2 | Medical Director slot rejects non-MD users | — | ❌ | ⬜ | |
| TF-10.3 | One assignment per patient (@unique userId) | — | ❌ | ⬜ | |
| TF-10.4 | Practice change updates after-hours behavior + escalation recipients | — | ❌ | ⬜ | |
| TF-10.5 | Assignment populates `me/care-team` endpoint for patient view | — | ❌ | ⬜ | |

---

## P1 — Patient-Facing Flows

### TF-11. Patient Intake (Flows A–E)

| ID | Scenario | Coverage | Status | Notes |
|---|---|---|---|---|
| TF-11.1 | Multi-step wizard state preservation across browser refresh (draft persistence) | ❌ | ⬜ | |
| TF-11.2 | Profile submission writes PatientProfile + sets status UNVERIFIED | ❌ | ⬜ | |
| TF-11.3 | Medication card-based selection writes correct `drugClass` + `frequency` | ❌ | ⬜ | |
| TF-11.4 | Pregnancy gating (preg → due date required) | ❌ | ⬜ | |
| TF-11.5 | Edit-mode wizard (re-edit after first submission) | ❌ | ⬜ | |
| TF-11.6 | Pulse / symptoms / checklist on check-in | ❌ | ⬜ | |
| TF-11.7 | `me/profile`, `me/medications`, `me/care-team`, `me/threshold` self-serve endpoints | ❌ | ⬜ | |

### TF-12. Daily Journal Entry

| ID | Scenario | Coverage | Status | Notes |
|---|---|---|---|---|
| TF-12.1 | BP entry validation (positive, plausible range) | ❌ | ⬜ | |
| TF-12.2 | Save triggers alert engine | ❌ | ⬜ | |
| TF-12.3 | Symptoms trigger BP_L2_SYMPTOM_OVERRIDE rule | ❌ | ⬜ | |
| TF-12.4 | Medication-taken flag tracked | ❌ | ⬜ | |
| TF-12.5 | `measuredAt` vs `createdAt` distinction (allow back-dating) | ❌ | ⬜ | |

---

## P1 — Admin-Facing Flows

### TF-13. Admin Dashboard (Flow F)

| ID | Scenario | Coverage | Status | Notes |
|---|---|---|---|---|
| TF-13.1 | Layer 1: BP L2 emergency banners with pulsing animation | ❌ | ⬜ | |
| TF-13.2 | Layer 1: Tier 1 contraindication banners stack | ❌ | ⬜ | |
| TF-13.3 | Layer 1: Tier 2 collapsed numbered card expands inline | ❌ | ⬜ | |
| TF-13.4 | Layer 2 queue tier filter chips show correct counts | ❌ | ⬜ | |
| TF-13.5 | Layer 2 row click opens AlertPanel side panel | ❌ | ⬜ | |
| TF-13.6 | Layer 3 stat cards update live after resolve (no stale counts) | ❌ | ⬜ | |
| TF-13.7 | BP trend chart fetches per-patient data on row hover | ❌ | ⬜ | |

### TF-14. Admin Patient List (Flow K)

| ID | Scenario | Coverage | Status | Notes |
|---|---|---|---|---|
| TF-14.1 | Verification pill renders correct color per status | ❌ | ⬜ | |
| TF-14.2 | "Awaiting Verification" filter chip shows non-VERIFIED count | ❌ | ⬜ | |
| TF-14.3 | Alert badge tier-color matches highest-severity open alert | ❌ | ⬜ | |
| TF-14.4 | Alert tooltip breakdown of tier mix | ❌ | ⬜ | |
| TF-14.5 | Onboarding CTA disabled with 409-tooltip on gate failure | ❌ | ⬜ | |
| TF-14.6 | Onboarding CTA → "COMPLETED" pill on success | ❌ | ⬜ | |
| TF-14.7 | Search + risk + verification filters compose correctly | ❌ | ⬜ | |

### TF-15. Patient Detail (Flow H)

| ID | Scenario | Coverage | Status | Notes |
|---|---|---|---|---|
| TF-15.1 | Tab lazy-loading (data fetched on tab select) | ❌ | ⬜ | |
| TF-15.2 | ProfileTab confirm / correct / reject per field; "Verification complete" finalizes | ❌ | ⬜ | |
| TF-15.3 | MedicationsTab reconciliation, status badges (Matched/Discrepancy/Unverified/Discontinued/Rejected) | ❌ | ⬜ | |
| TF-15.4 | AlertsTab tier + status filters compose; expanded row shows three-tier messages + audit trail | ❌ | ⬜ | |
| TF-15.5 | ThresholdsTab condition-defaults Apply; mandatory red banner for HFrEF / HCM / DCM | ❌ | ⬜ | |
| TF-15.6 | CareTeamTab dropdowns populate from clinician pool; role validators enforced | ❌ | ⬜ | |
| TF-15.7 | TimelineTab merges logs + alerts chronologically; friendly field labels (no JSON dumps) | ❌ | ⬜ | |
| TF-15.8 | Cross-tab refresh: profile change → timeline updates without manual refresh | ❌ | ⬜ | |

### TF-16. Practice Configuration (Flow J)

| ID | Scenario | Coverage | Status | Notes |
|---|---|---|---|---|
| TF-16.1 | `/practices` index shows correct patient + staff counts | ❌ | ⬜ | |
| TF-16.2 | Add practice modal validates name, IANA tz, hours order | ❌ | ⬜ | |
| TF-16.3 | Detail page edit form persists all fields | ❌ | ⬜ | |
| TF-16.4 | Staff list deduplicates across slots; slot badges show all roles | ❌ | ⬜ | |
| TF-16.5 | Empty practice — "no staff" state | ❌ | ⬜ | |

### TF-17. Escalation Audit Trail (Flow I)

| ID | Scenario | Coverage | Status | Notes |
|---|---|---|---|---|
| TF-17.1 | Vertical timeline shows correct ladder per tier (BP/T1 vs Tier 2) | ❌ | ⬜ | |
| TF-17.2 | Step node colors match state (not-fired / fired / acked / resolved) | ❌ | ⬜ | |
| TF-17.3 | Per-event recipients + channels + after-hours flag rendered | ❌ | ⬜ | |
| TF-17.4 | Off-ladder events (BP_L2 retries) appear in extras | ❌ | ⬜ | |
| TF-17.5 | 15-field resolution audit footer shows all fields when RESOLVED | ❌ | ⬜ | |

### TF-18. Resolution Modals (Flow G)

| ID | Scenario | Coverage | Status | Notes |
|---|---|---|---|---|
| TF-18.1 | Tier 1 modal non-dismissable (X hidden, backdrop locked, Escape disabled) | ❌ | ⬜ | |
| TF-18.2 | Tier 2 + BP L2 modals close on backdrop / Escape / X | ❌ | ⬜ | |
| TF-18.3 | Action picker filters by tier (only valid actions shown) | ❌ | ⬜ | |
| TF-18.4 | Rationale textarea conditionally required matching catalog | ❌ | ⬜ | |
| TF-18.5 | `BP_L2_UNABLE_TO_REACH_RETRY` shows retry badge + button label flips to "Schedule retry" | ❌ | ⬜ | |
| TF-18.6 | Submit gates on action + rationale presence | ❌ | ⬜ | |

### TF-19. Scheduled Calls

| ID | Scenario | Coverage | Status | Notes |
|---|---|---|---|---|
| TF-19.1 | Provider schedules call with date/time/type/notes | ❌ | ⬜ | |
| TF-19.2 | Status transitions (scheduled → completed / missed / cancelled) | ❌ | ⬜ | |
| TF-19.3 | `/scheduled-calls` page filters by status correctly | ❌ | ⬜ | |
| TF-19.4 | Call linked to alert appears in alert detail | ❌ | ⬜ | |

---

## P2 — Cross-Cutting / Edge Cases

### TF-20. Multi-Practice Isolation

| ID | Scenario | Coverage | Status | Notes |
|---|---|---|---|---|
| TF-20.1 | Patient at Practice A — escalation never pages Practice B staff | ❌ | ⬜ | |
| TF-20.2 | SUPER_ADMIN sees everything; Provider sees only their assignments | ❌ | ⬜ | |

### TF-21. Time / Timezone

| ID | Scenario | Coverage | Status | Notes |
|---|---|---|---|---|
| TF-21.1 | DST transitions don't double-fire or skip escalations | ❌ | ⬜ | |
| TF-21.2 | Practice in `America/Phoenix` (no DST) vs `America/New_York` behave differently | ❌ | ⬜ | |

### TF-22. Concurrency

| ID | Scenario | Coverage | Status | Notes |
|---|---|---|---|---|
| TF-22.1 | Two admins resolve same alert simultaneously — only one wins | ❌ | ⬜ | |
| TF-22.2 | Patient submits BP while admin verifies — no race in profile status | ❌ | ⬜ | |

### TF-23. Data Lifecycle

| ID | Scenario | Coverage | Status | Notes |
|---|---|---|---|---|
| TF-23.1 | Patient deletion cascades (Profile, Medications, Alerts, Escalations, Notifications) | ❌ | ⬜ | |
| TF-23.2 | User soft-disable (instead of delete) for audit retention | ❌ | ⬜ | |

---

## Rollup dashboard

Update this table at the end of every PR that changes coverage. Keeps leadership / Dr. Singal aligned without reading the whole doc.

| Group | Priority | Total | Covered | ❌ Missing | % |
|---|---|---|---|---|---|
| TF-1 Alert Engine | P0 | 10 | 0 | 10 | 0% |
| TF-2 Escalation | P0 | 10 | 0 | 10 | 0% |
| TF-3 Notifications | P0 | 5 | 0 | 5 | 0% |
| TF-4 Resolution | P0 | 6 | 0 | 6 | 0% |
| **P0 subtotal** | — | **31** | **0** | **31** | **0%** |
| TF-5 Auth | P1 | 6 | 0 | 6 | 0% |
| TF-6 Enrollment Gate | P1 | 6 | 0 | 6 | 0% |
| TF-7 Verification Audit | P1 | 6 | 0 | 6 | 0% |
| TF-8 Thresholds | P1 | 5 | 0 | 5 | 0% |
| TF-9 Practice Config | P1 | 5 | 0 | 5 | 0% |
| TF-10 Care Team | P1 | 5 | 0 | 5 | 0% |
| TF-11 Patient Intake | P1 | 7 | 0 | 7 | 0% |
| TF-12 Journal Entry | P1 | 5 | 0 | 5 | 0% |
| TF-13 Admin Dashboard | P1 | 7 | 0 | 7 | 0% |
| TF-14 Patient List | P1 | 7 | 0 | 7 | 0% |
| TF-15 Patient Detail | P1 | 8 | 0 | 8 | 0% |
| TF-16 Practice Flow | P1 | 5 | 0 | 5 | 0% |
| TF-17 Escalation Audit | P1 | 5 | 0 | 5 | 0% |
| TF-18 Resolution Modals | P1 | 6 | 0 | 6 | 0% |
| TF-19 Scheduled Calls | P1 | 4 | 0 | 4 | 0% |
| **P1 subtotal** | — | **87** | **0** | **87** | **0%** |
| TF-20 Isolation | P2 | 2 | 0 | 2 | 0% |
| TF-21 Timezone | P2 | 2 | 0 | 2 | 0% |
| TF-22 Concurrency | P2 | 2 | 0 | 2 | 0% |
| TF-23 Lifecycle | P2 | 2 | 0 | 2 | 0% |
| **P2 subtotal** | — | **8** | **0** | **8** | **0%** |
| **TOTAL** | — | **126** | **0** | **126** | **0%** |

---

## Execution order (recommended)

Tackle in this order so each round delivers max safety per hour of effort:

1. **Round 1 — P0 alert engine + resolution** (TF-1, TF-4). This is the core clinical-decision code. Start with `int` tests against a real DB so boundary conditions are exercised for real.
2. **Round 2 — P0 escalation + notifications** (TF-2, TF-3). Mock-clock the cron, real DB for idempotency.
3. **Round 3 — P1 authorization + enrollment gate** (TF-5, TF-6). Protects against data leaks + regulatory fails.
4. **Round 4 — P1 audit trails + threshold** (TF-7, TF-8). Required for Joint Commission compliance.
5. **Round 5 — P1 admin + patient UI** (TF-11 → TF-19) via Playwright. One e2e suite per Flow F–K.
6. **Round 6 — P2 cross-cutting** (TF-20 → TF-23). Hardening pass before launch.

---

## Open questions

Track here until resolved, then delete:

- [ ] Should we standardize on Playwright or Vitest-Browser for e2e? (Dev 3 to decide wk of 2026-04-28.)
- [ ] DB fixture strategy — per-test truncate, or transactional rollback? Transactional is faster but Prisma's `$transaction` doesn't always play nice with nested transactions in production code paths.
- [ ] LLM judge tests for the three-tier message generation (TF-1.10) — we have `test/llm-judge/` already for voice; extend it, or keep snapshot-only?
