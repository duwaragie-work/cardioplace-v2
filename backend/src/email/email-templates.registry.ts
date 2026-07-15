// N6 extension (2026-07-11) — central classification for every outbound
// email template. One entry per `EmailTemplateName` — the registry is the
// single source of truth for a template's:
//
//   • §164.528 purpose (TREATMENT / HEALTHCARE_OPERATIONS / DIRECT_TO_PATIENT …)
//   • Recipient bucket (PATIENT / PROVIDER / CAREGIVER …)
//   • Brief-description generator (structured summary of what was disclosed)
//
// Design rationale — why a central registry instead of typing purpose +
// recipientCategory at every call site:
//   1. Classification consistency — the same template cannot be classified
//      two different ways at two call sites. Regulator-facing rollups depend
//      on this.
//   2. Typo protection — `EmailDisclosureContext.template: EmailTemplateName`
//      (union, not `string`) causes TypeScript to reject `'welocme'` at
//      compile time; the whole disclosure trail becomes typo-proof.
//   3. Minimum Necessary — brief-description generation lives in one place,
//      auditable in a single review to guarantee no template's summary ever
//      duplicates PHI (patient name, DOB, narrative). Numeric clinical
//      values (BP, alert tier) and enum values (rule id) are fine.
//
// If a new email is added to the system, the developer MUST:
//   1. Add its identifier to `EmailTemplateName` below.
//   2. Add its entry to `EMAIL_TEMPLATE_REGISTRY` — TypeScript will fail
//      compilation until this is done (Record<Union, …> exhaustiveness).
//   3. Pick the correct purpose + recipientCategory from HIPAA §164.502.
//   4. Write a briefDescriptionFn that structures the disclosure summary
//      WITHOUT ever including patient name / DOB / narrative content.

/**
 * Every outbound-email template we ship. Add here first; TypeScript will
 * refuse to compile until you also add the matching registry entry below.
 */
export type EmailTemplateName =
  // Patient-directed identity + account lifecycle
  | 'welcome'
  | 'otp'
  | 'magic_link'
  | 'mfa_reset'
  | 'biometric_reset'
  | 'invite_activation'
  | 'account_closed'
  | 'self_close_confirm'
  // Treatment / clinical dispatch
  | 'emergency_dispatch_caregiver'
  | 'caregiver_alert'
  | 'escalation_tier_1_staff'
  | 'escalation_tier_2_staff'
  | 'escalation_tier_3_staff'
  // Care coordination
  | 'support_reply'
  | 'support_resolved'
  | 'support_ops_notify'
  | 'contact_form'
  // Treatment adherence + monitoring
  | 'gap_alert'
  | 'medication_reask'
  // Reminder & Engagement (N1–N10, 2026-07-13)
  | 'daily_reminder'
  | 'care_team_gap_alert'
  // Healthcare operations reporting
  | 'monthly_report'
  // Security operations (HIPAA §164.308(a)(6))
  | 'security_alert'

/**
 * §164.528 permitted-use purpose taxonomy. Mirrors the Prisma
 * `DisclosurePurpose` enum values one-for-one. Kept as a local string-literal
 * union so this file has no Prisma import — the registry stays cheap to load
 * in spec files that don't need the generated client.
 */
export type DisclosurePurposeName =
  | 'TREATMENT'
  | 'PAYMENT'
  | 'HEALTHCARE_OPERATIONS'
  | 'DIRECT_TO_PATIENT' // disclosure TO the patient — §164.528(a)(1)(i) exempt
  | 'PATIENT_AUTHORIZED' // per §164.508 patient authorization — accountable
  | 'CARE_COORDINATION'
  | 'REQUIRED_BY_LAW'
  | 'OTHER'

/**
 * Structured "who received it" bucket. Mirrors Prisma `RecipientCategory`.
 */
export type RecipientCategoryName =
  | 'PATIENT'
  | 'CAREGIVER'
  | 'PROVIDER'
  | 'MEDICAL_DIRECTOR'
  | 'COORDINATOR'
  | 'HEALPLACE_OPS'
  | 'SUPER_ADMIN'
  | 'EXTERNAL_UNKNOWN'
  | 'SYSTEM'

/**
 * One-per-template classification + brief-description generator.
 *
 * `briefDescriptionFn` is called at write time and MUST NOT include patient
 * name, DOB, phone, address, or free-text narrative — those violate Minimum
 * Necessary in the disclosure trail. Structured clinical values (BP number,
 * alert tier, rule id, drug class) are fine.
 */
export interface TemplateSpec {
  purpose: DisclosurePurposeName
  recipientCategory: RecipientCategoryName
  briefDescriptionFn: (metadata: Record<string, unknown>) => string
}

// Cap on brief-description length to keep the disclosure trail terse and
// scannable. If a template's fn wants to include a longer breakdown, put it
// in metadata — never here.
const BRIEF_DESCRIPTION_MAX = 200

function clip(s: string): string {
  return s.length > BRIEF_DESCRIPTION_MAX
    ? `${s.slice(0, BRIEF_DESCRIPTION_MAX - 1)}…`
    : s
}

/**
 * Every EmailTemplateName has exactly one entry. TypeScript's
 * `Record<EmailTemplateName, TemplateSpec>` typing enforces exhaustiveness —
 * adding a new template to the union without adding an entry here is a
 * compile error.
 */
export const EMAIL_TEMPLATE_REGISTRY: Record<EmailTemplateName, TemplateSpec> = {
  // ── Patient-directed identity + account lifecycle ─────────────────────
  welcome: {
    purpose: 'DIRECT_TO_PATIENT',
    recipientCategory: 'PATIENT',
    briefDescriptionFn: (m) =>
      clip(
        `Welcome message${m.hasDisplayId ? ' with permanent display id' : ''}`,
      ),
  },
  otp: {
    purpose: 'DIRECT_TO_PATIENT',
    recipientCategory: 'PATIENT',
    briefDescriptionFn: () => 'One-time login code',
  },
  magic_link: {
    purpose: 'DIRECT_TO_PATIENT',
    recipientCategory: 'PATIENT',
    briefDescriptionFn: () => 'Magic sign-in link',
  },
  mfa_reset: {
    purpose: 'DIRECT_TO_PATIENT',
    recipientCategory: 'PATIENT',
    briefDescriptionFn: (m) =>
      clip(`MFA reset notification — reason ${m.reason ?? 'unspecified'}`),
  },
  biometric_reset: {
    purpose: 'DIRECT_TO_PATIENT',
    recipientCategory: 'PATIENT',
    briefDescriptionFn: (m) =>
      clip(`Biometric reset notification — reason ${m.reason ?? 'unspecified'}`),
  },
  invite_activation: {
    purpose: 'DIRECT_TO_PATIENT',
    recipientCategory: 'EXTERNAL_UNKNOWN',
    briefDescriptionFn: (m) =>
      clip(`Account activation invite — role ${m.role ?? 'unspecified'}`),
  },
  account_closed: {
    purpose: 'DIRECT_TO_PATIENT',
    recipientCategory: 'PATIENT',
    briefDescriptionFn: () => 'Account closed confirmation',
  },
  self_close_confirm: {
    purpose: 'DIRECT_TO_PATIENT',
    recipientCategory: 'PATIENT',
    briefDescriptionFn: () => 'Self-initiated account closure confirmation',
  },

  // ── Treatment / clinical dispatch ─────────────────────────────────────
  emergency_dispatch_caregiver: {
    purpose: 'TREATMENT',
    recipientCategory: 'CAREGIVER',
    briefDescriptionFn: (m) =>
      clip(
        `Emergency caregiver dispatch — caregiverId ${m.caregiverId ?? '?'}`,
      ),
  },
  caregiver_alert: {
    purpose: 'TREATMENT',
    recipientCategory: 'CAREGIVER',
    briefDescriptionFn: (m) =>
      clip(
        `Caregiver alert — alertId ${m.alertId ?? '?'} — caregiverId ${m.caregiverId ?? '?'}`,
      ),
  },
  escalation_tier_1_staff: {
    purpose: 'TREATMENT',
    recipientCategory: 'PROVIDER',
    briefDescriptionFn: (m) =>
      clip(
        `Tier 1 escalation dispatch — alertId ${m.alertId ?? '?'} — rule ${m.ruleId ?? '?'} — role ${m.role ?? '?'} — step ${m.ladderStep ?? '?'}`,
      ),
  },
  escalation_tier_2_staff: {
    purpose: 'TREATMENT',
    recipientCategory: 'PROVIDER',
    briefDescriptionFn: (m) =>
      clip(
        `Tier 2 escalation dispatch — alertId ${m.alertId ?? '?'} — rule ${m.ruleId ?? '?'} — role ${m.role ?? '?'} — step ${m.ladderStep ?? '?'}`,
      ),
  },
  escalation_tier_3_staff: {
    purpose: 'TREATMENT',
    recipientCategory: 'PROVIDER',
    briefDescriptionFn: (m) =>
      clip(
        `Tier 3 escalation dispatch — alertId ${m.alertId ?? '?'} — rule ${m.ruleId ?? '?'} — role ${m.role ?? '?'} — step ${m.ladderStep ?? '?'}`,
      ),
  },

  // ── Care coordination ─────────────────────────────────────────────────
  support_reply: {
    purpose: 'CARE_COORDINATION',
    recipientCategory: 'PATIENT',
    briefDescriptionFn: (m) =>
      clip(
        `Support ticket reply — ticketNumber ${m.ticketNumber ?? '?'} — category ${m.category ?? 'unspecified'}`,
      ),
  },
  support_resolved: {
    purpose: 'CARE_COORDINATION',
    recipientCategory: 'PATIENT',
    briefDescriptionFn: (m) =>
      clip(
        `Support ticket resolved — ticketNumber ${m.ticketNumber ?? '?'} — category ${m.category ?? 'unspecified'}`,
      ),
  },
  support_ops_notify: {
    purpose: 'CARE_COORDINATION',
    recipientCategory: 'HEALPLACE_OPS',
    briefDescriptionFn: (m) =>
      clip(
        `Ops routing notification — ticketNumber ${m.ticketNumber ?? '?'} — category ${m.category ?? 'unspecified'} — priority ${m.priority ?? 'unspecified'}`,
      ),
  },
  contact_form: {
    purpose: 'CARE_COORDINATION',
    recipientCategory: 'HEALPLACE_OPS',
    briefDescriptionFn: (m) =>
      clip(
        `Contact form submission from ${typeof m.submitterEmail === 'string' ? m.submitterEmail : 'unknown'}`,
      ),
  },

  // ── Treatment adherence + monitoring ──────────────────────────────────
  gap_alert: {
    purpose: 'TREATMENT',
    recipientCategory: 'PATIENT',
    briefDescriptionFn: (m) =>
      clip(
        `Reading-gap nudge — no readings in ${m.gapHours ?? '?'}h`,
      ),
  },
  medication_reask: {
    purpose: 'TREATMENT',
    recipientCategory: 'PATIENT',
    briefDescriptionFn: () => 'Monthly medication re-confirmation prompt',
  },

  // ── Reminder & Engagement (N1–N10, 2026-07-13) ────────────────────────
  daily_reminder: {
    purpose: 'TREATMENT',
    recipientCategory: 'PATIENT',
    briefDescriptionFn: (m) =>
      clip(`Daily BP-check reminder — day ${m.dayCount ?? '?'}`),
  },
  care_team_gap_alert: {
    purpose: 'CARE_COORDINATION',
    recipientCategory: 'PROVIDER',
    briefDescriptionFn: (m) =>
      clip(
        `Care-team notice — patient reading gap of ${m.daysSinceLastReading ?? '?'} days`,
      ),
  },

  // ── Healthcare operations reporting ───────────────────────────────────
  monthly_report: {
    purpose: 'HEALTHCARE_OPERATIONS',
    recipientCategory: 'MEDICAL_DIRECTOR',
    briefDescriptionFn: (m) =>
      clip(
        `Monthly practice-wide alert summary — practice ${m.practiceId ?? '?'} — ${m.monthLabel ?? m.monthYear ?? '?'} — totalAlerts ${m.totalAlerts ?? '?'} — escalatedPct ${m.escalatedPct ?? '?'}`,
      ),
  },

  // ── Security operations ───────────────────────────────────────────────
  // Real-time repeated-failed-auth page to the security owner. Carries the
  // auth IDENTIFIER + failure count only — never patient clinical data — so
  // patientUserId is null on the disclosure (the subject is a login, not a
  // patient). HEALTHCARE_OPERATIONS is the correct §164.506 purpose (security
  // oversight of the system), matching monthly_report.
  security_alert: {
    purpose: 'HEALTHCARE_OPERATIONS',
    recipientCategory: 'HEALPLACE_OPS',
    briefDescriptionFn: (m) =>
      clip(
        `Security alert — ${m.failedCount ?? '?'} failed auth attempt(s) for identifier ${m.identifier ?? '?'} across ${m.distinctIpCount ?? '?'} IP(s)`,
      ),
  },
}

/**
 * Fetch the classification spec for a template. Throws on an unknown name
 * because the union type is meant to prevent that at compile — a runtime
 * miss means the union or registry got out of sync.
 */
export function resolveTemplateSpec(name: EmailTemplateName): TemplateSpec {
  const spec = EMAIL_TEMPLATE_REGISTRY[name]
  if (!spec) {
    throw new Error(
      `EMAIL_TEMPLATE_REGISTRY missing entry for template "${name}" — union / registry drift`,
    )
  }
  return spec
}

/**
 * Compute the §164.528 brief description from the template + call-site
 * metadata. Never throws — a fn that blows up on missing metadata falls back
 * to a template-name-based description so an audit row is still written.
 */
export function computeBriefDescription(
  name: EmailTemplateName,
  metadata?: Record<string, unknown>,
): string {
  const spec = EMAIL_TEMPLATE_REGISTRY[name]
  if (!spec) return `unknown template "${name}"`
  try {
    return spec.briefDescriptionFn(metadata ?? {})
  } catch {
    return `template "${name}" — brief description generation failed`
  }
}
