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

describe('EmailService (SMTP / nodemailer)', () => {
  it('sends via the transporter with from/to/subject/html', async () => {
    const service = new EmailService(makeConfig())
    const sendMail = jest.fn<any>().mockResolvedValue({ messageId: 'msg-1' })
    // Swap the real transport for a stub — the constructor builds a real
    // nodemailer transport (no network until send), we just intercept sendMail.
    ;(service as unknown as { transporter: { sendMail: typeof sendMail } }).transporter = { sendMail }

    await service.sendEmail('patient@example.com', 'Your code', '<p>123456</p>')

    expect(sendMail).toHaveBeenCalledWith({
      from: 'Cardioplace <no-reply@example.com>',
      to: 'patient@example.com',
      subject: 'Your code',
      html: '<p>123456</p>',
    })
  })

  it('falls back to EMAIL_FROM when SMTP_FROM is unset', async () => {
    const service = new EmailService(
      makeConfig({ SMTP_FROM: undefined, EMAIL_FROM: 'Legacy <legacy@example.com>' }),
    )
    const sendMail = jest.fn<any>().mockResolvedValue({ messageId: 'm' })
    ;(service as unknown as { transporter: { sendMail: typeof sendMail } }).transporter = { sendMail }

    await service.sendEmail('p@example.com', 's', 'h')

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Legacy <legacy@example.com>' }),
    )
  })

  it('is fire-and-forget — never throws when the transport fails', async () => {
    const service = new EmailService(makeConfig())
    ;(service as unknown as { transporter: { sendMail: jest.Mock } }).transporter = {
      sendMail: jest.fn<any>().mockRejectedValue(new Error('SMTP down')),
    }

    await expect(
      service.sendEmail('p@example.com', 's', 'h'),
    ).resolves.toBeUndefined()
  })

  it('onModuleInit verifies the transport without throwing on failure', async () => {
    const service = new EmailService(makeConfig())
    ;(service as unknown as { transporter: { verify: jest.Mock } }).transporter = {
      verify: jest.fn<any>().mockRejectedValue(new Error('unreachable')),
    }
    await expect(service.onModuleInit()).resolves.toBeUndefined()
  })
})
