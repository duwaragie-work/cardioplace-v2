import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import 'dotenv/config'

const dbUrl = process.env.DATABASE_URL!
const prisma = dbUrl.startsWith('prisma://')
  ? new PrismaClient({ accelerateUrl: dbUrl })
  : new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: dbUrl })) })

const uid = process.argv[2] || '01KN6SZSD6BDFBJZ0B2VRKKZT8'

async function run() {
  const entries = await prisma.journalEntry.findMany({
    where: { userId: uid },
    orderBy: { entryDate: 'desc' },
    select: { id: true, entryDate: true, measurementTime: true, systolicBP: true, diastolicBP: true },
  })
  console.log('\n=== JOURNAL ENTRIES ===')
  for (const e of entries) {
    console.log(`  ${e.entryDate.toISOString().slice(0,10)} ${e.measurementTime ?? '--:--'}  ${e.systolicBP}/${e.diastolicBP}  [${e.id.slice(0,8)}]`)
  }

  const alerts = await prisma.deviationAlert.findMany({
    where: { userId: uid },
    orderBy: { createdAt: 'desc' },
    select: { id: true, type: true, severity: true, status: true, escalated: true, journalEntryId: true },
  })
  console.log('\n=== DEVIATION ALERTS ===')
  for (const a of alerts) {
    console.log(`  ${a.type.padEnd(22)} ${a.severity.padEnd(6)} ${a.status.padEnd(12)} escalated=${a.escalated}  [${a.id.slice(0,8)}]`)
  }

  const escalations = await prisma.escalationEvent.findMany({
    where: { userId: uid },
    orderBy: { triggeredAt: 'desc' },
    select: { id: true, escalationLevel: true, reason: true, alertId: true, triggeredAt: true },
  })
  console.log('\n=== ESCALATION EVENTS ===')
  for (const e of escalations) {
    console.log(`  ${e.escalationLevel} | ${e.reason.slice(0,70)} | alert=[${e.alertId.slice(0,8)}] | ${e.triggeredAt.toISOString().slice(0,19)}`)
  }

  const notifs = await prisma.notification.findMany({
    where: { userId: uid },
    orderBy: { sentAt: 'desc' },
    select: { id: true, channel: true, title: true, body: true, alertId: true, escalationEventId: true },
  })
  console.log('\n=== NOTIFICATIONS ===')
  for (const n of notifs) {
    console.log(`  ${n.channel.padEnd(5)} | ${n.title.padEnd(30)} | alert=[${n.alertId?.slice(0,8) ?? '--------'}] esc=[${n.escalationEventId?.slice(0,8) ?? '--------'}]`)
    console.log(`         ${n.body.slice(0,100)}`)
  }

  console.log('\n--- COUNTS ---')
  console.log(`Entries: ${entries.length} | Alerts: ${alerts.length} | Escalations: ${escalations.length} | Notifications: ${notifs.length}`)

  await prisma.$disconnect()
}

run().catch((e) => { console.error(e); process.exit(1) })
