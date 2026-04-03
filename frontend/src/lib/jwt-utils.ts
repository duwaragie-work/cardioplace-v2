/**
 * Decode a JWT payload without signature verification.
 * Safe for routing decisions — the backend verifies signatures on every API call.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const decoded =
      typeof Buffer !== 'undefined'
        ? Buffer.from(base64, 'base64').toString('utf-8')
        : atob(base64)
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

export function getJwtRoles(token: string): string[] {
  const payload = decodeJwtPayload(token)
  if (!payload || !Array.isArray(payload.roles)) return []
  return payload.roles as string[]
}
