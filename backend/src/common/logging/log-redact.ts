import { createHash } from 'node:crypto'

/**
 * V-05 (Humaira assessment, HIGH · §164.312(b) · CSF PR.DS-10) — helpers for
 * keeping clinical PHI out of application stdout.
 *
 * The finding: chat tool arguments (systolic/diastolic BP, pulse, symptoms,
 * missed medications) and raw voice transcripts were written to stdout with no
 * redaction and no gate. That duplicates PHI into a sink with none of the audit
 * trail's access control, retention policy, or encryption — and if the log
 * aggregator is a third party, it is also an uncovered Business-Associate flow.
 *
 * The fix per the assessment: "strip PHI from stdout (log tool name, IDs,
 * booleans, byte counts only); never JSON.stringify tool args; gate any
 * transcript logging behind a flag off in production; route through a
 * redaction layer."
 *
 * NOTE — deliberately NOT reusing `common/audit/phi-redactor.ts`. That is
 * typed to `AccessLogData` (a closed metadata struct) and solves a different
 * problem: whitelisting an already-safe payload. V-05 needs `string`/`unknown`
 * → safe-string, which is a genuinely different shape.
 */

/**
 * Is verbose PHI logging permitted right now?
 *
 * DOUBLE-GATED on purpose. `CHAT_VOICE_DEBUG_PHI=1` alone is not enough — the
 * flag is ignored outright in production, so a misconfigured prod or
 * prod-adjacent box (a staging env holding real pilot data, an env var copied
 * between deploys) cannot silently re-open the finding. A flag that can be
 * turned on in prod is not a privacy control; this one cannot be.
 *
 * Mirrors the existing `VOICE_DEBUG_AUDIO` idiom (voice.gateway.ts) — with the
 * added NODE_ENV gate, because that flag only ever exposed byte counts whereas
 * this one exposes clinical text.
 */
export function phiDebugEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.CHAT_VOICE_DEBUG_PHI === '1'
  )
}

/**
 * Describe free text without disclosing it: `[42 chars]`.
 *
 * Under `phiDebugEnabled()` the text is appended for local debugging. In prod
 * the length alone still supports the diagnostics these lines existed for
 * ("did the model return anything?", "was the transcript empty?").
 */
export function redactText(value: string | null | undefined): string {
  if (value == null) return '[null]'
  const meta = `[${value.length} chars]`
  return phiDebugEnabled() ? `${meta} ${value}` : meta
}

/**
 * Describe an object's SHAPE without its values: `keys=[systolicBP,symptoms]`.
 *
 * This is the replacement for `JSON.stringify(toolArgs)`. For `submit_checkin`
 * the arg VALUES are literally the patient's BP / pulse / symptoms / missed
 * medications, while the arg KEYS are the whole diagnostic signal ("which
 * fields did the model decide to send?"). Keys give up essentially none of the
 * debugging value at zero PHI.
 */
export function argKeys(args: unknown): string {
  if (args == null || typeof args !== 'object') return 'keys=[]'
  const keys = Object.keys(args as Record<string, unknown>)
  const rendered = `keys=[${keys.join(',')}]`
  return phiDebugEnabled()
    ? `${rendered} args=${safeStringify(args)}`
    : rendered
}

/**
 * Stable, non-reversible reference to free text: `sha256:a1b2c3d4`.
 *
 * For the `[SECURITY-CRITICAL]` emergency-dispatch failures. Those lines exist
 * so a failed dispatch is forensically recoverable, so deleting `situation`
 * outright would cost real incident-response capability. A short digest lets an
 * investigator correlate the log line with the DB row (which holds the real
 * text, access-controlled and audited) without putting the narrative in a log
 * sink. Same principle as `EmailDisclosureLog.bodyHash` — tamper-evident
 * reference "without duplicating PHI at rest".
 *
 * Truncated to 8 hex chars: enough to correlate within an incident window, and
 * short digests are not a disclosure risk for free-form clinical prose.
 */
export function situationHash(value: string | null | undefined): string {
  if (value == null) return 'sha256:none'
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 8)
  return `sha256:${digest}`
}

/** JSON.stringify that cannot throw on cycles/BigInt — debug path only. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    )
  } catch {
    return '[unserializable]'
  }
}
