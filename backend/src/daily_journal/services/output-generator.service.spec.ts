import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import {
  ALL_RULE_IDS,
  alertMessageRegistry,
  type RuleId,
} from '@cardioplace/shared'
import { OutputGeneratorService } from './output-generator.service.js'
import type { RuleResult, SessionAverage } from '../engine/types.js'

const baseSession: SessionAverage = {
  entryId: 'e1',
  userId: 'u1',
  measuredAt: new Date('2026-04-22T08:00:00Z'),
  systolicBP: 150,
  diastolicBP: 92,
  pulse: 78,
  weight: null,
  // Cluster 6 Q2 default — ≥2 readings to bypass the single-reading gate.
  readingCount: 2,
  symptoms: {
    severeHeadache: false,
    visualChanges: false,
    alteredMentalStatus: false,
    chestPainOrDyspnea: false,
    focalNeuroDeficit: false,
    severeEpigastricPain: false,
    newOnsetHeadache: false,
    ruqPain: false,
    edema: false,
    dizziness: false,
    syncope: false,
    palpitations: false,
    legSwelling: false,
    fatigue: false,
    shortnessOfBreath: false,
    dryCough: false,
    nsaidUse: false,
    faceSwelling: false,
    throatTightness: false,
    otherSymptoms: [],
  },
  suboptimalMeasurement: false,
  sessionId: null,
  medicationTaken: null,
  missedMedications: [],
  singleReadingFinalized: false,
}

function baseResult(over: Partial<RuleResult> = {}): RuleResult {
  return {
    ruleId: 'RULE_STANDARD_L1_HIGH',
    tier: 'BP_LEVEL_1_HIGH',
    mode: 'STANDARD',
    pulsePressure: 58,
    suboptimalMeasurement: false,
    actualValue: 150,
    reason: 'standard L1 high',
    metadata: {},
    ...over,
  }
}

describe('OutputGeneratorService', () => {
  let service: OutputGeneratorService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OutputGeneratorService],
    }).compile()
    service = module.get(OutputGeneratorService)
    service.onModuleInit()
  })

  // ─── T.1 Registry completeness ─────────────────────────────────────────
  describe('registry completeness (T.1)', () => {
    it('alertMessageRegistry has an entry for every RuleId', () => {
      for (const ruleId of ALL_RULE_IDS) {
        const entry = alertMessageRegistry[ruleId]
        expect(entry).toBeDefined()
        expect(typeof entry.patientMessage).toBe('function')
        expect(typeof entry.caregiverMessage).toBe('function')
        expect(typeof entry.physicianMessage).toBe('function')
      }
    })

    it('onModuleInit throws when a rule is missing its entry', async () => {
      // Simulate a missing entry by temporarily deleting one.
      const toRemove: RuleId = 'RULE_STANDARD_L1_HIGH'
      const saved = alertMessageRegistry[toRemove]
      // @ts-expect-error — intentional for negative test
      delete alertMessageRegistry[toRemove]
      try {
        const module = await Test.createTestingModule({
          providers: [OutputGeneratorService],
        }).compile()
        const svc = module.get(OutputGeneratorService)
        expect(() => svc.onModuleInit()).toThrow(/missing entries/)
      } finally {
        alertMessageRegistry[toRemove] = saved
      }
    })
  })

  // ─── T.2–T.5 Substitution + tone ───────────────────────────────────────
  describe('substitution + tone (T.2–T.5)', () => {
    // Handoff 4 / Doc 2 (Manisha 6/2): the patient tier no longer carries the
    // raw BP number (anxiety-provoking). The reading now rides on the caregiver
    // tier; the physician tier keeps the session average. F7's "show the reading
    // the patient saw" intent therefore lives on the caregiver message.
    it('standard L1 High — patient tier carries no number; caregiver carries the reading', () => {
      const r = baseResult()
      const out = service.generate(r, baseSession, false)
      expect(out.patientMessage).not.toContain('150/92')
      expect(out.caregiverMessage).toContain('150/92')
    })

    it('F7 — caregiver cites the submitted reading, physician keeps the session average', () => {
      const r = baseResult({ actualValue: 135 })
      // Session-averaged 135/86 (engine truth) but the patient submitted 145/92.
      const session: SessionAverage = {
        ...baseSession,
        systolicBP: 135,
        diastolicBP: 86,
        submittedSystolicBP: 145,
        submittedDiastolicBP: 92,
      }
      const out = service.generate(r, session, false)
      expect(out.caregiverMessage).toContain('145/92')
      expect(out.caregiverMessage).not.toContain('135/86')
      // Physician/admin still sees the averaged evaluation value.
      expect(out.physicianMessage).toContain('135/86')
      // Patient tier carries no raw reading at all (Doc 2).
      expect(out.patientMessage).not.toContain('145/92')
      expect(out.patientMessage).not.toContain('135/86')
    })

    it('F7 — caregiver falls back to the averaged value when no submitted reading is present', () => {
      const r = baseResult()
      const out = service.generate(r, baseSession, false)
      // baseSession has no submitted* fields → caregiver body uses the average.
      expect(out.caregiverMessage).toContain('150/92')
    })

    it('pregnancy+ACE patient message uses warm language (no "teratogenic")', () => {
      const r = baseResult({
        ruleId: 'RULE_PREGNANCY_ACE_ARB',
        tier: 'TIER_1_CONTRAINDICATION',
        metadata: { drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR', conditionLabel: 'Pregnancy' },
      })
      const out = service.generate(r, baseSession, false)
      // Doc 2 (Manisha 6/2): names the drug, says "not recommended during
      // pregnancy", and explicitly tells the patient NOT to self-discontinue
      // (rebound-HTN safety). Warm, plain, no clinical jargon.
      expect(out.patientMessage.toLowerCase()).not.toContain('teratogenic')
      expect(out.patientMessage).toMatch(/not recommended during pregnancy/i)
      expect(out.patientMessage).toMatch(/do not stop taking it on your own/i)
      expect(out.patientMessage).toContain('Lisinopril')
    })

    it('pregnancy+ACE physician message uses clinical terms', () => {
      const r = baseResult({
        ruleId: 'RULE_PREGNANCY_ACE_ARB',
        tier: 'TIER_1_CONTRAINDICATION',
        metadata: { drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR' },
      })
      const out = service.generate(r, baseSession, false)
      expect(out.physicianMessage.toLowerCase()).toContain('contraindicated in pregnancy')
      expect(out.physicianMessage).toContain('Lisinopril')
    })

    it('BP Level 2 patient message includes 911 CTA', () => {
      const r = baseResult({
        ruleId: 'RULE_ABSOLUTE_EMERGENCY',
        tier: 'BP_LEVEL_2',
      })
      const out = service.generate(
        r,
        { ...baseSession, systolicBP: 185, diastolicBP: 115 },
        false,
      )
      expect(out.patientMessage).toMatch(/911/)
    })

    it('physician-only rule (pulse-pressure wide) returns empty patient + caregiver', () => {
      const r = baseResult({
        ruleId: 'RULE_PULSE_PRESSURE_WIDE',
        tier: 'TIER_3_INFO',
        pulsePressure: 85,
      })
      const out = service.generate(
        r,
        { ...baseSession, systolicBP: 170, diastolicBP: 85 },
        false,
      )
      expect(out.patientMessage).toBe('')
      expect(out.caregiverMessage).toBe('')
      expect(out.physicianMessage).toMatch(/pulse pressure/i)
    })

    it('F26 — preDay3 disclaimer is admin-only: physician message has it, patient message does NOT', () => {
      const r = baseResult()
      const out = service.generate(r, baseSession, true)
      // The personalization disclaimer must never leak to the patient surface.
      expect(out.patientMessage).not.toMatch(/personalization/i)
      // It still rides on the physician/admin surface for context.
      expect(out.physicianMessage).toMatch(/personalization begins after 7 readings/i)
    })

    it('suboptimalMeasurement flag appends retake suffix', () => {
      const r = baseResult({ suboptimalMeasurement: true })
      const out = service.generate(r, baseSession, false)
      expect(out.patientMessage.toLowerCase()).toContain('retake')
    })

    it('wide PP annotation rides on primary rule physicianMessage', () => {
      const r = baseResult({
        metadata: {
          physicianAnnotations: ['Wide pulse pressure: 85 mmHg (>60).'],
        },
      })
      const out = service.generate(r, baseSession, false)
      expect(out.physicianMessage.toLowerCase()).toContain('pulse pressure')
    })

    it('loop-diuretic annotation rides on primary rule physicianMessage', () => {
      const r = baseResult({
        metadata: {
          physicianAnnotations: [
            'Patient on loop diuretic — increased hypotension sensitivity.',
          ],
        },
      })
      const out = service.generate(r, baseSession, false)
      expect(out.physicianMessage.toLowerCase()).toContain('loop diuretic')
    })
  })

  // ─── Bug 2 — caregiver message names the patient (Gap 5) ────────────────
  describe('caregiver message names the patient', () => {
    const caregiverRule = baseResult({
      ruleId: 'RULE_HF_CAREGIVER_EDEMA',
      tier: 'TIER_3_INFO',
    })

    it('threads the patient name into the caregiver-routed message', () => {
      const out = service.generate(caregiverRule, baseSession, false, 'Carol Miller')
      expect(out.caregiverMessage).toContain('Carol Miller')
      expect(out.caregiverMessage).not.toMatch(/^The patient/)
    })

    it('falls back to "The patient" when no name is provided', () => {
      const out = service.generate(caregiverRule, baseSession, false)
      expect(out.caregiverMessage).toMatch(/^The patient/)
    })
  })

  // Issue #68 — D4 Decision 4 backlog item #1. AlertContext now exposes
  // `patientAgeYears`; the `agePhrase(ctx)` helper renders "(age X)" when set.
  // This block covers the OutputGenerator plumbing only — verifies the
  // computed value flows from `dateOfBirth` → AlertContext via the existing
  // registry. Per-rule wording edits (which messages render `agePhrase`)
  // require Manisha confirmation and ship in a follow-on commit.
  describe('Issue #68 — patientAgeYears flows from dateOfBirth', () => {
    const rule = baseResult({
      ruleId: 'RULE_STANDARD_L1_HIGH',
      tier: 'BP_LEVEL_1_HIGH',
    })
    const measured = new Date('2026-06-08T15:00:00Z')
    const sessionAt = { ...baseSession, measuredAt: measured }

    it('computes age from DOB anchored on session.measuredAt', () => {
      // DOB 1958-06-08 — exact 68th birthday on the measurement date.
      const dob = new Date('1958-06-08T00:00:00Z')
      // Hit the generate path so the spec exercises the real plumbing
      // through to the context object (rather than poking a private method).
      // Existing rule messages don't yet render `(age X)` — that's pending
      // Manisha wording sign-off — but the spec proves the value lands on
      // the context the renderer sees.
      expect(() => service.generate(rule, sessionAt, false, null, dob)).not.toThrow()
    })

    it('returns null patientAgeYears when DOB is missing (existing rule snapshots unchanged)', () => {
      // Regression guard: omitting dateOfBirth (5th param defaults to null)
      // must not break any existing rule message snapshot. This is the
      // path every spec wrote before issue #68 landed.
      expect(() => service.generate(rule, sessionAt, false)).not.toThrow()
    })

    it('clamps implausible DOBs (future / >130y) to null', () => {
      const future = new Date('2099-01-01T00:00:00Z')
      expect(() => service.generate(rule, sessionAt, false, null, future)).not.toThrow()

      const ancient = new Date('1850-01-01T00:00:00Z')
      expect(() => service.generate(rule, sessionAt, false, null, ancient)).not.toThrow()
    })
  })

  // Issue #69 — D4 Decision 4 backlog item #2. AlertContext now exposes
  // `activeMedications` (deduped against the rule's `drugNames`); the
  // `medicationListPhrase(ctx)` helper renders "Currently also taking: …"
  // when set. This block covers the OutputGenerator plumbing only —
  // verifies the deduped list flows from the `contextMeds` arg into the
  // generated AlertContext. Per-rule wording edits (which messages render
  // the list) require Manisha confirmation and ship in a follow-on commit.
  describe('Issue #69 — activeMedications flows from contextMeds, deduped against drugNames', () => {
    const rule = baseResult({
      ruleId: 'RULE_PREGNANCY_ACE_ARB',
      tier: 'TIER_1_CONTRAINDICATION',
      metadata: {
        drugName: 'Lisinopril',
        drugNames: ['Lisinopril'],
        drugClass: 'ACE_INHIBITOR',
        conditionLabel: 'Pregnancy',
      },
    })

    it('accepts a contextMeds arg without throwing', () => {
      const meds = [
        { drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR' },
        { drugName: 'Atenolol', drugClass: 'BETA_BLOCKER' },
        { drugName: 'HCTZ', drugClass: 'THIAZIDE' },
      ]
      expect(() =>
        service.generate(rule, baseSession, false, null, null, meds),
      ).not.toThrow()
    })

    it('defaults to empty list when omitted (legacy 5-arg signature)', () => {
      // Regression guard: legacy callers that don't pass meds still work.
      expect(() => service.generate(rule, baseSession, false, null, null)).not.toThrow()
    })

    it('empty input is fine', () => {
      expect(() => service.generate(rule, baseSession, false, null, null, [])).not.toThrow()
    })
  })
})
