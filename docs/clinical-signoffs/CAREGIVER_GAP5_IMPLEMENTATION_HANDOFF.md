# Niva — Gap 5 (Caregiver) + Follow-on Implementation Guide

**Owner:** Niva
**Branch:** continue on `nivakaran-dev` (your perennial branch). Coordinate the eventual merge with Duwaragie — Lakshitha is on the manual-testing bug-fix PR in parallel, so avoid touching the same files.
**Priority order:** Gap 5 first (it's the largest + unblocks a whole alert tier). The 5 follow-ons come after, in the order listed in Part B.

> **Note on ownership:** the code comments say "Lakshitha's Gap 5" — that's being reassigned to you. Update those comments to drop the name (or just remove the attribution) as you implement.

---

# PART A — GAP 5: The Caregiver Feature

## §0 — What already exists (don't rebuild these)

The caregiver *message tier* is fully built; only the *delivery + relationship + UI* are missing.

| Piece | State | Location |
|---|---|---|
| `caregiverMessage` on every rule (with `patientName` interpolation) | ✅ Built | `shared/src/alert-messages.ts` (RuleMessages interface ~line 105) |
| `DeviationAlert.caregiverMessage` column (stored per alert) | ✅ Built | `backend/prisma/schema/diviation_alert.prisma:23` |
| `'CAREGIVER'` RecipientRole type | ✅ Defined | `backend/src/daily_journal/escalation/ladder-defs.ts:47` |
| 3 caregiver-routed rules | ✅ Built | `escalation.service.ts:38-44` — `RULE_HF_CAREGIVER_EDEMA`, `RULE_ACE_ANGIOEDEMA`, `RULE_GENERIC_ANGIOEDEMA` |
| `dispatchCaregiverNotification()` | 🟡 Gated no-op | `escalation.service.ts:~988` — gated on `CAREGIVER_DISPATCH_ENABLED`, calls the stub below |
| `findCaregiverUserIds()` | 🟡 Stub returns `[]` | `escalation.service.ts:~1013` |
| `Notification` model + DASHBOARD/EMAIL/PHONE/PUSH channels + `@@unique` idempotency | ✅ Built | `notification.prisma`, `daily_journal.prisma:109` |
| `CAREGIVER_DISPATCH_ENABLED` flag (default false) | ✅ Built | `backend/.env.example:68` |
| **PatientCaregiver model** | ❌ Missing | — |
| **Patient caregiver UI** (intake + profile) | ❌ Missing | — |
| **Admin caregiver UI** (patient detail) | ❌ Missing | — |
| **Caregiver delivery mechanism** | ❌ Undecided | see §1 |

## §1 — DECISION GATE (resolve BEFORE building §3+)

**The one decision that shapes everything: how does a caregiver actually receive the message?**

The current stub assumes the caregiver is a logged-in `User` (it creates a `Notification` keyed to a `caregiverUserId`, channel `DASHBOARD`). But a real caregiver — an elderly Ward 7/8 patient's son or neighbor — almost certainly will NOT create and log into a clinical app. So pick one:

| Option | Mechanism | Pros | Cons |
|---|---|---|---|
| **A. Caregiver = lightweight User + dashboard** | Caregiver gets a magic-link account; sees a stripped caregiver view with only their linked patient's caregiver messages | Matches existing stub (caregiverUserId + DASHBOARD); reuses auth | Account-creation friction; unrealistic for many caregivers |
| **B. Caregiver = contact (no account) + SMS/email** | Store name + phone/email on a `PatientCaregiver` record; dispatch via SMS (Twilio) / email — no login | Realistic for the cohort; lowest friction | Needs an SMS provider (none wired today); PHI-over-SMS consent/compliance question; doesn't reuse the User-keyed Notification path |
| **C. No dispatch — patient shows them** | Patient app renders the caregiver-tier message on the alert detail for the patient to show their family member in person | Zero new infra; no PHI-transmission risk | No proactive caregiver reach; defeats the point of caregiver alerts for unreachable patients |

**My recommendation for the pilot:** **Option B (contact + SMS/email), with a clean abstraction so the dispatch channel is swappable.** It's the only one that actually reaches a caregiver who isn't sitting next to the patient — which is the whole clinical point (HF edema, angioedema). BUT this is a **product + clinical + compliance decision (Manisha + Duwaragie + counsel)** — PHI over SMS needs sign-off. **Do not start §3/§6 until Duwaragie confirms the channel.**

**Decision-independent work you CAN start now:** §2 (schema for the caregiver relationship — the contact record is needed regardless of channel) and the §4/§5 UI to *capture* caregiver contacts. Only the dispatch (§3/§6) depends on the channel choice.

## §2 — Schema: `PatientCaregiver` model (start here — decision-independent)

Add a new model. A caregiver is a **contact attached to a patient**, NOT necessarily a User.

```prisma
// backend/prisma/schema/patient_caregiver.prisma
model PatientCaregiver {
  id              String   @id @default(uuid())
  patientUserId   String                          // the patient this caregiver supports
  name            String
  relationship    String?                         // "daughter", "neighbor", etc. (free text MVP)
  phone           String?                         // E.164 if SMS channel
  email           String?
  // Delivery preference — drives §6. Default to whatever §1 decides.
  notifyChannel   CaregiverNotifyChannel @default(NONE)
  // Consent: HIPAA — the patient must consent to sharing PHI with this caregiver.
  consentGivenAt  DateTime?
  consentGivenBy  String?                         // userId who recorded consent (patient or admin)
  // If Option A (account): link to a User. Null for contact-only (Option B).
  caregiverUserId String?
  active          Boolean  @default(true)         // soft-disable instead of hard delete (audit)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  patient   User  @relation("PatientCaregivers", fields: [patientUserId], references: [id], onDelete: Cascade)
  @@index([patientUserId])
}

enum CaregiverNotifyChannel {
  NONE      // captured but not yet notified (pre-consent)
  DASHBOARD // Option A
  SMS       // Option B
  EMAIL     // Option B
}
```

- Add the back-relation on `User` (`caregivers PatientCaregiver[] @relation("PatientCaregivers")`).
- **Prisma workflow:** create the migration locally or against a container DB, then `npx prisma migrate deploy` + `npx prisma generate`. **Never `prisma migrate dev` against the shared Prisma Cloud DB** — it trips on the `prisma_postgres` extension drift. (Same gotcha that bit the Cluster 8 work.)
- Commit: `feat(schema): PatientCaregiver model + CaregiverNotifyChannel (Gap 5)`

## §3 — Backend: implement the dispatch (after §1 decision)

1. **`findCaregiverUserIds()` → `findCaregivers()`** in `escalation.service.ts`: replace the `[]` stub. Query `PatientCaregiver` where `patientUserId = X`, `active = true`, `consentGivenAt != null`, `notifyChannel != NONE`. Return the records (not just userIds — you need phone/email for Option B).
2. **`dispatchCaregiverNotification()`**: for each caregiver, dispatch per their `notifyChannel`:
   - DASHBOARD → existing `Notification.create({ channel: 'DASHBOARD', ... })` keyed to `caregiverUserId`
   - SMS → new SMS dispatch (needs a provider — Twilio or similar; coordinate with Duwaragie on the account). Keep it behind a small `SmsService` abstraction so it's testable/mockable.
   - EMAIL → reuse the existing `EmailService` (`email.service.ts`) with a caregiver template.
3. **Idempotency:** the `Notification` `@@unique([alertId, escalationEventId, userId, channel])` handles dashboard dupes. For SMS/email (no Notification row if caregiver isn't a User), add a `CaregiverDispatchLog` row or reuse Notification with a synthetic key — so a re-fired alert doesn't double-text. Decide with Duwaragie.
4. **Keep the `CAREGIVER_DISPATCH_ENABLED` gate** until the UI (§4/§5) ships + consent capture works. Flip it on only when the full loop is live.
5. **HIPAA — Minimum Necessary:** the caregiver message must contain only what's clinically necessary (it already does — it's the signed-off caregiverMessage tier). Do NOT add extra PHI (no full readings, no other conditions) to the dispatch.

Commit: `feat(caregiver): wire findCaregivers + dispatch per channel (Gap 5)`

## §4 — Patient UI: add/manage caregivers + consent

The patient (or admin on their behalf) adds caregiver contacts. This is where **consent** is captured.

- **Clinical intake wizard** (`frontend/src/app/clinical-intake/`): add an optional "Add a caregiver" step — name, relationship, phone/email, and a clear consent checkbox ("I agree Cardioplace may share health alerts with this person"). Capture `consentGivenAt`.
- **Profile** (`frontend/src/app/profile/`): a "Caregivers" section to add/edit/remove (soft-disable) caregivers post-intake.
- **Mobile-first:** this is a patient surface — test it at phone width (the patient app's primary device). Add `data-testid`s via the `T` registry.

Commit: `feat(patient): caregiver capture + consent in intake + profile (Gap 5)`

## §5 — Admin UI: caregiver visibility + management

Provider/admin needs to see + manage a patient's caregivers (e.g., add one a patient mentioned by phone, or disable a stale contact).

- **Patient detail** (`admin/src/components/patient-detail/`): add a **Caregivers** section (a new tab, or a panel in CareTeamTab — discuss with Duwaragie which). Show name/relationship/channel/consent status; allow add/edit/disable.
- Respect RBAC: who can manage caregivers? Recommend MEDICAL_DIRECTOR + HEALPLACE_OPS + the assigned PROVIDER (mirror the verification permission). Add a `data-testid` set.
- **Audit:** caregiver add/edit/consent changes should write to the `ProfileVerificationLog` (or a caregiver-specific audit) — it's PHI-sharing config, JCAHO-relevant.

Commit: `feat(admin): caregiver management on patient detail (Gap 5)`

## §6 — Wire it across ALL surfaces (the Cluster-8 lesson)

When Cluster 8 angioedema was added, it was wired patient-side only and the admin side was missing across ~11 sites — caught late by tests. **Don't repeat that.** When you add the caregiver tier, check every surface:
- Patient app: caregiver capture (intake + profile) + the alert detail already shows the caregiver tier? (verify)
- Admin app: caregiver management + the admin alert view should show "caregiver notified at T+0" in the escalation/audit trail
- Escalation audit trail: a CAREGIVER dispatch should appear as a row (recipient = caregiver, channel = SMS/email/dashboard)
- Notifications: if DASHBOARD, the caregiver inbox renders it

## §7 — Tests (match the Cluster 8 bar — no fake skips)

This is the standard now: **every new rule/feature gets engine unit + UI E2E + a §F.1 rule-coverage entry.** The §F.1 rule-coverage gate, message-snapshot, and i18n-completeness gates are live — they'll flag gaps.

- **Backend unit:** caregiver found/not-found, consent gate (no dispatch without consent), channel routing (DASHBOARD/SMS/EMAIL), idempotency (re-fired alert doesn't double-dispatch), the 3 caregiver-routed rules dispatch correctly when flag ON.
- **UI E2E:** patient adds caregiver + consent (mobile viewport); admin manages caregiver; caregiver receives the message on their channel (for DASHBOARD, assert the inbox row; for SMS/email, assert the dispatch was called via a stub — `page.route()` / mock the SmsService).
- **Negative:** with `CAREGIVER_DISPATCH_ENABLED=false`, NO caregiver dispatch happens (this test already exists in spec 19/14c — keep it green).
- **Run engine-heavy sweeps against a local pgvector container** (the shared Cloud DB flakes under load). `tsc --noEmit -p tsconfig.build.json` for the backend gate.

Commit: `test(caregiver): engine + UI coverage for Gap 5 dispatch + consent`

## §8 — Flip the flag + final

Only after §2–§7 are green: set `CAREGIVER_DISPATCH_ENABLED=true` in dev/staging (NOT prod until pilot sign-off), update `.env.example` comment to drop "Lakshitha's Gap 5," and update `qa/reports/RESULTS.md`.

## §9 — Gap 5: What NOT to do

- **Don't start §3/§6 before the §1 channel decision** — building the wrong dispatch wastes the effort.
- **Don't transmit extra PHI** to caregivers — only the signed-off `caregiverMessage` (Minimum Necessary).
- **Don't dispatch without consent** — `consentGivenAt` is a hard gate.
- **Don't `prisma migrate dev` on the shared Cloud DB** — use migrate deploy / generate / local container.
- **Don't half-wire it** (patient-only) — hit patient + admin + escalation audit + notifications (§6).
- **Don't flip `CAREGIVER_DISPATCH_ENABLED` in prod** until the full loop + consent + pilot sign-off.
- **Don't skip tests** — engine + UI + §F.1 entry, mobile-tested patient UI.

---

# PART B — Follow-on Tasks (after Gap 5)

Do these in order. Each is small relative to Gap 5.

## B.1 — Cover the 4 uncovered Cluster 6 rules (quick)

The §F.1 rule-coverage gate flags 4 rules with zero test coverage:
`RULE_LOOP_DIURETIC_HYPOTENSION`, `RULE_AFIB_PALPITATIONS`, `RULE_TACHY_WITH_PALPITATIONS`, `RULE_PALPITATIONS_GENERAL`.

- Add engine unit scenarios in `backend/src/daily_journal/services/alert-engine.scenarios.spec.ts` (mirror the existing Cluster 6 scenario patterns). One scenario each: the triggering reading/symptom → assert the rule fires at the right tier.
- Remove the 4 entries from the §F.1 allowlist so the gate enforces them going forward.
- Commit: `test(engine): cover 4 Cluster 6 rules (loop-diuretic, palpitations) + remove from §F.1 allowlist`

## B.2 — Fix the 20 pre-existing backend spec failures (CI health)

Baseline debt predating Cluster 8 (verified pre-existing). Fix by category:
- **alert-engine.service.spec.ts (2)** — stale auto-resolve-sweep assertions (the sweep was removed in `37b7989` for JCAHO). Same fix as scenarios.spec.ts sc 16/63: flip to `expect(updateMany).not.toHaveBeenCalled()` (or delete if redundant). **Test-only — do NOT bring back auto-resolve.**
- **chat.service.spec.ts (15)** — phase/16 ProfileResolver integration. Investigate; these are the bulk. Likely the mocks need updating to the new ProfileResolver signature. Fix the mocks, don't change product behavior unless a real bug surfaces (then escalate).
- **journal-tools.spec.ts (3)** + **output-generator.service.spec.ts (1, pregnancy+ACE warm-language)** — update assertions to current behavior.
- Gate on `tsc --noEmit -p tsconfig.build.json` + full `jest`. Goal: backend suite fully green.
- Commit per category: `fix(test): <spec> — reconcile to current behavior (CI health)`

## B.3 — Hoist escalation ladder shapes to `@cardioplace/shared`

Today the ladder step shapes are duplicated between backend (`ladder-defs.ts`) and frontend (`EscalationAuditTrail.tsx` — incl. the angioedema compressed ladder we added). Drift risk for a clinical timeline.
- Move the ladder definitions (step codes + labels) into `shared/src/` so both backend + admin import one source.
- Update `EscalationAuditTrail.tsx` to import from shared (remove the duplicated constant + its "MUST mirror backend" comment).
- Add a guard test asserting backend + frontend render the same ladder steps per tier.
- Commit: `refactor(shared): hoist escalation ladder shapes to @cardioplace/shared (drift guard)`

## B.4 — Flip Chat v2 prompt (after clinical review)

`CHAT_V2_PROMPT_ENABLED=false` — the v2 prompt is built (phase/16), awaiting Manisha's clinical review.
- **Blocked on Manisha sign-off** — confirm with Duwaragie that she's approved before flipping.
- Once approved: set `CHAT_V2_PROMPT_ENABLED=true` in dev/staging, run the LLM-gated chat tests (`RUN_LLM_TESTS=1`, Gemini key), verify the v2 prompt + guardrails behave (text + voice — the prompt drives both).
- Commit: `feat(chat): enable v2 system prompt (Manisha-approved)` — only after sign-off.

## B.5 — Bespoke angioedema admin chrome + resolution actions

Cluster 8 wired angioedema into admin as **identical to Tier-1 contraindication** (MVP). The follow-up is angioedema-specific treatment:
- **Admin chrome:** a distinctive "airway" pill/badge (vs the generic red Tier-1 chrome) so providers instantly recognize an airway emergency. Touches the `tierBucket()`/chrome sites we updated in FIX 5b.
- **Resolution actions:** angioedema-specific catalog (e.g., "ACE discontinued in ED", "patient admitted", "evaluated — not angioedema") vs the reused `TIER1_FALSE_POSITIVE` etc. This is in `provider.service.ts` `actionsForTier()`.
- **Both need Manisha sign-off** on the chrome treatment + the resolution-action wording. Confirm before building.
- Tests: extend the §D-ADMIN angioedema tests to assert the bespoke chrome + the new resolution actions.
- Commit: `feat(admin): bespoke angioedema chrome + resolution actions (Manisha-approved)`

---

## Cross-cutting reminders (apply to all of the above)

- **Branch:** `nivakaran-dev`. Coordinate merge with Duwaragie; Lakshitha is on a parallel bug-fix PR — avoid file collisions.
- **Prisma:** `migrate deploy` / `generate` / local container. Never `migrate dev` on shared Cloud DB.
- **tsc gate:** backend uses `tsconfig.build.json` (the default tsc shows ~pre-existing spec-mock-typing noise — ignore once B.2 lands).
- **Test bar:** engine unit + UI E2E + §F.1 entry per rule/feature. No fake skips — escalate Category-C product gaps instead.
- **Mobile:** any new patient UI (caregiver capture) must be tested at phone width — that's a known coverage gap and a clinical-safety surface.
- **Commits:** one short line, no body, no `Co-Authored-By` (CLAUDE.md).
- **Don't merge to dev yourself** — Duwaragie sequences merges.
