import { PrismaPg } from '@prisma/adapter-pg'
import dotenv from 'dotenv'
import pg from 'pg'
import { PrismaClient } from '../src/generated/prisma/client.js'
dotenv.config()
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'james.okafor@cardioplace.test' },
    select: { id: true },
  })
  if (!user) { console.log('no james'); return }
  const rows = await prisma.journalEntry.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: {
      id: true, systolicBP: true, diastolicBP: true,
      emergencyConfirmation: true, sessionId: true, sessionClosedAt: true,
      createdAt: true, singleReadingFinalized: true,
    },
  })
  for (const r of rows) {
    console.log(
      `${r.createdAt.toISOString().slice(11, 19)} ` +
      `${r.systolicBP}/${r.diastolicBP} ` +
      `emergency=${r.emergencyConfirmation ?? '—'} ` +
      `sid=${r.sessionId ? r.sessionId.slice(0, 8) : '—'} ` +
      `closed=${r.sessionClosedAt ? 'yes' : 'no'} ` +
      `finalized=${r.singleReadingFinalized}`,
    )
  }
}
main().finally(() => prisma.$disconnect())
