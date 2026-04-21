# Build Plan — Architecture, Tasks, Setup, Timeline

One document covering: architecture & schema, rule-engine design, escalation ladder, three-dev role split, phase branches, Dev 3 task checklist, and local setup. Clinical rules live in `CLINICAL_SPEC.md`.

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

### 2.1 `User` additions

```
gender                         enum MALE | FEMALE | OTHER
heightCm                       Int?

// Clinical condition booleans (patient-reported, admin-verified)
isPregnant                     Boolean  default(false)
pregnancyDueDate               DateTime?
historyPreeclampsia            Boolean  default(false)
hasHeartFailure                Boolean  default(false)
heartFailureType               enum HFREF | HFPEF | UNKNOWN | NOT_APPLICABLE  default(NOT_APPLICABLE)
hasAFib                        Boolean  default(false)
hasCAD                         Boolean  default(false)
hasHCM                         Boolean  default(false)
hasDCM                         Boolean  default(false)
hasTachycardia                 Boolean  default(false)
hasBradycardia                 Boolean  default(false)
diagnosedHypertension          Boolean  default(false)

// Verification state (covers all clinical fields above)
profileVerificationStatus      enum UNVERIFIED | VERIFIED | CORRECTED  default(UNVERIFIED)
profileVerifiedAt              DateTime?
profileVerifiedBy              String?   // → User.id of admin
profileLastEditedAt            DateTime  default(now())
```

Deprecate `primaryCondition` (freeform) — migrate to structured booleans.
Keep `riskTier` but derive it from age + conditions; don't store long-term.

### 2.2 `JournalEntry` additions

```
pulse                          Int?
position                       enum SITTING | STANDING | LYING  nullable
sessionId                      String?   // groups ≥2 readings for averaging (AFib requires ≥3)
measurementConditions          Json?     // 8-item checklist raw values
readingContext                 enum MORNING | AFTERNOON | EVENING | NOCTURNAL  // derived server-side

// Structured Level-2 symptom triggers (replaces freeform symptoms[] for these)
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

// Keep symptoms String[] for freeform "other"
```

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

### 2.9 Retired / softened

- `BaselineSnapshot` — keep for trend charts only. Rule engine doesn't use rolling baselines anymore.
- `User.primaryCondition` — deprecate after Part 2.1 migration.

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
| 2 | `phase/2-rule-based-schema` | Dev 3 | Single Prisma migration for §2 |
| 3 | `phase/3-patient-intake-api` | Dev 3 | Self-report endpoints + `PatientMedication` CRUD |
| 4 | `phase/4-profile-resolver` | Dev 2 | Safety-net logic, unverified handling |
| 5 | `phase/5-alert-engine` | Dev 2 | Rule pipeline standard + personalized |
| 6 | `phase/6-three-tier-messages` | Dev 2 | Message registry + OutputGenerator |
| 7 | `phase/7-escalation-ladder` | Dev 3 | T+N cron + 15-field audit |
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

## 7. Dev 3 Task Checklist

### 7.1 Phase 1 — Monorepo Setup (branch `phase/1-monorepo-setup`)
- [ ] Root `package.json` with `"workspaces": ["backend", "frontend", "admin", "shared"]`
- [ ] Delete `package-lock.json` at root if stale; regenerate
- [ ] Create `/shared` package: `package.json` (name: `@cardioplace/shared`), `tsconfig.json`, `src/index.ts` with placeholder export
- [ ] Scaffold `/admin` — fresh Next.js 14 app (App Router + TS + Tailwind), copy auth + layout primitives from `/frontend`
- [ ] Add `SUPER_ADMIN`-only guard at `/admin/src/middleware.ts`
- [ ] Update `/frontend` + `/admin` `package.json` to depend on `@cardioplace/shared`
- [ ] Sanity check: `npm install` at root succeeds
- [ ] Sanity check: `npm run build -w frontend` / `-w admin` / `-w backend` all pass
- [ ] Add CORS in backend for both subdomains (dev: localhost:3000 + localhost:3001; prod later)
- [ ] Commit

### 7.2 Phase 2 — Schema Migration (branch `phase/2-rule-based-schema`)
- [ ] Extend `/backend/prisma/schema/user.prisma` with clinical fields (§2.1)
- [ ] Extend `/backend/prisma/schema/daily_journal.prisma` with pulse/session/symptoms (§2.2)
- [ ] New `patient_threshold.prisma` (§2.3)
- [ ] New `patient_medication.prisma` (§2.4)
- [ ] New `practice.prisma` + `patient_provider_assignment.prisma` (§2.5)
- [ ] New `profile_verification_log.prisma` (§2.6)
- [ ] Extend `diviation_alert.prisma` with tier/ruleId/mode/3-tier text (§2.7)
- [ ] Extend `escalation_event.prisma` with ladderStep/recipients/ack/resolve (§2.8)
- [ ] Run `cd backend && npx prisma migrate dev --name cardio_v2_rule_based`
- [ ] Run `cd backend && npx prisma generate`
- [ ] Commit

### 7.3 Phase 3 — Patient Intake API (branch `phase/3-patient-intake-api`)
- [ ] `POST /intake/profile` — writes User clinical fields + `ProfileVerificationLog` row
- [ ] `POST /intake/medications` — batch create `PatientMedication` + logs
- [ ] `PATCH /me/medications/:id` — update (soft-delete via `discontinuedAt`) + log
- [ ] `POST /me/pregnancy` — update `isPregnant` + dueDate + log
- [ ] Admin verification endpoints: `POST /admin/users/:id/verify-profile`, `POST /admin/users/:id/correct-profile`, `POST /admin/medications/:id/verify`
- [ ] All writes emit `ProfileVerificationLog` via interceptor or decorator
- [ ] Commit

### 7.4 Phase 7 — Escalation Service (branch `phase/7-escalation-ladder`)
- [ ] Extend existing `EscalationService` to write `EscalationEvent.ladderStep`
- [ ] `@Cron('*/15 * * * *')` scanner: advance overdue ladders
- [ ] Business-hours math using `Practice.businessHours*` + Luxon or date-fns-tz
- [ ] BP Level 2 exception: fires immediately regardless of hours
- [ ] Dual-notify on BP Level 2 T+0 (primary + backup)
- [ ] Resolution API: `POST /alerts/:id/resolve` with enum `resolutionAction` + rationale
- [ ] 15-field audit trail populated (13 auto + 2 from resolution)
- [ ] Commit

### 7.5 Phase 13 — Practice Config (branch `phase/13-practice-config`)
- [ ] CRUD endpoints for `Practice` (admin-only)
- [ ] CRUD for `PatientProviderAssignment`
- [ ] Enrollment gate: `User.onboardingStatus` cannot flip to `COMPLETED` without assignment row
- [ ] Admin endpoint to set business hours, after-hours protocol
- [ ] Commit

### 7.6 Phase 17 — Crons (branch `phase/17-crons`)
- [ ] Gap-alert cron: if no `JournalEntry` in 48h → push notification to caregiver/patient
- [ ] Monthly re-ask cron: "Are you still taking the same medicines?" prompt → opens card UI
- [ ] Commit

### 7.7 Phase 19 — Seed Data (branch `phase/19-seed-data`)
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

```bash
# 1. Clone (already done)
cd c:/git/work/cardioplace-v2

# 2. Provision a new local Postgres DB
createdb cardioplace_v2_dev
# (or use docker-compose.yml in repo root — check if the legacy one works)

# 3. Backend env
cd backend
cp .env.example .env    # if .env.example doesn't exist, create from v1 .env
# Update DATABASE_URL → postgres://localhost/cardioplace_v2_dev
# Update JWT_SECRET to something new (do NOT reuse the v1 prod secret)
# Set NEXT_PUBLIC_API_URL, email service keys fresh

# 4. Install deps (from root once npm workspaces are set up in phase/1)
cd ..
npm install

# 5. Run migrations
cd backend
npx prisma migrate dev
npx prisma generate

# 6. Run backend
npm run start:dev

# 7. In another terminal — patient app
cd ../frontend
npm run dev           # http://localhost:3000

# 8. In another terminal — admin app (after phase/1 scaffolding)
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
