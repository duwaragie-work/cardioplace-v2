/**
 * Manual smoke driver — exercises the Nivakaran handoff phases against the
 * backend on http://localhost:4000.
 *
 *   Phase 1 — Practice-wide patient visibility (RBAC)
 *   Phase 3 — Concurrent sessions (3 admin / 1 patient)
 *   Phase 2 — Idle timeout (15 min web / 5 min mobile)
 *   Phase 4 — Practice-identity selector + switcher + audit attribution
 *             (creates Practice B + multi-practice provider inline if
 *             they don't already exist; verifies AuthLog persistence).
 *
 * Reads DATABASE_URL from backend/.env (currently Cloud) and acts directly
 * on the Prisma DB for setup/teardown + time-warp.
 */
import { PrismaPg } from '@prisma/adapter-pg'
import dotenv from 'dotenv'
import pg from 'pg'
import { PrismaClient } from '../src/generated/prisma/client.js'

dotenv.config()

const API = process.env.SMOKE_API ?? 'http://localhost:4000'
const DEMO_OTP = '666666'
const PROVIDER_A = 'primary-provider@cardioplace.test'
const MD = 'medical-director@cardioplace.test'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

function rid() {
  return Math.random().toString(36).slice(2)
}

interface Tokens {
  accessToken: string
  refreshToken: string
  userId: string
  roles: string[]
}

async function signIn(email: string, opts: {
  deviceId?: string
  platform?: 'web' | 'mobile'
  appContext?: 'admin' | 'patient'
} = {}): Promise<Tokens> {
  const deviceId = opts.deviceId ?? `smoke-${rid()}`
  const appContext = opts.appContext ?? 'admin'

  await fetch(`${API}/api/v2/auth/otp/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, appContext }),
  })

  const res = await fetch(`${API}/api/v2/auth/otp/verify`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-device-id': deviceId,
      'x-device-platform': opts.platform ?? 'web',
    },
    body: JSON.stringify({ email, otp: DEMO_OTP, deviceId, appContext }),
  })
  if (!res.ok) {
    throw new Error(`sign-in failed for ${email}: ${res.status} ${await res.text()}`)
  }
  return (await res.json()) as Tokens
}

async function callRefresh(refreshToken: string, platform: 'web' | 'mobile' = 'web') {
  return await fetch(`${API}/api/v2/auth/refresh`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-device-platform': platform,
      cookie: `refresh_token=${refreshToken}`,
    },
    body: JSON.stringify({ refreshToken }),
  })
}

function banner(s: string) {
  console.log(`\n\n══════════════════════════════════════════════════`)
  console.log(`  ${s}`)
  console.log(`══════════════════════════════════════════════════`)
}

function ok(s: string)  { console.log(`  ✅ ${s}`) }
function bad(s: string) { console.log(`  ❌ ${s}`) }
function info(s: string){ console.log(`  ·  ${s}`) }

// ─── Phase 1 — Practice-wide visibility ────────────────────────────────────
async function phase1() {
  banner('Phase 1 — Practice-wide patient visibility (RBAC)')

  // Pick the first patient assigned to our test provider, then ORPHAN them
  // by moving primary+backup to the medical director. With the OLD RBAC,
  // primary-provider would lose visibility. With the NEW RBAC, they keep
  // it (same practice).
  const target = await prisma.patientProviderAssignment.findFirst({
    where: { user: { email: { contains: 'priya' } } },
    select: {
      userId: true,
      practiceId: true,
      primaryProviderId: true,
      backupProviderId: true,
      user: { select: { email: true } },
    },
  })
  if (!target) {
    bad('No priya.menon assignment found — skipping Phase 1')
    return
  }
  info(`Target patient: ${target.user.email} (uid=${target.userId})`)
  info(`  current primary=${target.primaryProviderId}  backup=${target.backupProviderId}`)
  const original = { primaryProviderId: target.primaryProviderId, backupProviderId: target.backupProviderId }

  const mdUser = await prisma.user.findUnique({ where: { email: MD }, select: { id: true } })
  if (!mdUser) { bad('No medical-director user — skipping Phase 1'); return }

  // Confirm med-director is NOT primary-provider (else this proves nothing)
  const providerA = await prisma.user.findUnique({ where: { email: PROVIDER_A }, select: { id: true } })
  if (!providerA) { bad('No primary-provider user — skipping Phase 1'); return }
  if (mdUser.id === providerA.id) { bad('MD === Provider A — bad seed; skipping'); return }

  try {
    // STEP 1 — orphan the patient onto the medical director
    await prisma.patientProviderAssignment.update({
      where: { userId: target.userId },
      data: { primaryProviderId: mdUser.id, backupProviderId: mdUser.id },
    })
    info(`Re-assigned ${target.user.email} to MD as primary+backup`)

    // STEP 2 — sign in as primary-provider, list patients
    const tok = await signIn(PROVIDER_A)
    const res = await fetch(`${API}/api/provider/patients`, {
      headers: { authorization: `Bearer ${tok.accessToken}` },
    })
    if (!res.ok) { bad(`/provider/patients returned ${res.status}`); return }
    const body = (await res.json()) as any
    const list: any[] = Array.isArray(body) ? body : (body.data ?? body.patients ?? [])
    info(`/provider/patients → ${list.length} patients`)

    const found = list.find((p: any) => p.id === target.userId || p.userId === target.userId)
    if (found) {
      ok(`Practice-wide visibility CONFIRMED — primary-provider sees ${target.user.email} despite NOT being on the assignment`)
    } else {
      bad(`Practice-wide visibility FAILED — ${target.user.email} not in list`)
      info(`  sample item: ${JSON.stringify(list[0] ?? null).slice(0, 200)}`)
    }

    // STEP 3 — confirm the same patient is accessible by ID (assertCanAccessPatient path)
    const detail = await fetch(`${API}/api/provider/patients/${target.userId}/summary`, {
      headers: { authorization: `Bearer ${tok.accessToken}` },
    })
    if (detail.ok) {
      ok(`GET /provider/patients/${target.userId}/summary → ${detail.status} (was 403 in OLD code)`)
    } else {
      bad(`GET /provider/patients/${target.userId}/summary → ${detail.status} ${await detail.text()}`)
    }
  } finally {
    // Restore the original assignment so we don't leave the seed corrupted
    await prisma.patientProviderAssignment.update({
      where: { userId: target.userId },
      data: original,
    })
    info(`Restored original assignment for ${target.user.email}`)
  }
}

// ─── Phase 3 — Concurrent sessions ─────────────────────────────────────────
async function phase3() {
  banner('Phase 3 — Concurrent sessions (3 admin / 1 patient)')

  const provider = await prisma.user.findUnique({ where: { email: PROVIDER_A }, select: { id: true } })
  if (!provider) { bad('No primary-provider; skipping'); return }

  // Clean slate
  await prisma.authSession.deleteMany({ where: { userId: provider.id } })
  await prisma.refreshToken.deleteMany({ where: { userId: provider.id } })

  // Sign in 3 times (should all coexist)
  const t1 = await signIn(PROVIDER_A, { deviceId: 'smoke-dev-1' })
  await new Promise((r) => setTimeout(r, 250))
  const t2 = await signIn(PROVIDER_A, { deviceId: 'smoke-dev-2' })
  await new Promise((r) => setTimeout(r, 250))
  const t3 = await signIn(PROVIDER_A, { deviceId: 'smoke-dev-3' })

  let sessions = await prisma.authSession.findMany({
    where: { userId: provider.id },
    select: { id: true, deviceId: true, createdAt: true, lastActivityAt: true, refreshTokenId: true },
    orderBy: { createdAt: 'asc' },
  })
  info(`After 3 sign-ins: ${sessions.length} AuthSession rows (expect 3)`)
  if (sessions.length === 3) ok('3 concurrent sessions allowed')
  else { bad(`Expected 3, got ${sessions.length}`); console.log(sessions); return }

  // Backdate session #2 so it is the most-idle (sanity: NOT the oldest by createdAt)
  const target = sessions[1]
  await prisma.authSession.update({
    where: { id: target.id },
    data: { lastActivityAt: new Date(Date.now() - 30 * 60_000) },
  })
  info(`Backdated session ${target.deviceId} to -30min lastActivityAt`)

  // Sign in 4th — should evict the most-idle (target)
  const t4 = await signIn(PROVIDER_A, { deviceId: 'smoke-dev-4' })

  sessions = await prisma.authSession.findMany({
    where: { userId: provider.id },
    select: { id: true, deviceId: true, lastActivityAt: true },
    orderBy: { lastActivityAt: 'asc' },
  })
  info(`After 4th sign-in: ${sessions.length} AuthSession rows (expect 3)`)
  const evictedTarget = !sessions.find((s) => s.id === target.id)
  if (sessions.length === 3 && evictedTarget) {
    ok(`4th sign-in evicted the most-idle session (${target.deviceId}) — 3-session cap honoured`)
  } else if (sessions.length === 3) {
    bad(`Evicted the wrong session — ${target.deviceId} still present`)
  } else {
    bad(`Expected 3 sessions after 4th sign-in, got ${sessions.length}`)
  }

  // The evicted refresh token should now reject /auth/refresh
  const refReject = await callRefresh(t2.refreshToken)
  if (refReject.status === 401) ok(`Evicted session #2 refresh-token rejected at /auth/refresh (401)`)
  else bad(`Evicted refresh-token returned ${refReject.status} (expected 401)`)

  // A still-active session should refresh successfully
  const refOk = await callRefresh(t1.refreshToken)
  if (refOk.status === 201 || refOk.status === 200) ok(`Active session #1 refresh succeeded (${refOk.status})`)
  else bad(`Active refresh returned ${refOk.status} ${await refOk.text()}`)

  // ── Patient (1-session cap) ──
  info('— Patient 1-session cap —')
  const patient = await prisma.user.findFirst({ where: { roles: { has: 'PATIENT' } }, select: { id: true, email: true } })
  if (!patient) { bad('No patient user found'); return }
  await prisma.authSession.deleteMany({ where: { userId: patient.id } })
  await prisma.refreshToken.deleteMany({ where: { userId: patient.id } })

  const p1 = await signIn(patient.email!, { deviceId: 'smoke-pat-1', appContext: 'patient' })
  await new Promise((r) => setTimeout(r, 200))
  const p2 = await signIn(patient.email!, { deviceId: 'smoke-pat-2', appContext: 'patient' })
  const patSessions = await prisma.authSession.count({ where: { userId: patient.id } })
  info(`Patient AuthSession count after 2 sign-ins: ${patSessions} (expect 1)`)
  if (patSessions === 1) ok('Patient enforced to 1 concurrent session')
  else bad(`Expected 1, got ${patSessions}`)

  const refRej = await callRefresh(p1.refreshToken)
  if (refRej.status === 401) ok(`First patient session evicted — refresh returns 401`)
  else bad(`Expected 401, got ${refRej.status}`)
}

// ─── Phase 2 — Idle timeout ───────────────────────────────────────────────
async function phase2() {
  banner('Phase 2 — Idle timeout (15 min web / 5 min mobile)')

  const provider = await prisma.user.findUnique({ where: { email: PROVIDER_A }, select: { id: true } })
  if (!provider) { bad('No primary-provider; skipping'); return }
  await prisma.authSession.deleteMany({ where: { userId: provider.id } })
  await prisma.refreshToken.deleteMany({ where: { userId: provider.id } })

  // WEB — sign in, backdate to -16 min, refresh should fail
  const web = await signIn(PROVIDER_A, { deviceId: 'smoke-idle-web', platform: 'web' })
  const webSession = await prisma.authSession.findFirst({
    where: { userId: provider.id },
    orderBy: { createdAt: 'desc' },
  })
  if (!webSession) { bad('No web AuthSession after sign-in'); return }
  info(`Web session deviceType=${webSession.deviceType ?? 'null'}`)

  // First, confirm a fresh refresh works
  const okRes = await callRefresh(web.refreshToken, 'web')
  if (okRes.ok) ok(`Web: fresh refresh succeeds (${okRes.status})`)
  else bad(`Web: fresh refresh returned ${okRes.status}`)

  // Use the NEW refresh token from the successful refresh for the staleness check
  // (rotation revokes the prior token)
  const okBody = (await okRes.json()) as any
  const freshWebRT = okBody.refreshToken ?? web.refreshToken

  // Find the session row for the new RT and backdate it
  const newWebSession = await prisma.authSession.findFirst({
    where: { userId: provider.id },
    orderBy: { lastActivityAt: 'desc' },
  })
  if (!newWebSession) { bad('No web session after refresh'); return }

  await prisma.authSession.update({
    where: { id: newWebSession.id },
    data: { lastActivityAt: new Date(Date.now() - 16 * 60_000) },
  })
  info(`Backdated web session lastActivityAt to -16 min`)

  const staleWeb = await callRefresh(freshWebRT, 'web')
  if (staleWeb.status === 401) {
    ok(`Web: refresh past 15-min threshold → 401 (idle timeout enforced)`)
    const remaining = await prisma.authSession.count({ where: { id: newWebSession.id } })
    if (remaining === 0) ok(`Idle session was REVOKED (AuthSession row gone)`)
    else bad(`AuthSession row still present after idle reject`)
  } else {
    bad(`Web: refresh past 15 min returned ${staleWeb.status} (expected 401)`)
  }

  // MOBILE — sign in, backdate to -6 min, refresh should fail
  await prisma.authSession.deleteMany({ where: { userId: provider.id } })
  await prisma.refreshToken.deleteMany({ where: { userId: provider.id } })

  const mob = await signIn(PROVIDER_A, { deviceId: 'smoke-idle-mob', platform: 'mobile' })
  const mobSession = await prisma.authSession.findFirst({
    where: { userId: provider.id },
    orderBy: { createdAt: 'desc' },
  })
  if (!mobSession) { bad('No mobile AuthSession after sign-in'); return }
  info(`Mobile session deviceType=${mobSession.deviceType ?? 'null'}`)

  // Backdate to -4 min — should still succeed
  await prisma.authSession.update({
    where: { id: mobSession.id },
    data: { lastActivityAt: new Date(Date.now() - 4 * 60_000) },
  })
  const ok4 = await callRefresh(mob.refreshToken, 'mobile')
  if (ok4.ok) ok(`Mobile: refresh at -4 min succeeds (under 5-min threshold)`)
  else bad(`Mobile: refresh at -4 min returned ${ok4.status} (expected 200/201)`)

  // Backdate to -6 min — should fail
  const mobSession2 = await prisma.authSession.findFirst({
    where: { userId: provider.id },
    orderBy: { lastActivityAt: 'desc' },
  })
  if (!mobSession2) { bad('No mobile session after refresh'); return }
  const ok4Body = (await ok4.json()) as any
  const freshMobRT = ok4Body.refreshToken ?? mob.refreshToken

  await prisma.authSession.update({
    where: { id: mobSession2.id },
    data: { lastActivityAt: new Date(Date.now() - 6 * 60_000) },
  })
  const staleMob = await callRefresh(freshMobRT, 'mobile')
  if (staleMob.status === 401) ok(`Mobile: refresh past 5-min threshold → 401 (idle timeout enforced)`)
  else bad(`Mobile: refresh past 6 min returned ${staleMob.status} (expected 401)`)
}

// ─── Phase 4 — Practice-identity selector + switcher + audit attribution ───
async function phase4() {
  banner('Phase 4 — Practice-identity selector + switcher + audit')

  const MULTI_EMAIL = 'multi-practice-provider@cardioplace.test'
  const PRACTICE_A_ID = 'seed-cedar-hill'
  const PRACTICE_B_ID = 'seed-bridgepoint'

  // ── Setup: ensure Practice B + multi-practice provider exist ──
  await prisma.practice.upsert({
    where: { id: PRACTICE_B_ID },
    update: {},
    create: {
      id: PRACTICE_B_ID,
      name: 'BridgePoint Cardiology',
      businessHoursStart: '07:30',
      businessHoursEnd: '17:30',
      businessHoursTimezone: 'America/New_York',
      afterHoursProtocol: 'After-hours BP escalations route to the shared on-call rotation.',
    },
  })
  info(`Practice B ensured: ${PRACTICE_B_ID}`)

  // Provider — only create if missing (don't touch pwdhash on existing).
  let provider = await prisma.user.findUnique({
    where: { email: MULTI_EMAIL },
    select: { id: true },
  })
  if (!provider) {
    // Reuse the seed pwdhash/otp via raw upsert helpers from seed/helpers.ts
    // by importing them dynamically — keeps this script self-contained.
    const helpers = await import('../prisma/seed/helpers.js') as {
      hashPassword: (s: string) => Promise<string>
      hashOtp: (s: string) => Promise<string>
      seedPermaOtp: (email: string, hash: string) => Promise<void>
    }
    const pwdhash = await helpers.hashPassword('demo-password')
    const otpHash = await helpers.hashOtp(DEMO_OTP)
    provider = await prisma.user.create({
      data: {
        email: MULTI_EMAIL,
        pwdhash,
        name: 'Dr. Aisha Nasser',
        roles: ['PROVIDER'],
        isVerified: true,
        onboardingStatus: 'COMPLETED',
        timezone: 'America/New_York',
      },
      select: { id: true },
    })
    await helpers.seedPermaOtp(MULTI_EMAIL, otpHash)
    info(`Multi-practice provider CREATED: ${MULTI_EMAIL}`)
  } else {
    info(`Multi-practice provider found: ${MULTI_EMAIL}`)
  }

  await prisma.practiceProvider.upsert({
    where: { practiceId_userId: { practiceId: PRACTICE_A_ID, userId: provider.id } },
    update: {},
    create: { practiceId: PRACTICE_A_ID, userId: provider.id },
  })
  await prisma.practiceProvider.upsert({
    where: { practiceId_userId: { practiceId: PRACTICE_B_ID, userId: provider.id } },
    update: {},
    create: { practiceId: PRACTICE_B_ID, userId: provider.id },
  })
  info(`Memberships ensured: ${PRACTICE_A_ID} + ${PRACTICE_B_ID}`)

  // ── STEP 1 — /otp/verify returns PRACTICE_SELECT_REQUIRED ──
  const deviceId = `smoke-multi-${rid()}`
  await fetch(`${API}/api/v2/auth/otp/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: MULTI_EMAIL, appContext: 'admin' }),
  })
  const verifyRes = await fetch(`${API}/api/v2/auth/otp/verify`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-device-id': deviceId,
      'x-device-platform': 'web',
    },
    body: JSON.stringify({
      email: MULTI_EMAIL,
      otp: DEMO_OTP,
      deviceId,
      appContext: 'admin',
    }),
  })
  const verifyBody: any = await verifyRes.json()
  if (verifyBody.status === 'PRACTICE_SELECT_REQUIRED' && verifyBody.challengeToken) {
    ok('Multi-practice verify returns PRACTICE_SELECT_REQUIRED with challenge')
    const practiceIds: string[] = (verifyBody.practices ?? []).map((p: any) => p.id)
    if (practiceIds.includes(PRACTICE_A_ID) && practiceIds.includes(PRACTICE_B_ID)) {
      ok('Both seed-cedar-hill + seed-bridgepoint surfaced as selectable')
    } else {
      bad(`Practice list missing one of A/B: ${practiceIds.join(',')}`)
    }
  } else {
    bad(`Expected PRACTICE_SELECT_REQUIRED, got: ${JSON.stringify(verifyBody).slice(0, 160)}`)
    return
  }

  // ── STEP 2 — /select-practice issues tokens with activePracticeId=A ──
  const cookies: string[] = []
  const captureCookies = (res: Response) => {
    const setCookie = res.headers.get('set-cookie') ?? ''
    for (const c of setCookie.split(/,(?=[^;]+=)/)) {
      cookies.push(c.split(';')[0].trim())
    }
  }
  const selectRes = await fetch(`${API}/api/v2/auth/select-practice`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-device-id': deviceId,
    },
    body: JSON.stringify({
      challengeToken: verifyBody.challengeToken,
      practiceId: PRACTICE_A_ID,
    }),
  })
  captureCookies(selectRes)
  const selectBody: any = await selectRes.json()
  if (selectRes.status === 201 && selectBody.activePracticeId === PRACTICE_A_ID) {
    ok(`Select-practice issued tokens with activePracticeId=${PRACTICE_A_ID}`)
  } else {
    bad(`Select-practice failed: ${selectRes.status} ${JSON.stringify(selectBody).slice(0, 160)}`)
    return
  }

  // ── STEP 3 — /switch-practice flips active context to B + mints fresh access ──
  const switchRes = await fetch(`${API}/api/v2/auth/switch-practice`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-device-id': deviceId,
      // Backend's deriveCookieScope reads Origin to pick cp_admin_* vs
      // cp_patient_* cookie names. Without it, the switch handler can't
      // find the refresh-token cookie.
      origin: 'http://localhost:3001',
      authorization: `Bearer ${selectBody.accessToken}`,
      cookie: cookies.join('; '),
    },
    body: JSON.stringify({ practiceId: PRACTICE_B_ID }),
  })
  const switchBody: any = await switchRes.json()
  if (switchRes.ok && switchBody.activePracticeId === PRACTICE_B_ID && switchBody.accessToken) {
    if (switchBody.accessToken !== selectBody.accessToken) {
      ok(`Switch-practice flipped to ${PRACTICE_B_ID} AND minted a fresh access token`)
    } else {
      bad(`Switch returned same access token — should mint a fresh one`)
    }
  } else {
    bad(`Switch-practice failed: ${switchRes.status} ${JSON.stringify(switchBody).slice(0, 160)}`)
    return
  }

  // ── STEP 4 — AuthLog rows captured practice_selected + practice_switched with correct practiceContext ──
  const logs = await prisma.authLog.findMany({
    where: { userId: provider.id, event: { in: ['practice_selected', 'practice_switched'] } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { event: true, practiceContext: true, metadata: true },
  })
  const selectedLog = logs.find((l) => l.event === 'practice_selected')
  const switchedLog = logs.find((l) => l.event === 'practice_switched')
  if (selectedLog?.practiceContext === PRACTICE_A_ID) {
    ok(`AuthLog practice_selected captured practiceContext=${PRACTICE_A_ID}`)
  } else {
    bad(`AuthLog practice_selected practiceContext = ${selectedLog?.practiceContext ?? 'NULL'} (expected ${PRACTICE_A_ID})`)
  }
  if (switchedLog?.practiceContext === PRACTICE_B_ID) {
    ok(`AuthLog practice_switched captured practiceContext=${PRACTICE_B_ID}`)
  } else {
    bad(`AuthLog practice_switched practiceContext = ${switchedLog?.practiceContext ?? 'NULL'} (expected ${PRACTICE_B_ID})`)
  }
  const meta = switchedLog?.metadata as { fromPracticeId?: string; toPracticeId?: string } | null
  if (meta?.fromPracticeId === PRACTICE_A_ID && meta?.toPracticeId === PRACTICE_B_ID) {
    ok(`AuthLog metadata records fromPracticeId=${PRACTICE_A_ID} → toPracticeId=${PRACTICE_B_ID}`)
  } else {
    bad(`AuthLog metadata mismatch: ${JSON.stringify(meta)}`)
  }
}

// ─── Run ───────────────────────────────────────────────────────────────────
async function main() {
  // Quick reachability probe
  try { await fetch(`${API}/api/v2/auth/otp/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }) }
  catch (e: any) { console.error(`Backend not reachable at ${API}: ${e.message}`); process.exit(2) }

  await phase1()
  await phase3()
  await phase2()
  await phase4()

  banner('Done')
}

main()
  .catch((e) => { console.error('FATAL:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
