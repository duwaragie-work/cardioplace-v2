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

      it('weight ask specifies LBS and includes kg → lbs conversion guidance', () => {
        expect(prompt).toMatch(/lbs/i)
        expect(prompt).toMatch(/kg.*lbs|convert.*lbs/i)
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

  // Bug 15 — patient said "yes correct", bot went silent. Voice prompts
  // must EXPLICITLY tell the LLM to call submit_checkin in the same turn
  // when the patient confirms, not just say "okay" and wait for another
  // utterance.
  for (const v2 of [false, true]) {
    const label = v2 ? 'V2' : 'V1'
    it(`${label} voice prompt explicitly instructs IMMEDIATE submit_checkin on confirmation`, () => {
      const prompt = buildVoiceSystemInstruction('PATIENT CONTEXT', v2)
      expect(prompt).toMatch(/immediately call submit_checkin/i)
      expect(prompt).toMatch(/yes.*is the save trigger|patient'?s.*yes.*save/i)
    })
  }
})
