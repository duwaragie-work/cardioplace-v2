const HEADER = `
  <div style="background: #7B00E0; padding: 24px; text-align: center;">
    <h1 style="color: #ffffff; margin: 0; font-family: sans-serif; font-size: 22px; letter-spacing: 1px;">
      Cardioplace
    </h1>
  </div>
`

const FOOTER = `
  <div style="padding: 16px 24px; text-align: center; color: #9ca3af; font-size: 12px; font-family: sans-serif; border-top: 1px solid #e5e7eb;">
    This is an automated alert from Cardioplace. Do not reply to this email.
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

export function scheduleCallEmailHtml(
  patientName: string,
  callType: string,
  callDate: string,
  callTime: string,
): string {
  const typeLabel = callType === 'video' ? 'Video Call' : 'Phone Call'

  return wrap(`
    <h2 style="margin: 0 0 12px; color: #1a1a2e;">Your care team has scheduled a follow-up call</h2>
    <p style="color: #374151; line-height: 1.6;">Hi ${patientName},</p>
    <div style="margin: 20px 0; padding: 16px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
      <table style="width: 100%; font-size: 15px; color: #374151;">
        <tr>
          <td style="padding: 6px 0; font-weight: 600; width: 80px;">Type</td>
          <td style="padding: 6px 0;">${typeLabel}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-weight: 600;">Date</td>
          <td style="padding: 6px 0;">${callDate}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-weight: 600;">Time</td>
          <td style="padding: 6px 0;">${callTime} (EST)</td>
        </tr>
      </table>
    </div>
    <p style="color: #374151; line-height: 1.6;">
      Your care team will contact you at the number on file.
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
