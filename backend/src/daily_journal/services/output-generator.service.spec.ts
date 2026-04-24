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
  readingCount: 1,
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
    otherSymptoms: [],
  },
  suboptimalMeasurement: false,
  sessionId: null,
  medicationTaken: null,
  missedMedications: [],
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
    it('standard L1 High substitutes SBP/DBP into patient message', () => {
      const r = baseResult()
      const out = service.generate(r, baseSession, false)
      expect(out.patientMessage).toContain('150/92')
    })

    it('pregnancy+ACE patient message uses warm language (no "teratogenic")', () => {
      const r = baseResult({
        ruleId: 'RULE_PREGNANCY_ACE_ARB',
        tier: 'TIER_1_CONTRAINDICATION',
        metadata: { drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR', conditionLabel: 'Pregnancy' },
      })
      const out = service.generate(r, baseSession, false)
      expect(out.patientMessage.toLowerCase()).not.toContain('teratogenic')
      expect(out.patientMessage).toMatch(/blood pressure medicine/i)
    })

    it('pregnancy+ACE physician message uses clinical terms', () => {
      const r = baseResult({
        ruleId: 'RULE_PREGNANCY_ACE_ARB',
        tier: 'TIER_1_CONTRAINDICATION',
        metadata: { drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR' },
      })
      const out = service.generate(r, baseSession, false)
      expect(out.physicianMessage.toLowerCase()).toContain('teratogenic')
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

    it('preDay3 flag appends disclaimer on standard-mode alerts', () => {
      const r = baseResult()
      const out = service.generate(r, baseSession, true)
      expect(out.patientMessage).toMatch(/personalization begins after Day 3/i)
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
})
