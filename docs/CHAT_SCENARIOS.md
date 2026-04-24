# Chat System Prompt Scenarios

End-to-end coverage of the system prompt the chatbot sees in its context window. **10 scenarios**, one per Jest case in [system-prompt-scenarios.spec.ts](../backend/src/chat/services/system-prompt-scenarios.spec.ts).

Each scenario is **self-contained for QA**: the `PatientContext` it builds, the substrings the rendered prompt must contain, the single input tweak that flips the outcome, and a manual-verification recipe. A QA engineer should be able to reproduce any scenario against the live backend from this doc alone — without opening the spec file.

**Automated coverage:**
```cmd
cd backend
node --experimental-vm-modules ..\node_modules\jest\bin\jest.js system-prompt-scenarios
```
Expected: `Tests: 10 passed, 10 total`. Add `--verbose` to see each scenario name printed 1-to-1 with this doc.

---

## Contents

- [What this spec does (and doesn't) test](#what-this-spec-does-and-doesnt-test)
- [Default fixture (applied unless overridden)](#default-fixture-applied-unless-overridden)
- [How to run a scenario against the live backend](#how-to-run-a-scenario-against-the-live-backend)
- [Seed archetype scenarios](#seed-archetype-scenarios)
- [Edge-path scenarios](#edge-path-scenarios)
- [Always-present regression guards](#always-present-regression-guards)

---

## What this spec does (and doesn't) test

**Does test:** that `SystemPromptService.buildSystemPrompt() + buildPatientContext()` renders the expected substrings for each patient shape. The rendering logic itself — condition lines, medication list, alert block, tone-mode guardrails.

**Does not test:** the wider chat pipeline (`ChatService.runToolLoop`, Gemini streaming, RAG retrieval). The alert cap of 5 that `ChatService` enforces via `take: 5` on the Prisma query is NOT in this spec — Scenario 8 here passes 8 alerts straight through, confirming the renderer is dumb and the cap is caller-side.

**Related specs:** [docs/TEST_SCENARIOS.md](TEST_SCENARIOS.md) covers the 182 unit tests for rule engine, profile resolver, session averager, output generator.

---

## Default fixture (applied unless overridden)

Mirrors `patientContext()` + `ctx()` + `profile()` + `med()` + `alert()` helpers at the top of the spec. Every scenario tweaks a small subset; unmentioned values follow these defaults.

### PatientContext
| Field | Default |
|---|---|
| `recentEntries` | `[]` |
| `baseline` | `null` |
| `activeAlerts` | `[]` |
| `communicationPreference` | `'TEXT_FIRST'` |
| `preferredLanguage` | `'en'` |
| `patientName` | `'Test Patient'` |
| `dateOfBirth` | `1980-06-15` (→ `ageGroup='40-64'`) |
| `resolvedContext` | full ctx (see below) |
| `toneMode` | `'PATIENT'` |

### ResolvedContext
| Field | Default |
|---|---|
| `userId` | `'u'` |
| `dateOfBirth` | `1980-06-15` |
| `timezone` | `'America/New_York'` |
| `ageGroup` | `'40-64'` |
| `profile.gender` | `'FEMALE'` |
| `profile.heightCm` | `165` |
| `profile.isPregnant` | `false` |
| `profile.hasHeartFailure` / `hasCAD` / `hasHCM` / `hasDCM` / `hasAFib` / `hasTachycardia` / `hasBradycardia` | `false` |
| `profile.diagnosedHypertension` | `false` |
| `profile.verificationStatus` | `'VERIFIED'` |
| `profile.resolvedHFType` | `'NOT_APPLICABLE'` |
| `contextMeds` | `[]` |
| `excludedMeds` | `[]` |
| `threshold` | `null` |
| `assignment` | `null` |
| `readingCount` | `10` |
| `preDay3Mode` | derived — `readingCount < 7` |
| `personalizedEligible` | derived — `threshold != null && readingCount >= 7` |
| `pregnancyThresholdsActive` | derived — `profile.isPregnant` |
| `triggerPregnancyContraindicationCheck` | derived — `profile.isPregnant` |

### Default medication shape (when a scenario adds one)
| Field | Value |
|---|---|
| `drugName` | `'Lisinopril'` |
| `drugClass` | `'ACE_INHIBITOR'` |
| `isCombination` | `false` |
| `source` | `'PATIENT_SELF_REPORT'` |
| `verificationStatus` | `'VERIFIED'` |

### Default alert shape (when a scenario adds one)
| Field | Value |
|---|---|
| `tier` | `'BP_LEVEL_1_HIGH'` |
| `ruleId` | `'RULE_STANDARD_L1_HIGH'` |
| `mode` | `'STANDARD'` |
| `patientMessage` | `''` |
| `physicianMessage` | `''` |
| `dismissible` | `true` |
| `createdAt` | `2026-04-22T10:00:00Z` |

---

## How to run a scenario against the live backend

All scenarios share the same verification loop. Per-scenario blocks list only what differs from defaults.

1. **Seed the user** with the profile + meds + condition flags the scenario lists.
2. **Create the alert row** in `DeviationAlert` matching the scenario's alert shape (tier, ruleId, patientMessage, dismissible). Easy way: log a reading that triggers it (see [ALERT_SCENARIOS.md](ALERT_SCENARIOS.md) for the matching alert scenario).
3. **Trigger chat context build**: from the app, send any chat message (`POST /api/chat/streaming` or `POST /api/chat/structured`). Backend logs the assembled system prompt at DEBUG level. Alternatively call `SystemPromptService.buildPatientContext({...})` directly in a scratch REPL.
4. **Assert** that every expected substring appears in the rendered prompt, and (for negative cases) confirm the substring disappears when the tweak is applied.

**Always present** in every rendered prompt (regardless of scenario): see [Always-present regression guards](#always-present-regression-guards).

---

## Seed archetype scenarios

Five scenarios matching the five demo patients in [seed.ts](../backend/prisma/seed.ts). Run these after a fresh seed to verify chat context for each archetype.

### Scenario 1 — Priya (pregnant + ACE inhibitor + active Tier 1)

**Intent:** Verify the chat prompt surfaces pregnancy status + ACE medication + the verbatim Tier 1 patient message, so the chatbot can answer "why did I get this alert?" from the alert engine's own wording (no hallucination).

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| PatientContext | `patientName` | `'Priya Menon'` |
| Profile | `isPregnant` | `true` |
| Profile | `historyPreeclampsia` | `true` |
| Meds | `contextMeds[0]` | Lisinopril · `drugClass=ACE_INHIBITOR` |
| Alerts | `activeAlerts[0]` | `tier=TIER_1_CONTRAINDICATION` · `ruleId=RULE_PREGNANCY_ACE_ARB` · `dismissible=false` · `patientMessage='Your care team needs to review your blood pressure medicine because you are pregnant. Please call your provider today before taking your next dose.'` |

**Expected substrings in rendered prompt**
- `'Currently pregnant'`
- `'Lisinopril (ACE_INHIBITOR)'`
- `'TIER_1_CONTRAINDICATION'`
- `'NON-DISMISSABLE'`
- The verbatim `patientMessage` string (entire quote)
- Always-present: `'Never suggest starting, stopping, changing, or adjusting any medication'`

**Negative case** — Set `resolvedContext=null` (admin user / profile missing) → `'Clinical profile: not available'` replaces the pregnancy + medication lines. The verbatim `patientMessage` still renders (alerts are independent of resolvedContext), but the chatbot loses the ability to cross-reference it with the patient's actual condition.

---

### Scenario 2 — James (HFrEF + NDHP + active Tier 1)

**Intent:** Verify HFrEF condition + NDHP-CCB + BB all surface in the prompt alongside the Tier 1 NDHP-HFrEF contraindication message.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| PatientContext | `patientName` | `'James Okafor'` |
| Profile | `hasHeartFailure` | `true` |
| Profile | `heartFailureType` / `resolvedHFType` | `'HFREF'` / `'HFREF'` |
| Meds | `contextMeds[0]` | Diltiazem · `drugClass=NDHP_CCB` |
| Meds | `contextMeds[1]` | Carvedilol · `drugClass=BETA_BLOCKER` · `id='m2'` |
| Alerts | `activeAlerts[0]` | `tier=TIER_1_CONTRAINDICATION` · `ruleId=RULE_NDHP_HFREF` · `dismissible=false` · `patientMessage='Your care team needs to review one of your heart medicines with you. Please call your provider today before taking your next dose.'` |

**Expected substrings in rendered prompt**
- `'Heart failure (HFrEF)'`
- `'Diltiazem (NDHP_CCB)'`
- `'Carvedilol (BETA_BLOCKER)'`
- Verbatim `patientMessage`

**Negative case** — Pass `activeAlerts: []` → `'Active alerts: None.'` replaces the verbatim Tier-1 message. The condition + medication lines still render, but the chatbot has no specific alert to cross-reference.

---

### Scenario 3 — Rita (CAD + DBP 68 + BP Level 1 Low critical)

**Intent:** Verify CAD condition + full medication list (including non-BP meds like statin) + the CAD-DBP-critical patient message are all surfaced.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| PatientContext | `patientName` | `'Rita Washington'` |
| Profile | `hasCAD` | `true` |
| Profile | `diagnosedHypertension` | `true` |
| Meds | `contextMeds[0]` | Amlodipine · `drugClass=DHP_CCB` |
| Meds | `contextMeds[1]` | Metoprolol · `drugClass=BETA_BLOCKER` · `id='m2'` |
| Meds | `contextMeds[2]` | Atorvastatin · `drugClass=STATIN` · `id='m3'` |
| Alerts | `activeAlerts[0]` | `tier=BP_LEVEL_1_LOW` · `ruleId=RULE_CAD_DBP_CRITICAL` · `patientMessage='Your blood pressure reading is 132/68 mmHg. The lower number is concerning for your heart. Please contact your care team today.'` |

**Expected substrings in rendered prompt**
- `'Coronary artery disease (CAD)'`
- `'BP_LEVEL_1_LOW'`
- `'RULE_CAD_DBP_CRITICAL'`
- Verbatim `patientMessage`

**Negative case** — Drop `hasCAD=false` from the profile → the `'Coronary artery disease (CAD)'` line disappears. Alert row still references `RULE_CAD_DBP_CRITICAL` but the chatbot has no condition context to interpret it against (degraded experience, not catastrophic).

---

### Scenario 4 — Charles (AFib + HR 115 + BP Level 1 High)

**Intent:** Verify AFib condition + anticoagulant-class medication (`ANTICOAGULANT` — specific to AFib context) + the HR-specific patient message all surface. AFib is the gatekeeping condition for the `RULE_AFIB_HR_HIGH` rule.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| PatientContext | `patientName` | `'Charles Brown'` |
| Profile | `hasAFib` | `true` |
| Meds | `contextMeds[0]` | Apixaban · `drugClass=ANTICOAGULANT` |
| Meds | `contextMeds[1]` | Metoprolol · `drugClass=BETA_BLOCKER` · `id='m2'` |
| Alerts | `activeAlerts[0]` | `tier=BP_LEVEL_1_HIGH` · `ruleId=RULE_AFIB_HR_HIGH` · `patientMessage='Your heart rate is HR 115 bpm, which is higher than your goal. Please contact your care team today.'` |

**Expected substrings in rendered prompt**
- `'Atrial fibrillation (AFib)'`
- `'Apixaban (ANTICOAGULANT)'`
- `'RULE_AFIB_HR_HIGH'`
- `'HR 115 bpm'` (extracted from the verbatim patient message)

**Negative case** — Replace the `patientMessage` with a version omitting the `'HR 115 bpm'` token (e.g. OutputGenerator fixture lost the pulse substitution) → the `'HR 115 bpm'` assertion fails → regression caught.

---

### Scenario 5 — Aisha (controlled HTN, no active alerts)

**Intent:** Verify the "happy path" — patient on treatment, no alerts — renders the condition + meds + an explicit "Active alerts: None" line. This distinguishes "no alerts" from "alerts not loaded" (which would be a silent regression).

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| PatientContext | `patientName` | `'Aisha Johnson'` |
| Profile | `diagnosedHypertension` | `true` |
| Meds | `contextMeds[0]` | Lisinopril · `drugClass=ACE_INHIBITOR` |
| Meds | `contextMeds[1]` | Amlodipine · `drugClass=DHP_CCB` · `id='m2'` |
| Alerts | `activeAlerts` | `[]` |

**Expected substrings in rendered prompt**
- `'Hypertension (on treatment)'`
- `'Lisinopril (ACE_INHIBITOR)'`
- `'Amlodipine (DHP_CCB)'`
- `'Active alerts: None'`

**Negative case** — Add any alert to `activeAlerts[]` → the `'Active alerts: None'` substring is replaced with `'Active alerts (1, most recent first):'` + the alert block. Use this to detect a regression where a stale alert row gets pulled into a clean patient's context.

---

## Edge-path scenarios

Five scenarios targeting specific branches in the renderer: safety-net markers, pre-Day-3 disclaimer, alert pass-through count, physician-only Tier 3 handling, and the admin/no-profile path.

### Scenario 6 — Unverified pregnant + UNVERIFIED ACE (safety net)

**Intent:** Verify both the profile-verification disclaimer AND the per-medication `⚠ unverified` marker render when a patient is in the "trust-then-verify" window (48-72h after self-report, before provider review).

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Profile | `isPregnant` | `true` |
| Profile | `verificationStatus` | `'UNVERIFIED'` |
| Meds | `contextMeds[0]` | Lisinopril · `verificationStatus=UNVERIFIED` |
| Alerts | `activeAlerts[0]` | `tier=TIER_1_CONTRAINDICATION` · `ruleId=RULE_PREGNANCY_ACE_ARB` · `patientMessage='pregnancy + ACE contraindication'` · `dismissible=false` |

**Expected substrings in rendered prompt**
- `'awaiting provider verification'` (profile-level disclaimer)
- `'⚠ unverified'` (medication-level marker, on the Lisinopril line)
- `'RULE_PREGNANCY_ACE_ARB'`

**Negative case** — Flip `profile.verificationStatus='VERIFIED'` → the `'awaiting provider verification'` disclaimer is absent. Additionally flip the medication's `verificationStatus='VERIFIED'` → the `'⚠ unverified'` marker disappears from the Lisinopril line. Either flip alone is sufficient to fail the assertion; both together give a fully-verified patient with no safety-net markers.

---

### Scenario 7 — Pre-Day-3 patient (readingCount = 3)

**Intent:** Verify the pre-Day-3 disclaimer renders when the patient has fewer than 7 readings. Chatbot should know personalization is not yet active and reassure the patient about transition to personalized thresholds after Day 3.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Context | `readingCount` | `3` |
| Context | `preDay3Mode` | `true` (derived) |

**Expected substrings in rendered prompt**
- `'fewer than 7 readings'`
- `'3 total'`
- `'personalization begins after Day 3'`

**Negative case** — Set `readingCount=7` (boundary) or higher → `preDay3Mode=false` → the entire disclaimer block is skipped. Assertions against all three substrings fail.

---

### Scenario 8 — 8 alerts supplied (no caller-side cap in renderer)

**Intent:** Confirm the renderer is a "dumb" pass-through — it does NOT cap the number of alerts. The `take: 5` cap is enforced by `ChatService` before handing the list to this renderer. This scenario guards against a regression where the cap gets accidentally moved into the renderer (breaking admin/dashboard consumers that pass the full history).

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Alerts | `activeAlerts` | 8 alerts, each `ruleId='RULE_{i}'` · `patientMessage='msg {i}'` · `createdAt='2026-04-{10+i}'` for `i` in `0..7` |

**Expected substrings in rendered prompt**
- `'Active alerts (8, most recent first)'`

**Negative case** — Pass 3 alerts instead → header reads `'Active alerts (3, most recent first)'` → assertion fails on count. This IS the regression test for "don't cap in renderer".

**Related test:** `ChatService` cap enforcement is tested in `backend/src/chat/chat.service.spec.ts` — confirm `prisma.deviationAlert.findMany` is called with `take: 5`.

---

### Scenario 9 — Tier 3 wide-PP alert (physician-only, not patient-facing)

**Intent:** Verify Tier 3 alerts (empty patientMessage, physicianMessage populated) render a `'do NOT surface to patient'` disclaimer and the physicianMessage content — so the chatbot can answer if the patient asks a clinical question that would benefit from that context, without leaking the message verbatim.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| Alerts | `activeAlerts[0]` | `tier=TIER_3_INFO` · `ruleId=RULE_PULSE_PRESSURE_WIDE` · `patientMessage=''` · `physicianMessage='Tier 3 — Wide pulse pressure: 85 mmHg (>60) at 170/85 mmHg.'` |

**Expected substrings in rendered prompt**
- `'do NOT surface to patient'`
- `'Wide pulse pressure'` (from physicianMessage)

**Negative case** — Populate `patientMessage` with non-empty text → the renderer now uses the `'Patient-facing message:'` branch instead of the physician-only branch → `'do NOT surface to patient'` disclaimer absent. The physicianMessage is still rendered but its leak risk goes up (chatbot might quote it).

---

### Scenario 10 — Admin user (resolvedContext = null)

**Intent:** Verify the minimal-prompt path. Admin users (e.g. `HEALPLACE_OPS` using the chat for testing) have no `PatientProfile` → `resolvedContext=null`. The renderer should skip the full clinical block and emit a `'Clinical profile: not available'` placeholder, but keep all the non-patient-specific guardrails intact.

**Inputs (non-default)**
| Category | Field | Value |
|---|---|---|
| PatientContext | `patientName` | `'Admin User'` |
| PatientContext | `resolvedContext` | `null` |

**Expected substrings in rendered prompt**
- `'Clinical profile: not available'`
- `'Never suggest starting, stopping'` (guardrail still present)

**Expected ABSENT from prompt**
- `'Cardiac conditions:'`
- `'Medications:'`
- `'Provider-set'`

**Negative case** — Supply any `ResolvedContext` (even one with all-default false flags) → the renderer enters the full clinical block → `'Clinical profile: not available'` is absent AND the full condition/medication blocks render with values like `'Cardiac conditions: none active'` / `'Medications: none on file'`. Confirms the null-branch is exclusive.

---

## Always-present regression guards

These lines must appear in **every** rendered prompt regardless of patient shape. The spec asserts them in Scenarios 1 and 10 explicitly; they're implicitly asserted everywhere else because the base prompt is unconditional.

| Expected substring | Where it comes from | Failure case (what removes it) |
|---|---|---|
| `'Never suggest starting, stopping, changing, or adjusting any medication'` | `MEDICATION SAFETY` block in `buildSystemPrompt()` | Remove or edit that block in the source |
| `'Tier 1 Contraindication'` · `'contact their provider today'` | `ACTIVE-ALERT HANDLING` block | Remove that block → Tier-1 CTA guidance absent |
| `'BP Level 2 emergency'` · `'call 911'` | Same `ACTIVE-ALERT HANDLING` block | Same — 911 guidance depends on it |
| `'use the alert's patientMessage verbatim'` | `ACTIVE-ALERT HANDLING` block (anti-hallucination rule) | Prompt re-worded to paraphrase → chatbot starts inventing messages |
| `'Do not invent new clinical advice'` | Same block | Guardrail language weakened |
| `'TONE — patient mode'` | `buildToneBlock('PATIENT')` | `toneMode` set to `'PHYSICIAN'` → clinical-shorthand tone block emitted instead |

**Test the guards directly:** render any scenario (e.g. #5 with no alerts) and grep for these six strings. All must hit.

---

## Verification against the live backend

The chat system prompt is normally **not** surfaced in API responses (it's a server-side construct passed to Gemini). Two ways to inspect it:

1. **Enable debug logging:** `NEXT_PUBLIC_VOICE_DEBUG=1` does NOT cover this; use backend `LOG_LEVEL=debug` + grep for `buildPatientContext` console output. `ChatService` does not currently log the assembled prompt — if needed, add a temporary `console.debug(systemPrompt)` call and revert after verification.
2. **Direct service call:** from a scratch Nest REPL, instantiate `SystemPromptService` and call `buildSystemPrompt() + buildPatientContext(pc)` with a fixture that matches the scenario. This mirrors exactly what the Jest spec does.

For each scenario, build the `PatientContext` per the `Inputs` table, render, and assert all `Expected substrings` are present. Apply the `Negative case` tweak and confirm the relevant substring is now absent.

---

## Related spec files

- [docs/ALERT_SCENARIOS.md](ALERT_SCENARIOS.md) — 59 end-to-end rule engine scenarios (what produces the alerts this doc renders).
- [docs/TEST_SCENARIOS.md](TEST_SCENARIOS.md) — 182 unit tests covering rule functions, profile resolver, session averager, output generator, orchestrator regressions.
- Source: [system-prompt.service.ts](../backend/src/chat/services/system-prompt.service.ts) — the renderer under test.
- Upstream cap enforcement: [chat.service.ts](../backend/src/chat/chat.service.ts) `buildPatientSystemPrompt` — `take: 5` on the alert query.
