import { withNotDeleted, SOFT_DELETE_FILTERED_OPS } from './soft-delete.extension.js'

describe('soft-delete extension — withNotDeleted', () => {
  it('injects deletedAt: null into every filtered read op, ANDed with existing where', () => {
    for (const op of SOFT_DELETE_FILTERED_OPS) {
      const out = withNotDeleted(op, { where: { userId: 'u1' } }) as {
        where: Record<string, unknown>
      }
      expect(out.where).toEqual({ deletedAt: null, userId: 'u1' })
    }
  })

  it('adds a where clause when the read op had none', () => {
    expect(withNotDeleted('findMany', undefined)).toEqual({ where: { deletedAt: null } })
    expect(withNotDeleted('count', {})).toEqual({ where: { deletedAt: null } })
  })

  it('does NOT touch write/delete ops — the soft-delete update + any purge must still target deleted rows', () => {
    for (const op of ['create', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']) {
      const args = { where: { id: 'e1' }, data: { deletedAt: null } }
      // returned unchanged (same reference) — no deletedAt filter injected
      expect(withNotDeleted(op, args)).toBe(args)
    }
  })

  it('does NOT touch findUnique / findUniqueOrThrow — unique-where only; sole caller reads metadata', () => {
    const args = { where: { id: 'e1' } }
    expect(withNotDeleted('findUnique', args)).toBe(args)
    expect(withNotDeleted('findUniqueOrThrow', args)).toBe(args)
  })

  it('lets an explicit caller-supplied deletedAt win (restore / purge escape hatch)', () => {
    const out = withNotDeleted('findMany', { where: { deletedAt: { not: null } } }) as {
      where: Record<string, unknown>
    }
    expect(out.where).toEqual({ deletedAt: { not: null } })
  })

  it('composes with OR filters (top-level where fields AND together)', () => {
    const out = withNotDeleted('findFirst', { where: { OR: [{ sessionId: 's1' }] } }) as {
      where: Record<string, unknown>
    }
    expect(out.where).toEqual({ deletedAt: null, OR: [{ sessionId: 's1' }] })
  })
})
