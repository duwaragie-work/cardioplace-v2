import { jest } from '@jest/globals'
import { ChatService } from './chat.service.js'

/**
 * #2a (2026-07-18) — the submit_checkin tool loop must NOT re-fire a blocked
 * save. Reported: the model called submit_checkin and got "BLOCKED: Missing
 * symptoms" 6+ times in one check-in instead of asking the symptoms question.
 *
 * Root cause: the agentic loop fed the `{saved:false,_internal:true}` block
 * result back in and iterated (cap 5) with no "on block, stop and ask". The fix
 * breaks the loop after the first block so the existing silent-block fallback
 * asks the one missing question and control returns to the patient.
 *
 * This drives the private runToolLoop directly. On the block path the gate
 * short-circuits BEFORE executeJournalTool / toolContext, so the only real
 * dependency is geminiService.generateContentWithTools — everything else is an
 * unused stub.
 */

type GenMock = jest.Mock<(...a: unknown[]) => Promise<unknown>>

function makeService(generateContentWithTools: GenMock): ChatService {
  const stub = {} as never
  return new ChatService(
    stub, // systemPromptService
    stub, // ragService
    stub, // conversationHistoryService
    { get: jest.fn() } as never, // configService
    stub, // prisma
    stub, // dailyJournalService
    { generateContentWithTools } as never, // geminiService — the only live dep
    stub, // profileResolver
    stub, // ocrService
    stub, // adherenceService
    stub, // symptomQuickLogService
    stub, // alertEngineService
    stub, // intakeStatusService
    stub, // eventEmitter
    stub, // encryption
  )
}

// A Gemini response that calls submit_checkin with medication answered but
// symptoms ABSENT → the discussion gate blocks on symptoms every time.
const blockedSubmitResponse = {
  candidates: [
    {
      content: {
        parts: [
          {
            functionCall: {
              name: 'submit_checkin',
              args: {
                entry_date: '2026-07-18',
                measurement_time: 'MORNING',
                systolic_bp: 130,
                diastolic_bp: 82,
                medication_taken: true,
                // symptoms deliberately omitted
              },
            },
          },
        ],
      },
    },
  ],
}

describe('ChatService.runToolLoop — #2a blocked-submit_checkin loop guard', () => {
  const origLog = console.log
  beforeEach(() => {
    console.log = jest.fn()
  })
  afterAll(() => {
    console.log = origLog
  })

  it('breaks after the FIRST block instead of re-firing (Gemini called once, not 5×)', async () => {
    const gen = jest.fn(async () => blockedSubmitResponse) as GenMock
    const service = makeService(gen)

    const result = await (service as unknown as {
      runToolLoop: (
        p: string,
        c: unknown[],
        u: string,
        m?: string,
      ) => Promise<{ text: string; toolResults: unknown[] }>
    }).runToolLoop('sys', [], 'user-1', 'my bp is 130/82')

    // The whole finding: exactly ONE model call, not the 5-iteration cap.
    expect(gen).toHaveBeenCalledTimes(1)

    // The silent-block fallback surfaced the missing-field question.
    expect(result.text.toLowerCase()).toContain('symptom')

    // A blocked save must not have been reported as a successful tool result.
    expect(result.toolResults).toHaveLength(0)
  })

  it('a plain text reply (no tool call) still ends the loop in one call', async () => {
    // Control: proves the ×1 above is the break firing, not a mock that only
    // ever yields once by construction.
    const gen = jest.fn(async () => ({
      candidates: [{ content: { parts: [{ text: 'Any symptoms today?' }] } }],
    })) as GenMock
    const service = makeService(gen)

    const result = await (service as unknown as {
      runToolLoop: (p: string, c: unknown[], u: string, m?: string) => Promise<{ text: string }>
    }).runToolLoop('sys', [], 'user-1', 'hi')

    expect(gen).toHaveBeenCalledTimes(1)
    expect(result.text).toContain('Any symptoms today?')
  })
})
