// Resolve a batch of user IDs to display names. Used by audit-trail surfaces
// (Timeline, Thresholds "Set by", Escalation "Resolved by") so the admin UI
// shows a human-readable name instead of a truncated UUID/ULID. Falls back
// to email, then to a short ID slice, when name is missing.

import type { PrismaService } from '../prisma/prisma.service.js'

export interface UserDisplay {
  id: string
  name: string | null
  email: string | null
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
    select: { id: true, name: true, email: true },
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
