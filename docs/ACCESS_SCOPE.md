# Cardioplace v2 — Access Scope Policy

**Reconstructed 2026-06-11** from code references after the original file was lost to a `git clean -fdx` incident. The reconstruction faithfully covers what the code's inline comments + spec describe; if anything seems off vs. what was originally documented, the code is the source of truth — re-read `backend/src/common/patient-access.service.ts` + the controller-level `@Roles()` decorators.

---

## §1 — Decision context

The **May 2026 access-scope decision** rewrote how role-based visibility works in the admin app. Before May 2026, `MEDICAL_DIRECTOR` had all-patient visibility across every practice and `HEALPLACE_OPS` had similar reach, which leaked PHI across practice boundaries and didn't fit how clinical authority actually works.

The decision is summarized in one line: **MED_DIR loses all-patient visibility, gains practice scope.** Around that core change, the rest of the role boundaries were tightened so each role's reach matches its real-world responsibility.

The new policy is enforced at the data-query layer (via `PatientAccessService`), at controller-level via `@Roles()` decorators, and at the admin-app UI via sidebar / page guards. PHI scope cannot be violated by URL fiddling — it's blocked at the SQL filter.

---

## §2 — The four admin roles

The patient-facing `PATIENT` role is not in this doc — it's covered by its own service-level checks. This doc covers the four admin-app roles.

| Role | Used by | Scope summary |
|---|---|---|
| `SUPER_ADMIN` | Engineering / leadership (rare in production) | Unscoped — all patients, all practices, all actions |
| `HEALPLACE_OPS` | Healplace operations team | All patients (read-only on clinical data) + operational actions |
| `MEDICAL_DIRECTOR` | Senior physician overseeing a practice | All patients in **practices they head** via `PracticeMedicalDirector` membership |
| `PROVIDER` | Physician on the clinic floor | Only patients where they're listed as primary OR backup on `PatientProviderAssignment` |
| `COORDINATOR` | Front-desk / non-clinical clinic staff | One practice; non-clinical actions only (user management) |

`COORDINATOR` was added later as a non-clinical role; not strictly an "admin role" in the legacy sense but included here for completeness.

---

## §3 — MEDICAL_DIRECTOR scope (the central change)

Before May 2026, `MEDICAL_DIRECTOR` saw every patient in every practice. The decision changed this to a **practice-scoped** model:

- A `MEDICAL_DIRECTOR` sees only patients whose `PatientProviderAssignment.practiceId` is in their `PracticeMedicalDirector` memberships.
- A `MEDICAL_DIRECTOR` can head multiple practices simultaneously (many-to-many membership).
- Within a practice they head, they see **all patients** regardless of who's named as primary / backup on the care team. The MD has clinical-oversight authority over the whole practice, so they don't need to be on each individual care team.

**Backfill note:** when this rule was rolled out, the migration `20260520120000_practice_medical_director_join` backfilled `PracticeMedicalDirector` rows from every distinct `(practiceId, medicalDirectorId)` pair in the existing `PatientProviderAssignment` table — so MDs who had been assigned to patients before the change weren't locked out on day 1.

---

## §4 — PROVIDER scope

A `PROVIDER` sees only patients where they are explicitly on the care team — `primaryProviderId = me` OR `backupProviderId = me` on `PatientProviderAssignment`.

Being a `PROVIDER` at a practice (via `PracticeProvider` membership) does **not** grant access to patients at that practice. Practice membership exists to populate the "available providers" dropdown when an admin assigns a care team, and to support practice-bootstrap before any patients have been assigned — but it does not grant patient-data visibility on its own.

This is the strictest interpretation of patient privacy in the system: explicit assignment is required.

---

## §5 — HEALPLACE_OPS scope

`HEALPLACE_OPS` has cross-practice visibility intentionally — they handle operational support (debugging, escalation handoff, audit follow-up). They see all patients across all practices.

But: `HEALPLACE_OPS` is **excluded from clinical write actions**:

- Cannot acknowledge alerts
- Cannot resolve alerts
- Cannot change thresholds
- Cannot complete clinical enrollment (clinical readiness call is `PROVIDER` / `MEDICAL_DIRECTOR` only)

`HEALPLACE_OPS` **can** reassign care teams (operational handoff) and read audit logs everywhere.

The principle: OPS reads everything for operational support, but clinical disposition requires a clinician.

---

## §6 — COORDINATOR scope

`COORDINATOR` is a non-clinical role for clinic front-desk staff. Scoped to exactly one practice (1:1 via `PracticeCoordinator @unique`).

What they can do:
- Manage their practice's user roster (`/users` endpoint — invite, deactivate)
- See patient status (enrolled / verified) for their practice

What they cannot do or see:
- No clinical data (no readings, no alerts, no medications, no thresholds)
- No Dashboard, no Patients, no Practices, no Alerts pages in the admin app (sidebar items are hidden; page guards 403 them on direct URL navigation)

---

## §7 — `PatientAccessService` (the runtime filter)

The single source-of-truth implementation of the scope rules lives in `backend/src/common/patient-access.service.ts`. Every clinical query that touches a patient runs through this helper to derive the right `WHERE` clause for the actor's role.

### §7.1 — Short-circuit (SUPER_ADMIN / HEALPLACE_OPS)

```typescript
if (actor.roles.includes(UserRole.SUPER_ADMIN) ||
    actor.roles.includes(UserRole.HEALPLACE_OPS)) {
  return {}  // No filter — all patients visible
}
```

### §7.2 — MEDICAL_DIRECTOR scope via PracticeMedicalDirector

```typescript
if (actor.roles.includes(UserRole.MEDICAL_DIRECTOR)) {
  const practiceIds = await this.practicesHeadedBy(actor.id)
  return {
    providerAssignmentAsPatient: {
      is: { practiceId: { in: practiceIds } },
    },
  }
}
```

### §7.3 — PROVIDER scope via assignment

```typescript
if (actor.roles.includes(UserRole.PROVIDER)) {
  return {
    providerAssignmentAsPatient: {
      is: {
        OR: [
          { primaryProviderId: actor.id },
          { backupProviderId: actor.id },
        ],
      },
    },
  }
}
```

### §7.4 — Deny path

If no role matched, throw `ForbiddenException` (translated to HTTP 403 by Nest). Patient role doesn't reach this helper because it has separate self-only logic.

### §7.5 — Practice scope helper

`practiceScopeIds(actor)` returns the list of practice IDs an actor can act within. Used by the `/practices` list filter so MED_DIRs only see their own practices.

### §7.6 — `patientScopeWhere(actor)`

Top-level helper that callers use to derive the right `WHERE` clause for `User` queries. Returns:
- `{}` for SUPER_ADMIN / OPS
- Practice-bounded filter for MED_DIR
- Assignment-bounded filter for PROVIDER
- Throws ForbiddenException otherwise

This is the section everything refers to. The spec file at `backend/src/common/patient-access.service.spec.ts` covers the four cases as a unit test matrix.

---

## §8 — Per-endpoint authorization matrix

The `@Roles()` decorator on each controller + method enforces who can call what. The pattern is: controller-level `@Roles()` lists the read role-set, method-level `@Roles()` overrides for stricter writes.

### Alerts (`alert-resolution.controller.ts`)

| Action | Roles allowed |
|---|---|
| READ alert audit trail | All four admin roles. `HEALPLACE_OPS` receives the T+24h / T+48h escalation notification and needs read context for operational follow-up. |
| WRITE (acknowledge / resolve) | `SUPER_ADMIN`, `MEDICAL_DIRECTOR`, `PROVIDER`. **`HEALPLACE_OPS` excluded** — alert closure is a clinical disposition. |

### Thresholds (`threshold.controller.ts`)

| Action | Roles allowed |
|---|---|
| READ | `PATIENT` (own only), `PROVIDER`, `MEDICAL_DIRECTOR`, `HEALPLACE_OPS`, `SUPER_ADMIN` |
| WRITE | `SUPER_ADMIN`, `MEDICAL_DIRECTOR`, `PROVIDER`. `HEALPLACE_OPS` excluded from writes (clinical decision). |

`PROVIDER` was previously read-only on thresholds; the May 2026 decision gave them write authority on their assigned patients.

### Care-team assignment (`assignment.controller.ts`)

| Action | Roles allowed |
|---|---|
| READ | All four admin roles. PROVIDER + MED_DIR + OPS see the primary / backup / medical director on the patient detail screen. |
| WRITE | `SUPER_ADMIN`, `MEDICAL_DIRECTOR`, `HEALPLACE_OPS`. **`PROVIDER` excluded** — they don't reassign their own care team. MED_DIR is further runtime-scoped to practices they head. |

### Practice CRUD (`practice.controller.ts`)

| Action | Roles allowed |
|---|---|
| READ | All four admin roles. PROVIDER / MED_DIR need practice names for dropdowns + labels even though they can't edit. |
| WRITE (create / update / delete) | `SUPER_ADMIN`, `HEALPLACE_OPS` only. **`MEDICAL_DIRECTOR` excluded** — clinical authority is per-patient inside a practice, not over practice metadata. PROVIDER excluded. |

### Practice membership (`practice.controller.ts` — `/practices/:id/providers/:userId`)

Adding/removing a user from `PracticeProvider` or `PracticeMedicalDirector` is independent of any patient assignment, so OPS can **bootstrap a practice with staff before the first patient is assigned**. Otherwise the assignment dropdown would be empty.

| Action | Roles allowed |
|---|---|
| Add / remove practice staff | `SUPER_ADMIN`, `HEALPLACE_OPS` only |

### Enrollment-complete (`enrollment.controller.ts`)

Completing clinical onboarding is a clinical readiness call.

| Action | Roles allowed |
|---|---|
| READ `/enrollment-check` | `SUPER_ADMIN`, `MEDICAL_DIRECTOR`, `PROVIDER` (admin UI renders 4-piece checklist) |
| WRITE complete-onboarding | `SUPER_ADMIN`, `MEDICAL_DIRECTOR`, `PROVIDER`. **`HEALPLACE_OPS` excluded** — they handle assignment, not clinical readiness. |

---

## §9 — Admin app UI guards

The admin sidebar (`admin/src/components/AdminSidebar.tsx`) hides items from roles that have no access. Hiding is for UX; the security boundary is the backend `@Roles()` decorator + the `PatientAccessService` filter.

- `MED_DIR` sees only their scoped practices (backend filter via `PatientAccessService`); `OPS` + `SUPER` see all
- CRUD buttons are hidden on the page itself for non-OPS/SUPER (scope-not-hide pattern)
- `COORDINATOR` is non-clinical — they only manage their practice's patient roster via `/users`. Dashboard / Patients / Practices / Alerts are all clinical surfaces hidden from the sidebar (and page-level guards 403 them if they navigate by URL)

---

## §10 — What's NOT in scope (for clarity)

This policy does not address:
- 2FA / multi-factor authentication (single-factor email OTP + magic link today)
- Idle session timeout (access token expires after 15 min regardless of activity; no inactivity logout)
- In-app patient-consent workflow for ad-hoc access
- Break-glass / emergency-access mechanism for non-assigned providers
- Patient-initiated practice transfer

These were discussed in the 2026-06-11 access-control review and are tracked separately.

---

## Reconstruction history

- **Original creation:** unclear date in May 2026 — referenced by `practice_medical_director.prisma`'s migration on 2026-05-20 and surrounding controller comments
- **Lost:** ~2026-06-01 to 2026-06-07 due to `git clean -fdx` clearing untracked files
- **Reconstructed:** 2026-06-11 by Duwaragie (with AI assistance) from code references, controller-level `@Roles()` decorators, schema comments, and the `PatientAccessService` implementation. May miss original framing decisions or rationale present in the original. If precision matters for any specific call, re-read the code — it is the source of truth.
