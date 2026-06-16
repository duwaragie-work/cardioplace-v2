import { PrismaPg } from '@prisma/adapter-pg'
import dotenv from 'dotenv'
import pg from 'pg'
import { PrismaClient } from '../src/generated/prisma/client.js'

dotenv.config()

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  const [userCount, practices, providersByPractice, assignments, authSessionCount] = await Promise.all([
    prisma.user.count(),
    prisma.practice.findMany({ select: { id: true, name: true }, take: 20 }),
    prisma.practiceProvider.findMany({
      select: { userId: true, practiceId: true, user: { select: { email: true, roles: true } } },
      take: 50,
    }),
    prisma.patientProviderAssignment.findMany({
      select: {
        userId: true,
        practiceId: true,
        primaryProviderId: true,
        backupProviderId: true,
        user: { select: { email: true } },
      },
      take: 30,
    }),
    prisma.authSession.count(),
  ])

  console.log(JSON.stringify({
    userCount,
    practices,
    providersByPractice,
    sampleAssignments: assignments,
    authSessionCount,
  }, null, 2))
}

main()
  .catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
