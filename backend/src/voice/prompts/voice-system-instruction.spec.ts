// Regression guards for prompt-content bugs found in the chat audit.
// Bug 8: the V1 voice prompt used to contain a hardcoded example date
// ("March 28th") that the LLM was observed parroting literally when the
// real conversation was in a different month. The fix replaces the
// concrete date with an instruction to use the actual current-date block.

import { buildVoiceSystemInstruction } from './voice-system-instruction.js'

describe('voice system instruction — Bug 8 regression', () => {
  it('V1 prompt does NOT contain the hardcoded example date "March 28th"', () => {
    const v1 = buildVoiceSystemInstruction('PATIENT CONTEXT GOES HERE', false)
    expect(v1).not.toContain('March 28th')
  })

  it('V2 prompt does NOT contain the hardcoded example date "March 28th"', () => {
    const v2 = buildVoiceSystemInstruction('PATIENT CONTEXT GOES HERE', true)
    expect(v2).not.toContain('March 28th')
  })

  it('V1 prompt instructs the LLM to use the CURRENT DATE block, not a literal example', () => {
    const v1 = buildVoiceSystemInstruction('PATIENT CONTEXT GOES HERE', false)
    expect(v1).toMatch(/CURRENT DATE|actual date the patient gave/i)
  })
})

// ─── Bug 14 regression — form-parity check-in flow ─────────────────────────
// The chatbot check-in flow used to under-ask vs the patient-facing BP form:
//   • B1 measurement-conditions: form requires all 8 keys, chat asked 3.
//   • Cluster-7 symptoms (fatigue/dryCough/nsaidUse) were never explicitly
//     asked — only caught via keyword mapper if patient volunteered them.
//   • Per-medication adherence rolled up to a single yes/no, losing detail.
//   • Position was hedged as "optional, you can skip" though the form
//     REQUIRES it.
// These guards ensure future prompt edits don't silently drop these asks.

describe('voice system instruction — Bug 14 form-parity guards', () => {
  for (const v2 of [false, true]) {
    const label = v2 ? 'V2' : 'V1'
    const prompt = buildVoiceSystemInstruction('PATIENT CONTEXT GOES HERE', v2)

    describe(`${label} prompt`, () => {
      it('B1 checklist asks all 8 measurement_conditions keys (form parity)', () => {
        // The form's B1 step requires ALL 8 to proceed. Voice must mention
        // every one so the patient is actually prompted about it.
        expect(prompt).toMatch(/no caffeine/i)
        expect(prompt).toMatch(/no smoking/i)
        expect(prompt).toMatch(/no exercise/i)
        expect(prompt).toMatch(/bladder empty/i)
        expect(prompt).toMatch(/seated quietly/i)
        expect(prompt).toMatch(/back supported|feet flat/i)
        expect(prompt).toMatch(/not talking/i)
        expect(prompt).toMatch(/bare arm/i)
      })

      it('symptom probe asks for Cluster-7 (fatigue, dry cough, NSAID)', () => {
        // Without these explicit asks, the keyword mapper only catches them
        // if the patient happens to volunteer the right freeform phrase.
        expect(prompt).toMatch(/fatigue/i)
        expect(prompt).toMatch(/dry cough/i)
        expect(prompt).toMatch(/nsaid|ibuprofen|advil/i)
      })

      it('position is asked as MANDATORY, not "you can skip"', () => {
        // The BP form requires position. Voice prompt must not hedge with
        // "optional, you can skip" wording for this field.
        const positionAsk = prompt.match(/sitting,\s*standing,\s*or\s*lying[^.]*\./i)?.[0] ?? ''
        expect(positionAsk).not.toMatch(/optional|you can skip/i)
      })

      // Bug 14 + kg/lbs follow-up — pre-fix asked LBS only and asked the
      // LLM to convert kg in its head. Now both units flow via weight_unit.
      it('weight ask supports both LBS and KG via weight_unit (no in-head conversion)', () => {
        expect(prompt).toMatch(/lbs/i)
        expect(prompt).toMatch(/kg/i)
        expect(prompt).toMatch(/weight_unit/i)
        expect(prompt).toMatch(/do not convert|don'?t convert/i)
      })
    })
  }

  it('V2 per-medication ask iterates each med by name when patient has >1', () => {
    const v2 = buildVoiceSystemInstruction('PATIENT CONTEXT', true)
    expect(v2).toMatch(/for each of your medications/i)
  })

  it('V1 backport — now asks for pulse + position + notes', () => {
    const v1 = buildVoiceSystemInstruction('PATIENT CONTEXT', false)
    expect(v1).toMatch(/pulse number/i)
    expect(v1).toMatch(/sitting,\s*standing,\s*or\s*lying/i)
    expect(v1).toMatch(/anything else.*note/i)
  })

  // Bug 15 + Bug 21b — patient said "yes correct" / "save it", bot went
  // silent. Voice prompts must tell the LLM the tool call IS the response
  // (no leading text reply). Bug 21b strengthened the wording from
  // "immediately call submit_checkin" to "your NEXT action MUST be the
  // submit_checkin tool call" — either is acceptable.
  for (const v2 of [false, true]) {
    const label = v2 ? 'V2' : 'V1'
    it(`${label} voice prompt instructs submit_checkin as next action on confirmation (Bug 15 + 21b)`, () => {
      const prompt = buildVoiceSystemInstruction('PATIENT CONTEXT', v2)
      expect(prompt).toMatch(/submit_checkin/i)
      expect(prompt).toMatch(/next\s+action\s+must|immediately call/i)
    })
  }

  // ─── Bug 21 — voice surface ────────────────────────────────────────────
  // Mirror of the chat-prompt Bug 21 guards. Voice uses the same approach:
  // strengthen optional-field wording, add a pre-summary verification gate,
  // expand the save-trigger phrase list, forbid a leading text reply,
  // expose reading-query synonyms.
  for (const v2 of [false, true]) {
    const label = v2 ? 'V2' : 'V1'
    const prompt = buildVoiceSystemInstruction('PATIENT CONTEXT', v2)

    describe(`Bug 21 — ${label} voice prompt`, () => {
      it('Bug 21a — pulse ask uses strong "MUST ask EVERY check-in" wording', () => {
        // Robust: "MUST ask EVERY check-in" within 200 chars before the pulse question.
        expect(prompt).toMatch(/MUST ask EVERY check-in[\s\S]{0,200}(pulse number|cuff also show)/i)
      })

      it('Bug 21a — position ask uses strong "MUST ask EVERY check-in" wording', () => {
        expect(prompt).toMatch(/MUST ask EVERY check-in[\s\S]{0,200}sitting,\s*standing,\s*or\s*lying/i)
      })

      it('Bug 21a — notes ask uses strong "MUST ask EVERY check-in" wording', () => {
        expect(prompt).toMatch(/MUST ask EVERY check-in[\s\S]{0,200}anything else/i)
      })

      it('Bug 21a — pre-summary verification gate present', () => {
        expect(prompt).toMatch(/verification gate/i)
        expect(prompt).toMatch(/pulse.*position.*weight.*notes.*measurement_conditions/i)
      })

      it('Bug 21b — save-trigger phrase list contains the expanded set', () => {
        const phrases = [
          'save', 'save it', 'submit', 'record it', 'log it', 'confirm',
          'do it', 'send it', 'go ahead', 'looks good', "that's right",
          'perfect', 'absolutely', 'yep',
        ]
        const matches = phrases.filter((p) => prompt.toLowerCase().includes(p.toLowerCase()))
        expect(matches.length).toBeGreaterThanOrEqual(8)
      })

      it('Bug 21b — save step forbids leading text reply before tool call', () => {
        expect(prompt).toMatch(/no leading text reply/i)
        expect(prompt).toMatch(/tool call is the response/i)
      })

      it('Bug 21c — prompt mentions the get_recent_readings synonym list', () => {
        expect(prompt).toMatch(/give me my readings/i)
        expect(prompt).toMatch(/show me my BP|list my readings|my history|my check-ins/i)
      })

      // ─── Bug 22 — voice reliability hardening ─────────────────────────

      it('Bug 22 Fix 2 — top + bottom BP are asked as SEPARATE steps', () => {
        expect(prompt).toMatch(/top number[\s\S]{0,200}(?:systolic|bigger)/i)
        expect(prompt).toMatch(/bottom number[\s\S]{0,200}(?:diastolic|smaller)/i)
        expect(prompt).toMatch(/3a/)
      })

      it('Bug 22 Fix 3 — verification gate covers COMPULSORY fields', () => {
        expect(prompt).toMatch(/compulsory/i)
        expect(prompt).toMatch(/entry_date.*measurement_time/i)
        expect(prompt).toMatch(/systolic.*diastolic|top.*bottom/i)
      })

      it("Bug 22 Fix 3 — voice prompt forbids \"let's start over\" terminal re-ask", () => {
        expect(prompt).toMatch(/never say.*start over|let'?s start over/i)
        expect(prompt).toMatch(/never re-ask BP|do not re-ask|do NOT re-ask/i)
      })

      it('Bug 22 Fix 4 — update flow teaches entry_id MUST come from get_recent_readings', () => {
        expect(prompt).toMatch(/entry_id MUST come from|never reuse an entry_id/i)
        expect(prompt).toMatch(/get_recent_readings/)
      })

      it('Bug 22 Fix 5 — "adding to existing session" guidance is present for ALL patients', () => {
        expect(prompt).toMatch(/adding to an existing session/i)
        expect(prompt).toMatch(/ALL patients/i)
      })

      it('Bug 22 Fix 6 — position normalisation table covers reclined / supine / in a chair', () => {
        expect(prompt).toMatch(/reclined|supine/i)
        expect(prompt).toMatch(/in a chair|seated/i)
        expect(prompt).toMatch(/never invent a fourth/i)
      })

      // ─── Bug 49 — symptom question stays short (1–2 examples) ────────
      it('Bug 49 — spoken symptom question is short with "for example" framing, not a 19-item enumeration', () => {
        // The spoken question is the text wrapped in the quotes after the
        // step header (7. or 9.). Old form started "Any new symptoms today
        // —" with a long comma list; new form uses "For example,".
        expect(prompt).toMatch(/Any new symptoms today\?[\s\S]{0,200}For example/i)
        // Sanity — the long enumeration ("vision changes, confusion, …
        // weakness on one side, severe stomach pain") must NOT be inside
        // the spoken question quotes. We assert by checking the open-ended
        // ending instead — the new wording always ends with "or anything
        // else you'd like to mention?".
        expect(prompt).toMatch(/anything else you'?d like to mention/i)
      })

      it('Bug 49 — internal mapping list still covers all clinical symptoms (recognition unchanged)', () => {
        // Spoken question shortened, but the prompt must still teach the
        // LLM to recognise + map every symptom — otherwise we lose the
        // structured-boolean coverage. These are the structured booleans
        // emitted by the engine; each name must appear somewhere in the
        // prompt as a recognition target.
        const booleans = [
          'severeHeadache',
          'visualChanges',
          'alteredMentalStatus',
          'chestPainOrDyspnea',
          'focalNeuroDeficit',
          'severeEpigastricPain',
          'dizziness',
          'syncope',
          'palpitations',
          'legSwelling',
          'fatigue',
          'shortnessOfBreath',
          'dryCough',
          'nsaidUse',
          'faceSwelling',
          'throatTightness',
        ]
        for (const key of booleans) {
          expect(prompt).toContain(key)
        }
      })

      // ─── Bug 50 — BP threading reminder before submit_checkin ────────
      it('Bug 50 — prompt explicitly tells the LLM to thread collected BP values into submit_checkin (not 0/0)', () => {
        // The reminder must mention both the "thread real values" and the
        // "0/0 is a separate sparse-log code path" parts. Future prompt
        // edits that drop either half regress this fix.
        expect(prompt).toMatch(/BP THREADING/i)
        expect(prompt).toMatch(/systolic_bp.*138|diastolic_bp.*85|systolic=.*diastolic=/i)
        expect(prompt).toMatch(/sparse log|sparse-log/i)
        expect(prompt).toMatch(/never (?:pass|call|submit).{0,80}(?:systolic_bp\s*=\s*0|0\s*\/\s*0|with 0)|do not (?:pass|call|submit).{0,80}(?:systolic_bp\s*=\s*0|0\s*\/\s*0|with 0)/i)
      })

      // ─── Bug 52 — continuation readings inside a 5-min session ────────
      // For a 2nd / 3rd reading inside the same 5-min session window the bot
      // must NOT re-ask invariant fields (weight, meds, symptoms, B1
      // checklist, notes). It must INHERIT those from the prior submit_checkin
      // in this conversation and thread them into the next call. Each of these
      // tests pins a different facet of the block — a future edit that drops
      // any one of them regresses the fix.
      it('Bug 52 — CONTINUATION READINGS block is present with activation conditions', () => {
        expect(prompt).toMatch(/CONTINUATION READINGS/i)
        expect(prompt).toMatch(/ALREADY called submit_checkin.{0,200}within 5 minutes/i)
        // AFib is the canonical proactive case — block must call it out.
        expect(prompt).toMatch(/AFib.{0,80}3-reading minimum/i)
      })

      it('Bug 52 — block enumerates per-reading vs inherited fields', () => {
        // Per-reading: BP top + bottom, pulse, position, measurement_time.
        expect(prompt).toMatch(/ASK ON EVERY READING/i)
        expect(prompt).toMatch(/measurement_time[\s\S]{0,200}systolic_bp[\s\S]{0,200}diastolic_bp/i)
        // Inherited: at minimum weight, medication, symptoms, measurement_conditions, notes, session_id.
        expect(prompt).toMatch(/INHERIT FROM THE PRIOR READING/i)
        expect(prompt).toMatch(/weight[\s\S]{0,300}medication_taken[\s\S]{0,300}measurement_conditions/i)
        expect(prompt).toMatch(/session_id/i)
      })

      it('Bug 52 — block forbids passing 0 / empty for inherited fields (preserves accuracy)', () => {
        // The user's explicit constraint: "no need to add bogus numbers".
        // Inheritance must thread REAL values, not 0/empty placeholders.
        expect(prompt).toMatch(/NEVER pass 0 or empty for an inherited field|never (?:pass|use) (?:0|zero|empty)/i)
        // Mentions the sparse-log distinction so the LLM knows 0/0 is a
        // different code path, not the fallback for continuation.
        expect(prompt).toMatch(/sparse[- ]log.{0,80}NOT the continuation/i)
      })

      it('Bug 52 — block defines exit conditions (5-min expiry + finalize / new check-in)', () => {
        expect(prompt).toMatch(/EXIT the continuation mode/i)
        // 5-min expiry triggers a full re-run.
        expect(prompt).toMatch(/more than 5 minutes.{0,150}full check-in flow/i)
        // finalize_checkin is the explicit "evaluate this" path (non-AFib only).
        expect(prompt).toMatch(/finalize_checkin.{0,80}non[- ]AFib|never for AFib/i)
      })

      // ─── Bug 53 — skip medication question for 0-meds patients ────────
      // Patients with no active prescribed medications (or only PRN /
      // AS_NEEDED which the backend filters) should NOT be asked "did you
      // take your medications?" — the question is meaningless and
      // frustrating. The bot must instead pass medication_taken=true
      // (vacuously) so the required-field gate is still satisfied. The
      // trigger phrase is the exact patient-context line
      // "Medications: No medications recorded."
      it('Bug 53 — medication step skips when patient context says "No medications recorded"', () => {
        // Trigger phrase appears verbatim so the LLM can pattern-match
        // against the rendered patient context block.
        expect(prompt).toMatch(/No medications recorded/i)
        // SKIP directive is explicit (not just "ask if they have any").
        expect(prompt).toMatch(/SKIP this step entirely|skip this step entirely/i)
        // Vacuous-true contract for medication_taken is spelled out so the
        // LLM doesn't get rejected by the dispatcher's required-field gate.
        expect(prompt).toMatch(/medication_taken\s*=\s*true.{0,200}vacuously|vacuously true[\s\S]{0,200}medication_taken/i)
      })
    })
  }
})
