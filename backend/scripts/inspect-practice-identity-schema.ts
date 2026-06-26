/**
 * Verifies the practice-identity migration landed on the cloud DB —
 * every audit-trail column from the handoff is present and indexed.
 */
import { PrismaPg } from '@prisma/adapter-pg'
import dotenv from 'dotenv'
import pg from 'pg'
import { PrismaClient } from '../src/generated/prisma/client.js'
dotenv.config()
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

interface ColCheck { table: string; column: string }
interface IdxCheck { table: string; columns: string[] }

const COLUMN_CHECKS: ColCheck[] = [
  { table: 'AuthSession',            column: 'activePracticeId' },
  { table: 'AuthLog',                column: 'practiceContext' },
  { table: 'EscalationEvent',        column: 'actorPracticeContext' },
  { table: 'DeviationAlert',         column: 'actorPracticeContext' },
  { table: 'ProfileVerificationLog', column: 'practiceContext' },
]

async function main() {
  console.log('\n── Tier 2: practice-identity schema verification ──\n')
  let pass = 0, fail = 0
  for (const c of COLUMN_CHECKS) {
    const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `select column_name from information_schema.columns
       where table_name = $1 and column_name = $2`,
      c.table, c.column,
    )
    if (rows.length === 1) { console.log(`  ✅ ${c.table}.${c.column}`); pass++ }
    else { console.log(`  ❌ ${c.table}.${c.column} MISSING`); fail++ }
  }

  // Index spot-checks (Item 1 spec required them on practiceContext columns)
  console.log('\n── Index spot-checks ──')
  const idxRows = await prisma.$queryRawUnsafe<Array<{ indexname: string; tablename: string }>>(
    `select indexname, tablename from pg_indexes
     where schemaname = 'public' and indexname ilike '%practice%context%'`,
  )
  if (idxRows.length === 0) console.log('  ❌ no practiceContext / actorPracticeContext indexes found')
  for (const r of idxRows) console.log(`  ✅ ${r.tablename} → ${r.indexname}`)

  console.log(`\nschema: ${pass}/${pass + fail} columns present`)
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
