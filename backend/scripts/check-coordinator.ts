import { PrismaPg } from '@prisma/adapter-pg'
import dotenv from 'dotenv'
import pg from 'pg'
import { PrismaClient } from '../src/generated/prisma/client.js'
dotenv.config()
const prisma = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: process.env.DATABASE_URL })) })

async function main() {
  const coords = await prisma.user.findMany({
    where: { roles: { has: 'COORDINATOR' } },
    select: {
      email: true, roles: true, accountStatus: true,
      practiceCoordinator: { select: { practiceId: true, practice: { select: { name: true } } } },
      practiceProviderMemberships: { select: { practiceId: true } },
    },
  })
  console.log(`Found ${coords.length} COORDINATOR users:`)
  for (const c of coords) {
    console.log(`  ${c.email}  status=${c.accountStatus}  roles=[${c.roles.join(',')}]`)
    console.log(`     practiceCoordinator: ${c.practiceCoordinator ? c.practiceCoordinator.practice.name : '(none)'}`)
    console.log(`     practiceProviderMemberships: ${c.practiceProviderMemberships.length}`)
  }
}
main().catch(console.error).finally(() => prisma.$disconnect())
