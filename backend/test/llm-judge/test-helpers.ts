/**
 * Test helpers: spin up real NestJS app, create test user, get JWT.
 */
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { AppModule } from '../../src/app.module.js'
import { PrismaService } from '../../src/prisma/prisma.service.js'

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

  // Create or find test user — use Prisma enum values
  const email = 'llm-judge-test@healplace.test'
  let user = await prisma.user.findFirst({ where: { email } })
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: 'Test Patient',
        preferredLanguage: 'en',
        dateOfBirth: new Date('1975-06-15'),
      },
    })
  }

  // Sign JWT using the same secret the app reads from env
  const jwt = jwtService.sign({ sub: user.id, email: user.email })

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
