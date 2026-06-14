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
import { VoiceToolsService } from './tools/voice-tools.service.js'
import { IntakeStatusService } from '../intake/intake-status.service.js'

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
      historyHDP: false,
      hasHeartFailure: false,
      heartFailureType: 'NOT_APPLICABLE',
      resolvedHFType: 'NOT_APPLICABLE',
      hasAFib: false,
      hasCAD: false,
      hasHCM: false,
      hasDCM: false,
      hasTachycardia: false,
      hasBradycardia: false,
      hasAorticStenosis: false,
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
    enrolledAt: null,
    practiceName: null,
    patientName: null,
    resolvedAt: NOW,
    ...over,
  }
}

describe('VoiceService.buildPatientContext() — phase/16', () => {
  let service: VoiceService
  let prisma: Record<string, any>
  let profileResolver: { resolve: jest.Mock<any> }
  let configService: { get: jest.Mock; getOrThrow: jest.Mock }
  let conversationHistory: { getSessionSummaryForVoice: jest.Mock<any> }

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
    // Bug 17 — voice now fetches the rolling session summary from
    // ConversationHistoryService so tests can control what prior text/voice
    // turns the system instruction sees. Default = empty string (fresh
    // session, no prior conversation block injected).
    conversationHistory = {
      getSessionSummaryForVoice: (jest.fn() as jest.Mock<any>).mockResolvedValue(''),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceService,
        SystemPromptService, // real
        { provide: ConfigService, useValue: configService },
        { provide: PrismaService, useValue: prisma },
        { provide: ProfileResolverService, useValue: profileResolver },
        { provide: ConversationHistoryService, useValue: conversationHistory },
        { provide: GeminiService, useValue: { clientInstance: {} } },
        { provide: VoiceToolsService, useValue: { getToolDeclarations: () => [] } },
        {
          provide: IntakeStatusService,
          useValue: {
            getStatus: jest.fn(async () => ({ completed: true, profileExists: true })),
          },
        },
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
    it('runs user/journal/deviation/session-summary/resolver in parallel', async () => {
      await run('user-1', 'session-xyz')
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1)
      expect(prisma.journalEntry.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.deviationAlert.findMany).toHaveBeenCalledTimes(1)
      // Bug 17 — session lookup moved from prisma.session.findUnique (unscoped)
      // to ConversationHistoryService.getSessionSummaryForVoice (userId-scoped).
      expect(conversationHistory.getSessionSummaryForVoice).toHaveBeenCalledTimes(1)
      expect(profileResolver.resolve).toHaveBeenCalledTimes(1)
    })

    it('omits session-summary query when no sessionId passed', async () => {
      await run('user-1')
      expect(conversationHistory.getSessionSummaryForVoice).not.toHaveBeenCalled()
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

  // ────────────────────────────────────────────────────────────────────────────
  // Bug 1 regression — voice intake-updated live broadcast.
  // The systemInstruction Gemini Live receives at connect is immutable for the
  // life of the session, so an `intake.updated` event must broadcast a text
  // turn to every active session for the affected user; otherwise the bot
  // stays stuck refusing submit_checkin until the patient ends the call.
  // ────────────────────────────────────────────────────────────────────────────
  describe('onIntakeUpdated (Bug 1)', () => {
    function makeMockSession(over: Partial<{ userId: string; streamClosed: boolean }> = {}) {
      const sendRealtimeInput = jest.fn()
      return {
        sendRealtimeInput,
        session: {
          userId: over.userId ?? 'user-1',
          streamClosed: over.streamClosed ?? false,
          liveSession: { sendRealtimeInput },
        },
      }
    }

    it('broadcasts a [System update] text turn to every active session for the user', () => {
      const sessions = (service as any).sessions as Map<string, any>
      const a = makeMockSession({ userId: 'user-1' })
      const b = makeMockSession({ userId: 'user-1' })
      sessions.set('socket-A', a.session)
      sessions.set('socket-B', b.session)

      service.onIntakeUpdated({ userId: 'user-1' })

      expect(a.sendRealtimeInput).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringMatching(/intake/i) }),
      )
      expect(b.sendRealtimeInput).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringMatching(/intake/i) }),
      )
    })

    it('does NOT broadcast to sessions belonging to other users', () => {
      const sessions = (service as any).sessions as Map<string, any>
      const self = makeMockSession({ userId: 'user-1' })
      const other = makeMockSession({ userId: 'user-2' })
      sessions.set('socket-self', self.session)
      sessions.set('socket-other', other.session)

      service.onIntakeUpdated({ userId: 'user-1' })

      expect(self.sendRealtimeInput).toHaveBeenCalledTimes(1)
      expect(other.sendRealtimeInput).not.toHaveBeenCalled()
    })

    it('skips already-closed sessions', () => {
      const sessions = (service as any).sessions as Map<string, any>
      const closed = makeMockSession({ userId: 'user-1', streamClosed: true })
      sessions.set('socket-closed', closed.session)

      service.onIntakeUpdated({ userId: 'user-1' })

      expect(closed.sendRealtimeInput).not.toHaveBeenCalled()
    })

    it('still invalidates the context cache even when no active session exists', () => {
      const spy = jest.spyOn(service, 'invalidateContextCache')
      service.onIntakeUpdated({ userId: 'user-with-no-active-session' })
      expect(spy).toHaveBeenCalledWith('user-with-no-active-session')
    })

    it('does not throw when sendRealtimeInput fails for one of multiple sessions', () => {
      const sessions = (service as any).sessions as Map<string, any>
      const failing = makeMockSession({ userId: 'user-1' })
      failing.sendRealtimeInput.mockImplementation(() => {
        throw new Error('stream broken')
      })
      const ok = makeMockSession({ userId: 'user-1' })
      sessions.set('socket-fail', failing.session)
      sessions.set('socket-ok', ok.session)

      expect(() => service.onIntakeUpdated({ userId: 'user-1' })).not.toThrow()
      expect(ok.sendRealtimeInput).toHaveBeenCalledTimes(1)
    })
  })

  // ─── Bug 58 — JournalEntry mutations invalidate the voice patient-
  // context cache so a FOLLOW-UP voice session reads fresh values after
  // any edit (chat tool, voice tool, HTTP REST). This was the gap the
  // user reported: editing a reading via My Readings left the voice's
  // cached recent-readings block showing pre-edit values.
  describe('onJournalEntryMutated (Bug 58)', () => {
    it('invalidates the context cache when a journal entry is updated', () => {
      const spy = jest.spyOn(service, 'invalidateContextCache')
      service.onJournalEntryMutated({ userId: 'user-1' })
      expect(spy).toHaveBeenCalledWith('user-1')
    })

    it('invalidates the context cache when a journal entry is created (works for ENTRY_CREATED too)', () => {
      // Same listener method handles both ENTRY_CREATED and ENTRY_UPDATED
      // via stacked @OnEvent decorators. The method itself is unit-tested
      // here; the decorator registrations are verified by the integration
      // path (when the event emitter fires, the runtime calls this method).
      const spy = jest.spyOn(service, 'invalidateContextCache')
      service.onJournalEntryMutated({ userId: 'user-create' })
      expect(spy).toHaveBeenCalledWith('user-create')
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Bug 17 — prior-conversation summary injection so voice knows what the
  // patient already said in text (and earlier voice) when joining a session
  // mid-conversation. Without this, Gemini Live opens fresh and greets the
  // patient like a new conversation, re-asking questions already answered.
  // ────────────────────────────────────────────────────────────────────────────
  describe('prior-conversation summary injection (Bug 17)', () => {
    it('does NOT call getSessionSummaryForVoice when sessionId is undefined', async () => {
      await run('user-1')
      expect(conversationHistory.getSessionSummaryForVoice).not.toHaveBeenCalled()
    })

    it('passes BOTH userId and sessionId to the summary lookup (defence-in-depth scope guard)', async () => {
      conversationHistory.getSessionSummaryForVoice.mockResolvedValue('')
      await run('user-1', 'session-A')
      expect(conversationHistory.getSessionSummaryForVoice).toHaveBeenCalledWith(
        'user-1',
        'session-A',
      )
    })

    it('omits the prior-conversation block when summary is empty (fresh session, no fresh-greet weirdness)', async () => {
      conversationHistory.getSessionSummaryForVoice.mockResolvedValue('')
      const context = await run('user-1', 'session-A')
      expect(context).not.toContain('PRIOR CONVERSATION SUMMARY')
      expect(context).not.toContain('JOINING an ongoing conversation')
    })

    it('omits the prior-conversation block when summary is whitespace-only', async () => {
      conversationHistory.getSessionSummaryForVoice.mockResolvedValue('   \n  ')
      const context = await run('user-1', 'session-A')
      expect(context).not.toContain('PRIOR CONVERSATION SUMMARY')
    })

    it('injects the prior-conversation block + JOIN instruction when summary is non-empty', async () => {
      const summary = [
        'Compressed bullets from the older history.',
        '- [Text] Patient: My BP was 145/95 → AI: That is elevated — take it again in 5 minutes.',
        '- [Voice] Patient: I took my meds → AI: Good — keep it up.',
      ].join('\n')
      conversationHistory.getSessionSummaryForVoice.mockResolvedValue(summary)
      const context = await run('user-1', 'session-A')
      // Block header + footer present
      expect(context).toContain('--- PRIOR CONVERSATION SUMMARY (text + voice turns so far) ---')
      expect(context).toContain('--- END PRIOR CONVERSATION ---')
      // Summary content present verbatim — both [Text] and [Voice] lines
      expect(context).toContain('Compressed bullets from the older history.')
      expect(context).toContain('[Text] Patient: My BP was 145/95')
      expect(context).toContain('[Voice] Patient: I took my meds')
      // JOIN instruction tells Gemini Live not to greet fresh
      expect(context).toContain('JOINING an ongoing conversation')
      expect(context).toMatch(/do NOT greet the patient as if it'?s a fresh conversation/)
      expect(context).toMatch(/do NOT re-ask questions already answered/)
    })

    it('keeps the CURRENT DATE AND TIME block AFTER the prior-conversation block', async () => {
      conversationHistory.getSessionSummaryForVoice.mockResolvedValue(
        '- [Text] Patient: hi → AI: hello',
      )
      const context = await run('user-1', 'session-A')
      const priorIdx = context.indexOf('PRIOR CONVERSATION SUMMARY')
      const dateIdx = context.indexOf('CURRENT DATE AND TIME')
      expect(priorIdx).toBeGreaterThan(-1)
      expect(dateIdx).toBeGreaterThan(priorIdx)
    })
  })
})
