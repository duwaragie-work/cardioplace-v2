// Cluster 6 bug #11 — serializable-txn-with-deadlock-retry helper.
//
// Extracted from TestControlService.resetUser (commit ff7c4c6) so the same
// pattern can wrap the AlertEngine + EscalationService write paths. Under
// Prisma Cloud DB concurrency, alerts the engine should fire have been
// getting silently rolled back when a deadlock collides with the write —
// production failure mode: a BP Level 2 reading during a deadlock window
// simply doesn't fire its alert.
//
// Retries on Prisma `P2034` (Prisma transaction conflict) or Postgres
// `40P01` (deadlock detected). Up to 3 attempts, 100 ms backoff. Caller
// is responsible for opening the actual `$transaction` inside `fn` with
// `{ isolationLevel: 'Serializable' }` — this helper only handles retry.

export interface RetryLogger {
  warn: (message: string) => void
}

const MAX_ATTEMPTS = 3
const BACKOFF_MS = 100

export async function withDeadlockRetry<T>(
  label: string,
  fn: () => Promise<T>,
  logger?: RetryLogger,
  maxAttempts: number = MAX_ATTEMPTS,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err: unknown) {
      const e = err as {
        code?: string
        meta?: { code?: string }
        cause?: { code?: string }
      }
      const isDeadlock =
        e?.code === 'P2034' ||
        e?.meta?.code === '40P01' ||
        e?.cause?.code === '40P01'
      if (!isDeadlock || attempt === maxAttempts) throw err
      logger?.warn(
        `${label} deadlock (attempt ${attempt}/${maxAttempts}) — retrying in ${BACKOFF_MS}ms`,
      )
      await new Promise((r) => setTimeout(r, BACKOFF_MS))
    }
  }
  // Unreachable — the loop either returns on success or rethrows on max.
  throw new Error(`${label}: withDeadlockRetry exhausted without resolution`)
}
