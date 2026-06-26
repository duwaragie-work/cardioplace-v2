import { PrismaPg } from '@prisma/adapter-pg'
import dotenv from 'dotenv'
import pg from 'pg'
import { PrismaClient } from '../src/generated/prisma/client.js'
dotenv.config()
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  const alerts = await prisma.deviationAlert.findMany({
    where: { acknowledgedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true, userId: true, tier: true,
      actorPracticeContext: true, createdAt: true,
      user: { select: { email: true, name: true } },
    },
  })
  if (alerts.length === 0) {
    console.log('No unacked alerts. Creating one for Iris…')
    const iris = await prisma.user.findUnique({
      where: { email: 'iris.kim@cardioplace.test' }, select: { id: true },
    })
    if (!iris) { console.log('no iris'); return }
    const entry = await prisma.journalEntry.findFirst({
      where: { userId: iris.id, systolicBP: { gte: 180 } },
      orderBy: { createdAt: 'desc' },
    })
    if (!entry) { console.log('no high-BP entry to base alert on'); return }
    const fresh = await prisma.deviationAlert.create({
      data: {
        userId: iris.id,
        journalEntryId: entry.id,
        tier: 'TIER_1',
        ruleId: 'TIER_1_ABSOLUTE_EMERGENCY',
        systolicBP: entry.systolicBP,
        diastolicBP: entry.diastolicBP,
        patientMessage: 'Smoke-seeded test alert',
        caregiverMessage: 'Smoke',
        physicianMessage: 'Smoke',
      },
      select: { id: true, userId: true },
    })
    console.log(`Created alert ${fresh.id} for ${iris.id}`)
    return
  }
  console.log('Unacked alerts:')
  for (const a of alerts) {
    console.log(`  · ${a.id.slice(0, 8)} ${a.tier} ${a.user.email} actorContext=${a.actorPracticeContext ?? '(null)'}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
