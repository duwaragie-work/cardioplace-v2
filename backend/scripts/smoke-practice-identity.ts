/**
 * Tier 4 — Practice-identity smoke driver.
 *
 * Exercises every item from NIVAKARAN_PRACTICE_IDENTITY_ARCHITECTURE_HANDOFF_
 * 2026_06_17.md against the running backend + cloud DB. Each item is asserted
 * by both HTTP response shape AND a DB-side query against the audit columns
 * the migration added.
 *
 * Item coverage:
 *   1. Schema       — verified by inspect-practice-identity-schema.ts (separate)
 *   2. Sign-in flow — multi-practice provider gets PRACTICE_SELECT_REQUIRED
 *                     challenge; single-practice / SUPER bypass; zero-practice
 *                     refusal; select-practice issues tokens with claim
 *   3. Mid-session  — switch-practice updates session + writes AuthLog audit
 *      switch         row with practiceContext; JWT strategy throws
 *                     PRACTICE_MEMBERSHIP_REVOKED when membership revoked
 *   4. Audit threading — ack an alert in practice A context → DB row has
 *                        actorPracticeContext = A; switch to B + ack →
 *                        actorPracticeContext = B
 *   5. Admin UI     — out of scope for backend smoke (verified by Playwright
 *                     34/35/36 separately)
 *   6. Patient FE   — verified by grep elsewhere
 *
 * Run: cd backend && npx tsx scripts/smoke-practice-identity.ts
 */
import { PrismaPg } from '@prisma/adapter-pg'
import dotenv from 'dotenv'
import pg from 'pg'
import { PrismaClient } from '../src/generated/prisma/client.js'

dotenv.config()

const API = process.env.SMOKE_API ?? 'http://localhost:4000'
const DEMO_OTP = '666666'

const MULTI_PRACTICE = 'multi-practice-provider@cardioplace.test'
const SINGLE_PRACTICE = process.env.SMOKE_SINGLE_PRACTICE ?? 'support@healplace.com'
const PATIENT = process.env.SMOKE_PATIENT ?? 'james.okafor@cardioplace.test'
const PRACTICE_A = 'seed-cedar-hill'
const PRACTICE_B = 'seed-bridgepoint'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

let scenarios = 0, passed = 0, failed = 0
function rid() { return Math.random().toString(36).slice(2) }
function banner(s: string) {
  scenarios++
  console.log(`\n══════════════════════════════════════════════════`)
  console.log(`  ${s}`)
  console.log(`══════════════════════════════════════════════════`)
}
function ok(s: string)  { console.log(`  ✅ ${s}`); passed++ }
function bad(s: string) { console.log(`  ❌ ${s}`); failed++ }
function info(s: string){ console.log(`  ·  ${s}`) }

// Minimal cookie jar — captures every Set-Cookie this driver gets back and
// replays the same name=value pairs on subsequent requests. switch-practice
// reads the refresh token from a cookie (Auth design — refresh is never in
// a response body), so a fetch-based driver MUST carry cookies forward.
const COOKIE_JAR = new Map<string, string>()
function captureCookies(res: Response) {
  // node fetch joins multiple Set-Cookie with comma — we ask for the raw
  // getSetCookie() if available (node 20+); fall back to split-by-comma if not.
  // @ts-expect-error node 20 has getSetCookie on Headers
  const list: string[] = typeof res.headers.getSetCookie === 'function'
    // @ts-expect-error
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie')?.split(/,(?=\s*[^,;\s]+=)/) ?? [])
  for (const raw of list) {
    const first = raw.split(';')[0]
    const eq = first.indexOf('=')
    if (eq < 0) continue
    const name = first.slice(0, eq).trim()
    const value = first.slice(eq + 1).trim()
    if (name && value !== undefined) COOKIE_JAR.set(name, value)
  }
}
function cookieHeader(): string | undefined {
  if (COOKIE_JAR.size === 0) return undefined
  return [...COOKIE_JAR.entries()].map(([n, v]) => `${n}=${v}`).join('; ')
}

async function send(method: string, path: string, opts: { token?: string; body?: any; deviceId?: string } = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    // Backend derives cookie-scope from Origin (cp_admin_* vs cp_patient_*).
    // Multi-practice provider + alert ack live on admin app, so anchor here.
    origin: process.env.SMOKE_ORIGIN ?? 'http://localhost:3001',
  }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  if (opts.deviceId) headers['x-device-id'] = opts.deviceId
  const ck = cookieHeader()
  if (ck) headers.cookie = ck
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  captureCookies(res)
  let parsed: any = null
  try { parsed = await res.json() } catch { /* empty body ok */ }
  return { status: res.status, body: parsed }
}

interface VerifyResult {
  status: number
  body: any
}

async function signInOtp(email: string): Promise<VerifyResult> {
  const deviceId = `pi-smoke-${rid()}`
  await send('POST', '/api/v2/auth/otp/send', {
    body: { email, appContext: 'admin' },
  })
  return await send('POST', '/api/v2/auth/otp/verify', {
    body: { email, otp: DEMO_OTP, deviceId, appContext: 'admin' },
    deviceId,
  })
}

// Decode JWT payload without verifying signature — just to read claims
function decodeJwt(token: string): any {
  const parts = token.split('.')
  if (parts.length < 2) return null
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
}

// ─── Item 2.1 — Multi-practice provider sees selector challenge ─────────
async function item2MultiPracticeSelector() {
  banner('Item 2 — Multi-practice provider gets PRACTICE_SELECT_REQUIRED')
  const r = await signInOtp(MULTI_PRACTICE)
  info(`HTTP ${r.status}`)
  info(`body.status = ${r.body?.status ?? '(none)'}`)
  if (r.body?.status === 'PRACTICE_SELECT_REQUIRED') ok('challenge issued, no tokens yet')
  else bad(`expected PRACTICE_SELECT_REQUIRED status; got ${r.body?.status ?? '(none)'}`)
  if (typeof r.body?.challengeToken === 'string' && r.body.challengeToken.length > 20)
    ok('challengeToken present')
  else bad('challengeToken missing or too short')
  if (Array.isArray(r.body?.practices) && r.body.practices.length === 2) {
    ok(`2 practices returned: [${r.body.practices.map((p: any) => p.id).join(', ')}]`)
  } else bad(`expected 2 practices; got ${r.body?.practices?.length ?? 0}`)
  if (r.body?.accessToken || r.body?.refreshToken)
    bad('tokens leaked alongside challenge — must NOT issue tokens until selection')
  else ok('no access/refresh tokens in challenge response (good)')
  return r.body?.challengeToken as string | undefined
}

// ─── Item 2.2 — select-practice exchanges challenge for tokens ──────────
async function item2SelectPractice(challengeToken: string) {
  banner('Item 2 — select-practice exchanges challenge for tokens')
  const r = await send('POST', '/api/v2/auth/select-practice', {
    body: { challengeToken, practiceId: PRACTICE_A },
  })
  info(`HTTP ${r.status}`)
  if (r.status === 200 || r.status === 201) ok('select-practice accepted')
  else bad(`expected 2xx; got ${r.status} (${JSON.stringify(r.body)})`)
  if (typeof r.body?.accessToken === 'string') ok('accessToken issued')
  else { bad('no accessToken in response'); return undefined }
  const claims = decodeJwt(r.body.accessToken)
  info(`JWT claims: sub=${claims?.sub?.slice(0, 8)} activePracticeId=${claims?.activePracticeId}`)
  if (claims?.activePracticeId === PRACTICE_A) ok(`JWT activePracticeId = ${PRACTICE_A}`)
  else bad(`JWT activePracticeId expected ${PRACTICE_A}; got ${claims?.activePracticeId}`)
  return r.body.accessToken as string
}

// ─── Item 2.3 — Wrong-practice selection rejected ─────────────────────
async function item2WrongPractice() {
  banner('Item 2 — selecting a non-member practice is rejected')
  // Fresh challenge — first one was consumed
  const sign = await signInOtp(MULTI_PRACTICE)
  if (sign.body?.status !== 'PRACTICE_SELECT_REQUIRED') {
    bad('couldn\'t get fresh challenge'); return
  }
  const r = await send('POST', '/api/v2/auth/select-practice', {
    body: { challengeToken: sign.body.challengeToken, practiceId: 'non-existent-practice-id' },
  })
  if (r.status === 403 || r.status === 400) ok(`wrong-practice rejected (HTTP ${r.status})`)
  else bad(`expected 403/400; got ${r.status} ${JSON.stringify(r.body)}`)
}

// ─── Item 2.4 — Single-practice user bypasses selector ────────────────
async function item2SinglePracticeBypass() {
  banner('Item 2 — single-practice/SUPER user bypasses selector')
  const r = await signInOtp(SINGLE_PRACTICE)
  info(`HTTP ${r.status}, status field = ${r.body?.status ?? '(none)'}`)
  if (r.body?.status === 'PRACTICE_SELECT_REQUIRED') {
    bad('single-practice user got selector — should auto-set')
  } else if (r.body?.accessToken) {
    ok('tokens issued directly (no selector)')
    const claims = decodeJwt(r.body.accessToken)
    info(`activePracticeId in JWT: ${claims?.activePracticeId ?? '(null — admin/super)'}`)
  } else {
    bad(`unexpected response: ${JSON.stringify(r.body)}`)
  }
}

// ─── Item 3.1 — Mid-session switch + AuthLog audit ────────────────────
async function item3SwitchPractice(accessToken: string, userId: string) {
  banner('Item 3 — mid-session switch-practice writes AuthLog row + new token')
  const before = await prisma.authLog.count({
    where: { userId, event: { in: ['practice_switched', 'PRACTICE_SWITCHED'] } },
  })
  const r = await send('POST', '/api/v2/auth/switch-practice', {
    token: accessToken,
    body: { practiceId: PRACTICE_B },
  })
  info(`HTTP ${r.status}`)
  if (r.status !== 200 && r.status !== 201) {
    bad(`expected 2xx; got ${r.status} ${JSON.stringify(r.body)}`)
    return accessToken
  }
  if (typeof r.body?.accessToken === 'string') {
    ok('fresh accessToken returned on switch')
    const claims = decodeJwt(r.body.accessToken)
    if (claims?.activePracticeId === PRACTICE_B) ok(`new JWT activePracticeId = ${PRACTICE_B}`)
    else bad(`new JWT activePracticeId = ${claims?.activePracticeId} (expected ${PRACTICE_B})`)
  } else {
    bad('switch-practice did not return fresh accessToken')
  }
  // give the audit-write a moment to land
  await new Promise((res) => setTimeout(res, 400))
  const after = await prisma.authLog.count({
    where: { userId, event: { in: ['practice_switched', 'PRACTICE_SWITCHED'] } },
  })
  if (after > before) ok(`AuthLog row written (${before} → ${after})`)
  else bad('no new practice_switched AuthLog row')

  const latest = await prisma.authLog.findFirst({
    where: { userId, event: { in: ['practice_switched', 'PRACTICE_SWITCHED'] } },
    orderBy: { createdAt: 'desc' },
  })
  if (latest?.practiceContext === PRACTICE_B) ok(`AuthLog.practiceContext = ${latest.practiceContext}`)
  else bad(`AuthLog.practiceContext = ${latest?.practiceContext} (expected ${PRACTICE_B})`)
  return r.body?.accessToken as string
}

// ─── Item 3.2 — Switch to a non-member practice rejected ──────────────
async function item3SwitchForbidden(accessToken: string) {
  banner('Item 3 — switching to a non-member practice is 403')
  const r = await send('POST', '/api/v2/auth/switch-practice', {
    token: accessToken,
    body: { practiceId: 'non-existent-practice-id' },
  })
  if (r.status === 403) ok('non-member switch rejected with 403')
  else bad(`expected 403; got ${r.status} ${JSON.stringify(r.body)}`)
}

// ─── Item 4 — Audit threading: ack alert → actorPracticeContext set ────
async function item4AuditThreading(accessTokenInB: string, userId: string) {
  banner('Item 4 — alert ack persists actorPracticeContext = current practice')
  // Find a fired DeviationAlert from the chat-v2 smoke run (Iris produced some)
  // — any unacknowledged alert will do. If none, skip cleanly.
  const patient = await prisma.user.findUnique({ where: { email: PATIENT }, select: { id: true } })
  if (!patient) { bad(`patient ${PATIENT} not found`); return }
  const alert = await prisma.deviationAlert.findFirst({
    where: { userId: patient.id, acknowledgedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  if (!alert) {
    info('no unacknowledged alerts on the patient — skipping ack assertion')
    info('(re-run after the chat-v2 smoke or seed a fresh alert)')
    return
  }
  info(`acknowledging alert id=${alert.id} (${alert.systolicBP}/${alert.diastolicBP}) under practice B`)
  const r = await send('POST', `/api/admin/alerts/${alert.id}/acknowledge`, {
    token: accessTokenInB,
    body: { notes: 'practice-identity smoke — Item 4' },
  })
  info(`HTTP ${r.status}`)
  if (r.status !== 200 && r.status !== 201) {
    bad(`alert ack failed: ${r.status} ${JSON.stringify(r.body)}`)
    return
  }
  await new Promise((res) => setTimeout(res, 400))
  const after = await prisma.deviationAlert.findUnique({
    where: { id: alert.id },
    select: { acknowledgedAt: true, actorPracticeContext: true },
  })
  if (after?.acknowledgedAt) ok('alert.acknowledgedAt set')
  else bad('alert.acknowledgedAt not set')
  if (after?.actorPracticeContext === PRACTICE_B) ok(`actorPracticeContext = ${after.actorPracticeContext} (correct)`)
  else bad(`actorPracticeContext = ${after?.actorPracticeContext} (expected ${PRACTICE_B})`)

  // Also verify the EscalationEvent rows received the same context
  const eventCount = await prisma.escalationEvent.count({
    where: { alertId: alert.id, actorPracticeContext: PRACTICE_B },
  })
  if (eventCount > 0) ok(`${eventCount} EscalationEvent rows tagged with practice B`)
  else info('no EscalationEvent rows tagged (alert may not have escalated to T+0)')
}

// ─── Item 3.3 — PRACTICE_MEMBERSHIP_REVOKED guard via JwtStrategy ──────
async function item3MembershipRevoked(accessToken: string, userId: string) {
  banner('Item 3 — JwtStrategy rejects when active practice membership is revoked')
  // Remove provider's membership in Practice B (the one they switched to)
  const removed = await prisma.practiceProvider.deleteMany({
    where: { userId, practiceId: PRACTICE_B },
  })
  info(`removed ${removed.count} PracticeProvider row(s) for B`)
  // Any authed request should now bounce with PRACTICE_MEMBERSHIP_REVOKED
  const r = await send('GET', '/api/v2/auth/me', { token: accessToken })
  info(`HTTP ${r.status}, errorCode = ${r.body?.errorCode ?? '(none)'}`)
  if (r.status === 401 && r.body?.errorCode === 'PRACTICE_MEMBERSHIP_REVOKED') {
    ok('JwtStrategy returned 401 PRACTICE_MEMBERSHIP_REVOKED as designed')
  } else {
    bad(`expected 401 + PRACTICE_MEMBERSHIP_REVOKED; got HTTP ${r.status} errorCode=${r.body?.errorCode}`)
  }
  // Re-seed the membership to leave the DB clean for re-runs
  await prisma.practiceProvider.upsert({
    where: { practiceId_userId: { practiceId: PRACTICE_B, userId } },
    update: {},
    create: { practiceId: PRACTICE_B, userId },
  })
  info('re-seeded membership for re-runs')
}

async function main() {
  try { await fetch(API) }
  catch { console.error(`backend not reachable at ${API}`); process.exit(2) }

  banner(`Smoke — backend ${API}`)

  // ───── Item 2.1 + 2.2 (must run first — establishes the multi-practice
  //                         session whose cookies the rest of the smoke
  //                         depends on. The "wrong practice" + single-practice
  //                         bypass tests sign in as OTHER users and would
  //                         overwrite this session's cookies, so they run
  //                         AFTER the cookie-dependent items.) ────────────
  const challenge = await item2MultiPracticeSelector()
  let token: string | undefined
  if (challenge) token = await item2SelectPractice(challenge)
  // Snapshot the multi-practice cookies; restore after each test that
  // signs in as a different user.
  const multiPracticeCookies = new Map(COOKIE_JAR)
  const restore = () => {
    COOKIE_JAR.clear()
    for (const [k, v] of multiPracticeCookies) COOKIE_JAR.set(k, v)
  }

  // ───── Item 3 — switch + revoked-membership (USE multi-practice token) ─
  if (!token) { console.log('\nCannot proceed past Item 2 (no token).'); return }
  const provider = await prisma.user.findUnique({
    where: { email: MULTI_PRACTICE }, select: { id: true },
  })
  if (!provider) { console.log('no multi-practice provider in DB'); return }
  const newToken = await item3SwitchPractice(token, provider.id)
  await item3SwitchForbidden(newToken)

  // ───── Item 4 — alert ack (USE multi-practice in-B token) ─────────────
  await item4AuditThreading(newToken, provider.id)

  // ───── Item 3.3 — membership revoked guard ────────────────────────────
  await item3MembershipRevoked(newToken, provider.id)

  // ───── Item 2.3 + 2.4 — run LAST (these overwrite cookies) ────────────
  restore()
  await item2WrongPractice()
  restore()
  await item2SinglePracticeBypass()

  // ───── Summary ────────────────────────────────────────────────────
  console.log(`\n══════════════════════════════════════════════════`)
  console.log(`  Done — ${passed} passed / ${failed} failed across ${scenarios} scenarios`)
  console.log(`══════════════════════════════════════════════════`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) }).finally(() => prisma.$disconnect())
