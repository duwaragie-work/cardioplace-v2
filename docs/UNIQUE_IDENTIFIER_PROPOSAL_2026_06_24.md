# Cardioplace v2 — Human-readable Unique Identifier (Display ID) Proposal

**Date:** 2026-06-24
**Author:** Duwaragie Kugaraj (Dev 3) with Claude
**Status:** Proposal — pending CMO + founder review
**Scope:** Permanent, human-readable identifier for every user account — patients and admins — issued at account creation, locked forever.

---

## 1. Why this is being proposed

Today every Cardioplace v2 user is referenced internally by `User.id`, which is a **ULID** ([backend/prisma/schema/user.prisma:2](../backend/prisma/schema/user.prisma#L2)). That's correct for the database, but it's not something a coordinator can read over the phone, a clinician can paste into a paper chart, or a patient can quote when calling support.

The CMO has asked for a permanent, prefixed, human-readable identifier — issued at account creation, locked forever (no reuse even after deletion). It should work for:
- **Patients** registering via either self-enrollment (OTP) or coordinator-led invite
- **Admins** in every non-patient role (PROVIDER, MEDICAL_DIRECTOR, COORDINATOR, HEALPLACE_OPS, SUPER_ADMIN)

This document proposes the format, the schema additions, the generation timing, the role-prefix decision, and the migration plan.

---

## 2. Current state (verified against the codebase)

- **`User.id`** = ULID. ([user.prisma:2](../backend/prisma/schema/user.prisma#L2))
- **No human-readable identifier exists today.** Grep across `backend/prisma/schema/`, `shared/src/`, and the codebase returned 0 hits for `displayId`, `mrn`, `publicId`, `memberNumber`, `patientCode`.
- **`UserRole` enum** has 6 values: `PATIENT, PROVIDER, MEDICAL_DIRECTOR, COORDINATOR, HEALPLACE_OPS, SUPER_ADMIN`. **`NURSE` is not in the enum.** ([user.prisma:66-73](../backend/prisma/schema/user.prisma#L66))
- **`User.roles` is an array** (`UserRole[]`) — the codebase already supports multi-role users. Invite acceptance merges roles. ([user.prisma:11](../backend/prisma/schema/user.prisma#L11), [auth.service.ts:3221](../backend/src/auth/auth.service.ts#L3221))
- **No hard delete** — `AccountStatus` enum has `ACTIVE | BLOCKED | SUSPENDED | DEACTIVATED`. Users are soft-deactivated, never removed.
- **User-create sites**: 4, all in [backend/src/auth/auth.service.ts](../backend/src/auth/auth.service.ts):
  - OAuth (Google): line 2321
  - OTP self-enroll: line 2528
  - Magic-link verify: line 2981
  - Invite acceptance (Path B): line 3232 — already wrapped in `$transaction` from L3189
- **Invite lifecycle**: `UserInvite.createdUserId` is nullable until acceptance ([user_invite.prisma:25](../backend/prisma/schema/user_invite.prisma#L25)) — schema already treats the user as materializing at acceptance.

---

## 3. EHR research findings

| Topic | Finding |
|---|---|
| Federal patient-ID standard | None under HIPAA. Each org defines its own. |
| Patient ID length in practice | Stanford: 7 digits + 1-letter prefix. Hospitals commonly 6–10 digits. |
| Provider ID national standard | NPI = 10 numeric digits, validated with Luhn-mod-10 after prepending `80840`. |
| Check-digit algorithm | Luhn (mod 10) is the de-facto healthcare standard — detects all single-digit errors + most adjacent transpositions. |
| Sequential vs random allocation | **Sequential IDs are an enumeration-attack vector** with documented breaches. Random is best practice. |
| Reuse policy | Clinical trials NEVER reassign patient IDs. Hospital practice varies; best practice is no reuse for compliance + audit integrity. |
| Per-role prefix for staff | EHRs do NOT enforce role prefixes — facility-configurable. NPI itself is role-agnostic. Per-role prefix is at odds with role mobility (PROVIDER → MEDICAL_DIRECTOR promotion). |

Sources: AHIMA practice briefs, Wikipedia NPI, CMS administrative simplification, UConn Epic data elements PDF, OpenMRS check-digit docs, Stanford MRN format, Security Boulevard "Opaque IDs".

---

## 4. Recommended format

### 4.1 Patient identifier

```
CP-PAT-XXXXXXX-C
```

**Example**: `CP-PAT-K8M2R4N-7`

### 4.2 Admin / Staff identifier (one common prefix — see §6 for why)

```
CP-STF-XXXXXXX-C
```

**Example**: `CP-STF-9F2K8MR-J`

### 4.3 Components

| Part | Meaning | Notes |
|---|---|---|
| `CP` | Brand prefix (Cardioplace) | Constant. Identifies the source when an ID is pasted into a foreign system (ticket, email, paper note). |
| `PAT` / `STF` | Population class | Patient vs staff — the only two classes. Class is **initial population**, not current role array (a patient who later joins staff keeps `PAT`). |
| `XXXXXXX` | 7 random characters | **Crockford base32** alphabet (`0123456789ABCDEFGHJKMNPQRSTVWXYZ` — drops `I`, `L`, `O`, `U` to remove human read-aloud confusion). 32⁷ ≈ 34 billion keyspace per class. |
| `C` | Check digit | **Luhn-mod-32** (same family as NPI's mod-10, extended to the 32-symbol alphabet). |

### 4.4 Length rationale

7 base-32 chars matches Stanford's well-tested 7-digit MRN scheme in keyspace (~34 billion) but in fewer characters. With ~10K patients expected in pilot year-one and 34B namespace per class, birthday-collision probability becomes interesting around 200K live IDs — well beyond pilot scope.

### 4.5 Canonical storage vs display

What lives in the DB drops hyphens and uppercases: `CPPATK8M2R4N7`. Hyphens are presentation-only.

A normalizer in `DisplayIdService.normalize(input)` maps any user input (mixed case, with or without hyphens, Crockford-ambiguous chars like `O`↔`0`, `I/L`↔`1`) to canonical form before lookup. This matters because admins paste IDs from wrapped emails, Word docs, copy-paste of speech-to-text — they will not type the canonical form by hand.

---

## 5. Lock-forever guarantee

Three layers of defense ensure an issued ID is **never** reused:

1. **`DisplayId` ledger table** — append-only, separate from `User`. One row per ever-issued ID. The `value` column is the primary key. Once a row exists, the value is taken forever.
2. **`onDelete: SetNull`** on the User foreign key — if a User is ever hard-deleted (currently impossible per `accountStatus` soft-state, but defense in depth), the `userId` is nullified but the value row survives. Tombstoned IDs share the same unique-value namespace as live IDs.
3. **Postgres trigger `BEFORE UPDATE OF value`** — raises an error on any attempt to mutate the `value` column. Application code has no path to write through this column.

A separate hard guard: the patient/admin services never expose any code path that updates `displayId` on `User`. Only the issuance service writes it, and only once.

---

## 6. Why ONE common admin prefix, not per-role

This is the decision the CMO specifically asked for analysis on. The recommendation is **one common `STF` prefix** for all admin roles. Three reasons, in order of weight:

### 6.1 The codebase already supports multi-role users

`User.roles` is `UserRole[]` (an array), not a single value ([user.prisma:11](../backend/prisma/schema/user.prisma#L11)). The invite-acceptance path at [auth.service.ts:3221](../backend/src/auth/auth.service.ts#L3221) explicitly merges new roles into the existing array:

```typescript
const merged = Array.from(new Set([...existing.roles, fresh.role]))
```

A user can simultaneously be both `PROVIDER` and `MEDICAL_DIRECTOR`. What prefix do you give them in a per-role scheme? Any answer is wrong.

### 6.2 The "lock forever" rule conflicts with role-specific prefixes

Promotions are foreseeable — a PROVIDER promoted to MEDICAL_DIRECTOR is normal career progression the system already supports. If the prefix encodes role, either:
- (a) you reissue the ID on promotion → violates lock-forever, or
- (b) the prefix lies after promotion ("CP-PRO-..." but they're now a Medical Director) → misleading.

Both options are worse than a role-agnostic ID with a separate role chip in the UI.

### 6.3 EHR practice agrees

- **NPI** (the universal US provider identifier) has zero role encoding in its 10 digits — same format whether you're a nurse, physician, or nursing home.
- **Stanford** uses a single-letter prefix for the whole population, not per-role.
- Where role-prefix IDs *do* appear in healthcare (e.g. badge IDs), they're explicitly separate from the permanent provider record and are reissued on role change. They're not the same kind of identifier the CMO is asking for.

### 6.4 The right way to surface role at-a-glance

Render the display ID alongside a role chip:

```
CP-STF-9F2K8MR-J · Provider
CP-STF-X4Q2H7N-K · Medical Director
CP-STF-2J9F8MR-T · Coordinator
```

The chip can change; the ID cannot. This gives admins the at-a-glance signal they want without breaking the immutability rule.

### 6.5 Note on NURSE

The user mentioned `NRS` for nurse. **`NURSE` is NOT in the current `UserRole` enum.** If a NURSE role is added later, the scheme accommodates it trivially under the `STF` umbrella — same prefix, role chip updates. No schema change needed.

---

## 7. Schema additions

**Additive only** — no breaking changes to existing models. Single migration `2026XXXX_add_display_id` adds two new models + one column on `User`.

### 7.1 New: `DisplayId` (the immutable ledger)

```prisma
model DisplayId {
  // Canonical value (hyphen-stripped, uppercased), e.g. "CPPATK8M2R4N7"
  value         String          @id

  // Human-display version, with hyphens, e.g. "CP-PAT-K8M2R4N-7"
  display       String          @unique

  // Population class — patient or staff
  class         DisplayIdClass

  // Live owner. NULL once tombstoned. Unique constraint on value (not on
  // (value, userId)), so tombstoned IDs cannot be re-issued.
  userId        String?         @unique
  user          User?           @relation(fields: [userId], references: [id], onDelete: SetNull)

  issuedAt      DateTime        @default(now())
  tombstonedAt  DateTime?

  // Audit hint: which code path issued this ID.
  // Values: "otp" | "magic_link" | "google_oauth" | "invite_accept" | "backfill"
  issuedVia     String

  @@index([class, issuedAt])
}

enum DisplayIdClass {
  PATIENT
  STAFF
}
```

### 7.2 New: `DisplayIdCollisionLog` (optional, recommended)

Append-only, captures every collision retry during random generation. Cheap insurance — if this table grows fast, the namespace is closer to exhaustion than expected.

```prisma
model DisplayIdCollisionLog {
  id            String   @id @default(ulid())
  attemptedValue String
  class         DisplayIdClass
  attempts      Int
  resolvedValue String
  createdAt     DateTime @default(now())

  @@index([createdAt])
}
```

### 7.3 Change to `User`

```prisma
model User {
  // ... existing fields ...

  // v2 — public-facing identifier. Set once at account creation, never
  // changed. Mirrors DisplayId.value (canonical form) for fast joins and
  // indexed search. Source of truth is the DisplayId table.
  displayId     String?  @unique

  // ... rest of model ...
}
```

`displayId` is nullable only for the additive migration window. After backfill verifies zero nulls, a follow-up migration drops it to `NOT NULL`.

### 7.4 Why both a ledger table AND a column on User

Intentional duplication:

- **`DisplayId` table** is the immutable audit anchor — proves "this ID was ever issued, to whom, when, via which code path."
- **`User.displayId` column** is the fast read-path. Every admin patient-list query, every alert email, every dashboard header needs the display ID alongside other User fields. Going through a join on every call is wasteful.

The two stay consistent by writing both in the same transaction, always via `DisplayIdService.issue()`, never directly.

---

## 8. Generation algorithm

### 8.1 Random with check digit (not sequential)

1. Generate 7 chars from CSPRNG (`crypto.randomInt` per char — NOT `Math.random`).
2. Append Luhn-mod-32 check character.
3. Insert into `DisplayId` inside the same transaction as the `User.create`.
4. On `P2002` unique violation: log to `DisplayIdCollisionLog`, retry up to 3 times.
5. After 3 failed attempts: throw 500 and page on-call. At pilot scale this should never happen — if it does, the RNG is broken or the namespace is exhausted, both of which need a human.

### 8.2 Where the generation hook fires

| Path | File:Line | Class | Transaction state today |
|---|---|---|---|
| OAuth (Google) | [auth.service.ts:2321](../backend/src/auth/auth.service.ts#L2321) | PATIENT | Not wrapped — needs `$transaction` wrapper |
| OTP self-enroll (Path A) | [auth.service.ts:2528](../backend/src/auth/auth.service.ts#L2528) | PATIENT | Not wrapped — needs wrapper |
| Magic-link verify | [auth.service.ts:2981](../backend/src/auth/auth.service.ts#L2981) | PATIENT | Not wrapped — needs wrapper |
| Invite acceptance (Path B) | [auth.service.ts:3232](../backend/src/auth/auth.service.ts#L3232) | PATIENT or STAFF (from `fresh.role`) | Already inside `tx` at L3189 — free wrapping |

Pattern (sketch):

```typescript
user = await this.prisma.$transaction(async (tx) => {
  const created = await tx.user.create({ data: { email, ... } })
  const { value } = await this.displayIdService.issue(
    tx,
    created.id,
    classFromRole(created.roles),
    'otp', // or 'magic_link', 'google_oauth', 'invite_accept'
  )
  return tx.user.update({
    where: { id: created.id },
    data: { displayId: value },
  })
})
```

### 8.3 Timing for Path B (coordinator invite): at acceptance, not at invite-creation

**Reasons:**
- Invites can expire (48h default, `USER_INVITE_TTL_HOURS`) or be revoked. Issuing at invite-create burns IDs for users who never exist. Each burn is permanent (lock-forever rule).
- `UserInvite.createdUserId` is already nullable until acceptance ([user_invite.prisma:25](../backend/prisma/schema/user_invite.prisma#L25)) — the schema lifecycle already says "the user materializes at acceptance."
- The find-or-create branch at [auth.service.ts:3209-3241](../backend/src/auth/auth.service.ts#L3209) handles the case where the invited email already has a User (e.g. they OTP'd in first, then got invited). Issuing at invite-create would either burn a second ID or require complex back-fill logic. Acceptance-time issuance gives us "user already has displayId → skip" trivially.

**Operational trade-off**: coordinators don't see the patient's display ID until acceptance. **Mitigation**: the invite list in the admin UI shows "Pending — ID will be issued on activation" until accepted.

---

## 9. Where the identifier shows up

| Surface | Treatment |
|---|---|
| **Admin patient list** ([UserInvitePanel.tsx](../admin/src/components/user-management/UserInvitePanel.tsx) + child `UsersList`) | New searchable column after name. Search normalizes input before lookup. |
| **Admin patient detail header** ([PatientDetailShell.tsx:72-80](../admin/src/components/patient-detail/PatientDetailShell.tsx#L72)) | Show under patient name, copyable on click. |
| **Admin alert card** ([AlertPanel.tsx](../admin/src/components/AlertPanel.tsx)) | Replace raw `userId` with `displayId` wherever currently shown. |
| **Patient app — profile page** | Lower prominence than admin. Patients need it when calling support. |
| **Escalation email** ([email-templates.ts:27 `escalationEmailHtml`](../backend/src/email/email-templates.ts#L27)) | Include in subject line + body. Clinicians cross-reference IDs with their own systems. |
| **Welcome email** (new template) | First non-invite email after acceptance: "Your Cardioplace ID is `CP-PAT-...`". |
| **Caregiver email** ([email-templates.ts:65 `caregiverEmailHtml`](../backend/src/email/email-templates.ts#L65)) | **Do not include** — HIPAA Minimum Necessary already enforced (existing comment at L66). Display ID is a stable handle; more leaky than first-name-only. |
| **OTP / magic-link emails** | **Do not include** — these go to unauthenticated email; no PHI binding yet. |
| **Audit logs** (`AuthLog`, `ContentAuditLog`) | **No schema change.** These already reference `userId` / `actorId`. Audit viewer joins to `User.displayId` for render. AuthLog's `identifier` column intentionally records the *attempted* identifier (email, possibly typo'd) — that semantics must not change. |

### 9.1 Login

**Display-only, NOT a login credential.** Reasons:
- Login is email + OTP / OAuth / magic-link. Adding "log in with display ID" reintroduces enumeration risk (probing "is this a real ID?" would gate the OTP send).
- If email ever changes, the display ID would create a confused-deputy.
- User lookup by display ID for support tooling should be a separate admin-only endpoint behind role gates, not the patient login form.

---

## 10. Edge cases

| Case | Behavior |
|---|---|
| Patient self-enrolls via OTP, later invited by coordinator (same email) | Find-or-create at [auth.service.ts:3209](../backend/src/auth/auth.service.ts#L3209) returns the existing user. **No new ID issued.** Existing `CP-PAT-...` ID kept. The merged role array now contains both PATIENT and the invited role. |
| User changes role (PROVIDER → MEDICAL_DIRECTOR) | Display ID unchanged. Class stays `STAFF`. Role array changes. UI renders new role chip. |
| Invite revoked or expired without acceptance | No ID was ever issued. No tombstone needed. |
| Account merge (future feature) | Surviving User keeps their display ID. Losing User's ID is tombstoned (`userId = NULL`, `tombstonedAt = now()`). Never re-issued. A `DisplayIdMergeLog` row records the merge so audit can trace either ID to the survivor. |
| Deactivation / suspension | No change to display ID. Today there is no hard-delete in the codebase — `accountStatus = DEACTIVATED` is the soft state. Defense in depth: if hard-delete is ever added, `onDelete: SetNull` tombstones the ledger row. |
| Patient who later becomes staff | Keep the original `CP-PAT-...` ID. Class is **initial population class**, not current role array. Consistent with EHR practice — MRN doesn't change when a patient takes a staff job. Alternative (two IDs per user) rejected as added complexity for an edge case. |
| Misprinted / leaked ID | The ID is **not a secret** (more like an NPI than a password). Leakage does not trigger rotation. If controlled rotation is ever needed (extremely rare), it's a tombstone-the-old + issue-new admin operation. |

---

## 11. Migration plan

Three sequential migrations + one backfill script.

### 11.1 Migration `2026XXXX_add_display_id_table_and_user_column`

Additive only. Safe to land at any time.
- Create `DisplayId` model + `DisplayIdClass` enum
- Create optional `DisplayIdCollisionLog`
- Add `displayId String? @unique` to `User`

### 11.2 Backfill script `backend/scripts/backfill-display-ids.ts`

Not a SQL migration — a one-shot TypeScript runner.
- Iterates every `User` row in stable `createdAt ASC` order
- Computes class from `roles` array: PATIENT class if `PATIENT ∈ roles`, else STAFF
- Calls `DisplayIdService.issue(tx, userId, class, 'backfill')`
- Idempotent (skips users that already have `displayId`)
- Determinism not guaranteed — allocation is random; staging and prod will diverge. Acceptable.

### 11.3 Migration `2026XXXY_make_user_display_id_required`

`ALTER TABLE "User" ALTER COLUMN "displayId" SET NOT NULL;`

Only safe after backfill is verified 100% complete (script exits non-zero if any nulls remain).

### 11.4 Code cutover order

1. Land migration #1.
2. Deploy `DisplayIdService` + integrate into the 4 user-create sites. New users immediately get IDs. Existing users still have `displayId = NULL`.
3. Run backfill against staging → verify → run against prod.
4. Land migration #3 (`NOT NULL`).
5. UI surfaces that currently render raw `User.id` switch to `User.displayId`.

### 11.5 Rollback

- Migrations #1 and #3 are reversible (drop tables, drop NOT NULL constraint).
- The backfill writes to the immutable ledger — there's no rollback for "I issued an ID." But the idempotency check (skip-if-already-has-displayId) makes re-running safe.

---

## 12. Verification plan

How the implementation will be tested end-to-end:

### 12.1 Unit tests for `DisplayIdService`

- Luhn-mod-32 check digit produces expected output for known inputs.
- Normalizer maps `cp-pat-k8m2r4n-7`, `CPPATK8M2R4N7`, `CP-PAT-K8M2R4N-7` to the same canonical value.
- Crockford ambiguity (`O`↔`0`, `I/L`↔`1`) normalized.
- Forced collision (mock the RNG) triggers retry path and logs to `DisplayIdCollisionLog`.

### 12.2 Integration tests in `backend/test/`

- All 4 user-create sites produce a User with `displayId` set after the transaction. Verify `DisplayId` ledger row exists with the same value and correct `issuedVia`.
- Path B: invite-create does NOT create a `DisplayId` row. Acceptance does.
- Path A → Path B sequencing: OTP-create then invite-accept → same email, no duplicate `DisplayId`, original kept.

### 12.3 DB-level invariants

- Attempt `UPDATE "DisplayId" SET value = '...' WHERE ...` from a psql session → trigger rejects.
- Attempt to insert a new `DisplayId` with a tombstoned value → unique-constraint rejects.

### 12.4 End-to-end via Playwright (extend `qa/tests/`)

- Patient signs up via OTP, opens profile page, sees their display ID.
- Admin invites a patient, accepts the invite in a second browser context, both admin patient-list and patient profile show the same display ID.

### 12.5 Backfill verification

After backfill against a seed DB copy:
- `SELECT COUNT(*) FROM "User" WHERE "displayId" IS NULL` → 0.
- `SELECT COUNT(DISTINCT "displayId") FROM "User"` equals `SELECT COUNT(*) FROM "User"`.

---

## 13. Decisions for CMO + founders to confirm

These are genuine choices where the code or research doesn't dictate the answer:

| # | Decision | Recommendation | Trade-off |
|---|---|---|---|
| 1 | **Brand prefix `CP-`** | YES | Makes pasted IDs traceable to Cardioplace in foreign systems. Drop `CP-` if redundant — `PAT-K8M2R4N-7` is also fine but loses brand anchor. |
| 2 | **`STF` as the staff prefix** | YES | `STA` collides with "status" elsewhere. `ADM` connotes super-admin only. `EMP` reads as HR/payroll rather than clinical. |
| 3 | **Display ID in escalation emails** | YES | Clinicians cross-reference IDs with their own systems. Trade-off: escalation emails are non-secret PHI envelopes; the ID is one more stable handle in them. |
| 4 | **Patient-who-became-staff: keep PAT prefix forever** | YES | Consistent with EHR practice (MRN doesn't change when a patient takes a staff job). Alternative (two IDs per user) adds complexity for an edge case. |
| 5 | **Test/dev variant `CP-TST-...`** | YES | Low-cost insurance against demo IDs leaking into prod conversations. |
| 6 | **NURSE role** | Not adding now | Scheme accommodates a future `NURSE` role trivially under the `STF` umbrella. No schema change needed when added. |

If any of (1)–(5) come back differently, the only changes are in the constant table at the top of `DisplayIdService` — no architectural impact.

---

## 14. Critical files to modify (implementation reference)

When this proposal is approved and implementation begins, these are the touchpoints:

| Area | File |
|---|---|
| Schema | [backend/prisma/schema/user.prisma](../backend/prisma/schema/user.prisma) — add `displayId` column |
| Schema (new) | `backend/prisma/schema/display_id.prisma` — ledger model + enum |
| Service (new) | `backend/src/users/display-id.service.ts` — `issue()`, `findByAnyForm()`, `normalize()` |
| User-create hooks | [backend/src/auth/auth.service.ts](../backend/src/auth/auth.service.ts) — 4 sites: L2321, L2528, L2981, L3232 |
| Backfill (new) | `backend/scripts/backfill-display-ids.ts` |
| Email templates | [backend/src/email/email-templates.ts](../backend/src/email/email-templates.ts) — modify `escalationEmailHtml`, add `welcomeEmailHtml` |
| Admin UI | [UserInvitePanel.tsx](../admin/src/components/user-management/UserInvitePanel.tsx), [PatientDetailShell.tsx](../admin/src/components/patient-detail/PatientDetailShell.tsx), [AlertPanel.tsx](../admin/src/components/AlertPanel.tsx) |
| Patient UI | `frontend/src/app/profile/page.tsx` (TBD) |
| Shared DTOs | `shared/src/` — any user/patient DTO exposing `userId` should add `displayId` |

---

## 15. Related docs

- [SSR_AUDIT_AND_AWS_MIGRATION_PLAN.md](SSR_AUDIT_AND_AWS_MIGRATION_PLAN.md) — same proposal-doc pattern, AWS Amplify migration
- [VERIFICATION_DOCS_IMPLEMENTATION_STATUS_2026_06_24.md](VERIFICATION_DOCS_IMPLEMENTATION_STATUS_2026_06_24.md) — implementation status audit
- [CLINICAL_SPEC.md](CLINICAL_SPEC.md) — clinical source of truth
- [ARCHITECTURE.md](ARCHITECTURE.md) — system architecture
