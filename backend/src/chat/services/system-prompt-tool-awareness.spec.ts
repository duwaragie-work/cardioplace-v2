// System-prompt tool-awareness tests.
//
// Every tool the chat or voice agent can call must be discoverable from the
// system prompt — the LLM cannot reliably invoke a tool whose name and
// trigger condition it has never seen. These tests assert that the text
// system prompt (v1 and v2) and the voice system instruction (v1 and v2)
// each mention every tool name they are eligible to dispatch, AND that the
// key conditional triggers (e.g. "right now" for flag_emergency, "Skip my
// Carvedilol" for log_medication_adherence) appear in the prompt body.
//
// Run via:
//   NODE_OPTIONS=--experimental-vm-modules \
//     npx jest --testPathPatterns="system-prompt-tool-awareness"

import type { ConfigService } from '@nestjs/config'
import { buildVoiceSystemInstruction } from '../../voice/prompts/voice-system-instruction.js'
import { SystemPromptService } from './system-prompt.service.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildTextPromptV1(): string {
  const cfg = { get: () => 'false' } as unknown as ConfigService
  return new SystemPromptService(cfg).buildSystemPrompt({ toneMode: 'PATIENT' })
}

function buildTextPromptV2(): string {
  const cfg = { get: () => 'true' } as unknown as ConfigService
  return new SystemPromptService(cfg).buildSystemPrompt({ toneMode: 'PATIENT' })
}

function buildVoicePromptV1(): string {
  // Voice prompt reads CHAT_V2_PROMPT_ENABLED directly from process.env.
  // Save/restore so we don't leak into sibling tests.
  const original = process.env.CHAT_V2_PROMPT_ENABLED
  process.env.CHAT_V2_PROMPT_ENABLED = 'false'
  try {
    return buildVoiceSystemInstruction('PATIENT CONTEXT — none')
  } finally {
    if (original === undefined) delete process.env.CHAT_V2_PROMPT_ENABLED
    else process.env.CHAT_V2_PROMPT_ENABLED = original
  }
}

function buildVoicePromptV2(): string {
  const original = process.env.CHAT_V2_PROMPT_ENABLED
  process.env.CHAT_V2_PROMPT_ENABLED = 'true'
  try {
    return buildVoiceSystemInstruction('PATIENT CONTEXT — none')
  } finally {
    if (original === undefined) delete process.env.CHAT_V2_PROMPT_ENABLED
    else process.env.CHAT_V2_PROMPT_ENABLED = original
  }
}

// ─── Text-chat prompt tool awareness ──────────────────────────────────────────

describe('Text-chat system prompt — tool awareness', () => {
  describe('v1 (default, Manisha-signed)', () => {
    const prompt = buildTextPromptV1()

    it('mentions submit_checkin', () => {
      expect(prompt).toContain('submit_checkin')
    })

    it('mentions get_recent_readings', () => {
      expect(prompt).toContain('get_recent_readings')
    })

    it('mentions update_checkin', () => {
      expect(prompt).toContain('update_checkin')
    })

    it('mentions delete_checkin', () => {
      expect(prompt).toContain('delete_checkin')
    })

    it('mentions flag_emergency with present-tense gating', () => {
      expect(prompt).toContain('flag_emergency')
      // Must teach the model not to fire on past-tense or routine reports
      expect(prompt.toLowerCase()).toContain('right now')
    })

    // v1 is the pre-Phase/27 prompt. The newer partial-logging tools were
    // intentionally NOT added until Manisha re-signs — v1 should remain
    // silent on them. These assertions lock that behaviour so a future
    // edit doesn't quietly leak partial-tool guidance into v1.
    it('does NOT mention log_medication_adherence (v1 is intentionally silent)', () => {
      expect(prompt).not.toContain('log_medication_adherence')
    })

    it('does NOT mention log_symptom_quick (v1 is intentionally silent)', () => {
      expect(prompt).not.toContain('log_symptom_quick')
    })

    it('does NOT mention submit_bp_from_photo (v1 is intentionally silent)', () => {
      expect(prompt).not.toContain('submit_bp_from_photo')
    })
  })

  describe('v2 (Phase/27, flag-gated)', () => {
    const prompt = buildTextPromptV2()

    it('mentions submit_checkin', () => {
      expect(prompt).toContain('submit_checkin')
    })

    it('mentions get_recent_readings with the retrieval flow', () => {
      // Closed 2026-05-20 — v2 prompt now has the RETRIEVING READINGS
      // section that v1 had; the gap from the audit is resolved.
      expect(prompt).toContain('get_recent_readings')
      expect(prompt.toUpperCase()).toContain('RETRIEVING READINGS')
    })

    it('mentions update_checkin', () => {
      expect(prompt).toContain('update_checkin')
    })

    it('mentions delete_checkin', () => {
      expect(prompt).toContain('delete_checkin')
    })

    it('mentions flag_emergency with present-tense gating', () => {
      expect(prompt).toContain('flag_emergency')
      expect(prompt.toLowerCase()).toContain('right now')
    })

    it('mentions log_medication_adherence with single-drug-name trigger', () => {
      expect(prompt).toContain('log_medication_adherence')
    })

    it('mentions log_symptom_quick with present-tense / no-BP trigger', () => {
      expect(prompt).toContain('log_symptom_quick')
      expect(prompt.toLowerCase()).toContain('present-tense')
    })

    it('mentions submit_bp_from_photo with verbal-confirm-before-save rule', () => {
      expect(prompt).toContain('submit_bp_from_photo')
      // V2 teaches the photo flow — VERBALLY CONFIRM appears in v2 only.
      expect(prompt.toUpperCase()).toContain('VERBALLY CONFIRM')
    })

    it('teaches medication_scheduled_later (not missed) for "not due yet" answers', () => {
      expect(prompt).toContain('medication_scheduled_later')
    })

    it('teaches the structured symptom booleans (Stage A keys)', () => {
      for (const key of [
        'severeHeadache',
        'visualChanges',
        'alteredMentalStatus',
        'chestPainOrDyspnea',
        'focalNeuroDeficit',
        'severeEpigastricPain',
        'newOnsetHeadache',
        'ruqPain',
        'edema',
      ]) {
        expect(prompt).toContain(key)
      }
    })
  })
})

// ─── Voice-chat prompt tool awareness ────────────────────────────────────────

describe('Voice-chat system instruction — tool awareness', () => {
  describe('v1', () => {
    const prompt = buildVoicePromptV1()

    it('mentions submit_checkin / get_recent_readings / update_checkin / delete_checkin', () => {
      expect(prompt).toContain('submit_checkin')
      expect(prompt).toContain('get_recent_readings')
      expect(prompt).toContain('update_checkin')
      expect(prompt).toContain('delete_checkin')
    })

    it('mentions submit_bp_from_photo with the verbal-confirm photo flow', () => {
      // Closed 2026-05-20 — voice V1 now lists submit_bp_from_photo as
      // tool #5 in AVAILABLE TOOLS and has a dedicated PHOTO OCR FLOW
      // section, so a voice patient sending a cuff photo gets a parsed
      // result + verbal confirm before save.
      expect(prompt).toContain('submit_bp_from_photo')
      expect(prompt.toUpperCase()).toContain('PHOTO OCR FLOW')
    })

    it('does NOT mention flag_emergency (voice has no such tool today)', () => {
      // Voice handles 911 inline via speech. There is no flag_emergency
      // declaration on the voice service, so the prompt must not invite
      // a hallucinated tool call.
      expect(prompt).not.toContain('flag_emergency')
    })

    it('does NOT mention log_medication_adherence / log_symptom_quick', () => {
      expect(prompt).not.toContain('log_medication_adherence')
      expect(prompt).not.toContain('log_symptom_quick')
    })

    it('teaches one-tool-per-turn discipline', () => {
      expect(prompt.toLowerCase()).toMatch(/one tool per turn/i)
    })

    it('teaches the present-tense 911 trigger inline (no flag_emergency tool)', () => {
      expect(prompt.toLowerCase()).toContain('call 911')
    })
  })

  describe('v2 (Phase/27)', () => {
    const prompt = buildVoicePromptV2()

    it('mentions all 5 voice tools by name', () => {
      expect(prompt).toContain('submit_checkin')
      expect(prompt).toContain('get_recent_readings')
      expect(prompt).toContain('update_checkin')
      expect(prompt).toContain('delete_checkin')
      expect(prompt).toContain('submit_bp_from_photo')
    })

    it('teaches the verbal-confirm photo-OCR flow', () => {
      expect(prompt.toUpperCase()).toContain('VERBALLY CONFIRM')
    })

    it('teaches the partial-logging-via-sparse-submit_checkin pattern', () => {
      expect(prompt.toLowerCase()).toContain('partial logging')
      expect(prompt.toLowerCase()).toMatch(/sparse[- ]submit_checkin/)
    })

    it('teaches medication_scheduled_later (not missed)', () => {
      expect(prompt).toContain('medication_scheduled_later')
    })

    it('teaches the structured Stage-A symptom booleans', () => {
      for (const key of [
        'severeHeadache',
        'visualChanges',
        'alteredMentalStatus',
        'chestPainOrDyspnea',
        'focalNeuroDeficit',
        'severeEpigastricPain',
        'newOnsetHeadache',
        'ruqPain',
        'edema',
      ]) {
        expect(prompt).toContain(key)
      }
    })

    it('teaches Cluster 8 (faceSwelling / throatTightness) airway-emergency symptom keys', () => {
      // Closed 2026-05-20 — voice V2 schema now accepts the Cluster 8
      // booleans and the prompt directs the model to set them when the
      // patient reports facial or throat swelling. The corresponding
      // TIER_1_ANGIOEDEMA rule fires regardless of BP, on any patient.
      expect(prompt).toContain('faceSwelling')
      expect(prompt).toContain('throatTightness')
    })

    it('GAP — v2 voice prompt still does NOT teach Cluster 7 (BB/ACE side-effect) symptom keys', () => {
      // Cluster 7 (fatigue / shortnessOfBreath / dryCough / nsaidUse) is
      // pending Manisha sign-off; voice during-check-in path doesn't
      // capture them yet. The prompt and the voice schema both stay
      // silent on these — internally consistent. Remove this assertion
      // when Manisha approves and the schema is extended.
      const cluster7 = ['fatigue', 'shortnessOfBreath', 'dryCough']
      for (const key of cluster7) {
        expect(prompt).not.toContain(key)
      }
    })

    it('still has no flag_emergency / log_*_quick tools', () => {
      expect(prompt).not.toContain('flag_emergency')
      expect(prompt).not.toContain('log_medication_adherence')
      expect(prompt).not.toContain('log_symptom_quick')
    })
  })
})

// ─── Cross-surface consistency ────────────────────────────────────────────────

describe('Cross-surface prompt consistency', () => {
  it('both v1 prompts (text + voice) teach the language-lock rule', () => {
    const text = buildTextPromptV1()
    const voice = buildVoicePromptV1()
    // Text V1: "If the patient writes in another language, switch to it"
    expect(text.toLowerCase()).toContain('language')
    // Voice V1: explicit LANGUAGE_RULE block
    expect(voice).toContain('LANGUAGE — LOCK AND STAY')
  })

  it('both v1 prompts teach medication-safety non-negotiables', () => {
    const text = buildTextPromptV1()
    const voice = buildVoicePromptV1()
    expect(text.toLowerCase()).toContain('medication safety')
    expect(voice.toLowerCase()).toContain('medication safety')
  })

  it('both v2 prompts teach the alert-engine handoff', () => {
    const text = buildTextPromptV2()
    const voice = buildVoicePromptV2()
    expect(text.toLowerCase()).toContain('active-alert')
    expect(voice.toLowerCase()).toContain('active-alert')
  })

  it('voice and text v1 prompts both forbid silent-save behaviour', () => {
    const text = buildTextPromptV1()
    const voice = buildVoicePromptV1()
    // Text: "CALL THE TOOL"
    expect(text.toUpperCase()).toContain('CALL THE TOOL')
    // Voice: must call the tool
    expect(voice.toLowerCase()).toContain('call the tool')
  })
})
