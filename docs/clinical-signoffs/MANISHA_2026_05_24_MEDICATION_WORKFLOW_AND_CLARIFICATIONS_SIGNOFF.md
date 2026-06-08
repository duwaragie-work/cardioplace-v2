# Claude Code (or Duwaragie manually) — verify Niva's implementation against the two Manisha sign-offs (2026-05-24) AND the patient notification + alert-UI handoff

Three work streams Niva was handed. This doc maps every item from all three to **where to verify it in code** and **what "done" looks like**, so the review is mechanical:

1. **Medication Workflow sign-off** (2026-05-24 from Manisha) — Part A below.
2. **Pending Clinical Clarifications sign-off** (2026-05-24 from Manisha) — Part B below.
3. **Patient notification semantics + alert-UI fixes (manual-test round 2)** — Part C below. Source handoff: `CLAUDE_CODE_PATIENT_NOTIF_AND_ALERT_UI.md`. Groups A (UI bugs), B (in-app notification mirror removal — spec reversal), C (Tier-3 patient hiding), D (caregiver UI polish).

**Branches to audit:**
- Parts A + B → `nivakaran-dev` (Niva's integration branch).
- Part C → `fix/caregiver-escalation-followups` (off `nivakaran-dev`). If Niva merged the feature branch back into `nivakaran-dev`, audit there.
- If anything merged forward to `dev` or `main`, audit there.

Confirm with `git log --oneline --all --since="2026-05-24" --author="Niva"` (or whatever email Niva commits as).

**Setup:** local stack, fresh local Postgres seeded from `nivakaran-dev`, backend `:4000` with `ENABLE_TEST_CONTROL=true`, admin `:3001`, patient `:3000`. Don't write to prod.

**Audit gate:** `tsc --noEmit -p tsconfig.build.json` clean, `jest` green on any spec touching the audited code paths.

---

## PART A — Medication Workflow sign-off (5 items)

### A1. HOLD two-path patient message — #1 pre-pilot priority (PATIENT SAFETY)

**Spec (Manisha):** When a medication is HOLD, the patient message depends on `holdReason`:
- `PROVIDER_DIRECTED_HOLD` → *"Your care team has asked you to pause [medname] until they can review it with you. Do not take it until your care team tells you it is okay."* — clinical instruction, persists until resolved, **names the medication**, included in daily check-in reminder.
- Administrative holds (`AWAITING_RECORDS`, `UNCLEAR_NAME`, `UNCLEAR_DOSE`, `OTHER`) → *"Your care team is reviewing your medicine list to make sure everything is up to date. Keep taking your medicines as usual unless your care team tells you otherwise."* — informational only, displayed once, **does NOT name the medication**, disappears when hold is resolved.

**Why critical:** the original blanket "stop taking this medication" was clinically dangerous for administrative holds. Abrupt beta-blocker discontinuation can cause rebound hypertension and HF destabilization.

**Verify by:**
1. **Schema:** `backend/prisma/schema/patient_medication.prisma` (or equivalent) has a `holdReason` enum or field. Run `grep -rE "HoldReason|PROVIDER_DIRECTED_HOLD|AWAITING_RECORDS" backend/prisma/`.
2. **Engine logic:** grep `backend/src/medication/` (or wherever the hold flow lives) for the branching: `grep -rE "holdReason\s*===?\s*['\"]PROVIDER_DIRECTED_HOLD" backend/src/`.
3. **Patient message content:** grep `shared/src/alert-messages.ts` or `frontend/src/i18n/en.ts` for both message variants. The provider-directed wording should include `{medname}` placeholder; the administrative wording should NOT.
4. **UI behavior — manual scenario:**
   - Seed: a patient with one medication. As admin, place it on hold with reason `PROVIDER_DIRECTED_HOLD`. Sign in as patient → confirm the provider-directed message displays with the medication name and persists across navigation/reload.
   - Reset the hold. Re-place with reason `AWAITING_RECORDS`. Sign in as patient → confirm the administrative message displays WITHOUT the medication name, and disappears on hold resolution.
5. **Daily check-in reminder:** the provider-directed message should surface in the daily check-in flow (gap-alert cron or check-in landing). Confirm.

**PASS:** both messages render per spec, named/unnamed correctly, behavior matches.
**FAIL examples:** any single hold message regardless of reason; medication name leaking into the administrative variant; provider-directed message only displayed once.

---

### A2. HOLD reason codes — structured dropdown

**Spec:** Admin places hold via dropdown with structured codes (not free text):
- `AWAITING_RECORDS`
- `UNCLEAR_NAME`
- `UNCLEAR_DOSE`
- `PROVIDER_DIRECTED_HOLD`
- `OTHER` (requires free-text)

**Verify by:**
1. Enum in shared/src or backend schema: `grep -rE "HoldReason|holdReason" shared/src/ backend/prisma/schema/`.
2. Admin UI: in the MedicationHoldModal (`admin/src/components/patient-detail/MedicationHoldModal.tsx`), confirm a dropdown with these exact 5 options renders, and `OTHER` gates a free-text field.
3. API DTO: backend hold endpoint validates `holdReason` against the enum.
4. Manual: try placing a hold with each reason. `OTHER` without free-text should be rejected (400).

**PASS:** all 5 codes present, dropdown enforced, `OTHER` requires free-text.
**FAIL examples:** free-text-only hold flow with no enum; dropdown missing one or more codes; `OTHER` accepts empty rationale.

---

### A3. HOLD escalation ladder — time-based (7/14/30/45 days)

**Spec:**
- **Day 7:** Dashboard badge on admin's medication tab: *"1 medication has been on Hold for 7 days"*
- **Day 14:** Tier 3 flag to assigned provider: *"[Patient name] has [medname] on Hold for 14 days. Verification pending: [REASON]. Please review."*
- **Day 30:** Tier 2 flag to assigned provider + Medical Director: *"[Patient name] has [medname] unverified for 30 days. Medication reconciliation incomplete. Action required."*
- **Day 45:** Auto-escalate to CMO review queue.

**Verify by:**
1. **Cron:** there should be a daily cron that scans `PatientMedication` rows in HOLD status and computes days-since. Grep `backend/src/crons/` or `backend/src/medication/` for something like `medication-hold-escalation.service.ts` or `hold-escalation.service.ts`.
2. **Day thresholds:** the cron has 7/14/30/45 hardcoded or as config constants. `grep -rE "7|14|30|45" backend/src/medication/` (filter to the relevant file).
3. **Dispatch surfaces:**
   - Day 7: a `Notification` row created on the admin user (or a flag on the medication shown as a badge in admin UI).
   - Day 14: a `DeviationAlert` with tier `TIER_3_INFO`, routed to assigned provider (per `PatientProviderAssignment.primaryProviderId`).
   - Day 30: a `DeviationAlert` with tier `BP_LEVEL_1` or equivalent Tier-2 level, routed to provider AND medical director.
   - Day 45: a `DeviationAlert` (or queue entry) routed to a CMO/super-admin queue.
4. **Test live:** use test-control to backdate a `PatientMedication.heldAt` to 8 / 15 / 31 / 46 days ago, run the cron manually, observe the expected outputs.

**PASS:** all 4 thresholds fire correct artifacts to correct recipients.
**FAIL examples:** only one or two thresholds wired; Day 14/30 alerts fire but without naming the medication or reason; CMO queue not implemented (cron silently no-ops at day 45).

---

### A4. Angioedema rules in alert engine — verify present (already signed off 2026-05-15)

**Spec:** Two angioedema rules should already exist in the engine — verify they didn't regress.
- `RULE_ACE_ANGIOEDEMA`: Tier 1, fires on ANY verification status, compressed escalation (T+0, T+15m, T+1h, T+4h)
- `RULE_GENERIC_ANGIOEDEMA`: Tier 1, fires on ALL patients regardless of medication profile

**Verify by:**
1. Rule IDs present: `grep -rE "RULE_ACE_ANGIOEDEMA|RULE_GENERIC_ANGIOEDEMA" shared/src/`.
2. Engine pre-gate logic in `backend/src/daily_journal/services/alert-engine.service.ts` — angioedema rules must fire BEFORE the single-reading gate (so they fire on the first symptom report).
3. Escalation ladder for angioedema compressed (not the default Tier 1 ladder): `grep -nE "T\+15m|T_PLUS_15M|T_15M" backend/src/`.
4. **Manual scenario:** as Marcus (or any patient), submit a check-in with face/lip/tongue swelling symptom. Confirm: full-screen emergency screen, alert detail shows `RULE_ACE_ANGIOEDEMA` (if Marcus is on ACE) or `RULE_GENERIC_ANGIOEDEMA` (if not), escalation ladder shows the compressed timeline.

**PASS:** both rules fire on appropriate symptoms; compressed ladder visible.
**FAIL examples:** rule IDs missing; angioedema gated by single-reading rule; standard tier-1 ladder used instead of compressed.

---

### A5. First-month adherence nudge — verify wording + scope

**Spec:** Patient-only, one-time, non-judgmental wording. Does NOT fire for beta-blocker single-miss carve-out patients (HFrEF/HCM/AFib on beta-blocker get the immediate Tier-2 alert instead).

**Wording (Manisha-approved):** *"Starting a new medicine can take some getting used to. If you missed a dose, that's okay — just try to take your next one on time. Your care team is here to help if anything makes it hard to stay on schedule."*

**Verify by:**
1. `grep -rE "RULE_FIRST_MONTH_ADHERENCE_NUDGE" shared/src/ backend/src/`.
2. Message content matches the approved wording exactly: `grep -nA5 "RULE_FIRST_MONTH_ADHERENCE_NUDGE" shared/src/alert-messages.ts`.
3. **Carve-out gate:** the rule must skip if patient has HFrEF/HCM/AFib AND is on a beta-blocker (the immediate Tier-2 carve-out takes precedence). `grep -nB5 -A10 "RULE_FIRST_MONTH_ADHERENCE_NUDGE" backend/src/daily_journal/services/alert-engine.service.ts`.
4. One-time gate: the rule should not fire more than once per patient. Look for a "first-occurrence" check or a flag on the patient.
5. Manual: a patient enrolled <30 days ago with a single missed dose → see the nudge. Same scenario on a beta-blocker HFrEF patient → should see the Tier-2 alert instead of the nudge.

**PASS:** wording exact, fires once, carve-out gate honored.
**FAIL examples:** wording paraphrased; fires repeatedly; fires for HFrEF beta-blocker patient.

---

## PART B — Pending Clinical Clarifications sign-off (5 questions + confirmations)

### B1. DBP ≥ SBP three-tier validation (Q1)

**Spec:**
- **Tier 1 (reject at entry):** `IF diastolic >= systolic` → reject the reading, show retake prompt, log the rejection for QA, do NOT process through engine. Repeat-attempt message: *"If your monitor keeps showing unusual numbers, try repositioning the cuff..."*
- **Tier 2 (artifact flag):** `IF (sys - dia) <= 15 AND sys > dia` (passes Tier 1) → accept, process normally, add physician-only dashboard note about possible artifact.
- **Tier 3 (accept silently):** `IF (sys - dia) > 15 AND <= 20` → accept, no flag.

**Verify by:**
1. **Rejection at entry:** in the check-in submit endpoint (`backend/src/daily_journal/`), look for early-return / 4xx response when `dia >= sys`. `grep -nE "diastolic\s*>=?\s*systolic|sbp\s*<=?\s*dbp" backend/src/`.
2. **Rejected-reading log:** rejected readings should be stored somewhere (perhaps a `RejectedReading` table, or a flag on the JournalEntry). Confirm a logging mechanism exists.
3. **Repeat-attempt counter:** if patient enters impossible twice in a row, the second message changes. Look for a stateful counter (could be in session or DB).
4. **Tier 2 artifact note:** look for the narrow-PP single-reading rule. The threshold is **15 mmHg on individual readings**. Grep `RULE_PULSE_PRESSURE_NARROW_ARTIFACT` or similar.
5. **Patient-facing wording:** Tier 1 reject message exact: *"That reading doesn't look right — the bottom number should be lower than the top number. Please check your cuff and try again."* Grep i18n.
6. **Manual scenarios:**
   - Submit BP `120/140` → rejected, patient sees retake message, NOT in readings history.
   - Submit `120/140` again → second message shown.
   - Submit `135/125` (PP=10, passes Tier 1) → accepted; physician dashboard shows artifact note.
   - Submit `140/124` (PP=16) → accepted, no flag.

**PASS:** all three tiers behave per spec, including the QA log and the repeat-attempt message.
**FAIL examples:** impossible readings get into the JournalEntry table; Tier 2 not implemented; patient sees the artifact note (it's physician-only).

---

### B2. Narrow pulse pressure rule (Q2)

**Spec:** `IF (sys - dia) <= 25 AND session-averaged` (NOT single reading) → physician-only note, condition-specific wording.

**Condition-specific messages (verify each):**
- **HFrEF or DCM:** *"Narrow pulse pressure: [sys]/[dia] (PP = [value] mmHg). In HFrEF, narrow PP may indicate reduced stroke volume. Consider clinical correlation — echocardiography if new finding or worsening trend."*
- **HFpEF:** *"...Note: In HFpEF, narrow PP is less prognostically significant than in HFrEF. Clinical correlation recommended."*
- **HCM or aortic stenosis:** *"...In the context of [HCM / aortic stenosis], narrow PP may reflect fixed outflow obstruction. Clinical correlation recommended."*
- **All other patients (generic):** *"...If confirmed on repeat measurement, consider evaluation for reduced cardiac output."*

**Patient-facing:** NO message — provider-only.

**Verify by:**
1. Rule ID exists: `grep -rE "RULE_PULSE_PRESSURE_NARROW|RULE_NARROW_PP" shared/src/`.
2. Threshold check is `<= 25` AND session-averaged: `grep -nA20 "PULSE_PRESSURE_NARROW" backend/src/daily_journal/services/alert-engine.service.ts`.
3. Four message variants exist in `shared/src/alert-messages.ts` — verify the exact wording for each condition branch.
4. **Wide PP (>60 mmHg) rule** — existing — should be unchanged.
5. **Manual:** seed a patient with HFrEF, session-average readings showing PP=20 → physician dashboard shows the HFrEF-specific note. Repeat with HFpEF, HCM, generic.

**PASS:** rule fires only on session average, four conditional messages exact, no patient message.
**FAIL examples:** fires on single readings; one generic message regardless of condition; patient sees it.

---

### B3. Pre-personalization Level 1 alerts (Q3) — engine behavior + spec update

**Spec:** Level 2 fires immediately, Level 1 fires WITH disclaimer (provider-side only — patient doesn't see disclaimer).
- **Disclaimer text:** *"Standard threshold — personalization begins after 7 readings. This patient has completed [X] of 7 baseline readings."*

**This is mostly verification that the engine already does this (the current behavior is correct).** The action is: update the written spec to match.

**Verify by:**
1. Engine code: `backend/src/daily_journal/services/alert-engine.service.ts` — Level 1 rules should fire on readings 1–6 (the preDay3 / first-7 window), with the disclaimer appended. Grep `preDay3|preDay3Mode|PRE_DAY_3` for the existing logic.
2. Patient message has NO disclaimer suffix (only provider message does).
3. Disclaimer wording exact in i18n / message registry.
4. **Spec update:** check `docs/CLINICAL_SPEC.md` (Part X — pre-personalization). The spec text should now say *"fire Level 1 with disclaimer"* and not *"suppress Level 1 during pre-personalization."* If not updated → flag as a documentation task.
5. **Manual:** new patient, submit reading 1 of 7 at 145/90 (Level 1 High) → patient sees standard L1 message, admin dashboard shows the alert with the "[1] of 7 baseline readings" disclaimer.

**PASS:** engine fires per spec, disclaimer wording exact on provider side only, spec text updated.
**FAIL examples:** spec text still says "suppress"; disclaimer leaks into patient message.

---

### B4. Angioedema bespoke resolution actions (Q4)

**Spec:** Six resolution actions specifically for `RULE_ACE_ANGIOEDEMA` and `RULE_GENERIC_ANGIOEDEMA` (NOT the generic Tier-1 set).

| # | Action | Sub-field |
|---|---|---|
| 1 | Patient advised to call 911 / go to ED | "Patient confirmed they will go? Y/N" — if N, auto-escalate to medical director |
| 2 | Patient confirmed in ED / hospital | Facility name (free text, optional) |
| 3 | ACE inhibitor / ARB discontinued | Replacement ordered? Y/N → replacement medication free text. **AUTO-UPDATE patient med list to DISCONTINUED with reason "angioedema"** + **PERMANENT profile flag "ACE INHIBITOR CONTRAINDICATED..."** |
| 4 | Seen in office / telehealth — evaluated | Outcome dropdown: confirmed angioedema / not angioedema / referred to allergy |
| 5 | False alarm — not angioedema | Actual cause (free text) — does NOT add the ACE contraindication flag |
| 6 | Unable to reach patient — will retry | Triggers compressed re-escalation (T+15m / T+1h / T+4h) |

**Mandatory fields for all:** timestamp, resolving provider name + role, optional clinical note, all 15-field Joint Commission audit logged.

**Verify by:**
1. Resolution-action enum: `grep -rE "AngioedemaResolutionAction|RESOLUTION_ACTION" shared/src/ backend/src/`. Should be a separate enum from the generic Tier-1 enum.
2. Alert resolution modal: `admin/src/components/patient-detail/AlertResolutionModal.tsx` — when opened on an angioedema alert, should show these 6 options (not the generic 4). Grep for conditional rendering based on `ruleId`.
3. **Auto-update side-effect (option 3):** look in the resolution handler for code that updates `PatientMedication.status = DISCONTINUED` with `reason = "angioedema"` when option 3 is selected.
4. **Permanent profile flag:** look for a `contraindications` or `permanentFlags` field on `PatientProfile`. When option 3 is selected, a flag should be set. Grep `ACE_INHIBITOR_CONTRAINDICATED` or similar.
5. **Option 5 carve-out:** option 5 ("False alarm") should NOT set the permanent flag. Verify in the handler.
6. **Option 6 cascade:** option 6 triggers the compressed retry ladder.
7. **Manual scenarios:** fire an angioedema alert on a test patient. Open as admin, try each of the 6 options. Confirm side-effects (med list update, profile flag, retry cascade).

**PASS:** all 6 options visible only on angioedema rules; option 3 auto-updates med list + sets permanent flag; option 5 does NOT set flag; option 6 cascades.
**FAIL examples:** generic Tier-1 options shown instead; option 3 doesn't update med list; permanent flag missing or wrong wording.

---

### B5C. Aortic stenosis interim rule (Q5C)

**Spec:** Patient with `aortic_stenosis` condition → flag for mandatory provider threshold configuration at onboarding, apply HCM-equivalent lower bound (SBP <100) as default until provider configures, dashboard note about it.

**Verify by:**
1. `PatientProfile.hasAorticStenosis` or equivalent field exists in schema. Grep.
2. Intake captures it: `frontend/src/app/clinical-intake/page.tsx` includes aortic stenosis as a selectable condition.
3. Onboarding-completion check: a patient with aortic stenosis enters an "incomplete enrollment" state until the provider configures thresholds. Grep `EnrollmentStatus|enrollmentStatus` for the gating.
4. Default threshold: in absence of provider configuration, SBP lower bound = 100. Same HCM lower-bound logic.
5. Dashboard note: admin sees *"Aortic stenosis — provider-set thresholds required. Using HCM defaults as interim safety net."*
6. The narrow-PP rule (B2 above) provides the additional safety net.

**PASS:** patients with aortic stenosis are flagged, thresholds gated, HCM defaults applied as interim, admin dashboard note present.
**FAIL examples:** aortic stenosis treated as a generic condition; no threshold gate; no dashboard note.

---

### B5A. Post-pregnancy flag (already done — confirm not regressed)

**Spec:** History of preeclampsia / gestational HTN → dashboard flag with provider tooltip. NO threshold change.

**Verify by:** intake captures preeclampsia history; admin patient detail shows a dashboard flag with the tooltip. Grep `preeclampsia|gestationalHtn`.

---

### B5D. BP Level-2 "Unable to reach patient — will retry" (already done — confirm not regressed)

**Spec:** Sixth resolution action on BP Level-2 alerts. Retry follows standard L2 ladder (T+0 → T+4h → T+8h → T+24h → T+48h).

**Verify by:** grep `UNABLE_TO_REACH|UNABLE_TO_REACH_RETRY|BP_L2_UNABLE_TO_REACH_RETRY` in the resolution-action enum and the escalation service.

---

---

## PART C — Patient notification semantics + alert-UI fixes (Groups A–D)

Branch: `fix/caregiver-escalation-followups` off `nivakaran-dev` (may have merged forward — check). Source: `Documents/cardioplace-handoffs/CLAUDE_CODE_PATIENT_NOTIF_AND_ALERT_UI.md`.

Manual testing on 2026-05-26 confirmed that the patient app's two surfaces were **inverted** — Tier-3 caregiver-only alerts were showing on the patient Alerts tab, while real clinical alerts (HF-decomp, BP-elevated) were showing in patient Notifications as mirrored "Cardioplace Alert" rows. After Niva's fix, both surfaces should behave correctly.

### C-Pre. Enumeration was done before fixing (process check)

**Spec (from handoff):** "Don't assume the mirroring is uniform … First task: enumerate exactly which alert rows are duplicated across the Notifications tab and the Alerts tab (query the patient's `Notification` rows vs `DeviationAlert` rows for the test patient and diff them). Fix what's actually mirrored; don't blanket-remove based on an assumption about which types mirror."

**Verify by:** look in `qa/reports/` or the commit history for a Notification-vs-DeviationAlert diff report — or ask Niva directly. If he blanket-removed without enumerating first, ask him to back-check what got dropped that shouldn't have.

---

### C-A1. HF-decompensation rule-aware presentation (the demo blocker)

**Spec:** `getTierPresentation` in `frontend/src/components/alerts/TierAlertView.tsx` (~line 122) keys only on tier, so `RULE_HF_DECOMPENSATION` (classed `BP_LEVEL_1_LOW`) wears the blue hypotension template — wrong color, wrong "Your blood pressure is low" title, wrong "stand up slowly / salty snack" footer for a leg-swelling alert at 151/86. Fix: branch by `ruleId` for clinically-mismatched rules. HF-decomp should render with a non-blue accent (teal/amber), non-down-arrow icon (heart/droplet), rule-appropriate title ("Your care team needs to know about this" or similar — final wording from Dr. Singal), the rule's own `patientMessage` for body, and **NO hypotension footer/follow-up**.

**Verify by:**
1. `grep -nA20 "getTierPresentation" frontend/src/components/alerts/TierAlertView.tsx` — confirm the function now branches on `ruleId` (or has a per-rule override map), not just `tier`.
2. Special case for `RULE_HF_DECOMPENSATION` exists. Color hex is NOT `#3B82F6` (the hypotension blue). Icon is not `ArrowDown`.
3. Hypotension footer/followUp content (`stand up slowly`, `salty snack`) is NOT rendered for HF-decomp.
4. **Manual scenario:** sign in as the patient with the HF-decomp open alert (Loretta Davis in seed, or your test patient). Open the alert detail in the patient app. Confirm: not blue, not "low BP" title, no hypotension footer, body is the leg-swelling text.
5. **Dashboard banner check:** same patient, look at the dashboard's "ACTIVE ALERT" banner. Should also use the corrected title/color (NOT "Your blood pressure is low").

**PASS:** HF-decomp alert renders distinctly from low-BP alerts in detail, list, and dashboard banner; no hypotension copy leaks.
**FAIL examples:** still renders blue / "low" title; footer still says "stand up slowly"; dashboard banner mislabels; only one surface fixed (e.g. detail page corrected but list still shows blue card).

---

### C-A2. Hide empty three-tier cards

**Spec:** When a tier's message is empty (e.g. Tier-3 has no `patientMessage`), do not render that card. In admin AlertCard three-tier grid and any patient view.

**Verify by:**
1. Admin AlertCard component: `grep -nA20 "patientMessage\|caregiverMessage\|physicianMessage" admin/src/components/AlertCard.tsx` (or wherever the three-tier grid lives) — should conditionally render each tier card based on whether the message is non-empty.
2. Patient TierAlertView similarly conditionally renders.
3. **Manual:** open a Tier-3 alert with empty `patientMessage` (e.g. `RULE_HF_CAREGIVER_EDEMA`) — admin should see Caregiver + Physician cards only, no empty Patient card. Patient should see nothing (per Group C).

**PASS:** empty tier cards are not rendered.
**FAIL:** empty card slots visible with no content; dashed placeholders shown.

---

### C-A3. Tier-3 included in admin "All" filter

**Spec:** `admin/src/components/patient-detail/AlertsTab.tsx` currently splits `TIER_3_INFO` into a separate "Physician notes" section, excluded from the "All" count + list. Fix: "All" must include Tier-3.

**Verify by:**
1. `grep -nA10 "tierBucket\|TIER_3_INFO" admin/src/components/patient-detail/AlertsTab.tsx` — Tier-3 should no longer be routed into a bucket excluded from "All".
2. The "All (N)" chip count includes Tier-3 rows.
3. **Manual:** a patient with mixed-tier alerts (e.g. Tier-1, Tier-2, Tier-3). Open Alerts tab. "All" count should equal total alerts on the patient; clicking "All" should show every tier including Tier-3. The dedicated "Physician notes" section can remain as a convenience filter.

**PASS:** "All" count and list include Tier-3.
**FAIL:** "All (6)" still excludes 4 Tier-3 entries; total mismatch with sum of tier sections.

---

### C-A4. Friendly caregiver label in Timeline (not raw UUID)

**Spec:** TimelineTab currently renders "Caregiver:9a0446d9-… corrected by admin". Show a friendly label (caregiver name / relationship, or "Caregiver contact updated").

**Verify by:**
1. `grep -nE "caregiverId|caregiverUuid" admin/src/components/patient-detail/TimelineTab.tsx` — should be resolved to a name string.
2. **Manual:** find a patient with a caregiver update in their timeline. Confirm display is "Tasha Williams (daughter)" or "Caregiver contact updated", not a UUID.

**PASS:** no raw UUIDs in timeline display.
**FAIL:** UUID still visible.

---

### C-A5. Check-in AudioButton plays (regression check)

**Spec:** Fixed in a prior round; just verify no regression.

**Verify by:** sign in as patient → open daily check-in → click the audio button on any step. TTS should fire. No console errors.

**PASS:** TTS plays.
**FAIL:** click is no-op; console error about speechSynthesis.

---

### C-B. Remove in-app notification mirror — SPEC REVERSAL (CLINICAL_SPEC Part 13.2)

**Spec:** Clinical alerts must NO LONGER write a patient in-app `Notification` row. They still show on the patient Alerts surface. Emails to providers + caregivers UNTOUCHED. Admin-action events (acknowledge, resolve, reject, hold, profile-field reject) still write patient in-app notifications.

This is a **signed-off-spec reversal** of CLINICAL_SPEC Part 13.2 ("BP Level-1 writes an immediate patient DASHBOARD/push so the patient doesn't have to open the app"). Duwaragie approved; needs to be flagged to Dr. Singal as a spec delta.

**Verify by:**
1. **Removed (in-app mirror):** confirm these specific writes are gone:
   - `backend/src/daily_journal/services/alert-engine.service.ts:912` — patient `Notification.create` (DASHBOARD) on alert creation ("Cardioplace Alert …"). Run `grep -n "Cardioplace Alert\|Notification.create" backend/src/daily_journal/services/alert-engine.service.ts` — should be absent or only in non-patient contexts.
   - `backend/src/daily_journal/services/escalation.service.ts` — the patient DASHBOARD `Notification` in the `BP_LEVEL_1_PATIENT_T0` path. `grep -nE "BP_LEVEL_1_PATIENT_T0|patient.*Notification" backend/src/daily_journal/services/escalation.service.ts`.
2. **KEPT (emails) — critical to NOT touch:** every `EmailService.sendEmail` call in `escalation.service.ts` must remain. `grep -nc "EmailService.sendEmail\|sendEmail(" backend/src/daily_journal/services/escalation.service.ts` — count should match pre-fix.
3. **KEPT (admin-action notifications):** these still fire — `grep` each one in Niva's diff to confirm not accidentally deleted:
   - `backend/src/.../intake.service.ts:859` — profile-field reject
   - `backend/src/.../intake.service.ts:1067` — medication HOLD
   - `backend/src/.../intake.service.ts:1298` — care-team enrollment
   - `backend/src/.../threshold.service.ts:214` — threshold change
   - `backend/src/.../provider.service.ts:1443` + `:1455` — resolve / acknowledge
4. **KEPT (engagement reminders):** `gap-alert.service.ts:88/98` (gap-alert) and `:77` (monthly re-ask) untouched.
5. **Spec-delta documented:** look in `qa/reports/RESULTS.md` (or wherever Niva wrote up the work) for a "Spec delta: CLINICAL_SPEC Part 13.2 reversal" note. If missing, ask Niva to add it before merge — Dr. Singal needs to see it.

**Manual scenario:**
- Test patient submits a check-in that fires a BP Level-1 (e.g. 145/92). Expected after the fix:
  - `DeviationAlert` row created ✓
  - Patient `Notification` row created **NO** ✗ (this is what we're removing)
  - Patient app `/alerts` surface shows the alert ✓
  - Patient app `/notifications` bell does NOT show a mirror ✓
  - Provider email sent ✓ (Gmail check: `duwaragie22@gmail.com` etc.)
- Admin acknowledges the alert. Expected:
  - Patient `Notification` row created ✓ (admin-action notification)
  - Patient sees the "Your care team acknowledged your alert" notification in the bell ✓
- Admin places a medication on hold. Expected:
  - Patient `Notification` row created ✓ (per A1 path 1 or 2 of medication workflow)

**PASS:** no in-app mirror on alert creation; emails fully intact; admin-action notifications still fire; spec delta documented.
**FAIL examples:** in-app mirror still being written; ANY email path accidentally removed; admin-action notifications also dropped as collateral; spec delta not documented for Dr. Singal.

---

### C-C. Tier-3 caregiver/physician-only rules hidden from patient

**Spec:** Tier-3 rules with empty `patientMessage` (e.g. `RULE_HF_CAREGIVER_EDEMA`, pulse-pressure, loop-diuretic) — patient gets NO alert card and NO notification. They still render in the admin view (Physician notes + the three-tier card, minus empty patient card per A2), and still dispatch to the caregiver (unchanged).

**Verify by:**
1. Patient alerts list query filters out Tier-3 rules with empty `patientMessage`. Look in `backend/src/daily_journal/` for the patient-facing alert fetch — there should be a filter like `WHERE patientMessage IS NOT NULL AND patientMessage != ''` or equivalent.
2. Patient notifications query similarly excludes Tier-3.
3. Admin alerts list still includes Tier-3 (the admin Physician notes section).
4. Caregiver dispatch path unchanged — `RULE_HF_CAREGIVER_EDEMA` still fires caregiver email (if `CAREGIVER_DISPATCH_ENABLED=true`).
5. **Manual:** seed a patient with HF and trigger leg-swelling symptoms → `RULE_HF_CAREGIVER_EDEMA` fires. Patient should see nothing. Admin should see it under Physician notes. If caregiver flag enabled, caregiver should receive email.

**PASS:** Tier-3 patient suppression works; admin + caregiver paths untouched.
**FAIL examples:** Tier-3 still surfacing to patient as green "For your information" cards; caregiver dispatch broken; admin no longer sees the alert.

---

### C-D1. Patient-side caregiver card restyled to match admin

**Spec:** `frontend/src/components/cardio/CaregiversCard.tsx` (used in clinical-intake and profile pages) restyled to match `admin/src/components/patient-detail/CaregiversPanel.tsx`: same card structure, add/edit/remove flow, field grouping, consent presentation, empty/loading states. Use patient-app theme tokens (not admin styling imports).

**Verify by:**
1. Compare structure side-by-side: `wc -l frontend/src/components/cardio/CaregiversCard.tsx admin/src/components/patient-detail/CaregiversPanel.tsx` — patient card should now be substantially restructured (likely longer than before).
2. **Manual:** sign in as patient → open profile → caregivers section. Should look structurally similar to the admin panel (cards, consent UI, action buttons) but in the patient app's purple theme.

**PASS:** patient-side caregiver UI mirrors admin's structure and flow; patient theme preserved.
**FAIL examples:** unchanged from old version; styled with admin tokens leaking into patient app; flow inconsistent with admin's.

---

### C-D2. Admin Caregivers gets a dedicated tab

**Spec:** Promote `CaregiversPanel` from nested-under-CareTeam to first-class tab in patient-detail view. Add `'caregivers'` to `TabKey` union (~`PatientDetailShell.tsx:56`), add tab entry to tabs array (~line 456) with label "Caregivers", icon, optional count. Add render block. Remove `CaregiversPanel` mount from `CareTeamTab.tsx:499`.

**Verify by:**
1. `grep -n "TabKey\|'caregivers'" admin/src/components/patient-detail/PatientDetailShell.tsx` — confirm `'caregivers'` is in the union.
2. Tabs array in `PatientDetailShell.tsx` includes a Caregivers entry. `grep -nA5 "label.*Caregivers\|key.*caregivers" admin/src/components/patient-detail/PatientDetailShell.tsx`.
3. Render block for `tab === 'caregivers'` exists and mounts `<CaregiversPanel patientId={patientId} />`.
4. `CareTeamTab.tsx:499` (or thereabouts) — `<CaregiversPanel .../>` mount **removed**. `grep -n "CaregiversPanel" admin/src/components/patient-detail/CareTeamTab.tsx` should return nothing (or only the import if unused — better if import is also removed).
5. **Manual:** admin patient detail → tab bar shows Caregivers as a top-level tab alongside Timeline/Medications/Care Team. Care Team tab no longer contains the caregiver panel.

**PASS:** dedicated tab exists; old mount removed; navigation works.
**FAIL examples:** tab added but old mount also still there (duplicate UI); tab missing; CareTeamTab broken.

---

### C-Dashboard banner correctness (cross-cutting)

**Spec (implicit across A1 + B + C):** the dashboard "ACTIVE ALERT" banner must:
- Use the A1-corrected title/color (HF-decomp not labeled "low")
- Pick the **highest-priority open alert** (not just the most recent)
- **Never** surface a Tier-3 "Care team update" as the banner (Tier-3 should be invisible to the patient entirely per C-C)

**Verify by:**
1. **Manual:** patient with multiple open alerts of mixed tiers + an HF-decomp. Dashboard banner should: show the highest-priority one (Tier-1 > Tier-2 > Tier-1-Low > Tier-3-with-patient-message); display the A1-corrected presentation for HF-decomp; never show a Tier-3 caregiver-only rule.
2. Source: `frontend/src/app/dashboard/page.tsx` or `frontend/src/components/cardio/Dashboard.tsx` — the active-alert selection logic should sort by tier priority, not just `createdAt`.

**PASS:** banner picks highest-priority, uses corrected presentation, never shows caregiver-only Tier-3.
**FAIL examples:** banner shows the most recent alert regardless of severity; banner shows a Tier-3 caregiver-only row; banner mislabels HF-decomp as "low BP."

---

### Deferred items (post-pilot — DO NOT expect implementations)

If any of these appear in Niva's diff, that's not necessarily wrong but worth flagging:

- Combination pill de-duplication wording polish (Section 1 of medication doc) — nice-to-have refinement
- Photo-bottle option for unknown medications (Section 1 next-version)
- Reconciliation workflow with structured discrepancy resolution (Section 6)
- Exportable reconciled medication list (Section 6)
- Medication change audit report (Section 6)
- HFpEF beta-blocker indication intake question (Q5B)
- All FHIR write-back (Appendices A + B) — also has a regulatory gate before build can start

---

## Live test scenarios — walk these end-to-end after the code-level audit

| # | Scenario | Confirms |
|---|---|---|
| 1 | Place a medication on PROVIDER_DIRECTED_HOLD → patient logs in → sees named medication, "do not take" instruction | A1 path 1 |
| 2 | Same medication, switch hold to AWAITING_RECORDS → patient sees unnamed informational message; medication name NOT visible | A1 path 2 |
| 3 | Try to place hold with reason OTHER and no free-text → API rejects | A2 |
| 4 | Backdate a HOLD record by 8 days → run hold-escalation cron → dashboard badge appears | A3 (day 7) |
| 5 | Backdate by 15 days → Tier-3 alert fires to primary provider | A3 (day 14) |
| 6 | Backdate by 31 days → Tier-2 alert fires to provider + MD | A3 (day 30) |
| 7 | Backdate by 46 days → CMO queue entry | A3 (day 45) |
| 8 | Submit angioedema symptom on a non-ACE patient → RULE_GENERIC_ANGIOEDEMA fires, compressed ladder visible | A4 |
| 9 | First-month patient, missed dose → patient-only nudge appears | A5 (positive case) |
| 10 | First-month patient on beta-blocker with HFrEF, missed dose → Tier-2 alert, NOT the nudge | A5 (carve-out) |
| 11 | Submit BP 120/140 → rejected, patient sees retake message | B1 Tier 1 |
| 12 | Submit BP 120/140 a second time → second retake message variant | B1 Tier 1 repeat |
| 13 | Submit BP 135/125 (PP=10) → accepted, physician sees artifact note | B1 Tier 2 |
| 14 | Submit BP 140/124 (PP=16) → accepted, no flag | B1 Tier 3 |
| 15 | HFrEF patient, session-averaged PP=20 → HFrEF-specific narrow-PP note to physician only | B2 |
| 16 | Same with HFpEF, HCM, generic — each condition's note appears | B2 condition branches |
| 17 | New patient, reading 1 of 7 at 145/90 → L1 alert fires WITH "[1 of 7 baseline readings]" disclaimer on provider side, NOT on patient side | B3 |
| 18 | Fire RULE_ACE_ANGIOEDEMA → admin resolution modal shows 6 angioedema-specific options, not generic Tier-1 set | B4 |
| 19 | Resolve angioedema with option 3 ("ACE discontinued") → patient med list updates to DISCONTINUED + permanent profile flag "ACE INHIBITOR CONTRAINDICATED..." | B4 option 3 |
| 20 | Resolve angioedema with option 5 ("False alarm") → permanent flag NOT set | B4 option 5 |
| 21 | Enroll patient with aortic stenosis → onboarding flags mandatory threshold configuration; default lower bound SBP <100 applied until provider configures | B5C |
| 22 | HF-decomp patient: open the alert detail in patient app → renders teal/amber (not blue), title is not "Your blood pressure is low", no hypotension footer | C-A1 |
| 23 | Same patient: dashboard banner uses corrected HF-decomp presentation, NOT mislabeled as "low" | C-A1 + Dashboard |
| 24 | Open a Tier-3 alert with empty patientMessage → admin sees Caregiver + Physician cards only, no empty Patient card | C-A2 |
| 25 | Open admin Alerts tab for a patient with mixed-tier alerts → "All (N)" count and list include Tier-3 | C-A3 |
| 26 | Admin Timeline shows "Caregiver contact updated" or named caregiver, never raw UUID | C-A4 |
| 27 | Patient submits a check-in firing BP-L1 (145/92) → DeviationAlert created, NO patient Notification row; provider/backup/MD emails arrive in Gmail | C-B (mirror removed, emails kept) |
| 28 | Admin acknowledges Marcus's alert → patient Notification row IS created ("Your care team acknowledged") | C-B (admin-action notification kept) |
| 29 | Admin places medication on hold → patient Notification row created per A1 path 1 or 2 | A1 + C-B |
| 30 | Trigger `RULE_HF_CAREGIVER_EDEMA` → patient sees NOTHING (no card, no notification); admin sees it under Physician notes; caregiver email fires if dispatch flag on | C-C |
| 31 | Patient profile → caregivers section visually matches admin CaregiversPanel structure (add/edit/remove flow, consent UI) | C-D1 |
| 32 | Admin patient-detail tab bar shows Caregivers as a top-level tab; opening Care Team no longer renders the caregiver panel | C-D2 |
| 33 | Patient with multiple open alerts (Tier-1, Tier-2, Tier-3 caregiver-only) → dashboard banner shows the highest-priority patient-visible one; Tier-3 caregiver-only NEVER appears as banner | Dashboard cross-cutting |

---

## Report-back format

For each item A1–A5, B1–B5C, and C-Pre / C-A1–A5 / C-B / C-C / C-D1 / C-D2 / C-Dashboard, fill in a status:
- ✅ **PASS** — implementation matches spec, manual scenario confirmed
- ⚠️ **PARTIAL** — partially implemented; describe what's missing
- ❌ **MISSING** — not in Niva's branch
- 🔄 **REGRESSION** — was working before, broken now

For any ⚠️/❌/🔄, paste:
- The file path(s) you checked
- The specific spec line that's not honored
- A reproducer (manual scenario or curl)

Drop the report at `qa/reports/NIVA_REVIEW_SIGNOFFS_2026_05_24.md` and ping Duwaragie.

---

## Hard "don't" list

- Don't run any write/mutation against prod. Local stack only for audit.
- Don't merge Niva's branch yourself. Audit is read-only; merge sequencing belongs to Duwaragie.
- Don't change clinical wording or thresholds yourself. If something looks clinically off, flag for Manisha — don't edit.
- Don't expand scope. If you spot something Niva did beyond the two sign-offs, note it separately but don't audit deeply unless Duwaragie asks.
