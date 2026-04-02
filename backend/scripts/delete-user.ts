/**
 * Delete a user and ALL their data (journal entries, alerts, escalations, notifications, etc.)
 * The Prisma schema uses onDelete: Cascade, so deleting the user cascades everything.
 *
 * Usage: cd backend && npx tsx scripts/delete-user.ts <userId or email>
 */

import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import 'dotenv/config'

const dbUrl = process.env.DATABASE_URL!
const prisma = dbUrl.startsWith('prisma://')
  ? new PrismaClient({ accelerateUrl: dbUrl })
  : new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: dbUrl })) })

const input = process.argv[2]
if (!input) {
  console.error('Usage: npx tsx scripts/delete-user.ts <userId or email>')
  process.exit(1)
}

async function run() {
  const isEmail = input.includes('@')
  const user = await prisma.user.findFirst({
    where: isEmail ? { email: input } : { id: input },
    select: { id: true, email: true, name: true },
  })

  if (!user) {
    console.error(`User not found: ${input}`)
    process.exit(1)
  }

  console.log(`Found: ${user.name} (${user.email}) [${user.id}]`)
  console.log('Deleting user and all cascaded data...\n')

  // Count before delete
  const entries = await prisma.journalEntry.count({ where: { userId: user.id } })
  const alerts = await prisma.deviationAlert.count({ where: { userId: user.id } })
  const escalations = await prisma.escalationEvent.count({ where: { userId: user.id } })
  const notifications = await prisma.notification.count({ where: { userId: user.id } })
  const calls = await prisma.scheduledCall.count({ where: { userId: user.id } })

  // Cascade delete
  await prisma.user.delete({ where: { id: user.id } })

  console.log('Deleted:')
  console.log(`  Journal entries:  ${entries}`)
  console.log(`  Deviation alerts: ${alerts}`)
  console.log(`  Escalations:      ${escalations}`)
  console.log(`  Notifications:    ${notifications}`)
  console.log(`  Scheduled calls:  ${calls}`)
  console.log(`  User:             ${user.email}`)
  console.log('\nDone!')

  await prisma.$disconnect()
}

run().catch((e) => { console.error(e); process.exit(1) })
