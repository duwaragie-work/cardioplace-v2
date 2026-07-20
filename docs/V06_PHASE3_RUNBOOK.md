# V-06 phase 3 — dropping the plaintext columns

**Status: gates 1–5 are GREEN as of 2026-07-17 (dev DB). Phase 3 still needs the bake.**
Owner: Dev 3 (Niva). Written 2026-07-17 alongside phase 2 (`10cd5d0`).

> ### Executed 2026-07-17 against the dev DB (db.prisma.io)
> | Gate | Result |
> |---|---|
> | 1. Apply 4 pending migrations | ✅ `migrate deploy` — all 4 applied. Pre-flight confirmed **0** `DeviationType.WEIGHT` rows, so the enum rebuild could not abort. |
> | 2. `MFA_ENCRYPTION_KEY` | ✅ Dev key generated into the gitignored `.env`. (Also replaced a `change-me-…` `JWT_SECRET` placeholder that was blocking boot — pre-existing, unrelated.) |
> | 3. `Conversation` LEFT JOIN fix | ✅ `86b7117`. Note: **0 orphans exist today** — the fix is defensive against a state the schema permits (`sessionId` has no FK). |
> | 4. Backfill | ✅ **1282 rows** across all 14 columns. Verification: *"no candidate rows remain."* |
> | 5. Audit scrub | ✅ **159 historical rows** scrubbed. Verification: *"no plaintext free-text remains in the audit Json."* |
> | 6. Bake reads | ✅ **Discharged by exhaustive proof instead of soak time** — see below. |
> | 7. Phase 3 drop | ⛔ **Not a data-safety question any more — a release-coordination one.** See "What phase 3 still costs". |
>
> **Exhaustive decrypt proof (2026-07-17).** The bake exists to surface decrypt
> failures *while the plaintext fallback still exists*. Rather than wait for time
> to pass, every envelope in the DB was decrypted with the key the app holds and
> compared against its surviving plaintext — the last moment that comparison is
> possible, since phase 3 deletes the right-hand side:
> **2564 checked · 0 undecryptable · 0 mismatched**, across all 14 columns.
> This is what the gate SQL *cannot* tell you: the gate proves ciphertext EXISTS,
> not that it is READABLE — a wrong-key backfill would satisfy the gate and still
> destroy the data on DROP. On this DB, the drop would lose nothing.
>
> **End-to-end verified:** every plaintext column has a ciphertext sibling (gap=0 on all 10 populated pairs); a real envelope round-trips (`decrypt(ciphertext) === plaintext`) **and** the `v06-decrypt` extension returns the decrypted value on a live read; 0 audit rows carry free-text keys.
>
> **Two script bugs only the first real run could find** (`611df36`) — both would have hit whoever ran this next:
> - **Backfill:** Prisma's 5s interactive-transaction default is tuned for a local DB; against managed Postgres the per-row commit hit **6799 ms** → P2028 mid-run. Raised to 30s. (The run is resumable — 161 rows had already committed and the retry resumed cleanly, which is the per-row transaction design working.)
> - **Scrub:** it never loaded `dotenv`, so `DATABASE_URL` was undefined and `pg` silently fell back to localhost → `ECONNREFUSED`. And its live loop only advanced the offset under `DRY_RUN`, on the borrowed assumption that scrubbed rows "drop out of the scan" — true of the backfill (whose `loadBatch` filters) but **false here**, where the `findMany` has no `WHERE` at all. Live mode re-read the same 500 rows until killed.
>
> **This was the dev DB only.** Every gate below must be re-run per environment.
>
> ### What phase 3 still costs — and why it is not a solo action
> Data safety is settled (above). What remains is a **release-coordination
> problem**, and it is the reason this is not simply "one more commit":
>
> - **`Conversation.userMessage` and `aiSummary` are NOT NULL.** So the code
>   change (~60 write sites dropping the plaintext key) and the DROP migration
>   **must land in the same deploy, in that order**. If the code ships to an
>   environment whose migration has not run, every Conversation insert violates
>   NOT NULL. If the migration ships first and the gate correctly REFUSES (that
>   environment never backfilled), the pipeline must abort the whole deploy —
>   not ship the code anyway.
> - **Staging and prod have not run gates 1–5.** They have no `MFA_ENCRYPTION_KEY`,
>   no applied migration, no backfill. Landing phase 3 on `nivakaran-dev` puts a
>   self-gating DROP into the migration history that will **block their next
>   deploy** until each is backfilled. That is the gate doing its job, but it is a
>   cross-team event, not a local one.
> - **Reads keep compiling only if `result` lands with it.** Dropping the columns
>   removes the fields from the generated Prisma types; the `query` extension
>   supplies the value but not the type. Without a `result` component in the same
>   change, ~156 read sites stop compiling.
>
> So phase 3 wants: one PR, all three parts, merged when staging/prod are ready to
> run their own gates 1–5 in the same window. It is scoped and de-risked; it needs
> a release slot and Duwaragie's sequencing, not more engineering.

Phase 3 is the step that actually delivers §164.312(a)(2)(iv). Phases 1 and 2 only
build up to it: while the plaintext column still exists, a DB dump still yields
every clinical free-text field in the clear, and the ciphertext is just a second
copy. **The control nets to zero until the plaintext is gone.**

It is also the only irreversible step. Hence this runbook.

---

## Where things actually stand (measured 2026-07-17, not assumed)

| Gate | State |
|---|---|
| V-06 migration `20260716120000_v06_add_encrypted_columns` applied | ❌ **No** — still pending. 3 other migrations are also unapplied. (An earlier revision of this runbook called it "untracked in git / local-only" — that was **wrong**: it is committed in `231af26` on `nivakaran-dev`. It is not on `origin/dev` yet, which is a merge, not a loss.) |
| `MFA_ENCRYPTION_KEY` set | ❌ **No** — absent from `backend/.env`, blank in `.env.example`. |
| Ciphertext rows written | ❌ **0** — the `*Encrypted` columns do not exist in the dev DB yet. |
| Backfill run + verified green | ❌ Never run. |
| Audit scrub (`v06-scrub-audit-snapshots.ts`) run | ❌ Never run. |
| Reads flipped | ✅ `10cd5d0` — but unexercised, because there is no ciphertext to read. |

**Read that table before planning any of this work.** "V-06 phase 1 complete"
means the dual-write *code* is merged, not that anything is encrypted anywhere.
The columns do not exist; the key is unset; nothing has ever been encrypted.

---

## Gate order (each one blocks the next)

1. **Apply the pending migrations.** `20260716120000_v06_add_encrypted_columns`
   is committed (`231af26`) but lives only on `nivakaran-dev` — it reaches other
   environments when that branch merges.
   `npx prisma migrate deploy` (forward-only; never `migrate dev` against a
   shared DB — it can reset).
2. **Set `MFA_ENCRYPTION_KEY`** in every environment.
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   As of `ba49505` the app refuses to boot without it. Rotating it later strands
   every existing ciphertext — the envelope carries no key-version field.
3. **Fix the `Conversation` backfill inner-JOIN on `Session`**
   (`scripts/v06-backfill-encryption.ts:110-111`). Orphaned conversations are
   silently skipped, then fail the verification pass at the end. Fix before
   running, not after.
4. **Run the backfill.** `DRY_RUN=1` first, then live. Must exit 0.
5. **Run the audit scrub.** `DRY_RUN=1 npm exec tsx scripts/v06-scrub-audit-snapshots.ts`,
   then live. Must exit 0 — exit 2 means plaintext still sits in the audit Json.
   **This gate is not optional.** `ProfileVerificationLog.newValue` holds verbatim
   copies of the same bytes; if it is not scrubbed, dropping the source columns
   just makes the audit log the last plaintext copy standing and the whole
   exercise nets to zero.
6. **Bake the read path.** Reads must run on real ciphertext long enough to trust.
   Watch for the `V-06 decrypt failed for … falling back to the plaintext column`
   error from `PrismaService` — while plaintext exists that fallback silently
   saves you, and it is exactly what disappears in step 7.
7. **Then, and only then, phase 3.**

---

## What phase 3 actually changes (code, not just SQL)

Dropping the column removes the field from the generated Prisma types, so this
is not a migration-only PR:

- **Reads (~156 sites) — no call-site changes, but needs a `result` component.**
  `v06-decrypt.extension.ts` already synthesises the *value* from the sibling
  once the plaintext is gone. It cannot supply the *type*. Add a `result`
  component (`needs: { notesEncrypted: true }` + `compute`) per field so the read
  sites keep compiling.
- **Writes (~60 sites) — must drop the plaintext key, same deploy as the migration.**
  `data: { notes, notesEncrypted }` → `data: { notesEncrypted }`. Not separable:
  `Conversation.userMessage` and `aiSummary` are **NOT NULL**, so a deploy that
  stops writing them while the columns still exist fails every insert. For the
  other 12 (nullable) the two steps *could* be split, but there is no reason to.
- **`schema.prisma`** — remove the 14 plaintext fields.
- **The decrypt-failure policy flips from soft to hard**, by design: with no
  plaintext to fall back on, `decryptTree` rethrows. That is deliberate —
  silently serving `undefined` for a clinical note hides it from a clinician.
  Expect a bad key to become a loud outage rather than a quiet degradation.

## The 14 columns

| Table | plaintext | sibling | note |
|---|---|---|---|
| Conversation | `userMessage` | `userMessageEncrypted` | **NOT NULL** |
| Conversation | `aiSummary` | `aiSummaryEncrypted` | **NOT NULL** |
| Session | `title` | `titleEncrypted` | |
| Session | `summary` | `summaryEncrypted` | 5 explicit `select` sites |
| JournalEntry | `otherSymptoms` | `otherSymptomsEncrypted` | `String[]`, JSON envelope |
| JournalEntry | `teachBackAnswer` | `teachBackAnswerEncrypted` | |
| JournalEntry | `notes` | `notesEncrypted` | |
| EscalationEvent | `reason` | `reasonEncrypted` | |
| PatientMedication | `rawInputText` | `rawInputTextEncrypted` | |
| PatientMedication | `notes` | `notesEncrypted` | |
| PatientMedication | `plainLanguageDescription` | `plainLanguageDescriptionEncrypted` | |
| PatientProfile | `aceContraindicationReason` | `aceContraindicationReasonEncrypted` | |
| PatientThreshold | `notes` | `notesEncrypted` | |
| ProfileVerificationLog | `rationale` | `rationaleEncrypted` | |

`TotpCredential.secretEncrypted` is **not** in scope — it has no plaintext twin
and belongs to MFA, not V-06.

---

## The migration SQL (self-gating)

**Deliberately NOT placed in `prisma/migrations/` yet.** Anything under that
directory is applied by the next `prisma migrate deploy`, which could drop
plaintext before the backfill has ever run. Promote it into a migration
directory only when gates 1–6 are green.

The `DO` block makes the gate structural rather than a thing someone has to
remember: if a single row still has plaintext without ciphertext, the migration
aborts and the transaction rolls back — nothing is dropped. Running it early is
safe; it fails instead of destroying.

```sql
-- V-06 phase 3: drop plaintext columns. REFUSES to run if the backfill is incomplete.
DO $$
DECLARE
  gap BIGINT;
BEGIN
  -- Nullable columns: plaintext present but no ciphertext = not backfilled.
  SELECT
    (SELECT COUNT(*) FROM "Session"                WHERE "title"                     IS NOT NULL AND "titleEncrypted"                     IS NULL)
  + (SELECT COUNT(*) FROM "Session"                WHERE "summary"                   IS NOT NULL AND "summaryEncrypted"                   IS NULL)
  + (SELECT COUNT(*) FROM "JournalEntry"           WHERE "teachBackAnswer"           IS NOT NULL AND "teachBackAnswerEncrypted"           IS NULL)
  + (SELECT COUNT(*) FROM "JournalEntry"           WHERE "notes"                     IS NOT NULL AND "notesEncrypted"                     IS NULL)
  + (SELECT COUNT(*) FROM "EscalationEvent"        WHERE "reason"                    IS NOT NULL AND "reasonEncrypted"                    IS NULL)
  + (SELECT COUNT(*) FROM "PatientMedication"      WHERE "rawInputText"              IS NOT NULL AND "rawInputTextEncrypted"              IS NULL)
  + (SELECT COUNT(*) FROM "PatientMedication"      WHERE "notes"                     IS NOT NULL AND "notesEncrypted"                     IS NULL)
  + (SELECT COUNT(*) FROM "PatientMedication"      WHERE "plainLanguageDescription"  IS NOT NULL AND "plainLanguageDescriptionEncrypted"  IS NULL)
  + (SELECT COUNT(*) FROM "PatientProfile"         WHERE "aceContraindicationReason" IS NOT NULL AND "aceContraindicationReasonEncrypted" IS NULL)
  + (SELECT COUNT(*) FROM "PatientThreshold"       WHERE "notes"                     IS NOT NULL AND "notesEncrypted"                     IS NULL)
  + (SELECT COUNT(*) FROM "ProfileVerificationLog" WHERE "rationale"                 IS NOT NULL AND "rationaleEncrypted"                 IS NULL)
  -- NOT NULL columns: any missing ciphertext at all is a gap.
  + (SELECT COUNT(*) FROM "Conversation"           WHERE "userMessageEncrypted" IS NULL)
  + (SELECT COUNT(*) FROM "Conversation"           WHERE "aiSummaryEncrypted"   IS NULL)
  -- String[]: the backfill skips empty arrays, so an all-empty row legitimately
  -- has a NULL sibling forever. Only a NON-empty array without ciphertext is a gap.
  -- (decryptTree reads both "[]" and NULL as [] — v06-decrypt.extension.ts.)
  + (SELECT COUNT(*) FROM "JournalEntry"           WHERE "otherSymptoms" <> '{}' AND "otherSymptomsEncrypted" IS NULL)
  INTO gap;

  IF gap > 0 THEN
    RAISE EXCEPTION
      'V-06 phase 3 REFUSED: % row(s) still hold plaintext with no ciphertext. '
      'Run scripts/v06-backfill-encryption.ts to completion first. Nothing was dropped.', gap;
  END IF;
END $$;

ALTER TABLE "Conversation"           DROP COLUMN "userMessage";
ALTER TABLE "Conversation"           DROP COLUMN "aiSummary";
ALTER TABLE "Session"                DROP COLUMN "title";
ALTER TABLE "Session"                DROP COLUMN "summary";
ALTER TABLE "JournalEntry"           DROP COLUMN "otherSymptoms";
ALTER TABLE "JournalEntry"           DROP COLUMN "teachBackAnswer";
ALTER TABLE "JournalEntry"           DROP COLUMN "notes";
ALTER TABLE "EscalationEvent"        DROP COLUMN "reason";
ALTER TABLE "PatientMedication"      DROP COLUMN "rawInputText";
ALTER TABLE "PatientMedication"      DROP COLUMN "notes";
ALTER TABLE "PatientMedication"      DROP COLUMN "plainLanguageDescription";
ALTER TABLE "PatientProfile"         DROP COLUMN "aceContraindicationReason";
ALTER TABLE "PatientThreshold"       DROP COLUMN "notes";
ALTER TABLE "ProfileVerificationLog" DROP COLUMN "rationale";
```

**Take a restorable backup first anyway.** The guard proves the ciphertext
*exists*; it cannot prove the ciphertext is *decryptable* with the key the app
actually holds. A wrong-key backfill would pass this check and lose the data.
Before dropping, verify a sample of rows round-trips through the running app —
gate 6's bake is what buys that confidence.

## Out of scope (separate tickets)

- `DeviationAlert` free-text (`resolutionDetails`, `patientMessage`,
  `caregiverMessage`, `physicianMessage`, `resolutionRationale`) — plaintext, no
  siblings. A real gap, but outside the addendum's four buckets.
- `PatientCaregiver` name/email/phone — never scoped by V-06.
- Numeric BP/pulse — the addendum defers it pending the SQL-vs-in-app
  aggregation decision.
