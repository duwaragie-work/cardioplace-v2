/**
 * Test helpers: spin up real NestJS app, create test user, get JWT.
 */
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { AppModule } from '../../src/app.module.js'
import { PrismaService } from '../../src/prisma/prisma.service.js'
import { UserRole } from '../../src/generated/prisma/enums.js'

export interface TestContext {
  app: INestApplication
  jwt: string
  userId: string
  prisma: PrismaService
}

export async function setupTestApp(): Promise<TestContext> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  const app = moduleFixture.createNestApplication()
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

  // Use listen(0) instead of init() so the HTTP server is actually bound
  // (required for Socket.IO voice tests and supertest)
  await app.listen(0)

  const prisma = app.get(PrismaService)
  const jwtService = app.get(JwtService)

  // Create or find test user — needs the PATIENT role so the @Roles(PATIENT)
  // guard on /chat routes passes. jwt.strategy maps payload.roles → req.user.roles,
  // so a roleless token makes RolesGuard throw (500) on every chat request.
  const email = 'llm-judge-test@healplace.test'
  let user = await prisma.user.findFirst({ where: { email } })
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: 'Test Patient',
        preferredLanguage: 'en',
        dateOfBirth: new Date('1975-06-15'),
        roles: [UserRole.PATIENT],
      },
    })
  } else if (!user.roles?.includes(UserRole.PATIENT)) {
    // Heal a user left over from an earlier run that predates the role fix.
    user = await prisma.user.update({
      where: { id: user.id },
      data: { roles: [UserRole.PATIENT] },
    })
  }

  // Create a minimal PatientProfile so the chat's intake gate is "complete".
  // Without this, IntakeStatusService.getStatus → {completed:false}, and
  // SystemPromptService.appendIntakeStatus injects the "Do NOT call
  // submit_checkin / update_checkin / log_*" prohibition block — which is
  // exactly what the chatbot was doing, causing "Full check-in" + "Multi-turn"
  // judge tests to score Tool Use 1/5. Mirrors the gate at
  // DailyJournalService.create + IntakeStatusService.getStatus
  // (presence of PatientProfile row → intake complete).
  //
  // diagnosedHypertension is deliberately FALSE. With it set true, the bot
  // hallucinated "140/90 is within your goals" on Test 2 (Health question)
  // — there's no PatientThreshold here, so "your goals" is invented. As a
  // neutral / non-diagnosed user the bot falls back to general AHA
  // education (Stage 2 HTN), which matches what Test 2 asserts.
  await prisma.patientProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      gender: 'FEMALE',
      heightCm: 165,
      diagnosedHypertension: false,
    },
    update: {
      diagnosedHypertension: false, // heal stale runs that pre-date this flip
    },
  })

  // Sign JWT mirroring the app's payload shape (auth.service signs
  // { sub, email, roles }; jwt.strategy reads roles straight off the token).
  const jwt = jwtService.sign({
    sub: user.id,
    email: user.email,
    roles: user.roles,
  })

  return { app, jwt, userId: user.id, prisma }
}

export async function teardownTestApp(ctx: TestContext | undefined) {
  if (!ctx) return
  try {
    const sessions = await ctx.prisma.session.findMany({
      where: { userId: ctx.userId },
      select: { id: true },
    })
    const ids = sessions.map((s) => s.id)
    if (ids.length) {
      await ctx.prisma.conversation.deleteMany({ where: { sessionId: { in: ids } } })
      await ctx.prisma.session.deleteMany({ where: { id: { in: ids } } })
    }
  } catch { /* best effort cleanup */ }
  try { await ctx.app.close() } catch { /* already closed */ }
}

/** Get the base URL of the running test app */
export function getBaseUrl(app: INestApplication): string {
  const srv = app.getHttpServer()
  const addr = srv.address()
  const port = typeof addr === 'object' ? addr?.port : addr
  return `http://localhost:${port}`
}
