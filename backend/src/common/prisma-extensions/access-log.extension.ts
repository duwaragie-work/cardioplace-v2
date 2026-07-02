import type { ClsService } from 'nestjs-cls'
import { Prisma } from '../../generated/prisma/client.js'
import type { PrismaClient } from '../../generated/prisma/client.js'

/**
 * PHI access audit trail (Humaira N8 / 164.312-T7, HIPAA §164.312(b)) — writes
 * one append-only `AccessLog` row per query against a PHI model, capturing WHO
 * (actor from CLS) touched WHICH model, WHEN, and for single-record ops WHICH
 * record.
 *
 * Design choices locked in with Duwaragie (2026-07-02):
 *   1. One row per QUERY, not per returned record. A page-load `findMany`
 *      returning 100 patients logs the intent ("actor listed JournalEntry at
 *      T"), not 100 rows. Single-record ops still capture `recordId` so we can
 *      prove exactly which record was read/written.
 *   2. Fire-and-forget audit write. The write is NOT awaited and its failure is
 *      swallowed (logged only) — an audit failure must NEVER break the actual
 *      query or the request.
 *   3. `basePrisma` (the un-extended client) performs the audit write, so it
 *      does not re-enter this extension. Belt-and-suspenders: `AccessLog` is not
 *      in PHI_MODELS anyway, so even an extended write would be skipped.
 */

// The seven PHI models. Everything else (AccessLog itself, AuthLog,
// AuthSession, RefreshToken, Practice, PracticeProvider, DisplayId, …) is not
// logged. `Notification` IS PHI — it carries clinical alert context — so both
// its reads and writes are logged (the sprint-doc self-read carveout was
// over-scoped; log everything on the model).
export const PHI_MODELS: ReadonlySet<string> = new Set([
  'User',
  'PatientProfile',
  'JournalEntry',
  'DeviationAlert',
  'Notification',
  'PatientMedication',
  'PatientThreshold',
])

/**
 * Models that get inline `createdByActorId` / `updatedByActorId` columns
 * auto-stamped from the CLS actor on write (2026-07-03). Complements — does
 * not replace — AccessLog: AccessLog stays the immutable append-only audit
 * log; these inline fields are mutable current-state for the "changed by
 * Dr. X at 10:32" display on the Timeline tab without a join.
 *
 * Deliberately NOT the full PHI set:
 *   • User / PatientProfile / JournalEntry / Notification — not display-audit
 *     targets for this pass (JournalEntry is patient-authored, immutable).
 *   • PatientMedication — EXCLUDED: it already carries generic edit-actor
 *     provenance (`addedByUserId` / `lastEditedByUserId`, PR #92). A second
 *     inline audit source would diverge from the #92 fields the Timeline UI
 *     already reads. See 2026-07-03 handoff decision.
 *
 * Stamping only fires for USER writes (a real CLS actorId). SYSTEM_ACTOR /
 * cron writes stay null inline — AccessLog still captures them with the cron
 * label (see runAsCronActor).
 */
export const AUDIT_STAMP_MODELS: ReadonlySet<string> = new Set([
  'PatientProviderAssignment',
  'PatientThreshold',
  'DeviationAlert',
])

const READ_OPS: ReadonlySet<string> = new Set([
  'findUnique',
  'findFirst',
  'findUniqueOrThrow',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
])
const WRITE_OPS: ReadonlySet<string> = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
])
const DELETE_OPS: ReadonlySet<string> = new Set(['delete', 'deleteMany'])

// Ops whose `recordId` we can pin from `args.where.id` (single-record targeting).
const WHERE_ID_OPS: ReadonlySet<string> = new Set([
  'findUnique',
  'findFirst',
  'findUniqueOrThrow',
  'findFirstOrThrow',
  'update',
  'upsert',
  'delete',
])

function classifyAction(operation: string): 'READ' | 'WRITE' | 'DELETE' | null {
  if (READ_OPS.has(operation)) return 'READ'
  if (WRITE_OPS.has(operation)) return 'WRITE'
  if (DELETE_OPS.has(operation)) return 'DELETE'
  return null
}

export interface AccessLogData {
  actorId: string | null
  actorType: 'USER' | 'SYSTEM_ACTOR'
  // Which background process wrote this, when actorType='SYSTEM_ACTOR' and the
  // cron identified itself via runAsCronActor. Null for USER writes and for
  // pre-2026-07-03 / unlabelled system writes.
  systemActorLabel: string | null
  action: 'READ' | 'WRITE' | 'DELETE'
  modelName: string
  recordId: string | null
  ip: string | null
  userAgent: string | null
}

/**
 * Pure classifier: given a completed operation, decide whether/what to audit.
 * Returns the `AccessLog` row data, or `null` when the op should not be logged
 * (non-PHI model — incl. AccessLog itself — or an unrecognised op). Extracted
 * so the audit semantics are unit-testable without a live Prisma client.
 */
export function computeAccessLogData(
  model: string | undefined,
  operation: string,
  args: unknown,
  result: unknown,
  cls: ClsService,
): AccessLogData | null {
  // Skip non-PHI models. This also excludes AccessLog → no recursion.
  if (!model || !PHI_MODELS.has(model)) return null

  const action = classifyAction(operation)
  if (!action) return null // unknown op — don't log

  const actorId = cls.get<string | null>('actorId') ?? null
  // No CLS actor (startup seeding, cron, raw $connect paths) → attribute to the
  // system actor rather than throwing. Cron handlers wrapped in runAsCronActor
  // carry a systemActorLabel so the SYSTEM_ACTOR row names its process.
  const actorType: 'USER' | 'SYSTEM_ACTOR' = actorId ? 'USER' : 'SYSTEM_ACTOR'
  // Only meaningful for system-actor writes; a real user is never a cron.
  const systemActorLabel = actorId
    ? null
    : (cls.get<string | null>('systemActorLabel') ?? null)
  const ip = cls.get<string | null>('ip') ?? null
  const userAgent = cls.get<string | null>('userAgent') ?? null

  let recordId: string | null = null
  if (WHERE_ID_OPS.has(operation)) {
    recordId = (args as { where?: { id?: string } })?.where?.id ?? null
  } else if (operation === 'create') {
    recordId = (result as { id?: string } | null)?.id ?? null
  }

  return {
    actorId,
    actorType,
    systemActorLabel,
    action,
    modelName: model,
    recordId,
    ip,
    userAgent,
  }
}

/**
 * Inline audit stamp (2026-07-03). For the three AUDIT_STAMP_MODELS, mutate the
 * write `args` so the row carries `createdByActorId` / `updatedByActorId` from
 * the CLS actor — giving admin displays "who last touched this" without a join
 * against AccessLog. Returns a NEW args object (does not mutate the caller's);
 * for non-stamp models / non-writes / no-actor it returns `args` unchanged.
 *
 * Only USER writes are stamped (`actorId` present). SYSTEM_ACTOR / cron writes
 * legitimately have no user actor → fields stay null, which is honest;
 * AccessLog still records the cron write with its label. Seed scripts run
 * without a CLS actor, so seeded rows also stay null (nullable columns → OK).
 *
 * Spread order puts the CLS actor LAST, so it wins over any caller-supplied
 * `createdByActorId` in `data`. That is the intended default — a write path
 * that must override (a deliberate backfill/impersonation) has to bypass the
 * extension. No such path exists today.
 */
export function stampInlineAudit(
  model: string | undefined,
  operation: string,
  args: unknown,
  cls: ClsService,
): unknown {
  if (!model || !AUDIT_STAMP_MODELS.has(model)) return args

  const actorId = cls.get<string | null>('actorId') ?? null
  if (!actorId) return args // SYSTEM_ACTOR / seed / cron → leave inline fields null

  const a = (args ?? {}) as Record<string, unknown>

  switch (operation) {
    case 'create':
      return {
        ...a,
        data: {
          ...((a.data as Record<string, unknown>) ?? {}),
          createdByActorId: actorId,
          updatedByActorId: actorId,
        },
      }
    case 'createMany': {
      const rows = a.data
      if (Array.isArray(rows)) {
        return {
          ...a,
          data: rows.map((r) => ({
            ...(r as Record<string, unknown>),
            createdByActorId: actorId,
            updatedByActorId: actorId,
          })),
        }
      }
      // createMany also accepts a single object.
      return {
        ...a,
        data: {
          ...((rows as Record<string, unknown>) ?? {}),
          createdByActorId: actorId,
          updatedByActorId: actorId,
        },
      }
    }
    case 'update':
    case 'updateMany':
      return {
        ...a,
        data: {
          ...((a.data as Record<string, unknown>) ?? {}),
          updatedByActorId: actorId,
        },
      }
    case 'upsert':
      return {
        ...a,
        create: {
          ...((a.create as Record<string, unknown>) ?? {}),
          createdByActorId: actorId,
          updatedByActorId: actorId,
        },
        update: {
          ...((a.update as Record<string, unknown>) ?? {}),
          updatedByActorId: actorId,
        },
      }
    default:
      return args // reads / deletes carry no audit-actor payload
  }
}

/**
 * The `$allOperations` body, extracted so it's directly unit-testable with a
 * stub `query` (no need to reach into Prisma's `defineExtension` internals):
 * run the real query, decide whether to audit, fire-and-forget the write, and
 * return the query result untouched.
 */
export async function auditAndReturn(
  ctx: {
    model?: string
    operation: string
    args: unknown
    query: (args: unknown) => Promise<unknown>
  },
  cls: ClsService,
  basePrisma: Pick<PrismaClient, 'accessLog'>,
): Promise<unknown> {
  // Inline audit stamp BEFORE the write runs, so createdByActorId /
  // updatedByActorId are persisted with the row itself (not just in AccessLog).
  // No-op for non-stamp models, reads/deletes, and system-actor writes.
  const stampedArgs = stampInlineAudit(ctx.model, ctx.operation, ctx.args, cls)

  // Run the real query first — its result/latency must be unaffected by
  // auditing. A throwing read (e.g. findUniqueOrThrow miss) propagates here
  // before we log, so no row is written for a record never read.
  const result = await ctx.query(stampedArgs)

  // recordId classification reads `where` (unchanged by stamping), so the
  // original args are fine here.
  const data = computeAccessLogData(ctx.model, ctx.operation, ctx.args, result, cls)
  if (!data) return result

  // Fire-and-forget on the un-extended client. Never awaited; failures are
  // logged, never thrown — audit must not break the request.
  void basePrisma.accessLog.create({ data }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[AccessLog] write failed', err)
  })

  return result
}

export function accessLogExtension(cls: ClsService, basePrisma: PrismaClient) {
  return Prisma.defineExtension({
    name: 'access-log',
    query: {
      $allModels: {
        $allOperations: ({ model, operation, args, query }) =>
          auditAndReturn({ model, operation, args, query }, cls, basePrisma),
      },
    },
  })
}
