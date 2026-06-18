/**
 * Phase/16 chat-v2 smoke driver — exercises all 9 scenarios from the
 * Nivakaran chat-v2 handoff against the running backend on :4000 + the
 * Cloud DB. Real Gemini round-trips.
 *
 * Drives /api/chat/structured directly (no browser) and verifies both
 * the bot's response shape AND the backend side-effects (JournalEntry
 * state, alerts, audit rows).
 *
 * Run: cd backend && npx tsx scripts/smoke-chat-v2.ts
 *
 * Each scenario logs a ✅ / ❌ result + the observable evidence used.
 */
import { PrismaPg } from '@prisma/adapter-pg'
import dotenv from 'dotenv'
import pg from 'pg'
import { PrismaClient } from '../src/generated/prisma/client.js'

dotenv.config()

const API = process.env.SMOKE_API ?? 'http://localhost:4000'
const DEMO_OTP = '666666'
const PATIENT_EMAIL = process.env.SMOKE_PATIENT ?? 'iris.kim@cardioplace.test'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

function rid() {
  return Math.random().toString(36).slice(2)
}

function banner(s: string) {
  console.log(`\n══════════════════════════════════════════════════`)
  console.log(`  ${s}`)
  console.log(`══════════════════════════════════════════════════`)
}
function ok(s: string)  { console.log(`  ✅ ${s}`) }
function bad(s: string) { console.log(`  ❌ ${s}`) }
function info(s: string){ console.log(`  ·  ${s}`) }

interface ChatResult {
  sessionId: string
  data: string
  isEmergency: boolean
  emergencySituation: string | null
  toolResults?: Array<{ tool: string; result: any }>
}

async function signIn(email: string): Promise<{ accessToken: string; userId: string }> {
  const deviceId = `chat-v2-smoke-${rid()}`
  await fetch(`${API}/api/v2/auth/otp/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, appContext: 'patient' }),
  })
  const res = await fetch(`${API}/api/v2/auth/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-id': deviceId },
    body: JSON.stringify({ email, otp: DEMO_OTP, deviceId, appContext: 'patient' }),
  })
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`)
  const body = await res.json() as { accessToken: string; userId: string }
  return body
}

async function chat(token: string, prompt: string, sessionId?: string, retries = 2): Promise<ChatResult> {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(`${API}/api/chat/structured`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ prompt, sessionId }),
    })
    if (!res.ok) throw new Error(`chat: ${res.status} ${await res.text()}`)
    const body = await res.json() as ChatResult
    if (body.data && body.data.trim()) return body
    if (i < retries) {
      info(`[chat retry] empty data — retrying (${i + 1}/${retries})`)
      await new Promise((r) => setTimeout(r, 600 * (i + 1)))
    } else {
      return body
    }
  }
  throw new Error('unreachable')
}

const toolsOf = (r: ChatResult) => (r.toolResults ?? []).map((t) => t.tool)

// ────────────────────────────────────────────────────────────────────────────
// Scenario 1 — Verbal confirmation gate (single-turn — all fields provided
// so the bot reaches the summary + confirm step on turn 1).
// ────────────────────────────────────────────────────────────────────────────
async function scenario1(token: string) {
  banner('Scenario 1 — Verbal confirmation gate (Item 1)')
  const r = await chat(
    token,
    'Just now I took my BP — 130 over 85, sitting, pulse 72. ' +
    'Today, no caffeine, bare arm, sat quietly. Took my meds. No symptoms.',
  )
  const tools = toolsOf(r)
  info(`bot: "${r.data.slice(0, 180)}..."`)
  info(`tools: [${tools.join(',') || '—'}]`)
  if (!tools.includes('submit_checkin')) {
    ok('bot did NOT fire submit_checkin without explicit "yes" (Item 1 gate held)')
  } else {
    bad('bot fired submit_checkin BEFORE patient said yes — Item 1 verbal gate broken')
  }
  if (/130|85|confirm|send|right|save|should/i.test(r.data)) {
    ok('bot acknowledged the values + asked something (consistent with confirm gate)')
  } else {
    bad('bot did not echo values or ask anything')
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Scenario 2 — Option D AWAITING ask
// ────────────────────────────────────────────────────────────────────────────
async function scenario2(token: string, userId: string) {
  banner('Scenario 2 — Option D AWAITING ask (Item 2)')
  await prisma.journalEntry.deleteMany({
    where: { userId, emergencyConfirmation: { in: ['AWAITING', 'UNCONFIRMED', 'CONFIRMATORY'] } },
  })
  const r = await chat(
    token,
    'I just took my BP — 195 over 120, sitting, pulse 88. ' +
    'Today, no caffeine, bare arm, seated quietly. Took my meds. No symptoms. ' +
    'Please send it to my care team.',
  )
  const tools = toolsOf(r)
  info(`bot: "${r.data.slice(0, 160)}..."`)
  info(`tools: [${tools.join(',') || '—'}]`)
  if (tools.includes('submit_checkin')) {
    ok('submit_checkin fired (same-turn "send it" confirmation accepted)')
  } else {
    bad('submit_checkin did not fire — same-turn confirmation gate may be too strict')
  }
  if (/another reading|sit calmly|minute|wait/i.test(r.data)) {
    ok('bot asked for confirmatory second reading (Option D ask)')
  } else {
    bad('bot did NOT ask for second reading — Item 2 AWAITING flow broken')
  }
  const awaiting = await prisma.journalEntry.findFirst({
    where: { userId, emergencyConfirmation: 'AWAITING', singleReadingFinalized: false },
    orderBy: { createdAt: 'desc' },
  })
  if (awaiting) ok(`backend created AWAITING entry id=${awaiting.id} (${awaiting.systolicBP}/${awaiting.diastolicBP})`)
  else bad('no AWAITING entry found in DB after emergency-range submit')
  return r.sessionId
}

// ────────────────────────────────────────────────────────────────────────────
// Scenario 3 — Option D decline path
// ────────────────────────────────────────────────────────────────────────────
async function scenario3(token: string, sessionId: string, userId: string) {
  banner('Scenario 3 — Option D decline path (Item 2)')
  const before = await prisma.journalEntry.findFirst({
    where: { userId, emergencyConfirmation: 'AWAITING' },
    orderBy: { createdAt: 'desc' },
  })
  if (!before) {
    bad('no AWAITING entry to decline — re-running scenario 2 path is needed')
    return
  }
  info(`AWAITING entry to decline: id=${before.id}`)
  const r = await chat(token, "I can't take another reading right now.", sessionId)
  const tools = toolsOf(r)
  info(`bot: "${r.data.slice(0, 160)}..."`)
  info(`tools: [${tools.join(',') || '—'}]`)
  // Wait briefly for the cron-flag transition to land
  await new Promise((r) => setTimeout(r, 500))
  const after = await prisma.journalEntry.findUnique({ where: { id: before.id } })
  if (after?.emergencyConfirmation === 'UNCONFIRMED') {
    ok('AWAITING entry flipped to UNCONFIRMED immediately (no 4-hour cron wait)')
  } else {
    info(`entry state now: ${after?.emergencyConfirmation} (expected UNCONFIRMED)`)
    bad('decline path did NOT flip entry to UNCONFIRMED — Item 2 decline branch broken')
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Scenario 4 — Symptom-override 911
// ────────────────────────────────────────────────────────────────────────────
async function scenario4(token: string) {
  banner('Scenario 4 — Symptom-override 911 (Item 3)')
  const r = await chat(
    token,
    'I just took my BP — 195 over 120, sitting, pulse 105, just now. ' +
    'I have severe crushing chest pain RIGHT NOW. Took my meds. ' +
    'No caffeine, bare arm, seated quietly. Please save it.',
  )
  info(`bot: "${r.data.slice(0, 220)}..."`)
  if (/911/.test(r.data)) {
    ok('response contains "911" (verbatim clinical line)')
  } else {
    bad('response does NOT mention 911 — Item 3 broken (most dangerous gap)')
  }
  if (r.isEmergency || toolsOf(r).includes('flag_emergency') || toolsOf(r).includes('submit_checkin')) {
    ok('backend received emergency signal (flag_emergency / submit_checkin with symptom)')
  } else {
    bad('no emergency signal sent to backend')
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Scenario 5 — Q3 batch
// ────────────────────────────────────────────────────────────────────────────
async function scenario5(token: string, userId: string) {
  banner('Scenario 5 — Q3 multi-reading (Item 4)')
  const r = await chat(
    token,
    'I just took three readings about a minute apart, all sitting, just now: ' +
    'first 130 over 85 pulse 72, then 132 over 86 pulse 74, then 128 over 82 pulse 70. ' +
    'Took my meds, no symptoms. No caffeine, bare arm, seated quietly. ' +
    'Please save all three as one session.',
  )
  const submits = (r.toolResults ?? []).filter((t) => t.tool === 'submit_checkin')
  info(`submit_checkin calls: ${submits.length} (expect ≥2)`)
  if (submits.length >= 2) {
    ok(`bot fired submit_checkin ${submits.length} times for Q3 batch`)
  } else {
    bad('bot did not fire ≥2 submit_checkin calls — Q3 batch handling weak')
  }
  // Optional shared-session check
  const sessionIds = new Set(
    submits.map((t: any) => t.result?.data?.sessionId).filter(Boolean),
  )
  if (sessionIds.size === 1) ok('all readings share one sessionId (good Q3 grouping)')
  else if (sessionIds.size > 1) info(`distinct sessionIds: ${sessionIds.size} (LLM didn't thread session_id — acceptable but suboptimal)`)
}

// ────────────────────────────────────────────────────────────────────────────
// Scenario 6 — In-window edit
// ────────────────────────────────────────────────────────────────────────────
async function scenario6(token: string, userId: string) {
  banner('Scenario 6 — In-window edit (Item 5)')
  // Plant a fresh single reading first, complete with all required fields.
  await chat(
    token,
    'Just now I took my BP — 130 over 85, sitting, pulse 72. ' +
    'Today, no caffeine, bare arm, seated quietly. Took meds. No symptoms. Yes save it.',
  )
  await new Promise((r) => setTimeout(r, 1200))
  const r = await chat(
    token,
    'Wait — that should have been 132 over 86. Change my last reading.',
  )
  const tools = toolsOf(r)
  info(`tools: [${tools.join(',') || '—'}]`)
  if (tools.includes('update_checkin') || tools.includes('get_recent_readings')) {
    ok('bot reached for update_checkin / get_recent_readings (in-window edit path)')
  } else {
    bad('bot did NOT trigger update_checkin or lookup — Item 5 in-window path weak')
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Scenario 7 — Out-of-window flag
// ────────────────────────────────────────────────────────────────────────────
async function scenario7(token: string, userId: string) {
  banner('Scenario 7 — Out-of-window edit → flag_reading_error (Item 5)')
  const r = await chat(
    token,
    'Can you change my reading from last week? It was a typo.',
  )
  info(`bot: "${r.data.slice(0, 200)}..."`)
  if (/locked|5 minute|flag|care team/i.test(r.data)) {
    ok('bot explained the 5-min lock + offered to flag for care team')
  } else {
    bad('bot did not explain lock or offer flag — Item 5 out-of-window path weak')
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Scenario 8 — Enrollment-aware wording
// ────────────────────────────────────────────────────────────────────────────
async function scenario8(token: string, userId: string) {
  banner('Scenario 8 — Enrollment-aware messaging (Item 6)')
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { enrollmentStatus: true },
  })
  info(`patient enrollmentStatus = ${user?.enrollmentStatus}`)
  const r = await chat(
    token,
    'Just now I took my BP — 128 over 82, sitting, pulse 70. ' +
    'Today, no caffeine, bare arm, seated quietly. Took my meds. ' +
    'No symptoms. Yes save it.',
  )
  info(`bot post-save: "${r.data.slice(0, 200)}..."`)
  if (user?.enrollmentStatus === 'ENROLLED') {
    if (/once your enrollment is complete/i.test(r.data)) {
      bad('ENROLLED patient saw "once your enrollment is complete" line (wrong)')
    } else {
      ok('ENROLLED patient did NOT see "enrollment is complete" line')
    }
    if (/care team has been notified|notified/i.test(r.data)) {
      ok('ENROLLED patient saw "care team notified" wording')
    }
  } else {
    if (/once your enrollment is complete/i.test(r.data)) {
      ok('NOT_ENROLLED patient saw "once your enrollment is complete" line')
    } else {
      bad('NOT_ENROLLED patient did NOT see enrollment-pending wording')
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Scenario 9 — Session boundary (close_session default)
// ────────────────────────────────────────────────────────────────────────────
async function scenario9(token: string, userId: string) {
  banner('Scenario 9 — Session boundary / close_session (Item 7)')
  const r = await chat(
    token,
    'Just now I took my BP — 126 over 80, sitting, pulse 68. ' +
    'Today, no caffeine, bare arm, seated quietly. Took my meds. ' +
    'No symptoms. Yes save it.',
  )
  const submit = (r.toolResults ?? []).find((t) => t.tool === 'submit_checkin')
  if (!submit) {
    bad('submit_checkin did not fire on confirmation — cannot verify close_session')
    return
  }
  const entryId = submit.result?.data?.id
  info(`new entry id=${entryId}`)
  if (!entryId) {
    bad('no entry id returned from submit_checkin')
    return
  }
  const row = await prisma.journalEntry.findUnique({
    where: { id: entryId },
    select: { sessionId: true, sessionClosedAt: true, emergencyConfirmation: true },
  })
  if (row?.sessionClosedAt) {
    ok(`sessionClosedAt is set (${row.sessionClosedAt.toISOString()}) — single-reading session closed immediately`)
  } else if (row?.emergencyConfirmation === 'AWAITING') {
    ok('entry is AWAITING — sessionClosedAt correctly stays null')
  } else {
    bad('sessionClosedAt is null on a normal single-reading entry — Item 7 close_session not threaded')
  }
}

// ────────────────────────────────────────────────────────────────────────────
async function main() {
  try { await fetch(API) } catch { console.error(`backend not reachable at ${API}`); process.exit(2) }
  banner(`Chat-v2 smoke — patient: ${PATIENT_EMAIL}`)
  const { accessToken, userId } = await signIn(PATIENT_EMAIL)
  info(`signed in, userId=${userId}`)

  await scenario1(accessToken)
  const awaitingSession = await scenario2(accessToken, userId)
  await scenario3(accessToken, awaitingSession, userId)
  await scenario4(accessToken)
  await scenario5(accessToken, userId)
  await scenario6(accessToken, userId)
  await scenario7(accessToken, userId)
  await scenario8(accessToken, userId)
  await scenario9(accessToken, userId)

  banner('Done')
}

main()
  .catch((e) => { console.error('FATAL:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
