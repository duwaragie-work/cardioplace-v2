// N7 unit spec (2026-07-13). Verifies the "Logged ✓" push confirmation
// listener produces exactly one PUSH-channel Notification row, contains NO
// BP values in the body, and never throws on lookup/write failure.
import { jest } from '@jest/globals'
import { LoggedConfirmationListener } from './logged-confirmation.listener.js'
import type { JournalEntryCreatedEvent } from '../interfaces/events.interface.js'

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

const BASE_EVENT: JournalEntryCreatedEvent = {
  userId: 'p1',
  entryId: 'e1',
  measuredAt: new Date('2026-07-13T13:00:00Z'),
  systolicBP: 125,
  diastolicBP: 82,
  pulse: 68,
  weight: null,
  sessionId: 's1',
}

describe('LoggedConfirmationListener', () => {
  it('creates exactly one PUSH-channel Notification row on ENTRY_CREATED', async () => {
    const prisma = fakePrisma()
    const listener = new LoggedConfirmationListener(prisma)
    await listener.onEntryCreated(BASE_EVENT)
    expect(prisma._created.length).toBe(1)
    expect(prisma._created[0].channel).toBe('PUSH')
    expect(prisma._created[0].userId).toBe('p1')
    expect(prisma._created[0].title).toBe('Logged ✓')
    expect(prisma._created[0].dispatchTrigger).toBe('SYSTEM_CRON')
  })

  it('body NEVER contains BP values (spec §N7 privacy contract)', async () => {
    const prisma = fakePrisma()
    const listener = new LoggedConfirmationListener(prisma)
    await listener.onEntryCreated(BASE_EVENT)
    const body = prisma._created[0].body as string
    expect(body).not.toContain('125')
    expect(body).not.toContain('82')
    expect(body).not.toContain('68')
    expect(body).not.toMatch(/mmHg/i)
  })

  it('appends "Looking good — keep it up!" for a NORMAL-range reading', async () => {
    // 118/76 — comfortably in the normal band.
    const normal = { ...BASE_EVENT, systolicBP: 118, diastolicBP: 76 }
    const prisma = fakePrisma()
    const listener = new LoggedConfirmationListener(prisma)
    await listener.onEntryCreated(normal)
    const body = prisma._created[0].body as string
    expect(body).toContain('Looking good')
    expect(body).toContain('Logged ✓')
  })

  it('does NOT append positive language for an alert-triggering reading (spec §N7)', async () => {
    // 165/105 — Stage 2 hypertension range, would trigger BP alerts.
    const highBp = { ...BASE_EVENT, systolicBP: 165, diastolicBP: 105 }
    const prisma = fakePrisma()
    const listener = new LoggedConfirmationListener(prisma)
    await listener.onEntryCreated(highBp)
    const body = prisma._created[0].body as string
    expect(body).toContain('Logged ✓')
    expect(body).not.toContain('Looking good')
    expect(body).not.toContain('keep it up')
    // Belt-and-suspenders: no numbers, no mmHg.
    expect(body).not.toContain('165')
    expect(body).not.toContain('105')
  })

  it('does NOT append positive language when BP values are missing', async () => {
    const missing = { ...BASE_EVENT, systolicBP: null, diastolicBP: null }
    const prisma = fakePrisma()
    const listener = new LoggedConfirmationListener(prisma)
    await listener.onEntryCreated(missing)
    expect(prisma._created[0].body).not.toContain('Looking good')
  })

  it('renders Spanish body when the patient prefers es', async () => {
    const prisma = fakePrisma({ user: { preferredLanguage: 'es' } })
    const listener = new LoggedConfirmationListener(prisma)
    const normal = { ...BASE_EVENT, systolicBP: 118, diastolicBP: 76 }
    await listener.onEntryCreated(normal)
    const body = prisma._created[0].body as string
    expect(body).toContain('Registrado')
    expect(body).toContain('Se ve bien')
  })

  it('does not throw when the user lookup returns null', async () => {
    const prisma = fakePrisma({ user: null })
    const listener = new LoggedConfirmationListener(prisma)
    await expect(listener.onEntryCreated(BASE_EVENT)).resolves.toBeUndefined()
    expect(prisma._created[0].body).toContain('Logged')
  })

  it('swallows notification.create failure so the journal write path never derails', async () => {
    const prisma = fakePrisma({ createBehaviour: 'throw' })
    const listener = new LoggedConfirmationListener(prisma)
    await expect(listener.onEntryCreated(BASE_EVENT)).resolves.toBeUndefined()
  })
})
