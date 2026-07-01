import type { Request } from 'express'

/** First hop of X-Forwarded-For, falling back to the socket IP. Mirrors the
 *  extraction in users.controller.ts. */
export function extractIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) {
    const first = Array.isArray(forwarded)
      ? forwarded[0]
      : forwarded.split(',')[0]
    return first?.trim()
  }
  return req.ip
}
