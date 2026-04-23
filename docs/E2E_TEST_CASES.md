# End-to-End Test Cases — Cardioplace v2

Companion to [TESTING_FLOW_GUIDE.md](TESTING_FLOW_GUIDE.md) — **read that first** for system context, state machines, and setup.

This document is a comprehensive, numbered pass/fail test matrix covering every HTTP endpoint, every clinical rule scenario, and every user-facing flow across patient + admin apps. Use it as an acceptance-test checklist before cutting a release candidate.

---

## Conventions

- **Test ID format**: `TC-<section>.<num>` (e.g. `TC-INT.03` = Intake section, case 3).
- **Layer tags**: every test is tagged `[UNIT]`, `[INTEG]`, `[E2E]`, `[MANUAL]`, or `[PLAYWRIGHT]`. See §0.5 for what each layer means.
- **Prereqs**: DB state required before the test. Usually assumes a fresh `prisma migrate reset --force && prisma db seed`.
- **Role**: the role on the JWT. `PATIENT`, `PROVIDER`, `MEDICAL_DIRECTOR`, `HEALPLACE_OPS`, `SUPER_ADMIN`, or `anon`.
- **Request**: `METHOD /path` + body (YAML-ish for brevity).
- **Expected**: HTTP status + response shape + DB side effect.
- **PASS / FAIL**: clearly marked so you can tell at a glance which cases exercise the unhappy path.

For repeated assertions ("one `ProfileVerificationLog` row per edit", "audit fields populated") we include one explicit case and note "apply same check" on follow-ups.

**Today's date for time-sensitive tests**: use `2026-04-23` unless otherwise noted.

---

## Index

| Section | Scope |
|---|---|
| [0. Preflight](#0-preflight) | Infra + seed sanity |
| [0.5. Testing layers](#05-testing-layers) | What each layer tests and when to use it |
| [1. Auth](#1-auth) | OTP, magic link, refresh, logout, /me, /profile |
| [2. Basic onboarding](#2-basic-onboarding) | `POST /v2/auth/profile` |
| [3. Clinical intake — Patient](#3-clinical-intake--patient) | `/intake/profile`, `/intake/medications`, `/me/medications`, `/me/pregnancy` |
| [4. Admin profile + med verification](#4-admin-profile--med-verification) | `/admin/users/:id/*`, `/admin/medications/:id/*` |
| [5. Practice CRUD](#5-practice-crud) | `/admin/practices` |
| [6. Care team assignment](#6-care-team-assignment) | `/admin/patients/:id/assignment`, `/admin/clinicians` |
| [7. Patient threshold](#7-patient-threshold) | `/admin/patients/:id/threshold`, `/me/threshold` |
| [8. Enrollment gate](#8-enrollment-gate) | `/admin/patients/:id/complete-onboarding`, `/enrollment-check` |
| [9. Journal entry — Patient](#9-journal-entry--patient) | `POST /daily-journal`, validation, session grouping, Layer A gate |
| [10. Rule engine coverage](#10-rule-engine-coverage) | 57 scenarios by tier + age buckets |
| [11. Patient-facing reads](#11-patient-facing-reads) | `/me/*`, `/daily-journal/*` GETs |
| [12. Alert resolution](#12-alert-resolution) | acknowledge, resolve, audit, rationale gates |
| [13. Escalation ladder](#13-escalation-ladder) | Tier 1 / Tier 2 / BP L2, after-hours, retry |
| [14. Crons](#14-crons) | Gap alert, monthly re-ask, escalation scanner |
| [15. Role-based access control](#15-role-based-access-control) | Negative authz tests |
| [16. Chat + legacy endpoints](#16-chat--legacy-endpoints) | Chat, provider/v1, content |
| [17. Frontend — Patient app (Playwright + manual)](#17-frontend--patient-app) | UI flows, click paths |
| [18. Frontend — Admin app (Playwright + manual)](#18-frontend--admin-app) | UI flows, click paths |
| [19. Cross-layer — Medication rejection flow](#19-cross-layer--medication-rejection-flow) | End-to-end rejection happy/sad paths |
| [20. Cross-layer — Profile verification UI flow](#20-cross-layer--profile-verification-ui-flow) | End-to-end verification |
| [21. Cross-layer — Medication verification UI flow](#21-cross-layer--medication-verification-ui-flow) | End-to-end med verify |
| [22. Cross-layer — "Awaiting Verification" badge](#22-cross-layer--awaiting-verification-badge) | Badge rendering across pages |
| [23. Step 8–11 branches (expanded)](#23-step-811-branches-expanded) | Every branch of §8 in flow guide |
| [24. Unit test prescriptions](#24-unit-test-prescriptions) | Service-level coverage |
| [25. Integration test prescriptions](#25-integration-test-prescriptions) | Controller + DB coverage |
| [26. Cross-cutting data integrity](#26-cross-cutting-data-integrity) | Post-suite DB checks |
| [27. Performance sanity](#27-performance-sanity) | Load sanity |
| [28. Regression set](#28-regression-set) | Merge-blockers |
| [29. Filing bugs](#29-filing-bugs) | Ticket template |

---

## 0. Preflight

Run before every full test pass.

| TC | Layer | Description | Expected |
|---|---|---|---|
| **TC-PRE.01** | [E2E] | `GET /` with no auth | `200 "Hello from Cardioplace!"` |
| **TC-PRE.02** | [E2E] | `npx prisma migrate reset --force` on test DB | Exit 0; migrations `20260422160119_phase7_escalation_ladder` applied |
| **TC-PRE.03** | [E2E] | `npx prisma db seed` | Exit 0; 5 patients + 4 providers + 1 practice + 1 assignment per patient |
| **TC-PRE.04** | [E2E] | Backend `npm run start:dev` on port 4000 | No errors; `OutputGeneratorService` boot-time registry check passes |
| **TC-PRE.05** | [E2E] | `GET /v2/auth/me` with seed admin JWT | 200 with `roles: ["SUPER_ADMIN"]` |
| **TC-PRE.06** | [MANUAL] | Frontend `npm run dev` on port 3000 | `/` renders; no console errors; network tab shows calls to `:4000` |
| **TC-PRE.07** | [MANUAL] | Admin `npm run dev` on port 3001 | `/` renders; no console errors |
| **TC-PRE.08** | [PLAYWRIGHT] | Playwright config points at `http://localhost:3000` and `http://localhost:3001` with separate test contexts | Both contexts reachable; `page.goto('/')` returns 200 HTML |

---

## 0.5. Testing layers

Every test case is classified by layer. Choose the right one — don't put integration concerns into unit tests or vice versa.

| Layer | Purpose | Tooling | Runs |
|---|---|---|---|
| `[UNIT]` | One class/function, all collaborators mocked. Fast (<1s each). Asserts **logic**, not wiring. | Jest with `@nestjs/testing` + manual mocks. Files: `*.spec.ts` next to source. | `cd backend && npm test` |
| `[INTEG]` | One controller or service + real Prisma + real DB transaction, HTTP layer bypassed. Asserts **wiring + DB side effects**. | Jest + `PrismaClient` pointing at test DB. Tearsdown per test. | Separate jest config — `npm run test:integ` (to be set up) |
| `[E2E]` | Full HTTP request against live backend. Asserts **contract + end-to-end side effects**. The bulk of this document. | Supertest or plain fetch against `localhost:4000` + direct DB queries for side-effect verification | `npm run test:e2e` |
| `[MANUAL]` | Human clicks through a flow. For visual regressions, clinical sign-off scenarios, AI responses. | Tester + a doc checklist | Pre-release gate |
| `[PLAYWRIGHT]` | Scripted browser click path. Asserts **UI rendering + correct API calls**. | `@playwright/test` against both Next apps + a seeded backend | `npx playwright test` |

### When to use which

- A rule engine edge case? → **[UNIT]** on `alert-engine.service.spec.ts`; optionally a **[E2E]** smoke test.
- Controller authz guard? → **[E2E]** is the only reliable check.
- "After patient edit, admin should see red badge"? → **[PLAYWRIGHT]** across both apps + **[E2E]** on the underlying GET.
- "Does the Tier 1 modal refuse empty rationale"? → **[PLAYWRIGHT]** (UI-level form validation) + **[E2E]** (backend rejects it too — defense in depth).
- Chat guardrails / AI response wording? → **[MANUAL]** — deterministic assertions on LLM output are fragile.

### Existing unit coverage (don't re-write)

[TEST_SCENARIOS.md](TEST_SCENARIOS.md) already has **182 passing unit cases** across:
- `profile-resolver.service.spec.ts` — 30 tests
- `derivatives.spec.ts` — 21 tests
- `session-averager.service.spec.ts` — 8 tests
- `rules.spec.ts` — 75 tests (all 57 scenarios from ALERT_SCENARIOS + helper unit cases)
- `alert-engine.service.spec.ts` — 25 tests
- `output-generator.service.spec.ts` — 11 tests

**Reference these, don't duplicate.** §24 below adds prescriptions for services NOT yet covered (EscalationService, AlertResolutionService, enrollment-gate, cron services).

---

## 1. Auth

All endpoints at `/v2/auth/*`. See [auth.controller.ts](../backend/src/auth/auth.controller.ts).

### 1.1 OTP flow (PASS)

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-AUTH.01** | [E2E] | `POST /v2/auth/otp/send  { email: "priya.menon@cardioplace.test" }` | 200, `{ statusCode: 200, email, otp_valid_for_minutes: 10 }` |
| **TC-AUTH.02** | [E2E] | `POST /v2/auth/otp/verify  { email, otp: "666666", deviceId: "test-device-1" }` (seed perma-OTP) | 200, `{ userId, accessToken, refreshToken, roles:["PATIENT"], onboarding_required: false }`; sets `refresh_token` httpOnly cookie |
| **TC-AUTH.03** | [E2E] | Fresh signup — `POST /v2/auth/otp/send { email: "new@test.com" }` then verify | 200 + `onboarding_required: true`; User row created with `onboardingStatus: NOT_COMPLETED` |

### 1.2 OTP flow (FAIL)

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-AUTH.04** | [E2E] | `POST /v2/auth/otp/verify  { email, otp: "000000" }` | 401 / 400 — wrong OTP |
| **TC-AUTH.05** | [E2E] | `POST /v2/auth/otp/verify` after 11 minutes (or manually expire token) | 401 — OTP expired |
| **TC-AUTH.06** | [E2E] | `POST /v2/auth/otp/verify  { email, otp: "666666" }` with no `deviceId` (neither header nor body) | 400 — device id required |
| **TC-AUTH.07** | [E2E] | `POST /v2/auth/otp/send  { email: "not-an-email" }` | 400 — class-validator `IsEmail` |

### 1.3 Magic link

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-AUTH.08** | [E2E] | `POST /v2/auth/magic-link/send  { email }` | 200; email sent with 24h token |
| **TC-AUTH.09** | [E2E] | `GET /v2/auth/magic-link/verify?token=<valid>` for PATIENT | 302 redirect to `${WEB_APP_URL}?accessToken=...&refreshToken=...` |
| **TC-AUTH.10** | [E2E] | Same for SUPER_ADMIN | 302 redirect to `${ADMIN_APP_URL}` (different URL) |
| **TC-AUTH.11** | [E2E] | `GET /v2/auth/magic-link/verify?token=<expired>` | 401 |

### 1.4 Token lifecycle

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-AUTH.12** | [E2E] | `POST /v2/auth/refresh  { refreshToken }` | 200 `{ accessToken, refreshToken }`; previous refresh rotated/revoked |
| **TC-AUTH.13** | [E2E] | `POST /v2/auth/refresh` with cookie `refresh_token=<valid>` (no body) | Same as above — cookie fallback |
| **TC-AUTH.14** | [E2E] | `POST /v2/auth/refresh  { refreshToken: "<revoked>" }` | 401 |
| **TC-AUTH.15** | [E2E] | `POST /v2/auth/logout  { refreshToken }` with valid access token | 200 `{ message }`; refresh token revoked in DB; cookie cleared |
| **TC-AUTH.16** | [E2E] | `POST /v2/auth/logout` with no JWT | 401 — requires JwtAuthGuard |

### 1.5 `/me` and `/profile`

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-AUTH.17** | [E2E] | `GET /v2/auth/me` with JWT | 200 — echoes JWT payload `{ id, roles, email, name }` |
| **TC-AUTH.18** | [E2E] | `GET /v2/auth/profile` with PATIENT JWT | 200 — User row with identity fields + `profileVerificationStatus` etc. |
| **TC-AUTH.19** | [E2E] | `GET /v2/auth/me` with no JWT | 401 |

---

## 2. Basic onboarding

### 2.1 PASS

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-ONB.01** | [E2E] | `POST /v2/auth/profile  { name: "Priya M", dateOfBirth: "1992-05-14", communicationPreference: "TEXT_FIRST", preferredLanguage: "en", timezone: "America/New_York" }` | 200; User.onboardingStatus → COMPLETED; dateOfBirth stored |
| **TC-ONB.02** | [E2E] | Same request a second time — idempotent re-run | 200; no error (patch semantics) |
| **TC-ONB.03** | [E2E] | `PATCH /v2/auth/profile  { name: "New Name" }` | 200; profileVerificationStatus flips to UNVERIFIED if any clinical-relevant field changed (name itself should NOT flip — verify behavior matches) |

### 2.2 FAIL

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-ONB.04** | [E2E] | `POST /v2/auth/profile  { dateOfBirth: "2040-01-01" }` (future date) | 400 — dateOfBirth must be in the past |
| **TC-ONB.05** | [E2E] | `POST /v2/auth/profile  { dateOfBirth: "not-a-date" }` | 400 — format |
| **TC-ONB.06** | [E2E] | `POST /v2/auth/profile  { timezone: "Not/A_Zone" }` | 400 — IANA tz validation |
| **TC-ONB.07** | [E2E] | `POST /v2/auth/profile  { name: "x".repeat(150) }` | 400 — max length 100 |
| **TC-ONB.08** | [E2E] | `POST /v2/auth/profile  { communicationPreference: "VOICE_ONLY" }` | 400 — enum |

---

## 3. Clinical intake — Patient

See [intake.controller.ts](../backend/src/intake/intake.controller.ts). All endpoints require JWT.

### 3.1 Profile intake (PASS)

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-INT.01** | [E2E] | `POST /intake/profile  { gender: "FEMALE", heightCm: 165, isPregnant: true, pregnancyDueDate: "2026-09-01", historyPreeclampsia: false }` | 200; PatientProfile upserted; `profileVerificationStatus: UNVERIFIED`; `profileLastEditedAt: now`; one ProfileVerificationLog row |
| **TC-INT.02** | [E2E] | `POST /intake/profile  { hasHeartFailure: true, heartFailureType: "HFREF" }` | 200; HF fields stored |
| **TC-INT.03** | [E2E] | `POST /intake/profile  { hasHeartFailure: true, heartFailureType: "UNKNOWN" }` | 200; resolver will bias to HFREF later |
| **TC-INT.04** | [E2E] | Second `POST /intake/profile  { heightCm: 170 }` after TC-INT.01 | 200; profileVerificationStatus flips back to UNVERIFIED (or stays UNVERIFIED); new ProfileVerificationLog row for `heightCm` change |
| **TC-INT.05** | [E2E] | `GET /me/profile` after TC-INT.01 | 200; returns the full PatientProfile |

### 3.2 Profile intake (FAIL)

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-INT.06** | [E2E] | `POST /intake/profile  { gender: "UNKNOWN" }` | 400 — not in enum |
| **TC-INT.07** | [E2E] | `POST /intake/profile  { heightCm: 50 }` | 400 — below 100 cm |
| **TC-INT.08** | [E2E] | `POST /intake/profile  { heightCm: 300 }` | 400 — above 250 cm |
| **TC-INT.09** | [E2E] | `POST /intake/profile  { heartFailureType: "DILATED" }` | 400 — not in enum |
| **TC-INT.10** | [E2E] | `POST /intake/profile  { pregnancyDueDate: "not-a-date" }` | 400 |
| **TC-INT.11** | [E2E] | `POST /intake/profile` with no JWT | 401 |

### 3.3 Medication intake (PASS)

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-INT.20** | [E2E] | `POST /intake/medications  { medications: [{ drugName:"Lisinopril", drugClass:"ACE_INHIBITOR", frequency:"ONCE_DAILY", source:"PATIENT_SELF_REPORT" }] }` | 201; one PatientMedication row; `verificationStatus: AWAITING_PROVIDER`; profile flipped to UNVERIFIED |
| **TC-INT.21** | [E2E] | `POST /intake/medications` with 3 meds | 201; 3 rows |
| **TC-INT.22** | [E2E] | Combo: `{ drugName:"Zestoretic", drugClass:"OTHER_UNVERIFIED", isCombination:true, combinationComponents:["ACE_INHIBITOR","THIAZIDE"], frequency:"ONCE_DAILY" }` | 201; isCombination + combinationComponents stored |
| **TC-INT.23** | [E2E] | `GET /me/medications` | 200; active meds only (discontinued excluded by default) |
| **TC-INT.24** | [E2E] | `GET /me/medications?includeDiscontinued=true` | 200; all meds |
| **TC-INT.25** | [E2E] | `PATCH /me/medications/:id  { frequency: "TWICE_DAILY" }` | 200; verificationStatus flips to UNVERIFIED; ProfileVerificationLog row |
| **TC-INT.26** | [E2E] | `PATCH /me/medications/:id  { discontinue: true }` | 200; `discontinuedAt: now`; verificationStatus **NOT** flipped |
| **TC-INT.27** | [E2E] | `PUT /me/medications  { medications: [...] }` (bulk replace with different set) | 200; old rows soft-deleted; new rows created; profile UNVERIFIED |
| **TC-INT.28** | [E2E] | `PUT /me/medications  { medications: [] }` (empty replace) | 200; all meds soft-deleted |

### 3.4 Medication intake (FAIL)

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-INT.30** | [E2E] | `POST /intake/medications  { medications: [] }` | 400 — min 1 item |
| **TC-INT.31** | [E2E] | `POST /intake/medications  { medications: [{ drugClass:"BETA_BLOCKER" }] }` (missing drugName) | 400 |
| **TC-INT.32** | [E2E] | `POST /intake/medications  { medications: [{ drugName:"X", drugClass:"NOT_A_CLASS", frequency:"ONCE_DAILY" }] }` | 400 — enum |
| **TC-INT.33** | [E2E] | `POST /intake/medications  { medications: [{ drugName:"X", drugClass:"ACE_INHIBITOR", frequency:"FOUR_TIMES" }] }` | 400 — enum |
| **TC-INT.34** | [E2E] | `PATCH /me/medications/<other-user-id>  { frequency: "TWICE_DAILY" }` | 404 — ownership check |
| **TC-INT.35** | [E2E] | `PUT /me/medications  { medications: [...51 items] }` | 400 — max 50 |
| **TC-INT.36** | [E2E] | `POST /intake/medications` with no JWT | 401 |

### 3.5 Pregnancy endpoint

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-INT.40** | [E2E] | `POST /me/pregnancy  { isPregnant: true, pregnancyDueDate: "2026-09-01" }` | 200; PatientProfile updated; UNVERIFIED |
| **TC-INT.41** | [E2E] | `POST /me/pregnancy  { isPregnant: false, pregnancyDueDate: null }` | 200; due date cleared |
| **TC-INT.42** | [E2E] | `POST /me/pregnancy  { isPregnant: true, historyPreeclampsia: true }` | 200 |
| **TC-INT.43** | [E2E] | `POST /me/pregnancy  { isPregnant: "yes" }` | 400 — bool required |

---

## 4. Admin profile + med verification

See [admin-intake.controller.ts](../backend/src/intake/admin-intake.controller.ts). Guard: `@Roles(SUPER_ADMIN, PROVIDER, MEDICAL_DIRECTOR)`.

### 4.1 Profile verify (PASS)

| TC | Layer | Prereqs | Request | Expected |
|---|---|---|---|---|
| **TC-ADM.01** | [E2E] | Patient has UNVERIFIED profile | `POST /admin/users/:id/verify-profile  { }` as PROVIDER | 200; `profileVerificationStatus: VERIFIED`; `profileVerifiedAt: now`; `profileVerifiedBy: adminId`; one ProfileVerificationLog row with `changeType: ADMIN_VERIFY` |
| **TC-ADM.02** | [E2E] | Same | `POST /admin/users/:id/verify-profile  { rationale: "Chart reviewed" }` | 200; rationale stored in log |
| **TC-ADM.03** | [E2E] | Patient has VERIFIED profile; patient then edits (TC-INT.04 style); admin verifies again | 200; transitions UNVERIFIED → VERIFIED again; new log row |

### 4.2 Profile correct (PASS)

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-ADM.04** | [E2E] | `POST /admin/users/:id/correct-profile  { corrections: { heightCm: 170 }, rationale: "Measured in clinic" }` | 200; PatientProfile.heightCm = 170; `profileVerificationStatus: CORRECTED`; `discrepancyFlag: true` on log row |
| **TC-ADM.05** | [E2E] | Correct with no rationale | 400 — rationale is required |
| **TC-ADM.06** | [E2E] | Correct with rationale > 2000 chars | 400 |

### 4.3 Profile reject field (PASS)

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-ADM.07** | [E2E] | `POST /admin/users/:id/reject-profile-field  { field: "hasHeartFailure", rationale: "Not in chart" }` | 200; profileVerificationStatus → UNVERIFIED; patient notified; log row `changeType: ADMIN_REJECT` |

### 4.4 Medication verify (PASS)

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-ADM.10** | [E2E] | `POST /admin/medications/:id/verify  { status: "VERIFIED" }` | 200; PatientMedication.verificationStatus = VERIFIED; verifiedAt + verifiedByAdminId set |
| **TC-ADM.11** | [E2E] | `POST /admin/medications/:id/verify  { status: "REJECTED", rationale: "Patient confused Lisinopril with Losartan" }` | 200; REJECTED; patient notification sent — **see §19 for full rejection flow** |
| **TC-ADM.12** | [E2E] | `GET /admin/users/:id/medications` | 200; all meds incl. discontinued |
| **TC-ADM.13** | [E2E] | `GET /admin/users/:id/verification-logs` | 200; chronological array of all log rows |

### 4.5 Admin authz (FAIL)

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-ADM.20** | [E2E] | `POST /admin/users/:id/verify-profile` as PATIENT | 403 |
| **TC-ADM.21** | [E2E] | `POST /admin/users/:id/verify-profile` as HEALPLACE_OPS | 403 (HEALPLACE_OPS is not in the admin-intake guard — verify against controller) |
| **TC-ADM.22** | [E2E] | `POST /admin/users/:id/verify-profile` with no JWT | 401 |
| **TC-ADM.23** | [E2E] | `POST /admin/users/<nonexistent>/verify-profile` as MEDICAL_DIRECTOR | 404 |

---

## 5. Practice CRUD

See [practice.controller.ts](../backend/src/practice/practice.controller.ts). Guard: `@Roles(SUPER_ADMIN, MEDICAL_DIRECTOR, HEALPLACE_OPS)`. **PROVIDER intentionally excluded.**

### 5.1 PASS

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-PR.01** | [E2E] | `POST /admin/practices  { name:"East Clinic", businessHoursStart:"08:00", businessHoursEnd:"18:00", businessHoursTimezone:"America/New_York", afterHoursProtocol:"Page on-call" }` as MEDICAL_DIRECTOR | 201; Practice row; id returned |
| **TC-PR.02** | [E2E] | `GET /admin/practices` | 200; array incl. seed Cedar Hill |
| **TC-PR.03** | [E2E] | `GET /admin/practices/:id` | 200 |
| **TC-PR.04** | [E2E] | `GET /admin/practices/:id/staff` | 200; providers from PatientProviderAssignment rows joined |
| **TC-PR.05** | [E2E] | `PATCH /admin/practices/:id  { businessHoursEnd: "20:00" }` | 200; partial update |

### 5.2 FAIL

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-PR.10** | [E2E] | `POST /admin/practices  { businessHoursStart: "8am" }` | 400 — HH:MM regex |
| **TC-PR.11** | [E2E] | `POST /admin/practices  { businessHoursStart: "25:00" }` | 400 |
| **TC-PR.12** | [E2E] | `POST /admin/practices  { name: "" }` | 400 — required |
| **TC-PR.13** | [E2E] | `POST /admin/practices  { name: "x".repeat(201) }` | 400 — max 200 |
| **TC-PR.14** | [E2E] | `POST /admin/practices` as PROVIDER | 403 |
| **TC-PR.15** | [E2E] | `POST /admin/practices` as PATIENT | 403 |
| **TC-PR.16** | [E2E] | `GET /admin/practices/<nonexistent>` | 404 |

---

## 6. Care team assignment

See [assignment.controller.ts](../backend/src/practice/assignment.controller.ts), [clinician.controller.ts](../backend/src/practice/clinician.controller.ts). Guard: `@Roles(SUPER_ADMIN, MEDICAL_DIRECTOR, HEALPLACE_OPS)`.

### 6.1 Clinician lookup

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-ASG.01** | [E2E] | `GET /admin/clinicians` | 200; default filter includes PROVIDER + MEDICAL_DIRECTOR |
| **TC-ASG.02** | [E2E] | `GET /admin/clinicians?role=MEDICAL_DIRECTOR` | 200; only MD |
| **TC-ASG.03** | [E2E] | `GET /admin/clinicians?role=PATIENT` | 200; empty array (filtered out) |

### 6.2 Assignment PASS

| TC | Layer | Prereqs | Request | Expected |
|---|---|---|---|---|
| **TC-ASG.10** | [E2E] | Patient has PatientProfile, practice exists | `POST /admin/patients/:userId/assignment  { practiceId, primaryProviderId, backupProviderId, medicalDirectorId }` | 201; PatientProviderAssignment row |
| **TC-ASG.11** | [E2E] | Existing assignment | `GET /admin/patients/:userId/assignment` | 200; with provider names denormalized |
| **TC-ASG.12** | [E2E] | Existing | `PATCH /admin/patients/:userId/assignment  { backupProviderId: <new> }` | 200 |
| **TC-ASG.13** | [E2E] | `GET /me/care-team` as patient | 200; same data, patient-safe fields |
| **TC-ASG.14** | [E2E] | Patient with no assignment | `GET /me/care-team` | 200 returning `null` (NOT 404) |

### 6.3 Assignment FAIL

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-ASG.20** | [E2E] | `POST /admin/patients/:userId/assignment  { primaryProviderId: "<patient-id>", ... }` (PATIENT id as provider) | 400/422 — role check: primary/backup must be PROVIDER or MEDICAL_DIRECTOR |
| **TC-ASG.21** | [E2E] | `POST ... { medicalDirectorId: "<provider-id>" }` (PROVIDER id as MD) | 400 — MD slot strictly requires MEDICAL_DIRECTOR role |
| **TC-ASG.22** | [E2E] | `POST ... { practiceId: "nonexistent" }` | 404 / 400 |
| **TC-ASG.23** | [E2E] | `POST` as PROVIDER | 403 |

---

## 7. Patient threshold

See [threshold.controller.ts](../backend/src/practice/threshold.controller.ts). Guard: `@Roles(SUPER_ADMIN, MEDICAL_DIRECTOR)` (PROVIDER excluded — threshold is a clinical directive).

### 7.1 PASS

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-THR.01** | [E2E] | `POST /admin/patients/:userId/threshold  { sbpUpperTarget: 130, sbpLowerTarget: 100, dbpUpperTarget: 85, dbpLowerTarget: 70, hrUpperTarget: 100, hrLowerTarget: 55, notes: "Post-MI, tight control" }` as MEDICAL_DIRECTOR | 201; PatientThreshold row; setByProviderId = admin id |
| **TC-THR.02** | [E2E] | `GET /admin/patients/:userId/threshold` | 200 |
| **TC-THR.03** | [E2E] | `PATCH /admin/patients/:userId/threshold  { sbpLowerTarget: 90 }` | 200; partial update; setAt bumped |
| **TC-THR.04** | [E2E] | `GET /me/threshold` as patient | 200; returns PatientThreshold |
| **TC-THR.05** | [E2E] | `GET /me/threshold` as patient with no threshold | 200 `null` (NOT 404) |

### 7.2 FAIL

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-THR.10** | [E2E] | POST twice (threshold already exists) | 409 — use PATCH instead |
| **TC-THR.11** | [E2E] | `POST ... { sbpUpperTarget: 30 }` | 400 — below 60 min |
| **TC-THR.12** | [E2E] | `POST ... { sbpUpperTarget: 300 }` | 400 — above 250 max |
| **TC-THR.13** | [E2E] | `POST` as PROVIDER | 403 |
| **TC-THR.14** | [E2E] | `PATCH` when no threshold exists | 404 |
| **TC-THR.15** | [E2E] | `POST ... { notes: "x".repeat(3000) }` | 400 — max 2000 |

---

## 8. Enrollment gate

Most critical gate in the system. See [enrollment-gate.ts](../backend/src/practice/enrollment-gate.ts), [enrollment.controller.ts](../backend/src/practice/enrollment.controller.ts).

Each subsection isolates **one reason** and asserts the `reasons[]` array contains it.

### 8.1 PASS (all checks satisfied)

| TC | Layer | Prereqs | Request | Expected |
|---|---|---|---|---|
| **TC-ENR.01** | [E2E] | Patient with profile + assignment + practice with business hours + (threshold for HFrEF only) | `POST /admin/patients/:id/complete-onboarding` | 200; User.onboardingStatus = COMPLETED; data `{ userId, completedBy }` |
| **TC-ENR.02** | [E2E] | Same after TC-ENR.01 succeeds — idempotent replay | 200 no-op (already completed) |
| **TC-ENR.03** | [E2E] | Same prereqs | `GET /admin/patients/:id/enrollment-check` | 200 `{ ok: true }` |

### 8.2 FAIL — one reason at a time

| TC | Layer | Prereq removed | Expected `reasons[]` |
|---|---|---|---|
| **TC-ENR.10** | [E2E] | No PatientProviderAssignment | 409, reasons include `"no-assignment"` |
| **TC-ENR.11** | [E2E] | Assignment exists; Practice missing `businessHoursStart` | 409, `"practice-missing-business-hours"` |
| **TC-ENR.12** | [E2E] | Assignment; practice ok; no PatientProfile | 409, `"patient-profile-missing"` |
| **TC-ENR.13** | [E2E] | Profile has `heartFailureType: HFREF`, no PatientThreshold | 409, `"threshold-required-for-condition"` |
| **TC-ENR.14** | [E2E] | Profile has `hasHCM: true`, no threshold | 409, `"threshold-required-for-condition"` |
| **TC-ENR.15** | [E2E] | Profile has `hasDCM: true`, no threshold | 409, `"threshold-required-for-condition"` |
| **TC-ENR.16** | [E2E] | Profile has `heartFailureType: HFPEF`, no threshold | **200** (HFpEF does NOT gate) |
| **TC-ENR.17** | [E2E] | Profile has `heartFailureType: UNKNOWN`, no threshold | Verify against code — gate uses raw type. Expected: 200 (UNKNOWN does not gate, same as HFpEF). Document actual behavior. |

### 8.3 Multiple reasons combined

| TC | Layer | Prereqs | Expected |
|---|---|---|---|
| **TC-ENR.20** | [E2E] | No assignment AND no profile | 409, reasons includes `"no-assignment"` AND `"patient-profile-missing"` (full array) |
| **TC-ENR.21** | [E2E] | No assignment AND HFrEF without threshold | 409, reasons includes both |

### 8.4 Read-only check

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-ENR.30** | [E2E] | `GET /admin/patients/:id/enrollment-check` when gate fails | 200 `{ ok: false, reasons: [...] }`; no side effects |
| **TC-ENR.31** | [E2E] | `GET /admin/patients/:id/enrollment-check` as PATIENT | 403 |

---

## 9. Journal entry — Patient

See [daily_journal.controller.ts](../backend/src/daily_journal/daily_journal.controller.ts), [daily_journal.service.ts](../backend/src/daily_journal/daily_journal.service.ts).

**Layer A gate** ([TESTING_FLOW_GUIDE.md §6.1](TESTING_FLOW_GUIDE.md)): `PatientProfile` must exist or `POST /daily-journal` returns 403 `{ message: "clinical-intake-required" }`. Enforced in [daily_journal.service.ts](../backend/src/daily_journal/daily_journal.service.ts) `create()`.

### 9.1 Create entry PASS

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-JNL.01** | [E2E] | `POST /daily-journal  { measuredAt: "<now>", systolicBP: 125, diastolicBP: 78, pulse: 72, position: "SITTING" }` (PatientProfile exists) | 202; data.id returned; ENTRY_CREATED event emitted |
| **TC-JNL.02** | [E2E] | Same with `sessionId: "<uuid>"` | 202; sessionId stored |
| **TC-JNL.03** | [E2E] | `POST /daily-journal  { measuredAt, systolicBP: 125, diastolicBP: 78, severeHeadache: true }` | 202; structured symptom stored |
| **TC-JNL.04** | [E2E] | `POST /daily-journal  { measuredAt, measurementConditions: { noCaffeine: true, seatedRest: false, ... } }` | 202; JSON stored; later readings in same session flag suboptimal |
| **TC-JNL.05** | [E2E] | `POST /daily-journal  { measuredAt, otherSymptoms: ["dizzy"], symptoms: ["legacy"] }` | 202; both merged into otherSymptoms column |

### 9.2 Layer A journaling gate

| TC | Layer | Setup | Request | Expected |
|---|---|---|---|---|
| **TC-JNL.GATE.01** | [E2E] | User authenticated; no `PatientProfile` row | `POST /daily-journal { ... }` | **403** body matches `{ message: "clinical-intake-required", reason: "..." }`; no JournalEntry row written |
| **TC-JNL.GATE.02** | [E2E] | Admin user (SUPER_ADMIN) with no PatientProfile | Same | **403** |
| **TC-JNL.GATE.03** | [E2E] | Patient completes clinical intake → POST | **202** accepted; rule engine runs with UNVERIFIED safety-net biases |
| **TC-JNL.GATE.04** | [E2E] | Patient with PatientProfile but `enrollmentStatus: NOT_ENROLLED` (no admin enrollment yet) | `POST /daily-journal` | **202** accepted; alert fires if warranted; **escalation does NOT dispatch** (Layer B gate holds); DeviationAlert rows visible on dashboard; no Notification rows |
| **TC-JNL.GATE.05** | [E2E] | Enrolled patient submits reading that fires Tier 1 | 202; DeviationAlert + EscalationEvent both written; Notification fan-out happens |

### 9.3 Create entry FAIL (validation)

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-JNL.10** | [E2E] | `measuredAt: "<now + 10 min>"` | 400 — beyond 5-min future slack |
| **TC-JNL.11** | [E2E] | `measuredAt: "<now - 31 days>"` | 400 — beyond 30-day backfill limit |
| **TC-JNL.12** | [E2E] | Second `POST` with **exact same** `measuredAt` | 409 — `@@unique([userId, measuredAt])` |
| **TC-JNL.13** | [E2E] | `systolicBP: 300` | 400 — above 250 max |
| **TC-JNL.14** | [E2E] | `systolicBP: 50` | 400 — below 60 min |
| **TC-JNL.15** | [E2E] | `position: "STANDING_ON_HANDS"` | 400 — enum |
| **TC-JNL.16** | [E2E] | No JWT | 401 |
| **TC-JNL.17** | [E2E] | Missing required `measuredAt` | 400 |

### 9.4 Update / delete

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-JNL.20** | [E2E] | `PUT /daily-journal/:id  { systolicBP: 130 }` | 202; ENTRY_UPDATED emitted; rule engine re-evaluates |
| **TC-JNL.21** | [E2E] | `PUT /daily-journal/<other-user-id>  { }` | 404 |
| **TC-JNL.22** | [E2E] | `DELETE /daily-journal/:id` | 200; deleted; ENTRY_UPDATED emitted for siblings so rule engine re-evaluates surviving readings |

### 9.5 Session grouping

| TC | Layer | Setup | Expected alert mode |
|---|---|---|---|
| **TC-JNL.30** | [E2E] | Two readings with same `sessionId`, 5 min apart, both 165/95 | Mean 165/95 applied to rule engine; **one** alert, not two |
| **TC-JNL.31** | [E2E] | Two readings no sessionId, 10 min apart | Grouped by ±30-min proximity; averaged |
| **TC-JNL.32** | [E2E] | Two readings no sessionId, 45 min apart | Separate sessions |
| **TC-JNL.33** | [E2E] | AFib patient with **1** reading HR 115 | No alert (AFib gate) |
| **TC-JNL.34** | [E2E] | AFib patient with **3** readings HR avg 115 | `RULE_AFIB_HR_HIGH` fires |
| **TC-JNL.35** | [E2E] | AFib patient with 1 reading + `severeHeadache: true` | `BP_LEVEL_2_SYMPTOM_OVERRIDE` still fires (pre-gate rule) |
| **TC-JNL.36** | [E2E] | AFib pregnant patient with 1 reading + Lisinopril (ACE) | `RULE_PREGNANCY_ACE_ARB` still fires (pre-gate rule) |

---

## 10. Rule engine coverage

This section wraps each of the 57 scenarios in [ALERT_SCENARIOS.md](ALERT_SCENARIOS.md) as an HTTP-level e2e test. The test exercises: `POST /daily-journal` → assert `DeviationAlert.ruleId` + `tier` + `patientMessage` shape + expected escalation fire.

**All test cases inherit this template:**

> **Preflight:** Seed patient per archetype, log prior readings if required (e.g. ≥7 for personalized, ≥3 for AFib), then `POST /daily-journal` with the trigger reading.
>
> **Assert:** Latest `DeviationAlert` row where `userId = patient.id` ordered by `createdAt DESC LIMIT 1` has the expected `ruleId`, `tier`, `dismissible`, and `patientMessage` contains the expected text. For escalatable tiers (TIER_1_*, BP_LEVEL_2*, TIER_2_*), assert a T+0 `EscalationEvent` row was written and at least one `Notification` row fanned out (assuming patient is enrolled per Layer B).

All cases in §10 are **[E2E]**. Unit-level equivalents already green in [TEST_SCENARIOS.md](TEST_SCENARIOS.md).

### 10.1 Tier 1 contraindications (non-dismissable)

| TC | Scenario # from ALERT_SCENARIOS | Archetype | Trigger reading | Expected ruleId |
|---|---|---|---|---|
| **TC-RUL.T1.01** | 1 | Pregnant + Lisinopril (ACE) | 130/82 | `RULE_PREGNANCY_ACE_ARB` |
| **TC-RUL.T1.02** | 2 | HFrEF + Diltiazem (NDHP) verified | 118/74 | `RULE_NDHP_HFREF` |
| **TC-RUL.T1.03** | 3 | Pregnant UNVERIFIED + Lisinopril UNVERIFIED | 122/78 | `RULE_PREGNANCY_ACE_ARB` (safety net) |
| **TC-RUL.T1.04** | 18 | Pregnant + AFib + Lisinopril UNVERIFIED, 1 reading | 128/80 | `RULE_PREGNANCY_ACE_ARB` (AFib gate doesn't block) |
| **TC-RUL.T1.05** | 46 | Pregnant + Entresto (ARNI+ARB combo) | 128/80 | `RULE_PREGNANCY_ACE_ARB` |
| **TC-RUL.T1.06** | 47 | Pregnant + Zestoretic (ACE+THIAZIDE combo) | 128/80 | `RULE_PREGNANCY_ACE_ARB` |
| **TC-RUL.T1.07** | 48 | HF type UNKNOWN + Diltiazem | 120/74 | `RULE_NDHP_HFREF` (UNKNOWN → HFREF) |
| **TC-RUL.T1.08** | 49 | DCM only + Diltiazem | 120/74 | `RULE_NDHP_HFREF` (DCM → HFREF) |
| **TC-RUL.T1.09** | 50 | Pregnant + HFrEF + Lisinopril + Diltiazem | 120/76 | `RULE_PREGNANCY_ACE_ARB` (precedence) |
| **TC-RUL.T1.10** | 51 | Pregnant + Lisinopril | 195/130 | `RULE_PREGNANCY_ACE_ARB` (Tier 1 beats emergency) |
| **TC-RUL.T1.11** | — | HFrEF + Diltiazem **UNVERIFIED** | 118/74 | `null` — NDHP requires VERIFIED per safety-net policy |

### 10.2 BP Level 2 emergencies (911 CTA)

| TC | # | Archetype | Reading | Expected |
|---|---|---|---|---|
| **TC-RUL.L2.01** | 4 | Diagnosed HTN | 190/105 | `RULE_ABSOLUTE_EMERGENCY` |
| **TC-RUL.L2.02** | 6 | Pregnant | 165/112 | `RULE_PREGNANCY_L2` |
| **TC-RUL.L2.03** | 21 | Two session-averaged readings mean 180/95 | 185/95 + 175/95 | `RULE_ABSOLUTE_EMERGENCY` |

### 10.3 BP L2 symptom overrides (any BP)

| TC | # | Symptom | Expected |
|---|---|---|---|
| **TC-RUL.SYM.01** | 5 | 122/76 + severeHeadache | `RULE_SYMPTOM_OVERRIDE_GENERAL` |
| **TC-RUL.SYM.02** | 22 | Pregnant 128/82 + ruqPain | `RULE_SYMPTOM_OVERRIDE_PREGNANCY` |
| **TC-RUL.SYM.03** | 35 | Brady pulse 48 + chestPainOrDyspnea | `RULE_SYMPTOM_OVERRIDE_GENERAL` (L2 wins) |
| **TC-RUL.SYM.04-09** | 39–45 | One per: visualChanges, alteredMentalStatus, chestPainOrDyspnea, focalNeuroDeficit, severeEpigastricPain, newOnsetHeadache, edema | Each fires symptom override |

### 10.4 BP Level 1 High

| TC | # | Archetype | Reading | Expected |
|---|---|---|---|---|
| **TC-RUL.L1H.01** | 7 | Pregnant | 144/88 | `RULE_PREGNANCY_L1_HIGH` |
| **TC-RUL.L1H.02** | 9 | AFib 3 readings | pulse 115 | `RULE_AFIB_HR_HIGH` |
| **TC-RUL.L1H.03** | 12 | HTN + threshold 130/90 + 12 readings | 152/88 | `RULE_PERSONALIZED_HIGH` (mode: PERSONALIZED) |
| **TC-RUL.L1H.04** | 13 | HTN + threshold + 3 readings | 165/94 | `RULE_STANDARD_L1_HIGH` (pre-Day-3 disclaimer on message) |
| **TC-RUL.L1H.05** | 15 | HTN | 172/88 (PP 84) | `RULE_STANDARD_L1_HIGH` + physician annotation mentions wide PP |
| **TC-RUL.L1H.06** | 20 | HTN + any suboptimal checklist item false | 164/96 | `RULE_STANDARD_L1_HIGH` + "retake" suffix on patient message |
| **TC-RUL.L1H.07** | 24 | HFrEF | 162/88 | `RULE_HFREF_HIGH` |
| **TC-RUL.L1H.08** | 25 | HFpEF | 162/88 | `RULE_HFPEF_HIGH` |
| **TC-RUL.L1H.09** | 26 | CAD | 162/82 | `RULE_CAD_HIGH` |
| **TC-RUL.L1H.10** | 28 | HCM, no risky meds | 162/88 | `RULE_HCM_HIGH` |
| **TC-RUL.L1H.11** | 30 | DCM only | 162/88 | `RULE_DCM_HIGH` |
| **TC-RUL.L1H.12** | 34 | Tachycardia + prior pulse 102 | pulse 105 | `RULE_TACHY_HR` |
| **TC-RUL.L1H.13** | 52 | HTN boundary | 160/95 | `RULE_STANDARD_L1_HIGH` |
| **TC-RUL.L1H.14** | 56 | AFib 3 readings | 165/92 pulse 75 | `RULE_STANDARD_L1_HIGH` |

### 10.5 BP Level 1 Low

| TC | # | Archetype | Reading | Expected |
|---|---|---|---|---|
| **TC-RUL.L1L.01** | 8 | CAD + Amlodipine | 132/68 | `RULE_CAD_DBP_CRITICAL` |
| **TC-RUL.L1L.02** | 10 | HFpEF | 106/70 | `RULE_HFPEF_LOW` |
| **TC-RUL.L1L.03** | 11 | Age 65+ | 96/58 | `RULE_AGE_65_LOW` |
| **TC-RUL.L1L.04** | 23 | HFrEF | 82/55 | `RULE_HFREF_LOW` |
| **TC-RUL.L1L.05** | 27 | HCM | 98/64 | `RULE_HCM_LOW` |
| **TC-RUL.L1L.06** | 29 | DCM | 82/55 | `RULE_DCM_LOW` |
| **TC-RUL.L1L.07** | 31 | HTN + threshold lower 110 + 12 readings | 108/70 | `RULE_PERSONALIZED_LOW` |
| **TC-RUL.L1L.08** | 32 | Age 40-64 | 88/58 | `RULE_STANDARD_L1_LOW` |
| **TC-RUL.L1L.09** | 33 | AFib 3 readings | pulse 48 | `RULE_AFIB_HR_LOW` |
| **TC-RUL.L1L.10** | 36 | Bradycardia asymptomatic | pulse 38 | `RULE_BRADY_HR_ASYMPTOMATIC` |

### 10.6 Tier 3 (physician-only)

| TC | # | Archetype | Reading | Expected |
|---|---|---|---|---|
| **TC-RUL.T3.01** | 14 | HCM + Amlodipine (DHP vasodilator) | 128/82 | `RULE_HCM_VASODILATOR`; patientMessage = `""`; caregiverMessage = `""` |
| **TC-RUL.T3.02** | 37 | Any | 145/80 (PP 65) | `RULE_PULSE_PRESSURE_WIDE`; patientMessage = `""` |
| **TC-RUL.T3.03** | 38 | On loop diuretic | 92/60 | `RULE_LOOP_DIURETIC_HYPOTENSION`; patientMessage = `""` |

### 10.7 Boundary / no-alert cases

| TC | # | Archetype | Reading | Expected |
|---|---|---|---|---|
| **TC-RUL.BND.01** | 16 | HTN + Lisinopril + Amlodipine | 124/78 | No alert; existing BP_LEVEL_1_* alerts flipped to RESOLVED; Tier 1/2/L2 preserved |
| **TC-RUL.BND.02** | 17 | AFib + 1 reading | pulse 118 | No alert (gate closed) |
| **TC-RUL.BND.03** | 19 | Bradycardia + Metoprolol | pulse 55 | No alert (BB suppression) |
| **TC-RUL.BND.04** | 53 | CAD | 130/70 (DBP boundary) | No alert — strict `<70` |
| **TC-RUL.BND.05** | 54 | — | 90/— (SBP boundary) | No alert — strict `<90` |
| **TC-RUL.BND.06** | 55 | Age 65+ | 100/— (boundary) | No alert — strict `<100` |
| **TC-RUL.BND.07** | 57 | Admin user (no PatientProfile) | Any reading | **403** at Layer A gate — `{ message: "clinical-intake-required" }`. Rule engine never runs. |

### 10.8 Three age buckets — BP invariance + lower-bound differentiation

Cross-cutting check: same reading, different DOB → same upper-bound alert but different lower-bound.

| TC | DOB | Age group | Reading | Expected |
|---|---|---|---|---|
| **TC-RUL.AGE.01** | 2001-04-23 (25) | 18-39 | 162/101 | `RULE_STANDARD_L1_HIGH` |
| **TC-RUL.AGE.02** | 1980-04-23 (46) | 40-64 | 162/101 | `RULE_STANDARD_L1_HIGH` |
| **TC-RUL.AGE.03** | 1955-04-23 (71) | 65+ | 162/101 | `RULE_STANDARD_L1_HIGH` |
| **TC-RUL.AGE.04** | 2001-04-23 (25) | 18-39 | 95/70 | No alert (strict <90) |
| **TC-RUL.AGE.05** | 1980-04-23 (46) | 40-64 | 95/70 | No alert |
| **TC-RUL.AGE.06** | 1955-04-23 (71) | 65+ | 95/70 | `RULE_AGE_65_LOW` — **only 65+ lower bound <100 fires** |

### 10.9 Three-tier message output

For each rule fire, assert the DeviationAlert row has all three fields populated:

| TC | Rule | Expected wording checks |
|---|---|---|
| **TC-MSG.01** | `RULE_PREGNANCY_ACE_ARB` | `patientMessage` does NOT contain "teratogenic"; contains "blood pressure medicine". `physicianMessage` contains "teratogenic" AND the drug name. |
| **TC-MSG.02** | `RULE_ABSOLUTE_EMERGENCY` | `patientMessage` matches `/911/` |
| **TC-MSG.03** | `RULE_PULSE_PRESSURE_WIDE` | `patientMessage === ""`, `caregiverMessage === ""`, `physicianMessage` contains "pulse pressure" |
| **TC-MSG.04** | Any rule with pre-Day-3 | `patientMessage` contains "standard threshold — personalization begins after Day 3" (case-insensitive) |
| **TC-MSG.05** | Any rule with `suboptimalMeasurement: true` | `patientMessage` contains "retake" |
| **TC-MSG.06** | `RULE_STANDARD_L1_HIGH` fired with session average 150/92 | `patientMessage` contains "150/92" substring |
| **TC-MSG.07** | L1 High with SBP 170, DBP 85 (PP 85) | Primary rule fires; `physicianMessage` annotation appends "pulse pressure" line |

---

## 11. Patient-facing reads

### 11.1 Core patient reads

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-ME.01** | [E2E] | `GET /me/profile` | 200 (or 200 null if no profile yet) |
| **TC-ME.02** | [E2E] | `GET /me/medications` | 200 |
| **TC-ME.03** | [E2E] | `GET /me/medications?includeDiscontinued=true` | Includes soft-deleted rows |
| **TC-ME.04** | [E2E] | `GET /me/threshold` | 200 (200 null if absent) |
| **TC-ME.05** | [E2E] | `GET /me/care-team` | 200 (200 null if absent) |

### 11.2 Journal reads

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-RDG.01** | [E2E] | `GET /daily-journal` | 200 array; sorted by `measuredAt DESC` |
| **TC-RDG.02** | [E2E] | `GET /daily-journal?startDate=2026-04-01&endDate=2026-04-23` | 200 filtered |
| **TC-RDG.03** | [E2E] | `GET /daily-journal?limit=50` | 200 capped to 50 |
| **TC-RDG.04** | [E2E] | `GET /daily-journal?limit=500` | 400 — clamped at 200 |
| **TC-RDG.05** | [E2E] | `GET /daily-journal/history?page=2&limit=10` | 200 `{ data, totalCount, page:2, limit:10, pageCount }` |
| **TC-RDG.06** | [E2E] | `GET /daily-journal/:id` | 200 single |
| **TC-RDG.07** | [E2E] | `GET /daily-journal/<other-user-entry-id>` | 404 ownership |
| **TC-RDG.08** | [E2E] | `GET /daily-journal/stats` | 200 |
| **TC-RDG.09** | [E2E] | `GET /daily-journal/alerts` | 200 — patient's alerts |
| **TC-RDG.10** | [E2E] | `GET /daily-journal/escalations` | 200 |
| **TC-RDG.11** | [E2E] | `GET /daily-journal/baseline/latest` | 200 most recent entry |
| **TC-RDG.12** | [E2E] | `GET /daily-journal/notifications` | 200 |
| **TC-RDG.13** | [E2E] | `GET /daily-journal/notifications?status=unread` | 200 only unread |
| **TC-RDG.14** | [E2E] | `PATCH /daily-journal/notifications/:id/status  { watched: true }` | 200 |
| **TC-RDG.15** | [E2E] | `PATCH /daily-journal/notifications/bulk-status  { ids: [...], watched: true }` | 200 |

### 11.3 Ordering — clinical truth vs audit

| TC | Layer | Setup | Expected |
|---|---|---|---|
| **TC-RDG.20** | [E2E] | Patient inserts in order: 1:00pm, 12:00pm, 12:30pm (same day) | `GET /daily-journal` returns **12:00 → 12:30 → 1:00pm** (sorted by `measuredAt`, NOT `createdAt`) |

---

## 12. Alert resolution

See [alert-resolution.controller.ts](../backend/src/daily_journal/controllers/alert-resolution.controller.ts). Guard: `@Roles(SUPER_ADMIN, MEDICAL_DIRECTOR, PROVIDER, HEALPLACE_OPS)`.

### 12.1 Acknowledge (PASS)

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-RES.01** | [E2E] | `POST /admin/alerts/:id/acknowledge` as PROVIDER | 200 `{ acknowledgedAt }`; DeviationAlert.status = ACKNOWLEDGED; open EscalationEvent rows' `acknowledgedAt` set; cron stops advancing |
| **TC-RES.02** | [E2E] | Same called twice — idempotent | 200 both times |

### 12.2 Resolve — Tier 1 (PASS)

All 5 actions require `resolutionRationale` (min 3 chars, max 2000).

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-RES.10** | [E2E] | `POST /admin/alerts/:id/resolve  { resolutionAction:"TIER1_DISCONTINUED", resolutionRationale:"Confirmed with pharmacy" }` | 200; status=RESOLVED; resolvedAt/resolvedBy/resolutionAction/resolutionRationale persisted; open EscalationEvents closed |
| **TC-RES.11** | [E2E] | Action `TIER1_CHANGE_ORDERED` + rationale | 200 |
| **TC-RES.12** | [E2E] | Action `TIER1_FALSE_POSITIVE` + rationale | 200 |
| **TC-RES.13** | [E2E] | Action `TIER1_ACKNOWLEDGED` + rationale | 200 |
| **TC-RES.14** | [E2E] | Action `TIER1_DEFERRED` + rationale | 200 |

### 12.3 Resolve — Tier 1 (FAIL)

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-RES.20** | [E2E] | `TIER1_DISCONTINUED` with no rationale | 400 — rationale required for Tier 1 |
| **TC-RES.21** | [E2E] | Rationale length 2 chars | 400 |
| **TC-RES.22** | [E2E] | Rationale length 2001 chars | 400 |
| **TC-RES.23** | [E2E] | Wrong action enum for tier (e.g. `BP_L2_*` on a Tier 1 alert) | 400 — mismatch |
| **TC-RES.24** | [E2E] | Resolve an already-resolved alert | 400 — "Alert is already resolved" |

### 12.4 Resolve — Tier 2

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-RES.30** | [E2E] | Action `TIER2_REVIEWED_NO_ACTION` with no rationale | 400 — this action **requires** rationale |
| **TC-RES.31** | [E2E] | Action `TIER2_REVIEWED_NO_ACTION` with rationale | 200 |
| **TC-RES.32** | [E2E] | Action `TIER2_WILL_CONTACT` **without** rationale | 200 — optional |
| **TC-RES.33** | [E2E] | Action `TIER2_CHANGE_ORDERED` without rationale | 200 |
| **TC-RES.34** | [E2E] | Action `TIER2_PHARMACY_RECONCILE` without rationale | 200 |
| **TC-RES.35** | [E2E] | Action `TIER2_DEFERRED` without rationale | 200 |

### 12.5 Resolve — BP Level 2

All 6 actions require rationale.

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-RES.40** | [E2E] | Action `BP_L2_CONTACTED_MED_ADJUSTED` + rationale | 200; status=RESOLVED |
| **TC-RES.41** | [E2E] | Action `BP_L2_CONTACTED_ADVISED_ED` + rationale | 200 |
| **TC-RES.42** | [E2E] | Action `BP_L2_CONTACTED_RECHECK` + rationale | 200 |
| **TC-RES.43** | [E2E] | Action `BP_L2_SEEN_IN_OFFICE` + rationale | 200 |
| **TC-RES.44** | [E2E] | Action `BP_L2_REVIEWED_TRENDING_DOWN` + rationale (must document trend) | 200 |
| **TC-RES.45** | [E2E] | Action `BP_L2_UNABLE_TO_REACH_RETRY` + rationale | 200 `{ status:"OPEN", retryScheduledFor:<now + 4h> }`; alert stays OPEN; fresh EscalationEvent with `triggeredByResolution: true` scheduled |
| **TC-RES.46** | [E2E] | BP L2 action with no rationale | 400 |

### 12.6 Audit

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-RES.50** | [E2E] | `GET /admin/alerts/:id/audit` | 200 with 15 fields: `alertId, alertType, alertTrigger, patientId, alertGenerationTimestamp, escalationLevel, escalationTimestamp, recipientsNotified[], acknowledgmentTimestamp, resolutionTimestamp, timeToAcknowledgmentMs, timeToResolutionMs, escalationTriggered, resolutionAction, resolutionRationale, escalationTimeline: [...]` |
| **TC-RES.51** | [E2E] | Audit as PATIENT | 403 |

---

## 13. Escalation ladder

See [escalation.service.ts](../backend/src/daily_journal/services/escalation.service.ts), [ladder-defs.ts](../backend/src/daily_journal/escalation/ladder-defs.ts).

**For each test, trigger the alert via `POST /daily-journal`, then drive time forward using `EscalationService.runScan(new Date(T+nh))`.** Query `EscalationEvent` rows ordered by `triggeredAt` to assert.

All **[E2E]** unless marked otherwise.

### 13.1 Tier 1 — business hours (Mon–Fri 08:00–18:00 practice tz)

| TC | Time of trigger | Expected ladder events |
|---|---|---|
| **TC-ESC.T1.01** | 2026-04-23 10:00 ET (Thu) | T+0: EscalationEvent step=T0 recipientRoles=[PRIMARY_PROVIDER] channels=[PUSH,EMAIL,DASHBOARD] afterHours=false; Notification rows fanned out to primary |
| **TC-ESC.T1.02** | Run scan at +4h (14:00 ET, no ack) | New EscalationEvent step=T4H recipientRoles=[PRIMARY_PROVIDER, BACKUP_PROVIDER] channels=[PUSH] |
| **TC-ESC.T1.03** | Ack primary at +4.5h, then scan at +8h | No further escalation — ack stops cron |
| **TC-ESC.T1.04** | +8h, no ack | step=T8H recipientRoles=[MEDICAL_DIRECTOR] channels=[PUSH,DASHBOARD] |
| **TC-ESC.T1.05** | +24h, no ack | step=T24H recipientRoles=[HEALPLACE_OPS] channels=[PUSH,PHONE] |
| **TC-ESC.T1.06** | +48h, no ack | step=T48H recipientRoles=[HEALPLACE_OPS] channels=[DASHBOARD] |

### 13.2 Tier 1 — after-hours safety net

| TC | Trigger | Expected |
|---|---|---|
| **TC-ESC.T1.10** | 2026-04-23 22:00 ET (Thu, after-hours) | TWO EscalationEvent rows at T+0: one step=T0 for PRIMARY_PROVIDER with `afterHours=true` + `scheduledFor=next business-hours start (2026-04-24 08:00 ET)`; one `TIER_1_BACKUP_ON_T0` for BACKUP_PROVIDER with `afterHoursBehavior: FIRE_IMMEDIATELY` and `notificationSentAt: now` |
| **TC-ESC.T1.11** | Run scan at 2026-04-24 08:00 ET | Primary's T+0 dispatches (notificationSentAt set); ladder clock anchors here |
| **TC-ESC.T1.12** | Run scan at 2026-04-24 12:00 ET (4h after anchor) | step=T4H dispatches per ladder |
| **TC-ESC.T1.13** | Weekend trigger: 2026-04-25 10:00 ET (Sat) | T+0 queued to Monday 2026-04-27 08:00 ET; backup fires immediately |

### 13.3 Tier 2 ladder

| TC | Setup | Expected |
|---|---|---|
| **TC-ESC.T2.01** | Tier 2 alert (e.g., medication discrepancy) at Thu 10:00 ET | step=T0 DASHBOARD only, no push; recipient PRIMARY_PROVIDER |
| **TC-ESC.T2.02** | +48h, no ack | step=TIER2_48H channels=[PUSH, DASHBOARD] |
| **TC-ESC.T2.03** | +7d, no ack | step=TIER2_7D recipientRoles=[BACKUP_PROVIDER] |
| **TC-ESC.T2.04** | +14d, no ack | step=TIER2_14D recipientRoles=[HEALPLACE_OPS] |

### 13.4 BP Level 2 ladder

| TC | Trigger | Expected |
|---|---|---|
| **TC-ESC.L2.01** | BP L2 alert at Thu 10:00 ET | step=T0 recipientRoles=[PRIMARY_PROVIDER, BACKUP_PROVIDER, PATIENT] channels=[PUSH, EMAIL, DASHBOARD]; 3 notification rows minimum |
| **TC-ESC.L2.02** | +2h, no ack | step=T2H recipientRoles=[MEDICAL_DIRECTOR] |
| **TC-ESC.L2.03** | +4h, no ack | step=T4H recipientRoles=[HEALPLACE_OPS] channels=[PUSH, PHONE] |
| **TC-ESC.L2.04** | BP L2 trigger at Thu 22:00 ET (after-hours) | **Fires immediately** — afterHoursBehavior=FIRE_IMMEDIATELY on every step; no queueing |
| **TC-ESC.L2.05** | BP L2 trigger on Saturday | Fires immediately regardless of weekend |

### 13.5 BP Level 2 Symptom Override

| TC | Trigger | Expected |
|---|---|---|
| **TC-ESC.L2S.01** | Reading 125/75 + severeHeadache → BP_LEVEL_2_SYMPTOM_OVERRIDE | T+0 identical to standard BP L2 |
| **TC-ESC.L2S.02** | +2h | step=T2H recipientRoles=[MEDICAL_DIRECTOR, PATIENT] — **patient also receives "Have you called 911?" push** |

### 13.6 Retry (BP L2 #6)

| TC | Setup | Expected |
|---|---|---|
| **TC-ESC.RETRY.01** | Resolve BP L2 with `BP_L2_UNABLE_TO_REACH_RETRY` at 13:00 | Alert stays OPEN; fresh EscalationEvent created with `triggeredByResolution: true`, `scheduledFor: 17:00`, step=T4H |
| **TC-ESC.RETRY.02** | Run scan at 17:00 | Retry event dispatches; recipientRoles=[PRIMARY_PROVIDER, BACKUP_PROVIDER] channels=[PUSH, DASHBOARD] |
| **TC-ESC.RETRY.03** | Resolve retry event with `BP_L2_CONTACTED_MED_ADJUSTED` + rationale | Alert RESOLVED |

### 13.7 Fail-loud on missing roles (data integrity)

| TC | Setup | Expected |
|---|---|---|
| **TC-ESC.FAIL.01** | Alert fires for patient with `PatientProviderAssignment` but `primaryProviderId` user has been deleted | EscalationEvent row written with `reason` suffix "DISPATCH ERROR: missing required roles PRIMARY_PROVIDER"; log ERROR written; partial dispatch preserved (backup/MD still fire) |
| **TC-ESC.FAIL.02** | HEALPLACE_OPS step fires but no user has that role | `notificationChannel` empty or partial; log WARN; no error thrown |

### 13.8 Anchor correctness

| TC | Setup | Expected |
|---|---|---|
| **TC-ESC.ANCH.01** | Tier 1 at 22:00 ET Thu (after-hours, queued) → runScan at 08:00 ET Fri (primary dispatch) → runScan at 12:00 ET Fri | step=T4H deadline based on 08:00 (dispatch time), not 22:00 (createdAt). So 12:00 is exactly +4h. |
| **TC-ESC.ANCH.02** | Same + runScan at 16:00 ET Fri (no ack) | step=T8H dispatches at +8h from 08:00 anchor |

### 13.9 Dual-notify at T+0 for BP L2

| TC | Trigger | Expected |
|---|---|---|
| **TC-ESC.DUAL.01** | BP L2 alert | Single EscalationEvent row at T+0 with recipientRoles containing BOTH PRIMARY_PROVIDER and BACKUP_PROVIDER and PATIENT (not three separate rows) |

### 13.10 Idempotency

| TC | Setup | Expected |
|---|---|---|
| **TC-ESC.IDEM.01** | runScan called twice at same time without a state change | Same number of EscalationEvent rows; Notification `@@unique([alertId, escalationEventId, userId, channel])` prevents duplicates |

---

## 14. Crons

Use the public `runScan(now)` methods to drive deterministically.

### 14.1 Gap alert

| TC | Layer | Setup | Request | Expected |
|---|---|---|---|---|
| **TC-CRN.GAP.01** | [INTEG] | Enrolled patient with last JournalEntry 49h ago | `GapAlertService.runScan(new Date())` | Returns 1; one Notification row `title: "Time for your BP check"` channel PUSH + one EMAIL |
| **TC-CRN.GAP.02** | [INTEG] | Same patient still dormant 60h later | runScan again | Returns 0 — 24h idempotency window |
| **TC-CRN.GAP.03** | [INTEG] | Patient with last entry 47h ago | runScan | Returns 0 — under 48h |
| **TC-CRN.GAP.04** | [INTEG] | Patient not enrolled (onboardingStatus != COMPLETED) | runScan | Returns 0 — only enrolled patients nudged |
| **TC-CRN.GAP.05** | [INTEG] | Patient never logged, onboarded 49h ago | runScan | Returns 1 (first-time wording in notification body) |
| **TC-CRN.GAP.06** | [INTEG] | Different notification title within 24h (e.g. escalation push) | Does not count as gap idempotency — filter is exact title match |

### 14.2 Monthly re-ask

| TC | Layer | Setup | Expected |
|---|---|---|---|
| **TC-CRN.REASK.01** | [INTEG] | Patient with active med, `verifiedAt` 31 days ago, `reportedAt` 31 days ago | `runScan` returns 1; PUSH notification `title: "Confirm your medications"` |
| **TC-CRN.REASK.02** | [INTEG] | Same patient, runScan 2 days later | Returns 0 — 28d idempotency |
| **TC-CRN.REASK.03** | [INTEG] | Patient with no active meds | Returns 0 |
| **TC-CRN.REASK.04** | [INTEG] | Patient with med whose `verifiedAt` is 29 days ago | Returns 0 — under 30d |
| **TC-CRN.REASK.05** | [INTEG] | Patient with med whose `reportedAt` is 35d ago but `verifiedAt` is 10d ago | Returns 0 — most-recent touch wins |

### 14.3 Escalation scanner

| TC | Layer | Setup | Expected |
|---|---|---|---|
| **TC-CRN.ESC.01** | [INTEG] | No pending alerts | `EscalationService.runScan()` returns 0 dispatches |
| **TC-CRN.ESC.02** | [INTEG] | Queued T+0 (after-hours), runScan at business-hours-start | Queued event dispatches (firePendingScheduled) |
| **TC-CRN.ESC.03** | [INTEG] | Tier 1 alert, 4h15m elapsed, no ack | T4H event dispatches (advanceOverdueLadders) |

---

## 15. Role-based access control

Negative authz tests — hit each endpoint with insufficient role.

### 15.1 Patient-only endpoints hit by admin roles

| TC | Layer | Request | Role | Expected |
|---|---|---|---|---|
| **TC-RBAC.01** | [E2E] | `POST /intake/profile` | SUPER_ADMIN | Success (any auth'd user can self-report — admin could be a test patient) |
| **TC-RBAC.02** | [E2E] | `POST /daily-journal` | SUPER_ADMIN (no PatientProfile) | **403** at Layer A gate. If the admin account also has a PatientProfile (dual-role test user), 202 accepted. |

### 15.2 Admin endpoints hit by patient

| TC | Layer | Request | Role | Expected |
|---|---|---|---|---|
| **TC-RBAC.10** | [E2E] | `POST /admin/users/:id/verify-profile` | PATIENT | 403 |
| **TC-RBAC.11** | [E2E] | `POST /admin/users/:id/correct-profile` | PATIENT | 403 |
| **TC-RBAC.12** | [E2E] | `POST /admin/medications/:id/verify` | PATIENT | 403 |
| **TC-RBAC.13** | [E2E] | `POST /admin/practices` | PATIENT | 403 |
| **TC-RBAC.14** | [E2E] | `POST /admin/patients/:id/assignment` | PATIENT | 403 |
| **TC-RBAC.15** | [E2E] | `POST /admin/patients/:id/threshold` | PATIENT | 403 |
| **TC-RBAC.16** | [E2E] | `POST /admin/patients/:id/complete-onboarding` | PATIENT | 403 |
| **TC-RBAC.17** | [E2E] | `POST /admin/alerts/:id/resolve` | PATIENT | 403 |
| **TC-RBAC.18** | [E2E] | `GET /admin/alerts/:id/audit` | PATIENT | 403 |

### 15.3 PROVIDER role boundary

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-RBAC.20** | [E2E] | `POST /admin/users/:id/verify-profile` as PROVIDER | 200 (allowed — admin-intake guard includes PROVIDER) |
| **TC-RBAC.21** | [E2E] | `POST /admin/practices` as PROVIDER | 403 (excluded from practice guard) |
| **TC-RBAC.22** | [E2E] | `POST /admin/patients/:id/assignment` as PROVIDER | 403 |
| **TC-RBAC.23** | [E2E] | `POST /admin/patients/:id/threshold` as PROVIDER | 403 (threshold is MD/SA only) |
| **TC-RBAC.24** | [E2E] | `POST /admin/alerts/:id/resolve` as PROVIDER | 200 |

### 15.4 MEDICAL_DIRECTOR

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-RBAC.30** | [E2E] | `POST /admin/practices` | 200 |
| **TC-RBAC.31** | [E2E] | `POST /admin/patients/:id/threshold` | 201 (only MD + SA can set thresholds) |
| **TC-RBAC.32** | [E2E] | `POST /admin/patients/:id/complete-onboarding` | 200 (if gate passes) |
| **TC-RBAC.33** | [E2E] | `POST /admin/medications/:id/verify` | 200 |

### 15.5 HEALPLACE_OPS

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-RBAC.40** | [E2E] | `POST /admin/practices` | 200 (included in practice guard) |
| **TC-RBAC.41** | [E2E] | `POST /admin/patients/:id/assignment` | 200 |
| **TC-RBAC.42** | [E2E] | `POST /admin/patients/:id/threshold` | 403 (threshold is MD/SA only) |
| **TC-RBAC.43** | [E2E] | `POST /admin/users/:id/verify-profile` | 403 (intake admin guard excludes HEALPLACE_OPS) |
| **TC-RBAC.44** | [E2E] | `POST /admin/alerts/:id/resolve` | 200 |

### 15.6 SUPER_ADMIN (baseline — should always work)

| TC | Layer | Every admin endpoint | Expected |
|---|---|---|---|
| **TC-RBAC.50** | [E2E] | Each POST / PATCH / DELETE | 200 / 201 — SUPER_ADMIN is in every guard |

### 15.7 anon (no JWT)

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-RBAC.60** | [E2E] | `GET /v2/auth/profile` | 401 |
| **TC-RBAC.61** | [E2E] | `POST /intake/profile` | 401 |
| **TC-RBAC.62** | [E2E] | `POST /daily-journal` | 401 |
| **TC-RBAC.63** | [E2E] | `POST /admin/*` | 401 |
| **TC-RBAC.64** | [E2E] | `GET /v2/content` | 200 (public) |
| **TC-RBAC.65** | [E2E] | `GET /v2/content/:id` | 200 (public) |
| **TC-RBAC.66** | [E2E] | `POST /v2/auth/otp/send` | 200 (public) |

### 15.8 Proxy-level routing

Frontend:

| TC | Layer | Setup | Expected |
|---|---|---|---|
| **TC-RBAC.70** | [PLAYWRIGHT] | SUPER_ADMIN JWT cookie, visit `http://localhost:3000/dashboard` | 307 redirect to `NEXT_PUBLIC_ADMIN_URL` (admin subdomain) |
| **TC-RBAC.71** | [PLAYWRIGHT] | No JWT, visit `http://localhost:3000/dashboard` | 307 redirect to `/` |
| **TC-RBAC.72** | [PLAYWRIGHT] | Logged-in PATIENT, visit `/sign-in` or `/welcome` | 307 redirect to `/dashboard` |

Admin:

| TC | Layer | Setup | Expected |
|---|---|---|---|
| **TC-RBAC.75** | [PLAYWRIGHT] | No JWT, visit `http://localhost:3001/dashboard` | 307 redirect to `/sign-in?next=/dashboard` |
| **TC-RBAC.76** | [PLAYWRIGHT] | PATIENT JWT (no SUPER_ADMIN), visit `/dashboard` | 307 redirect to `/sign-in?reason=forbidden` |
| **TC-RBAC.77** | [PLAYWRIGHT] | PROVIDER / MEDICAL_DIRECTOR / HEALPLACE_OPS JWT, visit `/dashboard` | **200** — admin app accessible. Per-endpoint `@Roles()` guards on the backend enforce finer restrictions (e.g. PROVIDER gets 403 on `POST /admin/practices`). |

---

## 16. Chat + legacy endpoints

### 16.1 Chat

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-CHT.01** | [E2E] | `POST /chat/streaming  { prompt: "What's my BP been like?" }` | SSE stream: first `{ sessionId }` then tokens then `[DONE]` |
| **TC-CHT.02** | [E2E] | `POST /chat/structured  { prompt }` | 200 `{ sessionId, data, isEmergency, toolResults }` |
| **TC-CHT.03** | [E2E] | `POST /chat/structured  { sessionId: <existing>, prompt }` | 200 — resumes session |
| **TC-CHT.04** | [E2E] | `GET /chat/sessions` | 200 array (patient's sessions only) |
| **TC-CHT.05** | [E2E] | `GET /chat/sessions/<other-user-session>` | 404 or 403 |
| **TC-CHT.06** | [E2E] | `DELETE /chat/sessions/:id` | 200 |
| **TC-CHT.07** | [MANUAL] | Chat system prompt injects `profileVerificationStatus: UNVERIFIED` → AI response must include disclaimer line | Manual assertion of AI output |
| **TC-CHT.08** | [MANUAL] | Chat prompt injects an active Tier 1 alert → AI must NOT suggest stopping the medication | Guardrail check |
| **TC-CHT.09** | [MANUAL] | Chat prompt during pre-Day-3 (<7 readings) → AI includes "personalization begins after Day 3" note | Manual |
| **TC-CHT.10** | [MANUAL] | Chat prompt mentions a TIER_3_INFO alert → AI does NOT surface it to patient | Guardrail |

### 16.2 Legacy provider endpoints (SUPER_ADMIN only)

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-LEG.01** | [E2E] | `GET /provider/stats` | 200 — v1 dashboard stats |
| **TC-LEG.02** | [E2E] | `GET /provider/patients?hasActiveAlerts=true` | 200 filtered |
| **TC-LEG.03** | [E2E] | `GET /provider/patients/:id/summary` | 200 |
| **TC-LEG.04** | [E2E] | `GET /provider/patients/:id/bp-trend?startDate=&endDate=` | 200 array |
| **TC-LEG.05** | [E2E] | `GET /provider/alerts?severity=HIGH` | 200 filtered |
| **TC-LEG.06** | [E2E] | `PATCH /provider/alerts/:id/acknowledge` | 200 |
| **TC-LEG.07** | [E2E] | `POST /provider/schedule-call  { patientUserId, callDate, callTime, callType }` | 201 |
| **TC-LEG.08** | [E2E] | `GET /provider/scheduled-calls?status=SCHEDULED` | 200 |
| **TC-LEG.09** | [E2E] | `PATCH /provider/scheduled-calls/:id/status  { status: "COMPLETED" }` | 200 |
| **TC-LEG.10** | [E2E] | `DELETE /provider/scheduled-calls/:id` | 200 |

### 16.3 Content (SUPER_ADMIN) + public read

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-CON.01** | [E2E] | `GET /v2/content` anon | 200 published + non-review |
| **TC-CON.02** | [E2E] | `GET /v2/content/:id` anon | 200 + logs ContentView |
| **TC-CON.03** | [E2E] | `GET /v2/content/all` as PATIENT | 403 |
| **TC-CON.04** | [E2E] | `POST /v2/content  { title, contentType, body }` SUPER_ADMIN | 201 DRAFT |
| **TC-CON.05** | [E2E] | Full publish workflow: create DRAFT → submit → review → publish → unpublish → reopen | Each transitions status correctly |
| **TC-CON.06** | [E2E] | `POST /v2/content/:id/rate  { ratingValue: 5 }` PATIENT | 200 rating stored |
| **TC-CON.07** | [E2E] | `POST /v2/content/:id/rate  { ratingValue: 6 }` PATIENT | 400 — 1-5 |

### 16.4 Knowledgebase

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-KB.01** | [E2E] | `GET /v2/knowledgebase` SUPER_ADMIN | 200 |
| **TC-KB.02** | [E2E] | `POST /v2/knowledgebase/document` multipart with `document` file + `tags` JSON | 200 processed |
| **TC-KB.03** | [E2E] | `POST /v2/knowledgebase/document` with no file | 400 |
| **TC-KB.04** | [E2E] | `PATCH /v2/knowledgebase/document/:id  { tags: [...] }` | 200 |
| **TC-KB.05** | [E2E] | Any KB endpoint as PATIENT | 403 |

### 16.5 Contact + users + health

| TC | Layer | Request | Expected |
|---|---|---|---|
| **TC-MSC.01** | [E2E] | `GET /` | 200 health check |
| **TC-MSC.02** | [E2E] | `POST /contact  { email, message }` anon | 200; email queued |
| **TC-MSC.03** | [E2E] | `POST /users  { email, name }` anon | 201 minimal user (legacy — prefer OTP flow) |

---

## 17. Frontend — Patient app

Patient app at `http://localhost:3000`. Each case describes the click path for [MANUAL] QA and the assertions a [PLAYWRIGHT] script must make. Playwright notation is prescriptive — the test engineer writes the actual TS; we describe *what to assert*.

### Format per test case

- **Click path** — the exact sequence a tester or Playwright script follows
- **Manual checklist** — what the tester must visually verify
- **Playwright assertions** — programmatic checks (selectors + expectations + backend calls to verify via `page.waitForResponse`)

### 17.1 Sign-in OTP flow

| TC | Layer | Flow |
|---|---|---|
| **TC-FE-PAT.01** | [MANUAL] + [PLAYWRIGHT] | **Click path:** `/sign-in` → enter `priya.menon@cardioplace.test` → click "Send code" → (intercept OTP) → enter `666666` → click "Verify" → lands on `/dashboard`. **Manual:** no console errors; loading state during send; error state on wrong OTP. **Playwright:** assert `page.waitForResponse(/\/v2\/auth\/otp\/send/)` 200; after verify, assert `page.url()` ends with `/dashboard`; assert `localStorage.getItem('access_token')` is truthy. |
| **TC-FE-PAT.02** | [PLAYWRIGHT] | Fresh signup — use `new+${Date.now()}@test.com` → OTP `666666` won't match, so mock the OTP via direct DB seed or test-only `/v2/auth/otp/verify` bypass. After verify, assert redirect to `/onboarding` (not `/dashboard`). |
| **TC-FE-PAT.03** | [PLAYWRIGHT] | Wrong OTP: enter `000000` → assert error toast rendered; assert URL still `/sign-in`; localStorage has no token. |
| **TC-FE-PAT.04** | [MANUAL] | Magic link: click "Send magic link" → check email inbox → click link → assert redirect to `/dashboard` with token cookie set. (Manual because email interception varies per environment.) |

### 17.2 Basic onboarding

| TC | Layer | Flow |
|---|---|---|
| **TC-FE-PAT.05** | [PLAYWRIGHT] | Fresh user on `/onboarding` → fill name / DOB / language / timezone → submit → assert `POST /v2/auth/profile` 200 → assert redirect to `/dashboard`. |
| **TC-FE-PAT.06** | [PLAYWRIGHT] | Logged-in user with `onboardingStatus: COMPLETED` hits `/onboarding` directly → assert redirect to `/dashboard`. |
| **TC-FE-PAT.07** | [MANUAL] | Visual: validation errors render inline (future DOB, bad timezone). |

### 17.3 Dashboard — Action Required card states

Per [TESTING_FLOW_GUIDE.md §10.3](TESTING_FLOW_GUIDE.md) + FRONTEND_BUILD_SPEC Flow A0.

| TC | Layer | Setup | Flow |
|---|---|---|---|
| **TC-FE-PAT.10** | [PLAYWRIGHT] | User with `onboardingStatus: COMPLETED` + no `PatientProfile` + no localStorage draft | Visit `/dashboard` → assert Action Required card visible with headline "Complete your health profile"; CTA button "Start" → click → navigate to `/clinical-intake`. |
| **TC-FE-PAT.11** | [PLAYWRIGHT] | Same but with a localStorage draft at step index 3 of 11 | Assert card headline "Continue your health profile"; sub-text includes "Step 3 of" or similar; progress bar visible; CTA "Resume". |
| **TC-FE-PAT.12** | [PLAYWRIGHT] | User has `PatientProfile` | Assert Action Required card is NOT visible. |
| **TC-FE-PAT.13** | [MANUAL] | Visual: card uses warm amber accent, not alarming red. |

### 17.4 Clinical intake wizard

| TC | Layer | Setup | Flow |
|---|---|---|---|
| **TC-FE-PAT.20** | [PLAYWRIGHT] | No profile | Click through A0b intro → A1 demographics (gender FEMALE, height 165) → A2 pregnancy (Yes, due 2026-09-01) → A3 conditions (select "Heart Failure") → A4 HF type (HFrEF) → A5 meds Screen 1 (select Lisinopril) → A9 frequency (Once daily) → A10 review → submit → A11 completion → click "Go to dashboard" → assert `POST /intake/profile` + `POST /intake/medications` both 200/201; `PatientProfile` row exists; redirect to `/dashboard`. |
| **TC-FE-PAT.21** | [PLAYWRIGHT] | At A5 select "Lisinopril" → at A6 also select "Lisinopril + HCTZ" → dedup modal A7 shown | Assert modal content includes both pill images; choosing "Same pill" collapses to Lisinopril + HCTZ; choosing "Both" retains both entries. |
| **TC-FE-PAT.22** | [PLAYWRIGHT] | Start intake, fill to A3 | Click "Save for later" → redirect to `/dashboard` with exit-save confirmation toast → re-visit `/clinical-intake` → assert starts at A3 (resume). |
| **TC-FE-PAT.23** | [PLAYWRIGHT] | At A8 "Other medicine not listed" | Assert microphone icon + camera icon render; clicking mic requests browser permission (Playwright grant via context options). |
| **TC-FE-PAT.24** | [MANUAL] | Audio button on each card plays TTS; card images render correctly per medication. |
| **TC-FE-PAT.25** | [PLAYWRIGHT] | Female user at A2 answers "Not pregnant" | Assert A4 HF type step skipped if no HF selected; flow proceeds directly to A5. |

### 17.5 Dashboard post-intake

| TC | Layer | Setup | Flow |
|---|---|---|---|
| **TC-FE-PAT.30** | [PLAYWRIGHT] | UNVERIFIED profile exists | Visit `/dashboard` → assert "Awaiting Provider Verification" badge visible below greeting; amber styling. |
| **TC-FE-PAT.31** | [PLAYWRIGHT] | VERIFIED profile | Assert badge hidden. |
| **TC-FE-PAT.32** | [PLAYWRIGHT] | PatientThreshold exists (e.g., sbpUpper 130) | Assert "Your goal: below 130/X · set by Dr. [name] · [date]" card visible. |
| **TC-FE-PAT.33** | [PLAYWRIGHT] | No threshold set | Assert "Your goal" card NOT rendered (or empty-state text if UI chose to). |

### 17.6 Check-in wizard (Flow B)

| TC | Layer | Setup | Flow |
|---|---|---|---|
| **TC-FE-PAT.40** | [PLAYWRIGHT] | Enrolled patient | Visit `/check-in` → complete B1 checklist (toggle each of 8 items to ✓) → B2 reading (date-time picker = now, position SITTING, SBP 125 / DBP 78 / pulse 72) → skip medication-taken step → B3 symptoms (all none) → B5 confirmation "Submit" → assert `POST /daily-journal` 202; entry visible in `/readings`. |
| **TC-FE-PAT.41** | [PLAYWRIGHT] | Same but flag `severeHeadache: true` at B3 | Assert form sends `severeHeadache: true`; patient redirected to `/alerts/:id` BP Level 2 screen post-submit. |
| **TC-FE-PAT.42** | [PLAYWRIGHT] | AFib patient | At B5, assert banner visible: "Your care team requires 3 readings per session"; "Add another reading" button visible. |
| **TC-FE-PAT.43** | [PLAYWRIGHT] | After B5 submit, click "Add another reading in this session" | Re-enters B2 with same sessionId UUID; date-time defaults to now+2 min; assert second `POST /daily-journal` shares `sessionId`. |
| **TC-FE-PAT.44** | [PLAYWRIGHT] | B1 check any one item as unmet | Submit reading → the reading is still accepted, but `/alerts/:id` patient message (if alert fires) includes "retake" suffix. |
| **TC-FE-PAT.45** | [MANUAL] | Pregnancy-specific symptoms (new-onset headache, RUQ pain, edema) only render in B3 if patient is flagged `isPregnant: true`. |
| **TC-FE-PAT.46** | [PLAYWRIGHT] | Pre-fix: User with no PatientProfile submits check-in | Current: 202 returned; no alert. Planned: 403 with error displayed + CTA to complete intake. |

### 17.7 Alert screens (Flow C)

| TC | Layer | Setup | Flow |
|---|---|---|---|
| **TC-FE-PAT.50** | [PLAYWRIGHT] | Patient has open `BP_LEVEL_2` alert (trigger via 185/95 reading) | Visit `/alerts/:id` → assert full-screen red background; headline "Your blood pressure is very high"; a giant 911-call button; "I understand" button dismisses to banner-mode. |
| **TC-FE-PAT.51** | [PLAYWRIGHT] | Same alert, 2h later after admin hasn't acknowledged | Manual or cron-simulate T+2h → patient receives push + banner "Have you called 911?" with Yes / Not yet buttons. |
| **TC-FE-PAT.52** | [PLAYWRIGHT] | Open `TIER_1_CONTRAINDICATION` alert | `/alerts/:id` → assert red banner, title "Important medication alert"; body = patientMessage; reassurance text "Your care team has been notified"; NO 911 button (Tier 1 ≠ emergency). |
| **TC-FE-PAT.53** | [PLAYWRIGHT] | Open `BP_LEVEL_1_HIGH` alert | Assert orange banner, patient-friendly copy, "Your care team will review within 24 hours" language. |
| **TC-FE-PAT.54** | [PLAYWRIGHT] | Open `BP_LEVEL_1_LOW` alert | Assert blue banner with dizziness safety prompt. |
| **TC-FE-PAT.55** | [PLAYWRIGHT] | Open `TIER_3_INFO` alert ID navigated directly | Assert either 404 or an empty/no-patient-content view (Tier 3 is physician-only). |
| **TC-FE-PAT.56** | [PLAYWRIGHT] | Open `TIER_2_DISCREPANCY` alert ID | Assert 404 for patients (Tier 2 is admin-only) per [alerts/[id]/page.tsx](../frontend/src/app/alerts/%5Bid%5D/page.tsx). |
| **TC-FE-PAT.57** | [PLAYWRIGHT] | Resolved alert (status RESOLVED) | Navigate to `/alerts/:id` → assert banner mode, not full-screen takeover. |
| **TC-FE-PAT.58** | [PLAYWRIGHT] | Open alert with acknowledge button clicked | Assert `PATCH /daily-journal/alerts/:id/acknowledge` fires 200; UI state flips to "Acknowledged". |

### 17.8 Profile page (Flow E)

| TC | Layer | Setup | Flow |
|---|---|---|---|
| **TC-FE-PAT.60** | [PLAYWRIGHT] | Patient with assignment + profile | Visit `/profile` → assert sections render: Account, Assigned Care Team (with 3 names), Demographics, Pregnancy (if female), Conditions, Medications. |
| **TC-FE-PAT.61** | [PLAYWRIGHT] | VERIFIED patient | Click "Edit" on Conditions → re-enters Flow A3 → toggle off a condition → submit → assert `POST /intake/profile` 200; `GET /me/profile` returns UNVERIFIED again; `/dashboard` badge re-appears. |
| **TC-FE-PAT.62** | [PLAYWRIGHT] | Patient with rejected medication | `/profile` Medications section → assert rejected med renders with strike-through + admin-reason note; re-enter via Edit → re-submit → new med row is AWAITING_PROVIDER. |
| **TC-FE-PAT.63** | [PLAYWRIGHT] | Patient signs out | Click Sign Out → assert redirect to `/`; cookies cleared; navigating to `/dashboard` redirects back to `/`. |

### 17.9 Other patient pages

| TC | Layer | Flow |
|---|---|---|
| **TC-FE-PAT.70** | [PLAYWRIGHT] | `/notifications` — groups by tier (emergency first); click-through navigates to `/alerts/:id`. |
| **TC-FE-PAT.71** | [PLAYWRIGHT] | `/readings` — sorted by `measuredAt DESC`; pulse + pulse-pressure displayed; readings grouped visually by session (collapsible cards). |
| **TC-FE-PAT.72** | [MANUAL] | `/chat` — UI unchanged from v1; chat stream renders tokens; verify guardrails manually per TC-CHT.07–10. |
| **TC-FE-PAT.73** | [PLAYWRIGHT] | Monthly med re-check modal — simulate cron trigger, patient navigates to `/dashboard`, modal renders with Yes / No. "No" routes to Flow A5. |

---

## 18. Frontend — Admin app

Admin app at `http://localhost:3001`. Pre-TC-RBAC.77 fix, only SUPER_ADMIN sessions can reach these routes in a browser.

### 18.1 Sign-in + proxy

| TC | Layer | Flow |
|---|---|---|
| **TC-FE-ADM.01** | [PLAYWRIGHT] | `/sign-in` → SUPER_ADMIN email + OTP → lands on `/dashboard`. |
| **TC-FE-ADM.02** | [PLAYWRIGHT] | PATIENT credentials on admin `/sign-in` → assert error toast "This login is for care team members only" or redirect to `?reason=forbidden`. |
| **TC-FE-ADM.03** | [PLAYWRIGHT] | Pre-fix TC-RBAC.77: PROVIDER credentials on admin sign-in → currently blocked with `?reason=forbidden`. Post-fix: lands on `/dashboard`. |

### 18.2 3-layer dashboard (Flow F)

| TC | Layer | Setup | Flow |
|---|---|---|---|
| **TC-FE-ADM.10** | [PLAYWRIGHT] | Seeded alerts: Priya (Tier 1 pregnancy+ACE), James (Tier 1 NDHP+HFrEF), one BP L2 trigger | `/dashboard` → assert Layer 1 top panel shows: pulsing red BP L2 banner; 2 stacked Tier 1 red banners (non-dismissable); a Tier 2 yellow chip with count. |
| **TC-FE-ADM.11** | [PLAYWRIGHT] | Tier 1 alert at T+8h (escalated) | Assert banner has "blinking" or "animated" visual cue (CSS class or data-attr); verify via [Playwright accessibility tree]. |
| **TC-FE-ADM.12** | [PLAYWRIGHT] | Alert row clicked in Layer 2 queue | Side panel opens with alert details, three-tier messages, escalation ladder progress, Resolve button. |
| **TC-FE-ADM.13** | [PLAYWRIGHT] | Layer 3 stat cards | Assert values come from `GET /provider/stats`: total patients, open alerts by tier, avg time-to-ack, patients with unverified profiles. |
| **TC-FE-ADM.14** | [MANUAL] | Visual polish: traffic-light colors (red/yellow/green) map to Tier 1 / Tier 2 / Tier 3 correctly. |

### 18.3 Patient list (Flow K)

| TC | Layer | Flow |
|---|---|---|
| **TC-FE-ADM.20** | [PLAYWRIGHT] | `/patients` → table renders name, verification status column, open-alert count with tier color coding, last reading date. |
| **TC-FE-ADM.21** | [PLAYWRIGHT] | Filter chip "Awaiting Verification" → URL query updates; table rows filter to UNVERIFIED patients only. |
| **TC-FE-ADM.22** | [PLAYWRIGHT] | Patient row "Complete onboarding" CTA, if gate fails → button disabled with hover tooltip listing 409 reasons. |
| **TC-FE-ADM.23** | [PLAYWRIGHT] | Click patient row → navigate to `/patients/[id]` → header shows name, verification badge, open-alert count. |

### 18.4 Patient detail — Profile tab (Flow H1)

| TC | Layer | Setup | Flow |
|---|---|---|---|
| **TC-FE-ADM.30** | [PLAYWRIGHT] | UNVERIFIED patient | `/patients/[id]` → Profile tab → assert two columns: patient-reported (left, read-only) vs admin-editable (right). |
| **TC-FE-ADM.31** | [PLAYWRIGHT] | Click ✅ Confirm on a field | Field's admin column marks confirmed locally (no API call until the footer button); state persists in page context. |
| **TC-FE-ADM.32** | [PLAYWRIGHT] | Click ✏️ Correct on `heightCm` → modal with new value + rationale textarea | Submit → `POST /admin/users/:id/correct-profile` with the correction + rationale → assert 200; banner updates to "Corrected"; field shows the corrected value on both columns. |
| **TC-FE-ADM.33** | [PLAYWRIGHT] | Click ❌ Reject on `hasHeartFailure` | Modal with rationale → submit → `POST /admin/users/:id/reject-profile-field` → assert 200; field shows "Rejected — patient to re-enter"; profile badge flips to UNVERIFIED. |
| **TC-FE-ADM.34** | [PLAYWRIGHT] | Footer "Verification complete" button clicked (no corrections) | `POST /admin/users/:id/verify-profile` → 200 → VERIFIED badge renders. |
| **TC-FE-ADM.35** | [PLAYWRIGHT] | Try to reject field with empty rationale | Submit blocked client-side; backend rejects 400 as defense. |
| **TC-FE-ADM.36** | [MANUAL] | Banner styling: UNVERIFIED amber, CORRECTED neutral/info, VERIFIED green or hidden. |

### 18.5 Patient detail — Medications tab (Flow H2)

| TC | Layer | Flow |
|---|---|---|
| **TC-FE-ADM.40** | [PLAYWRIGHT] | Medications tab → list renders with per-row status badge (AWAITING_PROVIDER / UNVERIFIED / VERIFIED / REJECTED); discontinued meds with strike-through. |
| **TC-FE-ADM.41** | [PLAYWRIGHT] | Row "Verify" button → `POST /admin/medications/:id/verify  { status: "VERIFIED" }` → 200 → badge flips to green VERIFIED. |
| **TC-FE-ADM.42** | [PLAYWRIGHT] | Row "Reject" button → modal with rationale textarea → submit → `POST /admin/medications/:id/verify  { status: "REJECTED", rationale }` → 200 → badge flips to red REJECTED; patient receives notification (verify via DB / separate patient session). |
| **TC-FE-ADM.43** | [PLAYWRIGHT] | Reject with empty rationale → submit blocked client-side; backend 400 if bypassed. |
| **TC-FE-ADM.44** | [MANUAL] | Reconciliation side-by-side view (H2 Layer 2 per CLINICAL_SPEC V2-C) — MVP ships data model + UI shell only; full workflow deferred. Visual sanity: both columns render something. |

### 18.6 Patient detail — Alerts tab (Flow H3)

| TC | Layer | Flow |
|---|---|---|
| **TC-FE-ADM.50** | [PLAYWRIGHT] | Alerts tab → filter dropdown by tier → list updates. |
| **TC-FE-ADM.51** | [PLAYWRIGHT] | Click alert row → expands to show three-tier messages (patient / caregiver / physician) + escalation ladder timeline (T+0 → T+4h → ... with green checkmarks for completed steps). |

### 18.7 Resolution modals (Flow G)

| TC | Layer | Alert tier | Flow |
|---|---|---|---|
| **TC-FE-ADM.60** | [PLAYWRIGHT] | Tier 1 | Click Resolve → modal with dropdown of 5 Tier 1 actions + rationale textarea (required) → pick "TIER1_DISCONTINUED" + type rationale → submit → `POST /admin/alerts/:id/resolve` 200; alert closes; row disappears from Layer 1 panel. |
| **TC-FE-ADM.61** | [PLAYWRIGHT] | Tier 1 without rationale | Submit blocked client-side; backend returns 400 if bypassed. |
| **TC-FE-ADM.62** | [PLAYWRIGHT] | Tier 2 | Modal with 5 Tier 2 actions; select `TIER2_WILL_CONTACT` without rationale → submit → 200 (rationale optional for this action). |
| **TC-FE-ADM.63** | [PLAYWRIGHT] | Tier 2 `TIER2_REVIEWED_NO_ACTION` | Submit blocked without rationale; select with rationale → 200. |
| **TC-FE-ADM.64** | [PLAYWRIGHT] | BP Level 2 | Modal with 6 actions; pick `BP_L2_UNABLE_TO_REACH_RETRY` + rationale → submit → 200 with `{ status: "OPEN", retryScheduledFor }`; modal shows confirmation "Retry scheduled at T+4h"; alert row stays visible (OPEN). |
| **TC-FE-ADM.65** | [PLAYWRIGHT] | BP Level 2 `BP_L2_REVIEWED_TRENDING_DOWN` | Rationale must document trend — UI hints label; submit → 200; alert RESOLVED. |
| **TC-FE-ADM.66** | [MANUAL] | Modal cannot be closed without action + rationale (for tiers that require it). Escape key / click-outside suppressed. |

### 18.8 Thresholds tab (Flow H4)

| TC | Layer | Setup | Flow |
|---|---|---|---|
| **TC-FE-ADM.70** | [PLAYWRIGHT] | HFrEF patient without threshold | Thresholds tab → assert red "Mandatory configuration required" banner at top. |
| **TC-FE-ADM.71** | [PLAYWRIGHT] | Editor form pre-fill | CAD patient → DBP lower target pre-fills to 70; HCM → SBP lower 100; HFrEF → SBP lower 85 (verify — this is per FRONTEND_BUILD_SPEC). |
| **TC-FE-ADM.72** | [PLAYWRIGHT] | Enter values + click Save | `POST /admin/patients/:id/threshold` 201; banner clears. |
| **TC-FE-ADM.73** | [PLAYWRIGHT] | Edit existing threshold | `PATCH /admin/patients/:id/threshold` 200; setAt timestamp updates. |
| **TC-FE-ADM.74** | [PLAYWRIGHT] | PROVIDER role visits Thresholds tab | UI should render read-only (save button disabled) OR tab is hidden. Verify per actual implementation. |

### 18.9 Timeline tab (Flow H5)

| TC | Layer | Flow |
|---|---|---|
| **TC-FE-ADM.80** | [PLAYWRIGHT] | Timeline tab → chronological feed renders with actor + event + timestamp; events include ProfileVerificationLog entries, alerts, escalations, resolutions. |
| **TC-FE-ADM.81** | [PLAYWRIGHT] | Tab is always refetched on entry (no stale data) — assert `GET /admin/users/:id/verification-logs` fires on each tab switch. |

### 18.10 Practice + scheduled calls

| TC | Layer | Flow |
|---|---|---|
| **TC-FE-ADM.90** | [PLAYWRIGHT] | `/practices` list → shows practices with staff count + patient count; "Add practice" button. |
| **TC-FE-ADM.91** | [PLAYWRIGHT] | `/practices/[id]` → business hours editor (start / end time pickers), timezone IANA dropdown, after-hours protocol textarea, staff list. |
| **TC-FE-ADM.92** | [PLAYWRIGHT] | Save practice with invalid HH:MM → submit blocked client-side; backend 400. |
| **TC-FE-ADM.93** | [PLAYWRIGHT] | `/scheduled-calls` list, filter by status, click row to edit → `PATCH /provider/scheduled-calls/:id/status` fires correctly. |

---

## 19. Cross-layer — Medication rejection flow

End-to-end happy/sad paths spanning backend + admin UI + patient UI. Each TC names the layers it exercises.

### 19.1 Happy path

| TC | Layer(s) | Step | Assertion |
|---|---|---|---|
| **TC-MREJ.01** | [E2E] + [PLAYWRIGHT] | Patient seed `priya.menon@cardioplace.test` reports Lisinopril via intake | PatientMedication row created with `verificationStatus: AWAITING_PROVIDER` |
| **TC-MREJ.02** | [E2E] + [PLAYWRIGHT] | Admin opens `/patients/[priya-id]` → Medications tab → Reject Lisinopril with rationale "Patient meant Losartan per pharmacy record" | `POST /admin/medications/:id/verify  { status: REJECTED, rationale }` 200; badge flips to REJECTED |
| **TC-MREJ.03** | [E2E] | Query `Notification` table for Priya | One PUSH notification created with title referencing medication review |
| **TC-MREJ.04** | [E2E] | Patient logs next reading | Rule engine's `ProfileResolver` excludes Lisinopril from `contextMeds`; if pregnant, `RULE_PREGNANCY_ACE_ARB` does NOT fire |
| **TC-MREJ.05** | [E2E] | Query `ProfileVerificationLog` | One row with `changeType: ADMIN_REJECT`, `rationale` populated, `discrepancyFlag: true` |
| **TC-MREJ.06** | [PLAYWRIGHT] | Patient visits `/profile` → Medications section | Rejected med visible with strike-through + admin rationale note (exact copy TBD — confirm manually first pass) |

### 19.2 Re-report after rejection

| TC | Layer(s) | Step | Assertion |
|---|---|---|---|
| **TC-MREJ.10** | [E2E] | After TC-MREJ.02, patient re-adds Lisinopril via `POST /intake/medications` | New PatientMedication row created (the rejected row is retained); `verificationStatus: AWAITING_PROVIDER` on the new row |
| **TC-MREJ.11** | [E2E] | `profileVerificationStatus` on PatientProfile | Flipped back to UNVERIFIED |
| **TC-MREJ.12** | [E2E] | `GET /admin/users/:id/medications` | Returns BOTH rows: the rejected row AND the new AWAITING_PROVIDER row. |

### 19.3 Existing alert when med is rejected

| TC | Layer(s) | Step | Assertion |
|---|---|---|---|
| **TC-MREJ.20** | [E2E] | Priya (pregnant) reports Lisinopril → first reading fires `RULE_PREGNANCY_ACE_ARB` Tier 1 | Alert OPEN |
| **TC-MREJ.21** | [E2E] | Admin rejects the Lisinopril med (TC-MREJ.02 step) | Alert status remains OPEN — rejection alone does NOT close existing alerts |
| **TC-MREJ.22** | [E2E] | Admin separately resolves the alert with `TIER1_FALSE_POSITIVE` + rationale "Medication was Losartan" | Alert RESOLVED; escalation events closed |
| **TC-MREJ.23** | [E2E] | Next patient reading | New rule evaluation; Lisinopril excluded; no new Tier 1 fires |

### 19.4 Rejection of discontinued medication

| TC | Layer(s) | Step | Assertion |
|---|---|---|---|
| **TC-MREJ.30** | [E2E] | Patient discontinues a med (`PATCH /me/medications/:id  { discontinue: true }`) | `discontinuedAt: now`; verificationStatus unchanged |
| **TC-MREJ.31** | [E2E] | Admin attempts to Reject the discontinued med | Verify behavior — should accept but the rejection is audit-only (med is already excluded via discontinuedAt). Document actual behavior. |

---

## 20. Cross-layer — Profile verification UI flow

### 20.1 Happy path

| TC | Layer(s) | Step | Assertion |
|---|---|---|---|
| **TC-VUI.01** | [PLAYWRIGHT] (patient) | Priya completes `/clinical-intake` | On `/dashboard`, "Awaiting Provider Verification" badge visible |
| **TC-VUI.02** | [PLAYWRIGHT] (admin) | Admin opens `/patients/[priya-id]` → Profile tab | Two columns render; all fields marked UNVERIFIED |
| **TC-VUI.03** | [PLAYWRIGHT] (admin) | Confirm each field (✅ buttons) → click "Verification complete" footer button | `POST /admin/users/:id/verify-profile` fires 200; banner updates to VERIFIED green |
| **TC-VUI.04** | [E2E] | `GET /me/profile` post-verify | `profileVerificationStatus: VERIFIED`; `profileVerifiedAt` + `profileVerifiedBy` populated |
| **TC-VUI.05** | [PLAYWRIGHT] (patient) | Priya refreshes `/dashboard` | Badge gone |

### 20.2 Correction path

| TC | Layer(s) | Step | Assertion |
|---|---|---|---|
| **TC-VUI.10** | [PLAYWRIGHT] (admin) | Admin clicks ✏️ Correct on `heightCm` (patient said 160, chart says 165) | Modal with rationale textarea required |
| **TC-VUI.11** | [PLAYWRIGHT] (admin) | Submit correction + rationale "Measured in clinic" | `POST /admin/users/:id/correct-profile  { corrections: { heightCm: 165 }, rationale }` 200 |
| **TC-VUI.12** | [E2E] | `GET /me/profile` | `heightCm: 165`; `profileVerificationStatus: CORRECTED` |
| **TC-VUI.13** | [PLAYWRIGHT] (patient) | Priya visits `/dashboard` | Badge state: CORRECTED (neutral info color) — copy something like "Some fields updated by your care team" |
| **TC-VUI.14** | [E2E] | `ProfileVerificationLog` | Row with `changeType: ADMIN_CORRECT`, `discrepancyFlag: true`, `previousValue: {heightCm: 160}`, `newValue: {heightCm: 165}` |

### 20.3 Rejection path (patient must re-enter)

| TC | Layer(s) | Step | Assertion |
|---|---|---|---|
| **TC-VUI.20** | [PLAYWRIGHT] (admin) | Admin clicks ❌ Reject on `hasHeartFailure` | Modal with rationale |
| **TC-VUI.21** | [PLAYWRIGHT] (admin) | Submit + rationale "No HF diagnosis in chart" | `POST /admin/users/:id/reject-profile-field  { field, rationale }` 200 |
| **TC-VUI.22** | [E2E] | `GET /me/profile` | `profileVerificationStatus: UNVERIFIED`; `hasHeartFailure: false` (or unchanged — verify) |
| **TC-VUI.23** | [PLAYWRIGHT] (patient) | Priya receives push notification "Your care team updated your profile — please review" | Notification row created |
| **TC-VUI.24** | [PLAYWRIGHT] (patient) | Priya visits `/dashboard` → Action Required card OR badge prompts re-entry → re-opens Flow A3 | Clinical intake wizard re-entered at Conditions step |
| **TC-VUI.25** | [PLAYWRIGHT] (patient) | Priya re-submits | `POST /intake/profile` 200; `profileVerificationStatus: UNVERIFIED` (new UNVERIFIED state, awaiting re-verify) |

### 20.4 Patient edit post-verify → back to UNVERIFIED

| TC | Layer(s) | Step | Assertion |
|---|---|---|---|
| **TC-VUI.30** | [E2E] | Patient with VERIFIED profile edits any clinical field via `POST /intake/profile` | `profileVerificationStatus` flips to UNVERIFIED; `profileLastEditedAt: now` |
| **TC-VUI.31** | [PLAYWRIGHT] (patient) | Badge re-appears on `/dashboard` | Amber "Awaiting Provider Verification" |
| **TC-VUI.32** | [PLAYWRIGHT] (admin) | Admin's patient list → "Awaiting Verification" filter shows the patient again | Row surfaces |

---

## 21. Cross-layer — Medication verification UI flow

### 21.1 Verify happy path

| TC | Layer(s) | Step | Assertion |
|---|---|---|---|
| **TC-MUI.01** | [PLAYWRIGHT] (patient) | Priya reports Lisinopril | PatientMedication row `verificationStatus: AWAITING_PROVIDER` |
| **TC-MUI.02** | [PLAYWRIGHT] (admin) | Admin Medications tab → Verify button on Lisinopril | `POST /admin/medications/:id/verify  { status: VERIFIED }` 200 |
| **TC-MUI.03** | [E2E] | `GET /me/medications` | Row `verificationStatus: VERIFIED`; `verifiedAt`, `verifiedByAdminId` populated |
| **TC-MUI.04** | [PLAYWRIGHT] (patient) | Priya `/profile` Medications | Med shows green "Verified by Dr. [name]" pill |

### 21.2 Reject path — see §19

### 21.3 Edit post-verify

| TC | Layer(s) | Step | Assertion |
|---|---|---|---|
| **TC-MUI.10** | [PLAYWRIGHT] (patient) | Patient edits a VERIFIED med via `/profile` → Edit flow → change frequency | `PATCH /me/medications/:id  { frequency: "TWICE_DAILY" }` 200 |
| **TC-MUI.11** | [E2E] | PatientMedication row | `verificationStatus: UNVERIFIED` (not REJECTED — this is a patient edit, not rejection) |
| **TC-MUI.12** | [E2E] | `profileVerificationStatus` on PatientProfile | Flips back to UNVERIFIED — med edits trigger full profile re-verification |
| **TC-MUI.13** | [PLAYWRIGHT] (admin) | Med re-appears as UNVERIFIED in Medications tab; admin re-verifies | Cycle complete |

### 21.4 Discontinue flow

| TC | Layer(s) | Step | Assertion |
|---|---|---|---|
| **TC-MUI.20** | [PLAYWRIGHT] (patient) | Patient discontinues a med via `/profile` → "I stopped taking this" button → confirm | `PATCH /me/medications/:id  { discontinue: true }` |
| **TC-MUI.21** | [E2E] | Row | `discontinuedAt: now`; verificationStatus unchanged; profile NOT flipped to UNVERIFIED |
| **TC-MUI.22** | [PLAYWRIGHT] (admin) | Medications tab | Discontinued med rendered with strike-through; no re-verify prompt |
| **TC-MUI.23** | [E2E] | Next rule engine run | Discontinued med filtered out of `contextMeds` |

---

## 22. Cross-layer — "Awaiting Verification" badge

Per [TESTING_FLOW_GUIDE.md §10.3](TESTING_FLOW_GUIDE.md).

| TC | Layer | Location | Condition | Expected |
|---|---|---|---|---|
| **TC-BADGE.01** | [PLAYWRIGHT] (patient) | `/dashboard` below greeting | UNVERIFIED + PatientProfile exists | Amber pill rendered, text "Awaiting Provider Verification" |
| **TC-BADGE.02** | [PLAYWRIGHT] (patient) | `/dashboard` | No PatientProfile yet | Badge NOT rendered (Action Required card takes its place) |
| **TC-BADGE.03** | [PLAYWRIGHT] (patient) | `/dashboard` | VERIFIED | Badge NOT rendered |
| **TC-BADGE.04** | [PLAYWRIGHT] (patient) | `/dashboard` | CORRECTED | Neutral info pill "Some fields updated by your care team" (copy TBD) |
| **TC-BADGE.05** | [PLAYWRIGHT] (patient) | `/profile` sections | Per-section UNVERIFIED | Each section shows its own badge |
| **TC-BADGE.06** | [PLAYWRIGHT] (admin) | `/patients` list column | Aggregated count per patient | Row sortable + filterable |
| **TC-BADGE.07** | [PLAYWRIGHT] (admin) | `/patients/[id]` header | Patient's current status | Badge next to name |
| **TC-BADGE.08** | [PLAYWRIGHT] (patient) | After patient edits a VERIFIED field | Badge re-appears on next `/dashboard` visit | Real-time or on navigation refresh |
| **TC-BADGE.09** | [PLAYWRIGHT] (admin) | After admin corrects a field | Admin's patient list shows CORRECTED state (distinguishable from fresh UNVERIFIED) | Different styling |
| **TC-BADGE.10** | [MANUAL] | Visual regression | Badge styles (amber UNVERIFIED, green VERIFIED hidden, neutral CORRECTED) against design tokens |

---

## 23. Step 8–11 branches (expanded)

Every branch enumerated in [TESTING_FLOW_GUIDE.md §8](TESTING_FLOW_GUIDE.md) mapped to a concrete test case. Many are covered by §9–§13 above; this section cross-references them to ensure nothing is missed.

### 23.1 Step 8 — journal entry submit branches

| Branch | TC reference(s) |
|---|---|
| measuredAt > now + 5 min | TC-JNL.10 |
| measuredAt < now − 30 days | TC-JNL.11 |
| duplicate (userId, measuredAt) | TC-JNL.12 |
| missing measuredAt | TC-JNL.17 |
| out-of-range BP | TC-JNL.13, TC-JNL.14 |
| no JWT | TC-JNL.16 |
| authenticated + no PatientProfile (Layer A gate) | TC-JNL.GATE.01–04 |
| has sessionId → exact match grouping | TC-JNL.30 |
| no sessionId → ±30 min grouping | TC-JNL.31, TC-JNL.32 |
| legacy symptoms[] merged | TC-JNL.05 |
| structured symptom flag | TC-JNL.03 |
| suboptimalMeasurement propagation | TC-JNL.04 + TC-RUL.L1H.06 |

### 23.2 Step 9 — alert produced or not

| Branch | TC reference(s) |
|---|---|
| No PatientProfile → null | TC-RUL.BND.07, TC-JNL.GATE.01 |
| Pre-gate Tier 1 (pregnancy+ACE/ARB, NDHP+HFrEF VERIFIED) | TC-RUL.T1.01, T1.02 + safety-net variants T1.03–T1.11 |
| Pre-gate symptom override (9 flags total) | TC-RUL.SYM.01–09 |
| AFib <3 readings + no pre-gate match | TC-RUL.BND.02 |
| AFib <3 readings + pre-gate match | TC-JNL.35, TC-JNL.36, TC-RUL.T1.04 |
| Absolute emergency | TC-RUL.L2.01 |
| Pregnancy L2 / L1 | TC-RUL.L2.02, TC-RUL.L1H.01 |
| Condition branches (HFrEF, HFpEF, CAD, HCM, DCM) | TC-RUL.L1H.07–11, TC-RUL.L1L.01–06 |
| Personalized mode | TC-RUL.L1H.03, TC-RUL.L1L.07 |
| Standard mode | TC-RUL.L1H.04, TC-RUL.L1H.13 |
| Age 65+ override | TC-RUL.L1L.03, TC-RUL.AGE.01–06 |
| AFib HR >110 / <50 | TC-RUL.L1H.02, TC-RUL.L1L.09 |
| Tachy consecutive | TC-RUL.L1H.12 |
| Brady symptomatic / asymptomatic | TC-RUL.L1L.10, TC-RUL.BND.03 |
| BB suppression 50–60 | TC-RUL.BND.03 |
| Pulse pressure >60 | TC-RUL.T3.02, TC-RUL.L1H.05 |
| HCM vasodilator / nitrate | TC-RUL.T3.01 |
| Loop diuretic hypotension | TC-RUL.T3.03 |
| Benign → auto-resolve L1 alerts | TC-RUL.BND.01 |

### 23.3 Step 10 — escalation ladder

| Branch | TC reference(s) |
|---|---|
| Tier 1 business hours full ladder | TC-ESC.T1.01–06 |
| Tier 1 after-hours safety net | TC-ESC.T1.10–13 |
| Tier 2 ladder | TC-ESC.T2.01–04 |
| BP L2 ladder | TC-ESC.L2.01–05 |
| BP L2 symptom override patient re-notify | TC-ESC.L2S.01–02 |
| BP L2 #6 retry | TC-ESC.RETRY.01–03 |
| Fail-loud on missing roles | TC-ESC.FAIL.01–02 |
| Anchor correctness | TC-ESC.ANCH.01–02 |
| Dual-notify at T+0 | TC-ESC.DUAL.01 |
| Idempotency across cron runs | TC-ESC.IDEM.01 |
| Acknowledge stops cron | TC-ESC.T1.03 |
| Layer B gate — before enrollment complete | TC-JNL.GATE.04 |

### 23.4 Step 11 — admin resolution

| Branch | TC reference(s) |
|---|---|
| Acknowledge idempotent | TC-RES.01, TC-RES.02 |
| Tier 1 all 5 actions + rationale required | TC-RES.10–14, TC-RES.20–22 |
| Tier 2 rationale matrix | TC-RES.30–35 |
| BP L2 all 6 actions + rationale required | TC-RES.40–46 |
| BP L2 #6 leaves OPEN, schedules retry | TC-RES.45 + TC-ESC.RETRY.01 |
| Resolve already-resolved | TC-RES.24 |
| Tier / action mismatch | TC-RES.23 |
| Audit payload 15 fields | TC-RES.50 |
| Non-admin tries | TC-RES.51, TC-RBAC.17 |

---

## 24. Unit test prescriptions

Services not yet unit-covered by [TEST_SCENARIOS.md](TEST_SCENARIOS.md). Prescriptive — the author writes the spec file; these are what it must assert.

### 24.1 `EscalationService`

File: `backend/src/daily_journal/services/escalation.service.spec.ts` (to be created or expanded).

| TC | Layer | Assertion |
|---|---|---|
| **TC-UNIT.ESC.01** | [UNIT] | `fireT0()` for Tier 1 at business hours writes one EscalationEvent with `afterHours=false`, recipientRoles=[PRIMARY_PROVIDER] |
| **TC-UNIT.ESC.02** | [UNIT] | `fireT0()` for Tier 1 after-hours writes TWO rows: one queued PRIMARY, one immediate BACKUP |
| **TC-UNIT.ESC.03** | [UNIT] | `fireT0()` for BP L2 writes one row with 3 recipients regardless of hour |
| **TC-UNIT.ESC.04** | [UNIT] | `advanceOverdueLadders()` skips ACKNOWLEDGED alerts |
| **TC-UNIT.ESC.05** | [UNIT] | `scheduleRetry()` writes `triggeredByResolution: true`, `scheduledFor: now + 4h` |
| **TC-UNIT.ESC.06** | [UNIT] | `getRecipientUserIds()` returns `{ missingRequiredRoles: ['PRIMARY_PROVIDER'] }` when assignment's primary id doesn't resolve |
| **TC-UNIT.ESC.07** | [UNIT] | HEALPLACE_OPS with no matching users logs warning, returns empty id list, does not throw |
| **TC-UNIT.ESC.08** | [UNIT] | Anchor computation: uses `notificationSentAt` > `scheduledFor` > `triggeredAt` > `alert.createdAt` in that order |
| **TC-UNIT.ESC.09** | [UNIT] | `firePendingScheduled()` dispatches queued T+0 events whose `scheduledFor <= now` |
| **TC-UNIT.ESC.10** | [UNIT] | Notification `@@unique` idempotency — duplicate insert throws `P2002` → service swallows error |

### 24.2 `AlertResolutionService`

File: `backend/src/daily_journal/services/alert-resolution.service.spec.ts`.

| TC | Layer | Assertion |
|---|---|---|
| **TC-UNIT.RES.01** | [UNIT] | Resolve Tier 1 without rationale → throws `BadRequestException` |
| **TC-UNIT.RES.02** | [UNIT] | Resolve Tier 2 with `TIER2_REVIEWED_NO_ACTION` without rationale → throws |
| **TC-UNIT.RES.03** | [UNIT] | Resolve Tier 2 with `TIER2_WILL_CONTACT` without rationale → succeeds |
| **TC-UNIT.RES.04** | [UNIT] | Resolve BP L2 with `BP_L2_UNABLE_TO_REACH_RETRY` → calls `EscalationService.scheduleRetry()`; returns `{ status: "OPEN" }` |
| **TC-UNIT.RES.05** | [UNIT] | Tier/action mismatch (Tier 1 action on BP L2 alert) → throws |
| **TC-UNIT.RES.06** | [UNIT] | Resolve already-resolved → throws `"Alert is already resolved"` |
| **TC-UNIT.RES.07** | [UNIT] | Non-admin role → throws `ForbiddenException` (verify via explicit role check path, not just guard) |
| **TC-UNIT.RES.08** | [UNIT] | Audit payload builds 15 fields correctly; time-to-ack calculated as `acknowledgedAt - createdAt` |
| **TC-UNIT.RES.09** | [UNIT] | Resolution closes all open EscalationEvents for the alert |

### 24.3 Enrollment gate

File: `backend/src/practice/enrollment-gate.spec.ts`.

| TC | Layer | Assertion |
|---|---|---|
| **TC-UNIT.ENR.01** | [UNIT] | `canCompleteOnboarding()` returns `{ ok: true }` when all prereqs satisfied |
| **TC-UNIT.ENR.02** | [UNIT] | Returns `reasons: ['no-assignment']` when assignment missing |
| **TC-UNIT.ENR.03** | [UNIT] | Returns `reasons: ['practice-missing-business-hours']` when any of 3 business-hours fields null |
| **TC-UNIT.ENR.04** | [UNIT] | Returns `reasons: ['patient-profile-missing']` when no PatientProfile |
| **TC-UNIT.ENR.05** | [UNIT] | Returns `reasons: ['threshold-required-for-condition']` for HFrEF / HCM / DCM without threshold |
| **TC-UNIT.ENR.06** | [UNIT] | HFpEF without threshold → ok: true |
| **TC-UNIT.ENR.07** | [UNIT] | UNKNOWN HF type without threshold → ok: true (raw field check) |
| **TC-UNIT.ENR.08** | [UNIT] | Multiple failures → reasons array includes all applicable |

### 24.4 Cron services

Files: `backend/src/crons/gap-alert.service.spec.ts`, `monthly-reask.service.spec.ts`.

| TC | Layer | Assertion |
|---|---|---|
| **TC-UNIT.CRN.01** | [UNIT] | Gap-alert: `runScan(now)` returns count of patients matched |
| **TC-UNIT.CRN.02** | [UNIT] | 24h idempotency via exact-title filter on Notification table |
| **TC-UNIT.CRN.03** | [UNIT] | Monthly re-ask: 28d idempotency window |
| **TC-UNIT.CRN.04** | [UNIT] | Monthly re-ask: `verifiedAt ?? reportedAt` selection logic |

### 24.5 Existing unit coverage (reference, do not re-write)

See [TEST_SCENARIOS.md](TEST_SCENARIOS.md) — 182 cases already green:
- ProfileResolverService (§1)
- Derivatives (§2)
- SessionAveragerService (§3)
- Rule functions (§4)
- AlertEngineService (§5)
- OutputGeneratorService (§6)

---

## 25. Integration test prescriptions

Per-controller, using real Prisma + real test DB, HTTP layer bypassed. Jest + `TestingModule` from `@nestjs/testing`. Transaction rollback per test.

| TC | Layer | Controller | Assertion focus |
|---|---|---|---|
| **TC-INTEG.01** | [INTEG] | `IntakeController` | DTO validation actually runs; on valid `POST /intake/profile`, exactly one PatientProfile row + one ProfileVerificationLog row written |
| **TC-INTEG.02** | [INTEG] | `AdminIntakeController` | Verify-profile writes audit log with `changeType: ADMIN_VERIFY`; correct-profile writes with `changeType: ADMIN_CORRECT` + `discrepancyFlag: true` |
| **TC-INTEG.03** | [INTEG] | `DailyJournalController` | `POST /daily-journal` writes JournalEntry + emits `ENTRY_CREATED` (assert via spy on `EventEmitter2`); 202 returned |
| **TC-INTEG.04** | [INTEG] | `AlertResolutionController` | Resolve with valid tier+action+rationale → DeviationAlert.status transitions correctly; associated EscalationEvent rows close |
| **TC-INTEG.05** | [INTEG] | `PracticeController` | CRUD round-trip; HH:MM validation; role guard integration (load fake JWT via `JwtAuthGuard` override) |
| **TC-INTEG.06** | [INTEG] | `AssignmentController` | Role-type validation: PRIMARY must be PROVIDER|MEDICAL_DIRECTOR; MD must be MEDICAL_DIRECTOR strictly |
| **TC-INTEG.07** | [INTEG] | `ThresholdController` | POST twice → 409; PATCH when absent → 404; range validation across all 6 fields |
| **TC-INTEG.08** | [INTEG] | `EnrollmentController` | Gate logic returns correct `reasons[]` for each missing prereq combination (table-driven test) |
| **TC-INTEG.09** | [INTEG] | `ChatController` | Session creation + message persistence; ownership enforcement on GET |
| **TC-INTEG.10** | [INTEG] | `AuthController` | OTP lifecycle: send → verify → refresh → logout; RefreshToken row revocation; device id persistence |
| **TC-INTEG.11** | [INTEG] | Cross-controller: intake → alert engine → escalation | POST `/intake/profile` then POST `/daily-journal` with pregnancy + ACE → assert DeviationAlert row + EscalationEvent row in a single test |

---

## 26. Cross-cutting data integrity

Not HTTP tests per se — run after every suite. Query DB directly.

| TC | Layer | Check | Query |
|---|---|---|---|
| **TC-DI.01** | [INTEG] | Every PatientProfile has a matching User with role PATIENT | JOIN |
| **TC-DI.02** | [INTEG] | Every DeviationAlert has a matching JournalEntry | JOIN |
| **TC-DI.03** | [INTEG] | Every EscalationEvent has a matching DeviationAlert | JOIN |
| **TC-DI.04** | [INTEG] | No duplicate (alertId, escalationEventId, userId, channel) in Notification | `@@unique` check |
| **TC-DI.05** | [INTEG] | No JournalEntry with (userId, measuredAt) duplicate | `@@unique` check |
| **TC-DI.06** | [INTEG] | Every ProfileVerificationLog references a valid User | JOIN |
| **TC-DI.07** | [INTEG] | No PatientMedication with `verificationStatus: VERIFIED` but `verifiedByAdminId: null` | Consistency |
| **TC-DI.08** | [INTEG] | Every PatientThreshold has `setByProviderId` referencing a User with MEDICAL_DIRECTOR or SUPER_ADMIN role | Consistency |
| **TC-DI.09** | [INTEG] | All DeviationAlert rows with `tier IN (TIER_1_*, BP_LEVEL_2_*)` have `dismissible: false` | Consistency |
| **TC-DI.10** | [INTEG] | All DeviationAlert rows with `tier IN (BP_LEVEL_1_*, TIER_2_*, TIER_3_*)` have `dismissible: true` | Consistency |

---

## 27. Performance sanity

Run once before release.

| TC | Layer | Load | Expected |
|---|---|---|---|
| **TC-PRF.01** | [E2E] | 500 readings submitted in 1 hour across 50 patients | All return 202 in <500ms; no duplicate alerts; rule engine keeps up |
| **TC-PRF.02** | [E2E] | 50 concurrent admin logins verifying patient profiles | No lock contention; verification log rows all written |
| **TC-PRF.03** | [INTEG] | Escalation cron at 15-min interval with 500 open alerts | Scan completes in <30s |

---

## 28. Regression set

Merge-blocking failures. If any of these regress, hold the release.

1. **TC-RUL.T1.01** — Pregnant + ACE fires Tier 1 on UNVERIFIED meds (safety-net).
2. **TC-RUL.T1.10** — Tier 1 beats BP L2 emergency (pregnancy precedence).
3. **TC-RUL.AGE.06** — 65+ lower bound SBP <100 (not <90).
4. **TC-RUL.BND.07** — Admin user logs reading → **403** at Layer A (clinical-intake-required).
5. **TC-ENR.13** — HFrEF without threshold blocks enrollment.
6. **TC-ESC.ANCH.01** — Ladder anchors to dispatch time, not createdAt.
7. **TC-ESC.L2.04** — BP L2 fires immediately after-hours.
8. **TC-ESC.RETRY.01** — BP_L2_UNABLE_TO_REACH_RETRY leaves alert OPEN.
9. **TC-RES.20** — Tier 1 resolve without rationale is 400.
10. **TC-JNL.12** — Duplicate (userId, measuredAt) is 409.
11. **TC-MSG.03** — Physician-only rules produce empty patient/caregiver messages.
12. **TC-CHT.08** — Chat guardrail: never suggest stopping medication on active Tier 1.
13. **TC-JNL.GATE.01** — Layer A: no-profile user gets 403 `clinical-intake-required` before any row is written.
14. **TC-JNL.GATE.04** — Layer B: unenrolled patient's alert persists but no EscalationEvent / Notification dispatched.
15. **TC-RBAC.77** — Admin proxy accepts PROVIDER / MEDICAL_DIRECTOR / HEALPLACE_OPS alongside SUPER_ADMIN.
15. **TC-MREJ.04** — Rejected medication is excluded from rule engine on next reading.
16. **TC-VUI.30** — Patient edit post-verify flips status back to UNVERIFIED.

---

## 29. Filing bugs

Every failing test case filed as a ticket should include:

```
TC ID:            TC-<section>.<num>
Section:          <title>
Branch:           <phase/N>
Layer:            [UNIT] / [INTEG] / [E2E] / [MANUAL] / [PLAYWRIGHT]
Reproduced?       Yes / No (spec-only)
Actual output:    <what happened>
Expected output:  <per this doc>
Clinical impact:  <from CLINICAL_SPEC.md if applicable>
Evidence:         DB query, log line, HAR file, Playwright trace
```

Do not file before confirming against [CLINICAL_SPEC.md](CLINICAL_SPEC.md) — some "bugs" are intentional clinical safety decisions (e.g. NDHP requires VERIFIED but pregnancy ACE/ARB doesn't).

---

**End of document.** Total test cases: ~460 across 29 sections + 5 test layers.
