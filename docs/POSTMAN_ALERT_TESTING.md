# Postman Guide — Backend Alerts End-to-End

A practical, copy-paste-ready guide for triggering every alert rule via the live backend HTTP API. Built for manual testing rounds; complements `ALERT_SCENARIOS.md` (which documents the same scenarios at the Jest unit-test level).

**You'll exercise:**
- All Tier 1 contraindications, BP Level 2 emergencies, BP Level 1 high/low, Tier 3 physician-only, Tier 2 medication adherence, and the resolve-sweep no-alert path.
- Two clear categories:
  - **Category A** — scenarios that fire on STANDARD thresholds; **no provider-set threshold needed**.
  - **Category B** — scenarios that require the provider to set a `PatientThreshold` first.
- Edge cases: threshold required but not set, threshold set but <7 readings, AFib gate, missing clinical intake (Layer A gate).

---

## Contents

- [0. Prerequisites](#0-prerequisites)
- [1. Postman environment setup](#1-postman-environment-setup)
- [2. Authentication — get a JWT](#2-authentication--get-a-jwt)
- [3. Helper endpoints (run before scenario testing)](#3-helper-endpoints-run-before-scenario-testing)
- [4. The base scenario flow (every test follows this)](#4-the-base-scenario-flow-every-test-follows-this)
- [Category A — No threshold needed](#category-a--no-threshold-needed)
  - [A1. Tier 1 contraindications](#a1-tier-1-contraindications)
  - [A2. BP Level 2 emergency](#a2-bp-level-2-emergency)
  - [A3. Symptom overrides](#a3-symptom-overrides)
  - [A4. BP Level 1 High (standard + condition branches)](#a4-bp-level-1-high-standard--condition-branches)
  - [A5. BP Level 1 Low](#a5-bp-level-1-low)
  - [A6. Heart-rate branches](#a6-heart-rate-branches)
  - [A7. Tier 3 physician-only](#a7-tier-3-physician-only)
  - [A8. Tier 2 medication adherence](#a8-tier-2-medication-adherence)
  - [A9. No-alert (control) cases](#a9-no-alert-control-cases)
- [Category B — Threshold required (PERSONALIZED mode)](#category-b--threshold-required-personalized-mode)
  - [B1. Set a provider threshold](#b1-set-a-provider-threshold)
  - [B2. RULE_PERSONALIZED_HIGH](#b2-rule_personalized_high)
  - [B3. RULE_PERSONALIZED_LOW](#b3-rule_personalized_low)
  - [B4. Edge case — threshold present but <7 readings](#b4-edge-case--threshold-present-but-7-readings)
  - [B5. Edge case — threshold required but not set + payload sent anyway](#b5-edge-case--threshold-required-but-not-set--payload-sent-anyway)
- [5. Boundary tests](#5-boundary-tests)
- [6. Layer-A gate + auth errors](#6-layer-a-gate--auth-errors)
- [7. Quick-reference matrix](#7-quick-reference-matrix)

---

## 0. Prerequisites

| Item | Value |
|---|---|
| Backend port | `http://localhost:4000` |
| API prefix | `/api` (every route is prefixed) |
| Database | Fresh seed: `cd backend && npx prisma migrate reset --force && npx prisma db seed` |
| Seeded patients | priya, james, rita, charles, aisha (`@cardioplace.test`) |
| Seeded admins | `manisha.patel@cardioplace.test` (SUPER_ADMIN), `medical-director@cardioplace.test` (MEDICAL_DIRECTOR), `primary-provider@cardioplace.test` (PROVIDER) |
| OTP for every seed user | **`666666`** |
| Today's date for time-sensitive cases | `2026-04-23` (or whatever `Date.now()` is when you test — payloads use `now` ISO timestamps) |

**One-time DB reset** before a full test pass:
```bash
cd backend
npx prisma migrate reset --force
npx prisma db seed
npm run start:dev
```

---

## 1. Postman environment setup

Create a Postman environment named `cardioplace-dev` with these variables:

| Variable | Initial value |
|---|---|
| `baseUrl` | `http://localhost:4000` |
| `accessToken` | *(empty — populated by step 2)* |
| `patientUserId` | *(empty — populated after login)* |
| `mdAccessToken` | *(empty — for MD/admin scenarios)* |
| `entryId` | *(empty — populated after each `POST /daily-journal`)* |

In every request, set:
- **Header**: `Content-Type: application/json`
- **Header**: `Authorization: Bearer {{accessToken}}` (or `{{mdAccessToken}}` for admin endpoints)

---

## 2. Authentication — get a JWT

Every alert scenario needs a patient JWT.

### 2.1 Send OTP

`POST {{baseUrl}}/api/v2/auth/otp/send`

```json
{
  "email": "priya.menon@cardioplace.test"
}
```

Expected: `200` `{ "message": "OTP sent", "ttlMinutes": 10 }`. The OTP for seed users is always `666666`.

### 2.2 Verify OTP → save token

`POST {{baseUrl}}/api/v2/auth/otp/verify`

```json
{
  "email": "priya.menon@cardioplace.test",
  "otp": "666666"
}
```

Expected: `200` `{ "accessToken": "eyJ...", "refreshToken": "...", "userId": "...", "onboarding_required": false, "roles": ["PATIENT"], ... }`

In Postman, add this **Test script** to auto-save:
```js
const r = pm.response.json();
pm.environment.set('accessToken', r.accessToken);
pm.environment.set('patientUserId', r.userId);
```

Repeat with `medical-director@cardioplace.test` to populate `mdAccessToken` (use a different env or temporarily swap `accessToken`).

### 2.3 Verify the token works

`GET {{baseUrl}}/api/v2/auth/me`

Expected: `200` with `{ id, email, name, roles, ... }`.

---

## 3. Helper endpoints (run before scenario testing)

Three reads you'll repeat constantly:

### 3.1 List your alerts (verify what fired)

`GET {{baseUrl}}/api/daily-journal/alerts`

Expected `200` body:
```json
[
  {
    "id": "alert-...",
    "ruleId": "RULE_PREGNANCY_ACE_ARB",
    "tier": "TIER_1_CONTRAINDICATION",
    "dismissible": false,
    "patientMessage": "Your care team needs to review your blood pressure medicine because you are pregnant. Please call your provider today before taking your next dose.",
    "physicianMessage": "Tier 1 — ACE/ARB (Lisinopril, ACE_INHIBITOR) in pregnant patient...",
    "actualValue": null,
    "createdAt": "2026-04-23T...",
    "status": "OPEN",
    "journalEntry": { "id": "...", "systolicBP": 130, "diastolicBP": 82 }
  }
]
```

### 3.2 List your medications (confirm intake state)

`GET {{baseUrl}}/api/me/medications`

Returns `{ data: PatientMedication[] }`.

### 3.3 List your profile (confirm intake state)

`GET {{baseUrl}}/api/me/profile`

Returns `{ data: PatientProfile | null }`. If `null`, you must run intake before `/daily-journal` will accept entries (Layer A gate, see §6).

---

## 4. The base scenario flow (every test follows this)

For every scenario in Categories A and B:

1. **Pre-conditions** — log in as the right patient (or set up a fresh test patient with the listed profile/meds).
2. **Trigger** — `POST {{baseUrl}}/api/daily-journal` with the scenario's payload.
3. **Expected response** — `202 Accepted` with body `{ statusCode: 202, message: "Journal entry accepted...", data: { id: "<entryId>", ... } }`. Save `data.id` into `{{entryId}}`.
4. **Verify alert** — wait ~500ms (alert engine is event-driven, async), then `GET {{baseUrl}}/api/daily-journal/alerts`. Find the row for this `journalEntryId` and assert the fields listed under "Expected DeviationAlert" for the scenario.
5. **Optional negative test** — apply the "Failure case" tweak (one-line input change) and confirm the alert outcome flips.

**Common payload shape** for all scenarios:
```json
{
  "measuredAt": "2026-04-23T10:00:00.000Z",
  "systolicBP": 130,
  "diastolicBP": 82,
  "pulse": 78,
  "position": "SITTING",
  "measurementConditions": {
    "noCaffeine": true,
    "noSmoking": true,
    "noExercise": true,
    "bladderEmpty": true,
    "seatedQuietly": true,
    "posturalSupport": true,
    "notTalking": true,
    "cuffOnBareArm": true
  }
}
```

Replace `measuredAt` with the current ISO timestamp on each call. The backend rejects readings >30 days old or >5 minutes in the future.

---

# Category A — No threshold needed

These scenarios fire on the engine's **STANDARD** thresholds. No `PatientThreshold` row required, no provider involvement before testing. All 5 seeded patients are pre-loaded with profiles + meds calibrated to trigger specific rules.

## A1. Tier 1 contraindications

Tier 1 is non-dismissable, fires regardless of BP, takes precedence over BP-level rules.

### Scenario 1 — Pregnancy + ACE inhibitor

| Field | Value |
|---|---|
| Patient | `priya.menon@cardioplace.test` |
| Pre-conditions | Profile: `isPregnant=true`, `historyPreeclampsia=true`. Meds: Lisinopril ACE_INHIBITOR VERIFIED. (All seeded — no setup needed.) |
| Endpoint | `POST {{baseUrl}}/api/daily-journal` |

Payload:
```json
{
  "measuredAt": "2026-04-23T10:00:00.000Z",
  "systolicBP": 130,
  "diastolicBP": 82,
  "pulse": 78,
  "position": "SITTING"
}
```

**Expected response:** `202` with `data.id` (save as `{{entryId}}`).

**Expected DeviationAlert (verify via `GET /api/daily-journal/alerts`):**
- `ruleId: "RULE_PREGNANCY_ACE_ARB"`
- `tier: "TIER_1_CONTRAINDICATION"`
- `dismissible: false`
- `severity: "HIGH"`
- `pulsePressure: null`
- `patientMessage` contains `"blood pressure medicine"` AND `"pregnant"`
- `physicianMessage` contains `"Teratogenic"` AND `"Lisinopril"`

**Failure case:** Sign in as `aisha.johnson@cardioplace.test` (not pregnant), same payload → no Tier 1 row.

---

### Scenario 2 — HFrEF + NDHP-CCB

| Field | Value |
|---|---|
| Patient | `james.okafor@cardioplace.test` |
| Pre-conditions | Profile: `hasHeartFailure=true`, `heartFailureType=HFREF`. Meds: Diltiazem (NDHP_CCB) + Carvedilol (BB). All seeded. |

Payload:
```json
{
  "measuredAt": "2026-04-23T10:00:00.000Z",
  "systolicBP": 118,
  "diastolicBP": 74,
  "pulse": 68,
  "position": "SITTING"
}
```

**Expected DeviationAlert:**
- `ruleId: "RULE_NDHP_HFREF"`, `tier: "TIER_1_CONTRAINDICATION"`, `dismissible: false`
- `physicianMessage` contains `"Nondihydropyridine CCB"` + `"Diltiazem"` + `"HFrEF"`

**Failure case:** Switch profile to HFPEF via admin endpoint → no Tier 1.

---

### Scenario 3 — Pregnancy + UNVERIFIED ACE (safety net)

Custom setup needed (priya is pre-verified). Skip unless testing safety-net specifically — covered by Jest unit test.

---

## A2. BP Level 2 emergency

### Scenario 4 — Absolute emergency (190/105)

| Patient | Sign in as any seeded user with diagnosed HTN, e.g. `aisha.johnson@cardioplace.test` |

Payload:
```json
{
  "measuredAt": "2026-04-23T10:00:00.000Z",
  "systolicBP": 190,
  "diastolicBP": 105,
  "pulse": 88,
  "position": "SITTING"
}
```

**Expected DeviationAlert:**
- `ruleId: "RULE_ABSOLUTE_EMERGENCY"`, `tier: "BP_LEVEL_2"`, `dismissible: false`, `pulsePressure: 85`
- `patientMessage` contains `"190/105"` AND `/911/`
- `physicianMessage.toLowerCase()` contains `"pulse pressure"` (wide-PP annotation rides along)

**Failure case:** SBP 179 + DBP 119 → both cutoffs missed → falls to BP L1 High (RULE_STANDARD_L1_HIGH only if SBP≥160).

---

### Scenario 6 — Pregnancy L2 (165/112)

| Patient | `priya.menon@cardioplace.test` |

Payload:
```json
{
  "measuredAt": "2026-04-23T10:00:00.000Z",
  "systolicBP": 165,
  "diastolicBP": 112,
  "pulse": 90,
  "position": "SITTING"
}
```

⚠ **Caveat:** Priya is also on Lisinopril → the Tier 1 short-circuit fires `RULE_PREGNANCY_ACE_ARB` first (Scenario 51 from `ALERT_SCENARIOS.md`). To isolate `RULE_PREGNANCY_L2`, create your own pregnant test patient WITHOUT an ACE/ARB medication.

If Tier 1 short-circuits: **Expected** `RULE_PREGNANCY_ACE_ARB` (this is correct precedence — Scenario 51).

If using a clean pregnant patient (no ACE/ARB med):
- `ruleId: "RULE_PREGNANCY_L2"`, `tier: "BP_LEVEL_2"`
- `patientMessage` contains `"165/112"` + `"pregnancy"`
- `physicianMessage` contains `"ACOG"`

---

## A3. Symptom overrides

Symptom overrides fire BP Level 2 at *any* BP. Six general symptoms + 3 pregnancy-specific.

### Scenario 5 — Severe headache at 122/76

| Patient | `aisha.johnson@cardioplace.test` |

Payload:
```json
{
  "measuredAt": "2026-04-23T10:00:00.000Z",
  "systolicBP": 122,
  "diastolicBP": 76,
  "pulse": 74,
  "position": "SITTING",
  "severeHeadache": true
}
```

**Expected:**
- `ruleId: "RULE_SYMPTOM_OVERRIDE_GENERAL"`, `tier: "BP_LEVEL_2_SYMPTOM_OVERRIDE"`, `dismissible: false`
- `patientMessage` contains `"122/76"` + `/911/`
- `physicianMessage` contains `"severe headache"`

**Failure case:** Move "severe headache" to free-text `otherSymptoms: ["severe headache"]` and unset the typed flag → null. Confirms the rule reads the typed flag, not free-text.

### Scenarios 39–43 — Other typed symptoms

Same payload pattern, swap the flag. All six fire `RULE_SYMPTOM_OVERRIDE_GENERAL` at any BP:

| Flag in payload | Expected `physicianMessage` substring |
|---|---|
| `"severeHeadache": true` | `"severe headache"` |
| `"visualChanges": true` | `"visual changes"` |
| `"alteredMentalStatus": true` | — (any of the 6 substrings) |
| `"chestPainOrDyspnea": true` | `"chest pain or dyspnea"` |
| `"focalNeuroDeficit": true` | — |
| `"severeEpigastricPain": true` | — |

### Scenario 22 — Pregnancy RUQ pain

| Patient | `priya.menon@cardioplace.test` |

Payload includes `"ruqPain": true` + BP `128/82`. **Expected:** `RULE_SYMPTOM_OVERRIDE_PREGNANCY`. ⚠ Same Tier 1 caveat as Scenario 6.

### Scenarios 44, 45 — Pregnancy-specific symptoms

| Flag | BP | Patient | Expected |
|---|---|---|---|
| `newOnsetHeadache: true` | 125/75 | pregnant patient w/o ACE/ARB | `RULE_SYMPTOM_OVERRIDE_PREGNANCY` |
| `edema: true` | 110/70 | pregnant patient w/o ACE/ARB | `RULE_SYMPTOM_OVERRIDE_PREGNANCY` |

---

## A4. BP Level 1 High (standard + condition branches)

### Scenario 7 — Pregnancy L1 High (144/88)

| Patient | clean pregnant patient w/o ACE/ARB |

Payload `144/88, pulse 82`. **Expected:** `RULE_PREGNANCY_L1_HIGH`, `tier: "BP_LEVEL_1_HIGH"`, `dismissible: true`. `patientMessage` contains `"144/88"`. `physicianMessage` contains `"preeclampsia"`.

### Scenario 9 — AFib + 3 readings + HR 115

| Patient | `charles.brown@cardioplace.test` |

This requires **3 readings in the same session** (AFib gate). Charles is configured for this — log the same payload 3 times within a 30-min window:

Payload (run 3×, increment `measuredAt` by 1 minute each time, same `sessionId` UUID):
```json
{
  "measuredAt": "2026-04-23T10:00:00.000Z",
  "systolicBP": 130,
  "diastolicBP": 76,
  "pulse": 115,
  "position": "SITTING",
  "sessionId": "00000000-0000-4000-8000-000000000001"
}
```

After the 3rd reading the engine recomputes and produces:
- `ruleId: "RULE_AFIB_HR_HIGH"`, `tier: "BP_LEVEL_1_HIGH"`
- `patientMessage` contains `"HR 115 bpm"`
- `physicianMessage` contains `"AFib"`

**Failure case:** Send only 1 reading → `GET /alerts` returns no row (gate closed; Scenario 17).

### Scenarios 24–30 — Condition-specific BP L1 High (162 SBP)

Same payload pattern, sign in as the matching seed patient:

| Patient | Profile | Payload SBP/DBP | Expected ruleId |
|---|---|---|---|
| `james.okafor` | HFrEF | 162/88 | `RULE_HFREF_HIGH` |
| custom HFpEF patient | HFpEF | 162/88 | `RULE_HFPEF_HIGH` |
| `rita.washington` | CAD | 162/82 | `RULE_CAD_HIGH` |
| custom HCM patient (no DHP-CCB) | HCM | 162/88 | `RULE_HCM_HIGH` |
| custom DCM patient | DCM only | 162/88 | `RULE_DCM_HIGH` |

⚠ James + 162/88 fires `RULE_NDHP_HFREF` (Tier 1) first because he has Diltiazem. To get `RULE_HFREF_HIGH` clean, create a custom HFrEF patient without NDHP meds.

### Scenario 15 — Standard L1 High + wide-PP annotation

| Patient | `aisha.johnson@cardioplace.test` |

Payload `172/88` (PP = 84). **Expected:** `RULE_STANDARD_L1_HIGH`, `pulsePressure: 84`, `physicianMessage` contains `"Wide pulse pressure: 84 mmHg"`. `patientMessage.toLowerCase()` does NOT contain `"pulse pressure"` (rides on physician message only).

### Scenario 20 — Suboptimal measurement + retake suffix

Add `"measurementConditions": { "noCaffeine": false, ... }` (any item set to false → suboptimal).

Payload `164/96` with one false in the checklist. **Expected:** `RULE_STANDARD_L1_HIGH`, `suboptimalMeasurement: true`, `patientMessage.toLowerCase()` contains `"retake"`.

### Scenario 52 — Boundary: SBP=160 fires

Payload `160/95` → fires `RULE_STANDARD_L1_HIGH`. Drop SBP to 159 → null.

---

## A5. BP Level 1 Low

### Scenario 8 — CAD + DBP critical

| Patient | `rita.washington@cardioplace.test` |

Payload `132/68, pulse 66`. **Expected:** `RULE_CAD_DBP_CRITICAL`, `type: "DIASTOLIC_BP"`. `patientMessage` contains `"132/68"` + `"lower number"`. `physicianMessage` contains `"J-curve"`.

**Failure case:** DBP 70 → strict `<70` fails → null.

### Scenarios 10, 11, 23, 27, 29, 32, 33, 36 — condition-specific lows

| Patient setup | Payload | Expected |
|---|---|---|
| HFpEF (custom) | 106/70 pulse 76 | `RULE_HFPEF_LOW` |
| Age 65+ (custom DOB 1953-01-01) | 96/58 pulse 70 | `RULE_AGE_65_LOW` (patientMessage: `"dizziness"` + `"fall risk"`) |
| HFrEF (custom, no NDHP) | 82/55 | `RULE_HFREF_LOW` |
| HCM (custom, no risky med) | 98/64 | `RULE_HCM_LOW` |
| DCM only (custom) | 82/55 | `RULE_DCM_LOW` |
| Age 40-64 default | 88/58 | `RULE_STANDARD_L1_LOW` |
| AFib + 3 readings | pulse 48 | `RULE_AFIB_HR_LOW` (3-reading session) |
| Bradycardia (custom) | pulse 38 | `RULE_BRADY_HR_ASYMPTOMATIC` |

---

## A6. Heart-rate branches

Already covered above (Scenarios 9, 33, 36). One additional case:

### Scenario 34 — Tachycardia + consecutive elevation

| Patient | custom with `hasTachycardia: true` |

Two-step setup (consecutive readings):

1. Log a reading with pulse 102 (any BP) — this is the "prior" reading.
2. Log a SECOND reading with pulse 105.

**Expected on the 2nd reading:** `RULE_TACHY_HR`, `tier: "BP_LEVEL_1_HIGH"`.

**Failure case:** prior reading pulse 80 → consecutive-elevation gate closes → null.

---

## A7. Tier 3 physician-only

Tier 3 alerts have **`patientMessage: ""` and `caregiverMessage: ""`** — patient sees nothing. Verify by checking the `physicianMessage` only.

### Scenario 14 — HCM + Amlodipine (DHP vasodilator)

| Patient | custom with `hasHCM: true` + Amlodipine med |

Payload `128/82, pulse 72`. **Expected:** `RULE_HCM_VASODILATOR`, `tier: "TIER_3_INFO"`, `dismissible: true`. `patientMessage === ""` AND `caregiverMessage === ""`. `physicianMessage` contains `"HCM"` + `"Amlodipine"` + `"LVOT"`.

### Scenario 37 — Wide pulse pressure standalone

| Patient | any default |

Payload `145/80, pulse 74` (PP = 65). **Expected:** `RULE_PULSE_PRESSURE_WIDE`, `tier: "TIER_3_INFO"`, `pulsePressure: 65`, `patientMessage: ""`.

### Scenario 38 — Loop diuretic + low-normal SBP

| Patient | custom with Furosemide LOOP_DIURETIC med |

Payload `92/60, pulse 72`. **Expected:** `RULE_LOOP_DIURETIC_HYPOTENSION`, `tier: "TIER_3_INFO"`, `patientMessage: ""`.

---

## A8. Tier 2 medication adherence (NEW — phase/post-merge)

The most-recently-added rule. Fires when the patient self-reports a missed dose. Two ways to trigger:

### Scenario 60 — Generic missed-dose (no per-medication detail)

Payload (any patient with diagnosed HTN):
```json
{
  "measuredAt": "2026-04-23T10:00:00.000Z",
  "systolicBP": 124,
  "diastolicBP": 78,
  "pulse": 72,
  "position": "SITTING",
  "medicationTaken": false
}
```

**Expected:**
- `ruleId: "RULE_MEDICATION_MISSED"`, `tier: "TIER_2_DISCREPANCY"`, `dismissible: true`, `severity: "MEDIUM"`, `type: "MEDICATION_ADHERENCE"`
- `patientMessage.toLowerCase()` contains `"didn't take your medication"`
- `physicianMessage` contains `"Tier 2"` + `"no medication specified"`

### Scenario 61 — Per-medication miss

Payload:
```json
{
  "measuredAt": "2026-04-23T10:00:00.000Z",
  "systolicBP": 124,
  "diastolicBP": 78,
  "pulse": 72,
  "position": "SITTING",
  "medicationTaken": true,
  "missedMedications": [
    {
      "medicationId": "<a real PatientMedication.id from GET /api/me/medications>",
      "drugName": "Lisinopril",
      "drugClass": "ACE_INHIBITOR",
      "reason": "FORGOT",
      "missedDoses": 1
    }
  ]
}
```

**Expected:**
- `ruleId: "RULE_MEDICATION_MISSED"`, `tier: "TIER_2_DISCREPANCY"`
- `patientMessage` contains `"Lisinopril"`
- `physicianMessage` contains `"Lisinopril"` + `"ACE_INHIBITOR"` + `"FORGOT"` + `"doses missed: 1"`

### Scenario 62 — Co-occurrence: BP L1 High + missed med (TWO alert rows)

Payload `165/94 + medicationTaken: false` for Aisha.

**Expected:** `GET /api/daily-journal/alerts` returns **TWO** rows for the same `journalEntryId`:
1. `ruleId: "RULE_STANDARD_L1_HIGH"`, `type: "SYSTOLIC_BP"`, `tier: "BP_LEVEL_1_HIGH"`
2. `ruleId: "RULE_MEDICATION_MISSED"`, `type: "MEDICATION_ADHERENCE"`, `tier: "TIER_2_DISCREPANCY"`

This confirms the engine's two-pass behavior — BP pipeline AND adherence pipeline run independently.

---

## A9. No-alert (control) cases

### Scenario 16 — Controlled benign 124/78 + resolves open L1

| Patient | `aisha.johnson@cardioplace.test` |

Payload `124/78, pulse 70, medicationTaken: true`. **Expected:** no new alert row created. Any prior `OPEN` rows with `tier IN ('BP_LEVEL_1_HIGH','BP_LEVEL_1_LOW')` get auto-resolved to `status: "RESOLVED"`.

To verify resolve-sweep: first fire a BP L1 alert (Scenario 52), then send a benign reading. The L1 row's status should flip to `RESOLVED`. Tier 1, BP L2, Tier 2, Tier 3 rows are preserved.

### Scenario 17 — AFib + 1 reading + pulse 118 (gate closed)

| Patient | `charles.brown@cardioplace.test` |

Payload `135/82, pulse 118` (one reading, no `sessionId`). **Expected:** no row. Drop the AFib gate by adding 2 more prior readings → gate opens.

### Scenario 19 — BB suppression (pulse 55)

| Patient | custom with `hasBradycardia: true` + BB med |

Payload `118/72, pulse 55` (within BB suppression window 50–60). **Expected:** no row. Drop pulse to 38 → fires `RULE_BRADY_HR_ASYMPTOMATIC`.

---

# Category B — Threshold required (PERSONALIZED mode)

Only **TWO** rules in the engine require a provider-set `PatientThreshold`:
- `RULE_PERSONALIZED_HIGH` — fires when `SBP ≥ sbpUpperTarget + 20` AND `readingCount ≥ 7`
- `RULE_PERSONALIZED_LOW` — fires when `SBP < sbpLowerTarget` AND `readingCount ≥ 7`

Everything else falls back to STANDARD thresholds. The "edge case" the spec covers thoroughly: **what if you have a threshold but <7 prior readings?** → engine falls back to STANDARD with a pre-Day-3 disclaimer suffix.

## B1. Set a provider threshold

Sign in as a Medical Director (only `MEDICAL_DIRECTOR` and `SUPER_ADMIN` can write thresholds; `PROVIDER` cannot):

`POST {{baseUrl}}/api/v2/auth/otp/send` with `medical-director@cardioplace.test`.
`POST {{baseUrl}}/api/v2/auth/otp/verify` with OTP `666666`.
Save token as `{{mdAccessToken}}`.

Then set the threshold (replace `:patientId` with `{{patientUserId}}` of your test patient):

`POST {{baseUrl}}/api/admin/patients/:patientId/threshold`
Authorization: `Bearer {{mdAccessToken}}`

```json
{
  "sbpUpperTarget": 130,
  "sbpLowerTarget": 90,
  "dbpUpperTarget": null,
  "dbpLowerTarget": null,
  "hrUpperTarget": null,
  "hrLowerTarget": null,
  "notes": "Clinical visit 2026-04-15 — target tightened from 140."
}
```

**Expected `200`** with the row reflected back. Confirm via `GET {{baseUrl}}/api/me/threshold` (with patient JWT).

## B2. RULE_PERSONALIZED_HIGH

**Pre-conditions:**
1. Patient with `diagnosedHypertension: true`
2. Threshold set (B1) with `sbpUpperTarget: 130`
3. **At least 7 prior journal entries** (the `readingCount ≥ 7` gate)

**Building 7 prior readings**: log 7 normal readings via `POST /api/daily-journal` first. They can be benign (e.g. 124/78). The 8th call is the trigger.

Trigger payload (the 8th call):
```json
{
  "measuredAt": "2026-04-23T10:00:00.000Z",
  "systolicBP": 152,
  "diastolicBP": 88,
  "pulse": 76,
  "position": "SITTING"
}
```

**Why 152?** `sbpUpperTarget + 20 = 150`. SBP 152 ≥ 150 → fires personalized. SBP 149 → does NOT fire personalized (below threshold + 20).

**Expected DeviationAlert:**
- `ruleId: "RULE_PERSONALIZED_HIGH"`, `tier: "BP_LEVEL_1_HIGH"`, `mode: "PERSONALIZED"`
- `patientMessage` contains `"target"`
- `physicianMessage` contains `"target + 20"`

## B3. RULE_PERSONALIZED_LOW

**Pre-conditions:** same patient as B2, but with `sbpLowerTarget: 110` set on the threshold:

Re-`POST /api/admin/patients/:patientId/threshold`:
```json
{
  "sbpUpperTarget": 130,
  "sbpLowerTarget": 110,
  "dbpUpperTarget": null,
  "dbpLowerTarget": null
}
```

Trigger payload (with ≥7 prior readings already on file):
```json
{
  "measuredAt": "2026-04-23T10:00:00.000Z",
  "systolicBP": 108,
  "diastolicBP": 70,
  "pulse": 72,
  "position": "SITTING"
}
```

**Expected DeviationAlert:**
- `ruleId: "RULE_PERSONALIZED_LOW"`, `tier: "BP_LEVEL_1_LOW"`, `mode: "PERSONALIZED"`

## B4. Edge case — threshold present but <7 readings

**Pre-conditions:** Patient with diagnosed HTN, threshold set (B1), but only **3** prior readings (don't pre-log 7).

Trigger payload:
```json
{
  "measuredAt": "2026-04-23T10:00:00.000Z",
  "systolicBP": 165,
  "diastolicBP": 94,
  "pulse": 82,
  "position": "SITTING"
}
```

**Expected DeviationAlert:**
- `ruleId: "RULE_STANDARD_L1_HIGH"` ← **NOT personalized**
- `tier: "BP_LEVEL_1_HIGH"`, `mode: "STANDARD"` ← falls back
- `patientMessage` matches `/personalization begins after Day 3/i` ← pre-Day-3 disclaimer

This is the engine's correct safety behavior: don't apply personalized thresholds when the trend baseline is too thin.

## B5. Edge case — threshold required but not set + payload sent anyway

This is the question you specifically asked. **Answer: there is no error.** The personalized rules just don't fire; the engine falls back to STANDARD rules.

**Pre-conditions:**
- Patient with `diagnosedHypertension: true`
- **No threshold set** (`PatientThreshold` row absent — verify via `GET {{baseUrl}}/api/me/threshold` returns `null`)
- ≥7 prior readings (or any count — doesn't matter)

Trigger payload:
```json
{
  "measuredAt": "2026-04-23T10:00:00.000Z",
  "systolicBP": 152,
  "diastolicBP": 88,
  "pulse": 76,
  "position": "SITTING"
}
```

**Expected DeviationAlert:**
- **No row** is created.
- Reasoning: SBP 152 < 160 (the standard L1 High cutoff). Without a threshold, personalized rule cannot fire (no targets to compare against). Standard rule needs SBP ≥ 160. So nothing fires.

**To prove standard rules still work** (no threshold needed for them), repeat with SBP 165:
- `ruleId: "RULE_STANDARD_L1_HIGH"`, `mode: "STANDARD"`. Fires normally.

**Verify via response shape:** `GET {{baseUrl}}/api/me/threshold` should return:
```json
{ "data": null, "message": "No threshold set" }
```

The engine's behavior is **never to error out** when threshold is missing. It silently falls through to STANDARD evaluation. This is by design — STANDARD rules are the safety floor; PERSONALIZED is the upgrade.

---

# 5. Boundary tests

These confirm the engine's strict comparison operators (`<` vs `≤`):

| TC | Reading | Expected |
|---|---|---|
| Standard SBP=160 boundary | 160/95 | fires `RULE_STANDARD_L1_HIGH` (≥160) |
| Standard SBP=159 | 159/95 | no alert (<160) |
| Standard SBP=90 boundary | 90/— | no alert (strict <90) |
| Standard SBP=89 | 89/— | fires `RULE_STANDARD_L1_LOW` |
| Age 65+ + SBP=100 | 100/— | no alert (strict <100) |
| Age 65+ + SBP=99 | 99/— | fires `RULE_AGE_65_LOW` |
| CAD + DBP=70 | 130/70 | no alert (strict <70) |
| CAD + DBP=69 | 130/69 | fires `RULE_CAD_DBP_CRITICAL` |
| Pulse pressure boundary 60 | 140/80 (PP=60) | no alert (strict >60) |
| Pulse pressure 65 | 145/80 (PP=65) | fires `RULE_PULSE_PRESSURE_WIDE` |
| Personalized SBP threshold +20 | upper=130, SBP=149 | no alert (<150) |
| Personalized SBP threshold +20 | upper=130, SBP=150 | fires `RULE_PERSONALIZED_HIGH` |

---

# 6. Layer-A gate + auth errors

### 6.1 No clinical intake → 403

Sign in as a brand-new patient (e.g., `you+brand-new@healplace.com`) who has **NOT** completed intake. Send any `POST /api/daily-journal` payload.

**Expected `403`:**
```json
{
  "statusCode": 403,
  "message": "clinical-intake-required",
  "reason": "Complete your clinical intake before logging readings so your care team has the context to interpret them."
}
```

This is the Layer A gate — patients must have a `PatientProfile` row before journaling. Run `POST /api/intake/profile` to clear the gate.

### 6.2 Missing JWT → 401

Drop the `Authorization` header on `POST /api/daily-journal`. **Expected `401 Unauthorized`.**

### 6.3 Wrong role for admin endpoint

Sign in as a `PATIENT`. Try `POST /api/admin/patients/:patientId/threshold`. **Expected `403 Forbidden`.**

### 6.4 Validation errors

| Bad payload | Expected response |
|---|---|
| `measuredAt` 31 days in past | `400` — validator complains about `isMeasuredAtReasonable` |
| `systolicBP: 251` | `400` — validator (60–250 range) |
| `diastolicBP: 39` | `400` — validator (40–150) |
| `pulse: 30` | `400` — validator (30–220 inclusive of 30 — should pass; try 29 for fail) |
| `medicationTaken: "yes"` (string instead of bool) | `400` |
| `missedMedications: [{ reason: "INVALID_REASON", ... }]` | `400` — IsEnum |
| `missedMedications: [{ ..., missedDoses: 0 }]` | `400` — Min(1) |

---

# 7. Quick-reference matrix

For a fast read of "what should I send / what should I see":

| # | Patient | Pre-conditions | Reading payload | Expected ruleId | Tier | Threshold? |
|---|---|---|---|---|---|---|
| 1 | priya | Pregnant + ACE | 130/82 p78 | `RULE_PREGNANCY_ACE_ARB` | TIER_1 | ❌ |
| 2 | james | HFrEF + NDHP | 118/74 p68 | `RULE_NDHP_HFREF` | TIER_1 | ❌ |
| 4 | aisha | HTN | 190/105 p88 | `RULE_ABSOLUTE_EMERGENCY` | BP_L2 | ❌ |
| 5 | aisha | HTN | 122/76 p74 + `severeHeadache` | `RULE_SYMPTOM_OVERRIDE_GENERAL` | BP_L2_SYM | ❌ |
| 6 | clean pregnant | Pregnant (no ACE) | 165/112 | `RULE_PREGNANCY_L2` | BP_L2 | ❌ |
| 7 | clean pregnant | Pregnant | 144/88 | `RULE_PREGNANCY_L1_HIGH` | BP_L1_HIGH | ❌ |
| 8 | rita | CAD | 132/68 p66 | `RULE_CAD_DBP_CRITICAL` | BP_L1_LOW | ❌ |
| 9 | charles | AFib + 3 readings | 130/76 p115 (×3) | `RULE_AFIB_HR_HIGH` | BP_L1_HIGH | ❌ |
| 11 | custom 65+ | Age 65+ | 96/58 p70 | `RULE_AGE_65_LOW` | BP_L1_LOW | ❌ |
| **12** | **custom + threshold + 7 readings** | **diagnosedHTN + threshold(130/90)** | **152/88** | `RULE_PERSONALIZED_HIGH` | BP_L1_HIGH | **✅** |
| **13** | **custom + threshold + 3 readings** | **diagnosedHTN + threshold(130/90)** | **165/94** | `RULE_STANDARD_L1_HIGH` (pre-Day-3 disclaimer) | BP_L1_HIGH | partial |
| 14 | custom HCM + Amlodipine | hasHCM | 128/82 | `RULE_HCM_VASODILATOR` | TIER_3 | ❌ |
| 15 | aisha | HTN | 172/88 | `RULE_STANDARD_L1_HIGH` + wide-PP | BP_L1_HIGH | ❌ |
| 16 | aisha | HTN | 124/78 (benign) | *no row* + L1 resolve sweep | — | ❌ |
| 17 | charles | AFib + 1 reading | 135/82 p118 | *no row* (gate) | — | ❌ |
| 20 | aisha | HTN + suboptimal | 164/96 + checklist false | `RULE_STANDARD_L1_HIGH` + retake | BP_L1_HIGH | ❌ |
| **31** | **custom + threshold + 7 readings** | **threshold(110, 130)** | **108/70** | `RULE_PERSONALIZED_LOW` | BP_L1_LOW | **✅** |
| 32 | custom 40-64 | default | 88/58 | `RULE_STANDARD_L1_LOW` | BP_L1_LOW | ❌ |
| 36 | custom Brady | hasBradycardia | 115/70 p38 | `RULE_BRADY_HR_ASYMPTOMATIC` | BP_L1_LOW | ❌ |
| 37 | aisha | HTN | 145/80 (PP=65) | `RULE_PULSE_PRESSURE_WIDE` | TIER_3 | ❌ |
| 38 | custom + Furosemide | LOOP_DIURETIC | 92/60 | `RULE_LOOP_DIURETIC_HYPOTENSION` | TIER_3 | ❌ |
| 51 | priya | Pregnant + ACE | 195/130 | `RULE_PREGNANCY_ACE_ARB` (Tier 1 beats L2) | TIER_1 | ❌ |
| 60 | aisha | HTN | 124/78 + `medicationTaken: false` | `RULE_MEDICATION_MISSED` | TIER_2 | ❌ |
| 61 | aisha | HTN | 124/78 + `missedMedications:[{Lisinopril, FORGOT, 1}]` | `RULE_MEDICATION_MISSED` | TIER_2 | ❌ |
| 62 | aisha | HTN | 165/94 + `medicationTaken: false` | **TWO rows: `RULE_STANDARD_L1_HIGH` + `RULE_MEDICATION_MISSED`** | BP_L1 + TIER_2 | ❌ |
| 63 | aisha | HTN | 124/78 + `medicationTaken: true` | *no row* | — | ❌ |
| **B5** | **custom no threshold** | **diagnosedHTN, no threshold** | **152/88** | *no row* (152 < 160 standard) | — | required but absent → graceful no-op |

---

## Practical tips for running this

1. **Use Postman Collections + scripts.** Save each scenario as a saved request, with a Test script that auto-saves `data.id` to `{{entryId}}` and then chains a `GET /api/daily-journal/alerts` call.
2. **Reset DB between major suites.** The 7-reading prerequisite for Category B accumulates state. Run `npx prisma migrate reset --force && npx prisma db seed` between suites if assertions start failing.
3. **The alert is async.** `POST /api/daily-journal` returns `202` before the engine evaluates. Add a 500ms delay or a retry loop on the `GET /alerts` call.
4. **Capture `entryId` and use it for resolution tests.** Each `DeviationAlert` row links via `journalEntryId` — handy for asserting which row belongs to which test.
5. **Cross-reference `ALERT_SCENARIOS.md`** when in doubt — every scenario in this guide has a matching Jest case there with the exact assertion list.
6. **Don't run this against the shared dev DB.** Per `TESTING_FLOW_GUIDE.md` §15.3, every tester needs their own Postgres DB. Cross-tester interference will break Category B's prior-reading-count gating.

---

## Where to file bugs

If a scenario doesn't match the expected output:
- **Wrong ruleId fires** → likely a precedence regression. Cross-check `alert-engine.service.ts` rule order (lines 142-202) against the order documented in `ALERT_SCENARIOS.md`.
- **No row at all** → check the 5 short-circuit gates: ProfileNotFoundException (admin user), AFib <3-readings, Symptom override consuming the path, Tier 1 contraindication, BP Level 2.
- **Wrong patientMessage / physicianMessage** → registry issue in `shared/src/alert-messages.ts`. The `OutputGeneratorService` boot-time check ensures every rule has a registry entry, but the wording may have drifted.
- **Personalized rule fires when it shouldn't (or vice versa)** → check `ProfileResolverService.resolve` for `personalizedEligible` (requires threshold + ≥7 readings) and `preDay3Mode` (readingCount<7).

Log issues in your Google Doc tab with: scenario # · patient · payload sent · expected ruleId · actual response body · timestamp.
