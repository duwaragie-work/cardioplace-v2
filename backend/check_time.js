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
    const users = await prisma.user.findMany({ select: { id: true, name: true, timezone: true }, take: 5 });
    for (const u of users) {
        const tz = u.timezone ?? 'America/New_York';
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
        const parts = formatter.formatToParts(now);
        const h = parts.find(p => p.type === 'hour')?.value;
        const mi = parts.find(p => p.type === 'minute')?.value;
        console.log(`${u.name} | tz=${tz} | local=${h}:${mi} | UTC=${now.toISOString()}`);
    }
    await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
//# sourceMappingURL=check_time.js.map