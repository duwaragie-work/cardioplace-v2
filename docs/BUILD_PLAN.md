# Build Plan — Architecture, Tasks, Setup, Timeline

One document covering: architecture & schema, rule-engine design, escalation ladder, three-dev role split, phase branches, Dev 3 task checklist, and local setup. Clinical rules live in `CLINICAL_SPEC.md`.

---

## 0. Fixed decisions (locked)

Decisions that are committed — do not re-litigate without user sign-off.

| Area | Decision |
|---|---|
| Monorepo manager | **npm workspaces** (not pnpm) |
| Admin portal | **Split into `/admin` Next.js app** on subdomain `admin.cardioplaceai.com` |
| Practice model | **Full `Practice` + `PatientProviderAssignment` model** from day one (not minimal three-FK shim) |
| First cohort | **All three practices at launch**: Cedar Hill + BridgePoint + AmeriHealth |
| Medication catalog | **Hardcoded in `/shared/medications.ts`** for MVP (~20 meds + 5 combos). DB-editable catalog deferred to post-MVP (Priority 3). |
| `entryDate` + `measurementTime` | **Consolidated into `measuredAt DateTime`** (single UTC timestamp) |
| Symptoms field | **Structured booleans** replace `symptoms String[]` for the 9 signed-off triggers. Add `otherSymptoms String[]` for freeform. |
| HFpEF + post-pregnancy flag + HCM vasodilator flag | **Folded into phase/2 migration** (single migration, no phase/2b follow-up) |
| Sort ordering | **Always by `measuredAt`** (clinical truth), never `createdAt` (audit only) |
| `BaselineSnapshot` | **Deleted fully.** No rolling-baseline logic in v2. Trend averages computed on-the-fly from `JournalEntry`. |
| User table shape | **Split into `User` (identity + auth) + `PatientProfile` (clinical, 1:1)**. Admin users don't carry clinical fields. |
| `primaryCondition` / `riskTier` / `diagnosisDate` on User | **Dropped** — superseded by structured booleans on `PatientProfile` + age-bucket derivation |
| BMI, pulse pressure (per reading), age group, reading context | **Derived, not stored.** Helpers in `/shared/src/derivatives.ts`. Pulse pressure cached on `DeviationAlert` only (audit snapshot). |
| `UserRole` enum | **5 values**: `PATIENT`, `PROVIDER`, `MEDICAL_DIRECTOR`, `HEALPLACE_OPS`, `SUPER_ADMIN`. Default `[PATIENT]`. v1 content/KB/state roles dropped. |
| DB provisioning | **Prisma Postgres** (managed) — fresh DATABASE_URL, fresh JWT_SECRET, isolated from v1 prod |
| Live v1 app | `www.cardioplaceai.com` — do not touch |

---

## 1. Architecture Overview

### 1.1 Monorepo shape (npm workspaces)

```
cardioplace-v2/
  backend/        NestJS + Prisma + PostgreSQL (shared API)
  frontend/       Next.js patient app       → app.cardioplaceai.com
  admin/          Next.js admin app  (NEW)  → admin.cardioplaceai.com
  shared/         npm workspace package (NEW) — DTOs, enums, alert-message registry
  adk-service/    Python voice/Gemini (untouched)
  docs/           this folder
```

Root `package.json` declares `"workspaces": ["backend", "frontend", "admin", "shared"]`. Both frontends import types and the alert-message registry from `shared` via workspace protocol.

### 1.2 Why split the admin into its own app

- Patients and providers can test concurrently — no logout/login dance
- Cleaner role boundary: patient app has no admin routes; admin app has no patient routes
- Different UX needs: admin is data-dense + keyboard-driven; patient is touch-first + icon/audio
- Independent deploys (separate Vercel/Amplify projects, same repo, same backend)

### 1.3 Three-tier output contract

Every alert produces three strings, stored on the `DeviationAlert` row:
- `patientMessage` — plain language, action-oriented
- `caregiverMessage` — context + caregiver action
- `physicianMessage` — structured clinical summary

Messages live in `/shared/alert-messages.ts`, keyed by `ruleId`. Dr. Singal reviews the wording there.

---

## 2. Schema Plan — Part 1 (single Prisma migration in phase/2)

### 2.1 `User` — identity + auth only (slim)

Every user has a User row. Admin users (PROVIDER / MEDICAL_DIRECTOR / HEALPLACE_OPS / SUPER_ADMIN) do not carry clinical fields — those live on `PatientProfile` (§2.1b). This keeps the role boundary clean.

**Keep on `User`:**
```
id, email, pwdhash, name
dateOfBirth                    DateTime?              // used for age-bucket derivation; every user has one
timezone                       String?
communicationPreference        CommunicationPreference?
preferredLanguage              String?  default("en")
roles                          UserRole[]  default([PATIENT])
accountStatus                  AccountStatus  default(ACTIVE)
isVerified                     Boolean  default(false)
onboardingStatus               OnboardingStatus  default(NOT_COMPLETED)
createdAt, updatedAt

// Relations
patientProfile                 PatientProfile?     // 1:1, only for patients
patientMedications             PatientMedication[]
patientThreshold               PatientThreshold?
providerAssignmentAsPatient    PatientProviderAssignment?
providerAssignmentsAsPrimary   PatientProviderAssignment[]  @relation("PrimaryProvider")
providerAssignmentsAsBackup    PatientProviderAssignment[]  @relation("BackupProvider")
providerAssignmentsAsMedicalDirector PatientProviderAssignment[]  @relation("MedicalDirector")
profileVerificationLogs        ProfileVerificationLog[]
// plus existing: authLogs, sessions, refreshTokens, notifications, deviationAlerts, escalationEvents, journalEntries, userDevices, accounts, contentSubmitted, contentRatings, contentReviews, scheduledCalls
```

**Drop from `User` entirely (fresh DB, no compat needed):**
- `primaryCondition` — superseded by structured condition booleans on PatientProfile
- `riskTier` — derive from age + conditions at rule-engine time
- `diagnosisDate` — not referenced in v2 rule engine; bring back per-condition if clinically needed later
- `baselineSnapshots` relation — `BaselineSnapshot` model is being deleted (see §2.9)

### 2.1b `PatientProfile` — clinical data (1:1 with User, patients only)

New model. All clinical fields that used to live on `User` move here. Created when a user first completes patient intake; absent for admin-only accounts.

```
id                             String  @id @default(uuid())
userId                         String  @unique
user                           User    @relation(fields: [userId], references: [id], onDelete: Cascade)

// Demographics used for clinical rules
gender                         enum MALE | FEMALE | OTHER
heightCm                       Int?                    // one-time entry (adults don't change)

// Pregnancy
isPregnant                     Boolean  default(false)
pregnancyDueDate               DateTime?
historyPreeclampsia            Boolean  default(false)

// Cardiac conditions
hasHeartFailure                Boolean  default(false)
heartFailureType               enum HFREF | HFPEF | UNKNOWN | NOT_APPLICABLE  default(NOT_APPLICABLE)
hasAFib                        Boolean  default(false)
hasCAD                         Boolean  default(false)
hasHCM                         Boolean  default(false)
hasDCM                         Boolean  default(false)
hasTachycardia                 Boolean  default(false)
hasBradycardia                 Boolean  default(false)
diagnosedHypertension          Boolean  default(false)

// Verification state — covers every clinical field above
profileVerificationStatus      enum UNVERIFIED | VERIFIED | CORRECTED  default(UNVERIFIED)
profileVerifiedAt              DateTime?
profileVerifiedBy              String?                  // → User.id of admin who verified
profileLastEditedAt            DateTime  default(now())

createdAt, updatedAt
```

**Verification-on-edit rule:** any patient-side edit to a `PatientProfile` field (or a new `PatientMedication` added) flips `profileVerificationStatus` back to `UNVERIFIED` and `profileLastEditedAt` to now. Implemented in phase/3 intake endpoints.

Why split (not fully normalized into `PatientCondition` rows)?
- Dr. Singal's condition list is locked and finite (9 conditions). Row-per-condition flexibility buys nothing for v2.
- Rule engine reads conditions on every evaluation — fewer joins = faster, simpler.
- Per-condition verification isn't in spec; profile-level verification is.

### 2.2 `JournalEntry` — additions + consolidation

**Consolidation (breaking change vs v1):** Replace `entryDate` (`@db.Date`) + `measurementTime` (`String?`) with a single `measuredAt DateTime`. Fresh DB — no data migration needed.

```
// REMOVE:
// entryDate         DateTime  @db.Date
// measurementTime   String?     // "08:30"

// ADD:
measuredAt                     DateTime      // full UTC timestamp (e.g. 2026-02-28T13:00:00.000Z)
pulse                          Int?
position                       enum SITTING | STANDING | LYING  nullable
sessionId                      String?       // groups ≥2 readings for averaging (AFib requires ≥3)
measurementConditions          Json?         // 8-item checklist raw values
// readingContext is NOT stored — derived at query time from measuredAt + user.timezone

// Structured Level-2 symptom triggers (REPLACES symptoms String[] entirely for these 6)
severeHeadache                 Boolean  default(false)
visualChanges                  Boolean  default(false)
alteredMentalStatus            Boolean  default(false)
chestPainOrDyspnea             Boolean  default(false)
focalNeuroDeficit              Boolean  default(false)
severeEpigastricPain           Boolean  default(false)

// Pregnancy-specific symptom triggers (used only if user.isPregnant)
newOnsetHeadache               Boolean  default(false)
ruqPain                        Boolean  default(false)
edema                          Boolean  default(false)

// Optional freeform notes for symptoms not covered above
otherSymptoms                  String[]

// Index + unique — always key off measuredAt (NOT createdAt):
@@unique([userId, measuredAt])
@@index([userId, measuredAt(sort: Desc)])
```

**Critical ordering rule:** All queries, list views, baseline windows, and rule-engine session grouping must sort by `measuredAt`, never by `createdAt`.

- `createdAt` = when the record was submitted to the server (audit trail only)
- `measuredAt` = when the BP was actually taken (clinical truth, display order, rule input)

Example: patient enters readings in this insertion order — 1:00 PM, 12:00 PM, 12:30 PM → list displays `12:00 → 12:30 → 1:00 PM`.

**Frontend contract:** date + time picker → `new Date(Date.UTC(y, m, d, h, min)).toISOString()` → backend stores UTC → display converts back using `user.timezone`.

**Validation on `measuredAt`:**
- Reject if `measuredAt > now + 5 minutes` (prevent future timestamps; 5 min slack for clock skew)
- Reject if `measuredAt < now - 30 days` (sane backfill limit)

**Session averaging rule (phase/5 implementation, schema-relevant now):** two readings share a session if they have the same `sessionId` OR fall within 30 minutes of each other (`abs(measuredAt.a − measuredAt.b) ≤ 30 min`). Frontend generates a `sessionId` (UUID) client-side when the user taps "add another reading in this session."

### 2.3 New model: `PatientThreshold` (admin-only write)

One row per patient, overwritten on edit (keep history via `replacedAt` soft-version).

```
id                             String  @id @default(uuid())
userId                         String  @unique
sbpUpperTarget                 Int?
sbpLowerTarget                 Int?
dbpUpperTarget                 Int?
dbpLowerTarget                 Int?
hrUpperTarget                  Int?
hrLowerTarget                  Int?
setByProviderId                String  // → User.id (admin)
setAt                          DateTime  @default(now())
replacedAt                     DateTime?
notes                          String?  @db.Text
```

### 2.4 New model: `PatientMedication`

Each reported med is a row. Cards → rows. Supports combination pills via component list.

```
id                             String  @id @default(uuid())
userId                         String
drugName                       String
drugClass                      enum ACE_INHIBITOR | ARB | BETA_BLOCKER | DHP_CCB | NDHP_CCB
                                    | LOOP_DIURETIC | THIAZIDE | MRA | SGLT2
                                    | ANTICOAGULANT | STATIN | ANTIARRHYTHMIC
                                    | VASODILATOR_NITRATE | ARNI | OTHER_UNVERIFIED
isCombination                  Boolean  default(false)
combinationComponents          String[]                         // drugClass codes
frequency                      enum ONCE_DAILY | TWICE_DAILY | THREE_TIMES_DAILY | UNSURE
source                         enum PATIENT_SELF_REPORT | PROVIDER_ENTERED
                                    | PATIENT_VOICE | PATIENT_PHOTO
verificationStatus             enum UNVERIFIED | VERIFIED | REJECTED | AWAITING_PROVIDER
verifiedByAdminId              String?
verifiedAt                     DateTime?
reportedAt                     DateTime  @default(now())
discontinuedAt                 DateTime?     // soft-delete; keeps audit trail
rawInputText                   String?       // voice/photo OCR
notes                          String?  @db.Text

@@index([userId, discontinuedAt])
@@index([userId, verificationStatus])
```

### 2.5 New models: `Practice` + `PatientProviderAssignment`

Required by enrollment gate; cannot activate monitoring without an assignment row.

```
Practice
  id                           String  @id @default(uuid())
  name                         String
  businessHoursStart           String    // "08:00"
  businessHoursEnd             String    // "18:00"
  businessHoursTimezone        String    // IANA tz name, e.g. "America/New_York"
  afterHoursProtocol           String?   @db.Text
  createdAt, updatedAt

PatientProviderAssignment
  id                           String  @id @default(uuid())
  userId                       String  @unique               // one active assignment per patient
  practiceId                   String
  primaryProviderId            String   // → User.id (required)
  backupProviderId             String   // → User.id (required for Tier 1)
  medicalDirectorId            String   // → User.id (required for escalation)
  assignedAt                   DateTime  @default(now())
```

### 2.6 New model: `ProfileVerificationLog`

Audit row for every patient-reported change and every admin verification action. Required for Joint Commission NPSG.03.06.01 and v2.0 "discrepancies logged for quality tracking."

```
id                             String  @id @default(uuid())
userId                         String
fieldPath                      String     // "user.isPregnant" | "medication:<id>.drugClass"
previousValue                  Json?
newValue                       Json?
changedBy                      String     // → User.id
changedByRole                  enum PATIENT | ADMIN | PROVIDER
changeType                     enum PATIENT_REPORT | ADMIN_VERIFY | ADMIN_CORRECT | ADMIN_REJECT
discrepancyFlag                Boolean  default(false)
rationale                      String?  @db.Text
createdAt                      DateTime  @default(now())

@@index([userId, createdAt(sort: Desc)])
```

### 2.7 `DeviationAlert` rework

Keep table. Make `type` and `severity` nullable for back-compat. Add:

```
tier                           enum TIER_1_CONTRAINDICATION | TIER_2_DISCREPANCY
                                    | TIER_3_INFO | BP_LEVEL_1_HIGH | BP_LEVEL_1_LOW
                                    | BP_LEVEL_2 | BP_LEVEL_2_SYMPTOM_OVERRIDE
ruleId                         String                 // which rule fired
mode                           enum STANDARD | PERSONALIZED
pulsePressure                  Int?
suboptimalMeasurement          Boolean  default(false)

patientMessage                 String   @db.Text
caregiverMessage               String   @db.Text
physicianMessage               String   @db.Text

dismissible                    Boolean  default(true) // false for Tier 1 + BP Level 2
resolutionAction               String?                 // enum from D.8 / Tier 1 / Tier 2 lists
resolutionRationale            String?  @db.Text
resolvedBy                     String?                 // → User.id
```

### 2.8 `EscalationEvent` rework

Extend existing model:

```
ladderStep                     enum T0 | T4H | T8H | T24H | T48H | TIER2_48H | TIER2_7D | TIER2_14D
recipientIds                   String[]
recipientRoles                 String[]                // PRIMARY | BACKUP | MEDICAL_DIRECTOR | HEALPLACE_OPS
acknowledgedAt                 DateTime?
acknowledgedBy                 String?
resolvedAt                     DateTime?
resolvedBy                     String?
notificationChannel            enum PUSH | EMAIL | PHONE | DASHBOARD
afterHours                     Boolean  default(false)
```

Covers 13 of 15 audit fields; the other 2 (`resolutionAction`, `resolutionRationale`) live on `DeviationAlert`.

### 2.9 Deleted from v1 (fully)

Fresh DB — no compat concerns. Rip these out in phase/2:

- **`BaselineSnapshot` model** — delete `backend/prisma/schema/baseline_snapshot.prisma` entirely
  - Rule engine doesn't use rolling baselines (that's the v2 pivot)
  - Trend charts compute "N-day average" on the fly from `JournalEntry` rows
  - Drop `JournalEntry.snapshotId` + `JournalEntry.snapshot` relation
  - Drop `User.baselineSnapshots` relation
- **`User.primaryCondition`** — superseded by structured booleans on `PatientProfile`
- **`User.riskTier`** — derive from age + conditions at rule-engine time
- **`User.diagnosisDate`** — not referenced in v2 rules; re-add per-condition if clinically needed later

### 2.10 Derived values — never stored (except audit snapshots)

**Storage principle:** store primary data; compute derived values. The only exception is caching a derived value on an audit row (e.g. `DeviationAlert`) to freeze the exact value that triggered an action.

Derivation helpers live in `/shared/src/derivatives.ts`, imported by rule engine, admin dashboard, patient dashboard, and chat system prompt. Single source of truth.

| Value | Formula | Stored? | Notes |
|---|---|---|---|
| **BMI** | `weight(kg) / (height(m))²` | **No** — computed per call | `PatientProfile.heightCm` + latest `JournalEntry.weight`. Returns `null` if either missing. |
| **Pulse pressure** (per reading) | `systolicBP − diastolicBP` | **No** — computed per call | Displayed on every reading; used by rule engine (>60 → Tier 3 physician flag). |
| **Pulse pressure** (alert snapshot) | session-averaged SBP − session-averaged DBP at alert-fire time | **Yes** — `DeviationAlert.pulsePressure` | Cached at fire-time for audit. Preserves exact value even if raw readings are later edited. |
| **Age group** | from `User.dateOfBirth`: 18–39 / 40–64 / 65+ | **No** — computed per call | Only affects lower-bound BP thresholds (65+ → SBP <100). |
| **Reading context** | from `JournalEntry.measuredAt` + `User.timezone`: MORNING / AFTERNOON / EVENING / NOCTURNAL | **No** — computed per call | Dashboard display + nocturnal-dip rules. |

Example helper shape:
```ts
// /shared/src/derivatives.ts
export function getBMI(heightCm?: number | null, weightKg?: number | Decimal | null): number | null;
export function getPulsePressure(sbp?: number | null, dbp?: number | null): number | null;
export function getAgeGroup(dob?: Date | null): '18-39' | '40-64' | '65+' | null;
export function getReadingContext(measuredAt: Date, timezone?: string | null): 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NOCTURNAL';
```

Phase/4 `ProfileResolver` and phase/5 `AlertEngineService` import from here. Phase/14/15 UI imports from here for display. Phase/16 chat system prompt imports from here for context injection.

---

## 3. Rule Engine Pipeline

### 3.1 Services

- **`ProfileResolver`** — loads patient profile + active verified medications + thresholds; applies safety-net bias (HF type unknown → HFrEF defaults; unverified ACE/ARB still triggers pregnancy contraindication). Returns `ResolvedContext`.
- **`AlertEngineService`** — deterministic pipeline of pure rule functions `(Reading, ResolvedContext) → RuleResult | null`. Short-circuits on highest-severity match.
- **`OutputGenerator`** — given `RuleResult`, produces three-tier messages from `/shared/alert-messages.ts`.

### 3.2 Evaluation order (short-circuits)

1. Pregnancy + ACE/ARB contraindication → Tier 1 (non-dismissable)
2. NDHP-CCB + HFrEF contraindication → Tier 1 (non-dismissable)
3. Symptom override → BP Level 2 (pregnancy-specific if pregnant, else Part 2.3 list)
4. Absolute emergency SBP ≥180 or DBP ≥120 → BP Level 2 (with symptom-assessment prompt, not auto-emergency)
5. Pregnancy thresholds (if `isPregnant`): ≥160/110 → L2, ≥140/90 → L1 High
6. Condition-specific branches (HFrEF / HFpEF / DCM / HCM / CAD)
7. Personalized mode (if `PatientThreshold` exists AND ≥7 readings) → `±20 mmHg` rule
8. Standard mode (AHA 2025)
9. HR branches (AFib >110, tachy >100 × 2 sessions, brady <50/<40, beta-blocker 50–60 suppression)
10. Pulse pressure `SBP − DBP > 60` → Tier 3 physician-only flag

### 3.3 Pre-rule gating

- **Session averaging** — group readings by `sessionId`, average ≥2 before evaluating. AFib requires ≥3 readings.
- **Suboptimal-measurement** — still evaluates, but `DeviationAlert.suboptimalMeasurement = true`.
- **Pre-Day-3 mode** — if patient has <7 readings, force `mode = STANDARD`; UI label: "standard threshold — personalization begins after Day 3."
- **Age groups** — derived from `dateOfBirth`: 18–39 / 40–64 / 65+. Only affects lower bound (65+ uses SBP <100).

### 3.4 Safety net for unverified profiles

| Situation | Engine behavior |
|---|---|
| `isPregnant = true`, unverified | Apply pregnancy thresholds immediately + fire ACE/ARB contraindication check. Tag alert "Awaiting Provider Verification". |
| `hasHeartFailure = true`, `heartFailureType = UNKNOWN` | Apply HFrEF defaults (lower bound SBP <85). More conservative. |
| Medication `drugClass = OTHER_UNVERIFIED` or voice/photo | **No automated alerts** from that med. Stored for provider review. |
| Medication with known class but `verificationStatus = UNVERIFIED` | Apply suppression logic (e.g. beta-blocker HR 50–60 suppression). **Do not** auto-fire Tier 1 contraindications except the safety-critical pairs (ACE/ARB + pregnancy). |

---

## 4. Escalation Engine

`EscalationService` runs on events + a 15-minute cron.

### 4.1 Triggers
- On `DeviationAlert` create with `tier ∈ {TIER_1_*, BP_LEVEL_2*}` → fire T+0 immediately.
- Cron every 15 min: for any alert where current step's deadline has passed AND `acknowledgedAt IS NULL` → fire next step.

### 4.2 Ladders (see CLINICAL_SPEC.md V2-D for full detail)

- **Tier 1**: T+0 primary + email → T+4h backup → T+8h medical director → T+24h Healplace ops → T+48h incident report
- **Tier 2**: T+0 badge → T+48h banner + single push → T+7d backup → T+14d compliance flag
- **BP Level 2**: T+0 primary + backup simultaneous + patient message → T+2h medical director → T+4h Healplace ops

### 4.3 After-hours
- Computed from `Practice.businessHours*`
- Tier 1: queue until business hours, but push to backup immediately
- BP Level 2: fires immediately regardless
- Tier 2: queue for next business day

### 4.4 Resolution
Admin picks from enum list (V2-D resolution tables) + free-text rationale (required for Tier 1). Writes `resolutionAction`, `resolutionRationale`, `resolvedBy`, `resolvedAt` on `DeviationAlert` and marks pending `EscalationEvent` rows as resolved.

---

## 5. Phase Branches

All work happens on a `phase/N-description` branch (never `main` or `dev`).

| # | Branch | Owner | Summary |
|---|---|---|---|
| 0 | `phase/0-bootstrap` | Dev 3 | Context docs, this plan, CLAUDE.md |
| 1 | `phase/1-monorepo-setup` | Dev 3 | npm workspaces, `/shared` package, `/admin` scaffold |
| 1b | `phase/1b-port-provider-pages` | Dev 3 | Port `/frontend/provider/*` UI to `/admin`, frontend SUPER_ADMIN redirect, `.env.example` files, port allocation (backend 4000) |
| 2 | `phase/2-rule-based-schema` | Dev 3 | Single Prisma migration for §2 |
| 3 | `phase/3-patient-intake-api` | Dev 3 | Self-report endpoints + `PatientMedication` CRUD |
| 4 | `phase/4-profile-resolver` | Dev 2 | Safety-net logic, unverified handling |
| 5 | `phase/5-alert-engine` | Dev 2 | Rule pipeline standard + personalized |
| 6 | `phase/6-three-tier-messages` | Dev 2 | Message registry + OutputGenerator |
| 7 | `phase/7-escalation-ladder` | Dev 3 | T+N cron + 15-field audit — ⚠️ blocks on phase/5 + phase/6 |
| 8 | `phase/8-admin-shell` | Dev 1 | Admin app auth, layout, patient list |
| 9 | `phase/9-admin-verification` | Dev 1 | Profile confirm/correct UI |
| 10 | `phase/10-admin-thresholds` | Dev 1 | Threshold editor |
| 11 | `phase/11-admin-dashboard-3layer` | Dev 1 | Red/yellow/green alert panel |
| 12 | `phase/12-admin-reconciliation` | Dev 1 | Medication side-by-side (data model only for MVP) |
| 13 | `phase/13-practice-config` | Dev 3 | `Practice` model, business hours, backup |
| 14 | `phase/14-patient-intake-ui` | Dev 1 | Card-based medication + condition intake |
| 15 | `phase/15-patient-check-in-v2` | Dev 1 | Pulse, checklist, structured symptoms |
| 16 | `phase/16-chat-system-prompt-v2` | Dev 2 | Chat rewrite for new schema |
| 17 | `phase/17-crons` | Dev 3 | Gap alert, monthly re-ask |
| 18 | `phase/18-integration-tests` | all | E2E + rule coverage |
| 19 | `phase/19-seed-data` | Dev 3 | Medication catalog, demo patients, practices |
| 20 | `phase/20-prod-deploy` | Dev 3 | Cutover (deferred) |

---

## 6. Dev Role Split

### Dev 1 — Frontend (patient + admin)
Patient app: intake cards, meds, check-in (pulse/checklist/symptoms), verification badge, three-tier alert rendering, threshold readonly.
Admin app: 3-layer dashboard, verification UI, reconciliation view, threshold editor, escalation audit view, practice config.

### Dev 2 — Rule engine + chat
`ProfileResolver`, `AlertEngineService`, session averaging, age-group derivation, pre-Day-3 mode, three-tier message registry, pulse pressure, chat system prompt rewrite, guardrails, response tone tiers. Unit tests are the spec — one per clinical sub-section.

### Dev 3 — Backend infra + monorepo glue (**user**)
Monorepo + `/shared` + `/admin` scaffold, schema migration, patient intake API, admin verification endpoints, practice + assignment CRUD, threshold CRUD, `ProfileVerificationLog`, escalation service + cron + 15-field audit, resolution API, notification wiring, measurement-gap + monthly re-ask crons, medication catalog seed.

---

## 7. Task Checklists (all three devs)

Each checklist is organized by the phase branches the dev owns. Phase numbers match §5 above. Devs are encouraged to read each other's lists — rule engine shape affects frontend rendering, admin API shape affects admin UI, etc.

---

### 7A. Dev 1 — Frontend (patient app + admin app)

#### Phase 14 — Patient Intake UI (branch `phase/14-patient-intake-ui`)
- [ ] Card-based medication intake — 4 drug classes, ~20 meds (see CLINICAL_SPEC V2-B Screen 1)
- [ ] Combination-pill cards with "2-in-1" badge (5 combos)
- [ ] Dedup logic when patient selects both a component and its combo (prompt with pill images)
- [ ] "I take something not listed" category screen (Screen 2: water pill / blood thinner / cholesterol / rhythm / SGLT2 / other)
- [ ] Voice input (STT) + photo capture stub for "Other medicine not listed"
- [ ] Frequency-only dose capture ("How many times a day?" — Once/Twice/Three/Not sure)
- [ ] DHP vs NDHP-CCB color-coded border (Diltiazem/Verapamil distinct from Amlodipine/Nifedipine)
- [ ] Condition checkboxes (Heart Failure, AFib, CAD, HCM, DCM, None) with icon-based selection
- [ ] HF type follow-up (HFrEF / HFpEF / Not sure) if Heart Failure checked
- [ ] Pregnancy status flow (Yes / No / Not applicable)
- [ ] Audio button on every card (silent-literacy architecture per CLINICAL_SPEC V2-E)
- [ ] "Why this matters" micro-education at each step
- [ ] Submits to `POST /intake/profile` + `POST /intake/medications` (Dev 3)
- [ ] Commit

#### Phase 15 — Patient Check-in v2 (branch `phase/15-patient-check-in-v2`)
- [ ] Pre-measurement checklist — 8 items (CLINICAL_SPEC Part 6)
- [ ] Pulse input field (numeric)
- [ ] Position selector (Sitting / Standing / Lying)
- [ ] Structured symptom buttons replacing freeform `symptoms[]`: severeHeadache, visualChanges, alteredMentalStatus, chestPainOrDyspnea, focalNeuroDeficit, severeEpigastricPain
- [ ] Pregnancy-specific symptom buttons when `user.isPregnant`: newOnsetHeadache, ruqPain, edema
- [ ] Session grouping UI: "Add another reading in this session" button (2–3 readings typical; ≥3 required for AFib patients)
- [ ] Submit tags reading with `sessionId` so backend can average
- [ ] "Awaiting Provider Verification" badge on dashboard while profile unverified
- [ ] Personal threshold read-only display ("Your goal: below X/Y, set by [provider] on [date]")
- [ ] Three-tier patient alert rendering — show only `patientMessage` text
- [ ] Alert detail screen (patient-facing message + "call 911" CTA for BP Level 2)
- [ ] Commit

#### Phase 8 — Admin Shell (branch `phase/8-admin-shell`)
- [ ] Next.js scaffolding done in Phase 1 by Dev 3; Dev 1 builds on it
- [ ] Admin login page (magic link, reuses backend auth)
- [ ] Role guard: non-admin users redirected out
- [ ] Top-level layout: left nav (Patients / Alerts / Practice Config / Audit), top bar with user + logout
- [ ] Patient list view: table with name, condition flags, verification status, last reading, open alerts
- [ ] Search + filter by verification status, condition, open-alert tier
- [ ] Patient detail page skeleton (tabs: Profile / Medications / Alerts / Thresholds / Timeline)
- [ ] Commit

#### Phase 9 — Admin Verification UI (branch `phase/9-admin-verification`)
- [ ] Profile view — shows patient-reported fields alongside an admin-editable column
- [ ] "Confirm" action — writes `profileVerificationStatus = VERIFIED`
- [ ] "Correct" action — allows admin to overwrite value; creates `ProfileVerificationLog` with `discrepancyFlag = true`
- [ ] "Reject" action on medication — `verificationStatus = REJECTED`
- [ ] Badge UI showing "Awaiting Verification" count on patient list
- [ ] Commit

#### Phase 10 — Threshold Editor (branch `phase/10-admin-thresholds`)
- [ ] `PatientThreshold` editor form (6 targets + notes)
- [ ] Condition-defaulted pre-fills: if `hasCAD` → `dbpLowerTarget = 70`; if `hasHFrEF` → `sbpLowerTarget = 85`; etc.
- [ ] Version history display (show `replacedAt` rows)
- [ ] "Mandatory configuration required" banner on HFrEF/DCM/HCM patients until a threshold row exists
- [ ] Commit

#### Phase 11 — 3-Layer Admin Dashboard (branch `phase/11-admin-dashboard-3layer`)
- [ ] Top panel: 🔴 red banner for Tier 1 alerts — non-dismissable
- [ ] 🔴 resolution modal with 5 enum actions (CLINICAL_SPEC V2-C Layer 1)
- [ ] 🟡 yellow numbered badge for Tier 2 — non-interruptive, opens resolution modal with 5 enum actions
- [ ] 🟢 green passive info notes in patient detail only
- [ ] 🔴 animated/blinking banner variant when escalation hits T+8h
- [ ] Per-patient alert history with filterable tiers
- [ ] Commit

#### Phase 12 — Medication Reconciliation View (branch `phase/12-admin-reconciliation`)
- [ ] Side-by-side view: LEFT = patient-reported, RIGHT = provider-verified
- [ ] Status column: ✅ Matched / ⚠️ Discrepancy / 🔵 Unverified
- [ ] Discrepancy resolution flows (CLINICAL_SPEC V2-C Layer 2)
- [ ] **MVP = data model + UI shell only**; full resolution workflow deferred to Post-MVP (Priority 3 #25)
- [ ] Commit

#### Phase 13 assist — Practice Config UI
- [ ] Backend by Dev 3; Dev 1 builds the form
- [ ] Form: name, business hours, timezone, after-hours protocol
- [ ] Per-patient assignment: primary / backup / medical director dropdowns populated from practice staff
- [ ] Commit

#### Cross-cutting polish
- [ ] Icon/audio pass on patient app (silent-literacy architecture)
- [ ] Accessibility: keyboard nav on admin, audio fallbacks on patient
- [ ] Mobile responsive on patient app
- [ ] Escalation audit trail view in admin (read-only timeline of `EscalationEvent` per alert)

---

### 7B. Dev 2 — Rule engine + chat

#### Phase 4 — ProfileResolver (branch `phase/4-profile-resolver`)
- [ ] New service: `/backend/src/daily_journal/services/profile-resolver.service.ts`
- [ ] Loads: `User` clinical fields, active verified `PatientMedication`, `PatientThreshold` (if any), `PatientProviderAssignment`, reading count
- [ ] Returns `ResolvedContext` DTO (lives in `/shared`)
- [ ] Safety-net bias logic:
  - `heartFailureType = UNKNOWN` → apply HFrEF defaults
  - `isPregnant = true` + unverified → still activates pregnancy thresholds AND ACE/ARB contraindication check
  - `drugClass = OTHER_UNVERIFIED` or voice/photo meds → excluded from automated alerts
  - Known-class unverified meds → apply suppression logic (e.g. beta-blocker 50–60 suppression) but NOT Tier 1 contraindications
- [ ] Age group derivation from `dateOfBirth`: 18–39 / 40–64 / 65+
- [ ] Pre-Day-3 flag: true if patient has <7 `JournalEntry` rows
- [ ] Unit tests for each safety-net scenario
- [ ] Commit

#### Phase 5 — Alert Engine (branch `phase/5-alert-engine`)
- [ ] New service: `/backend/src/daily_journal/services/alert-engine.service.ts`
- [ ] Session averaging: group readings by `sessionId`, compute mean SBP/DBP/pulse. AFib requires ≥3 readings before evaluating.
- [ ] Pipeline in evaluation order (short-circuit on highest severity):
  1. Pregnancy + ACE/ARB contraindication → Tier 1
  2. NDHP-CCB + HFrEF contraindication → Tier 1
  3. Symptom override → BP Level 2 (pregnancy-specific if pregnant)
  4. Absolute emergency SBP ≥180 or DBP ≥120 → BP Level 2
  5. Pregnancy thresholds (≥160/110 L2, ≥140/90 L1) if `isPregnant`
  6. Condition branches: HFrEF (<85 / ≥160), HFpEF (<110 / ≥160), DCM (<85 / ≥160), HCM (<100 / ≥160), CAD (DBP <70 critical)
  7. Personalized mode (if `PatientThreshold` AND ≥7 readings): `±20 mmHg` rule
  8. Standard mode (AHA 2025 table)
  9. HR branches: AFib >110, tachy >100 × 2, brady <50 symptomatic / <40 asymptomatic, beta-blocker 50–60 suppression
  10. Pulse pressure `SBP − DBP > 60` → Tier 3 physician-only flag
- [ ] Suboptimal-measurement flag: evaluate but tag `DeviationAlert.suboptimalMeasurement = true`
- [ ] Pre-Day-3 mode: force `mode = STANDARD`, tag output
- [ ] 65+ lower bound override: SBP <100 (not <90)
- [ ] Integration with existing `deviation.service` event emission — refactor, don't duplicate
- [ ] Unit tests — **one test per signed-off clinical sub-section in CLINICAL_SPEC.md**
- [ ] Commit

#### Phase 6 — Three-Tier Messages (branch `phase/6-three-tier-messages`)
- [ ] Create `/shared/alert-messages.ts` — registry keyed by `ruleId`
- [ ] Each `ruleId` entry has `{ patientMessage, caregiverMessage, physicianMessage }` functions that take context and return strings
- [ ] `OutputGenerator` service in backend consumes this registry
- [ ] Every rule in Phase 5 has a corresponding `ruleId` entry
- [ ] Dr. Singal reviews this single file for wording sign-off
- [ ] Unit tests verify every rule produces all three messages
- [ ] Commit

#### Phase 16 — Chat System Prompt v2 (branch `phase/16-chat-system-prompt-v2`)
- [ ] Rewrite `/backend/src/chat/services/system-prompt.service.ts` to inject new structured fields:
  - Conditions (hasHeartFailure, heartFailureType, hasCAD, hasAFib, etc.)
  - Verified `PatientMedication` list (drug class, frequency, verification status)
  - Current `PatientThreshold` (if any)
  - Last N `DeviationAlert` rows with tier + ruleId + resolution state
  - `profileVerificationStatus`
  - Pregnancy status
- [ ] Guardrails:
  - Chatbot never suggests stopping/changing a medication
  - Chatbot never contradicts an alert tier
  - For BP Level 2 / Tier 1 alerts, chatbot defers to provider
- [ ] Context injection for "why did I get this alert?" — pull last alert's `physicianMessage` and phrase for patient
- [ ] Tone-tier output:
  - Patient chat → warm, plain language
  - If caregiver mode (future) → context + action
  - Physician mode (future) → clinical shorthand
- [ ] Integration tests: ensure voice/ADK flow still works with new system prompt
- [ ] Regression check: existing voice features from v1 still function
- [ ] Commit

#### Phase 18 contribution — Clinical spec coverage tests
- [ ] Every CLINICAL_SPEC signed-off item has a passing test
- [ ] Edge cases from CLINICAL_SPEC Part 8 (resolved open questions)
- [ ] Load test: 500 readings/day × 50 alerts/day

---

### 7C. Dev 3 — Backend infra + monorepo glue (**user**)

#### Phase 1 — Monorepo Setup (branch `phase/1-monorepo-setup`)
- [x] Root `package.json` with `"workspaces": ["backend", "frontend", "admin", "shared"]`
- [x] Delete `package-lock.json` at root if stale; regenerate
- [x] Create `/shared` package: `package.json` (name: `@cardioplace/shared`), `tsconfig.json`, `src/index.ts` with placeholder export
- [x] Scaffold `/admin` — fresh Next.js 16 app (App Router + TS + Tailwind v4 + React 19), copy auth + layout primitives from `/frontend`
- [x] Add `SUPER_ADMIN`-only guard at `/admin/src/proxy.ts` (Next 16 renamed `middleware.ts` → `proxy.ts`)
- [x] Update `/frontend` + `/admin` `package.json` to depend on `@cardioplace/shared`
- [x] Sanity check: `npm install` at root succeeds
- [x] Sanity check: `npm run build -w frontend` / `-w admin` / `-w backend` all pass
- [x] Add CORS in backend for both subdomains (dev: localhost:3000 + localhost:3001; prod later)
- [x] Commit

#### Phase 1b — Port Provider Pages + Phase 1 Gap Fills (branch `phase/1b-port-provider-pages`)
- [ ] Mechanical port of `frontend/src/app/provider/{dashboard,patients,scheduled-calls}` → `admin/src/app/{dashboard,patients,scheduled-calls}`
- [ ] Port `frontend/src/components/cardio/{ProviderDashboard,AlertPanel,ScheduleModal}.tsx` → `admin/src/components/` (flat, not under `/cardio`)
- [ ] Port `provider.service.ts`, `LanguageContext.tsx`, `i18n/*.ts` into `/admin` — swap `fetchWithAuth` to admin's `token.ts`
- [ ] Add TODO(phase/11) markers on every `transformAlert()` / `L1` / `L2` / tier reference — Dev 1 refactors to v2 tier model in phase/11
- [ ] Add `AdminNavbar` component + wire `LanguageProvider` into `admin/src/app/layout.tsx`
- [ ] Add `framer-motion`, `recharts`, `@tailwindcss/typography` to `/admin` dependencies; import `theme.css` in admin `globals.css`
- [ ] Delete `frontend/src/app/provider/` and `frontend/src/components/cardio/{ProviderDashboard,AlertPanel,ScheduleModal}.tsx`
- [ ] Remove `/provider/*` links from `Navbar.tsx`; remove `isAdmin` / `support@healplace.com` branches from `Homepage.tsx`, `sign-in`, `magic-link`, `dashboard/page.tsx`
- [ ] Update `frontend/src/proxy.ts`: decode JWT, redirect SUPER_ADMIN users to `NEXT_PUBLIC_ADMIN_URL`
- [ ] Create `backend/.env.example`, `frontend/.env.example`, `admin/.env.example` — port 4000 backend, 3000 frontend, 3001 admin
- [ ] Set `backend/src/main.ts` default `PORT ?? 4000` (frees up 3000 for the frontend)
- [ ] Refresh `CLAUDE.md` + this file for Next 16, `proxy.ts`, local port allocation
- [ ] Verify `npm run build` passes for all four workspaces
- [ ] Commit

#### Phase 2 — Schema Migration (branch `phase/2-rule-based-schema`)
- [ ] Slim `/backend/prisma/schema/user.prisma` to identity + auth only (§2.1); drop `primaryCondition` / `riskTier` / `diagnosisDate` / `RiskTier` enum / `baselineSnapshots` relation; add v2 relations
- [ ] Collapse `UserRole` enum to 5 values (`PATIENT, PROVIDER, MEDICAL_DIRECTOR, HEALPLACE_OPS, SUPER_ADMIN`), default `[PATIENT]`
- [ ] New `/backend/prisma/schema/patient_profile.prisma` (§2.1b) — 1:1 with User, holds all clinical fields
- [ ] Rework `/backend/prisma/schema/daily_journal.prisma` — `entryDate` + `measurementTime` → `measuredAt`; add pulse/position/session/structured symptoms; drop `symptoms[]` + `snapshotId` (§2.2)
- [ ] New `patient_threshold.prisma` (§2.3)
- [ ] New `patient_medication.prisma` (§2.4)
- [ ] New `practice.prisma` + `patient_provider_assignment.prisma` (§2.5)
- [ ] New `profile_verification_log.prisma` (§2.6)
- [ ] Rework `diviation_alert.prisma` — nullable `type`/`severity`, add tier/ruleId/mode/3-tier text/resolution (§2.7)
- [ ] DELETE `/backend/prisma/schema/baseline_snapshot.prisma` (§2.9)
- [ ] Extend `escalation_event.prisma` with ladderStep/recipients/ack/resolve (§2.8)
- [ ] Backend surgery: delete baseline.service.ts + spec + check_baseline.js; delete guest-auth path in auth.service.ts; rename daily_journal `entryDate`/`measurementTime` → `measuredAt` everywhere; rewrite deviation.service (absolute thresholds only) and escalation.service for v2 field names; collapse content/KB `@Roles()` lists to `[SUPER_ADMIN]`; remove `primaryCondition` / `riskTier` / `diagnosisDate` from auth/voice/chat/test helpers; rewrite provider.service.ts with inline `derivePrimaryCondition` + `deriveRiskTier` helpers + `TODO(phase/4)` marker
- [ ] Rewrite `backend/prisma/seed.ts` to MVP (1 admin + 2 patients with PatientProfile + 1 Practice + 2 assignments + a few JournalEntry rows); delete `seed.js`
- [ ] Doc reconciliation: CLAUDE.md (Next 14 → 16, move `BaselineSnapshot` to deletions list); BUILD_PLAN.md (this checklist)
- [ ] Wipe migrations: `rm -rf backend/prisma/migrations/*`
- [ ] Run `cd backend && npx prisma migrate dev --name init_cardio_v2`
- [ ] Run `cd backend && npx prisma generate`
- [ ] `npm run build -w backend` green
- [ ] `cd backend && npx prisma db seed` runs clean
- [ ] Commit

#### Phase 3 — Patient Intake API (branch `phase/3-patient-intake-api`)
- [ ] `POST /intake/profile` — writes User clinical fields + `ProfileVerificationLog` row
- [ ] `POST /intake/medications` — batch create `PatientMedication` + logs
- [ ] `PATCH /me/medications/:id` — update (soft-delete via `discontinuedAt`) + log
- [ ] `POST /me/pregnancy` — update `isPregnant` + dueDate + log
- [ ] Admin verification endpoints: `POST /admin/users/:id/verify-profile`, `POST /admin/users/:id/correct-profile`, `POST /admin/medications/:id/verify`
- [ ] All writes emit `ProfileVerificationLog` via interceptor or decorator
- [ ] Commit

#### Phase 7 — Escalation Service (branch `phase/7-escalation-ladder`)

⚠️ **Blocks on phase/5 + phase/6.** Dev 2 must ship AlertEngine + OutputGenerator before phase/7 can read populated `DeviationAlert.tier`, `ruleId`, and three-tier messages. Starting phase/7 on stubs forces rework when the event shapes settle.

- [ ] Extend existing `EscalationService` to write `EscalationEvent.ladderStep`
- [ ] `@Cron('*/15 * * * *')` scanner: advance overdue ladders
- [ ] Business-hours math using `Practice.businessHours*` + Luxon or date-fns-tz
- [ ] BP Level 2 exception: fires immediately regardless of hours
- [ ] Dual-notify on BP Level 2 T+0 (primary + backup)
- [ ] Resolution API: `POST /alerts/:id/resolve` with enum `resolutionAction` + rationale
- [ ] 15-field audit trail populated (13 auto + 2 from resolution)
- [ ] Commit

#### Phase 13 — Practice Config (branch `phase/13-practice-config`)
- [ ] CRUD endpoints for `Practice` (admin-only)
- [ ] CRUD for `PatientProviderAssignment`
- [ ] Enrollment gate: `User.onboardingStatus` cannot flip to `COMPLETED` without assignment row
- [ ] Admin endpoint to set business hours, after-hours protocol
- [ ] Commit

#### Phase 17 — Crons (branch `phase/17-crons`)
- [ ] Gap-alert cron: if no `JournalEntry` in 48h → push notification to caregiver/patient
- [ ] Monthly re-ask cron: "Are you still taking the same medicines?" prompt → opens card UI
- [ ] Commit

#### Phase 19 — Seed Data (branch `phase/19-seed-data`)
- [ ] Medication catalog: 20 meds across 4 classes + 5 combos (see CLINICAL_SPEC V2-B)
- [ ] Demo `Practice` row (Cedar Hill)
- [ ] Demo admin users (primary / backup / medical director)
- [ ] Demo patients covering: pregnant + ACE/ARB, HFrEF + NDHP-CCB, CAD + DBP<70, AFib, standard HTN
- [ ] Commit

---

## 8. Setup — Getting Started Locally

### 8.1 Prerequisites
- Node.js 20+
- npm 10+
- PostgreSQL 15+ (local or Docker)
- Git

### 8.2 First-time setup

Phase 1b ships an `.env.example` in each workspace (`backend/`, `frontend/`, `admin/`) and the build now expects local ports **backend 4000, frontend 3000, admin 3001**.

```bash
# 1. Clone (already done)
cd c:/git/work/cardioplace-v2

# 2. Install all workspace deps from the repo root (npm workspaces)
npm install

# 3. Provision a new local Postgres DB
createdb cardioplace_v2_dev
# (or use docker-compose.yml in repo root — check if the legacy one works)

# 4. Copy env examples and fill in secrets
cp backend/.env.example backend/.env          # DATABASE_URL, JWT_SECRET, PORT=4000, WEB_APP_URL=...
cp frontend/.env.example frontend/.env.local  # NEXT_PUBLIC_API_URL=http://localhost:4000
cp admin/.env.example admin/.env.local        # NEXT_PUBLIC_API_URL=http://localhost:4000
# Update JWT secrets — do NOT reuse the v1 prod values.

# 5. Run Prisma migrations + generate client
cd backend
npx prisma migrate dev
npx prisma generate

# 6. Run backend (port 4000)
npm run start:dev

# 7. In another terminal — patient app
cd ../frontend
npm run dev           # http://localhost:3000

# 8. In another terminal — admin app
cd ../admin
npm run dev           # http://localhost:3001
```

### 8.3 Environment isolation from v1 production

**Critical**: this repo must not touch v1 production data.
- Fresh database (separate Postgres instance or DB name)
- Fresh JWT secret (do NOT reuse v1 value)
- Fresh email service sandbox/test keys
- Different subdomains for deploy (app.cardioplaceai.com / admin.cardioplaceai.com)
- Confirm no hardcoded v1 URLs in the codebase before deploy

### 8.4 Branch workflow

```bash
# Start a new phase
git checkout main
git pull
git checkout -b phase/N-description

# Work, commit (one short line, no Co-Authored-By)
git add <files>
git commit -m "short summary"

# Push + PR
git push -u origin phase/N-description
# Open PR to main
```

---

## 9. Timeline (8-week target with 3 devs, 100% Claude-assisted)

- **Week 1** — Foundations: monorepo + `/shared` + `/admin` scaffold + schema migration + `ProfileResolver` skeleton + intake card UI
- **Week 2** — Core rule engine + condition branches + patient self-report complete + enrollment gate
- **Week 3** — Three-tier messages + chat rewrite + admin shell + escalation cron
- **Week 4** — Admin verification + threshold editor + 3-layer dashboard + reconciliation data model
- **Week 5** — Integration tests + clinical spec coverage + Dr. Singal sign-off
- **Week 6** — Production deploy + first cohort soft launch
- **Week 7** — Cohort expansion + bug fixes
- **Week 8** — Stabilization + Priority 3 activation

Aggressive: 6 weeks. Target: 8 weeks. Worst-case: 10 weeks.

---

## 10. Known Risks

| Risk | Likelihood | Impact |
|---|---|---|
| Dr. Singal unavailable for sign-offs | High | +3 days |
| npm workspace trips Railway/Vercel build | Medium | +2 days |
| Real patients surface a rule edge case | High | +2 days |
| Practice config UI needs more iteration | Medium | +2 days |
| Chat rewrite regresses voice integration | Medium | +2 days |
| 60 MB `.onnx` voice file triggers git LFS requirement | Low | +0.5 day |
