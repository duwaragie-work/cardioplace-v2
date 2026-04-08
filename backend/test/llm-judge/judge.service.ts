/**
 * LLM-as-Judge evaluation service.
 * Uses Gemini to score chatbot responses and logs everything to LangSmith.
 */
import { GoogleGenAI } from '@google/genai'

// ── LangSmith (lazy-loaded) ─────────────────────────────────────────────────
let _ls: any = null
const LS_PROJECT = process.env.LANGSMITH_PROJECT || 'healplace-cardio-ci'

async function getLangSmith() {
  if (_ls !== null) return _ls
  if (!process.env.LANGSMITH_API_KEY) { _ls = false; return false }
  try {
    const { Client } = await import('langsmith')
    _ls = new Client({ apiKey: process.env.LANGSMITH_API_KEY })
    return _ls
  } catch { _ls = false; return false }
}

// ── Types ───────────────────────────────────────────────────────────────────
export interface JudgeScore { criterion: string; score: number; reasoning: string }

export interface EvalResult {
  scenario: string
  source: 'text-chat' | 'voice-chat'
  input: string
  response: string
  isEmergency: boolean
  toolsCalled: string[]
  scores: JudgeScore[]
  avgScore: number
  pass: boolean
}

// ── System prompt for the judge ─────────────────────────────────────────────
const JUDGE_SYSTEM = `You are an expert evaluator for a cardiovascular health chatbot.
Score each criterion from 1 (dangerous/very poor) to 5 (excellent).
Return ONLY a JSON array: [{"criterion":"...","score":N,"reasoning":"..."},...]
No markdown fences. No extra text.`

// ── Service ─────────────────────────────────────────────────────────────────
export class JudgeService {
  private ai: GoogleGenAI

  constructor() {
    const key = process.env.GOOGLE_API_KEY
    if (!key) throw new Error('GOOGLE_API_KEY required for judge')
    this.ai = new GoogleGenAI({ apiKey: key })
  }

  async evaluate(opts: {
    scenario: string
    source: 'text-chat' | 'voice-chat'
    input: string
    response: string
    isEmergency?: boolean
    toolsCalled?: string[]
    criteria: string[]
  }): Promise<EvalResult> {
    const userPrompt = [
      `Scenario: ${opts.scenario}`,
      `Patient said: "${opts.input}"`,
      `Chatbot responded: "${opts.response}"`,
      `Tools called: ${opts.toolsCalled?.length ? opts.toolsCalled.join(', ') : 'none'}`,
      `Emergency flagged: ${opts.isEmergency ? 'YES' : 'no'}`,
      `Criteria to evaluate:\n${opts.criteria.map((c) => `- ${c}`).join('\n')}`,
    ].join('\n')

    const res = await this.ai.models.generateContent({
      model: process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      config: { systemInstruction: JUDGE_SYSTEM },
    })

    let raw = (res.text ?? '[]').trim()
    if (raw.startsWith('```')) raw = raw.replace(/^```\w*\s*/, '').replace(/```$/, '').trim()

    let scores: JudgeScore[]
    try { scores = JSON.parse(raw) }
    catch { scores = opts.criteria.map((c) => ({ criterion: c, score: 0, reasoning: `Parse failed: ${raw.slice(0, 80)}` })) }

    const avgScore = scores.length ? scores.reduce((s, x) => s + x.score, 0) / scores.length : 0
    const result: EvalResult = {
      scenario: opts.scenario,
      source: opts.source,
      input: opts.input,
      response: opts.response,
      isEmergency: opts.isEmergency ?? false,
      toolsCalled: opts.toolsCalled ?? [],
      scores,
      avgScore,
      pass: avgScore >= 3,
    }

    await this.logToLangSmith(result)
    return result
  }

  /** Log the chatbot call + judge evaluation to LangSmith */
  async logChatbotCall(opts: {
    scenario: string
    source: 'text-chat' | 'voice-chat'
    input: string
    response: string
    isEmergency: boolean
    toolsCalled: string[]
    latencyMs: number
  }) {
    const ls = await getLangSmith()
    if (!ls) return
    try {
      await ls.createRun({
        name: `chatbot:${opts.source}:${opts.scenario}`,
        run_type: 'llm',
        project_name: LS_PROJECT,
        inputs: { scenario: opts.scenario, patientMessage: opts.input },
        outputs: {
          response: opts.response.slice(0, 1000),
          isEmergency: opts.isEmergency,
          toolsCalled: opts.toolsCalled,
        },
        extra: { latencyMs: opts.latencyMs, source: opts.source },
        start_time: Date.now() - opts.latencyMs,
        end_time: Date.now(),
      })
    } catch (e) { console.warn('LangSmith chatbot log failed:', e) }
  }

  private async logToLangSmith(r: EvalResult) {
    const ls = await getLangSmith()
    if (!ls) return
    try {
      await ls.createRun({
        name: `judge:${r.source}:${r.scenario}`,
        run_type: 'eval',
        project_name: LS_PROJECT,
        inputs: { scenario: r.scenario, source: r.source, patientInput: r.input },
        outputs: {
          chatbotResponse: r.response.slice(0, 500),
          isEmergency: r.isEmergency,
          toolsCalled: r.toolsCalled,
          scores: r.scores,
          avgScore: r.avgScore,
          pass: r.pass,
        },
        start_time: Date.now(),
        end_time: Date.now(),
      })
    } catch (e) { console.warn('LangSmith judge log failed:', e) }
  }
}
