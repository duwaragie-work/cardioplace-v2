import type { PrismaClient } from '../../generated/prisma/client.js'
import { AccountStatus } from '../../generated/prisma/enums.js'

/**
 * System-principal registry resolver (audit, 2026-07-03; HIPAA §164.312(b),
 * Humaira Activity 1 item 3).
 *
 * Maps a background process to its seeded system-principal User id so cron /
 * engine writes attribute to a real, joinable actor instead of null. The id
 * map is warmed ONCE at boot (SystemPrincipalsService.onModuleInit) and read
 * synchronously thereafter — `runAsCronActor` must stay synchronous inside the
 * CLS context, and a per-tick DB lookup would risk blocking the first
 * post-boot tick (see the handoff stop-condition). If the cache is cold or a
 * label is unknown, the resolver returns null → the write falls back to the
 * pre-2026-07-03 behaviour (SYSTEM_ACTOR, actorId null), which is safe.
 */

// The eight principals. MUST match the seed (prisma/seed/system-principals.ts)
// and the email convention system-<label>@internal.cardioplace.test.
export const SYSTEM_PRINCIPAL_LABELS = [
  'engine-alert-generator',
  'escalation-ladder',
  'session-finalize',
  'gap-alert',
  'monthly-reask',
  'medication-hold-escalation',
  'monthly-report',
  'content-scheduler',
  // N7 (2026-07-11) — automated audit exception-report cron
  // (§164.308(a)(1)(ii)(D) Information System Activity Review).
  'audit-exception-report',
] as const

export type SystemPrincipalLabel = (typeof SYSTEM_PRINCIPAL_LABELS)[number]

/**
 * The label passed to `runAsCronActor` is NOT always the principal label — the
 * cron labels were coined before the registry existed and do not strip
 * cleanly (e.g. 'cron-content-stale-flag' → 'content-scheduler', and the engine
 * handler carries no 'cron-' prefix). This explicit map is the source of truth;
 * `systemActorLabel` in AccessLog keeps the original cron label unchanged.
 */
export const CRON_LABEL_TO_PRINCIPAL: Readonly<Record<string, SystemPrincipalLabel>> = {
  'cron-content-stale-flag': 'content-scheduler',
  'cron-gap-alert': 'gap-alert',
  'cron-medication-hold-escalation': 'medication-hold-escalation',
  'cron-monthly-reask': 'monthly-reask',
  'cron-session-finalize': 'session-finalize',
  'cron-escalation-ladder': 'escalation-ladder',
  'cron-monthly-report': 'monthly-report',
  // N7 (2026-07-11).
  'cron-audit-exception-report': 'audit-exception-report',
  // Engine @OnEvent handler — no 'cron-' prefix; label == principal.
  'engine-alert-generator': 'engine-alert-generator',
}

// Derive the principal label from a seed row's email:
//   system-<label>@internal.cardioplace.test → <label>
const EMAIL_PREFIX = 'system-'
const EMAIL_SUFFIX = '@internal.cardioplace.test'

export function principalLabelFromEmail(email: string): string {
  return email.slice(EMAIL_PREFIX.length, email.length - EMAIL_SUFFIX.length)
}

// Module-level warmed cache. Null until warmed. A Map, not per-boot memo on the
// resolver, so tests can seed it directly via setSystemPrincipalRegistry.
let registry: Map<string, string> | null = null

/** Warm the id map from the seeded SYSTEM users. Call once at boot. */
export async function warmSystemPrincipals(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.user.findMany({
    where: { accountStatus: AccountStatus.SYSTEM },
    select: { id: true, email: true },
  })
  const map = new Map<string, string>()
  for (const row of rows) {
    if (!row.email) continue
    map.set(principalLabelFromEmail(row.email), row.id)
  }
  registry = map
}

/** Test seam: inject a known map (or reset with null). */
export function setSystemPrincipalRegistry(map: Map<string, string> | null): void {
  registry = map
}

/** Sync lookup by principal label. Null if cold or unknown. */
export function getSystemPrincipalId(label: SystemPrincipalLabel): string | null {
  return registry?.get(label) ?? null
}

/**
 * Resolve the actor id for a `runAsCronActor` label. Returns null (safe
 * fallback) when the label is unmapped or the cache is cold.
 */
export function resolveCronActorId(cronLabel: string): string | null {
  const principal = CRON_LABEL_TO_PRINCIPAL[cronLabel]
  if (!principal) return null
  return registry?.get(principal) ?? null
}
