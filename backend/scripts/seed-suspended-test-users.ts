import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import 'dotenv/config'

const dbUrl = process.env.DATABASE_URL!
const isAccelerate = dbUrl.startsWith('prisma://')
const prisma = isAccelerate
  ? new PrismaClient({ accelerateUrl: dbUrl })
  : new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: dbUrl })) })

async function main() {
  const fixtures = [
    { email: 'suspended-test@cardioplace.test', accountStatus: 'SUSPENDED' as const },
    { email: 'blocked-test@cardioplace.test', accountStatus: 'BLOCKED' as const },
  ]

  for (const f of fixtures) {
    await prisma.user.upsert({
      where: { email: f.email },
      update: { accountStatus: f.accountStatus },
      create: {
        email: f.email,
        accountStatus: f.accountStatus,
        roles: ['PATIENT'],
        isVerified: true,
        onboardingStatus: 'COMPLETED',
      },
    })
    console.log(`✓ ${f.email} (${f.accountStatus})`)
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err)
    return prisma.$disconnect().finally(() => process.exit(1))
  })
