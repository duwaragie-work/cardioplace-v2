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
    console.log('Connecting...');
    const sessions = await prisma.session.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
            id: true,
            title: true,
            summary: true,
            messageCount: true,
            createdAt: true,
            updatedAt: true,
        },
    });
    console.log(`Found ${sessions.length} sessions\n`);
    for (const s of sessions) {
        console.log('---');
        console.log('ID:', s.id);
        console.log('Title:', s.title);
        console.log('Summary:', s.summary ? s.summary.substring(0, 300) : '(null)');
        console.log('Messages:', s.messageCount);
        console.log('Created:', s.createdAt.toISOString());
        console.log('Updated:', s.updatedAt.toISOString());
    }
    console.log('\n\n=== VOICE CONVERSATION ROWS (last 15) ===');
    const convos = await prisma.$queryRawUnsafe(`
    SELECT id, "sessionId", "userMessage", "aiSummary", source, "timestamp"
    FROM "Conversation"
    WHERE source = 'voice'
    ORDER BY "timestamp" DESC
    LIMIT 15
  `);
    for (const c of convos) {
        console.log('---');
        console.log('Session:', c.sessionId);
        console.log('User:', (c.userMessage || '').substring(0, 150));
        console.log('AI:', (c.aiSummary || '').substring(0, 150));
        console.log('Timestamp:', c.timestamp);
    }
    await prisma.$disconnect();
}
main().catch(e => { console.error('Error:', e); process.exit(1); });
//# sourceMappingURL=query_sessions.js.map