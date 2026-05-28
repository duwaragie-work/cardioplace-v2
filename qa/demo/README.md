# DCHA demo seed refresh — runbook

Two short demo videos against **production** Cardioplace for DCHA leadership
(Jacqueline Bowens · John Norman). Production seed was stale (gap-alert
reminders showing 20+ days since the last reading, no Wards-7&8-representative
persona, admin queue empty). This branch refreshes the seed.

## What this branch ships

- `backend/prisma/seed/practices.ts` — practice renamed to **Cedar Hill
  Regional Medical Center** (matches DCHA briefing wording, same `seed-cedar-hill` id).
- `backend/prisma/seed/admins.ts` — Okonkwo / Reyes / Raman now on the real
  inboxes Duwaragie controls (`duwaragie22@gmail.com`,
  `itsm.zayan@gmail.com`, `smartcampus.team@gmail.com`). Other admins
  (`support@healplace.com`, `ops@healplace.com`,
  `manisha.patel@cardioplace.test`) unchanged.
- `backend/prisma/seed/patients.ts` — full rewrite. Seven DCHA personas:
  Marcus, Daniel, Patricia, Robert, Doris, James, Loretta. Marcus's
  9 lived-in readings + companions' inline alert + escalation + notification
  state live here (state.ts is now a no-op stub).
- `backend/prisma/seed/state.ts` — emptied to a no-op; alert seeding moved
  inline into `patients.ts`.
- `qa/demo/preflight_cleanup.sql` — one-time prod cleanup that wipes the 11
  rows being replaced. Hardcoded email list, never patterns.
- `qa/demo/99_reset_marcus.sql` — between-takes reset for Marcus only.
- `qa/reports/demo-seed-inspection.md` — read-only Phase-1 sweep of prod
  showing what was there before this cleanup.

## Spec deviation (one)

**Caregivers are dropped from this seed cut.** The spec wanted Tasha Williams
(`duwaragie@healplace.com`) seeded as Marcus's caregiver with
`consent=GRANTED, channel=EMAIL`, plus Marcus Davis as Loretta's caregiver,
and the "caregiver email lands in Tasha's inbox" recording moment. None of
that is buildable on the current main schema or on prod:

- `PatientCaregiver` table does **not** exist on prod (`information_schema`
  lookup, May 2026 — latest migration is `20260522120000_notification_patient_subject`).
- `UserRole` enum on prod has 5 values; no `CAREGIVER`.
- `escalation.service.ts:1013 findCaregiverUserIds()` is a placeholder
  returning `[]` until Lakshitha's Gap 5 ships.

The caregiver model + role + dispatch path ship on the unmerged branches
`fix/caregiver-escalation-followups` (37 commits ahead of main) and
`nivakaran-dev` (62 ahead). Until one of those lands on main and deploys to
prod, the recording can't show a caregiver email going out.

For this take: the seed runs cleanly, Marcus has no caregiver record, the
Phase-3 "Caregiver panel = Tasha Williams" check is skipped, and the
runbook below has no `CAREGIVER_DISPATCH_ENABLED` step.

## Apply order on prod

```
1. Take a DB snapshot of prod (Prisma Postgres console → backup).
2. Run qa/demo/preflight_cleanup.sql against prod as a DRY-RUN
   (the file ends with ROLLBACK by default).
   Review the row-count SELECT at the bottom; counts should show
   the preserved real-signup rows still present and the 11 replaced
   rows gone.
3. Flip the last two lines of preflight_cleanup.sql (ROLLBACK <-> COMMIT)
   and re-run.
4. cd backend && npx prisma db seed
   This creates Cedar Hill Regional Medical Center, the 3 admins
   (Okonkwo / Reyes / Raman on the real inboxes), and the 7 patients
   with Marcus's 9 lived-in readings + the companions' inline alert
   state.
5. Walk the Phase-3 checklist below on the live prod URLs.
6. Record.
7. Between takes, run qa/demo/99_reset_marcus.sql (dry-run, then commit)
   to wipe whatever Marcus did during the previous take while keeping
   his 9 lived-in entries intact.
```

## Phase-3 checklist (must be green before recording)

### Patient app, signed in as Marcus (OTP `666666`, email `duwaragiek.racsliit@gmail.com`)

- [ ] Onboarding complete — lands on dashboard, not the intake form.
- [ ] Dashboard chart shows the 9-entry 128–152 systolic arc, clean.
- [ ] *My Readings* → Day-17 entry opens with BP 138/86, pulse 72,
      position **standing**, **fatigue** checked, all 4 meds ✓.
- [ ] *My Readings* → Day-10 entry opens with BP 132/82, pulse 70,
      position sitting, **leg swelling** checked, Furosemide marked
      "skipped — frequent bathroom trips", other 3 meds ✓.
- [ ] Notifications bell has ≤ 2 items; **no** "X days since" copy with
      absurd day counts.
- [ ] Chat / Health Assistant opens empty.
- [ ] BP photo capture + audio button + language switcher all work
      without errors.

### Patient app, signed in as Daniel (OTP `666666`, email `daniel.brown@cardioplace.demo`)

- [ ] Lands on the intake form (`onboardingStatus = NOT_COMPLETED`).
- [ ] No prior readings, no alerts, no notifications.

### Admin app, signed in as `support@healplace.com` (Dr. Manisha Singal)

- [ ] Provider dashboard alert queue shows three rows: **Patricia
      Johnson** (L1-HIGH, "in progress"), **James Lewis** (adherence
      nudge, yellow), **Loretta Davis** (HF-decomp). Marcus appears
      only after Video-1 fires him live.
- [ ] Patients list: 7 demo patients, all with realistic last-reading
      dates (none > 30 days).
- [ ] **Doris Thompson → Timeline** → the resolved alert expands with
      the 5-step ladder (T0/T4H/T8H/T24H/T48H), the 15-field audit
      panel, and the resolution rationale "Adjusted lisinopril from
      10mg to 20mg daily; will recheck BP in 48h."
- [ ] **Loretta Davis** → her HF-decomp alert renders with the **teal
      heart-failure** card, not the blue "low BP" template (confirms
      Niva's A1 fix is on main).
- [ ] **Marcus** → threshold reads `< 130/80`. No caregiver panel
      (spec deviation — see above).

## Hand-back

Push the branch (`demo/dcha-seed-refresh`). Do not merge to main. Duwaragie
applies the runbook on prod.
