import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import 'dotenv/config'

const dbUrl = process.env.DATABASE_URL!
const prisma = dbUrl.startsWith('prisma://')
  ? new PrismaClient({ accelerateUrl: dbUrl })
  : new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: dbUrl })) })

const search = process.argv[2] || 'duwaragie'

async function run() {
  const users = await prisma.user.findMany({
    where: { OR: [
      { email: { contains: search } },
      { name: { contains: search } },
    ]},
    select: { id: true, email: true, name: true, roles: true, _count: { select: { journalEntries: true } } },
  })

  if (users.length === 0) {
    console.log(`No users found matching "${search}"`)
  } else {
    for (const u of users) {
      console.log(`${u.id} | ${u.email} | ${u.name} | roles=${u.roles.join(',')} | entries=${u._count.journalEntries}`)
    }
  }

  await prisma.$disconnect()
}

run().catch((e) => { console.error(e); process.exit(1) })
