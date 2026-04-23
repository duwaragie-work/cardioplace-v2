# Testing Flow Guide — Cardioplace v2

Companion to [E2E_TEST_CASES.md](E2E_TEST_CASES.md). This document is a **narrative walkthrough of the system** for developers who will run the end-to-end test suite. Read this first, then open the test-case doc.

Everything here is grounded in the actual code, not the build plan. File references use `path:line`. When the code disagrees with this guide, the code is correct — file a correction.

---

## 1. What you're testing

A two-app clinical monitoring system:

| App | Port (dev) | Subdomain (prod) | Audience |
|---|---|---|---|
| `/backend` (NestJS) | 4000 | api.cardioplaceai.com | Shared API |
| `/frontend` (Next 16) | 3000 | app.cardioplaceai.com | Patients only |
| `/admin` (Next 16) | 3001 | admin.cardioplaceai.com | Care team + ops |
| `/adk-service` (Python) | 50051 | internal | Voice/Gemini |

Two Postgres-backed apps share one NestJS backend. Patients self-report clinical data; admins verify; practice + providers get wired up; alerts fire on journal entries and escalate through a T+0/T+4h/T+8h/T+24h/T+48h ladder.

**Live v1 at `www.cardioplaceai.com` is untouched.** This repo deploys to separate subdomains with a separate DB and JWT secret.

---

## 2. The five roles

Defined in [backend/prisma/schema/user.prisma](../backend/prisma/schema/user.prisma) as the `UserRole` enum. Every user has at least one role; admin users may have several.

| Role | App access | What they can do |
|---|---|---|
| `PATIENT` | `/frontend` only | Sign up, complete onboarding + clinical intake, log readings, view own alerts, edit own profile + meds, chat |
| `PROVIDER` | `/admin` | Verify patient profile fields, verify medications, acknowledge/resolve alerts, view assigned patients. **Cannot write Practice, Assignment, or Threshold rows.** |
| `MEDICAL_DIRECTOR` | `/admin` | Everything PROVIDER can + write Practice, Assignment, and Threshold rows. Receives Tier 1 T+8h escalation. |
| `HEALPLACE_OPS` | `/admin` | Everything MEDICAL_DIRECTOR can + receives Tier 1 T+24h escalation and BP Level 2 T+4h escalation. |
| `SUPER_ADMIN` | `/admin` only (patient proxy redirects SUPER_ADMIN to admin URL) | Everything + legacy v1 provider endpoints (`/provider/*`), content + knowledgebase admin |

**Role boundary details:**
- [`admin/src/proxy.ts`](../admin/src/proxy.ts) accepts any of `SUPER_ADMIN`, `MEDICAL_DIRECTOR`, `PROVIDER`, `HEALPLACE_OPS`. Per-endpoint `@Roles()` guards on the backend enforce finer restrictions (e.g. threshold editor is MEDICAL_DIRECTOR + SUPER_ADMIN only; practice CRUD excludes PROVIDER).
- [`frontend/src/proxy.ts`](../frontend/src/proxy.ts) redirects SUPER_ADMIN JWTs away to `NEXT_PUBLIC_ADMIN_URL`.
- `PATIENT` is the default role on signup (`roles: [PATIENT]`). Multi-role users exist (e.g. provider who is also a test patient).

---

## 3. The end-to-end happy path

One narrative, one patient, all the way through. Each step lists the file/endpoint and the state transition it drives.

```
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 1 — Patient signs in                                          │
│  POST /v2/auth/otp/send          → email with OTP                   │
│  POST /v2/auth/otp/verify        → { accessToken, onboarding_required: true } │
│  (Seed users: perma-OTP 666666 per phase/19)                        │
└─────────────────────────────────────────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 2 — Basic onboarding                                          │
│  POST /v2/auth/profile  { name, dateOfBirth, timezone, ... }        │
│  → User.onboardingStatus: NOT_COMPLETED → COMPLETED                 │
│  (no PatientProfile yet — just identity fields)                     │
└─────────────────────────────────────────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 3 — Clinical intake (Flow A in FRONTEND_BUILD_SPEC)           │
│  POST /intake/profile      { gender, heightCm, conditions, HF type, pregnancy } │
│  POST /intake/medications  { medications: [...] }                    │
│  → PatientProfile row created   🔓 UNLOCKS JOURNALING (Layer A)      │
│  → profileVerificationStatus: UNVERIFIED                            │
│  → medications.verificationStatus: AWAITING_PROVIDER                │
│  → one ProfileVerificationLog row per patient-reported field        │
└─────────────────────────────────────────────────────────────────────┘
                                 ↓
     🟨  SAFETY NET ACTIVE — see §5. Patient can log readings,         
         rule engine uses UNVERIFIED profile with conservative         
         biases (HF type UNKNOWN → HFrEF; pregnancy fires ACE/ARB).   
         Alerts are created but NOT dispatched to providers yet.       
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 4 — Admin assigns practice + care team                        │
│  POST /admin/practices                   { name, businessHours... } │
│  POST /admin/patients/:id/assignment     { practiceId, primary, backup, MD } │
│  → PatientProviderAssignment row (required for escalation dispatch) │
└─────────────────────────────────────────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 5 — Admin verifies profile + meds                             │
│  POST /admin/users/:id/verify-profile              (+ audit log)    │
│  POST /admin/medications/:id/verify  { status: VERIFIED }           │
│  → profileVerificationStatus: VERIFIED                              │
│  → each med: verificationStatus: VERIFIED                           │
└─────────────────────────────────────────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 6 — (conditional) Admin sets PatientThreshold                 │
│  POST /admin/patients/:id/threshold  { sbpUpperTarget, ... }        │
│  → REQUIRED for HFrEF, HCM, DCM; optional for everyone else         │
│  → enables PERSONALIZED mode if patient also has ≥7 readings        │
└─────────────────────────────────────────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 7 — Admin passes enrollment gate                              │
│  POST /admin/patients/:id/complete-onboarding                       │
│  → checks: assignment, practice business hours, profile, threshold  │
│    (if condition requires)                                          │
│  → 200 idempotent success OR 409 with reasons[]                     │
│  🔓 UNLOCKS ESCALATION DISPATCH (Layer B)                            │
└─────────────────────────────────────────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 8 — Patient logs journal entries (Flow B)  [see §7]           │
│  POST /daily-journal  { measuredAt, systolicBP, diastolicBP, pulse, │
│                         position, sessionId, symptoms..., conditions } │
│  → 202 ACCEPTED; async rule engine evaluates                        │
│  → session averaging applies (±30 min window or explicit sessionId) │
│  → AFib gates BP/HR rules until ≥3 readings                         │
│  → pre-Day-3 mode (<7 readings) forces STANDARD mode + disclaimer   │
└─────────────────────────────────────────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 9 — Alert fires (if any)  [see §7]                            │
│  → DeviationAlert row with tier, ruleId, three-tier messages         │
│  → ALERT_CREATED event → EscalationService.fireT0()                 │
│  → T+0 EscalationEvent dispatched per ladder (Tier 1 / Tier 2 /      │
│    BP L2). BP L2 fires immediately even after-hours.                 │
│  → Notification rows per (recipient, channel) fan-out               │
└─────────────────────────────────────────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 10 — Ladder walks (15-min cron)  [see §7]                     │
│  @Cron('*/15 * * * *') runs advanceOverdueLadders()                 │
│  → each unacknowledged alert: next-step deadline computed from      │
│    T+0 actual dispatch time (anchor correctness, not alert.createdAt) │
│  → business-hours logic queues Tier 1/2 after-hours; BP L2 never    │
│    queued                                                            │
└─────────────────────────────────────────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 11 — Admin resolves  [see §7]                                 │
│  POST /admin/alerts/:id/acknowledge       (idempotent, stops cron)  │
│  POST /admin/alerts/:id/resolve  { resolutionAction, rationale }    │
│  → Tier 1: ALL actions require rationale                            │
│  → Tier 2: TIER2_REVIEWED_NO_ACTION requires rationale, others optional │
│  → BP L2: ALL actions require rationale; UNABLE_TO_REACH_RETRY      │
│    leaves alert OPEN and schedules a fresh T+4h event                │
│  GET  /admin/alerts/:id/audit   → 15-field Joint Commission payload  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. State machines — the five that matter

### 4.1 `User.onboardingStatus` (NOT_COMPLETED ↔ COMPLETED) — identity only

Identity-level onboarding. Driven by `POST /v2/auth/profile`. On seed accounts this starts `COMPLETED`. On fresh OTP signup it starts `NOT_COMPLETED` — `/sign-in` reads `onboarding_required` from the verify-OTP response and redirects to `/onboarding`.

This field says **"the patient filled in name/DOB/timezone"** — nothing more. It is orthogonal to clinical enrollment (§4.1b).

### 4.1b `User.enrollmentStatus` (NOT_ENROLLED ↔ ENROLLED) — clinical enrollment

Clinical enrollment. Owned by the admin endpoint `POST /admin/patients/:id/complete-onboarding`, which flips this field to `ENROLLED` only after the 4-part gate passes (assignment + practice business hours + profile + threshold-if-HFREF/HCM/DCM). See §6 for full gate.

The two fields are deliberately independent:
- A patient can be `onboardingStatus: COMPLETED` but `enrollmentStatus: NOT_ENROLLED` (most common post-signup state).
- An admin-created account can be `enrollmentStatus: ENROLLED` before the patient ever signs in and flips `onboardingStatus`.

**Who reads what:**
- `onboardingStatus` — used by `/sign-in` to decide whether to route a patient to `/onboarding`. Nothing else.
- `enrollmentStatus` — used by the gap-alert + monthly-reask crons, the provider service's "enrolled patients" queries, and the escalation dispatch gate (§6.2).

### 4.2 `PatientProfile.profileVerificationStatus` (UNVERIFIED → VERIFIED → UNVERIFIED…)

| Value | Meaning |
|---|---|
| `UNVERIFIED` | Default after any patient write. Safety-net biases are active. |
| `VERIFIED` | Admin confirmed profile as-is. |
| `CORRECTED` | Admin overwrote a patient-reported field. Audit row with `rationale` required. |

**Verify-on-edit rule** — any of these **flip back to UNVERIFIED** and bump `profileLastEditedAt`:
- `POST /intake/profile`  ([intake.controller.ts:28](../backend/src/intake/intake.controller.ts))
- `POST /intake/medications` ([intake.controller.ts:39](../backend/src/intake/intake.controller.ts))
- `PATCH /me/medications/:id` (unless the edit is just `discontinue: true`)
- `PUT /me/medications` (bulk replace)
- `POST /me/pregnancy`
- `PATCH /v2/auth/profile` if any clinical-relevant field changes
- `POST /admin/users/:id/reject-profile-field` (admin rejects → patient re-enters)

Admin correct also flips to `CORRECTED`, not back to `UNVERIFIED`. Distinction matters for audit filter UIs.

### 4.3 `PatientMedication.verificationStatus`

| Value | Set by |
|---|---|
| `AWAITING_PROVIDER` | Initial state after patient self-report |
| `UNVERIFIED` | After patient edits an existing med row (verify-on-edit) |
| `VERIFIED` | `POST /admin/medications/:id/verify` with `status: VERIFIED` |
| `REJECTED` | `POST /admin/medications/:id/verify` with `status: REJECTED` — see §9 for full lifecycle |

Discontinuing a med (`PATCH /me/medications/:id  { discontinue: true }`) sets `discontinuedAt: now()` — med is filtered out of `contextMeds` permanently but retained for audit.

### 4.4 `DeviationAlert` — tier, ruleId, dismissible, status

`tier` values ([shared/src/rule-ids.ts](../shared/src/rule-ids.ts)):

```
TIER_1_CONTRAINDICATION    // non-dismissable, same-day provider action
TIER_2_DISCREPANCY         // dashboard badge, non-interruptive
TIER_3_INFO                // physician-only, no patient/caregiver message
BP_LEVEL_1_HIGH            // dismissable, 24h provider review
BP_LEVEL_1_LOW             // dismissable
BP_LEVEL_2                 // non-dismissable, 911 CTA on patient
BP_LEVEL_2_SYMPTOM_OVERRIDE // patient gets "Have you called 911?" at T+2h
```

`dismissible` is `false` for Tier 1 and BP Level 2; `true` otherwise.

`status` ([backend/prisma/schema/diviation_alert.prisma](../backend/prisma/schema/diviation_alert.prisma)):

```
OPEN → ACKNOWLEDGED → RESOLVED
```

- **Benign reading** (no rule fires) triggers `resolveOpenAlerts(userId)` which flips `BP_LEVEL_1_HIGH` and `BP_LEVEL_1_LOW` rows from `OPEN`/`ACKNOWLEDGED` → `RESOLVED`. **Tier 1, Tier 2, and BP Level 2 are preserved** — they require explicit admin resolution.
- `POST /admin/alerts/:id/acknowledge` sets `status: ACKNOWLEDGED` + `acknowledgedAt`/`acknowledgedBy`. Idempotent.
- `POST /admin/alerts/:id/resolve` sets `status: RESOLVED` + `resolvedAt`/`resolvedBy`/`resolutionAction`/`resolutionRationale`. Closes all open `EscalationEvent` rows for the alert.
- **BP L2 #6 (`BP_L2_UNABLE_TO_REACH_RETRY`)** is a special resolution: alert stays `OPEN`, fresh `EscalationEvent` scheduled at T+4h with `triggeredByResolution: true`.

### 4.5 `EscalationEvent` ladder progression

Every dispatch writes one row: `(alertId, ladderStep, recipientIds[], recipientRoles[], channels[], afterHours, scheduledFor, notificationSentAt, triggeredByResolution)`.

Ladder steps per tier ([backend/src/daily_journal/escalation/ladder-defs.ts](../backend/src/daily_journal/escalation/ladder-defs.ts)):

| Tier | Steps |
|---|---|
| Tier 1 | `T0` → `T4H` → `T8H` → `T24H` → `T48H` (after-hours → `T0` also fires backup as `TIER_1_BACKUP_ON_T0` with `FIRE_IMMEDIATELY`) |
| Tier 2 | `T0` → `TIER2_48H` → `TIER2_7D` → `TIER2_14D` |
| BP Level 2 | `T0` (primary + backup + patient simultaneously) → `T2H` (medical director) → `T4H` (HealPlace ops) |
| BP Level 2 Symptom Override | same as BP Level 2 but `T2H` also notifies patient ("Have you called 911?") |

Ladder clock **anchor** = T+0 primary event's `notificationSentAt ?? scheduledFor ?? triggeredAt` ([escalation.service.ts:305](../backend/src/daily_journal/services/escalation.service.ts)). Fixes the overnight-compression bug where a Tier 1 alert created at 10pm would skip T+4h, T+8h before business hours started.

---

## 5. The safety net — what happens before verification

The whole "trust then verify" architecture rests on the rule engine doing the conservative thing when a patient's profile is UNVERIFIED. Key behaviors, all in [profile-resolver.service.ts](../backend/src/daily_journal/services/profile-resolver.service.ts):

| Patient state | Engine behavior |
|---|---|
| `isPregnant = true`, profile UNVERIFIED | Pregnancy thresholds activate (L1 ≥140/90, L2 ≥160/110). ACE/ARB contraindication check fires even on UNVERIFIED ACE/ARB meds. |
| `hasHeartFailure = true`, `heartFailureType = UNKNOWN` | Biased to `HFREF` → lower bound SBP <85, vs HFpEF's <110. |
| `hasHeartFailure = false`, `hasDCM = true` | Biased to `HFREF` (DCM is a cause of HFrEF). |
| Medication with `drugClass = OTHER_UNVERIFIED` OR source `PATIENT_VOICE`/`PATIENT_PHOTO` with status UNVERIFIED | Excluded from `contextMeds` entirely — no alerts from that med. Stored for provider review. |
| Medication with known drug class but status UNVERIFIED | Retained in `contextMeds` for suppression logic (e.g. beta-blocker HR 50–60 suppression still works). **NDHP contraindication requires VERIFIED only**; pregnancy ACE/ARB still fires on UNVERIFIED (safety-critical). |

This asymmetry (NDHP requires VERIFIED, pregnancy ACE/ARB doesn't) is deliberate — teratogenic risk is irreversible, so we fire early; HFrEF NDHP risk is recoverable if caught a day later, so we wait for verification to avoid false positives.

---

## 6. The enrollment gate — and the two-layer activation model

Per Dr. Singal's sign-off, **all four enrollment pieces are clinically mandatory**. Not negotiable:

> "MANDATORY: Primary provider per patient (cannot enroll without). Practice-level backup (cannot activate Tier 1 without). Medical director / supervising physician (cannot activate escalation without). After-hours protocol (mandatory for HF/HCM practices)." — V2-D §D.9
>
> "MANDATORY: Do not enroll HFrEF patients without provider-configured thresholds." — §4.2 (same for HCM §4.7 and DCM §4.8)

But the clinical spec also insists on the "trust then verify" model for clinical intake itself (V2-A §Step 1): "System immediately activates the appropriate threshold set. System does not wait for admin entry." The patient is supposed to start self-reporting as soon as they finish clinical intake — with safety-net thresholds active — even before admin verification.

This produces **two distinct activation milestones**, which we enforce at two different layers.

### 6.1 Layer A — Journaling gate

Controls whether `POST /daily-journal` accepts a reading.

**Check:** `PatientProfile` row exists (i.e. patient has completed clinical intake at `/clinical-intake`).

| Patient state | Result |
|---|---|
| No PatientProfile | **403** with body `{ message: "clinical-intake-required", reason: "..." }`. Frontend redirects to `/clinical-intake`. |
| PatientProfile exists (even UNVERIFIED, even with no assignment or threshold yet) | **202** accepted, rule engine runs with safety-net biases, `DeviationAlert` rows created |

Implemented in [daily_journal.service.ts](../backend/src/daily_journal/daily_journal.service.ts) `create()`. Matches Manisha's "patient starts getting monitored immediately after self-report" intent — the gate fires only when the patient literally has no clinical context yet.

### 6.2 Layer B — Escalation dispatch gate

Controls whether alerts actually notify providers (vs. sitting in the DB).

**Check:** `User.enrollmentStatus === ENROLLED`, which only flips via the enrollment gate at `POST /admin/patients/:userId/complete-onboarding`:

| # | Gate check | 409 reason if missing |
|---|---|---|
| 1 | `PatientProviderAssignment` exists for the user | `no-assignment` |
| 2 | Linked `Practice.businessHoursStart`, `businessHoursEnd`, `businessHoursTimezone` all non-null | `practice-missing-business-hours` |
| 3 | `PatientProfile` row exists | `patient-profile-missing` |
| 4 | If `heartFailureType = HFREF` OR `hasHCM = true` OR `hasDCM = true`, a `PatientThreshold` row exists | `threshold-required-for-condition` |

HFpEF does **not** gate enrollment — thresholds are recommended but not required (CLINICAL_SPEC §4.9). `heartFailureType = UNKNOWN` also does not gate — the resolver biases to HFREF internally but the gate only checks the raw field. Flagged for testing to confirm intended behavior.

The dispatch gate lives in three entry points of [escalation.service.ts](../backend/src/daily_journal/services/escalation.service.ts): `fireT0`, `firePendingScheduled`, and `advanceOverdueLadders`. All three bail cleanly when the alert's patient is not `ENROLLED` — no `EscalationEvent` row written, no notifications fanned out, no `DISPATCH ERROR` rows.

### 6.3 Before vs after `enrollmentStatus: ENROLLED`

**Before:**
- Patient can still log readings (Layer A permits it once PatientProfile exists).
- Rule engine runs and creates `DeviationAlert` rows normally.
- **Escalation does NOT dispatch to providers.** Alerts remain in the database; patient sees their own alert on `/alerts/:id` and `/notifications`; admin can see them on the dashboard. No push / email / phone.
- BP Level 2 emergencies **still show the 911 CTA to the patient** via the patient-facing alert screen — patient safety cannot be gated on admin completing enrollment.

**After:**
- Full ladder dispatch. T+0 / T+4h / T+8h / T+24h / T+48h fire per tier with all notifications.
- Any alerts that accumulated pre-enrollment are picked up on the next 15-min cron pass via `advanceOverdueLadders`.

> Defense-in-depth: if PRIMARY / BACKUP / MEDICAL_DIRECTOR still fail to resolve during dispatch (e.g. provider account deleted), the service writes a `DISPATCH ERROR: missing required roles` row in `EscalationEvent` ([escalation.service.ts:356](../backend/src/daily_journal/services/escalation.service.ts)) and does a partial dispatch. That fail-loud safety still applies — the enrollment gate catches 99% of cases, fail-loud catches the 1%.

### 6.4 Activation summary

| Milestone | Field flip | What unlocks | Authority |
|---|---|---|---|
| Patient fills name / DOB / timezone | `onboardingStatus: COMPLETED` | Clears `/sign-in` redirect to `/onboarding` | `POST /v2/auth/profile` |
| `PatientProfile` row exists | (no field flip — PatientProfile presence is the signal) | **Journal submissions accepted** (Layer A) | `POST /intake/profile` |
| Admin verifies profile + meds | `profileVerificationStatus: VERIFIED` | Safety-net biases relax | `POST /admin/users/:id/verify-profile` |
| Admin passes 4-piece enrollment gate | `enrollmentStatus: ENROLLED` | **Escalation dispatches** (Layer B); crons nudge patient | `POST /admin/patients/:id/complete-onboarding` |

---

## 7. Journal → alert pipeline

One entry, one rule evaluation. Pipeline order is locked at [alert-engine.service.ts:149](../backend/src/daily_journal/services/alert-engine.service.ts).

### 7.1 Pre-gate rules (run even for AFib <3 readings, pre-Day-3)

1. Pregnancy + ACE/ARB → `TIER_1_CONTRAINDICATION`
2. NDHP-CCB + HFrEF (VERIFIED only) → `TIER_1_CONTRAINDICATION`
3. Pregnancy symptom override (newOnsetHeadache / ruqPain / edema) → `BP_LEVEL_2_SYMPTOM_OVERRIDE`
4. General symptom override (6 Level-2 symptoms) → `BP_LEVEL_2_SYMPTOM_OVERRIDE`

### 7.2 AFib ≥3-reading gate

If `hasAFib = true` AND `session.readingCount < 3` → engine returns `null` for rules 5–21. Contraindications above still fire.

### 7.3 BP/HR pipeline (short-circuits on first match)

5. Absolute emergency (SBP ≥180 OR DBP ≥120) → `BP_LEVEL_2`
6. Pregnancy L2 (≥160/110) → `BP_LEVEL_2`
7. Pregnancy L1 (≥140/90) → `BP_LEVEL_1_HIGH`
8. DCM rule (DCM without HF flag) — runs before HFrEF so wording stays DCM-specific
9. HFrEF (SBP <85 or ≥160) — **wording uses `resolvedHFType`, not raw flag**
10. HFpEF (SBP <110 or ≥160)
11. CAD (DBP <70 critical, SBP ≥160)
12. HCM (vasodilator/nitrate/loop-diuretic → Tier 3, SBP <100 or ≥160)
13. Personalized High (threshold + ≥7 readings, SBP ≥ upperTarget + 20)
14. Personalized Low (SBP < lowerTarget)
15. Standard L1 High (≥160/100)
16. Standard L1 Low (<90; **65+ override: <100**)
17. AFib HR (>110 high, <50 low)
18. Tachycardia (>100 on ≥2 consecutive readings — prior-reading state check)
19. Bradycardia (<50 symptomatic, <40 asymptomatic, beta-blocker suppression 50–60)
20. Loop-diuretic hypotension → `TIER_3_INFO`
21. Pulse pressure >60 → `TIER_3_INFO` (rides as annotation on primary rule)

### 7.4 Key gating details

- **Session averaging** ([session-averager.service.ts](../backend/src/daily_journal/services/session-averager.service.ts)): readings grouped by explicit `sessionId` or ±30-min proximity. SBP/DBP/pulse averaged; symptom booleans OR-reduced; `otherSymptoms` deduplicated; `suboptimalMeasurement = true` if any reading had a false checklist item.
- **Pre-Day-3 mode** (readingCount <7): sets `personalizedEligible = false` (rules 13–14 skipped); standard mode wording tags a disclaimer.
- **Age 65+** (from `dateOfBirth`): overrides lower bound for rule 16 to `<100`.
- **Admin/no-profile user logs a reading**: Layer A gate returns **403** `{ message: "clinical-intake-required" }` from [daily_journal.service.ts](../backend/src/daily_journal/daily_journal.service.ts) before the row is written. The alert-engine skip path at [alert-engine.service.ts:114](../backend/src/daily_journal/services/alert-engine.service.ts) remains as defense-in-depth (in case a row arrives from some other path).

### 7.5 Benign-reading auto-resolve

If the pipeline returns `null` and there are open BP Level 1 alerts for the user, they flip to `RESOLVED`. Tier 1 / Tier 2 / BP L2 alerts are preserved.

---

## 8. Steps 8 to 11 in full detail — every branch

Expanded view of the final four steps of the happy path, with every branch point enumerated. Each branch is a test case in [E2E_TEST_CASES.md §24](E2E_TEST_CASES.md).

### 8.1 Step 8 branches — journal entry submit

`POST /daily-journal` with `{ measuredAt, systolicBP, diastolicBP, pulse, position, sessionId, symptoms..., measurementConditions }`.

| Input condition | Outcome |
|---|---|
| `measuredAt > now + 5 min` | **400** — clock-skew slack exceeded |
| `measuredAt < now − 30 days` | **400** — backfill limit |
| Duplicate `(userId, measuredAt)` | **409** — `@@unique` constraint |
| Missing `measuredAt` | **400** |
| Out-of-range BP (SBP <60 or >250, DBP <40 or >150) | **400** |
| No JWT | **401** |
| Authenticated + no `PatientProfile` | **403** `{ message: "clinical-intake-required", reason: "..." }` — Layer A gate |
| Has `sessionId` | Reading grouped with all siblings sharing same `sessionId` + same userId (exact match) |
| No `sessionId` | Reading grouped with siblings within ±30 min of `measuredAt` (proximity window) |
| Legacy `symptoms[]` array populated | Merged into `otherSymptoms` column at create time ([daily_journal.service.ts:61](../backend/src/daily_journal/daily_journal.service.ts)) |
| Structured symptom flag true (`severeHeadache` etc.) | Stored as-is; triggers symptom override rule in engine |
| Any checklist item in `measurementConditions` is false | `suboptimalMeasurement = true` propagates through session averager |
| All valid | **202** with `{ id, measuredAt, ... }`; emits `ENTRY_CREATED` event → rule engine runs async |

### 8.2 Step 9 branches — alert produced (or not)

Rule engine (`alert-engine.service.ts`) runs in strict pipeline order. Possible outcomes:

| Scenario | Result |
|---|---|
| No `PatientProfile` | Blocked upstream by Layer A gate — rule engine never runs for this case. Defense-in-depth: if a row somehow lands without a profile, engine logs `"Skipping entry ..."` and returns `null`. |
| Pre-gate Tier 1 match (pregnancy+ACE/ARB or NDHP+HFrEF VERIFIED) | `TIER_1_CONTRAINDICATION` — fires **regardless** of AFib gate or pre-Day-3 |
| Pre-gate symptom override (6 general + 3 pregnancy symptoms) | `BP_LEVEL_2_SYMPTOM_OVERRIDE` — fires **regardless** of AFib gate |
| AFib patient with <3 readings in session AND no pre-gate match | `null` (AFib gate closed for BP/HR rules) |
| Absolute emergency (SBP ≥180 OR DBP ≥120) | `BP_LEVEL_2` |
| Pregnancy L2 (≥160/110 when pregnant) | `BP_LEVEL_2` |
| Pregnancy L1 (≥140/90 when pregnant, below L2) | `BP_LEVEL_1_HIGH` |
| Condition branch matches (HFrEF, HFpEF, CAD, HCM, DCM) | `BP_LEVEL_1_HIGH` or `BP_LEVEL_1_LOW` with condition-specific wording |
| Personalized mode eligible (threshold + ≥7 readings) + OOB | `BP_LEVEL_1_*` with `mode: PERSONALIZED` |
| Standard mode (no threshold OR <7 readings) + OOB | `BP_LEVEL_1_*` with `mode: STANDARD` + pre-Day-3 disclaimer appended to patient message if applicable |
| Age 65+ + SBP <100 (no other match first) | `RULE_AGE_65_LOW` (overrides standard <90) |
| AFib + HR >110 | `RULE_AFIB_HR_HIGH` |
| AFib + HR <50 | `RULE_AFIB_HR_LOW` |
| Tachycardia + HR >100 AND prior reading also >100 | `RULE_TACHY_HR` |
| Bradycardia + HR <50 symptomatic | `RULE_BRADY_HR_SYMPTOMATIC` |
| Bradycardia + HR <40 asymptomatic | `RULE_BRADY_HR_ASYMPTOMATIC` |
| Bradycardia + HR 50–60 + beta-blocker in contextMeds | suppressed, no alert |
| Pulse pressure >60 | `RULE_PULSE_PRESSURE_WIDE` `TIER_3_INFO` (rides as annotation on primary if any) |
| HCM + vasodilator / nitrate / loop-diuretic in meds | `RULE_HCM_VASODILATOR` `TIER_3_INFO` |
| Loop diuretic + SBP ∈ [90, 92) | `RULE_LOOP_DIURETIC_HYPOTENSION` `TIER_3_INFO` |
| Everything benign | `null`; `resolveOpenAlerts(userId)` flips open BP Level 1 alerts to `RESOLVED`. Tier 1 / Tier 2 / BP L2 preserved. |

When an alert fires:
- `DeviationAlert` row written with `tier`, `ruleId`, `dismissible`, three-tier messages, `pulsePressure` snapshot, `suboptimalMeasurement`
- `ALERT_CREATED` event emitted
- `EscalationService.fireT0()` runs (or no-op for `TIER_3_INFO` / `BP_LEVEL_1_*` which have no ladder today)

### 8.3 Step 10 branches — escalation ladder

After T+0 fires, the `@Cron('*/15 * * * *')` scanner runs `advanceOverdueLadders()` every 15 minutes. Behavior depends on tier + time + acknowledgment state.

| Tier | T+0 recipients + channels | After-hours behavior | Ladder next steps |
|---|---|---|---|
| `TIER_1_CONTRAINDICATION` | PRIMARY_PROVIDER, PUSH+EMAIL+DASHBOARD | Queue PRIMARY to next business-hours start. **Also fire BACKUP immediately** via `TIER_1_BACKUP_ON_T0` safety-net step. | T+4h: PRIMARY + BACKUP, PUSH; T+8h: MEDICAL_DIRECTOR, PUSH+DASHBOARD; T+24h: HEALPLACE_OPS, PUSH+PHONE; T+48h: HEALPLACE_OPS, DASHBOARD |
| `TIER_2_DISCREPANCY` | PRIMARY_PROVIDER, DASHBOARD only | Queue until next business day | TIER2_48H: PRIMARY, PUSH+DASHBOARD; TIER2_7D: BACKUP, DASHBOARD; TIER2_14D: HEALPLACE_OPS, DASHBOARD |
| `BP_LEVEL_2` | PRIMARY + BACKUP + PATIENT simultaneously, PUSH+EMAIL+DASHBOARD | **FIRE_IMMEDIATELY** regardless of hour/weekend | T+2h: MEDICAL_DIRECTOR, PUSH; T+4h: HEALPLACE_OPS, PUSH+PHONE |
| `BP_LEVEL_2_SYMPTOM_OVERRIDE` | Same as BP_LEVEL_2 | Immediate | T+2h: MEDICAL_DIRECTOR **+ PATIENT** ("Have you called 911?"), PUSH; T+4h: HEALPLACE_OPS, PUSH+PHONE |
| `TIER_3_INFO` | No dispatch (dashboard-only surfacing) | N/A | No ladder |
| `BP_LEVEL_1_HIGH`, `BP_LEVEL_1_LOW` | No dispatch today (`TODO(phase/11)`) | N/A | No ladder; surfaced via `/daily-journal/alerts` patient endpoint + admin dashboard only |

**Anchor** for every ladder deadline = T+0 primary event's actual dispatch time (`notificationSentAt ?? scheduledFor ?? triggeredAt`) — not `alert.createdAt`. That's how after-hours Tier 1 triggered at 10pm correctly fires T+4h 12h later at noon, not 4h later at 2am.

**Acknowledgment stops the cron.** Once `POST /admin/alerts/:id/acknowledge` flips `DeviationAlert.status → ACKNOWLEDGED`, `advanceOverdueLadders()` filter excludes the alert on its next scan.

**Fail-loud on missing roles.** If PRIMARY / BACKUP / MEDICAL_DIRECTOR user can't be resolved at dispatch time (enrollment-gate integrity bug), the service logs ERROR + writes `EscalationEvent` with `reason: "DISPATCH ERROR: missing required roles ..."` + proceeds with partial dispatch. `HEALPLACE_OPS` fails soft (warn log, no row).

**Notification idempotency.** The fan-out creates `Notification` rows per `(alertId, escalationEventId, userId, channel)`; a `@@unique` constraint prevents duplicates when the cron re-runs the same scan twice.

### 8.4 Step 11 branches — admin resolution

Two endpoints, both admin-only:

**`POST /admin/alerts/:id/acknowledge`** — idempotent, stops ladder cron from advancing. Sets `status: ACKNOWLEDGED`, `acknowledgedAt`, `acknowledgedBy`. Alert stays OPEN→ACKNOWLEDGED. Subsequent scans skip the alert. Does NOT close the alert.

**`POST /admin/alerts/:id/resolve  { resolutionAction, resolutionRationale? }`** — closes the alert.

| Tier | Valid actions | Rationale rule | Special behavior |
|---|---|---|---|
| `TIER_1_*` | `TIER1_DISCONTINUED` / `TIER1_CHANGE_ORDERED` / `TIER1_FALSE_POSITIVE` / `TIER1_ACKNOWLEDGED` / `TIER1_DEFERRED` | **All require rationale** (3–2000 chars) | — |
| `TIER_2_DISCREPANCY` | `TIER2_REVIEWED_NO_ACTION` / `TIER2_WILL_CONTACT` / `TIER2_CHANGE_ORDERED` / `TIER2_PHARMACY_RECONCILE` / `TIER2_DEFERRED` | Only `TIER2_REVIEWED_NO_ACTION` requires rationale | — |
| `BP_LEVEL_2*` | `BP_L2_CONTACTED_MED_ADJUSTED` / `BP_L2_CONTACTED_ADVISED_ED` / `BP_L2_CONTACTED_RECHECK` / `BP_L2_SEEN_IN_OFFICE` / `BP_L2_REVIEWED_TRENDING_DOWN` / **`BP_L2_UNABLE_TO_REACH_RETRY`** | All require rationale | Retry action leaves alert OPEN + schedules fresh T+4h `EscalationEvent` via `scheduleRetry()` |
| `TIER_3_INFO` | No resolution action enum | — | Dashboard-only; dismissed via patient-side acknowledge (if wired) |

Edge cases:

| Scenario | Result |
|---|---|
| Resolve already-resolved alert | **400** `"Alert is already resolved"` |
| Tier mismatch (BP L2 action on Tier 1 alert, etc.) | **400** — action does not match tier |
| Rationale <3 chars or >2000 chars | **400** |
| Missing rationale where required | **400** |
| Resolve without having acknowledged first | **200** — acknowledge is not a prerequisite |
| `GET /admin/alerts/:id/audit` after resolve | **200** with 15-field Joint Commission audit payload |
| Non-admin role (PATIENT) attempts any of the three | **403** |

**Post-resolve side effects:**
- All open `EscalationEvent` rows for the alert are marked resolved
- `Notification` rows already sent remain (audit trail preserved)
- Patient dashboard: `/daily-journal/alerts` still lists the alert but status RESOLVED
- Admin dashboard: alert falls out of "open alerts" queue

---

## 9. Medication rejection lifecycle

Because this is a multi-step flow that touches the patient UI, admin UI, and rule engine.

### 9.1 Trigger

Admin opens `/patients/:id` → Medications tab → clicks "Reject" on a specific med row → enters rationale in the modal → confirms.

Frontend fires `POST /admin/medications/:medId/verify  { status: "REJECTED", rationale: "Confused Lisinopril with Losartan — not in pharmacy record" }`.

### 9.2 Backend state changes

1. `PatientMedication.verificationStatus` = `REJECTED`
2. `PatientMedication.verifiedByAdminId` = `<adminId>`, `verifiedAt: now()`
3. `ProfileVerificationLog` row written with `changeType: ADMIN_REJECT`, `rationale`, `discrepancyFlag: true`
4. Patient notification created (push + dashboard)
5. Row is **NOT deleted** — retained for Joint Commission audit

### 9.3 Rule engine impact

The **next** reading the patient logs: the rejected med is filtered out of `contextMeds` in [profile-resolver.service.ts:100](../backend/src/daily_journal/services/profile-resolver.service.ts) (goes to `excludedMeds`). It no longer influences any rule evaluation.

**Already-fired alerts based on that med** are NOT automatically resolved. Example: if a pregnant patient reported Lisinopril and `RULE_PREGNANCY_ACE_ARB` fired Tier 1, the admin must then:
1. Resolve the Tier 1 alert with `TIER1_FALSE_POSITIVE` + rationale `"Medication was Losartan, not Lisinopril — corrected"` (action matches because the patient wasn't actually on ACE)
2. OR resolve with `TIER1_DISCONTINUED` if the patient was told to stop
3. Separately reject the medication row

The rejection + the alert resolution are two decisions, not one — matches Manisha's V2-C Layer 2 workflow.

### 9.4 Patient-facing UX

- Push notification delivered (copy should read roughly: _"Your care team reviewed your medication list. Please open the app to see updates."_ — exact string to be verified against the code during the UI test pass)
- Patient opens `/profile` → Medications section → rejected med is shown as removed / crossed out with admin note
- Patient can re-enter the med via intake edit flow (`PATCH /me/medications/:id` or `PUT /me/medications`), which flips the med back to `UNVERIFIED` and flips `profileVerificationStatus` → `UNVERIFIED`

### 9.5 Adding the med back

If a patient re-enters the exact same drug:
- A **new** `PatientMedication` row is created (rejected row retained for audit)
- `verificationStatus: AWAITING_PROVIDER` (initial state)
- Admin can re-verify or re-reject

**Important test coverage:** reject-then-readd must not deduplicate against the historic rejected row — the new report is a legitimate second attempt.

---

## 10. Where verification happens on the UI

### 10.1 Profile verification

| Touchpoint | Actor | File | Endpoint |
|---|---|---|---|
| Patient submits intake | Patient | [frontend/src/app/clinical-intake/page.tsx](../frontend/src/app/clinical-intake/page.tsx) | `POST /intake/profile` — flips status to UNVERIFIED |
| Admin 2-column review | Admin (PROVIDER+) | [admin/src/components/patient-detail/ProfileTab.tsx](../admin/src/components/patient-detail/ProfileTab.tsx) | Per-field actions below |
| Confirm a single field | Admin | Field row `✅` button | Local state change; final `verify-profile` call writes audit |
| Correct a single field | Admin | Field row `✏️` button → modal with rationale | `POST /admin/users/:id/correct-profile  { corrections: { field: newValue }, rationale }` |
| Reject a single field | Admin | Field row `❌` button → modal with rationale | `POST /admin/users/:id/reject-profile-field  { field, rationale }` |
| Full verification pass complete | Admin | Footer "Verification complete" button | `POST /admin/users/:id/verify-profile  { rationale? }` — sets VERIFIED |
| Patient views verification state | Patient | `/dashboard` (Awaiting Verification badge), `/profile` (per-section badges) | `GET /me/profile`, `GET /me/care-team` |

Key state transitions on the Profile tab:

- **"Verification complete"** applied to an UNVERIFIED profile with no corrections → `profileVerificationStatus: VERIFIED`
- Admin corrects one or more fields before clicking complete → `profileVerificationStatus: CORRECTED`, each correction logged with `discrepancyFlag: true`
- Admin rejects a field → `profileVerificationStatus: UNVERIFIED` (patient must re-enter); patient notification fires

### 10.2 Medication verification

| Touchpoint | Actor | File | Endpoint |
|---|---|---|---|
| Patient reports med | Patient | [frontend/src/app/clinical-intake/page.tsx](../frontend/src/app/clinical-intake/page.tsx) (step A5–A9) | `POST /intake/medications` — status `AWAITING_PROVIDER` |
| Patient edits med | Patient | `/profile` Medications section → Edit → re-opens intake flow | `PATCH /me/medications/:id` — status flips `UNVERIFIED` |
| Admin list + per-row actions | Admin | [admin/src/components/patient-detail/MedicationsTab.tsx](../admin/src/components/patient-detail/MedicationsTab.tsx) | — |
| Admin verify a med | Admin | Row "Verify" button | `POST /admin/medications/:medId/verify  { status: "VERIFIED", rationale? }` |
| Admin reject a med | Admin | Row "Reject" button → modal with rationale | `POST /admin/medications/:medId/verify  { status: "REJECTED", rationale }` |
| Admin discontinue (manual) | Admin | TBD — may be a separate endpoint or an action on the reconciliation view (phase/12) | Discontinuation today flows from patient side via `PATCH /me/medications/:id { discontinue: true }` |
| Patient sees verification state | Patient | `/profile` Medications section | `GET /me/medications` returns per-med status |

Key state transitions on the Medications tab:

- Admin clicks Verify on `AWAITING_PROVIDER` → `VERIFIED`
- Admin clicks Reject on any status → `REJECTED` + rejection notification to patient (§9)
- Patient edit of an existing med → `UNVERIFIED`
- Admin re-verify after patient edit → `VERIFIED` again

### 10.3 "Awaiting Provider Verification" badge

Rendered wherever the UI needs to surface that a patient's profile or meds are still unverified:

| Page | Component | Data source | Condition |
|---|---|---|---|
| Patient `/dashboard` | Below user greeting / near Action Required card | `GET /me/profile.profileVerificationStatus` | `=== "UNVERIFIED"` AND PatientProfile exists |
| Patient `/profile` per section | Each clinical section header | `GET /me/profile` + per-med `verificationStatus` | Any unverified field in the section |
| Admin `/patients` list | Status column + chip filter | `GET /provider/patients` | Count of patients with UNVERIFIED profiles |
| Admin `/patients/:id` header | Badge next to name | `GET /admin/users/:id/profile.profileVerificationStatus` | `=== "UNVERIFIED"` |

**Expected rendering states:**
- `UNVERIFIED`: amber / warning color, text "Awaiting provider verification"
- `VERIFIED`: green check or hidden entirely
- `CORRECTED`: neutral info color with tooltip "Some fields updated by your care team"

---

## 11. Timings and reading-count reference

Three distinct time windows + three reading-count gates. Easy to confuse — keep this card handy.

### 11.1 Time windows

| Timer | Duration | Purpose | Where enforced |
|---|---|---|---|
| OTP expiry | **10 minutes** | Auth flow — OTP valid for 10 min after `/otp/send` | [auth.service.ts](../backend/src/auth/auth.service.ts) |
| Magic link expiry | **24 hours** | Auth flow | [auth.service.ts](../backend/src/auth/auth.service.ts) |
| `measuredAt` future tolerance | **+5 minutes** | Clock-skew slack — phone clock may be a few seconds off; 5 min is generous | [CreateJournalEntryDto](../backend/src/daily_journal/dto/create-journal-entry.dto.ts) validator |
| `measuredAt` past tolerance | **−30 days** | Backfill limit — rejects obviously-wrong timestamps | Same file |
| Session grouping window | **±30 minutes** | Two readings without explicit `sessionId` grouped if within 30 min of each other | [session-averager.service.ts](../backend/src/daily_journal/services/session-averager.service.ts) |
| Gap-alert idempotency | **24 hours** | Prevent repeat "Time for your BP check" pushes | [gap-alert.service.ts](../backend/src/crons/gap-alert.service.ts) |
| Gap-alert trigger threshold | **48 hours** since last entry | When to send the nudge | Same file |
| Monthly re-ask idempotency | **28 days** | Prevent repeat "Confirm your medications" pushes | [monthly-reask.service.ts](../backend/src/crons/monthly-reask.service.ts) |
| Monthly re-ask trigger threshold | **30 days** since last `verifiedAt ?? reportedAt` on active meds | When to send | Same file |

### 11.2 Reading-count gates

| Gate | Threshold | Purpose | Source |
|---|---|---|---|
| AFib session gate | **≥3 readings** in current session | Per CLINICAL_SPEC §4.4: AFib oscillometric readings have higher variability; require 3 to average meaningfully | [alert-engine.service.ts:162](../backend/src/daily_journal/services/alert-engine.service.ts) |
| Pre-Day-3 mode cutoff | **<7 total readings** for this user | Per CLINICAL_SPEC "Pre-Day-3 mode": patient's personalized baseline isn't established yet; force STANDARD mode + disclaimer | [profile-resolver.service.ts:30](../backend/src/daily_journal/services/profile-resolver.service.ts) |
| Personalized mode eligibility | **≥7 total readings AND PatientThreshold exists** | Per §4.1: unlocks ±20 mmHg personalized rule | Same |
| Session averaging recommendation | **2–3 readings per session** | Per §6: 5–10 mmHg reading-to-reading variability; average to reduce noise | Advisory (patient UI), not enforced by engine |

### 11.3 Mode decision tree

```
┌────────────────────────────────────────────────────────────┐
│ readingCount = total JournalEntry rows for this user       │
└────────────────────────────────────────────────────────────┘
               │
      ┌────────┴────────┐
      │                 │
  readingCount < 7   readingCount ≥ 7
      │                 │
      ▼                 ▼
┌───────────────┐  ┌─────────────────────────────────┐
│ Pre-Day-3:    │  │ PatientThreshold exists?        │
│ mode=STANDARD │  └─────────────────────────────────┘
│ disclaimer    │         │              │
│ appended to   │        yes            no
│ patient msg   │         │              │
└───────────────┘         ▼              ▼
                  ┌───────────────┐  ┌───────────────┐
                  │ PERSONALIZED  │  │ STANDARD      │
                  │ mode active   │  │ (no personal  │
                  │ ±20 mmHg rule │  │ thresholds,   │
                  └───────────────┘  │ no disclaimer)│
                                     └───────────────┘
```

The "7" comes from Manisha's assumption of 2–3 readings/day → ~3 days of home monitoring establishes a baseline. "Pre-Day-3" is the spec's name, not a literal 3-day time window.

---

## 12. Background jobs

Three cron-driven services, all in [backend/src/](../backend/src/) with public `runScan(now?: Date)` handles for deterministic ops/testing triggering.

| Service | Schedule | Idempotency | What it does |
|---|---|---|---|
| `GapAlertService` | `@Cron('0 13 * * *')` (daily 13:00 UTC ≈ 9 AM ET) | 24h window by exact notification title | Enrolled patients with no `JournalEntry` in 48h → PUSH + EMAIL |
| `MonthlyReaskService` | `@Cron('0 14 * * *')` (daily 14:00 UTC) | 28-day window | Enrolled patients with active meds whose latest `verifiedAt ?? reportedAt` is >30 days old → PUSH |
| `EscalationService` scanner | `@Cron('*/15 * * * *')` (every 15 min) | Checks each open alert's ladder state | Fires queued T+0 events whose `scheduledFor ≤ now`; advances overdue ladders |

Ops can call all three via their public methods without waiting for the scheduler — essential for testing.

---

## 13. Three-tier message contract

Every alert produces three strings, stored on the `DeviationAlert` row:

- `patientMessage` — plain language, action-oriented
- `caregiverMessage` — context + caregiver action
- `physicianMessage` — structured clinical summary

Built by `OutputGeneratorService` from [shared/src/alert-messages.ts](../shared/src/alert-messages.ts), keyed by `ruleId`. Boot-time check refuses to start if any `RuleId` is missing entries.

Key wording rules:
- Tier 1 patient messages avoid medication names (defer to provider).
- BP Level 2 patient messages include a 911 CTA.
- Physician-only rules (`RULE_PULSE_PRESSURE_WIDE`, `RULE_HCM_VASODILATOR`, `RULE_LOOP_DIURETIC_HYPOTENSION`) return empty strings for patient + caregiver.
- Pre-Day-3 mode appends `"standard threshold — personalization begins after Day 3"` to patient message.
- Suboptimal measurement appends a `"retake"` suffix.
- Wide pulse pressure and loop-diuretic hypotension "ride" as `physicianAnnotations` on the primary rule's physician message when they're not the primary match.

---

## 14. Resolution actions — the enums that drive UI

From [backend/src/daily_journal/escalation/resolution-actions.ts](../backend/src/daily_journal/escalation/resolution-actions.ts):

### Tier 1 — 5 actions, **all require rationale**
| Action | Meaning |
|---|---|
| `TIER1_DISCONTINUED` | Medication discontinued / will contact patient |
| `TIER1_CHANGE_ORDERED` | Medication change ordered |
| `TIER1_FALSE_POSITIVE` | Patient is not [condition] / medication incorrect |
| `TIER1_ACKNOWLEDGED` | Provider aware, clinical rationale documented |
| `TIER1_DEFERRED` | Deferred to in-person visit |

### Tier 2 — 5 actions, **only `TIER2_REVIEWED_NO_ACTION` requires rationale**
| Action | Rationale |
|---|---|
| `TIER2_REVIEWED_NO_ACTION` | **Required** |
| `TIER2_WILL_CONTACT` | Optional |
| `TIER2_CHANGE_ORDERED` | Optional |
| `TIER2_PHARMACY_RECONCILE` | Optional |
| `TIER2_DEFERRED` | Optional |

### BP Level 2 — 6 actions, **all require rationale**
| Action | Behavior |
|---|---|
| `BP_L2_CONTACTED_MED_ADJUSTED` | Closes alert |
| `BP_L2_CONTACTED_ADVISED_ED` | Closes alert |
| `BP_L2_CONTACTED_RECHECK` | Closes alert |
| `BP_L2_SEEN_IN_OFFICE` | Closes alert |
| `BP_L2_REVIEWED_TRENDING_DOWN` | Closes alert (rationale must document the trend) |
| `BP_L2_UNABLE_TO_REACH_RETRY` | **Leaves alert OPEN**, schedules fresh T+4h `EscalationEvent` via `scheduleRetry()` |

---

## 15. Test environment setup

Copy from `backend/.env.example`, `frontend/.env.example`, `admin/.env.example`. Use a **fresh DB** — do not point at v1 prod.

```bash
# One-time
npm install                                  # root, hoists workspace deps
createdb cardioplace_v2_test

# Per test run
cd backend
npx prisma migrate reset --force             # clean slate
npx prisma db seed                           # 5 demo patients + providers + practice
npm run start:dev                            # :4000

cd ../frontend  && npm run dev               # :3000
cd ../admin     && npm run dev               # :3001
```

### Seed accounts (post `prisma db seed`)

All users accept OTP `666666` — no real emails are sent. See [backend/prisma/seed.ts](../backend/prisma/seed.ts).

| Email | Role(s) | Archetype / Purpose |
|---|---|---|
| `priya.menon@cardioplace.test` | PATIENT | Pregnant + on Lisinopril (ACE) → fires `RULE_PREGNANCY_ACE_ARB` |
| `james.okafor@cardioplace.test` | PATIENT | HFrEF + Diltiazem (NDHP) → fires `RULE_NDHP_HFREF` |
| `rita.washington@cardioplace.test` | PATIENT | CAD + DBP 68 → fires `RULE_CAD_DBP_CRITICAL` |
| `charles.brown@cardioplace.test` | PATIENT | AFib + HR 115 (needs ≥3 readings) → fires `RULE_AFIB_HR_HIGH` |
| `aisha.johnson@cardioplace.test` | PATIENT | Controlled HTN — normal readings, no alerts |
| `dr.primary@cardioplace.test` | PROVIDER | Primary provider for all patients above |
| `dr.backup@cardioplace.test` | PROVIDER | Backup provider |
| `dr.director@cardioplace.test` | MEDICAL_DIRECTOR | Medical director |
| `ops@cardioplace.test` | HEALPLACE_OPS | Ops escalation recipient |
| `manisha.patel@cardioplace.test` | SUPER_ADMIN | Full admin access |
| `support@healplace.com` | SUPER_ADMIN | Back-compat admin from v1 |

Practice: `Cedar Hill Community Clinic` (id `seed-cedar-hill`), Mon–Fri 08:00–18:00 America/New_York.

---

## 16. Testing etiquette

1. **Always reset the DB between test suites.** The 15-min escalation cron and 24h gap-alert cron can leave residue across runs.
2. **Use the ops-exposed `runScan(now)` methods** on all three schedulers (`EscalationService`, `GapAlertService`, `MonthlyReaskService`) to trigger cron logic deterministically. Never wait 15 minutes.
3. **Capture `alertId` from the `POST /daily-journal` response** — it's returned in 202 body, and you'll need it for every escalation + resolution assertion.
4. **Verify event emission by querying `EscalationEvent` rows**, not by trying to catch the event bus. `event_emitter` is fire-and-forget; the DB is source of truth.
5. **Test role boundaries at the backend** by issuing raw JWTs with different roles. Admin proxy accepts `SUPER_ADMIN`, `MEDICAL_DIRECTOR`, `PROVIDER`, `HEALPLACE_OPS`; endpoint-level `@Roles()` decorators are the real authorization (see §2).
6. **Don't rely on the frontend to block invalid input.** Layer A and Layer B gates live in the backend. The check-in form has no enrollment guard; the backend returns 403 when `PatientProfile` is missing.
7. **Clinical accuracy:** when a test case references a threshold, cross-check against [CLINICAL_SPEC.md](CLINICAL_SPEC.md) before filing a bug. The spec is authoritative.

---

## 17. Where to go next

- [E2E_TEST_CASES.md](E2E_TEST_CASES.md) — every pass/fail case, numbered, with input + expected output, organized by testing layer.
- [CLINICAL_SPEC.md](CLINICAL_SPEC.md) — Dr. Singal's signed-off rules (v1.0 + v2.0).
- [ALERT_SCENARIOS.md](ALERT_SCENARIOS.md) — 57 rule-engine scenarios (already green in unit tests).
- [TEST_SCENARIOS.md](TEST_SCENARIOS.md) — 182 unit-test cases across profile-resolver, rules, session-averager, alert-engine, output-generator.
- [BUILD_PLAN.md](BUILD_PLAN.md) §2 — schema reference.
- [FRONTEND_BUILD_SPEC.md](FRONTEND_BUILD_SPEC.md) — intended UI flows (some not yet implemented).
