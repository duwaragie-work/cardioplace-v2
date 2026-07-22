import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  EMAIL_TEMPLATE_REGISTRY,
  computeBriefDescription,
  resolveTemplateSpec,
} from './email-templates.registry.js'
import type { EmailTemplateName } from './email-templates.registry.js'

// N6 extension — the registry is the single source of truth for §164.528
// purpose + recipientCategory + briefDescription. Drift between the union
// and the registry object is a compile error (Record<Union, TemplateSpec>),
// but this spec catches runtime + Minimum-Necessary regressions.

const ALL_TEMPLATES: EmailTemplateName[] = [
  'welcome',
  'otp',
  'magic_link',
  'mfa_reset',
  'biometric_reset',
  'invite_activation',
  'account_closed',
  'self_close_confirm',
  'emergency_dispatch_caregiver',
  'caregiver_alert',
  'escalation_tier_1_staff',
  'escalation_tier_2_staff',
  'escalation_tier_3_staff',
  'support_reply',
  'support_resolved',
  'support_ops_notify',
  'support_ticket_received',
  'support_awaiting_reply',
  'contact_form',
  'gap_alert',
  'medication_reask',
  'daily_reminder',
  'care_team_gap_alert',
  'monthly_report',
  'security_alert',
]

describe('EMAIL_TEMPLATE_REGISTRY — N6 extension', () => {
  it('has an entry for every EmailTemplateName union member', () => {
    // Registry-object exhaustiveness is enforced at compile via
    // `Record<EmailTemplateName, TemplateSpec>`, but a runtime keys check
    // guards against a union member added with `as EmailTemplateName` cast.
    const keys = Object.keys(EMAIL_TEMPLATE_REGISTRY).sort()
    expect(keys.length).toBe(ALL_TEMPLATES.length)
    expect(keys).toEqual([...ALL_TEMPLATES].sort())
  })

  it.each(ALL_TEMPLATES)(
    '"%s" — briefDescriptionFn handles empty metadata without throwing',
    (name) => {
      // Missing-metadata resilience: even if a call site forgets to pass the
      // template's expected fields, the disclosure row must still land with
      // a defensible description string. Never crash the send.
      const spec = resolveTemplateSpec(name)
      const out = spec.briefDescriptionFn({})
      expect(typeof out).toBe('string')
      expect(out.length).toBeGreaterThan(0)
      expect(out.length).toBeLessThanOrEqual(200)
    },
  )

  it.each(ALL_TEMPLATES)(
    '"%s" — briefDescription stays ≤200 chars for verbose metadata',
    (name) => {
      // A caller may pass a large metadata blob (retry data, extended alert
      // context). The brief description must remain terse — the disclosure
      // trail is scannable, not a diagnostic dump.
      const verboseMeta = {
        alertId: 'a-'.padEnd(120, 'x'),
        ruleId: 'r-'.padEnd(120, 'x'),
        role: 'MEDICAL_DIRECTOR',
        ladderStep: 'T4H',
        caregiverId: 'c-'.padEnd(120, 'x'),
        ticketNumber: 'T-'.padEnd(120, 'x'),
        ticketId: 't-'.padEnd(120, 'x'),
        category: 'CATEGORY_'.padEnd(120, 'x'),
        priority: 'HIGH',
        practiceId: 'p-'.padEnd(120, 'x'),
        monthYear: '2026-06',
        monthLabel: 'June 2026',
        totalAlerts: 999,
        escalatedPct: 25,
        ackInWindowPct: 90,
        gapHours: 48,
        role_x: 'irrelevant',
      }
      const out = computeBriefDescription(name, verboseMeta)
      expect(out.length).toBeLessThanOrEqual(200)
    },
  )

  it('computeBriefDescription falls back gracefully when the fn throws', () => {
    // Contract: no template's briefDescriptionFn should ever crash a send.
    // If one does, computeBriefDescription must return a labelled fallback so
    // the row still writes.
    // Force a throw by monkey-patching a registry entry for the duration of
    // this test only, then restore.
    const originalFn = EMAIL_TEMPLATE_REGISTRY.welcome.briefDescriptionFn
    ;(
      EMAIL_TEMPLATE_REGISTRY.welcome as { briefDescriptionFn: unknown }
    ).briefDescriptionFn = () => {
      throw new Error('boom')
    }
    try {
      const out = computeBriefDescription('welcome', {})
      expect(out).toContain('welcome')
      expect(out.toLowerCase()).toContain('failed')
    } finally {
      ;(
        EMAIL_TEMPLATE_REGISTRY.welcome as { briefDescriptionFn: unknown }
      ).briefDescriptionFn = originalFn
    }
  })

  it('registry source does not embed patient-identifying tokens in briefDescriptionFn bodies', () => {
    // Static-drift guard: brief descriptions live in the §164.528 trail. If a
    // future edit ever weaves patient name / DOB / phone / address into the
    // fn body, it must be caught at review — the trail must NEVER duplicate
    // PHI (Minimum Necessary §164.502(b)). Numeric clinical values (BP,
    // alertId) are fine; the token list below is deliberately conservative.
    const path = resolve(
      dirname(fileURLToPath(import.meta.url)),
      'email-templates.registry.ts',
    )
    const src = readFileSync(path, 'utf8')

    // Strip block + line comments so doc examples ("NEVER include patient
    // name") don't trip the guard. The scan is against runtime fn bodies.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')

    const FORBIDDEN = [
      /patientName/i,
      /firstName/i,
      /lastName/i,
      /dateOfBirth/i,
      /\bdob\b/i,
      /phoneNumber/i,
      /streetAddress/i,
      /homeAddress/i,
    ]
    for (const re of FORBIDDEN) {
      expect(stripped).not.toMatch(re)
    }
  })

  it('every entry declares a §164.528 purpose from the permitted-use taxonomy', () => {
    const ALLOWED = new Set([
      'TREATMENT',
      'PAYMENT',
      'HEALTHCARE_OPERATIONS',
      'DIRECT_TO_PATIENT',
      'PATIENT_AUTHORIZED',
      'CARE_COORDINATION',
      'REQUIRED_BY_LAW',
      'OTHER',
    ])
    for (const name of ALL_TEMPLATES) {
      const spec = resolveTemplateSpec(name)
      expect(ALLOWED.has(spec.purpose)).toBe(true)
    }
  })

  it('every entry declares a structured recipientCategory bucket', () => {
    const ALLOWED = new Set([
      'PATIENT',
      'CAREGIVER',
      'PROVIDER',
      'MEDICAL_DIRECTOR',
      'COORDINATOR',
      'HEALPLACE_OPS',
      'SUPER_ADMIN',
      'EXTERNAL_UNKNOWN',
      'SYSTEM',
    ])
    for (const name of ALL_TEMPLATES) {
      const spec = resolveTemplateSpec(name)
      expect(ALLOWED.has(spec.recipientCategory)).toBe(true)
    }
  })

  it('resolveTemplateSpec throws for a synthetic unknown name (union/registry drift guard)', () => {
    expect(() =>
      resolveTemplateSpec('nonexistent_template' as EmailTemplateName),
    ).toThrow(/missing entry/)
  })
})
