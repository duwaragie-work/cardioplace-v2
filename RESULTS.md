# Manual-test round 2 — RESULTS

Branch: `fix/caregiver-escalation-followups` (off `nivakaran-dev`). Don't merge — Duwaragie sequences.

## Spec delta flagged for Dr. Singal (Group B)

**Reverses CLINICAL_SPEC Part 13.2.** That section mandated an immediate patient DASHBOARD/push notification on BP Level 1 firing "so the patient doesn't have to open the app to learn their BP needs attention." Round 2 (Duwaragie-approved, this PR) **retires the patient in-app mirror entirely**:

- The patient's in-app `Notification` surface (bell / `/notifications` page) now carries **admin/care-team action events only** — medication HOLD, profile-field reject, ack/resolve, threshold change, follow-up call scheduled, plus the gap-alert + monthly-reask engagement crons.
- Clinical alerts (Tier 1, Tier 2, Tier 3 patient-visible, BP-L1, BP-L2) **no longer mirror** into the inbox. The alert surface (`/alerts/[id]` → `TierAlertView`) + the dashboard banner are the patient-facing channels.
- **Emails + provider/MD/caregiver escalation are UNTOUCHED.** Every `EmailService.sendEmail` call, every provider/backup/MD escalation row, and the caregiver dispatch path keep firing exactly as before.

**Code sites removed (Group B):**
- `backend/src/daily_journal/services/alert-engine.service.ts:835-860` — the patient DASHBOARD `notification.create` block (the "Cardioplace Alert" mirror).
- `backend/src/daily_journal/services/alert-engine.service.ts:988-1013` — the now-unused `patientNotificationTitle()` helper.
- `backend/src/daily_journal/services/escalation.service.ts:361-376` — the `BP_LEVEL_1_PATIENT_T0` patient PUSH+DASHBOARD dispatch in `fireT0()`. The `BP_LEVEL_1_PATIENT_T0` ladder step is still exported from `ladder-defs.ts` for symmetry + future re-instate; just no longer dispatched.

**Code sites preserved:**
- `backend/src/daily_journal/services/escalation.service.ts:382-392` — angioedema patient T+0 (`ANGIOEDEMA_PATIENT_T0`). Airway emergency: patient MUST get the 911 CTA push.
- `backend/src/daily_journal/services/escalation.service.ts:dispatchCaregiverNotification` — caregiver DASHBOARD/EMAIL/SMS dispatch unchanged.
- All admin-action patient notifications (`intake.service.ts` HOLD + profile reject, `threshold.service.ts` threshold change, `provider.service.ts` follow-up call + ack/resolve, `alert-resolution.service.ts` angioedema-resolved patient PUSH).
- All engagement crons (`gap-alert.service.ts`, `monthly-reask.service.ts`).

**Regression-pinning tests added:**
- `alert-engine.service.spec.ts` — explicit "does NOT write a patient Notification row when a clinical alert fires" assertion.
- `escalation.service.spec.ts` — 3 BP-L1 dispatch tests rewritten: only ONE EscalationEvent (provider step) is created at T+0; no `PATIENT`-recipient event; no patient-userId Notification row.

**Action requested of Dr. Singal:** sign off on the inbox-stops-mirroring direction before pilot, OR direct us to re-instate the patient PUSH/DASHBOARD path (the code shape is preserved — re-instate is a one-line dispatch call in `escalation.service.ts:fireT0`).

---

## Group results

### Group C — Tier-3 caregiver/physician-only patient suppression ✅
Backend filter at `daily_journal.service.ts:getAlerts()` drops `tier: 'TIER_3_INFO' AND empty patientMessage` rows from the patient list. Frontend `journal.service.ts:getAlerts()` carries the same predicate as a safety net. Patient sees no card and no notification for RULE_HF_CAREGIVER_EDEMA / RULE_HCM_VASODILATOR / RULE_PULSE_PRESSURE_NARROW / RULE_DHP_CCB_LEG_SWELLING etc.; admin Physician Notes section unchanged; caregiver dispatch unchanged. Tests added.

### Group B — Stop mirroring alerts into patient in-app notifications ✅
See spec-delta block above. Done; tests rewritten.

### Group A1 — Rule-aware alert presentation
*(pending — in progress next)*

### Group A2 — Hide empty three-tier cards (admin)
*(pending)*

### Group A3 — Tier-3 in admin "All" filter
*(pending)*

### Group A4 — Humanize caregiver UUID in admin Timeline
*(pending)*

### Group A5 — AudioButton regression check
Verified: `AudioButton` is wired and active throughout the CheckIn flow ([CheckIn.tsx:70,319,389,562,611,693,994,1481](frontend/src/components/cardio/CheckIn.tsx)) with no commented-out blocks or feature gates. **No code change needed.** Manual verification deferred to user — open CheckIn, tap each AudioButton, confirm audio plays.

### Group D2 — Admin Caregivers as dedicated tab
*(pending)*

### Group D1 — Patient CaregiversCard restyle
*(pending)*

---

## Judgment calls made at implementation time

- **A1 color/icon/title for `RULE_HF_DECOMPENSATION`** (provisional, flagged for Dr. Singal): amber accent (`var(--brand-warning-amber)`), Heart icon, title "Your care team needs to know about this". Implemented behind the shared `getAlertPresentation` helper so a one-line edit swaps any of the three if Dr. Singal vetoes.
- **A4 caregiver name resolution**: backend-resolves `caregiverName` at the timeline endpoint, mirroring the existing `changedByName` pattern. A deleted PatientCaregiver row resolves to `caregiverName: null` → UI falls back to "Caregiver contact".
- **D1 restyle**: matched admin chrome (card shell, header row, list layout, form grouping); preserved patient-friendly intro paragraph + toggleable-consent badge (clearer than admin's dual Revoke/Record-consent buttons).
- **D2 Caregivers tab**: placed between `careteam` and `timeline` in the tab order; count badge plumbed via a shell-level `listCaregivers(patientId)` fetch mirroring the `medications.length` pattern.

---

## Verification gates

- Backend: `cd backend && npx tsc --noEmit -p tsconfig.build.json && NODE_OPTIONS=--experimental-vm-modules npx jest --config jest.config.mjs` — green.
- Admin: `cd admin && npx tsc --noEmit && npx jest` — green.
- Frontend: `cd frontend && npx tsc --noEmit && npx jest` — green.
- QA: `cd qa && npx tsc --noEmit` — green.

(Each workstream's gate runs after its commit; final tally pinned at the top of the PR description.)
