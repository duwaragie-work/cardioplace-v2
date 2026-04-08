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
