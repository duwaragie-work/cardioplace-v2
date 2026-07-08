import { jest } from '@jest/globals'
import { EmailService } from './email.service.js'

// Fake ConfigService — only the keys EmailService reads. Mirrors the
// ConfigService.get(key, default?) contract.
function makeConfig(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_USER: 'user@example.com',
    SMTP_PASS: 'secret',
    SMTP_FROM: 'Cardioplace <no-reply@example.com>',
    ...overrides,
  }
  return {
    get: (key: string, def?: string) =>
      key in values ? (values[key] ?? def) : def,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

// Fake ClsService for N6 sender attribution. Returns whatever key/value pairs
// the test seeded. Same shape the access-log extension spec uses.
function makeCls(values: Record<string, unknown> = {}) {
  return {
    get: (key: string) => values[key],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

// Fake PrismaService — only the emailDisclosureLog.create path N6 uses.
function makePrisma() {
  const create = jest.fn<any>().mockResolvedValue({ id: 'edl-1' })
  return {
    prisma: { emailDisclosureLog: { create } },
    createSpy: create,
  }
}

// Convenience factory — builds EmailService with the three DI params N6
// requires (config + cls + prisma). Default disclosure param used in the
// legacy-signature tests below is `null` (explicit non-PHI, no row written).
function makeService(opts?: {
  configOverrides?: Record<string, string | undefined>
  cls?: ReturnType<typeof makeCls>
  prisma?: ReturnType<typeof makePrisma>['prisma']
}) {
  return new EmailService(
    makeConfig(opts?.configOverrides),
    opts?.cls ?? makeCls(),
    opts?.prisma ?? makePrisma().prisma,
  )
}

describe('EmailService (SMTP / nodemailer)', () => {
  it('sends via the transporter with from/to/subject/html', async () => {
    const service = makeService()
    const sendMail = jest.fn<any>().mockResolvedValue({ messageId: 'msg-1' })
    ;(service as unknown as { transporter: { sendMail: typeof sendMail } }).transporter = { sendMail }

    await service.sendEmail('patient@example.com', 'Your code', '<p>123456</p>', null)

    expect(sendMail).toHaveBeenCalledWith({
      from: 'Cardioplace <no-reply@example.com>',
      to: 'patient@example.com',
      subject: 'Your code',
      html: '<p>123456</p>',
    })
  })

  it('falls back to EMAIL_FROM when SMTP_FROM is unset', async () => {
    const service = makeService({
      configOverrides: { SMTP_FROM: undefined, EMAIL_FROM: 'Legacy <legacy@example.com>' },
    })
    const sendMail = jest.fn<any>().mockResolvedValue({ messageId: 'm' })
    ;(service as unknown as { transporter: { sendMail: typeof sendMail } }).transporter = { sendMail }

    await service.sendEmail('p@example.com', 's', 'h', null)

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Legacy <legacy@example.com>' }),
    )
  })

  it('is fire-and-forget — never throws when the transport fails', async () => {
    const service = makeService()
    ;(service as unknown as { transporter: { sendMail: jest.Mock } }).transporter = {
      sendMail: jest.fn<any>().mockRejectedValue(new Error('SMTP down')),
    }

    await expect(
      service.sendEmail('p@example.com', 's', 'h', null),
    ).resolves.toBeUndefined()
  })

  it('onModuleInit verifies the transport without throwing on failure', async () => {
    const service = makeService()
    ;(service as unknown as { transporter: { verify: jest.Mock } }).transporter = {
      verify: jest.fn<any>().mockRejectedValue(new Error('unreachable')),
    }
    await expect(service.onModuleInit()).resolves.toBeUndefined()
  })
})

// ─── N6 — §164.528 email disclosure logging ─────────────────────────────────
describe('EmailService — N6 disclosure logging', () => {
  it('successful send + non-null disclosure → EmailDisclosureLog row written (USER path)', async () => {
    const { prisma, createSpy } = makePrisma()
    const cls = makeCls({ actorId: 'user-abc', actorType: 'USER' })
    const service = makeService({ cls, prisma })
    ;(service as unknown as { transporter: { sendMail: jest.Mock } }).transporter = {
      sendMail: jest.fn<any>().mockResolvedValue({ messageId: 'msg-42' }),
    }

    await service.sendEmail('patient@example.com', 'Welcome', '<p>hi</p>', {
      template: 'welcome',
      templateVersion: '2026-07-10',
      patientUserId: 'user-abc',
      metadata: { source: 'signup' },
    })

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(createSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        senderPrincipal: 'user-abc',
        senderType: 'USER',
        recipientEmail: 'patient@example.com',
        patientUserId: 'user-abc',
        template: 'welcome',
        templateVersion: '2026-07-10',
        subject: 'Welcome',
        metadata: { source: 'signup' },
      }),
    })
  })

  it('cron send resolves senderType=SYSTEM_ACTOR from CLS', async () => {
    const { prisma, createSpy } = makePrisma()
    const cls = makeCls({
      actorId: 'system-principal-escalation-ladder',
      actorType: 'SYSTEM_ACTOR',
    })
    const service = makeService({ cls, prisma })
    ;(service as unknown as { transporter: { sendMail: jest.Mock } }).transporter = {
      sendMail: jest.fn<any>().mockResolvedValue({ messageId: 'msg-cron' }),
    }

    await service.sendEmail('provider@clinic.test', 'Escalation Tier 1', '<p>x</p>', {
      template: 'escalation_tier_1_staff',
      templateVersion: '2026-07-10',
      patientUserId: 'patient-77',
    })

    expect(createSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        senderPrincipal: 'system-principal-escalation-ladder',
        senderType: 'SYSTEM_ACTOR',
        template: 'escalation_tier_1_staff',
        patientUserId: 'patient-77',
      }),
    })
  })

  it('disclosure=null → NO EmailDisclosureLog write, email still sent', async () => {
    const { prisma, createSpy } = makePrisma()
    const cls = makeCls({ actorId: 'user-abc', actorType: 'USER' })
    const service = makeService({ cls, prisma })
    const sendMail = jest.fn<any>().mockResolvedValue({ messageId: 'msg-x' })
    ;(service as unknown as { transporter: { sendMail: typeof sendMail } }).transporter = { sendMail }

    await service.sendEmail('info@healplace.com', 'contact', '<p>msg</p>', null)

    expect(sendMail).toHaveBeenCalledTimes(1) // email was sent
    expect(createSpy).not.toHaveBeenCalled() // no disclosure row written
  })

  it('failed transport → NO EmailDisclosureLog write (auditing a non-delivery would be a lie)', async () => {
    const { prisma, createSpy } = makePrisma()
    const cls = makeCls({ actorId: 'user-abc', actorType: 'USER' })
    const service = makeService({ cls, prisma })
    ;(service as unknown as { transporter: { sendMail: jest.Mock } }).transporter = {
      sendMail: jest.fn<any>().mockRejectedValue(new Error('SMTP down')),
    }

    // sendEmail must still resolve (fire-and-forget contract preserved).
    await expect(
      service.sendEmail('patient@example.com', 'Welcome', '<p>hi</p>', {
        template: 'welcome',
        templateVersion: '2026-07-10',
        patientUserId: 'user-abc',
      }),
    ).resolves.toBeUndefined()

    expect(createSpy).not.toHaveBeenCalled()
  })

  it('unattributed cron (no CLS actorId) → senderPrincipal falls back to placeholder', async () => {
    // Boot-time seeds / ad-hoc scripts fire OUTSIDE any CLS context. Prefer a
    // labelled unknown row over crashing the send.
    const { prisma, createSpy } = makePrisma()
    const cls = makeCls({}) // empty CLS
    const service = makeService({ cls, prisma })
    ;(service as unknown as { transporter: { sendMail: jest.Mock } }).transporter = {
      sendMail: jest.fn<any>().mockResolvedValue({ messageId: 'msg-boot' }),
    }

    await service.sendEmail('anyone@example.com', 's', 'h', {
      template: 'welcome',
      templateVersion: '2026-07-10',
      patientUserId: null,
    })

    expect(createSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        senderPrincipal: 'system-principal-unknown',
        senderType: 'SYSTEM_ACTOR',
      }),
    })
  })
})
