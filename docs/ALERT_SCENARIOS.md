# Alert Scenarios

End-to-end coverage of the rule engine: **63 scenarios**, one per Jest case in [alert-engine.scenarios.spec.ts](../backend/src/daily_journal/services/alert-engine.scenarios.spec.ts).

Every scenario is **self-contained for QA**: inputs (all non-default parameters), expected positive outcome (tier, ruleId, message contents), negative case (single input tweak that flips it), and a verification query. A QA engineer should be able to reproduce any scenario against the live backend from this doc alone, without opening the spec file.

**Automated coverage:**
```cmd
cd backend
node --experimental-vm-modules ..\node_modules\jest\bin\jest.js alert-engine.scenarios
```
Expected: `Tests: 63 passed, 63 total`.

---

## Contents

- [Default fixture (applied unless overridden)](#default-fixture-applied-unless-overridden)
- [How to run a scenario against the live backend](#how-to-run-a-scenario-against-the-live-backend)
- [Index](#index)
- [Tier 1 — Contraindications (non-dismissable, same-day provider action)](#tier-1--contraindications-non-dismissable-same-day-provider-action)
- [BP Level 2 — Emergency (non-dismissable, patient sees 911 CTA)](#bp-level-2--emergency-non-dismissable-patient-sees-911-cta)
- [Symptom overrides — BP Level 2 at any BP](#symptom-overrides--bp-level-2-at-any-bp)
- [BP Level 1 — High (dismissable, same-day provider review)](#bp-level-1--high-dismissable-same-day-provider-review)
- [BP Level 1 — Low (dismissable)](#bp-level-1--low-dismissable)
- [Tier 3 — Physician-only (no patient-facing message)](#tier-3--physician-only-no-patient-facing-message)
- [Tier 2 — Medication adherence (dismissable, independent pipeline pass)](#tier-2--medication-adherence-dismissable-independent-pipeline-pass)
- [No alert (gates, benign readings, boundaries)](#no-alert-gates-benign-readings-boundaries)
- [Seed archetype mapping](#seed-archetype-mapping)
- [Related spec files](#related-spec-files)

---

## Default fixture (applied unless overridden)

Mirrors the `buildSession()` / `buildCtx()` / `buildMed()` helpers at the top of the spec. Any input the scenario does not mention uses these values.

### Session (the incoming reading)
| Field | Value |
|---|---|
| `entryId` | `'entry-1'` |
| `userId` | `'user-1'` |
| `measuredAt` | `2026-04-22T10:00:00Z` |
| `systolicBP` | 125 |
| `diastolicBP` | 78 |
| `pulse` | 72 |
| `readingCount` (session) | 1 |
| `symptoms` (all typed flags) | `false` |
| `symptoms.otherSymptoms` | `[]` |
| `suboptimalMeasurement` | `false` |
| `sessionId` | `null` |
| `medicationTaken` | `null` (not asked) |
| `missedMedications` | `[]` |

### ResolvedContext (from ProfileResolver)
| Field | Value |
|---|---|
| `userId` | `'user-1'` |
| `dateOfBirth` | `1980-06-15` → `ageGroup='40-64'` |
| `timezone` | `'America/New_York'` |
| `profile.gender` | `'FEMALE'` |
| `profile.heightCm` | `165` |
| `profile.isPregnant` | `false` |
| `profile.pregnancyDueDate` | `null` |
| `profile.historyPreeclampsia` | `false` |
| `profile.hasHeartFailure` | `false` |
| `profile.heartFailureType` | `'NOT_APPLICABLE'` |
| `profile.resolvedHFType` | `'NOT_APPLICABLE'` |
| `profile.hasAFib` / `hasCAD` / `hasHCM` / `hasDCM` / `hasTachycardia` / `hasBradycardia` | `false` |
| `profile.diagnosedHypertension` | `false` |
| `profile.verificationStatus` | `'VERIFIED'` |
| `contextMeds` | `[]` |
| `excludedMeds` | `[]` |
| `threshold` | `null` |
| `assignment` | `null` |
| `readingCount` (history) | `10` (→ `preDay3Mode=false`) |
| `personalizedEligible` | `false` (threshold null) |
| `pregnancyThresholdsActive` | `false` (not pregnant) |
| `triggerPregnancyContraindicationCheck` | `false` |

### Persistence state (Prisma mocks)
| Table | Default return |
|---|---|
| `DeviationAlert.findFirst` | `null` (no existing alert for this entry) |
| `DeviationAlert.create` | echoes `args.data` with `id='alert-fixture-id'`, `escalated=false` |
| `DeviationAlert.updateMany` | `{ count: 0 }` |
| `JournalEntry.findFirst` (prior reading) | `null` (no prior reading exists) |

### Default medication shape (when a scenario adds a med)
| Field | Value |
|---|---|
| `id` | `'med-1'` |
| `drugName` | `'Lisinopril'` |
| `drugClass` | `'ACE_INHIBITOR'` |
| `isCombination` | `false` |
| `combinationComponents` | `[]` |
| `frequency` | `'ONCE_DAILY'` |
| `source` | `'PATIENT_SELF_REPORT'` |
| `verificationStatus` | `'VERIFIED'` |
| `reportedAt` | ~10 years ago |

---

## How to run a scenario against the live backend

All scenarios run the same three-step loop. Per-scenario sections list only the scenario-specific values.

1. **Seed the user** — ensure a `User` + `PatientProfile` exist with the fields from the scenario's `Inputs` table. Profile verification defaults to `VERIFIED`; override if the scenario says so.
2. **Post the reading** — `POST /daily-journal/entries` with the reading + symptom + checklist values from the scenario.
3. **Query the alert row** — run the SQL below and confirm the row shape matches the scenario's `Expected DeviationAlert row`.

### Standard QA verification query

```sql
SELECT tier, "ruleId", dismissible, mode, severity, type,
       "pulsePressure", "suboptimalMeasurement",
       "patientMessage", "caregiverMessage", "physicianMessage",
       status, "createdAt"
FROM "DeviationAlert"
WHERE "userId" = '<seed-user-id>'
ORDER BY "createdAt" DESC
LIMIT 1;
```

**For "no alert" scenarios:** expect either no new row or (if a prior BP L1 row existed) `status='RESOLVED'` on it.

**Per-scenario assertions** below list only the fields where the scenario diverges from trivial defaults — everything else follows the shared shape (`status='OPEN'`, `createdAt=now()`, etc.).

---

## Index

Quick scan by rule ID. Scenarios are ordered by spec file.

| # | Rule | One-line intent | Negative trigger |
|---|---|---|---|
| 1 | `RULE_PREGNANCY_ACE_ARB` | Pregnancy + ACE → Tier 1 | Flip `isPregnant=false` |
| 2 | `RULE_NDHP_HFREF` | HFrEF + NDHP-CCB → Tier 1 | Switch `heartFailureType` to `HFPEF` |
| 3 | `RULE_PREGNANCY_ACE_ARB` (safety net) | Unverified ACE + pregnant still fires | Drop `isPregnant` → UNVERIFIED filter holds |
| 4 | `RULE_ABSOLUTE_EMERGENCY` | 190/105 → BP L2 | Drop SBP to 179/85 → no emergency |
| 5 | `RULE_SYMPTOM_OVERRIDE_GENERAL` | severeHeadache at 122/76 → L2 | Move symptom to `otherSymptoms` free-text |
| 6 | `RULE_PREGNANCY_L2` | Pregnant + 165/112 → L2 | DBP 104 → falls back to `RULE_PREGNANCY_L1_HIGH` |
| 7 | `RULE_PREGNANCY_L1_HIGH` | Pregnant + 144/88 → L1 High | Drop `isPregnant` → 144/88 < standard cutoff → null |
| 8 | `RULE_CAD_DBP_CRITICAL` | CAD + 132/68 → L1 Low (DBP axis) | DBP 70 (boundary) → strict `<70` fails |
| 9 | `RULE_AFIB_HR_HIGH` | AFib + 3 readings + HR 115 → L1 High | `readingCount=2` (session) → AFib gate closes |
| 10 | `RULE_HFPEF_LOW` | HFpEF + 106/70 → L1 Low | SBP 110 → strict `<110` fails |
| 11 | `RULE_AGE_65_LOW` | Age 65+ + 96/58 → L1 Low | Age bucket `40-64` → SBP 96 ≥ 90 → null |
| 12 | `RULE_PERSONALIZED_HIGH` | Diagnosed HTN + threshold + 152/88 → L1 High `PERSONALIZED` | `readingCount=6` → pre-Day-3 blocks personalization |
| 13 | `RULE_STANDARD_L1_HIGH` (pre-Day-3) | 3 readings + threshold + 165/94 → STANDARD + disclaimer | `readingCount=12` → `PERSONALIZED` mode |
| 14 | `RULE_HCM_VASODILATOR` | HCM + Amlodipine → Tier 3 | Drop `hasHCM` → null |
| 15 | `RULE_STANDARD_L1_HIGH` + wide-PP | 172/88 → L1 High + PP annotation in physician msg | DBP 95 → PP 77 still wide but SBP 172-95=77 passes |
| 16 | no alert | Controlled 124/78 → resolves open L1 | SBP 162/95 → `RULE_STANDARD_L1_HIGH` fires |
| 17 | no alert | AFib + 1 reading + pulse 118 → gate closed | `readingCount=3` → `RULE_AFIB_HR_HIGH` |
| 18 | `RULE_PREGNANCY_ACE_ARB` | Pregnant + AFib + 1 reading + UNVERIFIED ACE → fires | Drop `isPregnant` → AFib gate blocks |
| 19 | no alert | Brady + BB + pulse 55 → BB suppression | Pulse 48 → below window → rule fires |
| 20 | `RULE_STANDARD_L1_HIGH` + retake | Suboptimal + 164/96 → retake suffix | `suboptimalMeasurement=false` → suffix absent |
| 21 | `RULE_ABSOLUTE_EMERGENCY` | Session-averaged 175+185 → mean 180/95 | `readingCount=1` + single 175 → null |
| 22 | `RULE_SYMPTOM_OVERRIDE_PREGNANCY` | Pregnant + ruqPain → L2 (pregnancy) | Drop `isPregnant` → RUQ not a general trigger |
| 23 | `RULE_HFREF_LOW` | HFrEF + 82/55 → L1 Low | SBP 85 → strict `<85` fails |
| 24 | `RULE_HFREF_HIGH` | HFrEF + 162/88 → L1 High | Switch to HFPEF → `RULE_HFPEF_HIGH` |
| 25 | `RULE_HFPEF_HIGH` | HFpEF + 162/88 → L1 High | Switch to HFrEF → `RULE_HFREF_HIGH` |
| 26 | `RULE_CAD_HIGH` | CAD + 162/82 → L1 High | DBP 68 → `RULE_CAD_DBP_CRITICAL` wins |
| 27 | `RULE_HCM_LOW` | HCM + 98/64 → L1 Low | SBP 100 → strict `<100` fails |
| 28 | `RULE_HCM_HIGH` | HCM + 162/88 → L1 High | Add DHP-CCB → `RULE_HCM_VASODILATOR` short-circuits |
| 29 | `RULE_DCM_LOW` | DCM-only + 82/55 → L1 Low | Drop `hasDCM` → falls to standard L1 Low |
| 30 | `RULE_DCM_HIGH` | DCM-only + 162/88 → L1 High | Drop `hasDCM` → `RULE_STANDARD_L1_HIGH` |
| 31 | `RULE_PERSONALIZED_LOW` | Threshold lower=110 + SBP 108 → L1 Low `PERSONALIZED` | `readingCount=6` → pre-Day-3 blocks |
| 32 | `RULE_STANDARD_L1_LOW` | Age 45 + SBP 88 → L1 Low | SBP 90 → strict `<90` fails |
| 33 | `RULE_AFIB_HR_LOW` | AFib + 3 readings + pulse 48 → L1 Low | `readingCount=2` → AFib gate closes |
| 34 | `RULE_TACHY_HR` | Tachy + pulse 105 + prior 102 → L1 High | Prior pulse 80 → consecutive gate closes |
| 35 | `RULE_SYMPTOM_OVERRIDE_GENERAL` | Brady + pulse 48 + chestPain → L2 wins | Precedence inverted → Brady symptomatic fires |
| 36 | `RULE_BRADY_HR_ASYMPTOMATIC` | Brady + pulse 38 (no symptoms, no meds) → L1 Low | Add BB + raise pulse to 55 → suppression window |
| 37 | `RULE_PULSE_PRESSURE_WIDE` | 145/80 (PP 65) → Tier 3 | DBP 85 (PP 60) → strict `>60` fails |
| 38 | `RULE_LOOP_DIURETIC_HYPOTENSION` | Loop diuretic + SBP 92 → Tier 3 | SBP 95 → strict `<95` fails |
| 39 | `RULE_SYMPTOM_OVERRIDE_GENERAL` | visualChanges at 125/75 → L2 | Flag unset |
| 40 | `RULE_SYMPTOM_OVERRIDE_GENERAL` | alteredMentalStatus at 125/75 → L2 | Flag unset |
| 41 | `RULE_SYMPTOM_OVERRIDE_GENERAL` | chestPainOrDyspnea at 125/75 → L2 | Flag unset |
| 42 | `RULE_SYMPTOM_OVERRIDE_GENERAL` | focalNeuroDeficit at 125/75 → L2 | Flag unset |
| 43 | `RULE_SYMPTOM_OVERRIDE_GENERAL` | severeEpigastricPain at 125/75 → L2 | Flag unset |
| 44 | `RULE_SYMPTOM_OVERRIDE_PREGNANCY` | Pregnant + newOnsetHeadache → L2 | Drop `isPregnant` → general override doesn't list this flag |
| 45 | `RULE_SYMPTOM_OVERRIDE_PREGNANCY` | Pregnant + edema at 110/70 → L2 | Drop `isPregnant` → edema not a general trigger |
| 46 | `RULE_PREGNANCY_ACE_ARB` | Pregnant + Entresto (ARNI+ARB combo) → Tier 1 | Drop `ARB` from `combinationComponents` |
| 47 | `RULE_PREGNANCY_ACE_ARB` | Pregnant + Zestoretic (ACE+THIAZIDE combo) → Tier 1 | Drop `ACE_INHIBITOR` from `combinationComponents` |
| 48 | `RULE_NDHP_HFREF` | HF type UNKNOWN + Diltiazem → Tier 1 (via HFREF bias) | Resolver keeps `resolvedHFType=UNKNOWN` |
| 49 | `RULE_NDHP_HFREF` | DCM-only + Diltiazem → Tier 1 (via HFREF bias) | Drop `hasDCM` → no bias |
| 50 | `RULE_PREGNANCY_ACE_ARB` | Pregnant + HFrEF + ACE + NDHP → pregnancy wins | Precedence inverted → `RULE_NDHP_HFREF` |
| 51 | `RULE_PREGNANCY_ACE_ARB` | Pregnant + ACE + 195/130 → Tier 1 beats emergency | Tier 1 eval after BP L2 → `RULE_PREGNANCY_L2` |
| 52 | `RULE_STANDARD_L1_HIGH` | Standard SBP=160 boundary (fires) | SBP 159 → null |
| 53 | no alert | CAD + DBP=70 boundary (does not fire) | DBP 69 → `RULE_CAD_DBP_CRITICAL` |
| 54 | no alert | Standard SBP=90 boundary (does not fire) | SBP 89 → `RULE_STANDARD_L1_LOW` |
| 55 | no alert | Age 65+ + SBP=100 boundary (does not fire) | SBP 99 → `RULE_AGE_65_LOW` |
| 56 | `RULE_STANDARD_L1_HIGH` | AFib + 3 readings + 165/92 + pulse 75 → AFib still gets BP alerts | SBP drops to 159 + pulse normal → null |
| 57 | no alert | Admin user (resolver throws `ProfileNotFoundException`) | PatientProfile exists → engine runs |
| 58 | `RULE_PREGNANCY_ACE_ARB` | Pregnant + Losartan (ARB standalone) → Tier 1 | Switch drugClass to DHP_CCB → null |
| 59 | `RULE_BRADY_HR_ASYMPTOMATIC` | Brady + BB + pulse 38 → fires (BB suppresses 50–60 only) | Raise pulse to 55 → BB suppression silences |
| 60 | `RULE_MEDICATION_MISSED` | `medicationTaken=false` (no per-med) → Tier 2 | `medicationTaken=true` + empty `missedMedications` → null |
| 61 | `RULE_MEDICATION_MISSED` | Per-medication miss (Lisinopril FORGOT) → physician msg names drug + reason | Empty `missedMedications` array → falls back to generic wording |
| 62 | `RULE_STANDARD_L1_HIGH` + `RULE_MEDICATION_MISSED` | BP L1 High + `medicationTaken=false` → TWO rows | Flip `medicationTaken=true` → only BP row fires |
| 63 | no alert | `medicationTaken=true` + empty array → no adherence + no BP → resolve-sweep scoped to BP L1 | Drop `medicationTaken=false` → adherence fires |

---

## Tier 1 — Contraindications (non-dismissable, same-day provider action)

### Scenario 1 — Pregnancy + Lisinopril (ACE inhibitor)

**Intent:** Confirm Tier 1 fires when a pregnant patient is on an ACE inhibitor. Clinical: ACE/ARB teratogenicity, Dr. Singal §V-A-1.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `isPregnant` | `true` |
| Context | `profile.historyPreeclampsia` | `true` |
| Meds | `contextMeds[0]` | Lisinopril · `drugClass=ACE_INHIBITOR` · `verificationStatus=VERIFIED` |
| Reading | BP | 130/82 |
| Reading | pulse | 78 |

**Expected DeviationAlert row**
- `tier=TIER_1_CONTRAINDICATION` · `ruleId=RULE_PREGNANCY_ACE_ARB` · `dismissible=false` · `severity=HIGH` · `type=MEDICATION_ADHERENCE` · `pulsePressure=null`
- `patientMessage` contains `"blood pressure medicine"` + `"pregnant"` (warm tone, no "teratogenic")
- `physicianMessage` contains `"Teratogenic"` + `"Lisinopril"`
- Emits `JOURNAL_EVENTS.ALERT_CREATED` with `alertId="alert-fixture-id"`

**Negative case** — Flip `isPregnant=false` → rule dormant → no `DeviationAlert` row.

---

### Scenario 2 — HFrEF + Diltiazem (NDHP-CCB)

**Intent:** Confirm Tier 1 fires when an HFrEF patient is on a non-dihydropyridine CCB. Clinical: NDHP-CCBs are negatively inotropic, contraindicated in HFrEF. Per Dr. Singal §V-A-2.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.hasHeartFailure` | `true` |
| Context | `profile.heartFailureType` | `'HFREF'` |
| Context | `profile.resolvedHFType` | `'HFREF'` |
| Context | `threshold` | SBP 85-130, no DBP/HR targets, set by `prov-1` |
| Meds | `contextMeds[0]` | Diltiazem · `drugClass=NDHP_CCB` |
| Meds | `contextMeds[1]` | Carvedilol · `drugClass=BETA_BLOCKER` · `id=med-2` |
| Reading | BP | 118/74 |
| Reading | pulse | 68 |

**Expected DeviationAlert row**
- `tier=TIER_1_CONTRAINDICATION` · `ruleId=RULE_NDHP_HFREF` · `dismissible=false`
- `patientMessage` contains `"heart medicines"`
- `physicianMessage` contains `"Nondihydropyridine CCB"` + `"Diltiazem"` + `"HFrEF"`

**Negative case** — Switch `heartFailureType`/`resolvedHFType` to `'HFPEF'` → rule is HFrEF-specific → null.

---

### Scenario 3 — Pregnant + UNVERIFIED ACE + UNVERIFIED profile (safety net)

**Intent:** Confirm the pregnancy safety-net: when a pregnant patient's profile is unverified AND their ACE medication is unverified, the Tier 1 contraindication still fires because `triggerPregnancyContraindicationCheck` forces the engine to consider unverified meds.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `isPregnant` | `true` |
| Context | `profile.verificationStatus` | `'UNVERIFIED'` |
| Context | `triggerPregnancyContraindicationCheck` | `true` (derived from `isPregnant`) |
| Meds | `contextMeds[0]` | Lisinopril · `verificationStatus=UNVERIFIED` |
| Reading | BP | 122/78 |

**Expected DeviationAlert row**
- `tier=TIER_1_CONTRAINDICATION` · `ruleId=RULE_PREGNANCY_ACE_ARB`

**Negative case** — Drop `isPregnant=false` → `triggerPregnancyContraindicationCheck=false` → UNVERIFIED med stays filtered from the rule evaluation → null.

---

### Scenario 18 — Pregnant + AFib + 1 reading + UNVERIFIED ACE (AFib gate does not block Tier 1)

**Intent:** AFib patients normally need ≥3 readings before HR alerts evaluate. This scenario asserts that the AFib gate does NOT block Tier 1 contraindications, which are always non-dismissable and time-critical.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `isPregnant` | `true` |
| Context | `profile.hasAFib` | `true` |
| Context | `profile.verificationStatus` | `'UNVERIFIED'` |
| Meds | `contextMeds[0]` | Lisinopril · `verificationStatus=UNVERIFIED` |
| Reading | BP | 128/80, pulse 96 |
| Reading | `readingCount` (session) | `1` |

**Expected DeviationAlert row**
- `tier=TIER_1_CONTRAINDICATION` · `ruleId=RULE_PREGNANCY_ACE_ARB`

**Negative case** — Drop `isPregnant=false` → AFib + `readingCount=1` closes the pipeline gate → null.

---

### Scenario 46 — Pregnant + Entresto (ARNI + ARB combination)

**Intent:** Validate combination-drug detection. Entresto primary class is `ARNI`, but its `combinationComponents=['ARNI','ARB']`. The pregnancy rule should detect the ARB component and fire.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `isPregnant` | `true` |
| Meds | `contextMeds[0]` | Entresto · `drugClass=ARNI` · `isCombination=true` · `combinationComponents=['ARNI','ARB']` |
| Reading | BP | 128/80 |

**Expected DeviationAlert row**
- `tier=TIER_1_CONTRAINDICATION` · `ruleId=RULE_PREGNANCY_ACE_ARB`
- `physicianMessage` contains `"Entresto"`

**Negative case** — Drop `'ARB'` from `combinationComponents` → primary class `ARNI` is not matched by the rule → null.

---

### Scenario 47 — Pregnant + Zestoretic (ACE + THIAZIDE combination)

**Intent:** Same as #46 but with `OTHER_UNVERIFIED` primary class — the combination component drives detection.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `isPregnant` | `true` |
| Meds | `contextMeds[0]` | Zestoretic · `drugClass=OTHER_UNVERIFIED` · `isCombination=true` · `combinationComponents=['ACE_INHIBITOR','THIAZIDE']` |
| Reading | BP | 128/80 |

**Expected DeviationAlert row**
- `tier=TIER_1_CONTRAINDICATION` · `ruleId=RULE_PREGNANCY_ACE_ARB`
- `physicianMessage` contains `"Zestoretic"`

**Negative case** — Drop `'ACE_INHIBITOR'` from `combinationComponents` → rule sees only THIAZIDE (not contraindicated) → null.

---

### Scenario 48 — HF type UNKNOWN + Diltiazem (safety-net HFREF bias)

**Intent:** When a patient declares heart failure but doesn't specify the type, `ProfileResolver` biases `resolvedHFType` to `HFREF` as a safety net (HFrEF is the higher-risk case for NDHP-CCB contraindication).

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.hasHeartFailure` | `true` |
| Context | `profile.heartFailureType` | `'UNKNOWN'` |
| Context | `profile.resolvedHFType` | `'HFREF'` (biased) |
| Meds | `contextMeds[0]` | Diltiazem · `drugClass=NDHP_CCB` |
| Reading | BP | 120/74 |

**Expected DeviationAlert row**
- `tier=TIER_1_CONTRAINDICATION` · `ruleId=RULE_NDHP_HFREF`

**Negative case** — Resolver leaves `resolvedHFType='UNKNOWN'` → rule needs `'HFREF'` → null.

---

### Scenario 49 — DCM only + Diltiazem (DCM → HFREF bias)

**Intent:** DCM (dilated cardiomyopathy) implies systolic dysfunction; `ProfileResolver` biases `resolvedHFType` to `HFREF` even when `hasHeartFailure=false`. Per Dr. Singal §4.8.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.hasHeartFailure` | `false` |
| Context | `profile.hasDCM` | `true` |
| Context | `profile.resolvedHFType` | `'HFREF'` (biased) |
| Meds | `contextMeds[0]` | Diltiazem · `drugClass=NDHP_CCB` |
| Reading | BP | 120/74 |

**Expected DeviationAlert row**
- `ruleId=RULE_NDHP_HFREF`

**Negative case** — Drop `hasDCM=false` → no HF bias → `resolvedHFType='NOT_APPLICABLE'` → null.

---

### Scenario 50 — Both Tier 1 pairs present (pregnancy + ACE wins)

**Intent:** Precedence: when both pregnancy-ACE and NDHP-HFrEF contraindications would apply, the pregnancy rule short-circuits first. Clinically: pregnancy is the immediate teratogenicity concern.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `isPregnant` | `true` |
| Context | `profile.hasHeartFailure` | `true` · `heartFailureType='HFREF'` · `resolvedHFType='HFREF'` |
| Meds | `contextMeds[0]` | Lisinopril · `drugClass=ACE_INHIBITOR` |
| Meds | `contextMeds[1]` | Diltiazem · `drugClass=NDHP_CCB` · `id='med-2'` |
| Reading | BP | 120/76 |

**Expected DeviationAlert row**
- `ruleId=RULE_PREGNANCY_ACE_ARB`
- `physicianMessage` contains `"Lisinopril"` (not Diltiazem)
- `DeviationAlert.create` called exactly once (no second row for NDHP)

**Negative case** — Short-circuit order reversed → `RULE_NDHP_HFREF` fires first → wrong ruleId + wrong drug name in physician message.

---

### Scenario 51 — Pregnant + ACE + BP 195/130 (Tier 1 beats BP Level 2)

**Intent:** Precedence: Tier 1 contraindications short-circuit before BP-level emergencies. Clinically: stopping the teratogenic med is the immediate action; the emergency BP still gets acted on via the patient's provider contact, not via a competing alert row.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `isPregnant` | `true` |
| Meds | `contextMeds[0]` | Lisinopril (default ACE) |
| Reading | BP | 195/130 |

**Expected DeviationAlert row**
- `ruleId=RULE_PREGNANCY_ACE_ARB`
- Exactly one alert row (no BP L2 row for the emergency-range reading)

**Negative case** — Tier 1 evaluated after BP L2 → `RULE_PREGNANCY_L2` or `RULE_ABSOLUTE_EMERGENCY` fires instead.

---

### Scenario 58 — Pregnant + Losartan (ARB standalone)

**Intent:** Confirms the ARB branch of the pregnancy rule. Scenario 1 covers standalone ACE; Scenario 46 covers an ARB inside a combination (Entresto). This adds a plain ARB — the common Losartan prescription — which registered as a separate e2e path from both.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `isPregnant` | `true` |
| Meds | `contextMeds[0]` | Losartan · `drugClass=ARB` · `verificationStatus=VERIFIED` |
| Reading | BP | 128/80, pulse 78 |

**Expected DeviationAlert row**
- `tier=TIER_1_CONTRAINDICATION` · `ruleId=RULE_PREGNANCY_ACE_ARB` · `dismissible=false`
- `physicianMessage` contains `"Losartan"`

**Negative case** — Switch `drugClass` to `'DHP_CCB'` (a safe-in-pregnancy class like Amlodipine) → rule dormant → null.

---

## BP Level 2 — Emergency (non-dismissable, patient sees 911 CTA)

### Scenario 4 — Absolute emergency 190/105

**Intent:** Confirms the absolute-emergency cutoff (SBP ≥180 OR DBP ≥120). Wide pulse pressure rides along on the physician message.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.diagnosedHypertension` | `true` |
| Reading | BP | 190/105, pulse 88 |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_2` · `ruleId=RULE_ABSOLUTE_EMERGENCY` · `dismissible=false` · `pulsePressure=85`
- `patientMessage` contains `"190/105"` + matches `/911/`
- `physicianMessage` contains `"pulse pressure"` (wide-PP annotation at PP 85 > 60)

**Negative case** — Drop SBP to 179 and DBP to 119 → below both cutoffs → no BP L2.

---

### Scenario 6 — Pregnant + 165/112 (pregnancy L2 thresholds)

**Intent:** Pregnancy uses tighter thresholds (L2 fires at SBP ≥160 OR DBP ≥105) per ACOG; no symptoms required.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `isPregnant` | `true` (enables `pregnancyThresholdsActive`) |
| Reading | BP | 165/112, pulse 90 |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_2` · `ruleId=RULE_PREGNANCY_L2`
- `patientMessage` contains `"165/112"` + `"pregnancy"`
- `physicianMessage` contains `"ACOG"`

**Negative case** — DBP 104 → below 105 threshold → falls back to `RULE_PREGNANCY_L1_HIGH`.

---

### Scenario 21 — Session-averaged 175 + 185 → mean 180/95 (BP Level 2)

**Intent:** The engine classifies the AVERAGED session, not individual readings. `SessionAverager` (mocked here) folds two raw readings into a mean; the engine emits one alert on the mean.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.diagnosedHypertension` | `true` |
| Reading | `systolicBP` (mean) | 180 |
| Reading | `diastolicBP` (mean) | 95 |
| Reading | pulse | 80 |
| Reading | `readingCount` (session) | `2` |
| Reading | `sessionId` | `'sess-a'` |

**Expected DeviationAlert row**
- `ruleId=RULE_ABSOLUTE_EMERGENCY` · `tier=BP_LEVEL_2`
- `patientMessage` contains `"180/95"` + matches `/911/`

**Negative case** — `readingCount=1` + `sessionId=null` + single-reading 175 → SBP < 180 → no emergency.

---

## Symptom overrides — BP Level 2 at any BP

### Scenario 5 — severeHeadache at 122/76

**Intent:** Target-organ-damage symptom at any BP fires BP Level 2 symptom override.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.diagnosedHypertension` | `true` |
| Reading | BP | 122/76, pulse 74 |
| Reading | `symptoms.severeHeadache` | `true` |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_2_SYMPTOM_OVERRIDE` · `ruleId=RULE_SYMPTOM_OVERRIDE_GENERAL` · `dismissible=false`
- `patientMessage` contains `"122/76"` + matches `/911/`
- `physicianMessage` contains `"severe headache"`

**Negative case** — Set `severeHeadache=false` and instead pass `otherSymptoms=["severe headache"]` free-text → typed flag is false → rule dormant → null (confirms the rule reads the typed flag, not free-text).

---

### Scenario 22 — Pregnant + ruqPain at 128/82

**Intent:** RUQ pain is a pregnancy-specific L2 trigger (preeclampsia indicator) per ACOG.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `isPregnant` | `true` |
| Reading | BP | 128/82 |
| Reading | `symptoms.ruqPain` | `true` |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_2_SYMPTOM_OVERRIDE` · `ruleId=RULE_SYMPTOM_OVERRIDE_PREGNANCY`
- `physicianMessage` contains `"preeclampsia"`

**Negative case** — Drop `isPregnant=false` → `ruqPain` isn't in the general-symptom override set → null.

---

### Scenario 35 — Brady + pulse 48 + chestPainOrDyspnea (L2 beats brady L1)

**Intent:** Precedence: symptomatic bradycardia would be `RULE_BRADY_HR_SYMPTOMATIC` (BP L1 Low), but chest pain/dyspnea is ALSO a TOD symptom → L2 override fires instead. Clinical safety: higher-urgency tier wins.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.hasBradycardia` | `true` |
| Reading | BP | 118/72 |
| Reading | pulse | 48 |
| Reading | `symptoms.chestPainOrDyspnea` | `true` |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_2_SYMPTOM_OVERRIDE` · `ruleId=RULE_SYMPTOM_OVERRIDE_GENERAL`

**Negative case** — Precedence inverted → `RULE_BRADY_HR_SYMPTOMATIC` fires → L1 Low instead of L2. **Note:** this mirrors a bug 1 regression; never accept a PR that emits the brady rule here.

---

### Scenarios 39-45 — Other symptom triggers

Same structure as #5, one scenario per typed symptom flag.

| # | Pregnant? | Symptom flag | BP | Expected rule | physicianMessage contains | Negative case |
|---|---|---|---|---|---|---|
| 39 | no | `visualChanges=true` | 125/75 | `RULE_SYMPTOM_OVERRIDE_GENERAL` | `"visual changes"` | Flag false → null |
| 40 | no | `alteredMentalStatus=true` | 125/75 | `RULE_SYMPTOM_OVERRIDE_GENERAL` | — | Flag false → null |
| 41 | no | `chestPainOrDyspnea=true` | 125/75 | `RULE_SYMPTOM_OVERRIDE_GENERAL` | `"chest pain or dyspnea"` | Flag false → null |
| 42 | no | `focalNeuroDeficit=true` | 125/75 | `RULE_SYMPTOM_OVERRIDE_GENERAL` | — | Flag false → null |
| 43 | no | `severeEpigastricPain=true` | 125/75 | `RULE_SYMPTOM_OVERRIDE_GENERAL` | — | Flag false → null |
| 44 | yes | `newOnsetHeadache=true` | 125/75 | `RULE_SYMPTOM_OVERRIDE_PREGNANCY` | — | Drop `isPregnant` → `newOnsetHeadache` not in general-override set → null |
| 45 | yes | `edema=true` | 110/70 | `RULE_SYMPTOM_OVERRIDE_PREGNANCY` | — | Drop `isPregnant` → `edema` not in general-override set → null |

All seven fire `tier=BP_LEVEL_2_SYMPTOM_OVERRIDE` with `dismissible=false`. Run each with only that one flag set; every other symptom flag false.

---

## BP Level 1 — High (dismissable, same-day provider review)

### Scenario 7 — Pregnant + 144/88 (pregnancy L1 High)

**Intent:** Pregnancy L1 High threshold (SBP ≥140 OR DBP ≥85) is tighter than standard (SBP ≥160). Per ACOG.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `isPregnant` | `true` |
| Reading | BP | 144/88, pulse 82 |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_1_HIGH` · `ruleId=RULE_PREGNANCY_L1_HIGH` · `dismissible=true`
- `patientMessage` contains `"144/88"`
- `physicianMessage` contains `"preeclampsia"`

**Negative case** — Drop `isPregnant=false` → standard L1 High requires SBP ≥160 → 144/88 below cutoff → null.

---

### Scenario 9 — AFib + 3 readings + HR 115

**Intent:** AFib HR rule fires at pulse >110 once the ≥3-reading gate opens. Scenario confirms the gate + the rule's >110 (not >100) threshold.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.hasAFib` | `true` |
| Meds | `contextMeds[0]` | Metoprolol · `drugClass=BETA_BLOCKER` |
| Reading | BP | 130/76 |
| Reading | pulse | 115 |
| Reading | `readingCount` (session) | `3` |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_1_HIGH` · `ruleId=RULE_AFIB_HR_HIGH`
- `patientMessage` contains `"HR 115 bpm"`
- `physicianMessage` contains `"AFib"`

**Negative case** — `readingCount=2` → AFib <3-reading gate closes → rule skipped → null.

---

### Scenario 12 — Personalized mode + 152/88

**Intent:** Patient has a provider-set threshold (SBP upper 130) AND ≥7 readings → `mode=PERSONALIZED`. Rule fires when SBP ≥ `sbpUpperTarget + 20` (= 150).

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.diagnosedHypertension` | `true` |
| Context | `readingCount` (history) | `12` |
| Context | `threshold.sbpUpperTarget` | `130` |
| Context | `threshold.sbpLowerTarget` | `90` |
| Context | `threshold.setByProviderId` | `'prov-1'` |
| Reading | BP | 152/88, pulse 76 |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_1_HIGH` · `ruleId=RULE_PERSONALIZED_HIGH` · `mode=PERSONALIZED`
- `patientMessage` contains `"target"`
- `physicianMessage` contains `"target + 20"`

**Negative case** — `readingCount=6` → pre-Day-3 blocks personalization → falls back to `RULE_STANDARD_L1_HIGH` but SBP 152 < 160 → null (confirms pre-Day-3 gate defeats personalization).

---

### Scenario 13 — Pre-Day-3 + 165/94 (STANDARD mode + disclaimer)

**Intent:** Even with a provider threshold set, patients with <7 readings get STANDARD thresholds plus a pre-Day-3 disclaimer on the patient message. Per Dr. Singal §personalization-eligibility.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.diagnosedHypertension` | `true` |
| Context | `readingCount` | `3` |
| Context | `preDay3Mode` | `true` (derived from `readingCount < 7`) |
| Context | `threshold.sbpUpperTarget` | `130` (present but inactive) |
| Reading | BP | 165/94, pulse 82 |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_1_HIGH` · `ruleId=RULE_STANDARD_L1_HIGH` · `mode=STANDARD`
- `patientMessage` matches `/personalization begins after Day 3/i`

**Negative case** — `readingCount=12` → pre-Day-3 gate opens → `RULE_PERSONALIZED_HIGH` instead + no disclaimer.

---

### Scenario 15 — Standard L1 High + wide-PP annotation (172/88)

**Intent:** Wide pulse pressure (>60) ALSO annotates an existing L1 High alert's physician message. Patient-facing message stays plain L1 (no PP talk).

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.diagnosedHypertension` | `true` |
| Reading | BP | 172/88 (PP = 84), pulse 78 |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_1_HIGH` · `ruleId=RULE_STANDARD_L1_HIGH` · `pulsePressure=84`
- `physicianMessage` contains `"Wide pulse pressure: 84 mmHg"`
- `patientMessage.toLowerCase()` does NOT contain `"pulse pressure"`

**Negative case** — DBP 115 → PP 57 → PP cutoff (>60) missed → plain L1 High, no annotation.

---

### Scenario 20 — Suboptimal measurement + 164/96 (retake suffix)

**Intent:** If the patient checklist flags a non-ideal measurement (caffeine, not seated, etc.), the alert fires normally but the patient message gets a "retake" suffix.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.diagnosedHypertension` | `true` |
| Reading | BP | 164/96, pulse 78 |
| Reading | `suboptimalMeasurement` | `true` |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_1_HIGH` · `ruleId=RULE_STANDARD_L1_HIGH` · `suboptimalMeasurement=true`
- `patientMessage.toLowerCase()` contains `"retake"`

**Negative case** — `suboptimalMeasurement=false` → identical rule fires but retake suffix absent.

---

### Scenarios 24-30 — Condition-specific BP L1 High

Same structure; each fires a condition-specific high rule at SBP 162.

| # | Condition flags | Reading | Rule | physicianMessage contains | Negative |
|---|---|---|---|---|---|
| 24 | `hasHeartFailure=true`, `heartFailureType='HFREF'`, `resolvedHFType='HFREF'` | 162/88 | `RULE_HFREF_HIGH` | — | Switch to `HFPEF` → `RULE_HFPEF_HIGH` |
| 25 | `hasHeartFailure=true`, `heartFailureType='HFPEF'`, `resolvedHFType='HFPEF'` | 162/88 | `RULE_HFPEF_HIGH` | `"HFpEF"` | Switch to `HFREF` → `RULE_HFREF_HIGH` |
| 26 | `hasCAD=true`, `diagnosedHypertension=true` | 162/82 | `RULE_CAD_HIGH` | — | DBP 68 → `RULE_CAD_DBP_CRITICAL` wins |
| 28 | `hasHCM=true`, no risky meds | 162/88 | `RULE_HCM_HIGH` | — | Add Amlodipine (DHP-CCB) → `RULE_HCM_VASODILATOR` short-circuits |
| 30 | `hasDCM=true`, `hasHeartFailure=false`, `resolvedHFType='HFREF'` | 162/88 | `RULE_DCM_HIGH` | — | Drop `hasDCM` → `RULE_STANDARD_L1_HIGH` |

All emit `tier=BP_LEVEL_1_HIGH`, `dismissible=true`, `mode=STANDARD`.

---

### Scenario 34 — Tachy + pulse 105 + prior elevated (102)

**Intent:** Tachycardia rule requires consecutive elevated readings to prevent single-spike false positives. Asserts the `journalEntry.findFirst` lookup for the prior reading.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.hasTachycardia` | `true` |
| Prisma | `journalEntry.findFirst` returns | `{ pulse: 102 }` |
| Reading | BP | 128/80 |
| Reading | pulse | 105 |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_1_HIGH` · `ruleId=RULE_TACHY_HR`

**Negative case** — Prior `pulse=80` → consecutive-elevation gate closes → null.

---

### Scenario 52 — Boundary: Standard SBP = 160 (fires)

**Intent:** Confirms the `>=160` cutoff inclusive.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Reading | BP | 160/95 |

**Expected DeviationAlert row**
- `ruleId=RULE_STANDARD_L1_HIGH` · `tier=BP_LEVEL_1_HIGH`

**Negative case** — SBP 159 → below strict ≥160 → null.

---

### Scenario 56 — AFib + 3 readings + 165/92 + pulse 75 (AFib still gets BP alerts)

**Intent:** AFib patients are NOT excluded from BP alerts; they only have the HR-side gated to ≥3 readings. Scenario asserts BP side fires normally.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.hasAFib` | `true` |
| Reading | BP | 165/92, pulse 75 |
| Reading | `readingCount` | `3` |

**Expected DeviationAlert row**
- `ruleId=RULE_STANDARD_L1_HIGH` · `tier=BP_LEVEL_1_HIGH`

**Negative case** — SBP drops to 159 with normal pulse 75 → AFib gate passes but no rule fires → null.

---

## BP Level 1 — Low (dismissable)

### Scenario 8 — CAD + 132/68 (DBP critical)

**Intent:** CAD patients have a DBP floor independent of SBP — DBP <70 fires due to J-curve risk. SBP here is normal; rule fires on DBP axis alone.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.hasCAD` | `true` |
| Context | `profile.diagnosedHypertension` | `true` |
| Meds | `contextMeds[0]` | Amlodipine · `drugClass=DHP_CCB` |
| Reading | BP | 132/68, pulse 66 |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_1_LOW` · `ruleId=RULE_CAD_DBP_CRITICAL` · `type=DIASTOLIC_BP`
- `patientMessage` contains `"132/68"` + `"lower number"`
- `physicianMessage` contains `"J-curve"`

**Negative case** — DBP 70 (boundary) → strict `<70` fails → null.

---

### Scenario 10 — HFpEF + 106/70 (HFpEF low)

**Intent:** HFpEF SBP floor (<110) is a condition-specific rule.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.hasHeartFailure=true`, `heartFailureType='HFPEF'`, `resolvedHFType='HFPEF'` | |
| Reading | BP | 106/70, pulse 76 |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_1_LOW` · `ruleId=RULE_HFPEF_LOW`
- `physicianMessage` contains `"HFpEF"`

**Negative case** — SBP 110 → strict `<110` fails → null.

---

### Scenario 11 — Age 65+ + 96/58 (age-override low)

**Intent:** Age ≥65 raises the low-SBP floor from <90 to <100 (fall-risk concern).

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `ageGroup` | `'65+'` |
| Context | `dateOfBirth` | `1953-01-01` |
| Reading | BP | 96/58, pulse 70 |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_1_LOW` · `ruleId=RULE_AGE_65_LOW`
- `patientMessage` contains `"dizziness"` + `"fall risk"`
- `physicianMessage` contains `"age 65+"`

**Negative case** — `ageGroup='40-64'` → age-65 branch skipped → standard low needs SBP <90 → null.

---

### Scenario 23 — HFrEF + 82/55 (HFrEF low)

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.hasHeartFailure=true`, `heartFailureType='HFREF'`, `resolvedHFType='HFREF'` | |
| Reading | BP | 82/55 |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_1_LOW` · `ruleId=RULE_HFREF_LOW`
- `physicianMessage` contains `"HFrEF"`

**Negative case** — SBP 85 → strict `<85` fails → null.

---

### Scenario 27 — HCM + 98/64 (HCM low)

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.hasHCM` | `true` |
| Reading | BP | 98/64 |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_1_LOW` · `ruleId=RULE_HCM_LOW`
- `physicianMessage` contains `"LVOT"`

**Negative case** — SBP 100 → strict `<100` fails → null.

---

### Scenario 29 — DCM only + 82/55 (DCM low)

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.hasDCM=true`, `hasHeartFailure=false`, `resolvedHFType='HFREF'` (biased) | |
| Reading | BP | 82/55 |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_1_LOW` · `ruleId=RULE_DCM_LOW`
- `physicianMessage` contains `"DCM"`

**Negative case** — Drop `hasDCM=false` → no HF bias → `resolvedHFType='NOT_APPLICABLE'` → falls to `RULE_STANDARD_L1_LOW` (SBP <90 still fires here, so row would exist but with different ruleId).

---

### Scenario 31 — Personalized low + SBP 108 (threshold lower=110)

**Intent:** Personalized SBP lower target: rule fires when SBP < `sbpLowerTarget` (= 110).

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.diagnosedHypertension` | `true` |
| Context | `readingCount` | `12` |
| Context | `threshold.sbpLowerTarget` | `110` |
| Context | `threshold.sbpUpperTarget` | `130` |
| Reading | BP | 108/70 |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_1_LOW` · `ruleId=RULE_PERSONALIZED_LOW` · `mode=PERSONALIZED`

**Negative case** — `readingCount=6` → pre-Day-3 blocks → falls to `RULE_STANDARD_L1_LOW` but SBP 108 ≥ 90 → null.

---

### Scenario 32 — Age 45 + SBP 88 (standard low)

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `ageGroup` | `'40-64'` |
| Reading | BP | 88/58 |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_1_LOW` · `ruleId=RULE_STANDARD_L1_LOW`

**Negative case** — SBP 90 (boundary) → strict `<90` fails → null.

---

### Scenario 33 — AFib + 3 readings + pulse 48 (AFib HR low)

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.hasAFib` | `true` |
| Reading | BP | 120/75, pulse 48 |
| Reading | `readingCount` | `3` |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_1_LOW` · `ruleId=RULE_AFIB_HR_LOW`

**Negative case** — `readingCount=2` → AFib gate closes → null.

---

### Scenario 36 — Brady + pulse 38 (asymptomatic)

**Intent:** Bradycardia rule fires at pulse <40 regardless of symptoms or BB suppression (below the suppression window).

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.hasBradycardia` | `true` |
| Reading | BP | 115/70, pulse 38 |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_1_LOW` · `ruleId=RULE_BRADY_HR_ASYMPTOMATIC`
- `physicianMessage` contains `"asymptomatic bradycardia"`

**Negative case** — Add Metoprolol (BB) AND raise pulse to 55 → BB suppression window 50–60 silences the rule → null. (Pulse 38 + BB still fires — see Scenario 59.)

---

### Scenario 59 — Brady + Beta-blocker + pulse 38 (BB suppression is 50–60 only)

**Intent:** Confirms BB suppression window is 50–60 exclusive. Below 50, brady fires even when a beta-blocker is on board. Clinically: <50 bpm on BB still warrants provider review.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.hasBradycardia` | `true` |
| Meds | `contextMeds[0]` | Metoprolol · `drugClass=BETA_BLOCKER` |
| Reading | BP | 118/72, pulse 38 |

**Expected DeviationAlert row**
- `tier=BP_LEVEL_1_LOW` · `ruleId=RULE_BRADY_HR_ASYMPTOMATIC`
- `physicianMessage` contains `"asymptomatic bradycardia"`

**Negative case** — Raise pulse to 55 → within BB suppression window 50–60 → null (matches Scenario 19).

---

## Tier 3 — Physician-only (no patient-facing message)

Tier 3 alerts inform the physician without surfacing to the patient. Expect `patientMessage=""` AND `caregiverMessage=""` on every Tier 3 row.

### Scenario 14 — HCM + Amlodipine (DHP vasodilator)

**Intent:** DHP-CCBs can worsen LVOT gradient in HCM. Physician-level info, not patient-facing.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.hasHCM` | `true` |
| Meds | `contextMeds[0]` | Amlodipine · `drugClass=DHP_CCB` |
| Reading | BP | 128/82, pulse 72 |

**Expected DeviationAlert row**
- `tier=TIER_3_INFO` · `ruleId=RULE_HCM_VASODILATOR` · `dismissible=true`
- `patientMessage=""` AND `caregiverMessage=""`
- `physicianMessage` contains `"HCM"` + `"Amlodipine"` + `"LVOT"`

**Negative case** — Drop `hasHCM=false` → rule dormant → null.

---

### Scenario 37 — Wide pulse pressure standalone (145/80, PP 65)

**Intent:** Wide PP fires Tier 3 on its own when no L1/L2 rule is already carrying an annotation. Typical elderly-patient isolated-systolic-HTN scenario.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Reading | BP | 145/80 (PP = 65), pulse 74 |

**Expected DeviationAlert row**
- `tier=TIER_3_INFO` · `ruleId=RULE_PULSE_PRESSURE_WIDE` · `pulsePressure=65`
- `patientMessage=""`

**Negative case** — DBP 85 (PP 60) → strict `>60` fails → null.

---

### Scenario 38 — Loop diuretic + SBP 92

**Intent:** Loop diuretic with low-normal SBP (<95) warrants physician review for over-diuresis.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Meds | `contextMeds[0]` | Furosemide · `drugClass=LOOP_DIURETIC` |
| Reading | BP | 92/60, pulse 72 |

**Expected DeviationAlert row**
- `tier=TIER_3_INFO` · `ruleId=RULE_LOOP_DIURETIC_HYPOTENSION` · `patientMessage=""`

**Negative case** — SBP 95 → strict `<95` fails → rule delegates to standard L1 Low; SBP 95 ≥ 90 so null overall.

---

## Tier 2 — Medication adherence (dismissable, independent pipeline pass)

Runs in its own pipeline pass orthogonal to BP/HR — a single journal entry can produce one BP alert **and** one adherence alert. Dedup key in `DeviationAlert` is `(journalEntryId, ruleId)`, so both rows coexist. `type` maps to the legacy `MEDICATION_ADHERENCE` enum so existing provider-side reconciliation queries keep working.

### Scenario 60 — Generic missed-dose (no per-medication detail)

**Intent:** Patient tapped "Missed" on the legacy form path, without specifying which drug. Rule still fires with a warm, non-medication-specific reminder.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.diagnosedHypertension` | `true` |
| Reading | BP | 124/78, pulse 72 |
| Reading | `medicationTaken` | `false` |
| Reading | `missedMedications` | `[]` (empty) |

**Expected DeviationAlert row**
- `tier=TIER_2_DISCREPANCY` · `ruleId=RULE_MEDICATION_MISSED` · `dismissible=true` · `severity=MEDIUM` · `type=MEDICATION_ADHERENCE`
- `patientMessage.toLowerCase()` contains `"didn't take your medication"` (warm, non-specific)
- `physicianMessage` contains `"Tier 2"` + `"no medication specified"`
- Emits `JOURNAL_EVENTS.ALERT_CREATED` with `ruleId='RULE_MEDICATION_MISSED'` + `tier='TIER_2_DISCREPANCY'`

**Negative case** — Flip `medicationTaken=true` with `missedMedications=[]` → no alert, resolve-sweep runs scoped to BP L1 (Scenario 63).

---

### Scenario 61 — Per-medication miss with reason

**Intent:** Patient checked off a specific medication on the new form. Per-med detail (drug name, class, reason, dose count) flows through `metadata.missedMedications` → `AlertContext` → physician message.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.diagnosedHypertension` | `true` |
| Reading | BP | 124/78 |
| Reading | `medicationTaken` | `true` (generic toggle doesn't matter when array populated) |
| Reading | `missedMedications` | `[{ medicationId:'med-lisino', drugName:'Lisinopril', drugClass:'ACE_INHIBITOR', reason:'FORGOT', missedDoses:1 }]` |

**Expected DeviationAlert row**
- `tier=TIER_2_DISCREPANCY` · `ruleId=RULE_MEDICATION_MISSED`
- `patientMessage` contains `"Lisinopril"` (drug-specific warm wording)
- `physicianMessage` contains `"Lisinopril"` + `"ACE_INHIBITOR"` + `"FORGOT"` + `"doses missed: 1"`

**Negative case** — Empty `missedMedications` array → falls back to generic wording (Scenario 60). Drop `medicationTaken=false` and empty the array → no alert.

---

### Scenario 62 — Co-occurrence: BP Level 1 High + medication missed

**Intent:** Orthogonality test. BP pipeline fires first (creates row 1), adherence pass fires second (creates row 2). Resolve-sweep must NOT run because alerts did fire.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.diagnosedHypertension` | `true` |
| Reading | BP | 165/94, pulse 78 |
| Reading | `medicationTaken` | `false` |

**Expected behavior**
- `DeviationAlert.create` called exactly **twice**.
- **First call:** `ruleId=RULE_STANDARD_L1_HIGH` · `type=SYSTOLIC_BP` · `tier=BP_LEVEL_1_HIGH`.
- **Second call:** `ruleId=RULE_MEDICATION_MISSED` · `type=MEDICATION_ADHERENCE` · `tier=TIER_2_DISCREPANCY`.
- `DeviationAlert.updateMany` **not** called (resolve-sweep suppressed when any alert fires).

**Negative case** — Flip `medicationTaken=true` → only the BP row fires. Or drop SBP to 159 → only the adherence row fires. Confirms pipelines are independent.

---

### Scenario 63 — Happy path: medications taken, benign BP (no alert)

**Intent:** Neither pipeline fires → resolve-sweep runs with the existing BP-L1 scope. Guards against the sweep being accidentally widened to include `TIER_2_DISCREPANCY` (which would auto-resolve adherence alerts on an unrelated benign entry).

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.diagnosedHypertension` | `true` |
| Reading | BP | 124/78, pulse 72 |
| Reading | `medicationTaken` | `true` |
| Reading | `missedMedications` | `[]` (default) |

**Expected behavior**
- `evaluate()` returns `null`.
- `DeviationAlert.create` **not** called.
- `DeviationAlert.updateMany` called **once** with `where.tier IN ['BP_LEVEL_1_HIGH','BP_LEVEL_1_LOW']` only — Tier 2 discrepancy rows are preserved.

**Negative case** — Flip `medicationTaken=false` → adherence row fires → resolve-sweep suppressed.

---

## No alert (gates, benign readings, boundaries)

These scenarios assert **no** `DeviationAlert.create` call — either a benign reading, a closed gate, a below-threshold boundary, or an admin user who has no profile.

### Scenario 16 — Controlled 124/78 (benign + resolves open L1)

**Intent:** Benign reading does not create a new alert, and the resolve-sweep marks any open BP L1 alerts as `RESOLVED` (scoped to BP L1 tiers — Tier 1 + BP L2 are preserved).

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.diagnosedHypertension` | `true` |
| Meds | Lisinopril + Amlodipine | — |
| Reading | BP | 124/78, pulse 70 |

**Expected behavior**
- No `DeviationAlert.create` call.
- `DeviationAlert.updateMany` called once with `where.tier IN ['BP_LEVEL_1_HIGH','BP_LEVEL_1_LOW']` AND `data={status:'RESOLVED'}`.

**Negative case** — Raise reading to 162/95 → `RULE_STANDARD_L1_HIGH` fires → `DeviationAlert.create` call.

---

### Scenario 17 — AFib + 1 reading + pulse 118 (gate closed)

**Intent:** AFib gate blocks HR rule evaluation until `readingCount ≥ 3`.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.hasAFib` | `true` |
| Reading | BP | 135/82, pulse 118 |
| Reading | `readingCount` | `1` |

**Expected behavior** — no row, no event emit.

**Negative case** — Add 2 more prior readings (`readingCount=3`) → gate opens → `RULE_AFIB_HR_HIGH`.

---

### Scenario 19 — Brady + BB + pulse 55 (BB suppression)

**Intent:** BB suppression silences brady rule in the 50–60 window.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `profile.hasBradycardia` | `true` |
| Meds | Metoprolol · `drugClass=BETA_BLOCKER` | — |
| Reading | BP | 118/72, pulse 55 |

**Expected behavior** — no row.

**Negative case** — Pulse 38 → below window → `RULE_BRADY_HR_ASYMPTOMATIC` (matches Scenario 59).

---

### Scenarios 53-55 — Boundary floor-misses

| # | Condition | Reading | Rule at boundary | Fires at |
|---|---|---|---|---|
| 53 | `hasCAD=true` | 130/70 | `RULE_CAD_DBP_CRITICAL` needs strict `<70` | DBP 69 |
| 54 | defaults | 90/— | `RULE_STANDARD_L1_LOW` needs strict `<90` | SBP 89 |
| 55 | `ageGroup='65+'` | 100/— | `RULE_AGE_65_LOW` needs strict `<100` | SBP 99 |

All three: no row. Negative case = move SBP/DBP one unit below boundary (as listed).

---

### Scenario 57 — Admin user (no PatientProfile)

**Intent:** Admin users have no `PatientProfile`. `ProfileResolver.resolve` throws `ProfileNotFoundException` which the engine catches silently — no alert, no DB writes.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Prisma | `profileResolver.resolve` | throws `ProfileNotFoundException('admin-user-1')` |

**Expected behavior**
- `service.evaluate()` returns `null`.
- `DeviationAlert.create` NOT called.
- `DeviationAlert.update` NOT called.
- `DeviationAlert.updateMany` NOT called.

**Negative case** — Create a `PatientProfile` for the admin user → resolver returns context → engine runs normally (this would be a misconfiguration, not a valid admin path).

---

## Seed archetype mapping

Each demo patient in [seed.ts](../backend/prisma/seed.ts) maps to one scenario. Use these for smoke-testing the live backend after a fresh seed.

| Seed patient | Scenario | First trigger reading | Expected ruleId |
|---|---|---|---|
| Priya Menon (pregnant + ACE) | #1 | any | `RULE_PREGNANCY_ACE_ARB` |
| James Okafor (HFrEF + NDHP) | #2 | any | `RULE_NDHP_HFREF` |
| Rita Washington (CAD + low DBP) | #8 | 132/68 | `RULE_CAD_DBP_CRITICAL` |
| Charles Brown (AFib + high HR × 3) | #9 | 130/76 pulse 115 | `RULE_AFIB_HR_HIGH` |
| Aisha Johnson (controlled HTN) | #16 | 124/78 | `null` (no alert) |

---

## Related spec files

The end-to-end scenarios in this document cover the **rule engine**. Input filtering (which meds + profile fields reach the engine) is covered by the ProfileResolver unit tests. See [docs/TEST_SCENARIOS.md](TEST_SCENARIOS.md) for:

- ProfileResolver (30 tests): medication filtering by `discontinuedAt`, `verificationStatus`, `source`; safety-net biases; pre-Day-3 flag; age bucket; personalized-mode eligibility.
- Rule functions (75 tests): per-rule unit coverage including boundaries, combos, Part C gap-closure cases.
- AlertEngine orchestrator (25 tests): short-circuit order, gate behavior, persistence, regression tests for historical bugs 1/2/4.
- Derivatives, SessionAverager, OutputGenerator: derived values + message rendering.

**Always-on regression guards** (also documented at the top of [docs/CHAT_SCENARIOS.md](CHAT_SCENARIOS.md)):
- Tier 3 rows always produce `patientMessage=""` AND `caregiverMessage=""`.
- BP L2 rows always include `/911/` in `patientMessage`.
- All Tier 1 rows have `dismissible=false`.
- `type` column uses `MEDICATION_ADHERENCE` for contraindications, `DIASTOLIC_BP` for DBP-axis rules, `SYSTOLIC_BP` otherwise.

---

## Notes

- **`RULE_BRADY_HR_SYMPTOMATIC` is not reachable end-to-end**: the three structured flags that mark a bradycardic patient "symptomatic" (`chestPainOrDyspnea`, `severeHeadache`, `focalNeuroDeficit`) are all TOD triggers that short-circuit to the L2 symptom override (Scenario 35). Unit-level coverage still exists in [rules.spec.ts](../backend/src/daily_journal/engine/rules.spec.ts) section P.c.
- **Rule `mode` defaults to `STANDARD`.** `PERSONALIZED` requires BOTH a non-null `threshold` AND `readingCount ≥ 7`. Pre-Day-3 patients always get `STANDARD` with a disclaimer suffix.
- **`dismissible` invariant**: Tier 1 + BP Level 2 + symptom overrides → `false`. Everything else → `true`.
- **Resolve-sweep scope**: a benign reading (Scenario 16) resolves open rows where `tier IN (BP_LEVEL_1_HIGH, BP_LEVEL_1_LOW)`. It never auto-resolves Tier 1, Tier 2 discrepancy, BP L2, symptom overrides, or Tier 3 — those require explicit provider action. The sweep runs only when **both** pipelines return null (Scenario 63).
- **Two-pass engine (Scenarios 60–63)**: `AlertEngineService.evaluate()` runs the BP/HR pipeline FIRST (short-circuit, at most one row) and the adherence pipeline SECOND (independent). A single journal entry can therefore produce 0, 1, or 2 `DeviationAlert` rows. The `evaluate()` return value is the BP result if fired, else the adherence result, else null — preserving the one-result contract for existing callers.
- **TODO(Dr. Singal)**: `RULE_MEDICATION_MISSED` three-tier wording + single-miss threshold are placeholder until clinical sign-off. Wording lives in `shared/src/alert-messages.ts` and is flagged in source.
