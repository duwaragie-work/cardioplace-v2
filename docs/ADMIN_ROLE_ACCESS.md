# Cardioplace v2 — Admin App Role Access

**Reconstructed 2026-06-11** alongside `ACCESS_SCOPE.md` after the original file was lost. This is the admin-app companion to the backend policy doc — same rules viewed from the UI side.

For the canonical backend rules, see `docs/ACCESS_SCOPE.md`. This doc covers what each admin-app role sees in the UI.

---

## §1 — Audience

The admin app at `admin.cardioplaceai.com` is used by four roles: `SUPER_ADMIN`, `HEALPLACE_OPS`, `MEDICAL_DIRECTOR`, `PROVIDER`. The `COORDINATOR` role also accesses the admin app but only for user management. The `PATIENT` role does not access the admin app at all.

---

## §2 — Sidebar visibility

The admin sidebar (`admin/src/components/AdminSidebar.tsx`) renders different navigation items per role:

| Sidebar item | SUPER_ADMIN | HEALPLACE_OPS | MEDICAL_DIRECTOR | PROVIDER | COORDINATOR |
|---|---|---|---|---|---|
| Dashboard | ✓ | ✓ | ✓ | ✓ | — |
| Patients | ✓ | ✓ | ✓ | ✓ | — |
| Practices | ✓ | ✓ | ✓ (scoped to their practices) | ✓ (read-only) | — |
| Alerts | ✓ | ✓ | ✓ | ✓ | — |
| Users / Coordinator roster | ✓ | ✓ | ✓ | — | ✓ (one practice only) |
| Settings | ✓ | ✓ | ✓ | partial | — |

Hidden items are not just visual — page-level guards 403 the role on direct URL access. The sidebar is for UX clarity; the security is in the backend `@Roles()` decorators.

---

## §3 — MEDICAL_DIRECTOR practice scoping (the central change)

This is the same change documented in `ACCESS_SCOPE.md §3`. From the admin app's perspective:

- `MEDICAL_DIRECTOR` sees the **Practices** page filtered to only practices where they're a `PracticeMedicalDirector` member
- The **Patients** list is filtered to patients whose `assignment.practiceId` is in their practice memberships
- The **Alerts** list is filtered the same way
- Within a practice they head, they see all patients regardless of named care team
- They can edit care teams for patients in their scope (assign primary / backup / medical director slots)
- They cannot edit `Practice` metadata (create / rename / delete) — that's `SUPER_ADMIN` and `HEALPLACE_OPS` only

---

## §4 — PROVIDER scope inside the admin app

Providers see the admin app filtered to their assigned-patient roster:

- **Patients** list: only patients where they're primary or backup provider
- **Alerts** list: only alerts on those patients
- **Patient detail screen**: full clinical detail (thresholds, medications, readings, alerts, audit log) for assigned patients
- Cannot reassign care teams (the WRITE action on `assignment.controller.ts` excludes PROVIDER)
- Can write thresholds and resolve alerts on their assigned patients

---

## §5 — HEALPLACE_OPS scope inside the admin app

OPS sees everything across practices:

- All patients
- All practices
- All alerts
- Audit logs everywhere
- Can reassign care teams (operational handoff)
- Can manage practice staff (`PracticeProvider`, `PracticeMedicalDirector` membership rows) — needed to bootstrap a new practice before any patient is assigned

What OPS cannot do:
- Cannot acknowledge or resolve alerts
- Cannot write thresholds
- Cannot complete clinical enrollment for a patient

The pattern: read everything, do operational work, but defer clinical decisions to clinicians.

---

## §6 — SUPER_ADMIN

Unrestricted. Used for engineering / leadership / emergency interventions. Few accounts in production.

---

## §7 — COORDINATOR

Non-clinical role for clinic front-desk staff.

- Lands on the **Users** page (their only screen)
- Sees their practice's user roster
- Can invite new users, deactivate users
- Cannot see clinical data (no readings, no alerts, no medications, no thresholds)
- Page-level guards 403 them if they navigate to clinical surfaces by URL

`COORDINATOR` is 1:1 with `Practice` via `PracticeCoordinator @unique` — they cannot belong to multiple clinics.

---

## §8 — Cross-cutting UI patterns

### CRUD button visibility
On a given screen, CRUD buttons (edit, delete, reassign) are hidden for roles that don't have WRITE access — "scope-not-hide" pattern. The button isn't there to be clicked by accident. The backend still 403s if the role tries it via API.

### Empty-state messaging
Where a role's scope filter returns an empty result (e.g., a brand-new `MEDICAL_DIRECTOR` who isn't a member of any practice yet), the UI shows a calm "no practices assigned yet — ask Healplace Ops to add you" message rather than a generic "nothing to show" empty state. The handoff guidance is per the May 2026 onboarding flow.

### Top-bar role badge
The admin app shows the current actor's role in the top bar (e.g., `MED_DIR @ Cedar Hill Regional`). For users with multiple practice memberships, the badge shows one practice and a dropdown switches between them. The role itself doesn't change based on the practice selection — the data scope does.

---

## §9 — What this doc does NOT cover

For authentication, session timeout, 2FA, in-app consent, and break-glass mechanisms, see `ACCESS_SCOPE.md §10` and the 2026-06-11 access-control review.

---

## Reconstruction history

- **Original creation:** unclear date in May 2026 — referenced by `practice_medical_director.prisma`'s migration on 2026-05-20
- **Lost:** ~2026-06-01 to 2026-06-07 due to `git clean -fdx`
- **Reconstructed:** 2026-06-11 by Duwaragie (with AI assistance) from code references, `AdminSidebar.tsx` comments, and controller-level `@Roles()` decorators. May miss original framing decisions; code is the source of truth for any specific call.
