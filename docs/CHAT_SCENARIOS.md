# Chat System Prompt Scenarios

End-to-end coverage of what the chatbot reads in its context window. **10 scenarios**, one per Jest case in [system-prompt-scenarios.spec.ts](../backend/src/chat/services/system-prompt-scenarios.spec.ts).

Each scenario: build a `PatientContext`, render it through the real `SystemPromptService` (`buildSystemPrompt() + buildPatientContext()`), assert the output contains the expected substrings. Input column = what we pass in. Expected column = substrings the rendered prompt must contain.

---

## Seed archetype scenarios

| # | Input (patient setup) | Expected (substrings in prompt) |
|---|---|---|
| 1 | Pregnant · history preeclampsia · Lisinopril (ACE) · active `TIER_1_CONTRAINDICATION` / `RULE_PREGNANCY_ACE_ARB` (non-dismissable) | `Currently pregnant` · `Lisinopril (ACE_INHIBITOR)` · `TIER_1_CONTRAINDICATION` · `NON-DISMISSABLE` · verbatim `patientMessage` |
| 2 | HFrEF · Diltiazem (NDHP) + Carvedilol · active Tier 1 / `RULE_NDHP_HFREF` | `Heart failure (HFrEF)` · `Diltiazem (NDHP_CCB)` · `Carvedilol (BETA_BLOCKER)` · verbatim `patientMessage` |
| 3 | CAD · Amlodipine + Metoprolol + Atorvastatin · active `BP_LEVEL_1_LOW` / `RULE_CAD_DBP_CRITICAL` | `Coronary artery disease (CAD)` · `BP_LEVEL_1_LOW` · `RULE_CAD_DBP_CRITICAL` · verbatim `patientMessage` |
| 4 | AFib · Apixaban + Metoprolol · active `BP_LEVEL_1_HIGH` / `RULE_AFIB_HR_HIGH` | `Atrial fibrillation (AFib)` · `Apixaban (ANTICOAGULANT)` · `RULE_AFIB_HR_HIGH` · `HR 115 bpm` |
| 5 | Diagnosed HTN · Lisinopril + Amlodipine · no active alerts | `Hypertension (on treatment)` · `Lisinopril (ACE_INHIBITOR)` · `Amlodipine (DHP_CCB)` · `Active alerts: None` |

## Edge-path scenarios

| # | Input (patient setup) | Expected (substrings in prompt) |
|---|---|---|
| 6 | Pregnant · profile `UNVERIFIED` · Lisinopril `UNVERIFIED` · active Tier 1 | `awaiting provider verification` · `⚠ unverified` · `RULE_PREGNANCY_ACE_ARB` |
| 7 | `readingCount = 3` (pre-Day-3 mode) | `fewer than 7 readings` · `3 total` · `personalization begins after Day 3` |
| 8 | 8 active alerts supplied to renderer | `Active alerts (8, most recent first)` (cap-to-5 is enforced upstream in `chat.service.ts`) |
| 9 | Active `TIER_3_INFO` / `RULE_PULSE_PRESSURE_WIDE` (empty patientMessage, physicianMessage only) | `do NOT surface to patient` · `Wide pulse pressure` |
| 10 | Admin user · `resolvedContext = null` | `Clinical profile: not available` · NO `Cardiac conditions:` · NO `Medications:` · NO `Provider-set` |

## Always present in every rendered prompt (regression guards)

- `Never suggest starting, stopping, changing, or adjusting any medication`
- `Tier 1 Contraindication` · `contact their provider today`
- `BP Level 2 emergency` · `call 911`
- `use the alert's patientMessage verbatim`
- `Do not invent new clinical advice`
- `TONE — patient mode`

---

## How to run

From `C:\Users\LENOVO\Desktop\Work-New\cardioplace-v2\backend>` on Windows cmd:

```cmd
node --experimental-vm-modules ..\node_modules\jest\bin\jest.js system-prompt-scenarios
```

Expected: `Tests: 10 passed, 10 total`.

Add `--verbose` to see each scenario name printed — they map 1-to-1 to the rows above.
