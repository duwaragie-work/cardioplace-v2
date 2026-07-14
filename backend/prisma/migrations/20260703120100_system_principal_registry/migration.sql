-- System-principal registry (audit, HIPAA §164.312(b), Humaira Activity 1).
-- Two new enum values. Each is a single ADD VALUE (transaction-safe on
-- PostgreSQL 12+). No data is written here — the eight principal rows are
-- created by the seed (prisma/seed/system-principals.ts).

-- AlterEnum
ALTER TYPE "AccountStatus" ADD VALUE 'SYSTEM';

-- AlterEnum
ALTER TYPE "DisplayIdClass" ADD VALUE 'SYSTEM';
