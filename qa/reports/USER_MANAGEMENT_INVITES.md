# User Management & Invite Flow — Results Note

**Branch:** `phase/22-privacy-trust-screen` (contains this feature stacked on top of privacy/trust + consent work — needs to be split into `feature/user-management-invites` off `dev` before merging).
**Owner:** Lakshitha
**Hand-off from:** Duwaragie · 2026-05-26
**Anchor:** `Cardioplace_v2_Implementation_Roadmap_Internal_2026-05-22.pdf` — "Coordinator role & onboarding".

---

## 1. Summary

Adds two related capabilities behind a single admin UI:

1. **New `COORDINATOR` role** — practice front-desk staff who invite patients into their own practice (one practice per coordinator in v1).
2. **Email-based invite + activation flow** — `HEALPLACE_OPS` and `SUPER_ADMIN` can invite admin/staff users; coordinators can invite patients. Every invite is an email with an expiring activation link.

Patient self-enrollment (existing magic-link / OTP sign-in) is **untouched** — this is an additional path, not a replacement.

---

## 2. Schema changes

### Migrations applied

| File | Purpose |
|---|---|
| `20260526120000_add_user_invites_and_coordinator/migration.sql` | Single migration: enum additions + 2 new tables + indexes + FKs |

Applied via `npx prisma migrate deploy` (the shared dev DB has pre-existing drift on `DocumentVector` index + Postgres extensions, so `migrate dev` was not used — `migrate deploy` is additive-only and doesn't trigger drift detection).

### Enum extensions

```prisma
enum UserRole {
  PATIENT
  PROVIDER
  MEDICAL_DIRECTOR
  COORDINATOR        // NEW — practice-scoped staff who invite patients
  HEALPLACE_OPS
  SUPER_ADMIN
}

enum AccountStatus {
  ACTIVE
  BLOCKED
  SUSPENDED
  DEACTIVATED        // NEW — soft-delete state
}
```

### New models

**`PracticeCoordinator`** — front-desk staff ↔ practice link

| Field | Type | Notes |
|---|---|---|
| `id` | String (ulid) | PK |
| `practiceId` | String | FK → Practice (cascade) |
| `userId` | String `@unique` | FK → User (cascade). **`@unique` enforces one practice per coordinator** |
| `assignedAt` | DateTime | default now() |

**`UserInvite`** — pending email invitations

| Field | Type | Notes |
|---|---|---|
| `id` | String (ulid) | PK |
| `email`, `name`, `role` | — | the invited person |
| `practiceId?` | String? | required for PATIENT, COORDINATOR, PROVIDER |
| `tokenHash` | String `@unique` | **sha256 of the token**; raw token only in URL |
| `invitedById` | String | FK → User (restrict — preserve audit anchor) |
| `invitedAt`, `expiresAt` | DateTime | TTL via `USER_INVITE_TTL_HOURS` (default 48h) |
| `acceptedAt?`, `revokedAt?` | DateTime? | state markers |
| `createdUserId?` | String? `@unique` | back-fill of the User row created on accept |

### New relations

- `User` gained: `practiceCoordinator?`, `userInvitesSent[]`, `userInviteCreated?`
- `Practice` gained: `practiceCoordinators[]`, `userInvites[]`

---

## 3. Backend — endpoints shipped

All under `/api/admin/users` (NestJS global prefix `/api` + `@Controller('admin/users')`). All `@UseGuards(JwtAuthGuard)`. Activation endpoints are `@Public()` (token in URL is the credential).

### User management endpoints

| Method + path | Role gate | Body / params |
|---|---|---|
| `POST /api/admin/users/invite` | COORDINATOR · HEALPLACE_OPS · SUPER_ADMIN | `{ name, email, role, practiceId? }` |
| `POST /api/admin/users/invite/bulk` | same | `{ entries: [{name,email,role,practiceId?}, …] }` (≤500) |
| `GET /api/admin/users` | same (COORDINATOR scoped to own practice, status-only) | `?role=&practiceId=&status=&search=&page=&limit=` |
| `POST /api/admin/users/:id/deactivate` | role-scoped per matrix | `{ reason?: string }` |
| `POST /api/admin/users/:id/reactivate` | same | — |
| `POST /api/admin/users/invite/:id/resend` | same as invite | — |
| `POST /api/admin/users/invite/:id/revoke` | same as invite | — |

### Activation endpoints (in auth module)

| Method + path | Guard | Purpose |
|---|---|---|
| `GET /api/v2/auth/invite/:token` | `@Public()` | Validate token; returns `{ email, role, practiceName?, expiresAt }` |
| `POST /api/v2/auth/invite/:token/accept` | `@Public()` | Create User + practice-membership row + issue session (passwordless, mirrors magic-link) |

### Curl examples

```bash
# Single invite (COORDINATOR signed in)
curl -X POST http://localhost:4000/api/admin/users/invite \
  -H "Content-Type: application/json" \
  -H "Cookie: <admin-access-cookie>" \
  -d '{"name":"Mary Johnson","email":"mary@example.com","role":"PATIENT","practiceId":"<your-practice-id>"}'

# Bulk invite (HEALPLACE_OPS)
curl -X POST http://localhost:4000/api/admin/users/invite/bulk \
  -H "Content-Type: application/json" \
  -H "Cookie: <admin-access-cookie>" \
  -d '{"entries":[
    {"name":"Dr. Smith","email":"smith@example.com","role":"PROVIDER","practiceId":"<p1>"},
    {"name":"Coord A","email":"coord-a@example.com","role":"COORDINATOR","practiceId":"<p1>"}
  ]}'

# List (with filters)
curl "http://localhost:4000/api/admin/users?role=PATIENT&status=INVITE_PENDING&page=1&limit=50" \
  -H "Cookie: <admin-access-cookie>"

# Deactivate
curl -X POST http://localhost:4000/api/admin/users/<userId>/deactivate \
  -H "Content-Type: application/json" \
  -H "Cookie: <admin-access-cookie>" \
  -d '{"reason":"Patient transferred to another clinic"}'

# Resend invite
curl -X POST http://localhost:4000/api/admin/users/invite/<inviteId>/resend \
  -H "Cookie: <admin-access-cookie>"

# Validate activation link (public, from the invitee's email)
curl http://localhost:4000/api/v2/auth/invite/<rawToken>

# Accept activation link (public)
curl -X POST http://localhost:4000/api/v2/auth/invite/<rawToken>/accept \
  -H "Content-Type: application/json" -d '{}'
```

---

## 4. Authorization matrix (enforced server-side)

| Caller | Can invite | Practice rule | Can deactivate |
|---|---|---|---|
| `COORDINATOR` | PATIENT only | practiceId MUST equal caller's `PracticeCoordinator.practiceId` | own-practice patients only |
| `HEALPLACE_OPS` | PROVIDER, MEDICAL_DIRECTOR, HEALPLACE_OPS, COORDINATOR | required for COORDINATOR + PROVIDER | admin-role users only (no patients, no SUPER_ADMIN) |
| `SUPER_ADMIN` | All roles (incl. SUPER_ADMIN — logs `super_admin_invited` w/ `severity:'elevated'`) | required for PATIENT, COORDINATOR, PROVIDER | any user, any role |
| All other roles | — | — | — |

Enforced by service-layer guards `assertCanInvite(caller, targetRole, practiceId)` and `assertCanDeactivate(caller, target)`, modeled on the existing `PatientAccessService` pattern.

---

## 5. Frontend — admin app

### New page

- `admin/src/app/users/page.tsx` — page shell + 403 card for unauthorized roles. Routed at `/users`.

### New components (`admin/src/components/user-management/`)

| File | Purpose |
|---|---|
| `UserInvitePanel.tsx` | Main panel; role-aware (COORDINATOR sees patients-only, OPS/SUPER see admin-roles + filters) |
| `InviteUserModal.tsx` | Single-invite modal; focus trap, Esc to close, gated role dropdown |
| `BulkInviteInline.tsx` | `+ Add multiple` table; per-row error highlight on 422, atomic submit |
| `CSVUploadCard.tsx` | 3-step CSV flow (download template → upload → preview → send), 500-row cap |
| `UsersList.tsx` | Merged users + invites table; status badges, per-row actions, pagination |
| `DeactivateConfirmModal.tsx` | Red destructive confirm with optional reason |
| `Toast.tsx` | Top-right `aria-live="polite"` toast, 3s auto-dismiss |
| `badges.tsx` | Shared `RoleBadge` + `StatusBadge` |

### New service

- `admin/src/lib/services/user-management.service.ts` — wraps all 7 endpoints via existing `fetchWithAuth`.

### Modified files

| File | Change |
|---|---|
| `admin/src/components/AdminSidebar.tsx` | New "Users" nav item gated on `canManageUsers` |
| `admin/src/proxy.ts` | COORDINATOR added to admin-app proxy allowlist |
| `admin/src/lib/roleGates.ts` | Single source of truth for the §3 matrix: `canManageUsers`, `invitableRoles`, `inviteRequiresPractice`, `isCoordinatorOnly` |
| `admin/src/i18n/{en,es,fr,de,am}.ts` | Full `userManagement.*` namespace — 91 keys × 5 languages |

### Per-row actions (gated by caller's role)

| Row state | Actions |
|---|---|
| `INVITE_PENDING` | Resend · Revoke |
| `ACTIVE` | Deactivate (red confirm modal) |
| `DEACTIVATED` | Reactivate |
| `BLOCKED` / `SUSPENDED` | (read-only) |

### Accessibility (matched to existing admin standard / Lakshitha track WCAG 2.2 AA)

- Real `<table>` with `<th scope="col">`
- All icon-only buttons have `aria-label`
- Focus traps in modals; Esc to close; focus returns to trigger on close
- `aria-invalid` + `aria-describedby` on form errors
- Status badges have descriptive text (not color-only)
- 44px tap targets enforced
- Polite live region for status changes (toast)

---

## 6. Security & audit notes

- **Tokens hashed** — only `sha256(token).digest('hex')` stored as `UserInvite.tokenHash`. Raw token only lives in the activation URL we email.
- **Soft-delete only** — `accountStatus = DEACTIVATED`, never `prisma.user.delete`. HIPAA-safe.
- **Bulk atomicity** — all-or-nothing via `prisma.$transaction`; partial state impossible.
- **Duplicate email rule** — rejects if a User exists with that email OR an open (non-revoked, non-accepted, non-expired) invite exists. Expired invites are overwriteable.
- **Audit trail** (`AuthLog`):
  - `user_deactivated` / `user_reactivated` — with actor + reason
  - `super_admin_invited` — `metadata.severity = 'elevated'`

---

## 7. Open-question defaults applied (per §3 of the spec)

| Question | Default taken | Rationale |
|---|---|---|
| Can a coordinator cover multiple practices? | **No** (`@unique` on `userId`) | Pilot has 3 small practices; relax later by dropping the unique constraint if needed |
| Can `SUPER_ADMIN` invite `PATIENT` as a fallback? | **Yes**, with required `practiceId` | Solves the bootstrap problem when a new practice has no coordinator yet |
| Can `SUPER_ADMIN` invite another `SUPER_ADMIN`? | **Yes**, logged loudly as `super_admin_invited` with elevated severity | |
| Should COORDINATOR see their practice's patient list / status? | **Yes — status only**, no clinical data | Front-desk staff need "is Mary set up yet?" visibility |
| CSV row cap | **500** rows (frontend + backend) | Spec default; matched on both sides |
| TTL | **48 hours** via `USER_INVITE_TTL_HOURS` config constant | Spec default |

All defaults are subject to confirmation by Duwaragie before merge.

---

## 8. Judgement calls / ambiguities resolved

1. **`PATIENT` activation skips `PatientProviderAssignment` creation** — that row needs primary/backup provider IDs the inviter doesn't supply. New patients land with `roles: [PATIENT]` and `isVerified: true`; the existing provider-verify flow attaches the assignment later.
2. **Email already exists** — if an invite lands on an email that already has a User (e.g. an existing patient who self-enrolled via OTP), `acceptInvite` **merges the new role into the existing user** rather than failing or duplicating. Safer than the alternatives.
3. **OPS can't deactivate SUPER_ADMIN** — explicit guard added; spec wording "admin-role users only" excludes the role above OPS.
4. **List endpoint shape** — returns `{ data: User[], invites: UserInvite[], total, page, limit }`. The `invites` block surfaces the "Invite Pending" bucket alongside real users so the admin UI can render both in one call.
5. **Bulk 422 quirk** — backend returns HTTP 200 with `{ statusCode: 422, errors: [...] }` in the body (per existing repo convention), not a real 422 status. Frontend service handles both forms.
6. **`COORDINATOR` added to `ADMIN_ALLOWED_ROLES`** — needed so coordinators can sign in via the admin OTP gate. Without it the admin-app auth would refuse them.
7. **Backend URL prefix** — frontend service uses `/api/admin/users/...` (matches actual NestJS mount and every other admin service in the repo); the spec's `/api/v2/admin/users/...` mention appears to be outdated.
8. **`COORDINATOR` practice-name header** — they can't read `/admin/practices` (it's gated to other roles), so the header falls back to "Patients" (without "— Practice name") instead of firing a 403 for a decorative label. Backend still scopes their list correctly server-side; no frontend practice id is needed.
9. **CSV parser** — hand-rolled (handles quoted commas, CR/LF/CRLF, double-quote escape) to avoid adding a `papaparse` dependency for a 50-line job.
10. **Toast system** — admin app has none, so an inline `<Toast>` component was added (panel-scoped, top-right, 3s auto-dismiss).

---

## 9. Test status

| Layer | Status |
|---|---|
| Backend TypeScript (`tsc --noEmit`) | ✅ Clean (only pre-existing test-file errors remain) |
| Admin TypeScript | ✅ Clean |
| Backend lint (Biome) | ✅ Clean (project's `biome.json` has a `useIgnoreFile` config issue unrelated to this work) |
| Admin lint (ESLint) | ✅ Clean for all new files (pre-existing repo errors untouched) |
| **Backend Jest tests for §3 matrix** | ⏳ **NOT WRITTEN** — production code only this pass; tests are the next pass |
| **Playwright E2E** | ⏳ **NOT WRITTEN** — same |
| Manual click-through | ⏳ Pending the user (run admin dev server at port 3001) |

---

## 10. Out of scope (per spec §6 — confirmed NOT built)

- Editing an existing user's role after creation
- Editing an existing user's practice assignment
- Coordinator full patient-onboarding journey UI (just the `/users` surface)
- Hard delete / purge
- Audit log UI (data is in `AuthLog`; UI is a follow-up)
- Per-practice / per-locale email customization (single English template; locales follow Manisha's sign-off)

---

## 11. How to deploy + test

```powershell
# 1. Apply the migration (additive-only, doesn't reset the drifted dev DB)
cd backend
npx prisma migrate deploy

# 2. Run backend
npm run start:dev

# 3. Run admin app (new terminal)
cd ../admin
npm run dev

# 4. Open http://localhost:3001/users in browser
#    - Sign in as COORDINATOR → patients-only view of their practice
#    - Sign in as HEALPLACE_OPS → admin-role invites (no PATIENT option)
#    - Sign in as SUPER_ADMIN → can invite anything
#    - PROVIDER / MEDICAL_DIRECTOR → 403 card
```

---

## 12. Next steps

1. ✅ **Apply migration** via `npx prisma migrate deploy`
2. **Confirm defaults** with Duwaragie (the 6 items in §7) before requesting review
3. **Verify backend URL prefix** — confirm `/api/admin/users/*` matches the actual NestJS mount (the agent inferred this; quick sanity-check is advised)
4. **Write Jest auth-matrix tests** — every cell of §4
5. **Write Playwright specs** — 5 user flows from the spec
6. **Split this branch** — `phase/22-privacy-trust-screen` currently contains 4 stacked features (privacy/trust screen, sign-in consent, user-management backend, user-management frontend). Carve into clean commits / a proper `feature/user-management-invites` branch off `dev` before opening the PR.
7. **Don't merge** — Duwaragie sequences the merge.
