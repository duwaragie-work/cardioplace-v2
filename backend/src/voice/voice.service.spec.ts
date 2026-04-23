// Phase/16 focused spec for VoiceService.buildPatientContext().
//
// Mirrors the chat.service.spec.ts pattern: constructs VoiceService with real
// SystemPromptService + mocked Prisma/ProfileResolver/everything else, then
// exercises the private `buildPatientContext(userId, sessionId?)` method via
// `(service as any)`. Scoped to the method refactored in phase/16 — full
// gRPC / session / streaming paths remain out of scope for unit testing.

import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { ProfileNotFoundException, type ResolvedContext } from '@cardioplace/shared'
import { VoiceService } from './voice.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { ConversationHistoryService } from '../chat/services/conversation-history.service.js'
import { SystemPromptService } from '../chat/services/system-prompt.service.js'
import { ProfileResolverService } from '../daily_journal/services/profile-resolver.service.js'
import { GeminiService } from '../gemini/gemini.service.js'

const NOW = new Date('2026-04-22T10:00:00Z')
const DOB = new Date('1980-06-15T00:00:00Z')

function buildResolvedContext(
  over: Partial<ResolvedContext> = {},
): ResolvedContext {
  return {
    userId: 'user-1',
    dateOfBirth: DOB,
    timezone: 'America/New_York',
    ageGroup: '40-64',
    profile: {
      gender: 'FEMALE',
      heightCm: 165,
      isPregnant: false,
      pregnancyDueDate: null,
      historyPreeclampsia: false,
      hasHeartFailure: false,
      heartFailureType: 'NOT_APPLICABLE',
      resolvedHFType: 'NOT_APPLICABLE',
      hasAFib: false,
      hasCAD: false,
      hasHCM: false,
      hasDCM: false,
      hasTachycardia: false,
      hasBradycardia: false,
      diagnosedHypertension: true,
      verificationStatus: 'VERIFIED',
      verifiedAt: NOW,
      lastEditedAt: NOW,
    },
    contextMeds: [],
    excludedMeds: [],
    threshold: null,
    assignment: null,
    readingCount: 10,
    preDay3Mode: false,
    personalizedEligible: false,
    pregnancyThresholdsActive: false,
    triggerPregnancyContraindicationCheck: false,
    resolvedAt: NOW,
    ...over,
  }
}

describe('VoiceService.buildPatientContext() — phase/16', () => {
  let service: VoiceService
  let prisma: Record<string, any>
  let profileResolver: { resolve: jest.Mock }
  let configService: { get: jest.Mock; getOrThrow: jest.Mock }

  beforeEach(async () => {
    prisma = {
      journalEntry: {
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
      },
      deviationAlert: {
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
      },
      user: {
        findUnique: (jest.fn() as jest.Mock<any>).mockResolvedValue({
          name: 'Test Patient',
          timezone: 'America/New_York',
          communicationPreference: 'TEXT_FIRST',
          preferredLanguage: 'en',
          dateOfBirth: DOB,
        }),
      },
      session: {
        findUnique: (jest.fn() as jest.Mock<any>).mockResolvedValue(null),
      },
    }
    profileResolver = {
      resolve: (jest.fn() as jest.Mock<any>).mockResolvedValue(
        buildResolvedContext(),
      ),
    }
    configService = {
      get: jest.fn().mockImplementation((key: string, dflt?: string) => dflt),
      getOrThrow: jest.fn().mockReturnValue('test-secret'),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceService,
        SystemPromptService, // real
        { provide: ConfigService, useValue: configService },
        { provide: PrismaService, useValue: prisma },
        { provide: ProfileResolverService, useValue: profileResolver },
        { provide: ConversationHistoryService, useValue: {} },
        { provide: GeminiService, useValue: {} },
      ],
    }).compile()
    service = module.get(VoiceService)
  })

  async function run(userId: string, sessionId?: string): Promise<string> {
    return (service as any).buildPatientContext(userId, sessionId) as Promise<string>
  }

  // ==========================================================================
  // ProfileResolver integration
  // ==========================================================================
  describe('ProfileResolver integration', () => {
    it('calls ProfileResolverService.resolve with the correct userId', async () => {
      await run('user-1')
      expect(profileResolver.resolve).toHaveBeenCalledWith('user-1')
    })

    it('admin user (no PatientProfile) → context falls back gracefully', async () => {
      profileResolver.resolve.mockRejectedValue(
        new ProfileNotFoundException('admin-1'),
      )
      const context = await run('admin-1')
      expect(context).toContain('Clinical profile: not available')
      expect(context).not.toContain('Cardiac conditions:')
    })

    it('patient with HFrEF → context includes condition summary', async () => {
      profileResolver.resolve.mockResolvedValue(
        buildResolvedContext({
          profile: {
            ...buildResolvedContext().profile,
            hasHeartFailure: true,
            heartFailureType: 'HFREF',
            resolvedHFType: 'HFREF',
          },
        }),
      )
      const context = await run('user-1')
      expect(context).toContain('Heart failure (HFrEF)')
    })

    it('unknown ProfileResolver error → caught, defensive fallback returned', async () => {
      profileResolver.resolve.mockRejectedValue(new Error('DB down'))
      const context = await run('user-1')
      // voice.service.ts has a top-level try/catch returning this literal.
      expect(context).toBe('Patient context unavailable.')
    })
  })

  // ==========================================================================
  // DeviationAlert v2 query shape (must match chat.service for consistency)
  // ==========================================================================
  describe('DeviationAlert v2 query shape', () => {
    it('selects v2 columns: tier, ruleId, mode, patientMessage, physicianMessage, dismissible, createdAt', async () => {
      await run('user-1')
      const call = prisma.deviationAlert.findMany.mock.calls[0][0]
      expect(call.select).toEqual({
        tier: true,
        ruleId: true,
        mode: true,
        patientMessage: true,
        physicianMessage: true,
        dismissible: true,
        createdAt: true,
      })
    })

    it('filters status IN [OPEN, ACKNOWLEDGED]', async () => {
      await run('user-1')
      const call = prisma.deviationAlert.findMany.mock.calls[0][0]
      expect(call.where).toEqual({
        userId: 'user-1',
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      })
    })

    it('limits to last 5 by createdAt DESC', async () => {
      await run('user-1')
      const call = prisma.deviationAlert.findMany.mock.calls[0][0]
      expect(call.take).toBe(5)
      expect(call.orderBy).toEqual({ createdAt: 'desc' })
    })

    it('renders returned alert with tier + ruleId + patientMessage', async () => {
      prisma.deviationAlert.findMany.mockResolvedValue([
        {
          tier: 'TIER_1_CONTRAINDICATION',
          ruleId: 'RULE_PREGNANCY_ACE_ARB',
          mode: 'STANDARD',
          patientMessage: 'call your provider today',
          physicianMessage: 'Tier 1 — ACE in pregnancy',
          dismissible: false,
          createdAt: NOW,
        },
      ])
      const context = await run('user-1')
      expect(context).toContain('TIER_1_CONTRAINDICATION')
      expect(context).toContain('RULE_PREGNANCY_ACE_ARB')
      expect(context).toContain('call your provider today')
      expect(context).toContain('NON-DISMISSABLE')
    })
  })

  // ==========================================================================
  // Query shape + parallelism
  // ==========================================================================
  describe('query shape', () => {
    it('runs user/journal/deviation/session/resolver in parallel', async () => {
      await run('user-1', 'session-xyz')
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1)
      expect(prisma.journalEntry.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.deviationAlert.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.session.findUnique).toHaveBeenCalledTimes(1)
      expect(profileResolver.resolve).toHaveBeenCalledTimes(1)
    })

    it('omits session query when no sessionId passed', async () => {
      await run('user-1')
      expect(prisma.session.findUnique).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Current date/time trailer (voice-specific)
  // ==========================================================================
  describe('current-datetime trailer', () => {
    it('includes CURRENT DATE AND TIME line with patient timezone', async () => {
      const context = await run('user-1')
      expect(context).toContain(
        'CURRENT DATE AND TIME (patient timezone America/New_York)',
      )
    })

    it('falls back to America/New_York when user has no stored timezone', async () => {
      prisma.user.findUnique.mockResolvedValue({
        name: 'Test Patient',
        timezone: null,
        communicationPreference: null,
        preferredLanguage: null,
        dateOfBirth: DOB,
      })
      const context = await run('user-1')
      expect(context).toContain('patient timezone America/New_York')
    })
  })

  // ==========================================================================
  // Clinical rendering parity with chat (delegates to SystemPromptService)
  // ==========================================================================
  describe('clinical rendering parity with chat', () => {
    it('renders "No active alerts" when none present', async () => {
      const context = await run('user-1')
      expect(context).toContain('Active alerts: None')
    })

    it('renders pre-Day-3 disclaimer when readingCount < 7', async () => {
      profileResolver.resolve.mockResolvedValue(
        buildResolvedContext({ readingCount: 3, preDay3Mode: true }),
      )
      const context = await run('user-1')
      expect(context).toContain('fewer than 7 readings')
    })

    it('renders unverified medication with "⚠ unverified" tag', async () => {
      profileResolver.resolve.mockResolvedValue(
        buildResolvedContext({
          contextMeds: [
            {
              id: 'm1',
              drugName: 'Lisinopril',
              drugClass: 'ACE_INHIBITOR',
              isCombination: false,
              combinationComponents: [],
              frequency: 'ONCE_DAILY',
              source: 'PATIENT_SELF_REPORT',
              verificationStatus: 'UNVERIFIED',
              reportedAt: NOW,
            },
          ],
        }),
      )
      const context = await run('user-1')
      expect(context).toContain('⚠ unverified')
    })
  })
})
