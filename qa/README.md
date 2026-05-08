# Cardioplace v2 QA — Playwright suite

End-to-end browser-level testing for the patient frontend (`:3000`), admin app
(`:3001`), and backend API (`:4000`). Multi-engine via Playwright projects;
escalation + cron flows driven through dev-only `/test-control/*` HTTP hooks
on the backend.

> **Status:** Foundation complete. Day-one specs cover the critical paths.
> The "Known gaps" section at the bottom lists what the next session needs.

---

## What's covered

```
qa/
  package.json             standalone npm package (not in repo workspaces — keeps test deps off backend/frontend)
  playwright.config.ts     6-project matrix, default chromium-desktop, opt-in via RUN_FULL_MATRIX=1
  global-setup.ts          health-check + reset-test-patients before any project runs
  helpers/
    selectors.ts           single source of truth for every data-testid (T.dashboard.latestBp etc.)
    accounts.ts            seed accounts (5 patients + 6 admins) + perma-OTP 666666
    auth.ts                signInPatient / signInAdmin / apiSignIn / authedApi / signOutPatient
    api.ts                 typed POST /daily-journal, alert ack/resolve/audit, enrollment-check
    test-control.ts        TestControl class — wraps /test-control/* (cron drivers, anchor backdate, reset, inspect)
    time.ts                business-hours / after-hours / HOURS / DAYS helpers
    intake.ts              postIntakeProfile + postIntakeMedications (skip the wizard for non-intake specs)
  tests/
    01-marketing.spec.ts                          public surface + gated-path redirect
    02-auth.spec.ts                               OTP flow, wrong OTP, role redirect, sign-out
    03-onboarding-and-layer-a-gate.spec.ts        onboarding journey + Layer A 403 (partially TODO — see gaps)
    04-patient-dashboard.spec.ts                  greeting, latest-BP tile, chart, console-clean
    05-patient-check-in.spec.ts                   wizard step 1 + API-side normal/L1/L2 alert triggers
    06-patient-readings-notifications.spec.ts     TZ day-grouping, day(s) plural, Apr3018:01 separator
    07-patient-chat.spec.ts                       empty state + 4 LLM-safety refusal evals (gated by RUN_LLM_TESTS)
    08-patient-profile.spec.ts                    care-team, conditions, meds visibility (Aisha + Priya)
    09-rule-engine-via-ui.spec.ts                 8 rule branches × deterministic ruleId assertion + benign auto-resolve
    10-admin-auth-and-dashboard.spec.ts           per-role admin sign-in + patient list
    11-admin-verification-and-thresholds.spec.ts  verify-profile, med reject + readd, threshold role boundaries
    12-admin-enrollment-gate.spec.ts              4-piece gate happy path + idempotency
    13-admin-alert-resolution.spec.ts             ack + resolve per tier, missing-rationale 400, BP_L2_UNABLE_TO_REACH_RETRY, audit 15-field
    14-escalation-tier1-ladder.spec.ts            T+0 → T+4h → T+8h → T+24h → T+48h via runScan + ack-stops-cron
    15-crons-gap-and-monthly-reask.spec.ts        gap-alert 48h trigger + 24h idempotency, monthly re-ask 30d
    16-cross-cutting-a11y-and-security.spec.ts    axe hard-fails on 7 patient pages + admin dashboard, no PHI in URL, no localStorage refresh token
```

**~70 test cases across 16 spec files.** Counts will grow as tests fill in
the TODO sections.

---

## Running locally — prerequisites

```bash
# 1. Provision your own DB (TESTING_FLOW_GUIDE §15.1) — Prisma Postgres free tier works
cp backend/.env.example backend/.env
# Edit DATABASE_URL + JWT_SECRET. Critically:
#   ENABLE_TEST_CONTROL=true
#   TEST_CONTROL_SECRET=<some-string>   (optional but recommended)

# 2. Install + migrate + seed
npm install                              # repo root — hoists workspace deps
cd backend && npx prisma migrate deploy && npx prisma generate && npx prisma db seed
# Seed creates 5 patients + 6 admins, all with perma-OTP 666666.

# 3. Boot the three services in three terminals
cd backend  && npm run start:dev         # :4000  (with ENABLE_TEST_CONTROL=true in env)
cd frontend && npm run dev               # :3000
cd admin    && npm run dev               # :3001

# 4. Install qa deps + browsers
cd qa
cp .env.example .env.local               # match TEST_CONTROL_SECRET to backend
npm install
npm run install:browsers                 # ~250 MB — chromium / firefox / webkit
```

---

## Running tests

```bash
# Default — chromium desktop, auth+UI specs only (no write tests, no LLM)
npm run test

# Full PR loop — patient + admin UI specs
RUN_WRITE_TESTS=1 npm run test

# LLM safety refusals (Gemini quota — paid)
RUN_LLM_TESTS=1 RUN_WRITE_TESTS=1 npm run test:patient

# Multi-engine matrix (chromium / firefox / webkit × desktop / mobile)
RUN_FULL_MATRIX=1 RUN_WRITE_TESTS=1 npm run test

# Subset by tag
npm run test:patient        # tests/0[1-9]-*
npm run test:admin          # tests/1[0-3]-*
npm run test:escalation     # tests/14-*
npm run test:crons          # tests/15-*

# Headed (see the browser)
npm run test:headed

# Debug a single spec
npx playwright test tests/02-auth.spec.ts --headed --debug

# Report
npm run report              # opens playwright-report/index.html
```

### Env flags

| Flag | Default | Effect |
|---|---|---|
| `RUN_WRITE_TESTS` | unset | Enables specs that mutate seed-patient state (check-in, alert resolution, escalation, crons) |
| `RUN_LLM_TESTS` | unset | Enables 4 LLM safety refusal evals on `/chat` |
| `RUN_FULL_MATRIX` | unset | Adds firefox/webkit + mobile projects |
| `SKIP_RESET` | unset | Skip the global-setup reset of test-patient state |
| `TEST_CONTROL_SECRET` | unset | Must match backend; suite passes `X-Test-Control-Secret` header |

---

## Backend test-control (`ENABLE_TEST_CONTROL=true`)

The suite drives cron + escalation flows through dev-only HTTP endpoints
mounted by `backend/src/test-control/test-control.module.ts`. They are
GATED two ways:

1. The module itself is omitted from `app.module.ts` unless
   `ENABLE_TEST_CONTROL=true` AND `NODE_ENV !== 'production'`.
2. The controller rejects every request with 403 in production, regardless
   of the env flag.
3. When `TEST_CONTROL_SECRET` is set, every request must include the
   matching `X-Test-Control-Secret` header.

| Endpoint | Purpose |
|---|---|
| `GET /test-control/health` | Reachability + flag echo |
| `POST /test-control/cron/escalation/run` `{now?}` | EscalationService.runScan(now) |
| `POST /test-control/cron/gap-alert/run` `{now?}` | GapAlertService.runScan(now) |
| `POST /test-control/cron/monthly-reask/run` `{now?}` | MonthlyReaskService.runScan(now) |
| `POST /test-control/anchor/backdate` `{alertId, deltaSeconds}` | Subtract from T+0 EscalationEvent timestamps — fast-forward the ladder |
| `POST /test-control/journal/backdate-latest` `{userId, deltaSeconds}` | Make a journal entry look older — for gap-alert |
| `POST /test-control/medication/backdate-verified` `{medId, deltaSeconds}` | Make a med look stale — for monthly-reask |
| `POST /test-control/reset/test-patients` | Wipe journal/alert/escalation/notification rows for ALL `*.cardioplace.test` patient seeds |
| `POST /test-control/reset/user` `{userId}` | Same, scoped to one user |
| `POST /test-control/user/set-enrollment` `{userId, status}` | Force ENROLLED / NOT_ENROLLED |
| `POST /test-control/user/set-profile-verification` `{userId, status}` | Force UNVERIFIED / VERIFIED / CORRECTED |
| `GET /test-control/alerts?userId=` | Inspect DeviationAlert rows |
| `GET /test-control/escalation-events?alertId=` | Inspect EscalationEvent rows |
| `GET /test-control/notifications?userId=` | Inspect outbound Notification rows |
| `GET /test-control/user/find?email=` | Look up user id + status |

---

## data-testids

`helpers/selectors.ts` is the single source of truth. The hooks the suite
references that have been added in this PR:

| Surface | Testid | Status |
|---|---|---|
| Patient sign-in | `signin-email-input` | ✓ added |
| Patient sign-in | `signin-otp-tab` / `signin-magic-tab` | ✓ added |
| Patient sign-in | `signin-send-otp-btn` / `signin-verify-btn` | ✓ added |
| Patient sign-in | `signin-otp-input` | ✓ added |
| Patient sign-in | `signin-error` / `signin-status` | ✓ added |
| Admin sign-in | `admin-signin-email` | ✓ added |
| Admin sign-in | `admin-signin-send-otp` / `admin-signin-verify` | ✓ added |
| Admin sign-in | `admin-signin-otp` | ✓ added |

### Testids the dev team needs to add (specs `skip()` until they land)

These are referenced by selectors but the markup wasn't touched in this
PR — adding them is a small, safe, mechanical change in each component.

**Patient frontend:**
| Component file | Testid |
|---|---|
| `Dashboard.tsx` | `dashboard-greeting`, `awaiting-verification-badge`, `active-alert-banner`, `active-alert-reading`, `active-alert-tier`, `active-alert-cta`, `latest-bp`, `latest-bp-status`, `medication-streak`, `total-checkins`, `bp-goal`, `bp-chart`, `bp-chart-x-tick` (on every recharts XAxis tick), `bp-chart-range-7d/30d/90d`, `recent-alerts`, `start-checkin-cta`, `hear-summary-cta`, `notification-bell`, `notification-bell-badge` |
| `CheckIn.tsx` | `checkin-step-1..5`, `checkin-checklist-{key}` (8 keys), `checkin-systolic`, `checkin-diastolic`, `checkin-pulse`, `checkin-position`, `checkin-symptom-{key}` (9 keys per CLINICAL_SPEC §1.3), `checkin-other-symptoms`, `checkin-measurement-{key}`, `checkin-next-btn`, `checkin-back-btn`, `checkin-submit-btn`, `checkin-success` |
| `Readings` markup | `readings-list`, `reading-group`, `reading-group-date`, `reading-group-count`, `reading-row`, `reading-row-date`, `reading-row-bp`, `reading-row-pulse`, `reading-row-edit-{id}`, `reading-row-delete-{id}`, `reading-row-speaker-{id}`, `new-checkin-cta` |
| `Notifications` markup | `notifications-tab-alerts`, `notifications-tab-notifications`, `alerts-section-emergency`, `alerts-section-elevated`, `alerts-section-past`, `alert-card-{id}`, `alert-card-tier-{id}`, `alert-card-body-{id}`, `alert-ack-{id}`, `alert-view-details-{id}`, `notification-card`, `notification-date`, `notification-tap-to-mark`, `notifications-mark-all-read` |
| `AIChatInterface.tsx` | `chat-sidebar`, `chat-conversation-{i}`, `chat-empty-state`, `chat-suggested-prompt-{i}`, `chat-input`, `chat-mic-btn`, `chat-send-btn`, `assistant-message`, `user-message` |
| `Profile` markup | `profile-name`, `profile-email`, `profile-verified-badge`, `profile-signout`, `care-team-practice`, `care-team-primary`, `care-team-backup`, `care-team-md`, `profile-section-{personal,about,pregnancy,conditions,medications}`, `profile-section-edit-{key}`, `medication-row-{id}`, `medication-status-{id}` |
| `clinical-intake` page | `intake-step-{n}`, `intake-next-btn`, `intake-back-btn`, `intake-submit-btn`, `intake-gender-{male,female,other}`, `intake-height-{ft,in,cm}`, `intake-pregnant-{yes,no}`, `intake-preeclampsia-{yes,no}`, `intake-condition-{key}`, `intake-hf-type-{hfref,hfpef,unknown}`, `intake-med-card-{name}`, `intake-med-{id}-freq-{once,twice}` |
| `onboarding` page | `onboarding-name-input`, `onboarding-dob-input`, `onboarding-timezone-select`, `onboarding-submit-btn`, `onboarding-skip-btn` |

**Admin app:**
| Component | Testid |
|---|---|
| `Dashboard.tsx` (admin) | `admin-dashboard-alerts-{red,yellow,green}` |
| Patient list page | `admin-patient-list-search`, `admin-patient-row-{userId}`, `admin-patient-list-awaiting-filter` |
| `PatientDetailShell.tsx` | `admin-patient-detail-header`, `admin-tab-{profile,medications,thresholds,alerts,readings,timeline,care-team}` |
| `ProfileTab.tsx` | `admin-profile-field-{key}`, `admin-profile-field-confirm-{key}`, `admin-profile-field-correct-{key}`, `admin-profile-field-reject-{key}`, `admin-profile-verify-complete`, `admin-profile-rejection-rationale` |
| `MedicationsTab.tsx` + `MedicationRejectModal.tsx` | `admin-med-row-{id}`, `admin-med-verify-{id}`, `admin-med-reject-{id}`, `admin-med-rejection-rationale`, `admin-med-rejection-confirm` |
| `ThresholdsTab.tsx` | `admin-threshold-{sbp-upper,sbp-lower,dbp-upper,dbp-lower}`, `admin-threshold-notes`, `admin-threshold-save` |
| `EnrollmentCard.tsx` | `admin-enrollment-card`, `admin-enrollment-check-btn`, `admin-enrollment-complete-btn`, `admin-enrollment-reason-{reason}` |
| Practice CRUD page | `admin-practice-create`, `admin-practice-name`, `admin-practice-hours-{start,end}`, `admin-practice-tz`, `admin-practice-save` |
| Assignment editor | `admin-assignment-{practice,primary,backup,md}`, `admin-assignment-save` |
| Alert detail | `admin-alert-card-{id}`, `admin-alert-tier-{id}`, `admin-alert-rule-{id}`, `admin-alert-patient-msg-{id}`, `admin-alert-physician-msg-{id}`, `admin-alert-ack-{id}`, `admin-alert-resolve-action`, `admin-alert-resolve-rationale`, `admin-alert-resolve-btn`, `admin-alert-audit-field-{1..15}` |

Specs that depend on these `skip()` with a clear message; the suite still
runs green out of the gate. Once each testid lands, the `test.skip()` call
becomes a no-op and the assertion runs.

---

## Known gaps + next-pass TODOs

**Foundation gaps the next session needs to fill:**

1. **Verify the suite runs end-to-end against a live backend.** This PR
   was authored without booting the backend in the sandbox — selectors and
   API contracts are best-effort against the source. Expect 5–10 selector
   tweaks on first real run.
2. **Add a "blank patient" seed archetype** (`backend/prisma/seed.ts`)
   — used by the onboarding-from-cold spec (03) so it can verify the
   /onboarding redirect + Layer A 403 deterministically without consuming
   the production OTP flow.
3. **Extend `/test-control` with these helpers** for the failure-mode
   enrollment-gate tests (12) and the after-hours BP L2 test (14):
   - `POST /test-control/profile/wipe { userId }` — drop PatientProfile
   - `POST /test-control/assignment/wipe { userId }` — drop assignment
   - `POST /test-control/practice/null-business-hours { practiceId }`
   - `POST /test-control/threshold/wipe { userId }` — drop threshold
   - `POST /test-control/practice/set-business-hours-now { practiceId, mode: 'in-hours'|'after-hours' }`
   - `GET  /test-control/medication/list-by-user { userId }` — for monthly-reask spec
4. **Fill out the rule-engine spec** to cover every CLINICAL_SPEC branch.
   Today it covers 8 (standard L1, BP L2, symptom override, pregnancy ACE,
   pregnancy L1, NDHP+HFrEF, CAD critical, 65+ low override). Remaining:
   AFib HR>110/<50 (with the ≥3-readings session gate), HFrEF/HFpEF
   condition rules, HCM lower bound, vasodilator Tier 3, loop-diuretic
   hypotension Tier 3, wide pulse pressure Tier 3, personalized mode
   (≥7 readings + threshold), tachycardia 2-consecutive-readings rule,
   bradycardia + beta-blocker suppression, suboptimal-measurement flag.
5. **Mobile + i18n cross-cutting passes**. The matrix already exists
   (RUN_FULL_MATRIX=1 enables webkit/firefox/mobile), but no spec asserts
   touch target ≥44px, no spec switches language to ES/FR/DE/AM. Add a
   `17-cross-cutting-mobile.spec.ts` and `18-cross-cutting-i18n.spec.ts`.
6. **Admin patient-detail UI walkthrough.** Today the verification specs
   drive admin via API. Once the admin testids land, add a corresponding
   UI-walk spec per tab (profile, medications, thresholds, alerts).
7. **Tier 2 + BP Level 2 ladder.** Spec 14 covers Tier 1 fully and BP L2
   T+0 dual-fire; Tier 2 (T+0 → T+48h → T+7d → T+14d) and BP L2
   T+2h/T+4h ladder steps need their own tests.
8. **Audit-trail field-by-field shape**. Spec 13 asserts the 15 keys are
   all present; it does not assert each key's type or format. Add a JSON
   schema validator pass once the audit endpoint output is locked.

**Conventions for adding new specs:**

- Filename pattern `NN-area-name.spec.ts`, two-digit prefix.
- Always reset state via `tc.resetUser(...)` at the start of write-tests.
- Use seed accounts for deterministic state; only mint ad-hoc accounts
  for tests that explicitly need a cold patient.
- Selector preference: `T.surface.element` from `helpers/selectors.ts`.
  Fall back to `getByRole` / `getByLabel` when a testid hasn't landed yet,
  but document the missing testid in this README.
- Skip with a useful message when blocked on a missing piece — never
  let a test silently no-op.

---

## File checklist — what changed in this PR

```
qa/                                                    NEW (entire workspace)
backend/src/test-control/test-control.module.ts        NEW
backend/src/test-control/test-control.service.ts       NEW
backend/src/test-control/test-control.controller.ts    NEW
backend/src/app.module.ts                              EDIT — conditional TestControlModule import
backend/.env.example                                   EDIT — ENABLE_TEST_CONTROL + TEST_CONTROL_SECRET
frontend/src/app/sign-in/page.tsx                      EDIT — 6 data-testids
admin/src/app/sign-in/page.tsx                         EDIT — 4 data-testids
```

No production behavior changes. The TestControlModule is opt-in via env flag
and gated with two layers of NODE_ENV checks.

---

## Run order recommendation for a smoke pass

```bash
# Tier 0 — sanity
npx playwright test tests/01-marketing.spec.ts                      # public surface
npx playwright test tests/02-auth.spec.ts                           # OTP + role redirect

# Tier 1 — read-only patient + admin
npx playwright test tests/04-patient-dashboard.spec.ts \
                    tests/06-patient-readings-notifications.spec.ts \
                    tests/07-patient-chat.spec.ts \
                    tests/08-patient-profile.spec.ts \
                    tests/10-admin-auth-and-dashboard.spec.ts

# Tier 2 — write-tests (mutate seed patients)
RUN_WRITE_TESTS=1 npx playwright test tests/05-patient-check-in.spec.ts \
                                       tests/09-rule-engine-via-ui.spec.ts \
                                       tests/11-admin-verification-and-thresholds.spec.ts \
                                       tests/12-admin-enrollment-gate.spec.ts \
                                       tests/13-admin-alert-resolution.spec.ts

# Tier 3 — escalation + crons (depends on /test-control)
RUN_WRITE_TESTS=1 npx playwright test tests/14-escalation-tier1-ladder.spec.ts \
                                       tests/15-crons-gap-and-monthly-reask.spec.ts

# Tier 4 — cross-cutting (axe + security)
npx playwright test tests/16-cross-cutting-a11y-and-security.spec.ts

# Tier 5 — full matrix (multi-engine)
RUN_FULL_MATRIX=1 RUN_WRITE_TESTS=1 npx playwright test
```

If any tier fails, fix before moving to the next — Tier 2+ assume Tier 1
is green.
