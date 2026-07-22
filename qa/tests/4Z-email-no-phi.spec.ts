import { test, expect } from '@playwright/test'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * HIPAA email-no-PHI lock-in (sprint 4Z). Provider / MD / Ops escalation
 * emails were refactored to a "notify-and-link" body (Minimum Necessary
 * §164.502(b)) — no patient PHI, just the tier + a dashboard deep-link. The
 * authoritative guard is the backend unit test (escalation.service.spec.ts);
 * this e2e proves the same over the real dispatch path.
 *
 * CI SMTP is a dummy that never delivers, so we read what WOULD be sent from
 * EmailService's in-memory capture buffer via /test-control/emails, filtered
 * to our own alert's dashboard link so parallel workers don't cross-talk.
 */
test.describe('4Z — provider escalation emails carry no patient PHI', () => {
  test('Tier-1 provider email has no name / email / DOB / BP; has the HIPAA footer + dashboard link', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    try {
      const patient = PATIENTS.priya // pregnant + ACE → Tier 1 contraindication
      const u = await tc.findUser(patient.email)
      await tc.resetUser(u.id)
      await tc.setEnrollment(u.id, 'ENROLLED') // Layer B — dispatch requires enrolled

      const { alertIds } = await tc.seedAlerts(u.id, [
        {
          tier: 'TIER_1_CONTRAINDICATION',
          status: 'OPEN',
          ruleId: patient.expectedRuleId ?? 'RULE_PREGNANCY_ACE_ARB',
        },
      ])
      const alertId = alertIds[0]

      await tc.clearCapturedEmails()
      await tc.fireEscalationT0(alertId)

      // Only our alert's emails (the dashboard link carries the alertId).
      const captured = await tc.getCapturedEmails()
      const mine = captured.filter((e) => e.html.includes(`alert=${alertId}`))
      // Provider/MD/Ops emails use the "[Cardioplace] …" subject; the patient
      // mirror (if any) uses a friendly subject and is allowed to carry the
      // patient's own data.
      const providerEmails = mine.filter((e) =>
        e.subject.startsWith('[Cardioplace] '),
      )
      expect(providerEmails.length).toBeGreaterThan(0)

      for (const email of providerEmails) {
        const combined = `${email.subject}\n${email.html}`
        // Minimum Necessary — none of the patient PHI may appear.
        expect(combined).not.toContain(patient.name) // 'Priya Menon'
        expect(combined).not.toContain(patient.email) // patient email
        expect(combined).not.toMatch(/DOB/i)
        expect(combined).not.toMatch(/\bpulse\b/i)
        expect(combined).not.toMatch(/\d{2,3}\/\d{2,3}\s*mmHg/i) // BP reading
        // Subject carries no patient identifier.
        expect(email.subject).not.toContain(patient.name)
        // Keeps — the HIPAA confidentiality footer + a dashboard deep-link.
        expect(email.html).toContain('protected health information')
        // The deep-link carries ONLY the opaque alert id; the admin shell
        // resolves the patient from it server-side. This assertion used to
        // require `?id=<patientUserId>&alert=…`, i.e. it demanded the very
        // identifier this spec exists to keep out of the email.
        expect(email.html).toContain(`/patients/detail?alert=${alertId}`)
        expect(email.html).not.toContain(u.id)
      }

      await tc.resetUser(u.id)
    } finally {
      await tc.dispose()
    }
  })
})
