# Cardioplace v2 — Playwright E2E Run Results

**Run date:** 2026-05-15 (A1 small-bugs + B4 translation-pipeline cycle, on top of Cluster 6/7)
**Branch:** `duwaragie-dev` (12 commits ahead of `origin/dev`) → PR `duwaragie-dev → dev`
**Engine:** chromium-desktop (1440×900)
**Stack tested:** local (NestJS `:4000`, Next 16 patient `:3000`, Next 16 admin `:3001`) + CI (GitHub Actions, sharded, fresh DB per shard). Local DB is the shared remote `db.prisma.io` (seed pollution applies).
**Seed:** 5 base patients (Priya / James / Rita / Charles / Aisha) + 6 admins, perma-OTP `666666`. Cluster 6 persona expansion (Carol / Mike / Kate / …) is NOT fully seeded on the swapped local DB.

---

## Bottom line

| | Backend unit (jest) | Playwright (no-write, local) | Write-gated + full matrix |
|---|---:|---:|---|
| **Passed** | **19 / 19** | **14** (incl. all 3 new §F/§H tests) | CI is authoritative |
| **Failed** | 0 | 1 — *pre-existing* `Carol Miller` seed gap, unrelated | — |
| **Skipped** | 0 | 1 + §G env-gated + spec 19 (9, write-gated) | — |

This cycle shipped a **9-item bundle** (3 backend/test-infra fixes, a translation-pipeline
doc update, 3 frontend bug fixes) as one PR. No engine clinical-rule changes, no schema
changes. Every code change carries a test or a documented manual-verification note.

A full-suite local run was **not** possible this cycle: the running backend had
`ENABLE_TEST_CONTROL=false` (write-gated specs defer to CI) and the admin `.next` dev cache
was corrupt (now cleared — see *Known test-infra issues*). CI (test-control provisioned,
fresh DB per shard) is the authoritative full tally; targeted gates below all pass.

**Categorized status**

| Area | Result |
|---|---|
| Shared build / `src` tsc (frontend, admin, qa) | ✅ clean |
| Backend `src` tsc | ✅ clean (changed files 0 errors; pre-existing spec `never`-typing + voice-chat e2e noise excluded — present on `dev`) |
| Backend jest (§B deadlock-retry, §D session-averager + daily_journal) | ✅ 19/19 |
| Playwright §F NotificationBell + §H patient/admin `<h1>` | ✅ 3/3 |
| §C polling (spec 13 / spec 19) | ✅ extraction sound (spec 19 loads, 9 skipped clean); write-gated assertions → CI |
| §G AlertsTab pill | ✅ admin tsc clean; UI walk env-gated (skips clean locally, runs in CI) |
| §E translation package | ✅ cross-checked vs `shared/src/alert-messages.ts` |

---

## ✅ Passing highlights

- **§B (bug #20)** — `withDeadlockRetry` + `test-control.service.ts` now catch the
  `@prisma/adapter-pg` `DriverAdapterError: TransactionWriteConflict` form (the typed
  `code` is undefined through the adapter, so the old `P2034 / 40P01` matcher never
  engaged). Conservative widening. `deadlock-retry.spec.ts` 8/8.
- **§D (bug #5)** — `suboptimalMeasurement` no longer defaults TRUE when a patient skips
  the optional 8-item checklist (the form sends all keys `false`; an all-false object now
  reads as "not completed", not "measured badly"). Mirrored in `provider.service.ts`.
  `session-averager.service.spec.ts` 10/10 (2 new bug-#5 cases).
- **§F (bug #1)** — admin NotificationBell badge now counts unread notifications from the
  **same source the dropdown renders** (was summing open clinical alerts + unread notifs;
  the dropdown is notifications-only → "9+" badge over an empty dropdown). Playwright PASS.
- **§H (a11y)** — patient `/dashboard` now has exactly one `<h1>` (sr-only), admin every
  page has exactly one `<h1>` (the persistent `AdminTopBar` title demoted to a styled
  `<div>`). Hydration #418 fixed — the time-of-day greeting moved out of render into a
  post-mount `useEffect`. Playwright PASS ×2.
- **§C** — `waitForAlerts` poll helper extracted to `qa/helpers/api.ts`; 6 fixed-`setTimeout`
  race sites in spec 13 converted to polling (kills the remote-DB timing flake class).
- **§G (bug #3)** — admin AlertsTab gains an "Acknowledged" status filter pill.

---

## ✅ Verified-fixed P0 HIPAA items (re-confirmed 2026-05-15)

| # | Area | Resolution |
|---|---|---|
| **B5** | Security / HIPAA | Refresh token NO LONGER in `localStorage`. Fix landed via phase/cluster-1; verified by code (`frontend/src/lib/services/token.ts:10-11` — "deliberately do NOT persist to localStorage") + passing spec `qa/tests/16-cross-cutting-a11y-and-security.spec.ts:96` (`refresh token NOT in localStorage after sign-in`) + corroborating `qa/tests/02-auth.spec.ts:91`. Refresh token lives ONLY in backend's HttpOnly `refresh_token` cookie. **CLOSED.** |
| **B6** | Security / HIPAA | `access_token` cookie IS `HttpOnly`. Verified by passing spec `qa/tests/16-cross-cutting-a11y-and-security.spec.ts:107` (`access_token cookie is HttpOnly`). **CLOSED.** |

Note: spec 16 test descriptions still carry the legacy comment "currently FAILS in v1" — that's stale text from before the fix landed; the tests themselves now pass and assert the fixed state.

---

# Phase 1 — Audit Trail comprehensive HIPAA/JCAHO/EPIC review

**Branch:** `duwaragie-test-coverage` (cut from `dev` @ `36964e0`, after PR #39 merged)
**Date:** 2026-05-17 · **Scope:** audit-trail UI display, actor identity, role/tenant
boundaries, PHI safety, immutability, system attribution. **No clinical-rule changes.**
**Posture:** pre-approved display/test fixes applied; P0/P1 boundary + completeness
findings **documented, NOT auto-fixed** (Phase 1 investigation protocol) — see the
*REPORT-FIRST findings* block below.

**Phase 1 bottom line**

| Gate | Result |
|---|---|
| Shared build · backend/admin/frontend/qa `src` tsc | ✅ all clean (changed files: 0 errors) |
| §B 15-field panel | ✅ all 15 render, distinct ack/resolve rows + actor names + `data-testid` added |
| §C actor display | ✅ observed patient-ack-name bug fixed (backend + UI); 9 actor surfaces audited |
| §F admin PHI safety | ✅ **3/3 Playwright pass live** (URL, console, error-response — no leaks) |
| §H system attribution | ✅ every rung now labelled `System (Cron)` or `Retry · admin-scheduled` |
| §G.2 immutability (UI) | ✅ no edit/delete/revert/reopen surface (grep clean) |
| §D/§E role + cross-tenant | 🔴 **P0 — documented, not fixed** (pending Duwaragie) |
| §G.1 immutability (API) | 🟠 no direct DELETE on 5 audit tables; one indirect cascade — documented |
| §J ProfileVerificationLog | 🟠 threshold + assignment actions write no audit row — documented |

### 15-field display audit (§B)

Component: `admin/src/components/patient-detail/EscalationAuditTrail.tsx`
(`ResolutionAuditFooter`). Backend feed: `provider.service.ts getPatientAlerts`
(consumed via `admin/src/lib/services/patient-detail.service.ts:319`).

| Field | Rendered | Correct value | Null handling | data-testid | Action taken |
|---|---|---|---|---|---|
| 1 Alert ID | ✓ | ✓ | n/a | ✓ added | none |
| 2 Tier | ✓ | ✓ | ✓ `prettify→'—'` | ✓ added | none |
| 3 Rule ID | ✓ | ✓ | ✓ `?? '—'` | ✓ added | none |
| 4 Severity | ✓ | ✓ | ✓ | ✓ added | none |
| 5 Mode (Std/Personalized) | ✓ | ✓ | ✓ | ✓ added | none |
| 6 Status | ✓ | ✓ | ✓ | ✓ added | none |
| 7 Created | ✓ | ✓ | ✓ `fmtDateTime→'—'` | ✓ added | none |
| 8 Acknowledged (at + actor) | ✓ **fixed** | ✓ **fixed** | ✓ | ✓ added | **split** — was one conflated "Resolved"=acknowledgedAt row, no actor; now `acknowledged` + `acknowledgedBy` rows; backend resolves `acknowledgedByUserId`→name |
| 9 Resolved (at + actor) | ✓ **fixed** | ✓ **fixed** | ✓ | ✓ added | **fixed binding** — `resolved` now binds `alert.resolvedAt` (was reusing acknowledgedAt); `resolvedBy`→`resolvedByName` |
| 10 Resolution action | ✓ | ✓ | ✓ | ✓ added | none |
| 11 Resolution rationale | ✓ | ✓ | ✓ (conditional block) | ✓ added | testid added |
| 12 Reading (BP) | ✓ | ✓ | ✓ ternary | ✓ added | BP rendered; HR/pulse not in `journalEntry` projection — minor, documented (not a regression) |
| 13 Pulse pressure | ✓ | ✓ | ✓ | ✓ added | none |
| 14 Baseline value (personalized) | ✓ | ✓ | ✓ | ✓ added | none |
| 15 Escalation count | ✓ | ✓ | ✓ | ✓ added | none |
| (+ BMI, Actual value — extras) | ✓ | ✓ | ✓ | ✓ added | kept (additive) |

### Actor display audit (§C — observed bug + symmetric cases)

| Action | Actor | Before | After |
|---|---|---|---|
| Patient acknowledges alert | Patient | ✗ "Acknowledged", **no name** (observed bug) | ✓ `acknowledgedByName` resolved + rendered — proven by `qa/tests/13:511` (passes in provisioned CI) |
| Provider resolves alert | Provider/MD | ✓ name shown | ✓ unchanged + now a **distinct** `resolvedAt` row |
| Admin verifies profile | Admin | ✓ `TimelineTab` `changedByName` | ✓ verified |
| Admin corrects profile | Admin | ✓ `TimelineTab` | ✓ verified |
| MED_DIR edits threshold | MED_DIR | ✓ `PatientThreshold.setByName` | ✓ verified (but no `ProfileVerificationLog` row — see §J) |
| Admin marks med VERIFIED/REJECTED/HOLD | Admin | ✓ `TimelineTab` verb + `changedByName` | ✓ verified |
| Admin assigns provider | Admin | ✗ no patient-detail audit UI **and** no `ProfileVerificationLog` (REPORT-FIRST §J) | unchanged — documented |
| BP_L2 retry scheduled | Admin action | "Retry" badge, no attribution text | ✓ `Retry · admin-scheduled` + tooltip |
| CRON ladder rung | System | ✗ blank (indistinguishable from human) | ✓ `System (Cron)` chip (§H) |

### PHI safety (§F)

| Check | Status |
|---|---|
| Admin URL bar across patient-detail walk | ✅ pass (no BP-shape / patient-name in any nav URL) |
| Admin console during walk | ✅ pass (no PHI; error-free after standard noise filter) |
| Error responses (`/provider/alerts/<garbage>/detail`, `/provider/patients/<garbage>/alerts`) | ✅ pass (no name / BP in body) |

All 3 ran **live** against the admin app (`16-cross-cutting-a11y-and-security.spec.ts:190/216/244`) — **3/3 pass**.

### Immutability (§G)

| Surface | Result |
|---|---|
| §G.1 API — DELETE on `DeviationAlert` / `EscalationEvent` / `ProfileVerificationLog` / `Notification` / `PatientMedication` | ✅ **none exist** (probed in `11:262`, skips cleanly w/o env) |
| §G.1 indirect | 🟠 `DELETE /daily-journal/:id` (`daily_journal.controller.ts:158`, JWT+ownership, **not** test-gated) cascades JournalEntry → DeviationAlert → EscalationEvent (+Notification) — REPORT-FIRST |
| test-control `deleteMany` (240-242) | ✅ correctly gated by `ENABLE_TEST_CONTROL` + `NODE_ENV!==production` |
| §G.2 UI — edit/delete/revert/reopen audit buttons | ✅ none (grep clean across `admin/src`) |
| §G.3 DB-level append-only / §G.4 field-immutability | ⏸ **deferred per plan** — CTO + Manisha + counsel discussion; no remediation recommended, no prejudging test added |

### System vs user attribution (§H)

| Audit row type | "System" labelled? |
|---|---|
| CRON-dispatched ladder rung (T+0/T+4h/T+8h/T+24h/T+48h, etc.) | ✅ `System (Cron)` chip |
| Admin BP_L2_UNABLE_TO_REACH_RETRY-scheduled rung | ✅ `Retry · admin-scheduled` chip |

Display-only (pre-approved). **Data-layer caveat:** no `dispatchedBySystem` column
exists — the chip is derived from `triggeredByResolution`. Correct schema-level
attribution is a REPORT-FIRST design question (see Finding 4).

### §I / §K / §L / §M

- **§I escalation completeness** — every `EscalationEvent` schema field is persisted
  (`ladderStep`, `recipientIds/Roles`, `notificationChannel`, `afterHours`,
  `scheduledFor`, `notificationSentAt`, `acknowledgedAt/By`, `resolvedAt/By`,
  `triggeredByResolution`, `reason`) and rendered in the timeline. Only gap: no
  system-dispatch flag at the data layer (Finding 4).
- **§K retry action** — data layer covered by existing `13:99`; UI now renders
  `Retry · admin-scheduled` + off-ladder event card; original alert stays OPEN
  (asserted by `13:99`). UI display assertion added in `13:612` (env-gated skip).
- **§L patient-side access log** — **intentional post-pilot deferral.** No clinical
  `RecordAccessLog`/record-view tracking exists (only content-module audit, unrelated).
  Cardioplace logs state-change events, not read-only views; pilot clinics rely on
  their own EHR access logs. No test (intentional gap).
- **§M notification dispatch audit** — `Notification` rows carry full audit context
  and **are** surfaced nested per escalation event (`event.notifications[]` in
  `EscalationAuditTrail`). No dedicated admin "all notifications for this patient"
  view. Gap filed (Finding 5) — not built this phase (not trivial; needs a new
  endpoint + tab).

### Tests added this phase (8 new)

| File:line | Test | Result here |
|---|---|---|
| `qa/tests/13-admin-alert-resolution.spec.ts:511` | §B/§C backend contract — alert-level `acknowledgedBy`/`acknowledgedByName`/`resolvedAt` | skips cleanly w/o `ENABLE_TEST_CONTROL`; asserts in CI |
| `qa/tests/13-admin-alert-resolution.spec.ts:612` | §B/§C/§H 15-field panel UI walk | env-gated skip (volatile-walk posture) |
| `qa/tests/16-cross-cutting-a11y-and-security.spec.ts:190` | §F admin URL PHI | ✅ **pass (live)** |
| `qa/tests/16-cross-cutting-a11y-and-security.spec.ts:216` | §F admin console PHI | ✅ **pass (live)** |
| `qa/tests/16-cross-cutting-a11y-and-security.spec.ts:244` | §F error-response PHI | ✅ **pass (live)** |
| `qa/tests/11-admin-verification-and-thresholds.spec.ts:211` | §D role boundary (secure contract) | `test.fixme` — documented P0, never reds suite |
| `qa/tests/11-admin-verification-and-thresholds.spec.ts:231` | §E cross-tenant (secure contract) | `test.fixme` — documented P0 |
| `qa/tests/11-admin-verification-and-thresholds.spec.ts:262` | §G.1 no-DELETE on audit tables | env-gated skip; asserts in CI |

### §N acceptance gate (honest)

- `npm run build -w @cardioplace/shared` → ✅ clean
- backend / admin / frontend / qa `tsc --noEmit` → ✅ all clean (changed files 0 errors;
  pre-existing `*.spec.ts` `never`-typing noise on `dev` unchanged)
- backend jest → no new unit tests this phase (Playwright-only)
- `RUN_WRITE_TESTS=1 npx playwright test 13 16 11 --workers=1` (this sandbox) →
  **19 passed / 2 skipped / 15 failed**. **All 15 failures share one cause:** backend
  has `ENABLE_TEST_CONTROL` unset → every write-test's `tc.findUser` 403s. **12 of the
  15 are pre-existing** (`11:18`, `13:32`, `13:212`, …) — identical env condition, not
  introduced here. The 3 new write-tests were hardened to **skip cleanly** under this
  condition (re-verified: targeted run = 3 passed §F / 5 skipped / 0 failed). Spec 16
  unaffected (no regression). Provisioned CI remains authoritative for write-gated rows.

## Phase 1 — REPORT-FIRST findings awaiting Duwaragie review

> Per the Phase 1 investigation protocol these were **not auto-fixed**. Duwaragie
> decides which to fix in a follow-up commit (or escalate to security review /
> counsel / CTO / Manisha). The PR is otherwise merge-ready (pre-approved fixes +
> tests applied).

### Finding 1: Per-patient provider endpoints apply no assignment or practice scope (PHI leak)

- **Severity:** P0
- **Category:** Role boundary + cross-tenant isolation (§D + §E — same root cause)
- **What I found:** `@Controller('provider')` admits all four clinical-staff roles
  (`PROVIDER`, `MEDICAL_DIRECTOR`, `HEALPLACE_OPS`, `SUPER_ADMIN`).
  `resolveScope()` (`backend/src/provider/provider.controller.ts:131-142`), which
  force-scopes a PROVIDER-only caller to *their own assignments*, is wired into
  **only** `getPatients` (l.63) and `getAlerts` (l.119). The per-patient endpoints
  take a raw `:userId`/`:alertId` with **no scope and no callerUserId**:
  `GET /provider/patients/:userId/alerts` (l.95-102), `:userId/summary` (l.68),
  `:userId/journal` (l.73), `:userId/bp-trend` (l.86), `GET /provider/alerts/:alertId/detail`
  (l.144). `provider.service.ts getPatientAlerts` (l.480-538) queries
  `where:{ userId }` with no `PatientProviderAssignment` and no `Practice` filter.
  Net: **any authenticated clinical-staff user (PROVIDER included) can read any
  patient's full alert + escalation audit PHI** (BP readings, three-tier clinical
  messages, escalation recipients) by supplying an arbitrary `userId`, across any
  practice. The admin patient-detail panel calls this exact endpoint
  (`patient-detail.service.ts:319`).
- **Repro / proof:** Code-path proof above (controller + service file:line — an
  authz gap is structural, not data-dependent). Executable secure-contract spec:
  `qa/tests/11-admin-verification-and-thresholds.spec.ts:211` (§D) + `:231` (§E),
  marked `test.fixme` so the suite stays green until the guard lands.
- **What I did NOT do:** Did not add the role/assignment/practice guard per Phase 1
  investigation protocol (P0 HIPAA — needs security review).
- **Recommended next step (Duwaragie decides):** add an assignment+practice scope
  check to all per-patient/per-alert provider endpoints (mirror `resolveScope` +
  `PatientProviderAssignment` + `Practice` FK), then un-`fixme` the two §D/§E tests.
  Likely a hotfix candidate before pilot.

### Finding 2: `DELETE /daily-journal/:id` cascade-erases linked audit rows

- **Severity:** P1 (immutability)
- **Category:** Audit immutability (§G.1 indirect)
- **What I found:** `DELETE /daily-journal/:id` (`daily_journal.controller.ts:158`,
  JWT + ownership only, **not** gated by `ENABLE_TEST_CONTROL`) →
  `journalEntry.delete()` (`daily_journal.service.ts:754`) cascades via FK to
  `DeviationAlert` → `EscalationEvent` (service comment l.744), and dispatched
  `Notification` rows. A patient can therefore erase a JCAHO escalation audit
  trail by deleting the originating reading. No direct DELETE exists on the five
  audit tables themselves (verified).
- **Repro / proof:** Grep + code path (`@Delete(':id')` → `.delete()` + cascade
  comment). Not exercised destructively in tests (would delete seed data).
- **What I did NOT do:** Did not remove the endpoint or change the cascade — this
  is the same product-design question deferred in §G.3 (patient typo-correction
  vs strict append-only).
- **Recommended next step (Duwaragie decides):** fold into the §G.3 CTO + Manisha +
  counsel discussion (soft-supersede vs `onDelete: Restrict` for alert-bearing
  entries vs status-only soft-delete).

### Finding 3: Admin threshold + provider/practice-assignment actions write no `ProfileVerificationLog`

- **Severity:** P1
- **Category:** Audit completeness (§J)
- **What I found:** `prisma.profileVerificationLog.create` appears **only** in
  `backend/src/intake/intake.service.ts` (6 sites: patient med add/edit, admin
  verify/reject/correct profile, med status change). These admin actions write
  **no** audit-log row: MED_DIR **threshold create/edit**, **provider/practice
  assignment** changes (CareTeamTab), enrollment-status toggle, condition-flag
  edits. An EHR auditor reviewing "who changed this patient's BP thresholds / care
  team and why" finds no trail.
- **Repro / proof:** `grep profileVerificationLog backend/src` → 1 file
  (`intake.service.ts`); threshold + assignment services have zero calls.
- **What I did NOT do:** Did not add the audit-writes — needs a design decision on
  the `fieldPath` / `changeType` enum values (current `VerificationChangeType` has
  no THRESHOLD_SET / ASSIGNMENT_CHANGE member) and actor/role mapping.
- **Recommended next step (Duwaragie decides):** extend `VerificationChangeType`
  (or a sibling audit model) + emit a log row from the threshold + assignment
  services. Likely pilot-relevant for JCAHO completeness.

### Finding 4: No `dispatchedBySystem` attribution at the data layer

- **Severity:** P2 (display mitigated)
- **Category:** Audit completeness / system attribution (§H + §I)
- **What I found:** No `EscalationEvent.dispatchedBySystem` (or actor) column. CRON
  vs admin-scheduled is only inferable from `triggeredByResolution` + `reason`
  text. The §H UI chip is derived from that heuristic — accurate today but not a
  persisted, queryable audit fact.
- **Repro / proof:** `escalation_event.prisma` field list (no system/actor column);
  cron `runScan` persists only timestamp + step + `reason`.
- **What I did NOT do:** Did not add a schema column (additive migration + backfill
  decision belongs with the team).
- **Recommended next step (Duwaragie decides):** consider an additive
  `dispatchedBySystem Boolean @default(true)` (or `dispatchedByUserId String?`) so
  attribution is a persisted audit fact, not a UI inference.

### Finding 5: No admin "all notifications for this patient" view

- **Severity:** P2
- **Category:** Audit completeness (§M)
- **What I found:** Notification audit context is only reachable nested under
  escalation events in `EscalationAuditTrail`. There is no per-patient notification
  log tab in the admin patient-detail screen.
- **Repro / proof:** No `NotificationsTab` / "all notifications" surface in
  `admin/src/components/patient-detail` (grep).
- **What I did NOT do:** Did not build it (not trivial — new endpoint + tab; out of
  Phase 1 "don't build unless trivial" scope).
- **Recommended next step (Duwaragie decides):** backlog a patient-scoped
  notification log tab if pilot compliance review wants it surfaced standalone.

### Known deferred items (post-pilot, intentional — not findings)

- **§G.3 / §G.4 DB-level append-only & field-immutability** — deferred per plan
  (CTO + Manisha + counsel). No remediation recommended, no prejudging test.
- **§L per-record-view access log** — HIPAA right-of-access; pilot clinics use
  their own EHR access logs. Add `RecordAccessLog` post-pilot.

---

# Phase 2 — REPORT-FIRST findings fixes

**Branch:** `duwaragie-test-coverage` (continues Phase 1; HEAD was `7761e33`)
**Date:** 2026-05-17 · **Scope:** the 5 Phase-1 REPORT-FIRST findings, fixed per
Duwaragie-approved scope. One commit + test + row per finding. **No clinical-rule
changes.**

| # | Finding | Severity | Disposition | Commit | Test |
|---|---|---|---|---|---|
| 1+2 | Per-patient/per-alert provider endpoints had no assignment/practice scope (PHI leak) | P0 | **FIXED** — `canViewPatient` guard on all 5 endpoints (`provider.controller.ts`); self/SUPER_ADMIN/HEALPLACE_OPS allow, PROVIDER must be primary/backup on an assignment, MED_DIR must be MD on/of-practice; iterates ALL assignments (multi-practice-ready) | `98d2f11` | `qa/tests/11…:212` (boundary + positive + SUPER_ADMIN), `:311` (assigned positive) |
| 3 | `DELETE /daily-journal/:id` cascades JournalEntry → DeviationAlert → EscalationEvent | P1 | **DOCUMENTED, NOT FIXED** — entangled with the CTO + Manisha + counsel reading-corrections architecture decision (§G.3 deferral). Behavior pinned by a regression-anchor test with a TODO for the soft-supersede outcome | `330564d` | `qa/tests/13…:768` (current-behavior anchor) |
| 4 | Threshold + provider-assignment changes wrote no `ProfileVerificationLog` | P1 | **FIXED** — additive enum members `ADMIN_THRESHOLD_UPDATE` / `ADMIN_ASSIGNMENT_CHANGE` (migration `20260517120000`); `threshold.service` + `assignment.service` emit an actor + before/after row; assignment controller now threads `req.user.id` | `df122cd` | `qa/tests/11…` Finding-4 describe (threshold + assignment log rows via admin verification-logs endpoint) |
| 5 | No persisted system-vs-human dispatch attribution on `EscalationEvent` | P2 | **FIXED** — additive `dispatchedBySystem Boolean @default(false)` column (migration `20260517120100`); set true at the 2 cron dispatch sites, false at the admin BP_L2 retry site; surfaced via provider DTO + test-control; admin chip now reads the column (legacy rows fall back to `!triggeredByResolution`) | `4ecf719` | `qa/tests/13…` Finding-5 describe (cron rung=true, admin retry=false) |
| 6 | No admin per-patient notifications view | P2 | **DEFERRED (documented, no code)** — see below | — (doc only) | — |

### Finding 6 — admin per-patient notifications view (P2, deferred)

Admin needs a consolidated **"all notifications (push / email / dashboard) dispatched
for this patient"** view. Today admins see alerts in the AlertsTab and notification
rows only *nested under escalation events* in `EscalationAuditTrail`; there is no
standalone per-patient notification log tab. The **data layer already supports it**
(`Notification.userId` is indexed and queryable per patient — confirmed Phase 1 §M;
test-control `listNotifications(userId)` already does exactly this query). Building a
new admin UI surface is a feature, not a REPORT-FIRST fix, so it is **out of scope
for this cycle**. Recommendation: build post-pilot, or in the Phase 3 admin-tabs
scope if time permits. No code change this cycle.

### Phase 2 acceptance gate

- `npm run build -w @cardioplace/shared` → ✅ clean
- backend / admin / frontend / qa `tsc --noEmit` → ✅ all clean (changed files 0
  errors; Prisma client regenerated for the new enum members + `dispatchedBySystem`
  column; pre-existing `*.spec.ts` `never`-typing noise on `dev` unchanged)
- Prisma: two additive, idempotent migrations checked in (`20260517120000` enum,
  `20260517120100` column). NOT applied via `migrate dev` against the shared remote
  DB by design — `prisma generate` refreshes the client locally; CI/deploy applies
  via `migrate deploy`.
- `RUN_WRITE_TESTS=1 npx playwright test 11 13 --workers=1` (this sandbox): the
  Phase-2 write-tests **skip cleanly** — the backend dev servers are not running
  here (they were during Phase 1) so `apiSignIn` / `tc.findUser` can't reach
  `:4000`; every Phase-2 test guards on this and `test.skip`s rather than false-red,
  consistent with the established suite posture. Deterministic gate = the clean
  builds + 4× tsc. Provisioned CI (servers + `ENABLE_TEST_CONTROL` + seed) is
  authoritative for the write assertions; the §D/§E + Finding-4/5 tests are written
  to PASS there.
- §H visual walk-through (`MANUAL_VERIFY_PHASE_1.md`): **not executable in this
  sandbox** — the 3 dev servers + DB are not running and cannot be provisioned from
  the batch environment. Documented honestly; must be run by a human (or a
  provisioned CI/preview) before pilot sign-off. The audit-panel changes are
  type-checked + unit/integration-covered; the visual confirmation step remains
  outstanding and is called out in the §I report.

### Manual UI verification (§H — MANUAL_VERIFY_PHASE_1.md)

**Status: ⏳ NOT executed in this cycle — outstanding human/provisioned gate.**
`MANUAL_VERIFY_PHASE_1.md` is an explicitly human walk-through (magic-link sign-in
via Mailtrap, two parallel browser windows, screenshots). The 3 dev servers are not
running in the batch environment and the DB/secrets/Mailtrap cannot be provisioned
from it, so the visual steps were **not performed** — not marked ✓ to avoid
fabricating unobserved results. Each checkpoint has automated coverage that gates
the same behavior deterministically; the visual confirmation remains a pre-pilot
human step (Duwaragie on local dev, or a provisioned CI/preview).

| Step | Visual gate | Automated coverage backing it | Visual status |
|---|---|---|---|
| 1 | Patient submits Tier-1/L2 reading | `qa/tests/13` alert-creation flows | ⏳ pending human |
| 2 | Admin 15-field audit panel renders | `qa/tests/13` §B panel UI (`audit-field-*` testids) + admin tsc (`PatientAlert` type) | ⏳ pending human |
| 3 | Patient acknowledges | `qa/tests/13:371` patient-ack propagation | ⏳ pending human |
| 4 | Admin sees "Acknowledged by Aisha Johnson" (THE bug) | `qa/tests/13:511` backend contract (`acknowledgedByName` resolved) | ⏳ pending human |
| 5 | Admin resolves w/ rationale; distinct Resolved row | `qa/tests/13:212` resolvedAt + §B split-row UI test | ⏳ pending human |
| 6 | Patient sees "Resolved by Dr. …" | resolver-name resolution (provider.service) | ⏳ pending human |
| 7 | backupProvider 403 on unassigned patient (P0) | `qa/tests/11` Phase-2 guard test (403 on all 5 endpoints) | ⏳ pending human |
| 8 | Cross-practice 403 (P0) | same Phase-2 test (isolated Practice B probe) | ⏳ pending human |

Action: Duwaragie runs the 8-step walk on local dev (or a provisioned preview) and
fills the ✓/✗ table per the doc before pilot sign-off.

### Note on the §D/§E tests vs. the seed

The seed assigns **every** test patient to ONE shared care team (primary-provider +
backup-provider + medical-director @ seed-cedar-hill), so a real "unassigned /
cross-practice" negative cannot be built from pure seed data and `apiSignIn` only
works for seed emails (perma-OTP). The Phase-1 `test.fixme` placeholders were
therefore replaced with a **self-contained** test that spins up an isolated
Practice B, reassigns a dedicated probe patient (Charles) into it with a care team
that excludes `primaryProvider`, asserts 403 across all 5 guarded endpoints +
positive access for the assigned `backupProvider` and SUPER_ADMIN, then restores
the original assignment in `finally` (sequential under `--workers=1`, hermetic).

---

# Phase 1 UI polish — Chrome walkthrough fixes (2026-05-17)

**Branch:** `duwaragie-test-coverage` (continues Phase 2). A manual Chrome
walkthrough of the admin resolve + ack flows surfaced 9 LOW-severity UI/audit
gaps; all fixed. **Notable:** the dev servers were up this cycle, so every fix
was **verified live end-to-end** (not skipped) — `RUN_WRITE_TESTS=1 playwright
test 13` ran the new tests against the running stack.

| # | Finding | Present? | Fix | Verified |
|---|---|---|---|---|
| 1 | Admin ack didn't show actor — `PATCH /provider/alerts/:id/acknowledge` (the AlertsTab path) set only status+acknowledgedAt, no `acknowledgedByUserId` | YES | Thread `adminId` (controller `@Req`); write `acknowledgedByUserId`; symmetric fix in `alert-resolution.service` ack | ✅ live (backend contract test, 35s) |
| 2 | T+0 badge stuck red "Awaiting acknowledgment" after ack | YES (symptom of #3) | `Step` badge now reads alert status: triggered + ACKNOWLEDGED ⇒ green "Acknowledged"; + RESOLVED ⇒ "Completed" (defensive vs propagation lag) | ✅ live (UI walk) |
| 3 | Admin ack didn't propagate to `EscalationEvent` rows (provider path) | YES | `escalationEvent.updateMany` propagation added to `provider.service.acknowledgeAlert` (mirrors patient-ack + alert-resolution.service) | ✅ live (backend contract test) |
| 4 | 15-field record absent for ACKNOWLEDGED alerts (footer was RESOLVED-only) | YES | `ResolutionAuditFooter` → `AlertAuditFooter`, renders for ACKNOWLEDGED too; teal "Acknowledgment audit record" header; resolved/resolvedBy/action show "Not required — alert acknowledged, not yet resolved" | ✅ live (UI walk) |
| 5 | PULSE PRESSURE "—" despite real value (e.g. James 118/74) | YES | DB `pulsePressure` is BP-tier-only; footer now falls back to SBP−DBP (matches AlertCard + ReadingsTab) | ✅ live (UI walk asserts "44") |
| 6 | ACTUAL VALUE "—" for profile-based rules (ambiguous) | YES | Profile/med/symptom tiers (Tier 1/2/3) with null actualValue → "Not applicable (profile-based rule)"; BP-Level tiers keep "—" (genuine gap). Tier-based, no engine/rule-ids change | ✅ live (UI walk asserts "Not applicable") |
| 7 | BASELINE VALUE row is v1-vestigial (v2 has no rolling baselines) | YES | Row removed from footer; header drops the brittle fixed-count claim ("Resolution/Acknowledgment audit record"). Schema column left intact (no migration — §G.3 deferred). Phase-1 spec-13 FIELD_KEYS synced | ✅ live (UI walk asserts row absent) |
| 8 | Resolve modal "Unknown patient" on patient-detail alerts | YES | Per-patient feed omits nested patient; thread `patientName` shell → AlertsTab → modal (`resolvable.patient.name`) | ✅ live (UI walk asserts patient name) |
| 9 | ACKNOWLEDGED/-by "—" when resolved without prior ack (looks data-missing) | YES | Footer shows "Not required — alert resolved directly" when RESOLVED & no `acknowledgedAt` | ✅ live (UI walk) |
| 10 | "ACTUAL VALUE 165" ambiguous (sys/dia/HR?) | YES | Renamed → TRIGGERING VALUE; `formatTriggeringValue(ruleId, actualValue)` adds axis+unit ("165 mmHg (systolic)", "38 bpm (heart rate)", "Not applicable — profile-based rule"). Shared `RULE_AXIS` map covers all 46 rule ids (`Record<RuleId>` = build-time exhaustive); testid `audit-field-actualValue` → `audit-field-triggeringValue`. Display-only, no data-model change | ✅ unit (10 cases) + 2 live UI walks |

All 10 were genuine bugs (none "by design"). Plan-pointer note: the plan §B/§D
cited `alert-resolution.service.ts:53`, but the admin AlertsTab/NotificationsScreen
"Acknowledge" button actually calls `PATCH /provider/alerts/:id/acknowledge`
(`provider.service.acknowledgeAlert`) — the real buggy path. Both ack paths were
fixed for consistency.

### Commit grouping

The plan listed 9 per-finding commits; Findings 2/4/5/6/7/9 + the event-actor
display all live in **one file** (`EscalationAuditTrail.tsx`) and are one
cohesive change, so they ship as 4 logical commits (each compiling, each citing
its findings) rather than 7 interleaved same-file commits — consistent with the
"one logical change per commit" standard:
`b8cf1ca` (backend ack 1+3) · `f0c26af` (audit footer 2,4,5,6,7,9) ·
`cfb9caa` (modal name 8) · `6b022d3` (tests 1-9) · doc commit (this section).

### Tests added (3 new + 1 synced)

| File:line | Test | Live result |
|---|---|---|
| `qa/tests/13…:931` | Findings 1+3 — admin ack writes actor + propagates to events (deterministic API) | ✅ pass (35s) |
| `qa/tests/13…:1000` | Findings 2/4/5/6/7/8 — ACKNOWLEDGED footer/badge/PP/actualValue/baseline/modal (UI walk) | ✅ pass (40s) |
| `qa/tests/13…:1079` | Finding 9 — resolved-directly ack copy (UI walk) | ✅ pass (37s) |
| `qa/tests/13…:612` | Phase-1 §B footer test — synced (dropped `baselineValue` key per Finding 7; fixed latent OPEN-filter/expand bug; now runs + passes live, 45s) | ✅ pass |

Test-infra note: the new write/UI tests were timing out at the default 30s
(reset + OTP + waitForAlerts + admin browser walk); raised to 120–150s via
`test.setTimeout`. Also fixed a latent bug shared with the Phase-1 §B test —
AlertsTab defaults to the OPEN status filter so ACKNOWLEDGED/RESOLVED alerts
were hidden; tests now click the "All" pill + the "Expand alert" button.

### Finding 10 — tests + clinical-review flags

Added a deterministic `formatTriggeringValue` unit test (10 cases: systolic,
diastolic, hr×2, profile×2, value-based-null→"—", unmapped/null→systolic
default — passes 11ms, always runs) + a live UI walk asserting the footer
shows "165 mmHg (systolic)". The existing Finding-6 profile assertion in the
consolidated walk was updated to the new testid + em-dash copy and confirmed
live. RULE_AXIS maps all 46 rule ids; `Record<RuleId, RuleAxis>` makes
coverage a **compile-time** guarantee (build fails if a new rule is
unmapped). The plan's sketch referenced 4 non-existent ids
(`RULE_LOOP_DIURETIC_LOW`, `RULE_PULSE_PRESSURE_HIGH`,
`RULE_TACHY_SINGLE_HIGH`, `RULE_MEDICATION_HOLD`) — excluded per §H; the real
ids (`…_HYPOTENSION`, `…_WIDE`, `RULE_TACHY_HR`, `RULE_MEDICATION_MISSED`)
were used instead.

⚠ Clinical-review flags (pilot-safe defaults, surfaced for Dr. Singal — not
blockers): `RULE_PULSE_PRESSURE_WIDE` labelled systolic-derived (PP = SBP−DBP;
no dedicated PP axis); `RULE_ORTHOSTATIC_HYPOTENSION` classed `profile`
(postural/symptom-driven though it involves a BP delta); `RULE_SYMPTOM_
OVERRIDE_*` kept `systolic` (value-derived but symptom-triggered). Dual-axis
(both sys + dia trigger) intentionally deferred — single-axis primary is fine
for pilot per the plan §H note.

### Phase 1 UI polish acceptance gate

- `npm run build -w @cardioplace/shared` → ✅ clean
- backend / admin / frontend / qa `tsc --noEmit` → ✅ all 0 errors
- `RUN_WRITE_TESTS=1 npx playwright test 13 11 --workers=1` (servers UP this
  cycle): the 4 Phase-1-polish tests **pass live**; Phase 2 Finding-4 threshold +
  assignment audit tests also **passed live** (retroactively confirming Phase 2);
  no regressions introduced.
- §H `MANUAL_VERIFY_PHASE_1.md`: the automated UI walks now exercise the resolve
  AND ack paths end-to-end; the human screenshot walk remains the formal
  pre-pilot sign-off but is now de-risked by passing automation.

### Reviewer feedback 2026-05-17 (post-Finding-10, same commit lineage)

Chrome re-verification of an ACKNOWLEDGED alert surfaced two copy/UX nits in
the `AlertAuditFooter` (both fixed in `EscalationAuditTrail.tsx`):

1. **Legacy ack actor — "Acknowledged by —" (ambiguous).** Alerts
   acknowledged *before* the Finding 1 fix have a real `acknowledgedAt` but
   no persisted actor (the identity was never captured anywhere — alert,
   events, or logs). The fix is **forward-only by design**: we must not
   fabricate the actor (JCAHO integrity), and there is no source to backfill
   from. Display now reads **"Not recorded (acknowledged before audit fix)"**
   instead of a bare "—", so a reviewer sees an explained legacy gap, not a
   bug. Post-fix acks show the real name (proven by the deterministic backend
   contract test + live UI walk). NOTE: the running dev backend must be on
   the fixed code for *new* acks to capture the actor — a pre-fix-running
   server's acks are legacy data even if timestamped today.
2. **Resolution-row copy was redundant AND clinically wrong for some
   tiers.** The Resolved / Resolved by / Resolution action rows repeated
   "Not required — alert acknowledged, not yet resolved" 3×. First pass
   collapsed it to "Pending resolution" — but a follow-up review caught a
   clinical error: per **CLINICAL_SPEC Part 12 + Part 13 (line 570-573)**,
   only **Tier 1 / Tier 2 / BP Level 2** have a resolution-action catalog
   (`resolutionTierFor` → non-null) and genuinely need a provider
   resolve+rationale step after ack. **BP Level 1 and Tier 3 have NO
   resolution actions** — acknowledgment is their *terminal* state, there is
   nothing to resolve. So "Pending resolution" on an acknowledged BP L1
   alert (the reviewer's actual screen, `RULE_CAD_HIGH`) was misleading.
   Footer is now **tier-aware** via `resolutionTierFor(alert.tier)`:
   - Tier 1/2/BP L2, acknowledged-not-resolved → **"Pending resolution"**
     (a real provider resolution + rationale is still required)
   - BP L1 / Tier 3, acknowledged → **"Not applicable — closed on
     acknowledgment"** (no resolution step exists for this tier)
   Both branches verified live: the Tier-1 consolidated walk asserts
   "Pending resolution"; the BP-L1 walk asserts "closed on acknowledgment"
   + absence of "Pending resolution". Answers the reviewer's question
   directly — **acknowledge-level (BP L1 / Tier 3) alerts have no
   resolve/comment step; acknowledgment closes them.**

Legacy-actor display (point 1) is UI-only with no automatable path to
synthesize pre-fix legacy data — covered by this manual-verification note per
the standing requirement; the tier-aware copy (point 2) has live test
coverage on both branches.

## 🔴 Real product issues still open (NOT fixed this cycle — triage)

| # | Area | Issue | Severity |
|---|---|---|---|
| **AE** | Clinical / pilot | **ACE-inhibitor angioedema rule is unimplemented** — no `RULE_*_ANGIOEDEMA` in `rule-ids.ts`/engine, and no facial/lip/tongue-swelling symptom input. Patient string (translation item 1.7) AND caregiver string (item B1.6) are drafted copy with zero implementation. Caregiver B1.6 = **DRAFT / ⚠ PILOT BLOCKER**. | **P0 (pilot blocker)** |

**AE** needs Dr. Singal sign-off (wording + symptom trigger + tier + dispatch path) then an engineering ticket — see *Iteration plan*.

---

## 🟡 Partial coverage / deferred (by design)

- **6 `test.fixme()` in spec 09** (`09-rule-engine-via-ui`) — Cluster-7 cleanup
  investigations: `09:475` (obsolete auto-resolve assertion), `09:644/690`
  (`CLUSTER_6_RISK`), `09:737` (post Day-3 + session-averaging), `09:800` (Nora brady),
  `09:916` (Paul CAD co-fire). Each is a real engine question, not a flake.
- **§G AlertsTab UI test** — env-gated: locally (no test-control, volatile patient-detail
  tabs per spec 11) it `test.skip`s cleanly instead of flaky-hard-failing; runs the real
  assertions under a provisioned CI run. Deterministically covered by the admin TS build
  (`StatusFilter` union + `PatientAlert.status` already includes `'ACKNOWLEDGED'`).
- **§H Problem C (#418 hydration)** — DevTools-only, no automated assertion (the spec-04
  console-clean test deliberately filters `hydration` to avoid 3rd-party flake). Manually
  re-verify "no #418 in `/dashboard` console" before pilot.
- **§E translation docs** — documentation only; verified by verbatim cross-check against
  `shared/src/alert-messages.ts`.

**Resolved since 2026-05-08:** the **G1–G9 multi-alert question** is answered + shipped —
Dr. Singal's call was *multi-axis co-fire*; the engine now runs the axis-keyed co-fire
pipeline (Cluster 6 + 7), so contraindication + BP/symptom rows fire together. Those tests
were rewritten, not relaxed. `spec 14:34` full-ladder fixme un-fixme'd via
`advanceLadderSteps`; `spec 12:73` business-hours endpoint test un-skipped.

---

## 🔧 Known test-infra issues

- **Deadlock-retry now catches the adapter-wrapped form (§B).** Reduces the transient
  `TransactionWriteConflict` flake on `resetUser` against the remote DB.
- **Admin `.next` dev-cache corruption (resolved this session).** The admin
  `/patients/[id]` route 404'd because `admin/.next` was corrupt + 8 days stale
  (`routes.d.ts` had a garbled spliced token; compiled `patients/[id]/page.js` predated
  the source by 8 days). Not a code bug — the route file is valid Next 16. Fixed by
  `rm -rf admin/.next` + dev-server restart. Recurs if `next dev` is interrupted
  mid-compile; reset = `rm -rf <app>/.next && npm run dev`.
- **Backend `tsc --noEmit` non-zero exit is pre-existing noise** — every error is in
  `*.spec.ts` (jest mock `never`-typing) or `test/llm-judge/voice-chat.e2e-spec.ts`, all
  on `dev` before this PR. This PR's changed source files: 0 tsc errors.
- **Shared seed DB pollution + archetype wiping** (carryover) — local runs against the
  shared remote DB hit seed-state pollution; CI uses fresh DB-per-shard. The Cluster 6
  persona expansion (Carol/Mike/Kate/…) is not seeded on the swapped local DB, so the
  `spec 10:101` patient-list assertion and `/patients/[id]` data fetches for those
  personas fail locally — **pre-existing seed gap, unrelated to this PR**.
- **Accepted WCAG debt** — orange/amber-on-tinted small text is explicitly accepted,
  scoped-excluded from spec 16 via `data-axe-debt` attributes + CSS selectors. The
  font-size cleanup (≥14px bold for AA Large) is deferred (A1.6 — out of this cycle's
  scope, needs a design pass with Lakshitha).

---

## 🚫 Skipped (env-gated by design)

- Write-side specs (`RUN_WRITE_TESTS=1`) — 10 spec files; run in CI / with a
  test-control-enabled backend.
- LLM safety refusals (`RUN_LLM_TESTS=1`) — Gemini quota gated.
- spec 19 Cluster 7 (9 tests) — write-gated; loads cleanly post §C helper extraction.
- §G AlertsTab pill — env-gated skip when the admin UI walk is unprovisioned locally.

---

## This cycle's changes (12 commits ahead of `origin/dev`)

| § | Commit | Change | Proof |
|---|---|---|---|
| pre | `55dae45` | `.env.example` — document `CAREGIVER_DISPATCH_ENABLED` | config doc |
| pre | `9756ae6` | counsel-reviewed patient+admin privacy/terms ×4 (v2026-05-08) | legal copy |
| §B | `ffdb51b` | widen deadlock-retry matcher (bug #20) | jest 8/8 |
| §C | `1e69aa1` | port `waitForAlerts`, fix 6 spec-13 timeout races | tsc + spec-19 load |
| §D | `5c5dc0d` | suboptimalMeasurement no longer defaults TRUE (bug #5) | jest 10/10 |
| §E | `b18a5f1` | translation pkg Appendix B + brief admin + placeholder docs | cross-check |
| §F | `5953fb5` | NotificationBell badge↔dropdown alignment (bug #1) | Playwright |
| §G | `c0567cd` + `929eda8` | AlertsTab "Acknowledged" pill (bug #3) + env-gate hardening | admin tsc / CI |
| §H | `08bc6d5` | patient+admin `<h1>` hierarchy + hydration #418 | Playwright ×2 |
| doc | `0d581ea`,`4188551` | QA status docs (now consolidated into this file) | — |

**Backfill (landed 05-14 → 05-15, before this PR):** Niva Cluster 7 PR #38 + 4 Duwaragie
follow-ups (β-blocker fatigue/SOB, NSAID interaction, ACE cough, HCM low, HF caregiver
edema, HOLD; spec 19; bug #19 med-dedup; spec 14:34 un-fixme; spec 12:73 un-skip);
CLINICAL_SPEC v2.2 / PR #37.

---

## 🛠 Iteration plan / next steps

1. **Dr. Singal sign-off on ACE-angioedema (pilot blocker)** — final caregiver wording
   (B1.6) + confirm patient wording (item 1.7) + the symptom trigger (no
   facial/lip/tongue-swelling input exists today) + tier + whether it routes via
   `CAREGIVER_DISPATCH_ENABLED`. Then engineering: add `RULE_ACE_ANGIOEDEMA`
   (patient + caregiver) to `rule-ids.ts` → `alert-messages.ts` → engine + symptom flag.
2. **Resolve the 6 spec-09 `test.fixme()`** (Cluster-7 cleanup) — verify against the
   shipped multi-axis engine, delete/rewrite obsolete ones.
3. **Translator vendor handoff** — `docs/CLINICAL_TRANSLATION_PACKAGE_EN.md` v2026-05-15
   is ready for Spanish + Amharic except B1.6 (DRAFT, blocked on #1).
4. **Full provisioned CI run** to confirm write-gated §C/§G + the full matrix green.
5. **Spec 16 cosmetic** — strip the stale "currently FAILS in v1" comment from the B5
   refresh-token-localStorage test description (no behavior change; just doc hygiene
   so future readers don't read the old comment and re-open B5 as "not fixed" again,
   which is what happened on 2026-05-15).

---

## Pre-merge checklist (`duwaragie-dev → dev`)

- [x] §B–§H implemented, one logical commit per item, brief messages, no engine rule changes
- [x] Backend jest 19/19; shared build + frontend/admin/qa `src` tsc clean
- [x] Playwright no-write: §F + §H ×2 green; §C/§G defer to CI
- [x] §E strings cross-checked; B1.6 flagged DRAFT/PILOT BLOCKER
- [x] `docs/CLINICAL_TRANSLATION_PACKAGE_EN.md` force-added (was gitignored — user-approved)
- [x] Admin `.next` corruption cleared (local-env only, gitignored, no code/commit impact)
- [ ] CI green on all shards (write-gated §C spec-13/19 + §G run there)
- [ ] Manually re-verify no React #418 on `/dashboard` (§H Problem C)
- [ ] Dr. Singal: B1.6 caregiver-angioedema final wording before pilot (PILOT BLOCKER)
- [ ] Merge to `dev` (user-owned — do not auto-merge)

---

## How to run / view

```bash
# Backend unit (the §B/§D gates)
cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest \
  deadlock-retry.spec.ts session-averager.service.spec.ts daily_journal.service.spec.ts

# Playwright (needs the 3 dev servers; write-gated specs need ENABLE_TEST_CONTROL=true)
cd qa && npx playwright test 10-admin-auth-and-dashboard.spec.ts 04-patient-dashboard.spec.ts --reporter=list
RUN_WRITE_TESTS=1 npx playwright test 13-admin-alert-resolution.spec.ts 19-cluster-7-side-effects-via-api.spec.ts --reporter=list --workers=1

# HTML report
cd qa && npx playwright show-report playwright-report
```

---

## References

- Suite guide + test-control endpoint table: `qa/README.md`
- Clinical source-of-truth: `docs/CLINICAL_SPEC.md` (v2.2, PR #37)
- Translator package: `docs/CLINICAL_TRANSLATION_PACKAGE_EN.md` (v2026-05-15)
- Backlog / bug log: `Documents/cardioplace-handoffs/` (BUG_BACKLOG, HANDOFF_TO_NIVA_CLUSTER_7)

> This file is the single living QA results doc. The previously-separate dated
> `STATUS_2026_05_14.md` / `STATUS_2026_05_15.md` snapshots were consolidated here on
> 2026-05-15 — one file, updated in place each cycle.
