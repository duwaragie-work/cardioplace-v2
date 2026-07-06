const HEADER = `
  <div style="background: #7B00E0; padding: 24px; text-align: center;">
    <h1 style="color: #ffffff; margin: 0; font-family: sans-serif; font-size: 22px; letter-spacing: 1px;">
      Cardioplace
    </h1>
  </div>
`

// Standardized HIPAA confidentiality footer — applied to every wrap()-based
// template (OTP, welcome, invite, MFA/biometric reset, caregiver update,
// scheduled call, monthly report, contact form, …). HIPAA Minimum Necessary
// §164.502(b) — outbound mail that may carry PHI must carry this notice.
const FOOTER = `
  <div style="padding: 16px 24px; text-align: center; color: #9ca3af; font-size: 12px; font-family: sans-serif; border-top: 1px solid #e5e7eb;">
    This is an automated message from Cardioplace — please do not reply. It may contain protected health information; if you received it in error, please notify the sender and delete it without forwarding or printing.
  </div>
`

function wrap(content: string): string {
  return `
    <div style="max-width: 520px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; font-family: sans-serif;">
      ${HEADER}
      <div style="padding: 24px;">
        ${content}
      </div>
      ${FOOTER}
    </div>
  `
}

export function escalationEmailHtml(
  patientName: string,
  level: string,
  title: string,
  body: string,
  tips: string[],
): string {
  const isLevel2 = level === 'LEVEL_2'
  const badgeBg = isLevel2 ? '#dc2626' : '#f59e0b'
  const badgeLabel = isLevel2 ? 'URGENT' : 'NOTICE'

  const tipsHtml =
    tips.length > 0
      ? `
      <div style="margin-top: 20px; padding: 16px; background: #f5f3ff; border-radius: 8px;">
        <p style="margin: 0 0 8px; font-weight: 600; color: #4c1d95;">Tips for you:</p>
        <ul style="margin: 0; padding-left: 20px; color: #374151;">
          ${tips.map((t) => `<li style="margin-bottom: 6px;">${t}</li>`).join('')}
        </ul>
      </div>
    `
      : ''

  return wrap(`
    <span style="display: inline-block; padding: 4px 12px; border-radius: 4px;
                 background: ${badgeBg}; color: #fff; font-size: 12px; font-weight: 700;
                 letter-spacing: 1px; text-transform: uppercase;">
      ${badgeLabel}
    </span>
    <h2 style="margin: 16px 0 8px; color: #1a1a2e;">${title}</h2>
    <p style="color: #374151; line-height: 1.6;">Hi ${patientName},</p>
    <p style="color: #374151; line-height: 1.6;">${body}</p>
    ${tipsHtml}
  `)
}

// First-touch welcome email sent after the user's permanent DisplayId is
// issued. Tells the patient their Cardioplace ID so they can quote it when
// calling support. Not sent to OTP/magic-link recipients on every sign-in
// — only on first account creation. See
// docs/UNIQUE_IDENTIFIER_PROPOSAL_2026_06_24.md §5.
export function welcomeEmailHtml(
  recipientName: string,
  displayId: string,
  isPatient: boolean,
): string {
  const audienceLine = isPatient
    ? `When you call support or your care team, quote your Cardioplace ID so we can find your account quickly:`
    : `When coordinating with another Cardioplace user, quote your Cardioplace ID so support can find your account quickly:`
  return wrap(`
    <span style="display: inline-block; padding: 4px 12px; border-radius: 4px;
                 background: #7B00E0; color: #fff; font-size: 12px; font-weight: 700;
                 letter-spacing: 1px; text-transform: uppercase;">
      Welcome
    </span>
    <h2 style="margin: 16px 0 8px; color: #1a1a2e;">Welcome to Cardioplace${recipientName ? `, ${recipientName}` : ''}</h2>
    <p style="color: #374151; line-height: 1.6;">${audienceLine}</p>
    <p style="margin: 16px 0; padding: 14px 20px; background: #f5f3ff;
              border: 1px solid #ddd6fe; border-radius: 8px;
              font-family: ui-monospace, SFMono-Regular, monospace;
              font-size: 18px; font-weight: 700; color: #4c1d95;
              letter-spacing: 1px; text-align: center;">
      ${displayId}
    </p>
    <p style="color: #6b7280; line-height: 1.6; font-size: 13px;">
      This ID is permanent and tied to your account. Keep it somewhere handy.
    </p>
  `)
}

// Gap 5 — caregiver alert email. Carries ONLY the signed-off caregiverMessage
// (HIPAA Minimum Necessary): no readings, no other conditions, no diagnosis.
export function caregiverEmailHtml(
  caregiverName: string,
  message: string,
): string {
  return wrap(`
    <span style="display: inline-block; padding: 4px 12px; border-radius: 4px;
                 background: #0d9488; color: #fff; font-size: 12px; font-weight: 700;
                 letter-spacing: 1px; text-transform: uppercase;">
      Caregiver update
    </span>
    <h2 style="margin: 16px 0 8px; color: #1a1a2e;">A health update about someone you care for</h2>
    <p style="color: #374151; line-height: 1.6;">Hi ${caregiverName},</p>
    <p style="color: #374151; line-height: 1.6;">${message}</p>
    <p style="color: #6b7280; line-height: 1.6; font-size: 13px; margin-top: 16px;">
      You're receiving this because the patient asked Cardioplace to share health alerts with you.
    </p>
  `)
}

export function otpEmailHtml(otp: string): string {
  return wrap(`
    <div style="text-align: center;">
      <div style="margin-bottom: 16px;">
        <span style="display: inline-block; width: 56px; height: 56px; line-height: 56px;
                     border-radius: 50%; background: #f3f0ff; font-size: 28px;">
          🔐
        </span>
      </div>
      <h2 style="margin: 0 0 8px; color: #1a1a2e; font-size: 20px;">Your verification code</h2>
      <p style="color: #6b7280; margin: 0 0 20px; font-size: 14px;">Enter this code to verify your identity</p>
      <div style="background: #f5f3ff; border: 2px dashed #7B00E0; border-radius: 12px; padding: 20px; margin: 0 auto; max-width: 280px;">
        <p style="font-size: 36px; font-weight: bold; letter-spacing: 10px;
                   color: #7B00E0; margin: 0; font-family: monospace;">
          ${otp}
        </p>
      </div>
      <p style="color: #374151; margin: 20px 0 8px; font-size: 14px; line-height: 1.6;">
        This code expires in <strong>10 minutes</strong>.
      </p>
      <p style="color: #9ca3af; font-size: 12px; margin: 0;">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  `)
}

export function magicLinkEmailHtml(url: string): string {
  return wrap(`
    <div style="text-align: center;">
      <div style="margin-bottom: 16px;">
        <span style="display: inline-block; width: 56px; height: 56px; line-height: 56px;
                     border-radius: 50%; background: #f3f0ff; font-size: 28px;">
          &#9993;
        </span>
      </div>
      <h2 style="margin: 0 0 8px; color: #1a1a2e; font-size: 20px;">Sign in to Cardioplace</h2>
      <p style="color: #6b7280; margin: 0 0 24px; font-size: 14px;">Tap the button below to sign in securely</p>
      <a href="${url}"
         style="display: inline-block; background: #7B00E0; color: #ffffff; font-size: 16px;
                font-weight: 600; padding: 14px 40px; border-radius: 30px;
                text-decoration: none; letter-spacing: 0.5px;">
        Sign in
      </a>
      <p style="color: #374151; margin: 24px 0 8px; font-size: 14px; line-height: 1.6;">
        This link expires in <strong>30 minutes</strong>.
      </p>
      <p style="color: #9ca3af; font-size: 12px; margin: 0;">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  `)
}

/**
 * Sent when a SUPER_ADMIN / HEALPLACE_OPS resets a provider/admin's
 * authenticator-app (TOTP) MFA (Manisha 2026-06-12 Access Control §6).
 * Placeholder copy — final wording pending Manisha sign-off.
 */
export function mfaResetEmailHtml(name: string | null): string {
  return wrap(`
    <div style="text-align: center;">
      <div style="margin-bottom: 16px;">
        <span style="display: inline-block; width: 56px; height: 56px; line-height: 56px;
                     border-radius: 50%; background: #f3f0ff; font-size: 28px;">
          🔐
        </span>
      </div>
      <h2 style="margin: 0 0 8px; color: #1a1a2e; font-size: 20px;">Your authenticator app was reset</h2>
      <p style="color: #374151; margin: 0 0 16px; font-size: 14px; line-height: 1.6;">
        ${name ? `Hi ${name},` : 'Hello,'} an administrator has reset the
        two-factor authentication (authenticator app) on your Cardioplace account.
        Your old authenticator code and recovery codes no longer work.
      </p>
      <p style="color: #374151; margin: 0 0 16px; font-size: 14px; line-height: 1.6;">
        The next time you sign in, you'll be asked to set up your authenticator
        app again and you'll receive a new set of recovery codes.
      </p>
      <p style="color: #9ca3af; font-size: 12px; margin: 0;">
        If you didn't expect this, contact your administrator right away.
      </p>
    </div>
  `)
}

/**
 * Sent when a SUPER_ADMIN / HEALPLACE_OPS resets a patient's biometric
 * (Face ID / fingerprint / passkey) sign-in. Patient-facing wording — no
 * "authenticator app", since biometric is the patient's second factor.
 * Placeholder copy — final wording pending Manisha sign-off.
 */
export function biometricResetEmailHtml(name: string | null): string {
  return wrap(`
    <div style="text-align: center;">
      <div style="margin-bottom: 16px;">
        <span style="display: inline-block; width: 56px; height: 56px; line-height: 56px;
                     border-radius: 50%; background: #f3f0ff; font-size: 28px;">
          👆
        </span>
      </div>
      <h2 style="margin: 0 0 8px; color: #1a1a2e; font-size: 20px;">Your biometric sign-in was reset</h2>
      <p style="color: #374151; margin: 0 0 16px; font-size: 14px; line-height: 1.6;">
        ${name ? `Hi ${name},` : 'Hello,'} an administrator has removed the
        Face ID / fingerprint sign-in from your Cardioplace account. Your saved
        device can no longer be used to sign in.
      </p>
      <p style="color: #374151; margin: 0 0 16px; font-size: 14px; line-height: 1.6;">
        You can still sign in with the one-time code sent to your email. To use
        Face ID / fingerprint again, just set it up once more from Settings.
      </p>
      <p style="color: #9ca3af; font-size: 12px; margin: 0;">
        If you didn't expect this, contact support right away.
      </p>
    </div>
  `)
}

/**
 * Human-readable label for a UserRole, used in invite/activation emails.
 *
 * Kept loose-typed (string input) so the template stays self-contained
 * — the value-set is small enough that drift between the Prisma enum
 * and this map will get caught at code-review time.
 */
export function roleLabel(role: string): string {
  const map: Record<string, string> = {
    PATIENT: 'Patient',
    PROVIDER: 'Provider',
    MEDICAL_DIRECTOR: 'Medical Director',
    COORDINATOR: 'Practice Coordinator',
    HEALPLACE_OPS: 'Healplace Operations',
    SUPER_ADMIN: 'Super Admin',
  }
  return map[role] ?? role
}

/**
 * Account activation email — sent on user invite. The link in the CTA is
 * a one-time passwordless magic link that creates the User on first click
 * and signs them in.
 *
 * Brand chrome matches magicLinkEmailHtml (same wrap()/header/footer).
 * Wording is v1; Manisha will revise.
 */
export function activationEmailHtml(params: {
  name: string
  role: string
  inviteUrl: string
  expiresAt: Date
  invitedBy: string
}): string {
  const { name, role, inviteUrl, expiresAt, invitedBy } = params
  const label = roleLabel(role)
  const expiresLine =
    `This link expires in 48 hours. If it expires, ask ${invitedBy} ` +
    `to send a new one.`

  return wrap(`
    <div style="text-align: center;">
      <div style="margin-bottom: 16px;">
        <span style="display: inline-block; width: 56px; height: 56px; line-height: 56px;
                     border-radius: 50%; background: #f3f0ff; font-size: 28px;">
          &#9993;
        </span>
      </div>
      <h2 style="margin: 0 0 8px; color: #1a1a2e; font-size: 20px;">You've been invited to Cardioplace</h2>
      <p style="color: #374151; margin: 16px 0 8px; font-size: 15px; line-height: 1.6;">
        Hi ${name},
      </p>
      <p style="color: #374151; margin: 0 0 24px; font-size: 15px; line-height: 1.6;">
        ${invitedBy} has invited you to Cardioplace as a <strong>${label}</strong>.
        Click the button below to set up your account.
      </p>
      <a href="${inviteUrl}"
         style="display: inline-block; background: #7B00E0; color: #ffffff; font-size: 16px;
                font-weight: 600; padding: 14px 40px; border-radius: 30px;
                text-decoration: none; letter-spacing: 0.5px;">
        Activate my account
      </a>
      <p style="color: #374151; margin: 24px 0 8px; font-size: 14px; line-height: 1.6;">
        ${expiresLine}
      </p>
      <p style="color: #9ca3af; font-size: 12px; margin: 8px 0 0;">
        Expires: ${expiresAt.toUTCString()}
      </p>
      <p style="color: #9ca3af; font-size: 12px; margin: 16px 0 0;">
        If you weren't expecting this invitation, you can safely ignore this email.
      </p>
    </div>
  `)
}

export function monthlyReportEmailHtml(params: {
  recipientName: string
  practiceName: string
  monthLabel: string
  totalAlerts: number
  ackInWindowPct: number
  escalatedPct: number
  meanResolveSeconds: number | null
  reportUrl: string
}): string {
  const {
    recipientName,
    practiceName,
    monthLabel,
    totalAlerts,
    ackInWindowPct,
    escalatedPct,
    meanResolveSeconds,
    reportUrl,
  } = params
  const meanResolveLabel =
    meanResolveSeconds === null
      ? '—'
      : `${Math.round(meanResolveSeconds / 60)} min`

  return wrap(`
    <h2 style="margin: 0 0 8px; color: #1a1a2e; font-size: 20px;">
      ${practiceName} — ${monthLabel} report
    </h2>
    <p style="color: #374151; margin: 16px 0; font-size: 15px; line-height: 1.6;">
      Hi ${recipientName},
    </p>
    <p style="color: #374151; margin: 0 0 20px; font-size: 14px; line-height: 1.6;">
      Here's your practice's monthly alert summary. The full report is
      available in the admin app.
    </p>
    <table style="width: 100%; border-collapse: collapse; margin: 0 0 24px;">
      <tr>
        <td style="padding: 12px; background: #f3f0ff; border-radius: 8px; width: 50%; vertical-align: top;">
          <p style="color: #7B00E0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">Total alerts</p>
          <p style="color: #1f2937; font-size: 22px; font-weight: 700; margin: 0;">${totalAlerts}</p>
        </td>
        <td style="width: 12px;"></td>
        <td style="padding: 12px; background: #f3f0ff; border-radius: 8px; width: 50%; vertical-align: top;">
          <p style="color: #7B00E0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">Acked in SLA</p>
          <p style="color: #1f2937; font-size: 22px; font-weight: 700; margin: 0;">${ackInWindowPct}%</p>
        </td>
      </tr>
      <tr><td colspan="3" style="height: 12px;"></td></tr>
      <tr>
        <td style="padding: 12px; background: #f3f0ff; border-radius: 8px; vertical-align: top;">
          <p style="color: #7B00E0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">Escalated</p>
          <p style="color: #1f2937; font-size: 22px; font-weight: 700; margin: 0;">${escalatedPct}%</p>
        </td>
        <td></td>
        <td style="padding: 12px; background: #f3f0ff; border-radius: 8px; vertical-align: top;">
          <p style="color: #7B00E0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">Mean resolve</p>
          <p style="color: #1f2937; font-size: 22px; font-weight: 700; margin: 0;">${meanResolveLabel}</p>
        </td>
      </tr>
    </table>
    <div style="text-align: center;">
      <a href="${reportUrl}"
         style="display: inline-block; background: #7B00E0; color: #ffffff; font-size: 15px;
                font-weight: 600; padding: 12px 32px; border-radius: 30px;
                text-decoration: none;">
        Open full report
      </a>
    </div>
  `)
}

/**
 * Patient self-service permanent-close — step 1: the anti-impulse confirmation
 * link (phase/28). Emailed when the patient requests closure from Settings.
 * The link is the ONLY way to reach permanent-close/confirm and expires in 1h.
 * Brand chrome matches every other Cardioplace email (shared wrap()).
 */
export function selfCloseConfirmEmailHtml(name: string, link: string): string {
  const greeting = name ? `Hi ${name},` : 'Hi,'
  return wrap(`
    <span style="display: inline-block; padding: 4px 12px; border-radius: 4px;
                 background: #dc2626; color: #fff; font-size: 12px; font-weight: 700;
                 letter-spacing: 1px; text-transform: uppercase;">
      Confirm closure
    </span>
    <h2 style="margin: 16px 0 8px; color: #1a1a2e;">Confirm you want to close your account</h2>
    <p style="color: #374151; line-height: 1.6;">${greeting}</p>
    <p style="color: #374151; line-height: 1.6;">
      You asked to <strong>permanently close</strong> your Cardioplace account.
      This cannot be undone. You will lose access to your dashboard and history.
    </p>
    <p style="color: #374151; line-height: 1.6;">If this was you, confirm within the next hour:</p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${link}"
         style="display: inline-block; background: #B91C1C; color: #ffffff; font-size: 16px;
                font-weight: 600; padding: 14px 32px; border-radius: 30px;
                text-decoration: none;">
        Permanently close my account
      </a>
    </div>
    <p style="color: #9ca3af; font-size: 12px; margin: 0;">
      If you did not request this, ignore this email. Your account stays exactly as it is.
      This link expires in 1 hour.
    </p>
  `)
}

/**
 * Patient permanent-close — step 2: the final "your account is closed"
 * confirmation, sent once the closure completes (phase/28). Sent to the address
 * captured BEFORE the User row is anonymised, since close wipes the email.
 */
export function accountClosedEmailHtml(name: string): string {
  const greeting = name ? `Hi ${name},` : 'Hi,'
  return wrap(`
    <span style="display: inline-block; padding: 4px 12px; border-radius: 4px;
                 background: #6b7280; color: #fff; font-size: 12px; font-weight: 700;
                 letter-spacing: 1px; text-transform: uppercase;">
      Account closed
    </span>
    <h2 style="margin: 16px 0 8px; color: #1a1a2e;">Your account has been closed</h2>
    <p style="color: #374151; line-height: 1.6;">${greeting}</p>
    <p style="color: #374151; line-height: 1.6;">
      Your Cardioplace account has been <strong>permanently closed</strong>. You no longer
      have access to your dashboard or history, and this cannot be undone.
    </p>
    <p style="color: #374151; line-height: 1.6;">
      Your medical records are retained securely as the law requires, but your personal
      profile has been removed.
    </p>
    <p style="color: #9ca3af; font-size: 12px; margin: 16px 0 0;">
      If you did not expect this, contact support right away.
    </p>
  `)
}

/** Support System — ops reply to a user's ticket. Wrapped → carries the
 *  standardized HIPAA confidentiality footer like every other outbound email. */
export function supportReplyEmailHtml(
  ticketNumber: string,
  replyBody: string,
): string {
  return wrap(`
    <span style="display: inline-block; padding: 4px 12px; border-radius: 4px;
                 background: #7B00E0; color: #fff; font-size: 12px; font-weight: 700;
                 letter-spacing: 1px; text-transform: uppercase;">
      Support reply
    </span>
    <h2 style="margin: 16px 0 8px; color: #1a1a2e;">A reply to your support request</h2>
    <p style="color: #6b7280; font-size: 13px; margin: 0 0 12px;">Ticket ${ticketNumber}</p>
    <div style="background: #fafafa; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
      <p style="color: #1f2937; font-size: 14px; line-height: 1.7; margin: 0; white-space: pre-wrap;">${replyBody}</p>
    </div>
    <p style="color: #6b7280; font-size: 13px; line-height: 1.6;">
      Reply to this email if you need anything else, and our team will follow up.
    </p>
  `)
}

/** Support System — ticket-resolved confirmation to the requester. Wrapped →
 *  carries the standardized HIPAA confidentiality footer. */
export function supportResolvedEmailHtml(ticketNumber: string): string {
  return wrap(`
    <span style="display: inline-block; padding: 4px 12px; border-radius: 4px;
                 background: #059669; color: #fff; font-size: 12px; font-weight: 700;
                 letter-spacing: 1px; text-transform: uppercase;">
      Resolved
    </span>
    <h2 style="margin: 16px 0 8px; color: #1a1a2e;">Your support request is resolved</h2>
    <p style="color: #6b7280; font-size: 13px; margin: 0 0 12px;">Ticket ${ticketNumber}</p>
    <p style="color: #1f2937; font-size: 14px; line-height: 1.7;">
      Our team has marked this request as resolved. If you still need help, just reply to
      this email and we'll pick it back up.
    </p>
  `)
}

/** Support System — ops "new ticket" notification. Notify-and-link: NO requester
 *  email or message body inlined (mirrors the clinical-alert PHI refactor — the
 *  inbox stays PHI-free; ops opens the dashboard for full, audit-logged context). */
export function supportOpsNotifyHtml(
  ticketNumber: string,
  priority: string,
  category: string,
  dashboardUrl: string,
): string {
  return wrap(`
    <span style="display: inline-block; padding: 4px 12px; border-radius: 4px;
                 background: #7B00E0; color: #fff; font-size: 12px; font-weight: 700;
                 letter-spacing: 1px; text-transform: uppercase;">
      New support ticket
    </span>
    <h2 style="margin: 16px 0 8px; color: #1a1a2e;">A new ${priority} support ticket is waiting</h2>
    <table style="width: 100%; font-size: 14px; color: #374151; margin: 0 0 20px;">
      <tr><td style="padding: 4px 0; font-weight: 600; width: 90px;">Ticket</td><td style="padding: 4px 0;">${ticketNumber}</td></tr>
      <tr><td style="padding: 4px 0; font-weight: 600;">Priority</td><td style="padding: 4px 0;">${priority}</td></tr>
      <tr><td style="padding: 4px 0; font-weight: 600;">Category</td><td style="padding: 4px 0;">${category}</td></tr>
    </table>
    <a href="${dashboardUrl}" style="display: inline-block; padding: 11px 20px; background: #7B00E0; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">View in dashboard →</a>
  `)
}

export function contactFormEmailHtml(
  senderEmail: string,
  message: string,
): string {
  return wrap(`
    <h2 style="color: #1f2937; font-size: 18px; margin: 0 0 16px;">
      New Contact Form Message
    </h2>
    <div style="background: #f3f0ff; border-left: 4px solid #7B00E0; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
      <table style="width: 100%; font-size: 14px; color: #374151;">
        <tr>
          <td style="padding: 6px 0; font-weight: 600; width: 80px; vertical-align: top;">From</td>
          <td style="padding: 6px 0;">
            <a href="mailto:${senderEmail}" style="color: #7B00E0; text-decoration: none;">${senderEmail}</a>
          </td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-weight: 600; vertical-align: top;">Date</td>
          <td style="padding: 6px 0;">${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</td>
        </tr>
      </table>
    </div>
    <div style="background: #fafafa; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
      <p style="color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 8px;">Message</p>
      <p style="color: #1f2937; font-size: 14px; line-height: 1.7; margin: 0; white-space: pre-wrap;">${message}</p>
    </div>
    <p style="color: #9ca3af; font-size: 12px; margin: 0;">
      Reply directly to <a href="mailto:${senderEmail}" style="color: #7B00E0;">${senderEmail}</a> to respond.
    </p>
  `)
}
