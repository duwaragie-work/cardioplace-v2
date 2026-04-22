# Alert Scenarios — End-to-End Walkthroughs

Companion to [TEST_SCENARIOS.md](TEST_SCENARIOS.md). Where that doc lists tests function-by-function, this doc walks the system end-to-end: *given this patient + this reading, this is the alert that comes out.*

Each scenario shows:
- **Patient setup** — profile, medications, threshold, prior readings
- **Reading submitted** — BP, pulse, symptoms, pre-measurement checklist
- **Pipeline winner** — which rule short-circuits first
- **`DeviationAlert` row** — what lands in the database
- **Three-tier messages** — exact wording the patient / caregiver / physician see
- **Event emitted** — what phase/7 escalation will consume

Messages below are verbatim from [shared/src/alert-messages.ts](../shared/src/alert-messages.ts).

---

## Tier 1 — Contraindications (non-dismissable)

### Scenario 1: Pregnant patient on lisinopril (seed: Priya)

**Setup**
- `isPregnant = true`, `pregnancyDueDate = +90 days`, `historyPreeclampsia = true`
- Medication: Lisinopril 10mg once daily, `drugClass = ACE_INHIBITOR`, `verificationStatus = VERIFIED`
- 10 prior readings; no custom threshold

**Reading submitted**: BP **130/82**, pulse 78, no symptoms

**Pipeline**: `pregnancyAceArbRule` fires at step 1 — short-circuits before BP rules.

**`DeviationAlert` row**
| Field | Value |
|---|---|
| `tier` | `TIER_1_CONTRAINDICATION` |
| `ruleId` | `RULE_PREGNANCY_ACE_ARB` |
| `mode` | `STANDARD` |
| `dismissible` | `false` |
| `pulsePressure` | `null` (Tier 1 doesn't cache BP-derived values) |
| `actualValue` | `null` |
| `severity` (legacy) | `HIGH` |
| `type` (legacy) | `MEDICATION_ADHERENCE` |

**Patient message**
> Your care team needs to review your blood pressure medicine because you are pregnant. Please call your provider today before taking your next dose.

**Caregiver message**
> The patient is pregnant and has a blood pressure medicine that needs urgent provider review. Please help them contact their care team today.

**Physician message**
> Tier 1 — ACE/ARB (Lisinopril, ACE_INHIBITOR) in pregnant patient. Teratogenic; discontinue and switch to CHAP-protocol alternative (labetalol or long-acting nifedipine).

**Event**: `journal.anomaly.tracked` with `alertId = <DeviationAlert.id>`, `severity = HIGH`, `escalated = false`

---

### Scenario 2: HFrEF patient on diltiazem (seed: James)

**Setup**
- `hasHeartFailure = true`, `heartFailureType = HFREF`
- Medications: Diltiazem 120mg twice daily (NDHP_CCB, VERIFIED) + Carvedilol (BETA_BLOCKER)
- Custom threshold: SBP 85–130

**Reading submitted**: BP **118/74**, pulse 68

**Pipeline**: `ndhpHfrefRule` fires at step 2.

**`DeviationAlert` row**
| Field | Value |
|---|---|
| `tier` | `TIER_1_CONTRAINDICATION` |
| `ruleId` | `RULE_NDHP_HFREF` |
| `dismissible` | `false` |
| `severity` | `HIGH` |

**Patient message**
> Your care team needs to review one of your heart medicines with you. Please call your provider today before taking your next dose.

**Physician message**
> Tier 1 — Nondihydropyridine CCB (Diltiazem) in HFrEF. Negative inotropic; discontinue per 2025 AHA/ACC.

---

### Scenario 3: Unverified ACE on a newly-pregnant patient (safety net)

**Setup**
- `isPregnant = true`, `profileVerificationStatus = UNVERIFIED` (just enrolled 2h ago)
- Medication: patient reported Lisinopril via voice intake, `verificationStatus = UNVERIFIED`

**Reading submitted**: BP **122/78**

**Pipeline**: ProfileResolver sets `triggerPregnancyContraindicationCheck = true` even though profile is unverified. Rule fires immediately — ACE/ARB + pregnancy is the only safety-critical pair that fires on unverified meds.

**Alert**: Same as Scenario 1 — `RULE_PREGNANCY_ACE_ARB`, `TIER_1_CONTRAINDICATION`.

---

## BP Level 2 — Emergency (non-dismissable, fires outside business hours)

### Scenario 4: Absolute emergency BP

**Setup**: Non-pregnant 54F, diagnosed hypertension, on Lisinopril + Amlodipine (seed: Aisha's profile but altered reading).

**Reading submitted**: BP **190/105**, pulse 88, no symptoms

**Pipeline**: steps 1–3 don't match (no ACE+pregnancy, no NDHP+HFrEF, no symptoms). `absoluteEmergencyRule` at step 4 fires (SBP ≥ 180).

**`DeviationAlert` row**
| Field | Value |
|---|---|
| `tier` | `BP_LEVEL_2` |
| `ruleId` | `RULE_ABSOLUTE_EMERGENCY` |
| `dismissible` | `false` |
| `actualValue` | `190` |
| `pulsePressure` | `85` |

**Patient message**
> Your blood pressure is very high: 190/105 mmHg. If you have chest pain, severe headache, trouble breathing, weakness, or vision changes, call 911 now.

**Physician message**
> BP Level 2 — 190/105 mmHg (SBP ≥180 or DBP ≥120). Prompt symptom assessment; treat per hypertensive-urgency protocol if confirmed target organ involvement. | Wide pulse pressure: 85 mmHg (>60).

---

### Scenario 5: Symptom override at normal BP (patient reports severe headache)

**Setup**: 48M, diagnosed hypertension, on ARB only.

**Reading submitted**: BP **122/76**, pulse 74, `severeHeadache = true`

**Pipeline**: `symptomOverrideGeneralRule` fires at step 3 regardless of BP.

**`DeviationAlert` row**
| Field | Value |
|---|---|
| `tier` | `BP_LEVEL_2_SYMPTOM_OVERRIDE` |
| `ruleId` | `RULE_SYMPTOM_OVERRIDE_GENERAL` |
| `dismissible` | `false` |

**Patient message**
> Your blood pressure reading is 122/76 mmHg and you reported serious symptoms. If you have chest pain, severe headache, trouble breathing, weakness, or vision changes, call 911 now.

**Physician message**
> BP Level 2 — symptom override at 122/76 mmHg. Reported: severe headache.

---

### Scenario 6: Pregnant patient hits ACOG severe-range threshold

**Setup**: Pregnant, 28 weeks, no ACE/ARB on regimen (on labetalol).

**Reading submitted**: BP **165/112**, pulse 90, no symptoms

**Pipeline**: steps 1–4 skip. `pregnancyL2Rule` at step 5 fires.

**`DeviationAlert` row**
| Field | Value |
|---|---|
| `tier` | `BP_LEVEL_2` |
| `ruleId` | `RULE_PREGNANCY_L2` |
| `dismissible` | `false` |
| `actualValue` | `165` |

**Patient message**
> Your blood pressure reading is 165/112 mmHg, which is very high for pregnancy. If you have chest pain, severe headache, trouble breathing, weakness, or vision changes, call 911 now.

**Physician message**
> BP Level 2 — pregnancy ≥160/110 at 165/112 mmHg. Severe-range hypertension; treat within 15 minutes per ACOG.

---

## BP Level 1 — High (dismissable, provider same-day)

### Scenario 7: Pregnant patient at ACOG Level 1 threshold

**Setup**: Pregnant, 24 weeks, no ACE/ARB.

**Reading submitted**: BP **144/88**, pulse 82, no symptoms, pre-measurement checklist all ✅

**Pipeline**: `pregnancyL1HighRule` at step 5b (SBP ≥ 140).

**Patient message**
> Your blood pressure reading is 144/88 mmHg, which is higher than the goal for pregnancy. Please contact your care team today.

**Physician message**
> BP Level 1 High — pregnancy ≥140/90 at 144/88 mmHg. Assess for preeclampsia features.

---

### Scenario 8: CAD patient trips the DBP<70 critical rule (seed: Rita)

**Setup**: CAD, diagnosed hypertension, on Atorvastatin + Amlodipine + Metoprolol. 5 prior readings.

**Reading submitted**: BP **132/68**, pulse 66

**Pipeline**: `cadRule` at step 6 — DBP < 70 regardless of SBP.

**`DeviationAlert` row**
| Field | Value |
|---|---|
| `tier` | `BP_LEVEL_1_LOW` |
| `ruleId` | `RULE_CAD_DBP_CRITICAL` |
| `dismissible` | `true` |
| `actualValue` | `68` |
| `type` (legacy) | `DIASTOLIC_BP` |

**Patient message**
> Your blood pressure reading is 132/68 mmHg. The lower number is concerning for your heart. Please contact your care team today.

**Physician message**
> BP Level 1 Low — CAD DBP < 70 at 132/68 mmHg. J-curve risk per CLARIFY; reassess antihypertensive intensity.

---

### Scenario 9: AFib patient with 3 readings averaging HR 115 (seed: Charles)

**Setup**: AFib, on Apixaban + Metoprolol. Current session has 3 readings submitted with same `sessionId`.

**Readings submitted** (same session)
1. BP 128/76, pulse 118
2. BP 132/78, pulse 114 (2 min later)
3. BP 130/75, pulse 113 (4 min later)

**Session average**: BP **130/76**, pulse **115**, `readingCount = 3`.

**Pipeline**: Stage A (contraindications, symptom override) skips. AFib gate opens (readingCount ≥ 3). `afibHrRule` fires at step 13.

**`DeviationAlert` row**
| Field | Value |
|---|---|
| `tier` | `BP_LEVEL_1_HIGH` |
| `ruleId` | `RULE_AFIB_HR_HIGH` |
| `dismissible` | `true` |
| `actualValue` | `115` |

**Patient message**
> Your heart rate is HR 115 bpm, which is higher than your goal. Please contact your care team today.

**Physician message**
> HR Level 1 High — AFib HR >110: HR 115 bpm. Rate-uncontrolled AFib.

---

### Scenario 10: HFpEF patient trending low

**Setup**: HFpEF (preserved EF), on losartan. No custom threshold.

**Reading submitted**: BP **106/70**, pulse 76

**Pipeline**: `hfpefRule` at step 8 (SBP < 110 default).

**Patient message**
> Your blood pressure reading is 106/70 mmHg, which is lower than the goal for you. Please contact your care team today.

**Physician message**
> BP Level 1 Low — HFpEF SBP < 110: 106/70 mmHg.

---

### Scenario 11: Age 65+ lower-bound override

**Setup**: 72F, no cardiac conditions, on Lisinopril.

**Reading submitted**: BP **96/58**, pulse 70

**Pipeline**: `standardL1LowRule` at step 12. ProfileResolver derives `ageGroup = 65+` from DOB → rule uses SBP < 100 (not < 90).

**`DeviationAlert` row**
| Field | Value |
|---|---|
| `tier` | `BP_LEVEL_1_LOW` |
| `ruleId` | `RULE_AGE_65_LOW` |

**Patient message**
> Your blood pressure reading is 96/58 mmHg, which is low. Please contact your care team today and watch for dizziness or fall risk.

**Physician message**
> BP Level 1 Low — age 65+ override: SBP <100 at 96/58 mmHg.

*(A 45F with the same reading would get no alert — standard lower bound is <90.)*

---

### Scenario 12: Personalized mode (provider-set target)

**Setup**: 58F, diagnosed hypertension, 12 prior readings, provider set `sbpUpperTarget = 130`.

**Reading submitted**: BP **152/88**, pulse 76

**Pipeline**: 152 ≥ target (130) + 20 → `personalizedHighRule` at step 9.

**`DeviationAlert` row**
| Field | Value |
|---|---|
| `tier` | `BP_LEVEL_1_HIGH` |
| `ruleId` | `RULE_PERSONALIZED_HIGH` |
| `mode` | **`PERSONALIZED`** |
| `actualValue` | `152` |

**Patient message**
> Your blood pressure reading is 152/88 mmHg, which is above the target your provider set for you. Please contact your care team today.

**Physician message**
> BP Level 1 High — personalized: SBP ≥ target + 20 = 150. Current 152/88 mmHg.

---

### Scenario 13: Pre-Day-3 mode (<7 readings)

**Setup**: 52M, brand new enrollment, **3 prior readings**, has a custom threshold set by provider at enrollment.

**Reading submitted**: BP **165/94**, pulse 82

**Pipeline**: ProfileResolver sets `preDay3Mode = true`, `personalizedEligible = false` (<7 readings). Falls through to `standardL1HighRule` at step 11.

**`DeviationAlert` row**
| Field | Value |
|---|---|
| `tier` | `BP_LEVEL_1_HIGH` |
| `ruleId` | `RULE_STANDARD_L1_HIGH` |
| `mode` | **`STANDARD`** (forced) |

**Patient message** (note the disclaimer suffix)
> Your blood pressure reading is 165/94 mmHg, which is high. Please contact your care team today. (Standard threshold — personalization begins after Day 3.)

---

## Tier 3 — Physician-only (no patient-facing message)

### Scenario 14: HCM patient on amlodipine (vasodilator flag)

**Setup**: HCM, on amlodipine for hypertension.

**Reading submitted**: BP **128/82**, pulse 72

**Pipeline**: `hcmRule` fires Tier 3 when a risky med (DHP-CCB / nitrate / loop diuretic) is present, even at normal BP.

**`DeviationAlert` row**
| Field | Value |
|---|---|
| `tier` | `TIER_3_INFO` |
| `ruleId` | `RULE_HCM_VASODILATOR` |
| `dismissible` | `true` |

**Patient message**: *(empty — physician-only)*

**Caregiver message**: *(empty)*

**Physician message**
> Tier 3 — HCM + DHP_CCB (Amlodipine): may worsen LVOT obstruction. Review per 2024 AHA/ACC HCM guideline.

---

### Scenario 15: Wide pulse pressure annotation rides on L1 High

**Setup**: 66M, isolated systolic HTN, no meds.

**Reading submitted**: BP **172/88**, pulse 78. Pulse pressure = 84 (>60).

**Pipeline**: `standardL1HighRule` fires first (SBP ≥ 160). The PP annotation is attached to the *same* alert row's physician message — no separate Tier 3 row.

**Patient message**
> Your blood pressure reading is 172/88 mmHg, which is high. Please contact your care team today.

**Physician message**
> BP Level 1 High — severe Stage 2 (≥160/100) at 172/88 mmHg. | Wide pulse pressure: 84 mmHg (>60).

---

## No alert (benign readings + gates)

### Scenario 16: Controlled patient posts normal reading (seed: Aisha)

**Setup**: Well-controlled HTN, on Lisinopril + Amlodipine, 14 prior readings.

**Reading submitted**: BP **124/78**, pulse 70

**Pipeline**: every rule returns `null`. Engine calls `resolveOpenAlerts(userId)` which marks any previously-open **BP_LEVEL_1_HIGH** / **BP_LEVEL_1_LOW** rows as `RESOLVED`. Existing Tier 1 / BP Level 2 / Tier 2 / Tier 3 alerts are **NOT** touched (Bug 2 fix).

**Alert**: no `DeviationAlert` row created. No event emitted.

---

### Scenario 17: AFib patient with only 1 reading in session (gate closed)

**Setup**: AFib, no contraindicated meds.

**Reading submitted**: BP 135/82, pulse 118, `readingCount = 1`

**Pipeline**: Stage A (contraindications + symptom override) returns null. AFib gate closes at step 3.5 — BP/HR rules skipped.

**Alert**: none. Log line: `AFib gate: skipping BP/HR rules for entry <id> — session has 1/3 readings.`

---

### Scenario 18: AFib gate + contraindication present (gate does NOT block Tier 1)

**Setup**: AFib **and** pregnant, on Lisinopril (unverified, just self-reported).

**Reading submitted**: BP 128/80, pulse 96, `readingCount = 1`

**Pipeline**: Stage A runs BEFORE the AFib gate. `pregnancyAceArbRule` fires. Tier 1 alert is produced even though the patient has fewer than 3 readings in the session.

**Alert**: `TIER_1_CONTRAINDICATION` / `RULE_PREGNANCY_ACE_ARB`. (Critically important — the pre-fix behavior silently dropped this alert.)

---

### Scenario 19: Beta-blocker patient with HR 55 (suppression window)

**Setup**: Bradycardia diagnosis, on Metoprolol (VERIFIED).

**Reading submitted**: BP 118/72, pulse 55, no symptoms

**Pipeline**: `bradyRule` at step 15 detects HR < 60 but suppresses because beta-blocker is present and pulse is in the 50–60 therapeutic window. Returns `null`.

**Alert**: none.

*(Same patient with pulse 48 and symptoms → `RULE_BRADY_HR_SYMPTOMATIC` fires — below 50 is not suppressed.)*

---

## Quality-of-measurement modifiers

### Scenario 20: Suboptimal measurement + L1 High

**Setup**: Non-pregnant 50F, diagnosed HTN.

**Reading submitted**: BP **164/96**, pulse 78, pre-measurement checklist reports **"Seated quietly 5 minutes = false"**.

**Pipeline**: `standardL1HighRule` fires. `session.suboptimalMeasurement = true` propagates onto the alert row and the patient-message suffix.

**`DeviationAlert` row**
| Field | Value |
|---|---|
| `tier` | `BP_LEVEL_1_HIGH` |
| `ruleId` | `RULE_STANDARD_L1_HIGH` |
| `suboptimalMeasurement` | `true` |

**Patient message** (note retake suffix)
> Your blood pressure reading is 164/96 mmHg, which is high. Please contact your care team today. Please retake the reading following the measurement checklist.

---

### Scenario 21: Session averaging crosses emergency threshold

**Setup**: Non-pregnant 55M, diagnosed HTN.

**Readings submitted** (same session, 3 min apart)
1. BP 175/92
2. BP 185/98

**Session average**: BP **180/95**, `readingCount = 2`.

**Pipeline**: `absoluteEmergencyRule` fires because the averaged SBP hits 180. A single reading of 175 alone would NOT have fired this rule — the system only evaluates session averages.

**Alert**: `BP_LEVEL_2` / `RULE_ABSOLUTE_EMERGENCY`.

---

---

## Expanded scenarios (22–57) — complete rule-ID + symptom + combo + safety-net coverage

Compact quick-reference. Each scenario is also an executable `it()` in [alert-engine.scenarios.spec.ts](../backend/src/daily_journal/services/alert-engine.scenarios.spec.ts).

### Every remaining rule ID

| # | Input | Expected |
|---|---|---|
| 22 | Pregnant · `ruqPain=true` · BP 128/82 | `RULE_SYMPTOM_OVERRIDE_PREGNANCY` · BP_LEVEL_2_SYMPTOM_OVERRIDE |
| 23 | HFrEF · BP 82/55 | `RULE_HFREF_LOW` · BP_LEVEL_1_LOW |
| 24 | HFrEF · BP 162/88 | `RULE_HFREF_HIGH` · BP_LEVEL_1_HIGH |
| 25 | HFpEF · BP 162/88 | `RULE_HFPEF_HIGH` · BP_LEVEL_1_HIGH |
| 26 | CAD · BP 162/82 (DBP normal) | `RULE_CAD_HIGH` · BP_LEVEL_1_HIGH |
| 27 | HCM · BP 98/64 · no risky med | `RULE_HCM_LOW` · BP_LEVEL_1_LOW |
| 28 | HCM · BP 162/88 · no risky med | `RULE_HCM_HIGH` · BP_LEVEL_1_HIGH |
| 29 | DCM only (no HF flag) · BP 82/55 | `RULE_DCM_LOW` · BP_LEVEL_1_LOW |
| 30 | DCM only · BP 162/88 | `RULE_DCM_HIGH` · BP_LEVEL_1_HIGH |
| 31 | Diagnosed HTN · threshold lower=110 · 12 readings · BP 108/70 | `RULE_PERSONALIZED_LOW` · mode=PERSONALIZED |
| 32 | Age 45 · BP 88/58 | `RULE_STANDARD_L1_LOW` · BP_LEVEL_1_LOW |
| 33 | AFib · 3 readings · pulse 48 | `RULE_AFIB_HR_LOW` · BP_LEVEL_1_LOW |
| 34 | Tachy patient · pulse 105 · prior reading pulse 102 | `RULE_TACHY_HR` · BP_LEVEL_1_HIGH |
| 35 | Brady · pulse 48 · `chestPainOrDyspnea=true` | `RULE_SYMPTOM_OVERRIDE_GENERAL` (L2 wins — safer) |
| 36 | Brady · pulse 38 · asymptomatic | `RULE_BRADY_HR_ASYMPTOMATIC` · BP_LEVEL_1_LOW |
| 37 | BP 145/80 · PP 65 · no conditions | `RULE_PULSE_PRESSURE_WIDE` · TIER_3_INFO (patient msg empty) |
| 38 | Loop diuretic (Furosemide) · BP 92/60 | `RULE_LOOP_DIURETIC_HYPOTENSION` · TIER_3_INFO |

### Remaining general symptom triggers (symptom override)

| # | Input | Expected |
|---|---|---|
| 39 | BP 125/75 · `visualChanges=true` | `RULE_SYMPTOM_OVERRIDE_GENERAL` |
| 40 | BP 125/75 · `alteredMentalStatus=true` | `RULE_SYMPTOM_OVERRIDE_GENERAL` |
| 41 | BP 125/75 · `chestPainOrDyspnea=true` | `RULE_SYMPTOM_OVERRIDE_GENERAL` |
| 42 | BP 125/75 · `focalNeuroDeficit=true` | `RULE_SYMPTOM_OVERRIDE_GENERAL` |
| 43 | BP 125/75 · `severeEpigastricPain=true` | `RULE_SYMPTOM_OVERRIDE_GENERAL` |
| 44 | Pregnant · `newOnsetHeadache=true` · BP 125/75 | `RULE_SYMPTOM_OVERRIDE_PREGNANCY` |
| 45 | Pregnant · `edema=true` · BP 110/70 | `RULE_SYMPTOM_OVERRIDE_PREGNANCY` |

### Combo drug contraindications (registersAs path)

| # | Input | Expected |
|---|---|---|
| 46 | Pregnant · Entresto (ARNI + ARB combo) · BP 128/80 | `RULE_PREGNANCY_ACE_ARB` · TIER_1 · physician msg names Entresto |
| 47 | Pregnant · Zestoretic (ACE + THIAZIDE combo) · BP 128/80 | `RULE_PREGNANCY_ACE_ARB` · TIER_1 · physician msg names Zestoretic |

### Safety-net HF type biases

| # | Input | Expected |
|---|---|---|
| 48 | `hasHeartFailure=true` · `heartFailureType=UNKNOWN` · Diltiazem | `RULE_NDHP_HFREF` (resolver biased to HFREF) |
| 49 | DCM only (no HF flag) · Diltiazem | `RULE_NDHP_HFREF` |

### Rule precedence

| # | Input | Expected |
|---|---|---|
| 50 | Pregnant + HFrEF · Lisinopril + Diltiazem · BP 120/76 | `RULE_PREGNANCY_ACE_ARB` (pregnancy wins; single upsert) |
| 51 | Pregnant · Lisinopril · BP 195/130 | `RULE_PREGNANCY_ACE_ARB` (Tier 1 beats absolute emergency) |

### Boundary values

| # | Input | Expected |
|---|---|---|
| 52 | Standard SBP=160 exactly | `RULE_STANDARD_L1_HIGH` fires |
| 53 | CAD · DBP=70 exactly · SBP 130 | **no alert** (boundary, <70 is strict) |
| 54 | Standard SBP=90 exactly | **no alert** (boundary, <90 is strict) |
| 55 | Age 65+ · SBP=100 exactly | **no alert** (boundary, <100 is strict) |

### System-level edges

| # | Input | Expected |
|---|---|---|
| 56 | AFib · 3 readings · SBP 165 · pulse 75 | `RULE_STANDARD_L1_HIGH` (AFib patients get BP alerts after gate opens) |
| 57 | Admin user (no PatientProfile) | **skip silently** · no upsert · no updateMany |

### Notes on unreachable paths

- `RULE_BRADY_HR_SYMPTOMATIC` is reachable in [rules.spec.ts](../backend/src/daily_journal/engine/rules.spec.ts) unit tests but not end-to-end: the 3 symptom flags used to detect bradycardic symptomaticity (`alteredMentalStatus`, `chestPainOrDyspnea`, `focalNeuroDeficit`) are all TOD triggers that short-circuit to `BP_LEVEL_2_SYMPTOM_OVERRIDE` before the brady rule runs. Clinically correct — an L2 emergency is safer than an L1 brady alert for a patient with chest pain.
- `dcmRule` must run before `hfrefRule` in the pipeline — both match `resolvedHFType = HFREF` (DCM-only patients are biased to HFREF by the resolver), so dcmRule's early-return on `hasHeartFailure=true` is what keeps HFrEF patients routed correctly.

---

## Summary — seed archetype coverage

| Seed patient | Expected rule | Phase/7 tier |
|---|---|---|
| Priya Menon (pregnant + ACE) | `RULE_PREGNANCY_ACE_ARB` | Tier 1 |
| James Okafor (HFrEF + NDHP) | `RULE_NDHP_HFREF` | Tier 1 |
| Rita Washington (CAD + DBP 68) | `RULE_CAD_DBP_CRITICAL` | BP Level 1 Low |
| Charles Brown (AFib + HR 115 × 3) | `RULE_AFIB_HR_HIGH` | BP Level 1 High |
| Aisha Johnson (controlled HTN) | — | No alert |

All five produce the exact alerts described in the corresponding scenario above when their stock trigger-reading is POSTed. Use these as end-to-end smoke tests once the DB is available.

---

## How to reproduce in a live backend

Once a local Postgres + seed is running (`npx prisma migrate dev`, `npx prisma db seed`):

1. Log in as seed user with OTP `666666`
2. `POST /daily-journal/entries` with the reading values shown in each scenario
3. Query `SELECT tier, ruleId, dismissible, patientMessage, physicianMessage FROM "DeviationAlert" WHERE "userId" = <seed id> ORDER BY "createdAt" DESC LIMIT 1;`

Expected rows match the scenarios verbatim. (For multi-reading sessions, include the same `sessionId` on all three payloads or post them within 30 minutes.)
