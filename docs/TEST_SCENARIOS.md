# Test Scenarios — Phases 4, 5, 6 (Rule-Based BP Alert Engine)

Generated for clinical + QA traceability before phase/7 escalation starts.

**Totals**: 182 Jest cases, 6 spec files, all green on branch `phase/6-three-tier-messages`.

**Default assumptions (unless overridden in the scenario)**:
- User DOB `1980-06-15` → `ageGroup = 40-64` at current date
- Gender `FEMALE`, height `165 cm`
- No pregnancy, no cardiac conditions, no meds, no custom threshold
- 10 prior readings logged → `preDay3Mode = false`
- Profile verification status `VERIFIED`
- Current reading BP `125/75`, pulse `72`, no symptoms, no suboptimal flag, `readingCount = 1`

---

## File 1 — ProfileResolverService (30 tests)

Path: [backend/src/daily_journal/services/profile-resolver.service.spec.ts](backend/src/daily_journal/services/profile-resolver.service.spec.ts)

### Loading

| Case | Input | Expected |
|---|---|---|
| Happy path | `userId = user-1`, `readingCount = 10` | returns `ResolvedContext` with all relations populated |
| Admin user (no profile) | `patientProfile = null` | throws `ProfileNotFoundException` |
| User not found | `findUnique → null` | throws `ProfileNotFoundException` |
| Query efficiency | any input | `prisma.user.findUnique` called exactly once, `journalEntry.count` once |

### Medication filtering

| Case | Med input | `contextMeds` | `excludedMeds` |
|---|---|---|---|
| Discontinued | query filters `discontinuedAt: null` | not loaded | — |
| Rejected | `verificationStatus = REJECTED` | ∅ | `{Lisinopril}` |
| OTHER_UNVERIFIED | `drugClass = OTHER_UNVERIFIED` | ∅ | `{Unknown pill}` |
| Unverified voice | `source = PATIENT_VOICE`, `verificationStatus = UNVERIFIED` | ∅ | `{Lisinopril}` |
| Unverified photo | `source = PATIENT_PHOTO`, `verificationStatus = UNVERIFIED` | ∅ | `{Lisinopril}` |
| Known-class unverified | `drugClass = BETA_BLOCKER`, `verificationStatus = UNVERIFIED` | `{Metoprolol}` | ∅ |
| Verified voice | `source = PATIENT_VOICE`, `verificationStatus = VERIFIED` | `{Lisinopril}` | ∅ |

### Safety-net biases

| Case | Profile input | Expected |
|---|---|---|
| HF type UNKNOWN | `hasHeartFailure = true`, `heartFailureType = UNKNOWN` | `resolvedHFType = HFREF` |
| Declared HFREF | `heartFailureType = HFREF` | `resolvedHFType = HFREF` |
| Declared HFPEF | `heartFailureType = HFPEF` | `resolvedHFType = HFPEF` (not auto-biased) |
| DCM alone | `hasHeartFailure = false`, `hasDCM = true` | `resolvedHFType = HFREF` (§4.8) |
| No HF, no DCM | defaults | `resolvedHFType = NOT_APPLICABLE` |
| Pregnant + unverified | `isPregnant = true`, `profileVerificationStatus = UNVERIFIED` | `pregnancyThresholdsActive = true`, `triggerPregnancyContraindicationCheck = true` |
| Not pregnant | `isPregnant = false` | both flags `false` |

### Pre-Day-3 flag

| `readingCount` | Expected `preDay3Mode` |
|---|---|
| 0 | `true` |
| 6 | `true` |
| 7 | `false` (boundary) |
| 20 | `false` |

### Age bucket

| DOB | Evaluated at | Expected `ageGroup` |
|---|---|---|
| `1980-06-15` | `2026-04-22` | `40-64` |
| `null` | — | `null` |
| `1950-01-01` | `2026-04-22` | `65+` |

### Personalized-mode eligibility

| Threshold | `readingCount` | Expected |
|---|---|---|
| present | 10 | `personalizedEligible = true`, `preDay3Mode = false` |
| present | 3 | `personalizedEligible = false`, `preDay3Mode = true` |
| absent | 10 | `personalizedEligible = false` |

### Assignment pass-through

| Input | Expected `assignment` |
|---|---|
| `{practice-1, prov-primary, prov-backup, prov-md}` | same four ids flattened |

---

## File 2 — Derivatives (21 tests)

Path: [backend/src/daily_journal/engine/derivatives.spec.ts](backend/src/daily_journal/engine/derivatives.spec.ts)

### A.1 `getPulsePressure(sbp, dbp)`

| Input | Output |
|---|---|
| `160, 80` | `80` |
| `null, 80` | `null` |
| `160, null` | `null` |
| `80, 90` (SBP < DBP sensor error) | `null` |

### A.2 `getBMI(heightCm, weightKg)`

| Input | Output |
|---|---|
| `170, 70` | `≈ 24.22` |
| `null, 70` | `null` |
| `170, null` | `null` |
| `170, Decimal("70")` | number, non-null |

### A.3 `getAgeGroup(dob, now = 2026-04-22)`

| DOB | Output |
|---|---|
| `2000-04-22` (age 25) | `18-39` |
| `1975-04-22` (age 50) | `40-64` |
| `1955-04-22` (age 70) | `65+` |
| `1986-04-22` (exactly 40) | `40-64` |
| `1961-04-22` (exactly 65) | `65+` |
| `null` | `null` |
| `2030-04-22` (future) | `null` |
| `2020-04-22` (age 5) | `null` |

### A.4 `getReadingContext(measuredAt, timezone)`

| `measuredAt` (UTC) | timezone | Output |
|---|---|---|
| `2026-04-22T08:00Z` | — | `MORNING` |
| `2026-04-22T14:00Z` | — | `AFTERNOON` |
| `2026-04-22T19:00Z` | — | `EVENING` |
| `2026-04-22T02:00Z` | — | `NOCTURNAL` |
| `2026-04-22T14:00Z` | `America/New_York` (= 10:00 local) | `MORNING` |
| `2026-04-22T08:00Z` | invalid string | falls back → `MORNING` |

---

## File 3 — SessionAverager (8 tests)

Path: [backend/src/daily_journal/services/session-averager.service.spec.ts](backend/src/daily_journal/services/session-averager.service.spec.ts)

All tests use anchor `userId = user-1`, starting `measuredAt = 2026-04-22T08:00Z`.

| Case | Readings | Expected session |
|---|---|---|
| Single reading | `[160/95, pulse 80]` | `systolic=160, diastolic=95, pulse=80, readingCount=1` |
| Two readings same sessionId | `[160/90/70, 140/80/80]` 10 min apart, sessionId `s1` | `mean = 150/85/75, readingCount=2` |
| ≥3 readings | `[SBP 160, 170, 180]` sessionId `s1`, 5 min apart each | `mean SBP = 170, readingCount=3` |
| OR-reduce symptoms | entry A `severeHeadache=true`, entry B `chestPainOrDyspnea=true` | both flags `true`, `visualChanges=false` |
| Any false checklist item | `measurementConditions = { noCaffeine: true, seatedRest: false }` | `suboptimalMeasurement = true` |
| All checklist items true | `measurementConditions = { noCaffeine: true }` | `suboptimalMeasurement = false` |
| Empty siblings | `[]` | `null` |
| Dedup otherSymptoms | A `["dizzy"]`, B `["dizzy","nausea"]` | `["dizzy","nausea"]` |

---

## File 4 — Rule functions (75 tests)

Path: [backend/src/daily_journal/engine/rules.spec.ts](backend/src/daily_journal/engine/rules.spec.ts)

Per-rule fixture defaults: BP `125/75`, pulse `72`, no symptoms, no suboptimal.

### D.1 Pregnancy + ACE/ARB

| Case | Context | Meds | Expected |
|---|---|---|---|
| Verified lisinopril | `isPregnant=true` | `Lisinopril, ACE_INHIBITOR, VERIFIED` | `TIER_1_CONTRAINDICATION`, `RULE_PREGNANCY_ACE_ARB`, drugName=Lisinopril |
| ARB losartan | `isPregnant=true` | `Losartan, ARB` | `TIER_1_CONTRAINDICATION` |
| Entresto combo | `isPregnant=true` | `Entresto, ARNI, combo=[ARNI,ARB]` | `TIER_1_CONTRAINDICATION` |
| Amlodipine only | `isPregnant=true` | `Amlodipine, DHP_CCB` | `null` |
| Unverified lisinopril | `isPregnant=true`, `triggerPregnancyContraindicationCheck=true` | `Lisinopril, UNVERIFIED` | `TIER_1_CONTRAINDICATION` (safety-net) |
| Not pregnant | defaults | `Lisinopril` | `null` |

### D.2 NDHP-CCB + HFrEF

| Case | `resolvedHFType` | Med | Expected |
|---|---|---|---|
| HFREF + diltiazem verified | `HFREF` | `Diltiazem, NDHP_CCB, VERIFIED` | `TIER_1_CONTRAINDICATION`, `RULE_NDHP_HFREF` |
| UNKNOWN type → HFREF | `HFREF` (biased) | `Diltiazem, NDHP_CCB` | `TIER_1_CONTRAINDICATION` |
| HFPEF + diltiazem | `HFPEF` | `Diltiazem, NDHP_CCB` | `null` |
| HFREF + amlodipine | `HFREF` | `Amlodipine, DHP_CCB` | `null` |
| DCM + diltiazem | `HFREF` (via DCM bias) | `Diltiazem, NDHP_CCB` | `TIER_1_CONTRAINDICATION` |
| HFREF + unverified diltiazem | `HFREF` | `Diltiazem, NDHP_CCB, UNVERIFIED` | `null` (V2-A: only ACE/ARB fires on unverified) |

### E.1–E.6 General symptom override (session BP `125/75`)

| Symptom flag (true, others false) | Expected |
|---|---|
| `severeHeadache` | `BP_LEVEL_2_SYMPTOM_OVERRIDE` |
| `visualChanges` | `BP_LEVEL_2_SYMPTOM_OVERRIDE` |
| `alteredMentalStatus` | `BP_LEVEL_2_SYMPTOM_OVERRIDE` |
| `chestPainOrDyspnea` | `BP_LEVEL_2_SYMPTOM_OVERRIDE` |
| `focalNeuroDeficit` | `BP_LEVEL_2_SYMPTOM_OVERRIDE` |
| `severeEpigastricPain` | `BP_LEVEL_2_SYMPTOM_OVERRIDE` |
| all false | `null` |
| `otherSymptoms = ["dizzy"]` (freeform) | `null` |

### E.7–E.10 Pregnancy-specific symptom override

| Pregnant? | Symptom | BP | Expected |
|---|---|---|---|
| yes | `newOnsetHeadache` | 125/75 | `BP_LEVEL_2_SYMPTOM_OVERRIDE` |
| yes | `edema` | 110/70 | `BP_LEVEL_2_SYMPTOM_OVERRIDE` |
| no | `newOnsetHeadache` | 125/75 | `null` |
| yes | `ruqPain` | 125/75 | `BP_LEVEL_2_SYMPTOM_OVERRIDE` (metadata contains "RUQ") |

### F Absolute emergency

| SBP | DBP | Expected |
|---|---|---|
| 180 | 85 | `BP_LEVEL_2`, `RULE_ABSOLUTE_EMERGENCY` |
| 130 | 120 | `BP_LEVEL_2` |
| 179 | 119 | `null` (boundary) |

### G Pregnancy thresholds (`pregnancyThresholdsActive = true`)

| SBP | DBP | Expected | Rule |
|---|---|---|---|
| 160 | 90 | `BP_LEVEL_2` | `RULE_PREGNANCY_L2` |
| 140 | 110 | `BP_LEVEL_2` | `RULE_PREGNANCY_L2` |
| 140 | 85 | `BP_LEVEL_1_HIGH` | `RULE_PREGNANCY_L1_HIGH` |
| 130 | 90 | `BP_LEVEL_1_HIGH` (via DBP axis, Part C gap) | `RULE_PREGNANCY_L1_HIGH` |
| 139 | 85 | `null` (boundary) | — |
| 145 (not pregnant) | 85 | `null` (pregnancy rule inactive) | — |

### H HFrEF (`resolvedHFType = HFREF`)

| SBP | Threshold | Expected | Mode |
|---|---|---|---|
| 90 | default (<85) | `null` | — |
| 84 | default | `BP_LEVEL_1_LOW`, `RULE_HFREF_LOW` | `STANDARD` |
| 160 | default | `BP_LEVEL_1_HIGH`, `RULE_HFREF_HIGH` | `STANDARD` |
| 98 | `sbpLowerTarget=100`, `sbpUpperTarget=130`, ≥7 readings | `BP_LEVEL_1_LOW` | `PERSONALIZED` |
| 84 | UNKNOWN→HFREF bias | `BP_LEVEL_1_LOW` | `STANDARD` |

### I HFpEF

| SBP | Expected |
|---|---|
| 105 | `BP_LEVEL_1_LOW`, `RULE_HFPEF_LOW` (<110) |
| 115 | `null` |
| 160 | `BP_LEVEL_1_HIGH`, `RULE_HFPEF_HIGH` |

### J CAD

| SBP | DBP | Expected |
|---|---|---|
| 140 | 69 | `BP_LEVEL_1_LOW`, `RULE_CAD_DBP_CRITICAL` |
| 140 | 70 | `null` (boundary) |
| 105 | 60 | `RULE_CAD_DBP_CRITICAL` (regardless of SBP) |
| 160 | 85 | `BP_LEVEL_1_HIGH` |

### K HCM

| SBP | Meds | Expected |
|---|---|---|
| 99 | — | `BP_LEVEL_1_LOW`, `RULE_HCM_LOW` (<100) |
| 100 | — | `null` (boundary) |
| 120 | `Nitroglycerin, VASODILATOR_NITRATE` | `TIER_3_INFO`, `RULE_HCM_VASODILATOR` |
| 120 | `Amlodipine, DHP_CCB` | `TIER_3_INFO` |
| 160 | — (Part C gap) | `BP_LEVEL_1_HIGH`, `RULE_HCM_HIGH` |

### L DCM (without HF flag, `resolvedHFType = HFREF` via DCM bias)

| SBP | Expected |
|---|---|
| 84 | `BP_LEVEL_1_LOW`, `RULE_DCM_LOW` |
| 160 | `BP_LEVEL_1_HIGH`, `RULE_DCM_HIGH` |

### M Age-65+ lower override

| Age group | SBP | Expected |
|---|---|---|
| `65+` | 95 | `BP_LEVEL_1_LOW`, `RULE_AGE_65_LOW` (<100) |
| `65+` | 100 | `null` (boundary) |
| `40-64` | 95 | `null` |
| `40-64` | 89 | `BP_LEVEL_1_LOW`, `RULE_STANDARD_L1_LOW` |

### N Standard mode

| SBP | DBP | Expected |
|---|---|---|
| 159 | 95 | `null` (Stage 2 info only — §Q below re. flagging) |
| 160 | 95 | `BP_LEVEL_1_HIGH`, `RULE_STANDARD_L1_HIGH` |
| 140 | 100 | `BP_LEVEL_1_HIGH` (DBP axis) |
| 89 | — | `BP_LEVEL_1_LOW`, `RULE_STANDARD_L1_LOW` |
| 90 | — | `null` (boundary) |

### O Personalized (threshold + `readingCount ≥ 7`)

| Threshold | SBP | Expected |
|---|---|---|
| upper=130 | 150 | `BP_LEVEL_1_HIGH`, `RULE_PERSONALIZED_HIGH`, mode `PERSONALIZED` |
| upper=130 | 149 | `null` (+20 not reached) |
| lower=110 | 108 | `BP_LEVEL_1_LOW`, `RULE_PERSONALIZED_LOW` |
| upper=130, readingCount=3 | 150 | `null` (pre-Day-3 blocks personalization) |

### P.a AFib HR

| Pulse | Expected |
|---|---|
| 115 | `BP_LEVEL_1_HIGH`, `RULE_AFIB_HR_HIGH` (>110) |
| 105 | `null` (AFib uses >110, not tachy >100) |
| 48 | `BP_LEVEL_1_LOW`, `RULE_AFIB_HR_LOW` |

### P.b Tachycardia (via `buildTachyRule(priorElevated)`)

| `priorElevated` | Pulse | Expected |
|---|---|---|
| false | 105 | `null` |
| true | 105 | `BP_LEVEL_1_HIGH`, `RULE_TACHY_HR` |

### P.c Bradycardia

| Pulse | Symptoms | Meds | Expected |
|---|---|---|---|
| 48 | `chestPainOrDyspnea` | — | `RULE_BRADY_HR_SYMPTOMATIC` |
| 38 | none | — | `RULE_BRADY_HR_ASYMPTOMATIC` (<40 regardless) |
| 55 | none | — | `null` |
| 55 | `chestPainOrDyspnea` | `Metoprolol, BETA_BLOCKER` | `null` (BB suppression 50–60) |
| 48 | `chestPainOrDyspnea` | `BETA_BLOCKER` | `RULE_BRADY_HR_SYMPTOMATIC` (below 50 fires) |

### Q Pulse pressure wide

| SBP | DBP | PP | Expected |
|---|---|---|---|
| 170 | 85 | 85 | `TIER_3_INFO`, `RULE_PULSE_PRESSURE_WIDE` |
| 140 | 85 | 55 | `null` |
| 140 | 80 | 60 | `null` (strict >60) |

### R Loop diuretic hypotension

| SBP | Med | Expected |
|---|---|---|
| 92 | `Furosemide, LOOP_DIURETIC` | `TIER_3_INFO`, `RULE_LOOP_DIURETIC_HYPOTENSION` |
| 100 | LOOP_DIURETIC | `null` |
| 88 | LOOP_DIURETIC | `null` (delegates to standard L1 Low) |

### Part C gap-closure scenarios

| Case | Input | Expected |
|---|---|---|
| Zestoretic combo | `isPregnant=true`, med `Zestoretic, OTHER_UNVERIFIED, combo=[ACE_INHIBITOR, THIAZIDE]` | `TIER_1_CONTRAINDICATION`, drugName=Zestoretic |
| Helper: primary match | `[Diltiazem, NDHP_CCB]`, target `NDHP_CCB` | returns Diltiazem |
| Helper: combo match | `[Entresto, ARNI, combo=[ARNI,ARB]]`, target `ARB` | returns Entresto |
| Helper: no match | `[Atorvastatin, STATIN]`, target `NDHP_CCB` | `null` |
| Pregnancy DBP-only | `isPregnant=true`, SBP 130, DBP 90 | `RULE_PREGNANCY_L1_HIGH` |
| Pregnancy ruqPain only | `isPregnant=true`, `ruqPain=true` | `BP_LEVEL_2_SYMPTOM_OVERRIDE`, metadata contains "RUQ" |
| HCM plain upper | `hasHCM=true`, SBP 160, no meds | `RULE_HCM_HIGH` |
| BB+AFib HR 115 | `hasAFib=true`, BB, pulse 115 | `RULE_AFIB_HR_HIGH` (suppression is 50–60 only) |
| BB+AFib HR 55 | `hasAFib=true`, BB, pulse 55 | `null` (not <50 or >110) |
| Unverified BB HR 55 + symptoms | `hasBradycardia=true`, BB `UNVERIFIED`, pulse 55, chestPain | `null` (still suppressed) |

---

## File 5 — AlertEngine orchestrator (25 tests)

Path: [backend/src/daily_journal/services/alert-engine.service.spec.ts](backend/src/daily_journal/services/alert-engine.service.spec.ts)

Mocks: `PrismaService`, `EventEmitter2`, `ProfileResolverService`, `SessionAveragerService`, `OutputGeneratorService`. Default upsert return `{ id: "alert-1", escalated: false }`.

### Short-circuit order

| Case | Session | Context | Expected `ruleId` |
|---|---|---|---|
| Pregnancy + ACE beats emergency | 195/130 | `isPregnant=true`, ACE | `RULE_PREGNANCY_ACE_ARB` |
| Both Tier 1 pairs present | defaults | pregnant + ACE + HFREF + NDHP | `RULE_PREGNANCY_ACE_ARB` (first match wins) |

### AFib ≥3-reading gate

| Case | Session | Profile | Other input | Expected |
|---|---|---|---|---|
| AFib + 1 reading + HR 115 | pulse 115, readingCount 1 | `hasAFib=true` | — | `null`, no upsert |
| AFib + 3 readings + HR 115 | pulse 115, readingCount 3 | `hasAFib=true` | — | `RULE_AFIB_HR_HIGH` |
| AFib + 1 reading + pregnant + ACE | readingCount 1 | `hasAFib + isPregnant = true` | ACE med | `RULE_PREGNANCY_ACE_ARB` (gate does NOT block contraindications) |
| AFib + 1 reading + severeHeadache | readingCount 1, `severeHeadache=true` | `hasAFib=true` | — | `BP_LEVEL_2_SYMPTOM_OVERRIDE` |

### Persistence

| Case | Session | Context | Expected upsert | Expected emit |
|---|---|---|---|---|
| Tier 1 persistence | default | pregnant + ACE | `tier=TIER_1_CONTRAINDICATION`, `ruleId=RULE_PREGNANCY_ACE_ARB`, `dismissible=false`, `patientMessage=PATIENT:RULE_PREGNANCY_ACE_ARB` | `ANOMALY_TRACKED` with `userId=user-1` |
| BP L1 High dismissible | 165/95 | default | `tier=BP_LEVEL_1_HIGH`, `dismissible=true` | — |
| Benign reading | 125/78 | default | upsert not called | `updateMany` called with `status: RESOLVED` |
| No PatientProfile | default | resolver throws `ProfileNotFoundException` | not called | — |

### Physician annotations

| Case | Session | Expected physicianMessage contains |
|---|---|---|
| L1 High + wide PP | 170/85 (PP 85) | `"pulse pressure"` |

### Bug 1 — `ANOMALY_TRACKED` alertId

| Case | Upsert returns | Session | Expected event payload |
|---|---|---|---|
| Alert id propagation | `{id: "deviation-alert-99"}` | 165/95 | `alertId = "deviation-alert-99"` (not `entryId`) |
| Escalated propagation | `{id: "a-1", escalated: true}` | 165/95 | `escalated = true` |

### Bug 2 — `resolveOpenAlerts` scope

| Case | Session | Expected `updateMany` where |
|---|---|---|
| Benign reading | 125/78 | `tier: { in: ["BP_LEVEL_1_HIGH", "BP_LEVEL_1_LOW"] }` (Tier 1 + BP L2 preserved) |

### Bug 4 — tachy consecutive

| Case | Prior `findFirst` returns | Session pulse | Expected |
|---|---|---|---|
| Prior normal | `{pulse: 80}` | 105 | `null` (tachy doesn't fire) |
| Prior elevated | `{pulse: 102}` | 105 | `RULE_TACHY_HR` |
| Prior null pulse | `{pulse: null}` | 105 | `null` |
| Query shape | any | 105 | where clause omits `pulse`, `orderBy: { measuredAt: 'desc' }` |

### DeviationAlert row shape

| Case | Session | Expected field |
|---|---|---|
| BP Level 2 | 185/100 | `dismissible = false` |
| Tier 3 wide PP | 145/80 (PP 65) | `tier = TIER_3_INFO`, `dismissible = true` |
| PP cached | 170/85 (PP 85) | `pulsePressure = 85` on the row |
| Legacy cols | 165/95 | `type = SYSTOLIC_BP`, `severity = MEDIUM` |
| Upsert idempotency | 165/95 called twice | both calls use `where.journalEntryId_type = {journalEntryId: "entry-1", type: "SYSTOLIC_BP"}` |
| Session-averaged emergency | mean 180/95, readingCount 2 | `RULE_ABSOLUTE_EMERGENCY`, `BP_LEVEL_2` |

---

## File 6 — OutputGenerator (11 tests)

Path: [backend/src/daily_journal/services/output-generator.service.spec.ts](backend/src/daily_journal/services/output-generator.service.spec.ts)

Default mock alert: `ruleId=RULE_STANDARD_L1_HIGH`, session 150/92 pulse 78, `pulsePressure=58`.

### Registry completeness T.1

| Case | Input | Expected |
|---|---|---|
| All rule ids covered | iterate `ALL_RULE_IDS` | every entry has `patientMessage`, `caregiverMessage`, `physicianMessage` functions |
| Missing entry throws | delete `RULE_STANDARD_L1_HIGH` from registry | `onModuleInit()` throws `/missing entries/` |

### Substitution + tone T.2–T.5

| Case | Input | Expected output |
|---|---|---|
| Standard L1 High substitution | BP 150/92 | patient message contains `"150/92"` |
| Pregnancy+ACE warm tone | `ruleId=RULE_PREGNANCY_ACE_ARB`, drugName Lisinopril | patient message does NOT contain `"teratogenic"`; contains `"blood pressure medicine"` |
| Pregnancy+ACE clinical | same | physician message contains `"teratogenic"` AND `"Lisinopril"` |
| BP L2 911 CTA | `ruleId=RULE_ABSOLUTE_EMERGENCY`, 185/115 | patient message matches `/911/` |
| Physician-only empty | `ruleId=RULE_PULSE_PRESSURE_WIDE`, 170/85 | `patientMessage === ""` AND `caregiverMessage === ""`, physician message contains `"pulse pressure"` |
| Pre-Day-3 disclaimer | default + `preDay3 = true` | patient message matches `/personalization begins after Day 3/i` |
| Suboptimal suffix | `suboptimalMeasurement = true` | patient message contains `"retake"` |
| Wide PP annotation rides | `metadata.physicianAnnotations = ["Wide pulse pressure: 85 mmHg (>60)."]` | physician message contains `"pulse pressure"` |
| Loop annotation rides | `metadata.physicianAnnotations = ["Patient on loop diuretic..."]` | physician message contains `"loop diuretic"` |

---

## Appendix — Seed archetype mapping

The phase/19 seed populates 5 demo patients. Each archetype's first trigger-reading maps to a specific rule ID the unit tests cover:

| Seed patient | Condition | Meds | Trigger reading | Expected ruleId |
|---|---|---|---|---|
| Priya Menon | Pregnant (+preeclampsia history) | Lisinopril (ACE) | any | `RULE_PREGNANCY_ACE_ARB` |
| James Okafor | HFrEF | Diltiazem (NDHP) + Carvedilol (BB) | any | `RULE_NDHP_HFREF` |
| Rita Washington | CAD | Amlodipine + Metoprolol + Atorvastatin | DBP 68 | `RULE_CAD_DBP_CRITICAL` |
| Charles Brown | AFib | Apixaban + Metoprolol | pulse 115 avg (3 readings) | `RULE_AFIB_HR_HIGH` |
| Aisha Johnson | Controlled HTN | Lisinopril + Amlodipine | normal readings | `null` (no alert) |

---

## How to run

From `backend/` on Windows cmd:

```cmd
node --experimental-vm-modules ..\node_modules\jest\bin\jest.js "profile-resolver|engine|alert-engine|session-averager|output-generator"
```

Expected: **Tests: 182 passed, 182 total** in ~8 seconds.
