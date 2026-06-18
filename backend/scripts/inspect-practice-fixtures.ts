import { PrismaPg } from '@prisma/adapter-pg'
import dotenv from 'dotenv'
import pg from 'pg'
import { PrismaClient } from '../src/generated/prisma/client.js'
dotenv.config()
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  console.log('\n── Tier 3: seed-fixture verification ──\n')
  const practiceB = await prisma.practice.findUnique({
    where: { id: 'seed-bridgepoint' },
    select: { id: true, name: true },
  })
  console.log(practiceB
    ? `  ✅ Practice B exists — ${practiceB.id} "${practiceB.name}"`
    : `  ❌ Practice B (seed-bridgepoint) missing — seed needs SEED_TEST_FIXTURES=true`)

  const provider = await prisma.user.findUnique({
    where: { email: 'multi-practice-provider@cardioplace.test' },
    select: {
      id: true, email: true, name: true, roles: true,
      practiceProviderMemberships: {
        select: { practiceId: true, practice: { select: { name: true } } },
      },
    },
  })
  if (!provider) {
    console.log('  ❌ multi-practice-provider@cardioplace.test missing — seed needs SEED_TEST_FIXTURES=true')
    return
  }
  console.log(`  ✅ Multi-practice provider — ${provider.name} (${provider.email})`)
  console.log(`     roles: [${provider.roles.join(', ')}]`)
  console.log(`     memberships: ${provider.practiceProviderMemberships.length}`)
  for (const m of provider.practiceProviderMemberships) {
    console.log(`        · ${m.practice.name} (${m.practiceId})`)
  }
  if (provider.practiceProviderMemberships.length < 2) {
    console.log('  ⚠️  fewer than 2 memberships — selector won\'t trigger')
  }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
