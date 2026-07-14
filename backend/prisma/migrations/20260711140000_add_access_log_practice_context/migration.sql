-- N4 follow-up (2026-07-11) — practice-context attribution on AccessLog.
--
-- HIPAA 45 CFR §164.312(a)(2)(i) + Manisha 2026-06-12 Access Control §1.
-- Mirrors the practiceContext columns already on AuthLog, EmailDisclosureLog,
-- and ProfileVerificationLog so per-practice audit queries can filter
-- directly at query time instead of resolving actor→practice memberships
-- for every row.
--
-- Nullable — SUPER_ADMIN / HEALPLACE_OPS / SYSTEM_ACTOR writes and pre-
-- policy rows carry no practice attribution.

ALTER TABLE "AccessLog"
    ADD COLUMN "practiceContext" TEXT;

CREATE INDEX "AccessLog_practiceContext_createdAt_idx"
    ON "AccessLog"("practiceContext", "createdAt");
