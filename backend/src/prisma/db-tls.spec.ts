import { classifyDbTls } from './prisma.service.js'

/**
 * Humaira N3 / 164.312-T21 — verified DB transport TLS. classifyDbTls drives
 * the boot-time audit line and the production hard-stop. These cover each
 * branch without standing up a real connection.
 */
describe('classifyDbTls', () => {
  it('managed Prisma Postgres (db.prisma.io) → prisma-postgres (TLS always-on)', () => {
    expect(
      classifyDbTls(
        'postgres://user:pw@db.prisma.io:5432/postgres?sslmode=require',
        'production',
      ),
    ).toBe('prisma-postgres')
  })

  it('pooled Prisma Postgres host → prisma-postgres', () => {
    expect(
      classifyDbTls('postgres://user:pw@pooled.db.prisma.io:5432/postgres', 'production'),
    ).toBe('prisma-postgres')
  })

  it('explicit sslmode=require on a self-hosted URL → sslmode', () => {
    expect(
      classifyDbTls('postgresql://u:p@db.internal:5432/app?sslmode=require', 'production'),
    ).toBe('sslmode')
  })

  it('sslmode=verify-full is honoured (case-insensitive) → sslmode', () => {
    expect(
      classifyDbTls('postgresql://u:p@db.internal:5432/app?SSLMODE=VERIFY-full', 'production'),
    ).toBe('sslmode')
  })

  it('no TLS signal in production → missing-prod (caller must refuse to start)', () => {
    expect(
      classifyDbTls('postgresql://postgres:postgres@localhost:5433/cardioplace', 'production'),
    ).toBe('missing-prod')
  })

  it('no TLS signal outside production → missing-dev (warn only)', () => {
    expect(
      classifyDbTls('postgresql://postgres:postgres@localhost:5433/cardioplace', 'development'),
    ).toBe('missing-dev')
  })

  it('no TLS signal with NODE_ENV unset → missing-dev (not a prod hard-stop)', () => {
    expect(
      classifyDbTls('postgresql://postgres:postgres@localhost:5433/cardioplace', undefined),
    ).toBe('missing-dev')
  })
})
