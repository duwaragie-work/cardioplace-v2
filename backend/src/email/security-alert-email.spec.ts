import { securityAlertHtml } from './email-templates.js'

/**
 * Coverage for the security-alert email renderer. The identifier is
 * ATTACKER-CONTROLLED — anyone can attempt a sign-in with an arbitrary string,
 * and that string lands in the email body — so HTML-escaping it is a security
 * requirement, not a nicety. These tests would fail loudly if someone dropped
 * the escape.
 */

function make(over: Partial<Parameters<typeof securityAlertHtml>[0]> = {}) {
  return securityAlertHtml({
    identifier: 'bad@example.com',
    failedCount: 7,
    distinctIpCount: 3,
    severity: 'HIGH',
    windowLabel: 'the last 24h',
    dashboardUrl: 'https://admin.test/worklist',
    ...over,
  })
}

describe('securityAlertHtml — content', () => {
  it('renders the identifier, counts, and a worklist link', () => {
    const html = make()
    expect(html).toContain('bad@example.com')
    expect(html).toContain('7') // failedCount
    expect(html).toContain('3') // distinctIpCount
    expect(html).toContain('https://admin.test/worklist')
  })

  it('carries the HIPAA confidentiality footer (goes through wrap())', () => {
    expect(make()).toContain('protected health information')
  })

  it('CRITICAL uses the red badge; HIGH uses amber', () => {
    expect(make({ severity: 'CRITICAL' })).toContain('#b91c1c')
    expect(make({ severity: 'CRITICAL' })).toContain('CRITICAL')
    expect(make({ severity: 'HIGH' })).toContain('#b45309')
  })
})

describe('securityAlertHtml — HTML escaping (injection defense)', () => {
  it('escapes a <script> payload in the identifier — no raw tag survives', () => {
    const html = make({ identifier: '<script>alert(document.cookie)</script>' })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes every HTML-significant character', () => {
    const html = make({ identifier: `a&b<c>d"e'f` })
    expect(html).toContain('a&amp;b&lt;c&gt;d&quot;e&#39;f')
  })

  it('escapes an <img onerror> attribute-injection attempt', () => {
    const html = make({ identifier: '"><img src=x onerror=alert(1)>' })
    expect(html).not.toContain('<img')
    expect(html).not.toContain('onerror=alert(1)>')
    expect(html).toContain('&lt;img')
  })

  it('escapes the severity label too (defense in depth, even though it is internal)', () => {
    const html = make({ severity: '<b>HIGH</b>' })
    expect(html).not.toContain('<b>HIGH</b>')
    expect(html).toContain('&lt;b&gt;HIGH&lt;/b&gt;')
  })

  it('does not double-escape a plain email identifier', () => {
    // A normal identifier must render verbatim (no stray &amp; etc.).
    expect(make({ identifier: 'nurse.jane@clinic.org' })).toContain('nurse.jane@clinic.org')
  })
})
