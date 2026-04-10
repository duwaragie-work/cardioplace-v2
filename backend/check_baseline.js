import { PrismaClient } from './src/generated/prisma/client.ts';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const dbUrl = process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString: dbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
async function main() {
    const baselines = await prisma.baselineSnapshot.findMany({
        orderBy: { computedForDate: 'desc' },
        take: 5,
    });
    for (const b of baselines) {
        console.log(`User: ${b.userId} | systolic: ${b.baselineSystolic} (${typeof b.baselineSystolic}) | diastolic: ${b.baselineDiastolic} (${typeof b.baselineDiastolic}) | date: ${b.computedForDate}`);
    }
    if (baselines.length === 0)
        console.log('No baselines found');
    await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
//# sourceMappingURL=check_baseline.js.map