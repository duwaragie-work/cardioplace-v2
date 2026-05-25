// Resolve a batch of user IDs to display names. Used by audit-trail surfaces
// (Timeline, Thresholds "Set by", Escalation "Resolved by") so the admin UI
// shows a human-readable name instead of a truncated UUID/ULID. Falls back
// to email, then to a short ID slice, when name is missing.

import type { PrismaService } from '../prisma/prisma.service.js'

export interface UserDisplay {
  id: string
  name: string | null
  email: string | null
  roles: string[]
}

export async function resolveUserDisplays(
  prisma: PrismaService,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, UserDisplay>> {
  const unique = Array.from(
    new Set(ids.filter((v): v is string => typeof v === 'string' && v.length > 0)),
  )
  const map = new Map<string, UserDisplay>()
  if (unique.length === 0) return map

  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, email: true, roles: true },
  })
  for (const u of users) map.set(u.id, u)
  return map
}

/** Best-effort display label: name → email → short id → null. */
export function pickDisplayName(
  id: string | null | undefined,
  map: Map<string, UserDisplay>,
): string | null {
  if (!id) return null
  const u = map.get(id)
  if (!u) return null
  return u.name?.trim() || u.email?.trim() || null
}

// Audit surfaces store a coarse VerifierRole (PATIENT/ADMIN/PROVIDER) — every
// admin-side action is recorded as the generic "ADMIN", which loses the actor's
// real role. For display, resolve the actor's actual role from their User
// record, most-clinically-specific first, so the Timeline reads "(provider)"
// rather than a blanket "(admin)".
const ROLE_DISPLAY_PRIORITY = [
  'MEDICAL_DIRECTOR',
  'PROVIDER',
  'SUPER_ADMIN',
  'HEALPLACE_OPS',
  'PATIENT',
] as const

/**
 * Resolve the actor's real role token for display. Returns the highest-priority
 * role the user actually holds; falls back to the stored coarse role when the
 * user can't be resolved (deleted account, etc.). Caller formats it for display.
 */
export function pickDisplayRole(
  id: string | null | undefined,
  map: Map<string, UserDisplay>,
  fallbackRole?: string | null,
): string | null {
  const roles = id ? map.get(id)?.roles : undefined
  if (roles?.length) {
    for (const r of ROLE_DISPLAY_PRIORITY) {
      if (roles.includes(r)) return r
    }
    return roles[0]
  }
  return fallbackRole ?? null
}
