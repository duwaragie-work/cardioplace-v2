import { createHash } from 'node:crypto'
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ClsService } from 'nestjs-cls'
import nodemailer, { type Transporter } from 'nodemailer'
import { writeAuditWithRetry } from '../common/audit/write-with-retry.js'
import { redactEmail } from '../common/logging/log-redact.js'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  type EmailTemplateName,
  type RecipientCategoryName,
  computeBriefDescription,
  resolveTemplateSpec,
} from './email-templates.registry.js'

/** A captured outbound email (test-only in-memory sink — see below). */
export interface CapturedEmail {
  to: string
  subject: string
  html: string
  sentAt: string
}

/**
 * N6 (2026-07-10) — §164.528 accounting-of-disclosures context. Every send
 * that IS an ePHI disclosure event carries one of these; callers that are
 * confirmed non-PHI (e.g. anonymous contact-form → info@healplace.com) pass
 * `null` explicitly so the classification is visible at the call site.
 */
export interface EmailDisclosureContext {
  /**
   * Canonical template identifier. Typed as `EmailTemplateName` (union) so
   * TypeScript rejects typos at compile time — the whole disclosure trail is
   * typo-proof, and `purpose` + `recipientCategory` + `briefDescription` are
   * derived from this via the central registry.
   */
  template: EmailTemplateName
  /** Pass `EMAIL_TEMPLATE_VERSION` from `email-templates.ts` at every call site. */
  templateVersion: string
  /** Patient the disclosure is about. NULL for aggregate/practice-wide sends. */
  patientUserId?: string | null
  /** Optional template-specific payload (alertId, escalationStep, ticketId, ...). */
  metadata?: Record<string, unknown>
  /**
   * Override the recipientCategory the registry infers from the template.
   * Most templates have a fixed recipient bucket, but a few (e.g. escalation
   * emails whose recipient depends on the ladder role, or emergency-dispatch
   * variants that can go to caregiver OR ops fallback) need call-site
   * disambiguation. When absent, the registry default is used.
   */
  recipientCategoryOverride?: RecipientCategoryName
}

/**
 * Two transports, picked at boot:
 *   • RESEND_API_KEY set → send over Resend's HTTPS API (port 443). Required on
 *     hosts that block outbound SMTP (Railway Hobby blocks ports 25/465/587 with
 *     no override), so raw SMTP times out there. The sender domain must be
 *     verified in the Resend account or Resend rejects the send.
 *   • otherwise → nodemailer SMTP (local dev / any host that allows SMTP egress).
 * The selection is implicit (key present → Resend) so prod sets the key and
 * local keeps using SMTP unchanged.
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name)
  private readonly transporter: Transporter | null
  private readonly resendApiKey: string | undefined
  private readonly from: string

  // ── Test-only email capture ─────────────────────────────────────────────
  // In non-production (dev / test / CI) the rendered email is pushed to an
  // in-memory ring buffer so a Playwright / e2e spec can read what WOULD be
  // sent — CI SMTP is a dummy that never delivers, so specs cannot read a real
  // inbox. Never enabled in production. Exposed read-only via test-control.
  private static readonly CAPTURE_MAX = 100
  private static captured: CapturedEmail[] = []
  private readonly captureEnabled: boolean

  static getCapturedEmails(to?: string): CapturedEmail[] {
    return to
      ? EmailService.captured.filter((e) => e.to === to)
      : [...EmailService.captured]
  }
  static clearCapturedEmails(): void {
    EmailService.captured = []
  }

  constructor(
    private readonly config: ConfigService,
    // N6 — CLS supplies the sender-principal attribution (actorId + actorType)
    // that goes into every EmailDisclosureLog row. Same pattern the AccessLog
    // extension uses. ClsModule is @Global so no import registration needed.
    private readonly cls: ClsService,
    // N6 — direct Prisma access for the disclosure-log write. The write is
    // wrapped in writeAuditWithRetry (N1) so a Prisma error becomes a loud
    // OTEL span + structured JSON, not a silent dropped disclosure row.
    private readonly prisma: PrismaService,
  ) {
    this.captureEnabled =
      this.config.get<string>('EMAIL_CAPTURE') === '1' ||
      this.config.get<string>('NODE_ENV') !== 'production'
    this.resendApiKey = this.config.get<string>('RESEND_API_KEY') || undefined

    // SMTP_FROM is the canonical sender; fall back to the legacy EMAIL_FROM for
    // back-compat. NOTE: the address must be one the transport is authorised to
    // send as — the authenticated SMTP user/alias, OR a Resend-verified domain —
    // or the message is rejected / rewritten.
    this.from =
      this.config.get<string>('SMTP_FROM') ??
      this.config.get<string>('EMAIL_FROM', 'Cardioplace <no-reply@cardioplace.ai>')

    if (this.resendApiKey) {
      // HTTP transport — no SMTP socket needed.
      this.transporter = null
    } else {
      const host = this.config.get<string>('SMTP_HOST')
      const port = Number(this.config.get<string>('SMTP_PORT', '587'))
      const user = this.config.get<string>('SMTP_USER')
      const pass = this.config.get<string>('SMTP_PASS')

      this.transporter = nodemailer.createTransport({
        host,
        port,
        // 465 → implicit TLS; 587 (and others) → STARTTLS, which nodemailer
        // negotiates automatically.
        secure: port === 465,
        auth: user ? { user, pass } : undefined,
      })
    }
  }

  // Non-fatal reachability check at boot so a misconfigured transport surfaces
  // in the logs immediately instead of on the first send. Never throws — the app
  // must still start even if the mail server is briefly unreachable.
  async onModuleInit(): Promise<void> {
    if (this.resendApiKey) {
      this.logger.log('Email transport: Resend HTTPS API (RESEND_API_KEY set)')
      return
    }
    try {
      await this.transporter!.verify()
      this.logger.log('Email transport: SMTP — verified, ready to send')
    } catch (error) {
      this.logger.warn(
        `SMTP transport verify failed (emails may not send): ${
          error instanceof Error ? error.message : error
        }`,
      )
    }
  }

  // Fire-and-forget: callers (OTP, welcome, escalation, …) `void`-dispatch this
  // and rely on it never throwing. Failures are logged, not propagated.
  //
  // N6 (2026-07-10) — the fourth argument is REQUIRED. Every call site must
  // decide: PHI-adjacent disclosure event, or explicit non-PHI? Passing
  // `null` is a deliberate classification, not an omission — reviewers see
  // the null at the call site and know it was reasoned through. A successful
  // delivery + non-null disclosure writes one EmailDisclosureLog row for the
  // §164.528 accounting-of-disclosures trail; failed deliveries write no row
  // (auditing an email that didn't leave the building would be a lie).
  async sendEmail(
    to: string,
    subject: string,
    html: string,
    disclosure: EmailDisclosureContext | null,
  ): Promise<void> {
    if (this.captureEnabled) {
      EmailService.captured.push({
        to,
        subject,
        html,
        sentAt: new Date().toISOString(),
      })
      if (EmailService.captured.length > EmailService.CAPTURE_MAX) {
        EmailService.captured.splice(
          0,
          EmailService.captured.length - EmailService.CAPTURE_MAX,
        )
      }
    }

    const delivered = await this._deliver(to, subject, html)
    if (delivered && disclosure) {
      await this._writeDisclosure(to, subject, html, disclosure)
    }
  }

  // Extracted transport branch. Returns true iff Resend or nodemailer resolved
  // without throwing — the signal N6 uses to decide whether a disclosure row
  // gets written. `no transport configured` returns false (nothing shipped).
  private async _deliver(to: string, subject: string, html: string): Promise<boolean> {
    try {
      if (this.resendApiKey) {
        await this.sendViaResend(to, subject, html)
        return true
      }
      if (this.transporter) {
        const info = await this.transporter.sendMail({
          from: this.from,
          to,
          subject,
          html,
        })
        // V-05 sweep — `to` can be a patient/caregiver address and `subject` a
        // clinical event ("Urgent Blood Pressure Alert"); the pair identifies a
        // patient's condition. Hash the recipient so ops keep "same recipient?"
        // correlation without the address. Subject kept: it's a static template
        // label, and with the recipient hashed it no longer names anyone.
        this.logger.log(
          `Email sent to ${redactEmail(to)} — id: ${info.messageId} — subject: ${subject}`,
        )
        return true
      }
      this.logger.error(`Email failed for ${redactEmail(to)}: no transport configured`)
      return false
    } catch (error) {
      this.logger.error(
        `Email failed for ${redactEmail(to)}`,
        error instanceof Error ? error.message : error,
      )
      return false
    }
  }

  // §164.528 disclosure-log write path. Reads sender attribution from CLS
  // (same actorId/actorType shape AccessLog uses). Wrapped in
  // writeAuditWithRetry so a Prisma failure emits a loud audit.write.failed
  // OTEL span + structured JSON instead of a silent dropped row. Never
  // rethrows — the email already went out; disclosure-write failures are
  // observability signals, not user-facing errors.
  private async _writeDisclosure(
    recipientEmail: string,
    subject: string,
    html: string,
    disclosure: EmailDisclosureContext,
  ): Promise<void> {
    const actorId = this.cls.get<string | null>('actorId') ?? null
    const actorType: 'USER' | 'SYSTEM_ACTOR' =
      (this.cls.get<'USER' | 'SYSTEM_ACTOR' | null>('actorType') ?? null) ??
      (actorId ? 'USER' : 'SYSTEM_ACTOR')
    // Fallback when a send fires outside any request/cron CLS context
    // (boot-time scripts, ad-hoc tooling). Prefer a placeholder over crashing
    // the send — a labelled unknown row is more useful than no row at all.
    const senderPrincipal = actorId ?? 'system-principal-unknown'

    // N6 extension — registry-driven classification. Pulls purpose +
    // recipientCategory + briefDescription from a central source so every
    // template's disclosure trail is consistent across all call sites.
    const spec = resolveTemplateSpec(disclosure.template)
    const purpose = spec.purpose
    const recipientCategory =
      disclosure.recipientCategoryOverride ?? spec.recipientCategory
    const briefDescription = computeBriefDescription(
      disclosure.template,
      disclosure.metadata,
    )
    // §164.312(c) integrity fingerprint. Storing the hash instead of the html
    // body proves what content went out without doubling the PHI-at-rest
    // footprint (Minimum Necessary — §164.502(b)).
    const bodyHash = createHash('sha256').update(html).digest('hex')
    // Multi-practice attribution — CLS carries activePracticeId for USER
    // paths; SYSTEM_ACTOR / boot-time sends leave it null.
    const senderPracticeContext =
      this.cls.get<string | null>('activePracticeId') ?? null

    await writeAuditWithRetry(
      () =>
        this.prisma.emailDisclosureLog.create({
          data: {
            senderPrincipal,
            senderType: actorType,
            senderPracticeContext,
            recipientEmail,
            recipientCategory,
            patientUserId: disclosure.patientUserId ?? null,
            template: disclosure.template,
            templateVersion: disclosure.templateVersion,
            purpose,
            briefDescription,
            bodyHash,
            subject,
            metadata:
              disclosure.metadata !== undefined
                ? (disclosure.metadata as object)
                : undefined,
          },
        }),
      {
        kind: 'email-disclosure-log',
        template: disclosure.template,
        templateVersion: disclosure.templateVersion,
        patientUserId: disclosure.patientUserId ?? null,
        recipientEmail,
        purpose,
        recipientCategory,
      },
    )
  }

  // Resend HTTPS API — works on hosts that block outbound SMTP. Uses global
  // fetch (Node 18+); no SDK dependency. Throws on a non-2xx so the caller's
  // catch logs it (callers stay fire-and-forget).
  private async sendViaResend(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: this.from, to, subject, html }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`)
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string }
    this.logger.log(
      `Email sent to ${redactEmail(to)} via Resend — id: ${data.id ?? '?'} — subject: ${subject}`,
    )
  }
}
