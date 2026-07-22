# Cardioplace v2 — Access Scope Policy

**Original creation:** May 2026 (lost to `git clean -fdx` on ~2026-06-01)
**Reconstructed:** 2026-06-11 (Duwaragie, from code references)
**Substantially expanded:** 2026-06-24 (Humaira — June 2026 provider-widen, practice-identity strict scoping, MFA + idle-timeout, matrix)
**Current revision:** 2026-07-01 (Duwaragie — alert-queue split, MED_DIR practice-scoped admin authority per Manisha 2026-06-12, coordinator write-scope walkbacks, admin data-entry endpoints, AccessLog compliance write)

**Source of truth:** if this doc drifts from the code, re-read `backend/src/common/patient-access.service.ts` + every controller-level `@Roles()` decorator + `backend/src/users/users.service.ts` (`assertCanInvite` / `assertCanDeactivate`). This doc reflects the code as of 2026-07-01 and is grounded in three sources: Manisha 2026-06-12 access-control sign-off (`docs/clinical-signoffs/MANISHA_2026_06_12_ACCESS_CONTROL_AND_CLINICAL_WORKFLOW.md`), HIPAA §164.312 + §164.502 (Treatment/Payment/Operations exception), and mainstream EHR conventions (Epic In Basket / chart split, Cerner Message Center, athenahealth).

---

## §1 — Decision context

The **May 2026 access-scope decision** rewrote how role-based visibility works in the admin app. Before May 2026, `MEDICAL_DIRECTOR` had all-patient visibility across every practice and `HEALPLACE_OPS` had similar reach, which leaked PHI across practice boundaries and didn't fit how clinical authority actually works.

Summarized in one line: **MED_DIR loses all-patient visibility, gains practice scope.** Around that core change, the rest of the role boundaries were tightened so each role's reach matches its real-world responsibility.

**June 2026 update — providers go practice-wide on clinical DATA, stay assigned-only on the ALERT WORKLIST.** A follow-up decision (Manisha 2026-06-12, HIPAA §164.502(b) TPO exception) widened `PROVIDER` chart visibility from assignment-based to **practice-based**: any provider can view or edit any chart in a practice they belong to. Care-team assignment (`PatientProviderAssignment`) still drives who **receives alerts** — a plain provider's alert queue only shows patients they are primary or backup on. This is the Epic "In Basket" pattern (practice-wide chart access, provider-scoped alerts) and is standard EHR practice.

**2026-07-01 update — MED_DIR practice-scoped admin authority + coordinator write-scope walkbacks.** Per Manisha 2026-06-12 Q2 and industry EHR norms, MED_DIR gains write authority for administrative surfaces **within their own practice** (staff roster, invite/deactivate providers, practice config edit). COORDINATOR loses write authority on two surfaces that got over-scoped in earlier PRs: care-team assignment (moved back to MED_DIR + OPS + SUPER) and permanent-close (restricted to OPS + SUPER — reversible deactivate remains with COORDINATOR).

The policy is enforced at three layers: **data-query** (via `PatientAccessService`), **controller-level `@Roles()`** decorators, and the **admin-app UI** (sidebar + page guards). PHI scope cannot be violated by URL fiddling — it's blocked at the SQL filter.

---

## §2 — The roles

Five roles, split into three tiers by real-world responsibility:

**Clinical roles** (act on patient chart, make clinical decisions):
| Role | Used by | Scope summary |
|---|---|---|
| `PROVIDER` | Physician on the clinic floor | All patients in practices they belong to via `PracticeProvider` (read/write chart, practice-wide); alert queue narrows to their `PatientProviderAssignment` (primary/backup) — see §4 |
| `MEDICAL_DIRECTOR` | Senior physician overseeing a practice | All patients in practices they head via `PracticeMedicalDirector` (read/write chart AND alert queue — no assignment narrowing); plus practice-scoped admin authority — see §3 |

**Administrative roles** (manage roster, coverage, config; no clinical decisions):
| Role | Used by | Scope summary |
|---|---|---|
| `COORDINATOR` | Front-desk / practice manager | One practice via `PracticeCoordinator` (1:1); manages staff roster + patient enrollment status; no clinical data access, no alert queue |
| `HEALPLACE_OPS` | Healplace operations team | All patients read-only clinically + org-wide operational actions (care-team reassign, practice CRUD, staff bootstrap) |

**Superuser** (engineering / leadership escape hatch, rare):
| Role | Used by | Scope summary |
|---|---|---|
| `SUPER_ADMIN` | Engineering / leadership | Unscoped — all patients, all practices, all actions |

The `PATIENT` role isn't an admin-app role — patients read and write only their own record (`req.user.id` self-scoping in `frontend/`). Included in the matrix below for completeness.

### §2.1 — Full permission matrix

**Legend:** `R/W` = read + write · `R` = read-only · `W` = write action only · `—` = no access
Scope suffixes: `self` (own record) · `assn` (assigned-only via `PatientProviderAssignment`) · `prac` (practice-scoped via membership) · `all` (org-wide)

The matrix reflects the code **after** the 2026-07-01 patches ship (MED_DIR admin authority + coordinator write walkbacks). Cells marked *(pending)* still need code change to match — tracked in §2.2.

#### Clinical data

| Permission | PATIENT | PROVIDER | MED_DIR | COORDINATOR | HEALPLACE_OPS | SUPER_ADMIN |
|---|---|---|---|---|---|---|
| View patient list | R (self) | R (prac) | R (prac) | — | R (all) | R/W (all) |
| View patient chart | R (self) | R/W (prac) | R/W (prac) | — | R (all) | R/W (all) |
| **Alert queue** (worklist) | — | R (**assn**) | R (prac) | — | R (all) | R (all) |
| Acknowledge / resolve alerts | — | W (assn) | W (prac) | — | — | W (all) |
| Edit thresholds | — | W (prac) | W (prac) | — | R (all) | W (all) |
| **Add reading from admin** | R/W (self) | W (prac) | W (prac) | — | — | W (all) |
| **Add medication from admin** | R/W (self) | W (prac) | W (prac) | — | — | W (all) |
| Verify medication | — | W (prac) | W (prac) | — | — | W (all) |
| Complete clinical enrollment | — | W (prac) | W (prac) | — | — | W (all) |
| **Timeline tab** (clinical history) | R (self) | R (prac) | R (prac) | — | R (all) | R (all) |

#### Administrative

| Permission | PATIENT | PROVIDER | MED_DIR | COORDINATOR | HEALPLACE_OPS | SUPER_ADMIN |
|---|---|---|---|---|---|---|
| View staff roster | — | R (prac) *(pending)* | R/W (prac) *(pending)* | R (prac) | R (all) | R/W (all) |
| Invite staff | — | — | W (prac) *(pending)* | W (prac) | W (all) | W (all) |
| Deactivate / reactivate staff | — | — | W (prac) *(pending)* | W (prac) | W (all) | W (all) |
| **Permanent-close account** | W (self) | — | — | — *(pending)* | W (all) | W (all) |
| **Assign / change care team** | — | — | W (prac) | — *(pending)* | W (all) | W (all) |
| Edit practice config (hours, protocol) | — | — | W (prac) *(pending)* | — | W (all) | W (all) |
| Create / delete practice | — | — | — | — | W (all) | W (all) |
| Add / remove practice staff membership | — | — | W (prac) *(pending)* | — | W (all) | W (all) |
| Edit caregiver contact info | R/W (self) | W (prac) | W (prac) | — | W (all) | W (all) |

#### Audit & operations

| Permission | PATIENT | PROVIDER | MED_DIR | COORDINATOR | HEALPLACE_OPS | SUPER_ADMIN |
|---|---|---|---|---|---|---|
| **AccessLog** (§164.312(b) security audit) | — | — | — | — | write-only, no UI | write-only, no UI |
| Handle escalations (T+24h / T+48h notifications) | — | — | — | — | W (all) | W (all) |
| Break-the-glass (cross-practice) | — | — | — | — | — (post-pilot) | — (post-pilot) |
| Patient self-close account | W (self) | — | — | — | — | — |

**AccessLog is compliance write-only for MVP.** Every PHI read/write on the seven PHI models (User, PatientProfile, JournalEntry, DeviationAlert, Notification, PatientMedication, PatientThreshold) writes an audit row per HIPAA §164.312(b). The write side shipped in PR #115 (2026-07-01). No admin-facing UI exposes the log — bloat concern + HIPAA doesn't require providers/admins to view the log, only that the org retain it. If an OPS or SUPER needs to run a compliance query, they query the DB directly (Prisma Studio or `backend/scripts/`). A read UI can be added later if pilot ops flow demands it.

***(pending)* cells are the 2026-07-01 change list** — track in the implementation status section below.

**Reactivate ≠ auto-restore (2026-07-03, HIPAA §164.308(a)(4)).** The "Deactivate / reactivate staff" cell above still reflects *who may act*, but reactivation is now a **deliberate, scoped re-authorization**, not a silent role hand-back. The acting admin explicitly chooses the role(s) to grant (prefilled with the prior role, changeable), and each is checked against the **same** grant matrix as invite (`assertCanGrantRole`) — a caller can never grant on reactivation what they couldn't grant on invite. Practice-bound roles require a practice the admin is authorized for; the action bumps `tokenVersion` and reconciles practice membership, and is captured in an `AccountClosureLog` REACTIVATE audit row. See the User-lifecycle row in §8.

### §2.2 — Implementation status (as of 2026-07-01)

| Change | Where | Owner | Status |
|---|---|---|---|
| Add MED_DIR to `UsersController @Roles` (staff roster + invite + deactivate/reactivate) | `backend/src/users/users.controller.ts:44` | Lakshitha | PENDING |
| Add MED_DIR branch to `assertCanInvite` (practice-scoped) | `backend/src/users/users.service.ts:106` | Lakshitha | PENDING |
| Add MED_DIR branch to `assertCanDeactivate` (practice-scoped) | `backend/src/users/users.service.ts:194` | Lakshitha | PENDING |
| Remove COORDINATOR from permanent-close method-level `@Roles` | `backend/src/users/users.controller.ts:131` | Lakshitha | PENDING |
| Remove COORDINATOR from care-team assignment `@Post`/`@Patch` `@Roles` | `backend/src/practice/assignment.controller.ts:57 + method @Patch` | Lakshitha | PENDING |
| Add MED_DIR to `PracticeController` WRITE `@Roles` (config edit + staff membership CRUD, practice-scoped via `PracticeMedicalDirector`) | `backend/src/practice/practice.controller.ts` | Lakshitha | PENDING |
| Extend `rbac-cross-practice.e2e-spec.ts` with MED_DIR admin-authority + walkback tests | `backend/test/rbac-cross-practice.e2e-spec.ts` | Lakshitha | PENDING |

Handoff for Lakshitha: `Documents/cardioplace-handoffs/LAKSHITHA_ACCESS_SCOPE_2026_07_01.md` (accompanies this doc).

---

## §3 — MEDICAL_DIRECTOR scope

### §3.1 — Clinical (unchanged since May 2026)

- MED_DIR sees only patients whose `PatientProviderAssignment.practiceId` is in their `PracticeMedicalDirector` memberships (many-to-many).
- Within a practice they head, they see **all patients** regardless of the primary / backup / assignment. Clinical-oversight authority is practice-wide, not per-team.
- Backfill: migration `20260520120000_practice_medical_director_join` derived initial `PracticeMedicalDirector` rows from every distinct `(practiceId, medicalDirectorId)` pair in existing assignments.

### §3.2 — Administrative authority (2026-07-01)

Per Manisha 2026-06-12 and industry EHR convention (Epic, Cerner, athenahealth all give the practice's Medical Director practice-manager-analogue authority for their own site):

- MED_DIR reads + writes the **staff roster** for practices they head (invite, deactivate, reactivate — via `assertCanInvite` / `assertCanDeactivate` MED_DIR branch keyed on `PracticeMedicalDirector.practiceId`).
- MED_DIR edits **practice configuration** for practices they head (business hours, after-hours protocol, timezone) — `practice.controller.ts` WRITE endpoints add MED_DIR with runtime scope check.
- MED_DIR does **NOT** get:
  - **Permanent-close authority** — that's OPS + SUPER only (irreversible tombstoning is org-level).
  - **Practice create/delete** — an MD may run a practice, but org-level lifecycle (spinning up a new practice) is OPS + SUPER.
  - **Cross-practice access** — even if they head Practice A, they don't see Practice B unless they also head it (or via break-glass, which doesn't exist yet).

Rationale: MED_DIRs are the clinical + practice-manager authority for their site. Isolating admin authority to COORDINATOR alone (as the pre-2026-07-01 code did) reverses the org chart — the medical director outranks the coordinator, and the code has to reflect that.

---

## §4 — PROVIDER scope

A PROVIDER has **read and write** access to **every patient in the practices they belong to** (via `PracticeProvider` membership) — the same practice-scoped model MED_DIR uses, keyed off `PracticeProvider` instead of `PracticeMedicalDirector`. Practice membership is the access boundary.

`PatientProviderAssignment` (primary / backup / medical director) still exists and still **names the patient's care team** — it drives escalation routing, the "who's responsible" display, and care-team workflows — but it **no longer gates whether a provider can view or edit the record**. Any provider in the practice can.

**Deliberate widening,** made to support shared in-practice coverage (any clinician on duty can act on any patient). Because it increases PHI exposure, it relies on minimum-necessary use, audit logging (`AccessLog`), and the practice boundary as the privacy line. Cross-practice access still requires break-glass (§10 — not built).

Enforced in `patient-access.service.ts`: the `PROVIDER` branch keys off `PracticeProvider` membership in both `patientScopeFilter` (list) and `assertCanAccessPatient` (per-patient). Edge shared with MED_DIR: a patient with no `PatientProviderAssignment` row yet is invisible to providers — OPS / SUPER handle initial setup.

### §4.1 — The chart / alert-queue split

**Chart** (`GET /provider/patients` + patient detail endpoints) is **practice-wide** for a PROVIDER. Any provider can pull any patient's chart in their practice. Matches Epic (chart = practice-wide any-provider access).

**Alert queue** (`GET /provider/alerts`) is **assigned-only** for a plain PROVIDER — the queue shows only alerts on patients where the caller is primary or backup on `PatientProviderAssignment`. Provider-scoped to focused caseload. Matches Epic In Basket (message center = assigned-only).

Both filters live in `PatientAccessService`:
- `patientScopeFilter(actor)` — practice-wide for PROVIDER (§7.6)
- `alertQueueScopeFilter(actor)` — **assigned-only** for PROVIDER; practice-wide for MED_DIR / OPS / SUPER (§7.8)

**Why the split:** clinical safety + workflow ergonomics. Practice-wide chart visibility is required for coverage (Dr. B fills in for Dr. A on a day off — has to see the chart). Assigned-only alert queue prevents a provider's worklist from drowning in every practice alert — routing to the responsible clinician is the point of `PatientProviderAssignment`. Every mainstream EHR does this same split.

**Verification:** `backend/test/rbac-cross-practice.e2e-spec.ts` covers both filters end-to-end across two seeded practices; the "Rita Washington vs. Kate Wong" UX test (2026-07-01) visually verifies the same in the running app.

---

## §5 — HEALPLACE_OPS scope

Cross-practice visibility intentionally — OPS handles operational support (debugging, escalation handoff, audit follow-up). They see all patients across all practices.

**Excluded from clinical write actions:**
- Cannot acknowledge or resolve alerts
- Cannot change thresholds
- Cannot verify or add medications
- Cannot add clinical readings
- Cannot complete clinical enrollment

**Can:**
- Read every patient's chart across every practice
- Reassign care teams (operational handoff)
- Handle escalation notifications (T+24h / T+48h receivers)
- Manage staff org-wide (invite, deactivate, permanent-close, practice membership CRUD)
- Create / delete practices
- Read audit logs (via direct DB access — no UI)

Principle: **OPS reads everything for operational support, but clinical disposition requires a clinician.**

---

## §6 — COORDINATOR scope

`COORDINATOR` is a non-clinical role for clinic front-desk / practice-manager staff. Scoped to exactly one practice (1:1 via `PracticeCoordinator @unique`).

**Can:**
- Manage their practice's user roster (invite, deactivate, reactivate — `/admin/users` endpoint scoped to `PracticeCoordinator.practiceId`). Reactivation is an explicit re-grant (2026-07-03): a COORDINATOR may only grant roles they could invite (`assertCanGrantRole` — PATIENT / PROVIDER / MED_DIR into their own practice), so reactivation can never mint a COORDINATOR / OPS / SUPER_ADMIN.
- See patient enrollment / verification status for their practice (a non-clinical dashboard surface)

**Cannot (2026-07-01 walkbacks):**
- **Assign or change care teams** — walked back from Lakshitha's #116. Assignment is a clinical-workflow decision (who's the clinical owner of this patient's care), not a front-desk one. Owners: MED_DIR + OPS + SUPER.
- **Permanent-close accounts** — walked back from Lakshitha's #114. Permanent close is irreversible tombstoning (anonymize PII, retain PHI per HIPAA 6-year rule). Reversible deactivate stays with COORDINATOR; permanent close is OPS + SUPER only.

**Cannot (existing):**
- Access clinical data (readings, alerts, medications, thresholds)
- View the alert queue (`GET /provider/alerts` returns 403)
- See Dashboard / Patients / Practices / Alerts pages in the admin app (sidebar items hidden; page-level guards 403 on direct URL navigation)

---

## §7 — `PatientAccessService` (the runtime filter)

Source-of-truth implementation of scope rules: `backend/src/common/patient-access.service.ts`. Every clinical query touching a patient runs through this helper.

### §7.1 — Short-circuit (SUPER_ADMIN / HEALPLACE_OPS)

```typescript
if (actor.roles.includes(UserRole.SUPER_ADMIN) ||
    actor.roles.includes(UserRole.HEALPLACE_OPS)) {
  return {}  // No filter — all patients visible
}
```

### §7.2 — MEDICAL_DIRECTOR (via PracticeMedicalDirector)

```typescript
if (actor.roles.includes(UserRole.MEDICAL_DIRECTOR)) {
  const practiceIds = await this.practicesHeadedBy(actor.id)
  return { providerAssignmentAsPatient: { is: { practiceId: { in: practiceIds } } } }
}
```

### §7.3 — PROVIDER (via PracticeProvider — practice-wide for chart)

```typescript
if (actor.roles.includes(UserRole.PROVIDER)) {
  const practiceIds = await this.practicesForProvider(actor.id)
  return { providerAssignmentAsPatient: { is: { practiceId: { in: practiceIds } } } }
}
```

### §7.4 — Deny path

Per-patient guard `assertCanAccessPatient` throws `ForbiddenException` (HTTP 403). List filter `patientScopeFilter` instead returns an impossible filter (`{ providerAssignmentAsPatient: { is: { id: '__never__' } } }`) so list/queue queries return zero rows rather than erroring. `PATIENT` role short-circuits with self-only logic before this helper runs.

### §7.5 — Practice scope helper

`practiceScopeIds(actor)` returns practice IDs an actor can act within: SUPER_ADMIN / OPS unscoped (all practices); MED_DIR sees `PracticeMedicalDirector` practices; PROVIDER sees `PracticeProvider` practices; COORDINATOR sees the single `PracticeCoordinator` practice.

### §7.6 — `patientScopeFilter(actor)` (chart / list)

Returns:
- `undefined` (no filter) — SUPER_ADMIN, HEALPLACE_OPS
- Practice-bounded via `PracticeMedicalDirector` — MED_DIR
- Practice-bounded via `PracticeProvider` — PROVIDER
- Impossible `__never__` filter (zero rows) — any other role

### §7.7 — Practice-identity strict scoping (active-practice context)

Multi-practice clinicians act as **one practice at a time**. Practice chosen at sign-in is carried as `activePracticeId` claim on the access token (JWT); `PatientAccessService` narrows visibility to just that practice:

- PROVIDER / MED_DIR belonging to two-plus practices get a **practice-selector challenge** at sign-in; zero-membership PROVIDER/MED_DIR **cannot sign in**. COORDINATOR is auto-scoped to their single `PracticeCoordinator` practice. SUPER / OPS bypass the selector (`activePracticeId` stays null).
- With `activePracticeId` set, `scopeToActive` (list) and `inActiveScope` (per-patient guard) narrow to that practice; a multi-practice clinician sees only the active practice's patients until they switch context.
- Narrowing only tightens within real memberships — a stale/forged `activePracticeId` not in the membership list is ignored, never widened. If the backing membership is revoked, `JwtStrategy.validate` rejects the session (`PRACTICE_MEMBERSHIP_REVOKED`).
- Legacy sessions issued before the claim existed carry no `activePracticeId` and fall back to full (union) membership visibility.

### §7.8 — Alert queue filter (`alertQueueScopeFilter`)

Distinct from the chart filter. For the alert worklist (`GET /provider/alerts`):

- SUPER_ADMIN / OPS — no filter (all alerts)
- MED_DIR — practice-scoped via `PracticeMedicalDirector` (all alerts on patients in their practice)
- **PROVIDER — assigned-only** via `PatientProviderAssignment` where `primaryProviderId = actor.id OR backupProviderId = actor.id`
- Any other role — impossible filter (zero rows). COORDINATOR gets 403 at the controller level.

The chart / alert split is the Epic In Basket pattern (see §4.1).

---

## §8 — Per-endpoint authorization matrix

Controller-level `@Roles()` lists the coarse read role-set; method-level `@Roles()` overrides for stricter writes. `PatientAccessService` further scopes at runtime.

### Alert worklist (`provider.controller.ts` — `GET /provider/alerts`)

| Action | Roles allowed | Scope |
|---|---|---|
| READ alert queue | SUPER_ADMIN, HEALPLACE_OPS, MEDICAL_DIRECTOR, PROVIDER | `alertQueueScopeFilter` — PROVIDER assigned-only, MED_DIR practice, OPS/SUPER all. COORDINATOR → 403. |

### Alert resolution (`alert-resolution.controller.ts`)

| Action | Roles allowed |
|---|---|
| READ alert audit trail | SUPER_ADMIN, HEALPLACE_OPS, MEDICAL_DIRECTOR, PROVIDER. HEALPLACE_OPS receives T+24h/T+48h escalations and needs read context. |
| WRITE (acknowledge / resolve) | SUPER_ADMIN, MEDICAL_DIRECTOR, PROVIDER. **HEALPLACE_OPS excluded** — closure is clinical disposition. |

### Thresholds (`threshold.controller.ts`)

| Action | Roles allowed |
|---|---|
| READ | PATIENT (own only), PROVIDER, MEDICAL_DIRECTOR, HEALPLACE_OPS, SUPER_ADMIN |
| WRITE | SUPER_ADMIN, MEDICAL_DIRECTOR, PROVIDER. HEALPLACE_OPS excluded from writes (clinical decision). |

### Care-team assignment (`assignment.controller.ts`)

| Action | Roles allowed |
|---|---|
| READ | All four admin roles. PROVIDER + MED_DIR + OPS see primary / backup / medical director on patient detail. |
| WRITE (2026-07-01) | SUPER_ADMIN, MEDICAL_DIRECTOR, HEALPLACE_OPS. **PROVIDER excluded** (they don't reassign their own care team). **COORDINATOR excluded** (walkback from #116 — assignment is a clinical decision). MED_DIR runtime-scoped to `PracticeMedicalDirector` practices. |

### Practice CRUD (`practice.controller.ts`)

| Action | Roles allowed |
|---|---|
| READ | All four admin roles + COORDINATOR (dropdowns / labels). |
| WRITE update (config, hours, protocol) — 2026-07-01 | SUPER_ADMIN, HEALPLACE_OPS, MEDICAL_DIRECTOR (practice-scoped). Was SUPER + OPS only. |
| WRITE create / delete | SUPER_ADMIN, HEALPLACE_OPS only. **MEDICAL_DIRECTOR excluded** — org-level lifecycle. |

### Practice membership (`practice.controller.ts` — `/practices/:id/providers/:userId`)

| Action | Roles allowed |
|---|---|
| Add / remove practice staff — 2026-07-01 | SUPER_ADMIN, HEALPLACE_OPS, MEDICAL_DIRECTOR (practice-scoped). Was SUPER + OPS only. |

Bootstrapping a practice with staff before the first patient is assigned: MED_DIR can staff their own practice; OPS / SUPER can bootstrap any practice. (Otherwise the assignment dropdown would be empty.)

### User lifecycle (`users.controller.ts` — `/admin/users/*`)

| Action | Roles allowed |
|---|---|
| READ user roster — 2026-07-01 | COORDINATOR, HEALPLACE_OPS, SUPER_ADMIN, **MEDICAL_DIRECTOR** (added). Scoped: COORDINATOR + MED_DIR practice-only; OPS + SUPER all. |
| Invite staff — 2026-07-01 | Same. MED_DIR + COORDINATOR practice-scoped via `assertCanInvite`. |
| Deactivate — 2026-07-01 | Same. MED_DIR + COORDINATOR practice-scoped via `assertCanDeactivate`. |
| **Reactivate — 2026-07-03 (explicit re-grant)** | Target-scope via `assertCanDeactivate` (same as deactivate), THEN a deliberate, audited **re-authorization** (HIPAA §164.308(a)(4)): the admin sends the role(s) to grant (`{ roles, practiceId, reason }` — no silent restore), each checked against the **same** grant-authority matrix as invite via `assertCanGrantRole`. Practice-bound roles (PROVIDER / MED_DIR / COORDINATOR) require a `practiceId`; missing → 400; an out-of-scope grant → 403. On success: `accountStatus=ACTIVE`, `roles` set to the granted set, `tokenVersion` bumped (clean slate), practice join rows reconciled, and an `AccountClosureLog` REACTIVATE row records `grantedRoles` / `practiceId` / `priorRoles` / `reason`. |
| Permanent-close — 2026-07-01 | SUPER_ADMIN, HEALPLACE_OPS only. **COORDINATOR excluded** (walkback from #114 — irreversible tombstoning is org-level). |
| Remove role | Method-level `@Roles`: SUPER, OPS. Any actor except SUPER cannot remove SUPER_ADMIN role. |

Patient self-close (`auth.controller.ts` — `/v2/auth/account/permanent-close`): PATIENT self-only (own record).

### Admin-side clinical data entry

#### Medications (`admin-intake.controller.ts`)

| Action | Roles allowed |
|---|---|
| Add medication on patient's behalf | SUPER_ADMIN, PROVIDER, MEDICAL_DIRECTOR |
| Edit medication | SUPER_ADMIN, PROVIDER, MEDICAL_DIRECTOR |
| Verify medication | SUPER_ADMIN, PROVIDER, MEDICAL_DIRECTOR |

**COORDINATOR + OPS excluded** — medication entry is clinical.

#### Readings (journal admin CRUD — per #92)

| Action | Roles allowed |
|---|---|
| Admin add / edit / delete reading | SUPER_ADMIN, PROVIDER, MEDICAL_DIRECTOR |

**COORDINATOR + OPS excluded** — clinical data entry.

### Enrollment (`enrollment.controller.ts`)

| Action | Roles allowed |
|---|---|
| READ `/enrollment-check` | SUPER_ADMIN, MEDICAL_DIRECTOR, PROVIDER (4-piece checklist) |
| WRITE complete-onboarding | SUPER_ADMIN, MEDICAL_DIRECTOR, PROVIDER. HEALPLACE_OPS excluded — they handle assignment, not clinical readiness. |

---

## §9 — Admin app UI guards

Admin sidebar (`admin/src/components/AdminSidebar.tsx`) hides items from roles that have no access. Hiding is for UX; the security boundary is the backend `@Roles()` decorator + `PatientAccessService` filter.

Post-2026-07-01:

- **MED_DIR** — sidebar shows Dashboard, Patients, Practices, Alerts, **Users** (new). Their own practice's config page becomes editable (loses "READ-ONLY" badge for practices they head).
- **PROVIDER** — sidebar shows Dashboard, Patients, Practices (read-only labels), Alerts. Users tab stays hidden. Practice detail's Staff section is visible read-only.
- **COORDINATOR** — sidebar shows only Users (their practice's roster). Dashboard / Patients / Practices / Alerts hidden. Care-team assignment control removed from patient detail (walkback #116). Permanent-close button removed from user detail (walkback #114); deactivate/reactivate remain.
- **HEALPLACE_OPS** — sidebar shows everything (scoped org-wide reads); clinical write actions greyed out (no ack/resolve/verify).
- **SUPER_ADMIN** — full UI.

Scope-not-hide pattern: CRUD buttons are visually present but disabled + tooltipped for roles that lack write authority (rather than silently absent — makes the permission boundary discoverable).

---

## §10 — Adjacent controls & what's out of scope

This role-scope policy is not the system of record for authentication or session controls.

**Now implemented (governed by authentication / session policy, not this doc):**
- **Multi-factor authentication** — mandatory TOTP second factor for all staff roles (PROVIDER, MEDICAL_DIRECTOR, COORDINATOR, HEALPLACE_OPS, SUPER_ADMIN) with recovery codes + failed-attempt lockout (soft lock at 5 fails / 15 min, hard lock at 10 / 1 h). Patients stay on email OTP + magic link with optional opt-in WebAuthn / passkey second factor. See `backend/src/auth/mfa.service.ts`.
- **Idle session timeout / auto-logoff** — role-based inactivity logout: 15 min (web) / 5 min (mobile), enforced backend-side in `AuthService.rotateRefreshToken` via `AuthSession.lastActivityAt` and client-side by the `useIdleTimeout` hook in both apps. Access token also retains its absolute ~15-min expiry.
- **AccessLog audit write** — every PHI read/write on the seven PHI models writes an audit row (actor, action, model, recordId, IP, UA, timestamp) per HIPAA §164.312(b). Implemented in the Prisma client extension (`backend/src/common/prisma-extensions/access-log.extension.ts` + `CardioplaceClsModule`). Ships in PR #115 (2026-07-01). *Updated 2026-07-13 (N-3): CLS is mounted as **middleware**, not an interceptor, so a context exists before the guards run; `JwtStrategy` stamps the actor from the verified token payload before its own `User` read, which is what stopped every authenticated request logging `system: unknown`.*

**Not implemented / out of scope:**
- **AccessLog admin-read UI** — write side compliant; no reader UI in the admin app to avoid bloating navigation. OPS / SUPER can query via direct DB access if needed. Revisit if pilot ops flow demands a reader.
- **In-app patient-consent workflow** for ad-hoc access — not needed for same-practice TPO access per Manisha 2026-06-12 Q3.
- **Break-glass / emergency-access mechanism** for providers outside the patient's practice — in-practice providers now have standing access; break-glass is only for crossing the practice boundary. Not built. Deferred to post-pilot.
- **Patient-initiated practice transfer.**
- **SMS/Twilio notification channel + "one number per practice" hotline model** — discussed in Manisha 2026-06-12 live-call additions; new scope, separate track.

Deferred items tracked in the sprint doc + separate handoffs.

---

## Revision history

- **Original creation:** unclear date in May 2026 — referenced by `practice_medical_director.prisma` migration on 2026-05-20 + surrounding controller comments
- **Lost:** ~2026-06-01 to 2026-06-07 due to `git clean -fdx` clearing untracked files
- **Reconstructed 2026-06-11 (Duwaragie):** from code references, controller `@Roles()` decorators, schema comments, `PatientAccessService` implementation. May have missed some original framing.
- **Expanded 2026-06-24 (Humaira):** brought in line with June 2026 practice-wide provider decision, added §7.7 practice-identity strict scoping, corrected §7.4–§7.6 helper behavior, recorded MFA + idle auto-logoff as implemented, added §2.1 matrix.
- **Updated 2026-07-01 (Duwaragie):**
  - Added **§4.1 chart / alert-queue split** — chart practice-wide, alert queue assigned-only for PROVIDER (Epic In Basket pattern). Was implicit in code but not documented.
  - Added **§7.8 alert queue filter** — explicit runtime behavior of `alertQueueScopeFilter`.
  - Added **§3.2 MED_DIR practice-scoped admin authority** per Manisha 2026-06-12 Q2 — staff roster read/write + practice config edit + practice-staff membership CRUD for practices they head. Pending code implementation (Lakshitha).
  - **Walked back COORDINATOR write scope on two surfaces** — care-team assignment (was in #116) and permanent-close (was in #114). Reversible deactivate/reactivate remain with COORDINATOR.
  - Added **admin-side clinical data entry endpoints** to §8 — medications (admin-intake.controller.ts), journal admin CRUD (per #92). All gated to SUPER + PROVIDER + MED_DIR.
  - Added **§10 AccessLog audit write** — implemented (PR #115); admin-read UI intentionally not built.
  - Added **§2.1 permission matrix** — full role × permission grid with implementation status (PENDING rows track the Lakshitha handoff).
  - Added **§2.2 implementation status** — Lakshitha handoff pointer + per-change file locations.

Source of truth for this revision: Manisha 2026-06-12 access-control sign-off (`docs/clinical-signoffs/MANISHA_2026_06_12_ACCESS_CONTROL_AND_CLINICAL_WORKFLOW.md`) + HIPAA §164.312 + §164.502(b) TPO exception + Epic / Cerner / athenahealth conventions + `backend/test/rbac-cross-practice.e2e-spec.ts` evidence of current code behavior.
