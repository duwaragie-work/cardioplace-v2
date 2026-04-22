# Alert Scenarios

End-to-end coverage of the rule engine: **57 scenarios**, one per Jest case in [alert-engine.scenarios.spec.ts](../backend/src/daily_journal/services/alert-engine.scenarios.spec.ts).

Each scenario lists the patient setup + reading, and the alert the engine produces. BP values are shown as `SBP/DBP`. All other defaults (non-pregnant, no conditions, no medications, ~10 prior readings, profile verified) are implied unless stated.

---

## Tier 1 — Contraindications (non-dismissable, same-day provider action)

| # | Patient setup | Reading | Alert |
|---|---|---|---|
| 1 | Pregnant · Lisinopril (ACE) | 130/82 | `RULE_PREGNANCY_ACE_ARB` |
| 2 | HFrEF · Diltiazem (NDHP) + Carvedilol | 118/74 | `RULE_NDHP_HFREF` |
| 3 | Pregnant · profile UNVERIFIED · Lisinopril UNVERIFIED | 122/78 | `RULE_PREGNANCY_ACE_ARB` (safety net) |
| 18 | Pregnant + AFib · Lisinopril UNVERIFIED · 1 reading | 128/80 | `RULE_PREGNANCY_ACE_ARB` (AFib gate does not block) |
| 46 | Pregnant · Entresto (ARNI + ARB combo) | 128/80 | `RULE_PREGNANCY_ACE_ARB` |
| 47 | Pregnant · Zestoretic (ACE + THIAZIDE combo) | 128/80 | `RULE_PREGNANCY_ACE_ARB` |
| 48 | HF type UNKNOWN · Diltiazem | 120/74 | `RULE_NDHP_HFREF` (UNKNOWN → HFREF safety net) |
| 49 | DCM only · Diltiazem | 120/74 | `RULE_NDHP_HFREF` (DCM → HFREF safety net) |
| 50 | Pregnant + HFrEF · Lisinopril + Diltiazem | 120/76 | `RULE_PREGNANCY_ACE_ARB` (precedence — pregnancy wins) |
| 51 | Pregnant · Lisinopril | 195/130 | `RULE_PREGNANCY_ACE_ARB` (Tier 1 beats emergency) |

---

## BP Level 2 — Emergency (non-dismissable, patient sees 911 CTA)

| # | Patient setup | Reading | Alert |
|---|---|---|---|
| 4 | Diagnosed HTN | 190/105 | `RULE_ABSOLUTE_EMERGENCY` |
| 6 | Pregnant | 165/112 | `RULE_PREGNANCY_L2` |
| 21 | 2 readings averaged | 180/95 (mean) | `RULE_ABSOLUTE_EMERGENCY` |

### Symptom overrides (BP Level 2 at any BP)

| # | Patient setup | Reading | Symptom | Alert |
|---|---|---|---|---|
| 5 | Diagnosed HTN | 122/76 | Severe headache | `RULE_SYMPTOM_OVERRIDE_GENERAL` |
| 22 | Pregnant | 128/82 | RUQ pain | `RULE_SYMPTOM_OVERRIDE_PREGNANCY` |
| 35 | Bradycardia · pulse 48 | 118/72 | Chest pain/dyspnea | `RULE_SYMPTOM_OVERRIDE_GENERAL` (L2 wins over brady L1) |
| 39 | — | 125/75 | Visual changes | `RULE_SYMPTOM_OVERRIDE_GENERAL` |
| 40 | — | 125/75 | Altered mental status | `RULE_SYMPTOM_OVERRIDE_GENERAL` |
| 41 | — | 125/75 | Chest pain/dyspnea | `RULE_SYMPTOM_OVERRIDE_GENERAL` |
| 42 | — | 125/75 | Focal neuro deficit | `RULE_SYMPTOM_OVERRIDE_GENERAL` |
| 43 | — | 125/75 | Severe epigastric pain | `RULE_SYMPTOM_OVERRIDE_GENERAL` |
| 44 | Pregnant | 125/75 | New-onset headache | `RULE_SYMPTOM_OVERRIDE_PREGNANCY` |
| 45 | Pregnant | 110/70 | Edema | `RULE_SYMPTOM_OVERRIDE_PREGNANCY` |

---

## BP Level 1 — High (dismissable, same-day provider review)

| # | Patient setup | Reading | Alert |
|---|---|---|---|
| 7 | Pregnant | 144/88 | `RULE_PREGNANCY_L1_HIGH` |
| 9 | AFib · 3 readings · Metoprolol | pulse 115 | `RULE_AFIB_HR_HIGH` |
| 12 | Diagnosed HTN · threshold 130/90 · 12 readings | 152/88 | `RULE_PERSONALIZED_HIGH` (mode=PERSONALIZED) |
| 13 | Diagnosed HTN · 3 readings · threshold | 165/94 | `RULE_STANDARD_L1_HIGH` (mode=STANDARD + pre-Day-3 disclaimer) |
| 15 | Diagnosed HTN | 172/88 | `RULE_STANDARD_L1_HIGH` + wide-PP annotation (PP 84) |
| 20 | Diagnosed HTN · suboptimal checklist | 164/96 | `RULE_STANDARD_L1_HIGH` + retake suffix |
| 24 | HFrEF | 162/88 | `RULE_HFREF_HIGH` |
| 25 | HFpEF | 162/88 | `RULE_HFPEF_HIGH` |
| 26 | CAD | 162/82 | `RULE_CAD_HIGH` |
| 28 | HCM · no risky meds | 162/88 | `RULE_HCM_HIGH` |
| 30 | DCM only | 162/88 | `RULE_DCM_HIGH` |
| 34 | Tachycardia · prior reading pulse 102 | pulse 105 | `RULE_TACHY_HR` |
| 52 | Diagnosed HTN (boundary) | 160/95 | `RULE_STANDARD_L1_HIGH` |
| 56 | AFib · 3 readings | 165/92 · pulse 75 | `RULE_STANDARD_L1_HIGH` (AFib patients still get BP alerts) |

---

## BP Level 1 — Low (dismissable)

| # | Patient setup | Reading | Alert |
|---|---|---|---|
| 8 | CAD · Amlodipine | 132/68 | `RULE_CAD_DBP_CRITICAL` |
| 10 | HFpEF | 106/70 | `RULE_HFPEF_LOW` |
| 11 | Age 65+ | 96/58 | `RULE_AGE_65_LOW` |
| 23 | HFrEF | 82/55 | `RULE_HFREF_LOW` |
| 27 | HCM · no risky meds | 98/64 | `RULE_HCM_LOW` |
| 29 | DCM only | 82/55 | `RULE_DCM_LOW` |
| 31 | Diagnosed HTN · threshold lower=110 · 12 readings | 108/70 | `RULE_PERSONALIZED_LOW` |
| 32 | Age 40–64 | 88/58 | `RULE_STANDARD_L1_LOW` |
| 33 | AFib · 3 readings | pulse 48 | `RULE_AFIB_HR_LOW` |
| 36 | Bradycardia · asymptomatic | pulse 38 | `RULE_BRADY_HR_ASYMPTOMATIC` |

---

## Tier 3 — Physician-only (no patient-facing message)

| # | Patient setup | Reading | Alert |
|---|---|---|---|
| 14 | HCM · Amlodipine (DHP vasodilator) | 128/82 | `RULE_HCM_VASODILATOR` |
| 37 | — | 145/80 (PP 65) | `RULE_PULSE_PRESSURE_WIDE` |
| 38 | Furosemide (loop diuretic) | 92/60 | `RULE_LOOP_DIURETIC_HYPOTENSION` |

---

## No alert (gates, benign readings, boundaries)

| # | Patient setup | Reading | Engine behavior |
|---|---|---|---|
| 16 | Diagnosed HTN · Lisinopril + Amlodipine | 124/78 | No alert · resolves any open BP_LEVEL_1_* (keeps Tier 1/L2) |
| 17 | AFib · 1 reading | pulse 118 | No alert — AFib gate closed (<3 readings) |
| 19 | Bradycardia · Metoprolol (BB) | pulse 55 | No alert — BB suppression window 50–60 |
| 53 | CAD (boundary) | 130/70 | No alert — DBP critical is strict `<70` |
| 54 | — (boundary) | 90/— | No alert — standard low is strict `<90` |
| 55 | Age 65+ (boundary) | 100/— | No alert — age-65 low is strict `<100` |
| 57 | Admin user (no PatientProfile) | any | Skip silently — no row, no resolve |

---

## Seed archetype → scenario

Each demo patient in [seed.ts](../backend/prisma/seed.ts) maps to one of the scenarios above:

| Seed | Scenario |
|---|---|
| Priya Menon (pregnant + ACE) | #1 |
| James Okafor (HFrEF + NDHP) | #2 |
| Rita Washington (CAD + DBP 68) | #8 |
| Charles Brown (AFib + HR 115 × 3) | #9 |
| Aisha Johnson (controlled HTN) | #16 |

---

## Notes

- **`RULE_BRADY_HR_SYMPTOMATIC` unreachable end-to-end**: the symptom flags that mark a bradycardic patient "symptomatic" are all also target-organ-damage triggers, so the L2 symptom override fires first (scenario 35). Rule-level unit test still covers it directly.
- **Rule `mode`**: `STANDARD` unless the patient has a provider-set `PatientThreshold` AND ≥7 prior readings. Pre-Day-3 patients (<7 readings) always get `STANDARD` with a disclaimer suffix on the patient message.

---

## How to reproduce against the live backend

Once Postgres is running + seed is applied (`npx prisma migrate dev`, `npx prisma db seed`):

1. Log in as seed user with OTP `666666`
2. `POST /daily-journal/entries` with the reading shown
3. `SELECT tier, ruleId, dismissible, patientMessage, physicianMessage FROM "DeviationAlert" WHERE "userId" = <seed id> ORDER BY "createdAt" DESC LIMIT 1;`

Expected row matches the `Alert` column above.
