-- Human-readable, prefixed, permanent identifier for every User account.
-- Issued once at account creation. Locked forever — even on deactivation or
-- future hard-delete, the value row survives in this ledger so the same
-- string can never be re-issued. Full spec in
-- docs/UNIQUE_IDENTIFIER_PROPOSAL_2026_06_24.md.
--
-- Format: CP-PAT-XXXXXXX-C (patient) / CP-STF-XXXXXXX-C (staff). 7 random
-- Crockford-base32 chars + 1 Luhn-mod-32 check char.
--
-- This is a SINGLE atomic migration that does DDL + backfill + NOT NULL
-- constraint in one transaction. It supersedes the broken two-migration
-- design (this one + 20260624150000_make_user_display_id_required) where
-- existing-users databases failed on the SET NOT NULL step because the
-- TS backfill script was outside the migration chain (operators had to
-- remember to run it before `prisma migrate deploy`, which they didn't,
-- and Railway's start command runs migrate deploy on every boot).
--
-- Atomic shape: if the backfill block raises (collision exhaustion, RNG
-- fault, anything), the whole migration aborts and nothing partial sticks.
-- Fresh databases run an empty backfill loop (no-op) and proceed to the
-- ALTER COLUMN SET NOT NULL with zero rows to violate it.
--
-- The TS DisplayIdService at backend/src/users/display-id.service.ts stays
-- the source of truth for production user-create paths. The PL/pgSQL
-- helpers below are scoped to this migration and dropped at the end.

-- Required for gen_random_bytes() used in random body generation.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── DDL (unchanged from original migration) ─────────────────────────────────

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
-- have to JOIN every time. Added nullable so the backfill (next section)
-- can populate it, then tightened to NOT NULL at the bottom of this file.
ALTER TABLE "User" ADD COLUMN "displayId" TEXT;

CREATE UNIQUE INDEX "User_displayId_key" ON "User"("displayId");

-- ─── Backfill helpers (temporary, dropped at end of this migration) ──────────

-- Port of backend/src/users/display-id.service.ts:computeCheckDigit().
-- Luhn-mod-32. Alphabet '0123456789ABCDEFGHJKMNPQRSTVWXYZ' (no I, L, O, U).
-- Factor alternates 2, 1, 2, 1... from right to left across the 7-char body.
-- The check digit (to-be-appended) implicitly has factor=1, so we start
-- with factor=2 at the rightmost body char. Sum-of-base-32-digits per char
-- (the inner WHILE loop reduces multi-digit addends back into the range).
-- Final check char = ALPHABET[(32 − sum%32) % 32].
CREATE OR REPLACE FUNCTION _displayid_check_digit(body TEXT) RETURNS TEXT AS $$
DECLARE
    alphabet CONSTANT TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    radix CONSTANT INT := 32;
    i INT;
    cp INT;
    addend INT;
    sum_total INT := 0;
    factor INT := 2;
    remainder INT;
    check_idx INT;
BEGIN
    FOR i IN REVERSE length(body)..1 LOOP
        cp := position(substring(body, i, 1) IN alphabet) - 1;
        IF cp < 0 THEN
            RAISE EXCEPTION 'displayId check-digit: char % not in Crockford alphabet', substring(body, i, 1);
        END IF;
        addend := cp * factor;
        WHILE addend >= radix LOOP
            addend := (addend / radix) + (addend % radix);
        END LOOP;
        sum_total := sum_total + addend;
        factor := CASE WHEN factor = 2 THEN 1 ELSE 2 END;
    END LOOP;
    remainder := sum_total % radix;
    check_idx := (radix - remainder) % radix;
    RETURN substring(alphabet, check_idx + 1, 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Generates 7 random Crockford-base32 characters. Each output char comes
-- from one cryptographically-random byte mod 32 — uniformly distributed
-- across the 32-char alphabet (256 / 32 = 8 buckets per char, no bias).
CREATE OR REPLACE FUNCTION _displayid_random_body() RETURNS TEXT AS $$
DECLARE
    alphabet CONSTANT TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    bytes BYTEA;
    body TEXT := '';
    i INT;
BEGIN
    bytes := gen_random_bytes(7);
    FOR i IN 1..7 LOOP
        body := body || substring(alphabet, (get_byte(bytes, i - 1) % 32) + 1, 1);
    END LOOP;
    RETURN body;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- ─── Backfill block ──────────────────────────────────────────────────────────
--
-- For every existing User with displayId NULL: pick the class from roles
-- (PATIENT class if 'PATIENT' anywhere in roles, else STAFF), generate a
-- canonical ID, insert into DisplayId ledger + update User.displayId. On
-- ledger-PK or User-unique collision retry up to 5 times (32^7 = 34 billion
-- combinations, so collisions are vanishingly rare even at full-cohort scale).
--
-- Idempotent by construction: WHERE "displayId" IS NULL. On a fresh DB the
-- loop runs zero iterations and the SET NOT NULL below trivially succeeds.
--
-- FOR UPDATE locks each row so a concurrent migrate-deploy (single deploy
-- is the norm, this is belt-and-suspenders) can't race.
DO $$
DECLARE
    rec RECORD;
    cls TEXT;
    prefix TEXT;
    body TEXT;
    check_char TEXT;
    canonical TEXT;
    display_form TEXT;
    attempt INT;
    issued BOOLEAN;
BEGIN
    FOR rec IN
        SELECT "id", "roles" FROM "User" WHERE "displayId" IS NULL FOR UPDATE
    LOOP
        IF 'PATIENT' = ANY (rec."roles"::TEXT[]) THEN
            cls := 'PATIENT';
            prefix := 'PAT';
        ELSE
            cls := 'STAFF';
            prefix := 'STF';
        END IF;

        issued := FALSE;
        FOR attempt IN 1..5 LOOP
            body := _displayid_random_body();
            check_char := _displayid_check_digit(body);
            -- Canonical (no-hyphen) form is the lock-forever anchor stored in
            -- both DisplayId.value and User.displayId. The display column gets
            -- the hyphenated presentation form CP-PAT-XXXXXXX-C, matching
            -- DisplayIdService.formatForDisplay() so backfilled rows are
            -- byte-identical to runtime-issued ones.
            canonical := 'CP' || prefix || body || check_char;
            display_form := 'CP-' || prefix || '-' || body || '-' || check_char;
            BEGIN
                INSERT INTO "DisplayId" ("value", "display", "class", "userId", "issuedVia")
                    VALUES (canonical, display_form, cls::"DisplayIdClass", rec."id", 'BACKFILL_MIGRATION_20260624');
                UPDATE "User" SET "displayId" = canonical WHERE "id" = rec."id";
                issued := TRUE;
                EXIT;
            EXCEPTION WHEN unique_violation THEN
                -- value/display/User.displayId collision — retry with a new body
                NULL;
            END;
        END LOOP;

        IF NOT issued THEN
            RAISE EXCEPTION 'displayId backfill: collision retries exhausted for user % (RNG fault or namespace pressure)', rec."id";
        END IF;
    END LOOP;
END $$;

-- ─── Tighten constraint ──────────────────────────────────────────────────────
-- All existing rows now have displayId. Every code path that inserts a User
-- pre-generates displayId via DisplayIdService.issueForCreate() (see header).
-- Safe to forbid NULL.
ALTER TABLE "User" ALTER COLUMN "displayId" SET NOT NULL;

-- ─── Cleanup ─────────────────────────────────────────────────────────────────
DROP FUNCTION _displayid_check_digit(TEXT);
DROP FUNCTION _displayid_random_body();
