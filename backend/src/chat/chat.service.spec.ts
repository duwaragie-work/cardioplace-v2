// Phase/16 integration spec for ChatService.buildPatientSystemPrompt().
// Asserts the ProfileResolverService wiring + v2 DeviationAlert query shape
// + graceful admin / no-profile handling. Uses real SystemPromptService so
// the full rendered prompt is asserted — mocks only cross-service deps.

import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { ProfileNotFoundException, type ResolvedContext } from '@cardioplace/shared'
import { ChatService } from './chat.service.js'
import { SystemPromptService } from './services/system-prompt.service.js'
import { RagService } from './services/rag.service.js'
import { ConversationHistoryService } from './services/conversation-history.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { DailyJournalService } from '../daily_journal/daily_journal.service.js'
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

describe('ChatService.buildPatientSystemPrompt() — phase/16', () => {
  let service: ChatService
  let prisma: Record<string, any>
  let profileResolver: { resolve: jest.Mock }

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
    }
    profileResolver = {
      resolve: (jest.fn() as jest.Mock<any>).mockResolvedValue(
        buildResolvedContext(),
      ),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        SystemPromptService, // real
        { provide: PrismaService, useValue: prisma },
        { provide: ProfileResolverService, useValue: profileResolver },
        { provide: RagService, useValue: {} },
        { provide: ConversationHistoryService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: DailyJournalService, useValue: {} },
        { provide: GeminiService, useValue: {} },
      ],
    }).compile()
    service = module.get(ChatService)
  })

  async function run(userId: string): Promise<string> {
    // buildPatientSystemPrompt is private — access via any for focused testing.
    return (service as any).buildPatientSystemPrompt(userId) as Promise<string>
  }

  // ==========================================================================
  // C.1 ProfileResolver integration
  // ==========================================================================
  describe('C.1 ProfileResolver integration', () => {
    it('calls ProfileResolverService.resolve with the correct userId', async () => {
      await run('user-1')
      expect(profileResolver.resolve).toHaveBeenCalledWith('user-1')
    })

    it('admin user (no PatientProfile) → prompt renders with fallback', async () => {
      profileResolver.resolve.mockRejectedValue(
        new ProfileNotFoundException('admin-1'),
      )
      const prompt = await run('admin-1')
      expect(prompt).toContain('Clinical profile: not available')
      expect(prompt).not.toContain('Cardiac conditions:')
    })

    it('patient with full resolved context → renders condition summary', async () => {
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
      const prompt = await run('user-1')
      expect(prompt).toContain('Heart failure (HFrEF)')
    })

    it('unknown ProfileResolver error → propagates (not silently swallowed)', async () => {
      profileResolver.resolve.mockRejectedValue(new Error('DB down'))
      await expect(run('user-1')).rejects.toThrow('DB down')
    })
  })

  // ==========================================================================
  // C.2 Alert fetching (v2 shape)
  // ==========================================================================
  describe('C.2 DeviationAlert query shape', () => {
    it('queries v2 columns: tier, ruleId, mode, patientMessage, physicianMessage, dismissible, createdAt', async () => {
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

    it('filters by status ∈ [OPEN, ACKNOWLEDGED]', async () => {
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

    it('renders returned alert with tier + ruleId + patientMessage in prompt', async () => {
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
      const prompt = await run('user-1')
      expect(prompt).toContain('TIER_1_CONTRAINDICATION')
      expect(prompt).toContain('RULE_PREGNANCY_ACE_ARB')
      expect(prompt).toContain('call your provider today')
      expect(prompt).toContain('NON-DISMISSABLE')
    })

    it('no alerts → "Active alerts: None"', async () => {
      const prompt = await run('user-1')
      expect(prompt).toContain('Active alerts: None')
    })
  })

  // ==========================================================================
  // C.3 Query count (no N+1, parallel execution)
  // ==========================================================================
  describe('C.3 query shape', () => {
    it('runs exactly 3 Prisma queries + 1 resolver call in parallel', async () => {
      await run('user-1')
      expect(prisma.journalEntry.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.deviationAlert.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1)
      expect(profileResolver.resolve).toHaveBeenCalledTimes(1)
    })

    it('userId empty → short-circuits before any query', async () => {
      const prompt = await run('')
      expect(profileResolver.resolve).not.toHaveBeenCalled()
      expect(prisma.journalEntry.findMany).not.toHaveBeenCalled()
      // Base prompt still returned
      expect(prompt).toContain('Cardioplace')
    })
  })

  // ==========================================================================
  // Guardrail regression (must stay in every prompt)
  // ==========================================================================
  describe('guardrail regression', () => {
    it('medication guardrail present in every prompt', async () => {
      const prompt = await run('user-1')
      expect(prompt).toContain(
        'Never suggest starting, stopping, changing, or adjusting any medication',
      )
    })

    it('tier-aware guardrails present in every prompt', async () => {
      const prompt = await run('user-1')
      expect(prompt).toContain('Tier 1 Contraindication')
      expect(prompt).toContain('BP Level 2 emergency')
      expect(prompt).toContain('call 911')
    })

    it('PATIENT tone directive present', async () => {
      const prompt = await run('user-1')
      expect(prompt).toContain('TONE — patient mode')
    })
  })
})
