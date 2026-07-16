-- N-3 (Duwaragie 2026-07-14 triage) — add UNATTRIBUTED_ACCESS_LOG detector
-- id to the AuditExceptionDetectorId enum. Sibling to
-- UNATTRIBUTED_SYSTEM_DISCLOSURE (which watches EmailDisclosureLog); this
-- one watches AccessLog for rows produced by a query fired outside any CLS
-- scope (actorType=SYSTEM_ACTOR AND actorId IS NULL AND systemActorLabel
-- IS NULL). Pre-N-3 the jwt.strategy User.findUnique flooded this pattern;
-- the detector now trips a review immediately on any regression.
--
-- Purely additive ALTER TYPE ADD VALUE — safe against a live production
-- table on Postgres 12+. Existing rows are unaffected; the new enum value
-- is not referenced by any row until the detector class registers it at
-- boot and starts writing new AuditException rows tagged with the id.

ALTER TYPE "AuditExceptionDetectorId" ADD VALUE 'UNATTRIBUTED_ACCESS_LOG';
