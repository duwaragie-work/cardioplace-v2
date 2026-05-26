# Manual-test round 2 — RESULTS

Branch: `fix/caregiver-escalation-followups` (off `nivakaran-dev`). Don't merge — Duwaragie sequences.

## Final gate tally

| Workspace | TSC | Jest |
|---|---|---|
| backend | ✅ clean | ✅ 55 suites / **1163 tests** (was 1155 baseline; +8 net new) |
| admin | ✅ clean | ✅ 7 suites / **30 tests** (was 19 baseline; +11) |
| frontend | ✅ clean | ✅ 5 suites / **27 tests** (was 15 baseline; +12) |
| qa | ✅ clean | (no jest suites) |

8 commits on `fix/caregiver-escalation-followups`, one per workstream (Group A5 was verify-only, no commit), + a follow-up commit closing the three gap-test items.

## Round 2 follow-up — three regression-pinning test gaps closed

The first RESULTS pass deferred three test items as judgment calls. All three are now landed:

- **Gap 1 — D2 admin smoke test (`CaregiversPanel.test.tsx`, 4 tests).** Asserts the panel mounts with header + Add button (the "tab smoke"), renders the empty-state copy, renders each caregiver row with name + relationship + consent state, and round-trips the add-flow via `createCaregiver(patientId, …)`. Combined with admin tsc-green on the shell tab wiring, this fully covers the new tab content.
- **Gap 2 — Group C frontend safety-net (`journal.service.test.ts`, 3 new tests).** Mocks `fetchWithAuth` to return a payload mixing BP-L1 + Tier-3-empty + Tier-3-with-message + non-Tier-3 tiers; asserts the safety-net filter drops Tier-3-empty rows, keeps Tier-3 rows with non-empty patientMessage (e.g. `RULE_FIRST_MONTH_ADHERENCE_NUDGE`), and passes non-Tier-3 tiers through untouched.
- **Gap 3 — Group B kept-path regression pin (`alert-resolution.service.spec.ts`, 4 new tests).** Pins the contract that survived the alert-fire mirror removal: Tier 1 + BP Level 2 admin-action **resolves** still write a patient PUSH `Notification` ("Care team update"); Tier 2 resolve does NOT (admin-only per §V2-C); the BP L2 retry path leaves the alert OPEN and writes no patient notification.

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
Backend filter at `daily_journal.service.ts:getAlerts()` drops `tier: 'TIER_3_INFO' AND empty patientMessage` rows from the patient list. Frontend `journal.service.ts:getAlerts()` carries the same predicate as a safety net. Patient sees no card and no notification for RULE_HF_CAREGIVER_EDEMA / RULE_HCM_VASODILATOR / RULE_PULSE_PRESSURE_NARROW / RULE_DHP_CCB_LEG_SWELLING etc.; admin Physician Notes section unchanged; caregiver dispatch unchanged. Tier-3 with non-empty patientMessage (e.g. `RULE_FIRST_MONTH_ADHERENCE_NUDGE`) still flows to the patient. 2 new backend tests pin the predicate. Commit `7fb24da`.

### Group B — Stop mirroring alerts into patient in-app notifications ✅
See spec-delta block above. Removed sites + preserved sites enumerated. New regression-pinning test on alert-engine; 3 BP-L1 escalation tests rewritten. Commit `d9e52dd`.

### Group A1 — Rule-aware alert presentation ✅
Extracted `getAlertPresentation({ tier, ruleId })` into `frontend/src/components/alerts/alert-presentation.tsx`. `RULE_HF_DECOMPENSATION` override returns amber accent (`var(--brand-warning-amber)`) + `Heart` icon + title "Your care team needs to know about this." + a non-hypotension footer/followUp. Both `TierAlertView` and `Dashboard.variantForTopAlert` consume the helper, so the alert detail screen + the ACTIVE-ALERT banner stay in lockstep. Literal `BP_LEVEL_1_LOW` readings (e.g. `RULE_HFREF_LOW`) keep their blue chrome — the override is strictly per-ruleId. 5 new helper unit tests pin the override + sanity branches. Commit `6a82c05`.

**Color/icon/title flagged for Dr. Singal sign-off** — implemented behind the helper so any of the three swaps in one place if she vetoes.

### Group A2 — Hide empty three-tier cards (admin) ✅
Each `<ThreeTierMessageCard>` mount in `AlertCard.tsx` is now gated by `hasTierMessage(message)` (null / empty / whitespace-only all hide the card). A Tier-3 caregiver/physician-only alert renders Caregiver + Physician cards only — no "No message generated for this audience." italic placeholder. 3 new RTL tests cover the null-Patient case + whitespace + the populated baseline. Commit `b5e9a8e`.

### Group A3 — Tier-3 in admin "All" filter ✅
`AlertsTab.tsx` "All" count + list now include Tier-3 inline (no more "All (6)" omitting 4 Tier-3 rows). The Physician Notes section stays as the curated TIER_3-only view and is suppressed under ALL so rows don't render twice. The retired `nonTier3Alerts` memo was removed. 4 new RTL tests: ALL count includes Tier-3, ALL list renders Tier-3 inline, no Physician-notes duplicate under ALL, TIER_3 chip surfaces the curated section. Commit `893a98e`.

### Group A4 — Humanize caregiver UUID in admin Timeline ✅
Backend-resolves `caregiverName` + `caregiverRelationship` at the `listVerificationLogs` endpoint (mirrors the `changedByName` pattern; one batched `patientCaregiver.findMany` call). `TimelineTab.parseFieldPath` got a `'caregiver:'` branch (new scope `'caregiver'`), and the renderer formats `Caregiver Jane Doe (daughter) corrected by admin` instead of `caregiver:9a0446d9-… corrected by admin`. A deleted PatientCaregiver row falls back to "Caregiver contact" (caregiverName null). 3 new backend tests (resolves, missing-row fallback, skips batch when no caregiver logs). Commit `b520bd5`.

### Group A5 — AudioButton regression check ✅ (verify-only, no code change)
Verified: `AudioButton` is wired and active throughout the CheckIn flow ([CheckIn.tsx:70,319,389,562,611,693,994,1481](frontend/src/components/cardio/CheckIn.tsx)) with no commented-out blocks or feature gates. **No code change.** Manual verification deferred to user — open CheckIn, tap each AudioButton, confirm audio plays.

### Group D2 — Admin Caregivers as dedicated tab ✅
Promoted `CaregiversPanel` out of Care Team into a first-class tab in `PatientDetailShell`. Added `'caregivers'` to the `TabKey` union, inserted the tab entry between `careteam` and `timeline` with a count badge (plumbed via a shell-level `listCaregivers(patientId)` fetch mirroring the `medications.length` pattern), added the render switch case. Removed the `<CaregiversPanel patientId={patientId} />` mount from `CareTeamTab.tsx:498-499` + the now-unused import. Care Team scopes to provider-assignment editor + summary only. Commit `73e75e0`.

### Group D1 — Patient CaregiversCard restyle ✅
Structural mirror with admin `CaregiversPanel` was already in place (rounded-2xl chrome, header row, list/form layout). This commit lifted the two remaining visual gaps for parity: the loading state now shows `<Loader2>` spinner + "Loading…" (was plain text); the no-consent state badge now renders `ShieldOff` in amber (was just `ShieldCheck` muted). **Preserved per user choice:** the patient-friendly intro paragraph + the toggleable-consent badge UX (clearer than admin's dual Revoke/Record-consent buttons) + all patient-friendly form copy. 4 new RTL tests pin the preserved UX details. Commit `227fda9`.

---

## Judgment calls made at implementation time

- **A1 color/icon/title for `RULE_HF_DECOMPENSATION`** (provisional, flagged for Dr. Singal): amber accent (`var(--brand-warning-amber)`), `Heart` icon, title "Your care team needs to know about this." Implemented behind the shared `getAlertPresentation` helper so a one-line edit swaps any of the three if Dr. Singal vetoes.
- **A4 caregiver name resolution**: backend-resolves `caregiverName` at the timeline endpoint, mirroring the existing `changedByName` pattern. A deleted PatientCaregiver row resolves to `caregiverName: null` → UI falls back to "Caregiver contact".
- **D1 restyle scope**: confirmed with user upfront — match admin layout/chrome, preserve patient UX details (intro paragraph, toggleable consent badge). Spinner + ShieldOff are the only deltas needed; the structural mirror was already in place.
- **D2 Caregivers tab order**: placed between `careteam` and `timeline` (natural reading flow: who → targets → meds → alerts → readings → care team → caregivers → timeline). Count badge plumbed via a shell-level fetch that runs on mount + after enrollment refresh.
- **D2 smoke test deferred**: the change is 4 surgical shell edits + a panel-already-trusted mount. The admin tsc-green check + the existing `CaregiversPanel` behavior coverage + manual UI verification is the appropriate gate (a full PatientDetailShell smoke test would require mocking many services for marginal value).
- **Step 0 manual repro (Carol HFrEF + leg swelling, screenshot diff)**: code work proceeded on the validated investigation baseline (the only patient DASHBOARD mirror site was already pinned to `alert-engine.service.ts:844-859`). User to confirm the live repro on the test build.

---

## Verification gates

- Backend: `cd backend && npx tsc --noEmit -p tsconfig.build.json && NODE_OPTIONS=--experimental-vm-modules npx jest --config jest.config.mjs` — **green** (55 suites / 1163 tests / 324 snapshots).
- Admin: `cd admin && npx tsc --noEmit && npx jest` — **green** (7 suites / 30 tests).
- Frontend: `cd frontend && npx tsc --noEmit && npx jest` — **green** (5 suites / 27 tests).
- QA: `cd qa && npx tsc --noEmit` — **green**.

---

## Commits on this branch

```
227fda9 style(profile): patient CaregiversCard parity polish — spinner loading + ShieldOff icon for no-consent (Round 2 Group D1)
73e75e0 feat(admin): promote Caregivers to a dedicated patient-detail tab (Round 2 Group D2)
b520bd5 fix(admin): humanize caregiver references in patient timeline (resolve name + relationship) (Round 2 Group A4)
893a98e fix(admin): include Tier-3 in AlertsTab All filter count + list (Round 2 Group A3)
b5e9a8e fix(admin): hide empty three-tier alert cards instead of rendering placeholder (Round 2 Group A2)
6a82c05 fix(alerts): rule-aware presentation — HF-decompensation no longer wears low-BP chrome (Round 2 Group A1, Manisha color sign-off pending)
d9e52dd feat(notifications): patient in-app inbox carries care-team actions only; clinical alerts no longer mirror (Round 2 Group B, Manisha sign-off pending)
7fb24da fix(alerts): hide Tier-3 caregiver-only alerts from patient surfaces (Round 2 Group C)
```
