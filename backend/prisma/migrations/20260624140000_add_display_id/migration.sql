-- Human-readable, prefixed, permanent identifier for every User account.
-- Issued once at account creation. Locked forever — even on deactivation or
-- future hard-delete, the value row survives in this ledger so the same
-- string can never be re-issued. Full spec in
-- docs/UNIQUE_IDENTIFIER_PROPOSAL_2026_06_24.md.
--
-- Format: CP-PAT-XXXXXXX-C (patient) / CP-STF-XXXXXXX-C (staff). 7 random
-- Crockford-base32 chars + 1 Luhn-mod-32 check char.
--
-- This is the FIRST migration of three:
--   1. (this) — additive: tables, enum, nullable User.displayId column
--   2. (code) — DisplayIdService + 4 user-create hooks + backfill script
--   3. (later) — ALTER COLUMN displayId SET NOT NULL once backfill verified

-- Population class for the ledger. PATIENT and STAFF are the only two
-- classes; class is the INITIAL population class and is immutable. A
-- patient who later joins staff keeps their CP-PAT-... ID.
CREATE TYPE "DisplayIdClass" AS ENUM ('PATIENT', 'STAFF');

-- Append-only ledger. One row per ever-issued identifier. The value column
-- is the lock-forever anchor: tombstoned IDs (userId NULL) share the same
-- unique namespace as live IDs, so they cannot be re-issued.
CREATE TABLE "DisplayId" (
    "value" TEXT NOT NULL,
    "display" TEXT NOT NULL,
    "class" "DisplayIdClass" NOT NULL,
    "userId" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tombstonedAt" TIMESTAMP(3),
    "issuedVia" TEXT NOT NULL,

    CONSTRAINT "DisplayId_pkey" PRIMARY KEY ("value")
);

-- Hyphenated display form must also be globally unique (it's just a
-- formatted view of the value, but indexed for direct lookup from emails
-- / paper-copy paste-ins).
CREATE UNIQUE INDEX "DisplayId_display_key" ON "DisplayId"("display");

-- One live owner per ID (NULL once tombstoned, so this partial-by-not-null
-- semantic is enforced application-side; we use a simple unique here and
-- multiple NULLs are allowed by Postgres unique-with-nulls semantics).
CREATE UNIQUE INDEX "DisplayId_userId_key" ON "DisplayId"("userId");

-- Ops query: "how many IDs of each class issued this week?"
CREATE INDEX "DisplayId_class_issuedAt_idx" ON "DisplayId"("class", "issuedAt");

-- User hard-delete is currently impossible (accountStatus = DEACTIVATED is
-- the soft state). If it's ever added, SetNull tombstones the ledger row
-- without freeing the value.
ALTER TABLE "DisplayId"
    ADD CONSTRAINT "DisplayId_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Belt-and-suspenders against application-code bugs that try to mutate a
-- value. Application services never write through this column; only the
-- issuance path inserts a new row. The trigger rejects any UPDATE that
-- changes `value`.
CREATE OR REPLACE FUNCTION "displayId_value_is_immutable"() RETURNS TRIGGER AS $$
BEGIN
    IF NEW."value" IS DISTINCT FROM OLD."value" THEN
        RAISE EXCEPTION 'DisplayId.value is immutable (attempted to change % to %)', OLD."value", NEW."value";
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DisplayId_value_immutable_trigger"
    BEFORE UPDATE ON "DisplayId"
    FOR EACH ROW
    EXECUTE FUNCTION "displayId_value_is_immutable"();

-- Append-only ops signal: every collision retry during random generation
-- gets logged. Empty in normal operation; if it grows fast, the namespace
-- is closer to exhaustion than expected (cheap insurance).
CREATE TABLE "DisplayIdCollisionLog" (
    "id" TEXT NOT NULL,
    "attemptedValue" TEXT NOT NULL,
    "class" "DisplayIdClass" NOT NULL,
    "attempts" INTEGER NOT NULL,
    "resolvedValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisplayIdCollisionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DisplayIdCollisionLog_createdAt_idx" ON "DisplayIdCollisionLog"("createdAt");

-- Denormalized fast-path column on User. Source of truth is the DisplayId
-- ledger row; this column is the cached read-path so admin queries don't
-- have to JOIN every time. Nullable here because the migration is additive
-- — a later migration drops it to NOT NULL after the backfill runs and
-- verifies zero nulls remain.
ALTER TABLE "User" ADD COLUMN "displayId" TEXT;

CREATE UNIQUE INDEX "User_displayId_key" ON "User"("displayId");
