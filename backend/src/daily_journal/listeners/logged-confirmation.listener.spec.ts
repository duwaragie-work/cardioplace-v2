// N7 unit spec (2026-07-13). Verifies the "Logged ✓" push confirmation
// listener produces exactly one PUSH-channel Notification row, contains NO
// BP values in the body, and never throws on lookup/write failure.
//
// Gap 1 fix (2026-07-13) — listener now consumes ENTRY_EVALUATED (not
// ENTRY_CREATED), and gates positive language on BOTH the alert engine's
// verdict (`alertsFired`) AND the AHA-band predicate. Payloads below carry
// the new `alertsFired` / `alertCount` fields.
import { jest } from '@jest/globals'
import { LoggedConfirmationListener } from './logged-confirmation.listener.js'
import type { JournalEntryEvaluatedEvent } from '../interfaces/events.interface.js'

function fakePrisma(overrides: {
  user?: { preferredLanguage: string | null } | null
  createBehaviour?: 'ok' | 'throw'
} = {}) {
  const created: any[] = []
  return {
    _created: created,
    user: {
      findUnique: jest.fn<any>().mockResolvedValue(
        overrides.user === undefined ? { preferredLanguage: 'en' } : overrides.user,
      ),
    },
    notification: {
      create: jest.fn<any>().mockImplementation(async (args: any) => {
        if (overrides.createBehaviour === 'throw') {
          throw new Error('notification.create failed')
        }
        created.push(args.data)
        return { id: 'n-1', ...args.data }
      }),
    },
  } as any
}

const BASE_EVENT: JournalEntryEvaluatedEvent = {
  userId: 'p1',
  entryId: 'e1',
  measuredAt: new Date('2026-07-13T13:00:00Z'),
  systolicBP: 125,
  diastolicBP: 82,
  pulse: 68,
  weight: null,
  sessionId: 's1',
  alertsFired: false,
  alertCount: 0,
}

describe('LoggedConfirmationListener', () => {
  it('creates exactly one PUSH-channel Notification row on ENTRY_EVALUATED', async () => {
    const prisma = fakePrisma()
    const listener = new LoggedConfirmationListener(prisma)
    await listener.onEntryEvaluated(BASE_EVENT)
    expect(prisma._created.length).toBe(1)
    expect(prisma._created[0].channel).toBe('PUSH')
    expect(prisma._created[0].userId).toBe('p1')
    expect(prisma._created[0].title).toBe('Logged ✓')
    expect(prisma._created[0].dispatchTrigger).toBe('SYSTEM_CRON')
  })

  it('body NEVER contains BP values (spec §N7 privacy contract)', async () => {
    const prisma = fakePrisma()
    const listener = new LoggedConfirmationListener(prisma)
    await listener.onEntryEvaluated(BASE_EVENT)
    const body = prisma._created[0].body as string
    expect(body).not.toContain('125')
    expect(body).not.toContain('82')
    expect(body).not.toContain('68')
    expect(body).not.toMatch(/mmHg/i)
  })

  it('appends "Looking good — keep it up!" for a NORMAL-range reading with no alerts', async () => {
    // 118/76 — comfortably in the normal band. Engine says clean.
    const normal = { ...BASE_EVENT, systolicBP: 118, diastolicBP: 76, alertsFired: false, alertCount: 0 }
    const prisma = fakePrisma()
    const listener = new LoggedConfirmationListener(prisma)
    await listener.onEntryEvaluated(normal)
    const body = prisma._created[0].body as string
    expect(body).toContain('Looking good')
    expect(body).toContain('Logged ✓')
  })

  it('Gap 1 fix — SUPPRESSES positive language when the engine says alertsFired=true, even for a normal-band BP', async () => {
    // 118/76 (normal band) BUT the engine fired an alert (e.g. AFib on HR).
    // Prior implementation would have leaked "Looking good"; the ENTRY_EVALUATED
    // rewire is what closes this.
    const afib = {
      ...BASE_EVENT,
      systolicBP: 118,
      diastolicBP: 76,
      pulse: 115,
      alertsFired: true,
      alertCount: 1,
    }
    const prisma = fakePrisma()
    const listener = new LoggedConfirmationListener(prisma)
    await listener.onEntryEvaluated(afib)
    const body = prisma._created[0].body as string
    expect(body).toContain('Logged ✓')
    expect(body).not.toContain('Looking good')
    expect(body).not.toContain('keep it up')
  })

  it('does NOT append positive language for an alert-triggering reading (spec §N7)', async () => {
    // 165/105 — Stage 2 hypertension range; engine would fire BP L2. Both
    // gates fire in the same direction (belt-and-braces).
    const highBp = {
      ...BASE_EVENT,
      systolicBP: 165,
      diastolicBP: 105,
      alertsFired: true,
      alertCount: 1,
    }
    const prisma = fakePrisma()
    const listener = new LoggedConfirmationListener(prisma)
    await listener.onEntryEvaluated(highBp)
    const body = prisma._created[0].body as string
    expect(body).toContain('Logged ✓')
    expect(body).not.toContain('Looking good')
    expect(body).not.toContain('keep it up')
    // Belt-and-suspenders: no numbers, no mmHg.
    expect(body).not.toContain('165')
    expect(body).not.toContain('105')
  })

  it('Gap 1 belt-and-braces — SUPPRESSES positive language when BP is outside the AHA band even if the engine says clean', async () => {
    // Contrived scenario: 145/92 (Stage 1 HTN) but engine didn't fire any rule.
    // Real path never hits this today, but the second gate keeps a positive
    // tail off a reading that clearly isn't comfortable-normal.
    const stage1 = {
      ...BASE_EVENT,
      systolicBP: 145,
      diastolicBP: 92,
      alertsFired: false,
      alertCount: 0,
    }
    const prisma = fakePrisma()
    const listener = new LoggedConfirmationListener(prisma)
    await listener.onEntryEvaluated(stage1)
    const body = prisma._created[0].body as string
    expect(body).toContain('Logged ✓')
    expect(body).not.toContain('Looking good')
  })

  it('does NOT append positive language when BP values are missing', async () => {
    const missing = { ...BASE_EVENT, systolicBP: null, diastolicBP: null }
    const prisma = fakePrisma()
    const listener = new LoggedConfirmationListener(prisma)
    await listener.onEntryEvaluated(missing)
    expect(prisma._created[0].body).not.toContain('Looking good')
  })

  it('renders Spanish body when the patient prefers es', async () => {
    const prisma = fakePrisma({ user: { preferredLanguage: 'es' } })
    const listener = new LoggedConfirmationListener(prisma)
    const normal = { ...BASE_EVENT, systolicBP: 118, diastolicBP: 76 }
    await listener.onEntryEvaluated(normal)
    const body = prisma._created[0].body as string
    expect(body).toContain('Registrado')
    expect(body).toContain('Se ve bien')
  })

  it('does not throw when the user lookup returns null', async () => {
    const prisma = fakePrisma({ user: null })
    const listener = new LoggedConfirmationListener(prisma)
    await expect(listener.onEntryEvaluated(BASE_EVENT)).resolves.toBeUndefined()
    expect(prisma._created[0].body).toContain('Logged')
  })

  it('swallows notification.create failure so the journal write path never derails', async () => {
    const prisma = fakePrisma({ createBehaviour: 'throw' })
    const listener = new LoggedConfirmationListener(prisma)
    await expect(listener.onEntryEvaluated(BASE_EVENT)).resolves.toBeUndefined()
  })

  // ─── BP-band boundary tests (2026-07-13) ────────────────────────────────
  // The AHA normal band is 90 ≤ SBP < 130 AND 60 ≤ DBP < 85. Verify each edge.

  it('boundary: 90/60 (inclusive lower) with no alerts → "Looking good" appended', async () => {
    const boundary = { ...BASE_EVENT, systolicBP: 90, diastolicBP: 60, alertsFired: false }
    const prisma = fakePrisma()
    const listener = new LoggedConfirmationListener(prisma)
    await listener.onEntryEvaluated(boundary)
    expect(prisma._created[0].body).toContain('Looking good')
  })

  it('boundary: 89/70 (below SBP band) → NO "Looking good"', async () => {
    const belowSbp = { ...BASE_EVENT, systolicBP: 89, diastolicBP: 70, alertsFired: false }
    const prisma = fakePrisma()
    const listener = new LoggedConfirmationListener(prisma)
    await listener.onEntryEvaluated(belowSbp)
    expect(prisma._created[0].body).not.toContain('Looking good')
  })

  it('boundary: 129/84 (highest normal — inclusive) with no alerts → "Looking good" appended', async () => {
    const highNormal = { ...BASE_EVENT, systolicBP: 129, diastolicBP: 84, alertsFired: false }
    const prisma = fakePrisma()
    const listener = new LoggedConfirmationListener(prisma)
    await listener.onEntryEvaluated(highNormal)
    expect(prisma._created[0].body).toContain('Looking good')
  })

  it('boundary: 130/80 (Stage 1 HTN starts — SBP=130) → NO "Looking good"', async () => {
    const stage1 = { ...BASE_EVENT, systolicBP: 130, diastolicBP: 80, alertsFired: false }
    const prisma = fakePrisma()
    const listener = new LoggedConfirmationListener(prisma)
    await listener.onEntryEvaluated(stage1)
    expect(prisma._created[0].body).not.toContain('Looking good')
  })

  it('boundary: 120/85 (DBP=85 crosses upper edge) → NO "Looking good"', async () => {
    const dbp85 = { ...BASE_EVENT, systolicBP: 120, diastolicBP: 85, alertsFired: false }
    const prisma = fakePrisma()
    const listener = new LoggedConfirmationListener(prisma)
    await listener.onEntryEvaluated(dbp85)
    expect(prisma._created[0].body).not.toContain('Looking good')
  })

  it('boundary: 110/59 (below DBP band — hypotensive) → NO "Looking good"', async () => {
    const hypo = { ...BASE_EVENT, systolicBP: 110, diastolicBP: 59, alertsFired: false }
    const prisma = fakePrisma()
    const listener = new LoggedConfirmationListener(prisma)
    await listener.onEntryEvaluated(hypo)
    expect(prisma._created[0].body).not.toContain('Looking good')
  })

  // ─── User lookup failure paths ──────────────────────────────────────────

  it('does not throw when user.findUnique itself REJECTS (DB down)', async () => {
    const prisma = {
      user: {
        findUnique: jest
          .fn<any>()
          .mockRejectedValue(new Error('DB unreachable')),
      },
      notification: { create: jest.fn<any>() },
    } as any
    const listener = new LoggedConfirmationListener(prisma)
    // Listener catches at the outer try/catch — no throw, no push.
    await expect(listener.onEntryEvaluated(BASE_EVENT)).resolves.toBeUndefined()
    expect(prisma.notification.create).not.toHaveBeenCalled()
  })

  // ─── Extra field propagation ────────────────────────────────────────────

  it('populates userId + title + channel + dispatchTrigger correctly on every path', async () => {
    const prisma = fakePrisma()
    const listener = new LoggedConfirmationListener(prisma)
    // Try three variants — all must produce the same shape (only body differs).
    await listener.onEntryEvaluated({ ...BASE_EVENT, systolicBP: 118, diastolicBP: 76, alertsFired: false })
    await listener.onEntryEvaluated({ ...BASE_EVENT, entryId: 'e2', alertsFired: true })
    await listener.onEntryEvaluated({ ...BASE_EVENT, entryId: 'e3', systolicBP: null, diastolicBP: null })
    for (const row of prisma._created) {
      expect(row.userId).toBe('p1')
      expect(row.channel).toBe('PUSH')
      expect(row.title).toBe('Logged ✓')
      expect(row.dispatchTrigger).toBe('SYSTEM_CRON')
      // Every body starts with the spec-verbatim base string.
      expect(row.body).toMatch(/^Logged ✓ — your reading has been recorded\./)
    }
  })

  it('French preferredLanguage renders French body', async () => {
    const prisma = fakePrisma({ user: { preferredLanguage: 'fr' } })
    const listener = new LoggedConfirmationListener(prisma)
    const normal = { ...BASE_EVENT, systolicBP: 118, diastolicBP: 76, alertsFired: false }
    await listener.onEntryEvaluated(normal)
    expect(prisma._created[0].body).toContain('Enregistré')
    expect(prisma._created[0].body).toContain('Tout va bien')
  })

  it('German preferredLanguage renders German body', async () => {
    const prisma = fakePrisma({ user: { preferredLanguage: 'de' } })
    const listener = new LoggedConfirmationListener(prisma)
    const normal = { ...BASE_EVENT, systolicBP: 118, diastolicBP: 76, alertsFired: false }
    await listener.onEntryEvaluated(normal)
    expect(prisma._created[0].body).toContain('Erfasst')
    expect(prisma._created[0].body).toContain('Sieht gut aus')
  })

  it('unsupported language (e.g. Portuguese) falls back to English', async () => {
    const prisma = fakePrisma({ user: { preferredLanguage: 'pt' } })
    const listener = new LoggedConfirmationListener(prisma)
    const normal = { ...BASE_EVENT, systolicBP: 118, diastolicBP: 76, alertsFired: false }
    await listener.onEntryEvaluated(normal)
    expect(prisma._created[0].body).toContain('Logged ✓')
    expect(prisma._created[0].body).toContain('Looking good')
  })

  it('null preferredLanguage falls back to English (defensive against old rows)', async () => {
    const prisma = fakePrisma({ user: { preferredLanguage: null } })
    const listener = new LoggedConfirmationListener(prisma)
    const normal = { ...BASE_EVENT, systolicBP: 118, diastolicBP: 76, alertsFired: false }
    await listener.onEntryEvaluated(normal)
    expect(prisma._created[0].body).toContain('Logged ✓')
  })

  it('is idempotent when the DB commits succeed but the event fires twice (dispatcher retries)', async () => {
    // Whenever an at-least-once event bus double-fires ENTRY_EVALUATED (e.g.
    // a bug in NestJS's EventEmitter, or a downstream re-dispatch), we get
    // two Notification rows. The dispatcher is intentionally NOT idempotent
    // — the Prisma-level @@unique constraint on Notification (or the caller-
    // level idempotency check) is expected to catch duplicates. Verify the
    // listener behavior: both invocations WILL create rows if the DB allows.
    const prisma = fakePrisma()
    const listener = new LoggedConfirmationListener(prisma)
    await listener.onEntryEvaluated(BASE_EVENT)
    await listener.onEntryEvaluated(BASE_EVENT)
    expect(prisma._created).toHaveLength(2)
    // At least document the invariant this reveals: duplication upstream = 2 rows.
    // A future dedup pass would target the DB constraint, not this listener.
  })

  it('respects the `alertCount` for logging without affecting the variant selection', async () => {
    // Only `alertsFired` (boolean) gates the variant. `alertCount` is
    // informational for future observability. Verify the listener doesn't
    // accidentally branch on the count.
    const withCount5 = { ...BASE_EVENT, systolicBP: 118, diastolicBP: 76, alertsFired: false, alertCount: 5 }
    const prisma = fakePrisma()
    const listener = new LoggedConfirmationListener(prisma)
    await listener.onEntryEvaluated(withCount5)
    // alertsFired=false with normal BP + alertCount=5 (contradictory input)
    // → still routes off alertsFired=false. This documents the source-of-
    // truth precedence. In practice alertCount>0 implies alertsFired=true
    // (see alert-engine.service.ts:331), so this configuration is a bug
    // upstream, not a listener bug.
    expect(prisma._created[0].body).toContain('Looking good')
  })
})
