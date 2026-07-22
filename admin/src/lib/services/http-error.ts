/**
 * HTTP errors that carry their status code.
 *
 * Why this exists (alert-resolve IDOR review, 2026-07-21 · S1):
 * the admin service layer threw `new Error(err.message || \`…: ${res.status}\`)`.
 * The backend always supplies a `message`, so the left branch always won and
 * the **status code never survived** into the thrown error. That left
 * PatientDetailShell's out-of-scope redirect matching the message PROSE —
 * `/outside your role scope/i` — because its two sibling conditions
 * (`msg.includes('403')`, `/forbidden/i`) could never fire.
 *
 * That coupling is invisible from either side: S1 rewrites the backend's 403
 * wording to stop leaking the patient id, and a wording change made without
 * knowing about this file would silently downgrade a clean "not authorized"
 * bounce into a raw error banner — with nothing failing at compile time and
 * only one e2e spec (qa/tests/30s) catching it.
 *
 * So: carry the status, branch on the status.
 */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/**
 * Build the error to throw from a non-OK admin API response.
 *
 * Keeps the existing message precedence (server message first, then a
 * caller-supplied fallback with the code appended) so nothing user-visible
 * changes — it only stops discarding the status.
 */
export function httpErrorFrom(
  body: { message?: unknown },
  status: number,
  fallbackMsg = 'Request failed',
): HttpError {
  const serverMsg = typeof body?.message === 'string' ? body.message : ''
  return new HttpError(serverMsg || `${fallbackMsg}: ${status}`, status)
}

/**
 * Is this the backend refusing the record as out of the caller's scope?
 *
 * The status is authoritative. The prose checks are a deliberate FALLBACK, not
 * a second opinion: errors can still reach here from call sites not yet
 * migrated to `httpErrorFrom`, and a 403 must never be missed just because the
 * status was dropped upstream. They are matched loosely enough to survive the
 * S1 rewording ("Requested record is outside your role scope") and the pre-S1
 * text ("Patient 01J… is outside your role scope") alike.
 */
export function isOutOfScopeError(e: unknown): boolean {
  if (e instanceof HttpError) return e.status === 403

  const msg = e instanceof Error ? e.message : String(e ?? '')
  return (
    msg.includes('403') ||
    /forbidden/i.test(msg) ||
    /outside your (role|MED_DIR|management) scope/i.test(msg)
  )
}
