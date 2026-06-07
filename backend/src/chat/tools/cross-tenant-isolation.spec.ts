// Cross-tenant isolation regression tests.
//
// These tests answer ONE question: can Patient A's tool surface ever leak
// Patient B's data? Every test seeds (or mocks) data owned by User A, then
// invokes the tool dispatch path as User B and asserts NOTHING leaks. They
// are intentionally pessimistic — most exercise the *rejection* path, since
// the "happy path" is already covered by other specs.
//
// They also pin the new defence-in-depth changes:
//   • executeJournalTool / VoiceToolsService.dispatch refuse empty userId
//   • getConversationHistory validates session ownership + emits
//     `[SECURITY] cross_tenant_attempt` log line on mismatch
//   • MedicationAdherenceService logs cross-tenant medication id probes
//   • LLM tool projections never include internal fields (userId, sessionId,
//     createdAt, etc.)
//
// If any of these tests regresses, the multi-tenant boundary has weakened
// and the PR must NOT merge.

import { jest } from '@jest/globals'
import { Test } from '@nestjs/testing'
import {
  ConversationHistoryService,
} from '../services/conversation-history.service.js'
import { MedicationAdherenceService } from '../services/medication-adherence.service.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { GeminiService } from '../../gemini/gemini.service.js'
import { EmbeddingService } from '../../common/embedding.service.js'
import { DailyJournalService } from '../../daily_journal/daily_journal.service.js'
import { VoiceToolsService } from '../../voice/tools/voice-tools.service.js'
import { AlertEngineService } from '../../daily_journal/services/alert-engine.service.js'
import {
  executeJournalTool,
  getJournalToolDeclarations,
} from './journal-tools.js'

// ─── 1. Dispatcher userId guards (Part A.3) ──────────────────────────────────

describe('Tool dispatcher userId guard', () => {
  it('executeJournalTool — empty userId throws UnauthorizedException', async () => {
    const ctx = {
      journalService: { create: jest.fn(), findAll: jest.fn(), update: jest.fn(), delete: jest.fn() } as any,
    }
    await expect(
      executeJournalTool('get_recent_readings', { days: 7 }, ctx, ''),
    ).rejects.toThrow(/authenticated patient/i)
  })

  it('executeJournalTool — non-string userId throws UnauthorizedException', async () => {
    const ctx = {
      journalService: { create: jest.fn(), findAll: jest.fn(), update: jest.fn(), delete: jest.fn() } as any,
    }
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      executeJournalTool('get_recent_readings', { days: 7 }, ctx, undefined as any),
    ).rejects.toThrow(/authenticated patient/i)
  })

  it('VoiceToolsService.dispatch — empty ctx.userId refuses with ok:false', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        VoiceToolsService,
        { provide: DailyJournalService, useValue: { create: jest.fn(), findAll: jest.fn() } },
        { provide: GeminiService, useValue: { extractBpFromImage: jest.fn() } },
        { provide: AlertEngineService, useValue: { evaluateAdHoc: jest.fn() } },
      ],
    }).compile()
    const svc = moduleRef.get(VoiceToolsService)
    const r = await svc.dispatch('get_recent_readings', { days: 7 }, { userId: '', timezone: 'America/New_York' })
    expect(r.llmResponse).toEqual(
      expect.objectContaining({ ok: false, error: expect.stringMatching(/authenticated patient/i) }),
    )
    expect(r.events).toEqual([])
  })
})

// ─── 2. userId comes from dispatch context, NEVER from LLM args ──────────────

describe('userId source — LLM args never override dispatch context', () => {
  it('executeJournalTool routes get_recent_readings with the dispatch-supplied userId only', async () => {
    const findAll = jest.fn().mockResolvedValue({ data: [] } as never) as jest.Mock
    const ctx = {
      journalService: { create: jest.fn(), findAll, update: jest.fn(), delete: jest.fn() } as any,
    }
    // The LLM tries to slip a foreign userId into args — irrelevant; the
    // executor's 4th positional arg is the only userId journalService sees.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await executeJournalTool('get_recent_readings', { days: 7, userId: 'user-B' } as any, ctx, 'user-A')
    expect(findAll).toHaveBeenCalledTimes(1)
    expect(findAll.mock.calls[0][0]).toBe('user-A')
  })

  it('VoiceToolsService dispatch routes evaluate_reading with ctx.userId only', async () => {
    const evaluateAdHoc = jest.fn().mockResolvedValue({
      evaluated: true,
      ruleId: null,
      tier: null,
      mode: null,
      preDay3: false,
      patientMessage: null,
    } as never) as jest.Mock
    const moduleRef = await Test.createTestingModule({
      providers: [
        VoiceToolsService,
        { provide: DailyJournalService, useValue: { create: jest.fn() } },
        { provide: GeminiService, useValue: { extractBpFromImage: jest.fn() } },
        { provide: AlertEngineService, useValue: { evaluateAdHoc } },
      ],
    }).compile()
    const svc = moduleRef.get(VoiceToolsService)
    // LLM sneaks foreign userId into args — must be ignored.
    await svc.dispatch(
      'evaluate_reading',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { systolic_bp: 140, diastolic_bp: 90, userId: 'user-B' } as any,
      { userId: 'user-A', timezone: 'America/New_York' },
    )
    expect(evaluateAdHoc).toHaveBeenCalledTimes(1)
    const arg = evaluateAdHoc.mock.calls[0][0] as { userId: string }
    expect(arg.userId).toBe('user-A')
  })
})

// ─── 3. Cross-tenant id (entry/session/medication) — proper rejection ────────

describe('Cross-tenant id rejections', () => {
  it('update_checkin — when journalService.update throws (cross-tenant), tool returns updated:false', async () => {
    const findAll = jest.fn().mockResolvedValue({
      data: [{ id: 'entry-foreign', measuredAt: new Date('2026-05-30T08:00:00Z') }],
    } as never) as jest.Mock
    // Simulate the daily-journal service rejection — its findFirst returned null
    // because the entry belongs to a different patient, so it threw.
    const update = jest.fn().mockRejectedValue(new Error('Journal entry not found') as never)
    const ctx = {
      journalService: { create: jest.fn(), findAll, update, delete: jest.fn() } as any,
    }
    const result = await executeJournalTool(
      'update_checkin',
      { entry_date: '2026-05-30', original_time: '08:00', systolic_bp: 130 },
      ctx,
      'user-A',
    )
    const parsed = JSON.parse(result)
    expect(parsed.updated).toBe(false)
    // Tool layer surfaces a generic message — no row data leaks.
    expect(parsed.message).toMatch(/(not found|fail)/i)
  })

  it('delete_checkin — when journalService.delete throws (cross-tenant), tool returns deleted:false', async () => {
    const findAll = jest.fn().mockResolvedValue({
      data: [{ id: 'entry-foreign', measuredAt: new Date('2026-05-30T08:00:00Z') }],
    } as never) as jest.Mock
    const del = jest.fn().mockRejectedValue(new Error('Journal entry not found') as never)
    const ctx = {
      journalService: { create: jest.fn(), findAll, update: jest.fn(), delete: del } as any,
    }
    const result = await executeJournalTool(
      'delete_checkin',
      { entry_date: '2026-05-30', original_time: '08:00' },
      ctx,
      'user-A',
    )
    const parsed = JSON.parse(result)
    expect(parsed.deleted).toBe(false)
    expect(parsed.message).toMatch(/(not found|fail)/i)
  })
})

// ─── 4. getConversationHistory ownership guard (Part A.1) ───────────────────

describe('ConversationHistoryService.getConversationHistory ownership guard', () => {
  let svc: ConversationHistoryService
  let prisma: { session: { findFirst: jest.Mock }; $queryRawUnsafe: jest.Mock }
  let loggerWarn: ReturnType<typeof jest.spyOn>

  beforeEach(async () => {
    prisma = {
      session: { findFirst: jest.fn() },
      $queryRawUnsafe: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConversationHistoryService,
        { provide: PrismaService, useValue: prisma },
        { provide: GeminiService, useValue: {} },
        { provide: EmbeddingService, useValue: { getEmbeddings: jest.fn() } },
      ],
    }).compile()
    svc = moduleRef.get(ConversationHistoryService)
    loggerWarn = jest
      .spyOn((svc as unknown as { logger: { warn: jest.Mock } }).logger, 'warn')
      .mockImplementation(() => {})
  })

  it('returns [] + logs [SECURITY] when sessionId belongs to a different user', async () => {
    // findFirst({ id, userId }) returns null because user-B doesn't own the session.
    prisma.session.findFirst.mockResolvedValue(null as never)
    const r = await svc.getConversationHistory('user-B', 'session-of-A', '')
    expect(r).toEqual([])
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled()
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringMatching(/\[SECURITY\] cross_tenant_attempt.*conversation_history/),
    )
  })

  it('returns rows + does NOT log when sessionId belongs to current user', async () => {
    prisma.session.findFirst.mockResolvedValue({ id: 'session-A' } as never)
    prisma.$queryRawUnsafe.mockResolvedValue([
      { userMessage: 'hi', aiSummary: 'hello', timestamp: new Date('2026-05-30T10:00:00Z') },
    ] as never)
    const r = await svc.getConversationHistory('user-A', 'session-A', '')
    expect(r.length).toBe(2) // [human, ai] pair
    expect(loggerWarn).not.toHaveBeenCalled()
  })

  it('returns [] when userId is empty (fail-loud, no DB query)', async () => {
    const r = await svc.getConversationHistory('', 'session-A', '')
    expect(r).toEqual([])
    expect(prisma.session.findFirst).not.toHaveBeenCalled()
  })
})

// ─── 5. MedicationAdherenceService cross-tenant medication id (Part A.2) ────

describe('MedicationAdherenceService cross-tenant guard', () => {
  let svc: MedicationAdherenceService
  let prisma: { patientMedication: { findFirst: jest.Mock; findMany: jest.Mock } }
  let loggerWarn: ReturnType<typeof jest.spyOn>

  beforeEach(async () => {
    prisma = { patientMedication: { findFirst: jest.fn(), findMany: jest.fn() } }
    const moduleRef = await Test.createTestingModule({
      providers: [
        MedicationAdherenceService,
        { provide: PrismaService, useValue: prisma },
        { provide: DailyJournalService, useValue: { create: jest.fn() } },
      ],
    }).compile()
    svc = moduleRef.get(MedicationAdherenceService)
    loggerWarn = jest
      .spyOn((svc as unknown as { logger: { warn: jest.Mock } }).logger, 'warn')
      .mockImplementation(() => {})
  })

  it('foreign medicationId → logged:false + [SECURITY] log + no drugName fallback', async () => {
    // findFirst({ id, userId }) returns null because the medication belongs
    // to another user.
    prisma.patientMedication.findFirst.mockResolvedValue(null as never)
    const r = await svc.log('user-B', {
      medicationId: 'med-of-A',
      drugName: 'Lisinopril', // would otherwise match user-B's own Lisinopril row
      status: 'taken',
    })
    expect(r.logged).toBe(false)
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringMatching(/\[SECURITY\] cross_tenant_attempt.*adherence/),
    )
    // Critical: must NOT fall through to drugName — that would let the LLM
    // probe by id then mask the failure with a same-named med of its own.
    expect(prisma.patientMedication.findMany).not.toHaveBeenCalled()
  })
})

// ─── 6. LLM privacy boundary — projection contains no internal fields ──────

describe('LLM privacy boundary (Part B.2)', () => {
  it('text get_recent_readings projection — no userId/sessionId/createdAt/updatedAt fields', async () => {
    // Simulate findAll returning a fully-populated entry (mimics serializeEntry
    // which DOES include the internal columns).
    const findAll = jest.fn().mockResolvedValue({
      data: [
        {
          id: 'entry-1',
          userId: 'user-A',           // <- internal
          sessionId: 'session-X',     // <- internal
          source: 'PATIENT_SELF_REPORT', // <- internal
          sourceMetadata: { ip: '1.2.3.4' }, // <- internal
          createdAt: new Date(),       // <- internal
          updatedAt: new Date(),       // <- internal
          measuredAt: new Date('2026-05-30T08:00:00Z'),
          systolicBP: 130,
          diastolicBP: 80,
          weight: 165,
          medicationTaken: true,
          otherSymptoms: [],
        },
      ],
    } as never) as jest.Mock
    const ctx = {
      journalService: { create: jest.fn(), findAll, update: jest.fn(), delete: jest.fn() } as any,
    }
    const result = await executeJournalTool('get_recent_readings', { days: 7 }, ctx, 'user-A')
    const parsed = JSON.parse(result)
    // Spot-check shape — must include patient-clinical fields…
    expect(parsed.readings[0]).toMatchObject({
      id: 'entry-1',
      systolic: 130,
      diastolic: 80,
    })
    // …and must NOT include internal fields.
    const keys = Object.keys(parsed.readings[0])
    expect(keys).not.toContain('userId')
    expect(keys).not.toContain('sessionId')
    expect(keys).not.toContain('source')
    expect(keys).not.toContain('sourceMetadata')
    expect(keys).not.toContain('createdAt')
    expect(keys).not.toContain('updatedAt')
  })
})

// ─── 7. Catalog assertion — guard didn't regress declarations ──────────────

describe('Tool catalog still intact after security hardening', () => {
  it('text catalog still exposes 9 tools (no accidental removals)', () => {
    const decls = getJournalToolDeclarations()
    expect(decls).toHaveLength(9)
  })
})

// ─── 8. Shared LLM-prompt select constants exclude internal columns ────────
// Pins the prisma-selects.ts contract so a future widening to include
// userId / sessionId / createdAt would fail this test BEFORE it ships.

describe('PATIENT_*_FIELDS_FOR_LLM_PROMPT constants', () => {
  it('journal constant includes clinical fields, excludes internal identifiers', async () => {
    const mod = await import('../../common/prisma-selects.js')
    const fields = mod.PATIENT_JOURNAL_FIELDS_FOR_LLM_PROMPT as Record<string, true>
    // Allowed
    expect(fields).toMatchObject({
      measuredAt: true,
      systolicBP: true,
      diastolicBP: true,
      weight: true,
      medicationTaken: true,
      otherSymptoms: true,
    })
    // Forbidden — must never be added without an explicit comment + test update
    expect(fields).not.toHaveProperty('userId')
    expect(fields).not.toHaveProperty('sessionId')
    expect(fields).not.toHaveProperty('source')
    expect(fields).not.toHaveProperty('sourceMetadata')
    expect(fields).not.toHaveProperty('createdAt')
    expect(fields).not.toHaveProperty('updatedAt')
    expect(fields).not.toHaveProperty('singleReadingFinalized')
  })

  it('alert constant excludes userId + status (already filtered upstream)', async () => {
    const mod = await import('../../common/prisma-selects.js')
    const fields = mod.PATIENT_DEVIATION_ALERT_FIELDS_FOR_LLM_PROMPT as Record<string, true>
    expect(fields).toMatchObject({
      tier: true,
      ruleId: true,
      patientMessage: true,
      physicianMessage: true,
    })
    expect(fields).not.toHaveProperty('userId')
    expect(fields).not.toHaveProperty('escalationLevel')
  })
})

// ─── 9. take-ceiling regression (Part B.1 / B.3 minimization) ──────────────
// Reflect-based assertion: the chat sessions list + session-history methods
// must ALWAYS include a `take` ceiling — even on the patient's own data,
// "minimum necessary" is the OWASP LLM02 principle.

describe('take ceilings on user-scoped findMany', () => {
  // We assert via a mocked Prisma client + spy: call the method, then
  // inspect the args the service passed to findMany.
  it('chat.getUserSessions calls findMany with take<=100', async () => {
    const findMany = jest.fn().mockResolvedValue([] as never)
    const { ChatService } = await import('../chat.service.js')
    // Minimal partial mock — only the field the SUT touches.
    const svc = Object.create(ChatService.prototype) as InstanceType<typeof ChatService>
    ;(svc as unknown as { prisma: { session: { findMany: jest.Mock } } }).prisma = {
      session: { findMany },
    }
    await svc.getUserSessions('user-A')
    expect(findMany).toHaveBeenCalledTimes(1)
    const arg = findMany.mock.calls[0][0] as { take?: number; where: { userId: string } }
    expect(arg.where.userId).toBe('user-A')
    expect(typeof arg.take).toBe('number')
    expect(arg.take ?? Infinity).toBeLessThanOrEqual(100)
  })

  it('chat.getSessionHistory calls conversation.findMany with take<=500', async () => {
    const sessionFindFirst = jest.fn().mockResolvedValue({ id: 'session-A' } as never)
    const conversationFindMany = jest.fn().mockResolvedValue([] as never)
    const { ChatService } = await import('../chat.service.js')
    const svc = Object.create(ChatService.prototype) as InstanceType<typeof ChatService>
    ;(svc as unknown as { prisma: { session: { findFirst: jest.Mock }; conversation: { findMany: jest.Mock } } }).prisma = {
      session: { findFirst: sessionFindFirst },
      conversation: { findMany: conversationFindMany },
    }
    await svc.getSessionHistory('session-A', 'user-A')
    expect(conversationFindMany).toHaveBeenCalledTimes(1)
    const arg = conversationFindMany.mock.calls[0][0] as { take?: number }
    expect(typeof arg.take).toBe('number')
    expect(arg.take ?? Infinity).toBeLessThanOrEqual(500)
  })
})

// ─── 10. Role-gate metadata + voice handshake (Part B.3) ───────────────────
// Pins both authorization layers:
//  • HTTP controllers declare @Roles(UserRole.PATIENT) on the class
//  • Voice gateway role-check refuses non-PATIENT sockets

describe('Role-based access — @Roles + voice handshake', () => {
  it('ChatController class metadata declares Roles: [PATIENT]', async () => {
    const { ChatController } = await import('../chat.controller.js')
    const { ROLES_KEY } = await import('../../auth/decorators/roles.decorator.js')
    const roles = Reflect.getMetadata(ROLES_KEY, ChatController) as string[] | undefined
    expect(roles).toEqual(['PATIENT'])
  })

  it('DailyJournalController class metadata declares Roles: [PATIENT]', async () => {
    const { DailyJournalController } = await import('../../daily_journal/daily_journal.controller.js')
    const { ROLES_KEY } = await import('../../auth/decorators/roles.decorator.js')
    const roles = Reflect.getMetadata(ROLES_KEY, DailyJournalController) as string[] | undefined
    expect(roles).toEqual(['PATIENT'])
  })

  it('VoiceGateway handshake disconnects socket when JWT role is not PATIENT', async () => {
    const { VoiceGateway } = await import('../../voice/voice.gateway.js')
    const emit = jest.fn()
    const disconnect = jest.fn()
    const fakeSocket = {
      id: 'sock-1',
      handshake: { auth: { token: 'jwt-of-admin' }, query: {} },
      emit,
      disconnect,
    }
    const jwtService = {
      verify: jest.fn().mockReturnValue({ sub: 'user-A', roles: ['SUPER_ADMIN'] } as never),
    }
    const config = { getOrThrow: jest.fn().mockReturnValue('secret' as never) }
    const voiceService = { endSession: jest.fn() }
    const gateway = Object.create(VoiceGateway.prototype) as InstanceType<typeof VoiceGateway>
    ;(gateway as unknown as Record<string, unknown>).voiceService = voiceService
    ;(gateway as unknown as Record<string, unknown>).jwtService = jwtService
    ;(gateway as unknown as Record<string, unknown>).config = config
    ;(gateway as unknown as Record<string, unknown>).logger = {
      log: jest.fn(), warn: jest.fn(), error: jest.fn(),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await gateway.handleConnection(fakeSocket as any)
    expect(emit).toHaveBeenCalledWith(
      'session_error',
      expect.objectContaining({ message: expect.stringMatching(/patient-only/i) }),
    )
    expect(disconnect).toHaveBeenCalled()
  })

  it('VoiceGateway handshake accepts PATIENT role + sets userId on socket', async () => {
    const { VoiceGateway } = await import('../../voice/voice.gateway.js')
    const emit = jest.fn()
    const disconnect = jest.fn()
    const fakeSocket: { data?: Record<string, unknown>; id: string; handshake: { auth: { token: string }; query: Record<string, string> }; emit: jest.Mock; disconnect: jest.Mock } = {
      id: 'sock-2',
      handshake: { auth: { token: 'jwt-of-patient' }, query: {} },
      emit,
      disconnect,
    }
    const jwtService = {
      verify: jest.fn().mockReturnValue({ sub: 'user-B', roles: ['PATIENT'] } as never),
    }
    const config = { getOrThrow: jest.fn().mockReturnValue('secret' as never) }
    const gateway = Object.create(VoiceGateway.prototype) as InstanceType<typeof VoiceGateway>
    ;(gateway as unknown as Record<string, unknown>).voiceService = { endSession: jest.fn() }
    ;(gateway as unknown as Record<string, unknown>).jwtService = jwtService
    ;(gateway as unknown as Record<string, unknown>).config = config
    ;(gateway as unknown as Record<string, unknown>).logger = {
      log: jest.fn(), warn: jest.fn(), error: jest.fn(),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await gateway.handleConnection(fakeSocket as any)
    expect(disconnect).not.toHaveBeenCalled()
    expect(fakeSocket.data).toEqual(
      expect.objectContaining({ userId: 'user-B' }),
    )
  })
})
