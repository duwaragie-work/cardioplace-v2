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

  // ── N6 extension (2026-07-11) — §164.528 + §164.312(c) explicit fields ──
  //
  // Verifies the registry-driven derivation of purpose + recipientCategory +
  // briefDescription, plus SHA-256 bodyHash + CLS-carried practice context.

  it('N6-ext — registry derives purpose + recipientCategory from template name', async () => {
    // Neither field is passed by the call site — both come from the central
    // EMAIL_TEMPLATE_REGISTRY entry keyed by the typed `template` name.
    const { prisma, createSpy } = makePrisma()
    const cls = makeCls({
      actorId: 'system-principal-escalation-ladder',
      actorType: 'SYSTEM_ACTOR',
    })
    const service = makeService({ cls, prisma })
    ;(service as unknown as { transporter: { sendMail: jest.Mock } }).transporter = {
      sendMail: jest.fn<any>().mockResolvedValue({ messageId: 'msg-1' }),
    }

    await service.sendEmail(
      'provider@clinic.test',
      'Escalation Tier 1',
      '<p>x</p>',
      {
        template: 'escalation_tier_1_staff',
        templateVersion: '2026-07-10',
        patientUserId: 'patient-77',
        metadata: {
          alertId: 'a-1',
          ruleId: 'RULE_BP_L1_HIGH',
          role: 'PRIMARY_PROVIDER',
          ladderStep: 'T0',
        },
      },
    )

    expect(createSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        purpose: 'TREATMENT',
        recipientCategory: 'PROVIDER',
        template: 'escalation_tier_1_staff',
      }),
    })
  })

  it('N6-ext — briefDescription is derived from template registry + metadata', async () => {
    // Escalation registry entry weaves alertId + ruleId + role + step into a
    // structured description. Never contains patient name or narrative — the
    // registry spec enforces that separately.
    const { prisma, createSpy } = makePrisma()
    const cls = makeCls({ actorId: 'u1', actorType: 'USER' })
    const service = makeService({ cls, prisma })
    ;(service as unknown as { transporter: { sendMail: jest.Mock } }).transporter = {
      sendMail: jest.fn<any>().mockResolvedValue({ messageId: 'msg-brief' }),
    }

    await service.sendEmail('provider@clinic.test', 'Escalation', '<p>x</p>', {
      template: 'escalation_tier_1_staff',
      templateVersion: '2026-07-10',
      patientUserId: 'p-1',
      metadata: {
        alertId: 'a-42',
        ruleId: 'RULE_BP_L1_HIGH',
        role: 'MEDICAL_DIRECTOR',
        ladderStep: 'T4H',
      },
    })

    const call = createSpy.mock.calls[0][0] as { data: { briefDescription: string } }
    expect(call.data.briefDescription).toContain('Tier 1 escalation dispatch')
    expect(call.data.briefDescription).toContain('a-42')
    expect(call.data.briefDescription).toContain('RULE_BP_L1_HIGH')
    expect(call.data.briefDescription).toContain('MEDICAL_DIRECTOR')
    expect(call.data.briefDescription).toContain('T4H')
    expect(call.data.briefDescription.length).toBeLessThanOrEqual(200)
  })

  it('N6-ext — bodyHash is a deterministic 64-char SHA-256 of the html body', async () => {
    // Integrity proof per §164.312(c): same html → same 64-char hex hash;
    // different html → different hash. No raw body stored (Minimum Necessary).
    const { prisma, createSpy } = makePrisma()
    const cls = makeCls({ actorId: 'u1', actorType: 'USER' })
    const service = makeService({ cls, prisma })
    ;(service as unknown as { transporter: { sendMail: jest.Mock } }).transporter = {
      sendMail: jest.fn<any>().mockResolvedValue({ messageId: 'msg-hash' }),
    }

    await service.sendEmail('a@example.com', 's', '<p>same body</p>', {
      template: 'welcome',
      templateVersion: '2026-07-10',
      patientUserId: 'u1',
    })
    await service.sendEmail('b@example.com', 's', '<p>same body</p>', {
      template: 'welcome',
      templateVersion: '2026-07-10',
      patientUserId: 'u2',
    })
    await service.sendEmail('c@example.com', 's', '<p>DIFFERENT body</p>', {
      template: 'welcome',
      templateVersion: '2026-07-10',
      patientUserId: 'u3',
    })

    const rows = createSpy.mock.calls.map(
      (c) => (c[0] as { data: { bodyHash: string } }).data.bodyHash,
    )
    expect(rows[0]).toMatch(/^[0-9a-f]{64}$/)
    expect(rows[1]).toBe(rows[0]) // same html → same hash
    expect(rows[2]).not.toBe(rows[0]) // different html → different hash
    expect(rows[2]).toMatch(/^[0-9a-f]{64}$/)
  })

  it('N6-ext — senderPracticeContext is threaded from CLS activePracticeId', async () => {
    // Multi-practice attribution — reads whatever the CLS carries at send
    // time. Nullable — SYSTEM_ACTOR / boot sends have no practice context.
    const { prisma, createSpy } = makePrisma()
    const cls = makeCls({
      actorId: 'u1',
      actorType: 'USER',
      activePracticeId: 'practice-cedar-hill',
    })
    const service = makeService({ cls, prisma })
    ;(service as unknown as { transporter: { sendMail: jest.Mock } }).transporter = {
      sendMail: jest.fn<any>().mockResolvedValue({ messageId: 'msg-p' }),
    }

    await service.sendEmail('provider@clinic.test', 's', '<p>h</p>', {
      template: 'monthly_report',
      templateVersion: '2026-07-10',
      patientUserId: null,
      metadata: { practiceId: 'practice-cedar-hill', monthYear: '2026-06' },
    })

    expect(createSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        senderPracticeContext: 'practice-cedar-hill',
        purpose: 'HEALTHCARE_OPERATIONS',
        recipientCategory: 'MEDICAL_DIRECTOR',
      }),
    })
  })

  it('N6-ext — recipientCategoryOverride wins over the registry default', async () => {
    // A template like escalation_tier_1_staff defaults to PROVIDER, but the
    // ladder can dispatch it to a PATIENT (email channel). The call site
    // overrides so the disclosure trail records the right recipient bucket.
    const { prisma, createSpy } = makePrisma()
    const cls = makeCls({
      actorId: 'system-principal-escalation-ladder',
      actorType: 'SYSTEM_ACTOR',
    })
    const service = makeService({ cls, prisma })
    ;(service as unknown as { transporter: { sendMail: jest.Mock } }).transporter = {
      sendMail: jest.fn<any>().mockResolvedValue({ messageId: 'msg-ov' }),
    }

    await service.sendEmail('patient@example.com', 's', '<p>h</p>', {
      template: 'escalation_tier_1_staff',
      templateVersion: '2026-07-10',
      patientUserId: 'p-1',
      recipientCategoryOverride: 'PATIENT',
    })

    expect(createSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipientCategory: 'PATIENT',
      }),
    })
  })
})
