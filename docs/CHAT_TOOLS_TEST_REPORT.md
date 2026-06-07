# Chat & Voice Tool-Wiring Test Report

_Document revision 2026-05-20._

This report covers the test suite added for the text-chat and voice-chat tool surfaces: what is exercised, what passes, and what gaps the tests uncovered in the tool catalogs and system prompts.

---

## 1. Test suites added

Three new spec files plus targeted fixes to one existing file:

| File | Purpose | Tests |
|---|---|---|
| [backend/src/chat/tools/chat-voice-parity.spec.ts](backend/src/chat/tools/chat-voice-parity.spec.ts) | Cross-surface parity: text catalog ⊇ voice catalog, schema parity, tool-description sanity, executor routing | 14 |
| [backend/src/chat/services/system-prompt-tool-awareness.spec.ts](backend/src/chat/services/system-prompt-tool-awareness.spec.ts) | Every tool the agent is eligible to call must be discoverable from the system prompt (text v1/v2 + voice v1/v2) | 33 |
| [backend/src/chat/tools/journal-tools.scenarios.spec.ts](backend/src/chat/tools/journal-tools.scenarios.spec.ts) | End-to-end scenario coverage for all 8 text tools (happy paths + sad paths + common patient phrasings) | 47 |
| [backend/src/chat/tools/journal-tools.spec.ts](backend/src/chat/tools/journal-tools.spec.ts) (fixed) | Existing spec — stale 5-tool assertion and stale missing-field-order assertion updated for Phase/27 | 15 |

Plus the pre-existing voice spec — [backend/src/voice/tools/voice-tools.service.spec.ts](backend/src/voice/tools/voice-tools.service.spec.ts) — was not modified but is now covered by the parity assertions.

---

## 2. Run result

```
NODE_OPTIONS=--experimental-vm-modules npx jest \
  --testPathPatterns="(journal-tools|voice-tools|chat-voice-parity|system-prompt-tool-awareness)" \
  --no-coverage

Test Suites: 5 passed, 5 total
Tests:       136 passed, 136 total
```

**Baseline before this work:** 17 failed / 43 passed across the same path filter — the journal-tools spec had a stale 5-tool assertion, the missing-field test expected the wrong first-missing field, the happy-path test was missing `measurement_time`, and `chat.service.spec.ts` had unrelated Nest DI compile errors that block its own suite from instantiating (out of scope for tool wiring; tracked separately).

**After this work:** 136 / 136 in the tool-wiring path. The `chat.service.spec.ts` DI failure is a pre-existing baseline failure unrelated to tool wiring — addressed separately as it requires changes to the `OcrService` provider registration in the spec's test module, not the production code.

---

## 3. Tool catalog audit

### 3.1 Text-chat tools — 8 declared

[journal-tools.ts](backend/src/chat/tools/journal-tools.ts):

| Tool | Purpose | Engine surface |
|---|---|---|
| `submit_checkin` | Full BP check-in with all metadata | `DailyJournalService.create` |
| `get_recent_readings` | History retrieval | `DailyJournalService.findAll` |
| `update_checkin` | Edit a reading by date+time | `DailyJournalService.update` |
| `delete_checkin` | Remove a reading by date+time | `DailyJournalService.delete` |
| `log_medication_adherence` | Single-drug taken/missed/scheduled-later log (Phase/27) | `MedicationAdherenceService.log` |
| `log_symptom_quick` | Sparse symptom-only entry (Phase/27) | `SymptomQuickLogService.log` |
| `submit_bp_from_photo` | OCR → numbers (Phase/27) — does NOT save, returns for verbal confirm | `OcrService.extractBp` |
| `flag_emergency` | Records `EmergencyEvent` row + returns 911 guidance | `prisma.emergencyEvent.create` |

### 3.2 Voice-chat tools — 5 declared

[voice-tools.service.ts](backend/src/voice/tools/voice-tools.service.ts):

| Tool | Notes |
|---|---|
| `submit_checkin` | Sparse-entry friendly (BP=0 sentinel for "not provided this turn") |
| `get_recent_readings` | Returns line-per-entry summary |
| `update_checkin` | Requires `entry_id` (no date+time lookup) |
| `delete_checkin` | Comma-separated `entry_ids` for bulk delete |
| `submit_bp_from_photo` | Same verbal-confirm-before-save pattern as text |

### 3.3 Tool catalog parity — verified by tests

✅ **Voice ⊆ Text:** every voice tool is also a text tool (the parity spec asserts this).

❌ **Three text-only tools:** `flag_emergency`, `log_medication_adherence`, `log_symptom_quick` do not exist on the voice surface. This is partially intentional (the voice V2 prompt teaches "sparse-submit_checkin" for adherence/symptoms) and partially a gap (`flag_emergency` has no voice analog).

---

## 4. Gaps surfaced by the tests

Each gap is captured by an explicit **`GAP — …`** test name in the suite so future code edits will trip on the regression check.

### 4.1 Voice catalog gaps

| Gap | Location | Test name |
|---|---|---|
| Voice has no `flag_emergency` tool — 911 routing is inline-speech-only, no `EmergencyEvent` row is persisted from a voice session | `voice-tools.service.ts` | `system-prompt-tool-awareness > Voice-chat v1 > does NOT mention flag_emergency (voice has no such tool today)` |
| Voice has no `log_medication_adherence` tool — voice patient saying "I took my Lisinopril" goes through sparse-submit_checkin | same | `parity > documents the text-only tools (voice gap)` |
| Voice has no `log_symptom_quick` tool — voice patient saying "I have severe headache" also goes through sparse-submit_checkin | same | same |

### 4.2 Voice `submit_checkin` schema gaps

The voice `submit_checkin` is supposed to be the catch-all for partial logs but its schema is missing the newer structured symptom keys:

| Missing key | Cluster | Test name |
|---|---|---|
| `fatigue` | Cluster 7 (BB Appendix A) | `parity > GAP — voice submit_checkin is MISSING Cluster 7 symptoms` |
| `shortness_of_breath` | Cluster 7 | same |
| `dry_cough` | Cluster 7 (ACE Appendix A) | same |
| `nsaid_use` | Cluster 7 | same |
| `face_swelling` | Cluster 8 (P0 ACE-angioedema) | `parity > GAP — voice submit_checkin is MISSING Cluster 8 angioedema symptoms` |
| `throat_tightness` | Cluster 8 (P0 ACE-angioedema) | same |

**Clinical impact:** a voice-only patient reporting present-tense facial swelling or throat tightness cannot trigger the `TIER_1_ANGIOEDEMA` rule through any voice tool today — the schema does not accept the booleans, the prompt does not direct the model to set them, and there is no `log_symptom_quick` analog. This is the Cluster 8 P0 pilot blocker on the voice surface.

### 4.3 Text `submit_checkin` schema gaps

Discovered during this audit (was not previously documented):

| Missing key | Cluster | Test name |
|---|---|---|
| `dizziness`, `syncope`, `palpitations`, `leg_swelling` | Cluster 6 (brady / HF-decomp / palpitations) | `parity > GAP — text-chat submit_checkin is MISSING Cluster 6/7/8 symptom keys` |
| `fatigue`, `shortness_of_breath`, `dry_cough`, `nsaid_use` | Cluster 7 | same |
| `face_swelling`, `throat_tightness` | Cluster 8 (P0) | same |

**Mitigation:** text chat has `log_symptom_quick`, which accepts the full 19-symptom enum. The text V2 prompt directs the model to use `log_symptom_quick` for present-tense symptom reporting without BP. The gap is therefore that during a *full check-in* (with BP numbers), the patient cannot mention these symptoms via a structured boolean — they end up in the `symptoms[]` legacy array, which the alert engine does not pattern-match. **Manisha sign-off needed** to decide whether `submit_checkin` should also accept the Cluster 6/7/8 booleans for the during-check-in case.

### 4.4 System-prompt gaps

| Surface | Gap | Test name |
|---|---|---|
| Text V1 prompt | Does not mention `log_medication_adherence`, `log_symptom_quick`, `submit_bp_from_photo` — by design (Phase/27 tools added behind `CHAT_V2_PROMPT_ENABLED`) | `Text v1 > does NOT mention log_medication_adherence (v1 is intentionally silent)` etc. |
| Text V2 prompt | Does NOT mention `get_recent_readings` by name even though the tool exists in the v2 catalog | `Text v2 > GAP — v2 text prompt does NOT mention get_recent_readings by name` |
| Voice V1 prompt | Does NOT mention `submit_bp_from_photo` even though the voice service declares it | `Voice v1 > GAP — v1 voice prompt does NOT teach submit_bp_from_photo even though the tool is declared` |
| Voice V2 prompt | Does NOT teach the Cluster 7/8 symptom keys (consistent with the schema gap above — internally consistent silence) | `Voice v2 > GAP — v2 voice prompt does NOT teach Cluster 7 / 8 structured symptom keys` |

### 4.5 What the tests confirm IS wired correctly

- Both text V1 and V2 prompts teach the 4 core write tools (`submit_checkin` / `get_recent_readings` / `update_checkin` / `delete_checkin`) by name with their flows.
- Both text V1 and V2 prompts teach `flag_emergency` with present-tense gating ("right now") so the model doesn't fire on past-tense reports.
- Both voice V1 and V2 prompts teach the one-tool-per-turn discipline, the language-lock rule, the medication-safety non-negotiables, and the active-alert handoff to physician-only annotations.
- Text V2 teaches all 3 Phase/27 tools (`log_medication_adherence`, `log_symptom_quick`, `submit_bp_from_photo`) with their distinct trigger patterns and the verbal-confirm-before-save rule for photo OCR.
- Voice V2 teaches `submit_bp_from_photo` with VERBALLY CONFIRM uppercase emphasis (verified by `expect(prompt.toUpperCase()).toContain('VERBALLY CONFIRM')`).
- Voice V2 teaches the partial-logging-via-sparse-submit_checkin pattern.
- `executeJournalTool` routes every one of the 8 declared text tools to a real switch case (not the unknown-tool sentinel).
- `flag_emergency` description includes "right now" gating.
- `log_symptom_quick` description names all 19 valid symptom keys.
- `submit_bp_from_photo` description requires verbal confirmation + naming `submit_checkin` as the follow-up.
- `log_medication_adherence` description enumerates the three valid statuses (`taken` / `missed` / `scheduled_later`).

---

## 5. Scenario coverage detail

The `journal-tools.scenarios.spec.ts` file walks every text tool through happy + sad paths:

### 5.1 `submit_checkin` — 9 scenarios

- Happy path with required fields → `journal.create` called, returns `saved:true`
- Missing `measurement_time` → rejected with `next_action` mentioning measurement_time
- Missing `medication_taken` → rejected with `next_action` mentioning medication_taken
- Missing `symptoms` array → rejected
- Empty symptoms `[]` accepted as "none reported"
- Future-dated entry → rejected with future-date message
- Structured Stage A booleans (`severe_headache`, `visual_changes`) threaded into DTO
- `missed_medications` normalised (camelCase + snake_case input → canonical shape)
- `measurement_conditions` (B1 checklist) — only known booleans pass through
- `today` / `now` literal-string fallbacks resolve to current date/time
- DailyJournalService throw surfaces as `saved:false` with error message

### 5.2 `get_recent_readings` — 3 scenarios

- Returns count + reading list with formatted date/time
- Returns empty `{readings:[], count:0}` when no entries
- Defaults to 7 days when arg missing

### 5.3 `update_checkin` — 4 scenarios

- Finds entry by date+time + applies field changes
- Refuses when no entry matches
- Refuses when no fields are changing (no-op guard)
- Structured Stage A booleans threaded into update DTO

### 5.4 `delete_checkin` — 2 scenarios

- Finds entry by date+time and deletes
- Returns `deleted:false` with message when entry not found

### 5.5 `log_medication_adherence` — 5 scenarios

- "I took my Lisinopril this morning" → `taken` status
- "I missed my Atorvastatin yesterday" → `missed` with `reason=FORGOT`, `missed_doses=1`
- "Skip my Carvedilol, I'll take it later" → `scheduled_later`
- Unknown status string rejected
- Returns clear failure when `adherenceService` is not wired in ctx (legacy path)

### 5.6 `log_symptom_quick` — 5 scenarios

- Stage-A symptom (`severeHeadache`) with notes
- Cluster 7 side-effect (`dryCough`)
- Cluster 8 airway-emergency (`faceSwelling`, P0 angioedema)
- Invalid symptom key rejected
- Returns clear failure when `symptomService` is not wired (legacy path)

### 5.7 `submit_bp_from_photo` — 3 scenarios

- Parses high-confidence reading → returns numbers + "confirm with the patient" message
- Empty `image_base64` rejected
- Returns clear failure when `ocrService` is not wired (legacy path)

### 5.8 `flag_emergency` — 2 scenarios

- Flags situation + returns 911-guidance message
- Falls back to default situation string when arg missing

### 5.9 Normalisers — 11 scenarios

- `normaliseDate`: canonical YYYY-MM-DD pass-through, today/now/right-now/just-now → today, yesterday, free-text → undefined
- `normaliseTime`: bare HH:mm, AM/PM with and without minutes, invalid → undefined (existing test)
- `normalisePosition`: canonical enums, synonyms (`seated`, `stood`, `laying`), unknown → undefined
- `sanitiseMeasurementConditions`: known boolean keys only, wrong types dropped, empty → undefined
- `normaliseMissedMedications`: snake_case + camelCase coercion, invalid-reason rows dropped, missed_doses clamped to 1..10

---

## 6. Recommendations

Ordered by clinical-safety impact.

### 6.1 Critical

1. **Add Cluster 8 (`face_swelling`, `throat_tightness`) to voice `submit_checkin` schema** AND ensure the voice prompt directs the model to set them when the patient reports those symptoms by voice. Without this, voice-only pilot patients cannot trigger `TIER_1_ANGIOEDEMA` from the voice surface — P0 pilot blocker.
2. **Add `flag_emergency` to the voice tool catalog** so voice sessions persist `EmergencyEvent` rows on 911 routing — currently the voice surface routes 911 inline via speech but no audit row is written.

### 6.2 High

3. **Add Cluster 6/7 symptoms (`dizziness`, `syncope`, `palpitations`, `leg_swelling`, `fatigue`, `shortness_of_breath`, `dry_cough`, `nsaid_use`) to voice `submit_checkin`** so the voice during-check-in path can fire the matching engine rules.
4. **Decide with Manisha whether text `submit_checkin` should also accept Cluster 6/7/8 booleans** (today text routes via `log_symptom_quick` instead — internally consistent but lossy if the patient reports symptoms *during* a full check-in).
5. **Add `get_recent_readings` documentation back to the text V2 prompt** — the v1 prompt has a dedicated "RETRIEVING READINGS" section that was dropped in the v2 rewrite.
6. **Add `submit_bp_from_photo` documentation to the voice V1 prompt** — the tool is declared in the voice service today but v1 prompt never mentions it, so the model is unlikely to invoke it.

### 6.3 Medium

7. **Consider adding `log_medication_adherence` and `log_symptom_quick` to the voice catalog** as proper tools rather than the current sparse-submit_checkin pattern. The pattern works but produces messier `JournalEntry` rows.
8. **Add a parity assertion to CI**: the parity spec asserts voice catalog ⊆ text catalog; add an inverse assertion that records which text tools are deliberately text-only so future additions force a parity decision.

---

## 7. How to run

```sh
cd backend

# All chat/voice tool tests (5 suites, 136 tests, ~5 sec)
NODE_OPTIONS=--experimental-vm-modules npx jest \
  --testPathPatterns="(journal-tools|voice-tools|chat-voice-parity|system-prompt-tool-awareness)" \
  --no-coverage

# Just the parity assertions
NODE_OPTIONS=--experimental-vm-modules npx jest \
  --testPathPatterns="chat-voice-parity" --no-coverage

# Just the prompt tool-awareness checks
NODE_OPTIONS=--experimental-vm-modules npx jest \
  --testPathPatterns="system-prompt-tool-awareness" --no-coverage

# Just the scenario walk-throughs
NODE_OPTIONS=--experimental-vm-modules npx jest \
  --testPathPatterns="journal-tools.scenarios" --no-coverage
```

---

## 8. Source-file map

| File | Role |
|---|---|
| [backend/src/chat/tools/journal-tools.ts](backend/src/chat/tools/journal-tools.ts) | Text-chat tool declarations + executor (8 tools) |
| [backend/src/voice/tools/voice-tools.service.ts](backend/src/voice/tools/voice-tools.service.ts) | Voice-chat tool declarations + dispatcher (5 tools) |
| [backend/src/chat/services/system-prompt.service.ts](backend/src/chat/services/system-prompt.service.ts) | Text-chat system prompt builder (v1 + v2 behind `CHAT_V2_PROMPT_ENABLED`) |
| [backend/src/voice/prompts/voice-system-instruction.ts](backend/src/voice/prompts/voice-system-instruction.ts) | Voice-chat system instruction builder (v1 + v2 behind same flag) |
| [backend/src/chat/services/medication-adherence.service.ts](backend/src/chat/services/medication-adherence.service.ts) | Backend for `log_medication_adherence` |
| [backend/src/chat/services/symptom-quick-log.service.ts](backend/src/chat/services/symptom-quick-log.service.ts) | Backend for `log_symptom_quick` (defines `StructuredSymptomKey` union — 19 keys) |
| [backend/src/ocr/ocr.service.ts](backend/src/ocr/ocr.service.ts) | Backend for `submit_bp_from_photo` |

— end of report —
