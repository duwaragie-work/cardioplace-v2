/**
 * Shared Prisma `select` constants for patient-facing reads that flow into
 * the LLM (system prompt or tool response).
 *
 * Single source of truth for "what fields can leak across the LLM tool
 * boundary". Every Prisma query whose result reaches the chatbot — either
 * by being inlined in the system prompt or by being returned from a tool
 * call — should use one of these constants rather than inline its own
 * field list. When a new column is added to the Prisma model, it stays
 * invisible to the LLM until it's explicitly added here. That's the OWASP
 * LLM02 "minimum necessary" pattern at the schema boundary.
 *
 * Internal columns that MUST NEVER appear here:
 *   • userId, sessionId — the LLM should not know the patient's UUIDs;
 *     can be echoed back, can be weaponised by prompt injection.
 *   • source, sourceMetadata — clinical-workflow audit (which device/app
 *     created the row), not patient-facing.
 *   • createdAt, updatedAt — internal lifecycle, not measurement time.
 *   • singleReadingFinalized — engine-internal gating flag.
 *
 * Identical inline selects existed in chat.service.ts (system-prompt build)
 * and voice.service.ts (system-prompt build) before this file. Both now
 * import the constants so a single edit propagates.
 *
 * If you need to widen the surface for the LLM:
 *   • Add the field here with a comment explaining why the LLM needs it.
 *   • Add a regression test in cross-tenant-isolation.spec.ts asserting the
 *     new field IS allowed and unrelated internal fields ARE NOT.
 */

import type { Prisma } from '../generated/prisma/client.js'

/**
 * JournalEntry fields the LLM system prompt is allowed to see. Used by:
 *   - backend/src/chat/chat.service.ts buildPatientSystemPrompt
 *   - backend/src/voice/voice.service.ts buildPatientContext
 *
 * Both consumers display the patient's recent BP/weight/medication/symptom
 * history to the model. NO `userId`/`sessionId`/`createdAt` — those would
 * leak internal identifiers and have no clinical value to the model.
 */
export const PATIENT_JOURNAL_FIELDS_FOR_LLM_PROMPT = {
  measuredAt: true,
  systolicBP: true,
  diastolicBP: true,
  weight: true,
  medicationTaken: true,
  otherSymptoms: true,
} as const satisfies Prisma.JournalEntrySelect

/**
 * Patient-facing DeviationAlert projection used by both chat and voice
 * system-prompt builds (the "active alerts" block). Excludes `userId` (same
 * patient, redundant), `escalationLevel` (clinical workflow, internal), and
 * `status` (already filtered by `where: { status: { in: [...] } }`).
 *
 * `physicianMessage` is included so the system prompt can tell the LLM the
 * full clinical framing — but the prompt explicitly instructs "do NOT
 * surface to patient", and the patient-facing layer uses `patientMessage`.
 */
export const PATIENT_DEVIATION_ALERT_FIELDS_FOR_LLM_PROMPT = {
  tier: true,
  ruleId: true,
  mode: true,
  patientMessage: true,
  physicianMessage: true,
  dismissible: true,
  createdAt: true,
} as const satisfies Prisma.DeviationAlertSelect
