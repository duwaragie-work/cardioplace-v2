/**
 * Cleanup duplicate EscalationEvents and Notifications.
 * For each alert with multiple escalations, keep the oldest, delete the rest.
 * For each escalation with duplicate notifications per channel, keep the oldest, delete the rest.
 *
 * Usage: cd backend && npx tsx scripts/cleanup-duplicates.ts
 * Optionally pass a userId: npx tsx scripts/cleanup-duplicates.ts <userId>
 */

import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import 'dotenv/config'

const dbUrl = process.env.DATABASE_URL!
const prisma = dbUrl.startsWith('prisma://')
  ? new PrismaClient({ accelerateUrl: dbUrl })
  : new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: dbUrl })) })

const targetUserId = process.argv[2] || undefined

async function run() {
  console.log(targetUserId
    ? `Cleaning up duplicates for user ${targetUserId}...`
    : 'Cleaning up duplicates for ALL users...',
  )

  // ── 1. Deduplicate EscalationEvents per alertId ──
  // Keep the oldest escalation per alert, delete the rest
  const allEscalations = await prisma.escalationEvent.findMany({
    where: targetUserId ? { userId: targetUserId } : {},
    orderBy: { triggeredAt: 'asc' },
    select: { id: true, alertId: true, triggeredAt: true },
  })

  const escalationsByAlert = new Map<string, string[]>()
  for (const esc of allEscalations) {
    const key = esc.alertId
    if (!escalationsByAlert.has(key)) escalationsByAlert.set(key, [])
    escalationsByAlert.get(key)!.push(esc.id)
  }

  const escalationIdsToDelete: string[] = []
  for (const [alertId, escIds] of escalationsByAlert) {
    if (escIds.length > 1) {
      // Keep first (oldest), delete rest
      escalationIdsToDelete.push(...escIds.slice(1))
      console.log(`  Alert ${alertId.slice(0, 8)}: keeping 1, deleting ${escIds.length - 1} duplicate escalation(s)`)
    }
  }

  // Delete notifications linked to duplicate escalations first
  if (escalationIdsToDelete.length > 0) {
    const deletedNotifs = await prisma.notification.deleteMany({
      where: { escalationEventId: { in: escalationIdsToDelete } },
    })
    console.log(`  Deleted ${deletedNotifs.count} notifications linked to duplicate escalations`)

    const deletedEscalations = await prisma.escalationEvent.deleteMany({
      where: { id: { in: escalationIdsToDelete } },
    })
    console.log(`  Deleted ${deletedEscalations.count} duplicate escalation events`)
  }

  // ── 2. Deduplicate Notifications per (escalationEventId + channel) ──
  const remainingNotifs = await prisma.notification.findMany({
    where: targetUserId ? { userId: targetUserId } : {},
    orderBy: { sentAt: 'asc' },
    select: { id: true, escalationEventId: true, channel: true },
  })

  const notifsByKey = new Map<string, string[]>()
  for (const n of remainingNotifs) {
    const key = `${n.escalationEventId ?? 'none'}_${n.channel}`
    if (!notifsByKey.has(key)) notifsByKey.set(key, [])
    notifsByKey.get(key)!.push(n.id)
  }

  const notifIdsToDelete: string[] = []
  for (const [key, ids] of notifsByKey) {
    if (ids.length > 1) {
      notifIdsToDelete.push(...ids.slice(1))
      console.log(`  Notification group ${key.slice(0, 20)}: keeping 1, deleting ${ids.length - 1} duplicate(s)`)
    }
  }

  if (notifIdsToDelete.length > 0) {
    const deleted = await prisma.notification.deleteMany({
      where: { id: { in: notifIdsToDelete } },
    })
    console.log(`  Deleted ${deleted.count} duplicate notifications`)
  }

  // ── 3. Clean up orphaned notifications (alertId = null, escalationEventId = null) ──
  const orphaned = await prisma.notification.deleteMany({
    where: {
      ...(targetUserId ? { userId: targetUserId } : {}),
      alertId: null,
      escalationEventId: null,
    },
  })
  if (orphaned.count > 0) {
    console.log(`  Deleted ${orphaned.count} orphaned notifications (no alert or escalation link)`)
  }

  // ── Summary ──
  console.log('\n--- AFTER CLEANUP ---')
  const escCount = await prisma.escalationEvent.count({
    where: targetUserId ? { userId: targetUserId } : {},
  })
  const notifCount = await prisma.notification.count({
    where: targetUserId ? { userId: targetUserId } : {},
  })
  console.log(`Escalation events: ${escCount}`)
  console.log(`Notifications: ${notifCount}`)

  await prisma.$disconnect()
  console.log('\nDone!')
}

run().catch((e) => { console.error(e); process.exit(1) })
