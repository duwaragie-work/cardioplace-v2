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
    })
  }
})
