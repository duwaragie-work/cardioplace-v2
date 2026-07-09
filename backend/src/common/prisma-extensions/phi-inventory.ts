/**
 * Canonical PHI-model inventory (Nivakaran N3 — HIPAA §164.312(b) conformance).
 *
 * This file is the RUNTIME MIRROR of docs/EPHI_INVENTORY.md Table 1. The
 * conformance test in `access-log.extension.spec.ts` asserts that the set of
 * models the AccessLog Prisma extension audits (`PHI_MODELS`) equals this set
 * verbatim — so if a new Prisma model is added and the author forgets to add
 * it to PHI_MODELS, the build fails.
 *
 * Change-control rule (repeated here from EPHI_INVENTORY.md):
 *   1. Add the model to docs/EPHI_INVENTORY.md Table 1 (with tier + rationale).
 *   2. Add the model to CANONICAL_PHI_MODELS below.
 *   3. Add the model to PHI_MODELS in access-log.extension.ts.
 *   4. Conformance suite goes green.
 *
 * Ordering here mirrors EPHI_INVENTORY.md row order so a diff on either side
 * reads left-to-right. The Set itself is unordered — the ordering is a
 * reader-affordance, not a runtime concern.
 */
export const CANONICAL_PHI_MODELS: ReadonlySet<string> = new Set([
  // Original 7 (2026-06-30) — core clinical + identity.
  'User',
  'PatientProfile',
  'JournalEntry',
  'DeviationAlert',
  'Notification',
  'PatientMedication',
  'PatientThreshold',
  // Support triad (2026-07-03) — patient free text on the support channel.
  'SupportTicket',
  'SupportTicketReply',
  'SupportTicketAction',
  // N4 additions (2026-07-08) — per EPHI_INVENTORY.md rows 8–20.
  'EscalationEvent',
  'ProfileVerificationLog',
  'RejectedReadingLog',
  'PatientCaregiver',
  'CaregiverDispatchLog',
  'EmergencyEvent',
  'Conversation',
  'Session',
  'MonthlyReportSnapshot',
  'PatientProviderAssignment',
])
