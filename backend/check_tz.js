import { PrismaClient } from './src/generated/prisma/client.ts';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const dbUrl = process.env.DATABASE_URL;
const isAccelerate = dbUrl.startsWith('prisma://');
let prisma;
if (isAccelerate) {
    prisma = new PrismaClient({ accelerateUrl: dbUrl });
}
else {
    const pool = new pg.Pool({ connectionString: dbUrl });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
}
async function main() {
    const users = await prisma.user.findMany({ select: { id: true, name: true, timezone: true }, take: 5 });
    for (const u of users) {
        console.log(`User: ${u.name} | timezone: ${u.timezone ?? '(null)'}`);
    }
    const tz = users[0]?.timezone ?? 'America/New_York';
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const parts = formatter.formatToParts(now);
    const y = parts.find(p => p.type === 'year')?.value;
    const mo = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    const h = parts.find(p => p.type === 'hour')?.value;
    const mi = parts.find(p => p.type === 'minute')?.value;
    console.log(`\nTimezone used: ${tz}`);
    console.log(`Server UTC now: ${now.toISOString()}`);
    console.log(`Patient local: ${y}-${mo}-${d} at ${h}:${mi}`);
    await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
//# sourceMappingURL=check_tz.js.map