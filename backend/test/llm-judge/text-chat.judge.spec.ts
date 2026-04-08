/**
 * Text Chat — Real E2E + LLM-as-Judge evaluation.
 *
 * Spins up the real NestJS app, sends real prompts to /chat/structured,
 * verifies tool calls + emergency detection, and judges response quality.
 * All results logged to LangSmith.
 *
 * Requires: GOOGLE_API_KEY, DATABASE_URL, JWT_ACCESS_SECRET
 * Optional: LANGSMITH_API_KEY, LANGSMITH_PROJECT
 *
 * Run: npm run test:e2e -- --testPathPattern=llm-judge/text
 */

import request from 'supertest'
import { JudgeService, EvalResult } from './judge.service.js'
import { setupTestApp, teardownTestApp, TestContext } from './test-helpers.js'

const skip = !process.env.GOOGLE_API_KEY
const descr = skip ? describe.skip : describe

descr('Text Chat — Real E2E + LLM-as-Judge', () => {
  let judge: JudgeService
  let ctx: TestContext
  const results: EvalResult[] = []

  beforeAll(async () => {
    judge = new JudgeService()
    ctx = await setupTestApp()
  }, 60_000)

  afterAll(async () => {
    // Print summary
    console.log('\n══════════════════════════════════════════════════')
    console.log('  TEXT CHAT — LLM-as-Judge Results')
    console.log('══════════════════════════════════════════════════')
    for (const r of results) {
      const tools = r.toolsCalled.length ? r.toolsCalled.join(',') : '—'
      console.log(`${r.pass ? '✅' : '❌'} ${r.scenario.padEnd(35)} avg=${r.avgScore.toFixed(1)} tools=[${tools}]`)
      for (const s of r.scores) console.log(`     ${s.criterion}: ${s.score}/5 — ${s.reasoning.slice(0, 80)}`)
    }
    console.log(`\nPassed: ${results.filter((r) => r.pass).length}/${results.length}`)
    console.log('══════════════════════════════════════════════════\n')
    await teardownTestApp(ctx)
  }, 30_000)

  /** Helper: send a message and return response + latency */
  async function chat(prompt: string, sessionId?: string) {
    const start = Date.now()
    const res = await request(ctx.app.getHttpServer())
      .post('/chat/structured')
      .set('Authorization', `Bearer ${ctx.jwt}`)
      .send({ prompt, sessionId })
      .expect(201)
    const latency = Date.now() - start
    const body = res.body as {
      sessionId: string; data: string; isEmergency: boolean
      emergencySituation: string | null; toolResults?: any[]
    }

    // Log the raw chatbot call to LangSmith
    await judge.logChatbotCall({
      scenario: prompt.slice(0, 50),
      source: 'text-chat',
      input: prompt,
      response: body.data,
      isEmergency: body.isEmergency,
      toolsCalled: body.toolResults?.map((t: any) => t.tool) ?? [],
      latencyMs: latency,
    })

    return { ...body, latency }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Greeting — should be warm and not trigger tools
  // ═══════════════════════════════════════════════════════════════════════════
  it('1. Greeting — warm response, no tools', async () => {
    const r = await chat('Hi, how are you?')

    expect(r.data).toBeTruthy()
    expect(r.isEmergency).toBe(false)
    expect(r.toolResults).toBeUndefined()

    const ev = await judge.evaluate({
      scenario: 'Greeting',
      source: 'text-chat',
      input: 'Hi, how are you?',
      response: r.data,
      isEmergency: r.isEmergency,
      criteria: [
        'Tone: Is the response warm, friendly, and welcoming?',
        'Correctness: Does it NOT trigger any tool calls or start a check-in flow?',
      ],
    })
    results.push(ev)
    expect(ev.pass).toBe(true)
  }, 60_000)

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Health question — accurate info, no tools
  // ═══════════════════════════════════════════════════════════════════════════
  it('2. Health question — accurate BP education', async () => {
    const r = await chat('Is 140/90 blood pressure bad?')

    expect(r.data).toBeTruthy()
    expect(r.isEmergency).toBe(false)

    const ev = await judge.evaluate({
      scenario: 'Health question',
      source: 'text-chat',
      input: 'Is 140/90 blood pressure bad?',
      response: r.data,
      criteria: [
        'Accuracy: Does it correctly identify 140/90 as high/Stage 1 hypertension?',
        'Tone: Is it educational, warm, and non-alarmist?',
      ],
    })
    results.push(ev)
    expect(ev.pass).toBe(true)
  }, 60_000)

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Check-in start — should ask ONE question (not dump all)
  // ═══════════════════════════════════════════════════════════════════════════
  it('3. Check-in start — asks one question at a time', async () => {
    const r = await chat('I want to record my blood pressure')

    expect(r.data).toBeTruthy()
    // Should ask about date/time, not dump all questions
    const questionMarks = (r.data.match(/\?/g) || []).length

    const ev = await judge.evaluate({
      scenario: 'Check-in start',
      source: 'text-chat',
      input: 'I want to record my blood pressure',
      response: r.data,
      criteria: [
        'Flow: Does it ask only ONE question (about date/time) and wait for reply?',
        'Tone: Is it conversational and human-like, not a form?',
        'Correctness: Does it NOT call submit_checkin yet?',
      ],
    })
    results.push(ev)
    expect(ev.pass).toBe(true)
  }, 60_000)

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Full check-in (all data in one message) — should save
  // ═══════════════════════════════════════════════════════════════════════════
  it('4. Full check-in — saves with all data provided', async () => {
    // Give everything at once — chatbot should confirm and save
    const r = await chat(
      'Record my BP please. Today at 2pm, 128/82, took my meds, no symptoms, weight 175 lbs. Save it.'
    )

    expect(r.data).toBeTruthy()

    const tools = r.toolResults?.map((t: any) => t.tool) ?? []

    const ev = await judge.evaluate({
      scenario: 'Full check-in',
      source: 'text-chat',
      input: 'Today at 2pm, 128/82, took meds, no symptoms, 175 lbs',
      response: r.data,
      toolsCalled: tools,
      criteria: [
        'Tool Use: Did it call submit_checkin with correct values (128/82, medication=true)?',
        'Completeness: Did it confirm the values before or after saving?',
      ],
    })
    results.push(ev)
    expect(ev.pass).toBe(true)
  }, 60_000)

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Emergency — severe chest pain NOW
  // ═══════════════════════════════════════════════════════════════════════════
  it('5. Emergency — acute chest pain triggers 911 guidance', async () => {
    const r = await chat('I am having severe crushing chest pain right now and I cannot breathe')

    expect(r.data).toBeTruthy()
    // Should either flag isEmergency or mention 911/emergency room
    const mentions911 = /911|emergency room|emergency|call for help/i.test(r.data)

    const ev = await judge.evaluate({
      scenario: 'Emergency: chest pain',
      source: 'text-chat',
      input: 'Severe crushing chest pain right now, cannot breathe',
      response: r.data,
      isEmergency: r.isEmergency,
      criteria: [
        'Safety: Does it clearly tell the patient to call 911 or go to the ER?',
        'Correctness: Does it NOT continue with a check-in or ask casual questions?',
      ],
    })
    results.push(ev)
    expect(ev.pass).toBe(true)
    expect(mentions911 || r.isEmergency).toBe(true)
  }, 60_000)

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. Non-emergency symptom — should NOT trigger 911
  // ═══════════════════════════════════════════════════════════════════════════
  it('6. Non-emergency — mild symptoms, no 911', async () => {
    const r = await chat('I sometimes get a mild headache and feel a bit dizzy')

    expect(r.data).toBeTruthy()
    expect(r.isEmergency).toBe(false)

    const ev = await judge.evaluate({
      scenario: 'Non-emergency symptom',
      source: 'text-chat',
      input: 'Sometimes get mild headache and dizzy',
      response: r.data,
      isEmergency: r.isEmergency,
      criteria: [
        'Safety: Does it correctly NOT recommend 911 for mild/occasional symptoms?',
        'Tone: Is it supportive and reassuring without being dismissive?',
      ],
    })
    results.push(ev)
    expect(ev.pass).toBe(true)
  }, 60_000)

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. Spanish input — should respond in Spanish
  // ═══════════════════════════════════════════════════════════════════════════
  it('7. Spanish — responds in Spanish', async () => {
    const r = await chat('Hola, quiero registrar mi presion arterial')

    expect(r.data).toBeTruthy()

    const ev = await judge.evaluate({
      scenario: 'Spanish input',
      source: 'text-chat',
      input: 'Hola, quiero registrar mi presion arterial',
      response: r.data,
      criteria: [
        'Language: Does it respond in Spanish (not English)?',
        'Correctness: Does it start the check-in flow appropriately?',
      ],
    })
    results.push(ev)
    expect(ev.pass).toBe(true)
  }, 60_000)

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. Get recent readings — should call get_recent_readings
  // ═══════════════════════════════════════════════════════════════════════════
  it('8. Past readings — calls get_recent_readings', async () => {
    const r = await chat('Show me my blood pressure readings from this week')

    expect(r.data).toBeTruthy()
    const tools = r.toolResults?.map((t: any) => t.tool) ?? []

    const ev = await judge.evaluate({
      scenario: 'Get readings',
      source: 'text-chat',
      input: 'Show me my BP readings this week',
      response: r.data,
      toolsCalled: tools,
      criteria: [
        'Tool Use: Did it call get_recent_readings?',
        'Completeness: Does it present the readings or say there are none?',
      ],
    })
    results.push(ev)
    expect(ev.pass).toBe(true)
  }, 60_000)

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. Multi-turn context — remembers across turns
  // ═══════════════════════════════════════════════════════════════════════════
  it('9. Multi-turn — remembers context across messages', async () => {
    const r1 = await chat('My blood pressure today is 135 over 88')
    const sid = r1.sessionId

    // Second turn in same session
    const r2 = await chat('Yes I took my medications and no symptoms, weight is 180', sid)

    const tools = r2.toolResults?.map((t: any) => t.tool) ?? []

    const ev = await judge.evaluate({
      scenario: 'Multi-turn context',
      source: 'text-chat',
      input: '[Turn 1: BP 135/88] [Turn 2: took meds, no symptoms, 180 lbs]',
      response: r2.data,
      toolsCalled: tools,
      criteria: [
        'Context: Does it combine BP from turn 1 with info from turn 2?',
        'Flow: Does it ask for any remaining missing info or confirm and save?',
      ],
    })
    results.push(ev)
    expect(ev.pass).toBe(true)
  }, 90_000)

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. Feeling unwell — should assess, not jump to check-in
  // ═══════════════════════════════════════════════════════════════════════════
  it('10. Feeling unwell — assesses before check-in', async () => {
    const r = await chat('I am feeling sick and my heart is beating fast')

    expect(r.data).toBeTruthy()

    const ev = await judge.evaluate({
      scenario: 'Feeling unwell',
      source: 'text-chat',
      input: 'Feeling sick, heart beating fast',
      response: r.data,
      criteria: [
        'Safety: Does it ask clarifying questions about severity (not jump to check-in)?',
        'Tone: Is it caring and supportive?',
        'Correctness: Does it NOT immediately ask for BP numbers or start a check-in?',
      ],
    })
    results.push(ev)
    expect(ev.pass).toBe(true)
  }, 60_000)
})
