# Manisha Decisions — Chronological Audit Log

**Clinical authority:** Dr. Manisha Singal (CMO)
**Purpose:** Canonical, in-repo audit trail of every clinical decision Dr. Singal has signed off on. Source documents are archived as Markdown under [`docs/clinical-signoffs/`](./clinical-signoffs/) so the trail survives any local file loss.
**Maintained by:** Duwaragie (Dev 3) — append a new row whenever a sign-off lands.

> **Why this file exists:** This log is the source-of-truth audit trail tying clinical decisions to (a) the source document Dr. Singal signed, (b) the spec section it lives in, and (c) the code that implements it. The high-level summary in [CLINICAL_SPEC.md → Changelog](./CLINICAL_SPEC.md#changelog) is for narrative context; this file is the per-decision ledger.

## How to read this log

Each round has:
- **Source artifact** — the original `.md` archive under `docs/clinical-signoffs/` (the actual Dr. Singal document, converted from `.docx`/`.pdf` for repo-trackability)
- **Decisions** — one row per individually signed-off decision
- **Spec section** — where the rule lives in [`CLINICAL_SPEC.md`](./CLINICAL_SPEC.md)
- **Code location** — file path of the implementing logic (when applicable)

---

## 2026-06-06 — Open Decisions (D1–D6) + Backdating Policy

**Source:** [`MANISHA_2026_06_06_OPEN_DECISIONS_AND_BACKDATING_SIGNOFF.md`](./clinical-signoffs/MANISHA_2026_06_06_OPEN_DECISIONS_AND_BACKDATING_SIGNOFF.md)
**Status:** ✅ All decisions signed off; implementation on `duwaragie-round2-fixes` branch (2026-06-07).

### Open Decisions Doc

| # | Decision | Outcome | Spec section | Code location |
|---|---|---|---|---|
| D1a | `TIER_1_CONTRAINDICATION` banner color | Stay RED (no change) | [Part 13.x](./CLINICAL_SPEC.md#part-13--audit-trail--escalation-engine) | `admin/src/components/AlertCard.tsx` (chromeFor) |
| D1b | `TIER_3_INFO` banner color (admin only) | Move teal → info-blue (`#2563EB`) | n/a (UI chrome only) | `admin/src/app/globals.css` + 8 admin callsites |
| D2 | CAD physician wording reconciliation | Engine ≥140 / DBP <70 stands; Doc 2 markdown updated to match | [Part 4.3](./CLINICAL_SPEC.md#43-coronary-artery-disease-cad), [Part 15 Q2](./CLINICAL_SPEC.md#q2--cad-patient-default-sbpuppertarget--signed-off) | `shared/src/alert-messages.ts` (CAD physician messages, comment cleanup) |
| D4 | Physician-tier placeholders threading | Backlog `[age]` + `[medication list]`; **gestational age threaded** (conditional exception activated — pilot includes pregnant patients) | [Part 3 — Pregnancy thresholds](./CLINICAL_SPEC.md#part-3--pregnancy-thresholds) | `shared/src/alert-messages.ts` (`gestationalAgePhrase`), `backend/src/daily_journal/engine/pregnancy-thresholds.ts` (`gestationalAgeWeeksFromProfile`), `backend/src/daily_journal/engine/contraindications.ts`, `output-generator.service.ts` |
| D5 | `TIER_1_CONTRAINDICATION` patient EMAIL at T+0 | Add patient-EMAIL with "don't stop on your own" framing | [Part 14 — Escalation](./CLINICAL_SPEC.md#part-14--caregiver-dispatch--medication-hold) | `backend/src/daily_journal/escalation/ladder-defs.ts` (`TIER_1_CONTRAINDICATION_PATIENT_T0`), `escalation.service.ts` (dispatch + subject) |
| D6 | `BP_LEVEL_1_HIGH` patient EMAIL at T+0 | Re-instate, cohort-gated: STANDARD mode + HIGH tier only (not LOW; not PERSONALIZED — alarm-fatigue guard) | [Part 14 — Escalation](./CLINICAL_SPEC.md#part-14--caregiver-dispatch--medication-hold) | `ladder-defs.ts` (`BP_LEVEL_1_PATIENT_T0` channels EMAIL+DASHBOARD), `escalation.service.ts` (cohort gate `tier==='BP_LEVEL_1_HIGH' && mode==='STANDARD'`) |

### Backdating Policy Sign-Off

| # | Decision | Outcome | Spec section | Code location |
|---|---|---|---|---|
| BD1 | L2 911 CTA suppression on 1–24h delayed entries | Sign off — clinically appropriate (stale data cannot confirm active target-organ damage; provider-only flag preserves safety) | TBD — adding to spec | TBD — backdating pipeline implementation pending |
| BD2 | L1 provider-only disclaimer mechanic | Sign off as-designed (identical patient wording; DELAYED badge + disclaimer + audit-trail entry visible only to provider) | TBD | TBD |
| BD3 | Provider flag wording | Add symptom-assessment prompt: "Verify current BP and assess for headache, visual changes, chest pain, or dyspnea." | TBD | TBD |
| BD4 | CMS CPT 99454 billing for backdated entries | Accept-but-tag with `delay_band`; readings tagged `historical_entry` (>24h) do NOT count toward 16-day requirement; 1–24h `delayed_entry` countable but flag for review | TBD | TBD |
| BD5 | UX for >24h entries | Option B — transparent informational note ("recorded but won't trigger a real-time alert") | TBD | TBD |
| BD6 | Retrospective symptom reporting (>24h symptoms) | Separate sign-off document needed — qualitatively different from BP readings | Open — needs Manisha follow-up document | n/a |

### Backlog tickets created from this round

- **D4 #1** — Thread `patientAgeYears` through `AlertContext` + populate age-related rule physician messages.
- **D4 #2** — Thread `activeMedicationList` through `AlertContext` + populate contraindication-related physician messages.
- **BD3 follow-up** — Implement provider-flag delayed-entry symptom-assessment wording when backdating pipeline ships.

---

## 2026-06-02 — Manisha Reply Q1–Q7

**Source:** [`MANISHA_2026_06_02_REPLY_Q1_TO_Q7.md`](./clinical-signoffs/MANISHA_2026_06_02_REPLY_Q1_TO_Q7.md)
**Status:** ✅ All seven Qs signed off; implementation shipped under Handoff 1 (P0 safety: Q2) + Handoff 2 (Q1/Q5/Q7) — see `duwaragie-round2-fixes` and prior PRs to `dev`.

| Q# | Decision | Outcome | Spec section | Code location |
|---|---|---|---|---|
| Q1 | A5 first-month adherence nudge wording | Use hybrid: sign-off version + Niva's wording refinements | [Part 9 — Adherence](./CLINICAL_SPEC.md#part-9--cluster-6-additions-symptomatic-rules--session-averaging) | `shared/src/alert-messages.ts` (`RULE_FIRST_MONTH_ADHERENCE_NUDGE`) |
| Q2 | Session-averaging on `RULE_HFREF_HIGH` | **REVERT to single-reading firing** (P0 safety — prior session-averaging suppressed clinically meaningful single high readings in HFrEF) | [Part 4.2 — HFrEF](./CLINICAL_SPEC.md#42-heart-failure--hfref-reduced-ejection-fraction) | `backend/src/daily_journal/engine/condition-branches.ts` (HFREF_HIGH single-reading path); physicianMessage suffix suppressed (see commits `5debd2c` + `d9ea2ae`) |
| Q3 | Personalization for patients with no condition flags | Interpretation (a) — `STANDARD` mode applies; no personalized threshold pathway | n/a (code comment + reasoning) | `backend/src/daily_journal/services/profile-resolver.service.ts` |
| Q4 | DHP-CCB + Aortic Stenosis | Add Tier 1 admin alert + soft-block on prescription | [Part 4.10 — Aortic Stenosis](./CLINICAL_SPEC.md#410-aortic-stenosis) | **Backlog** — not yet implemented |
| Q5 | Stage 2 axis-specific physician wording | Approve all 3 variant strings (SBP-only, DBP-only, both) | [Part 1.2 — Base thresholds](./CLINICAL_SPEC.md#12-base-thresholds-for-all-adults-source-2025-ahaacc-guideline) | `shared/src/alert-messages.ts` (standard L1/L2 high physician messages) |
| Q6 | Per-reading vs per-session firing for repeated same-rule triggers | Per-session dedup (one alert per session per rule) | n/a (engine internals) | **Backlog** — current behavior is per-reading; revisit post-pilot |
| Q7 | Gestational HTN vs preeclampsia field naming | Phase 1: rename to `historyHDP` (history of hypertensive disorders of pregnancy); add separate `gestationalHTN` flag in a later phase | [Part 3 — Pregnancy](./CLINICAL_SPEC.md#part-3--pregnancy-thresholds) | `backend/prisma/schema/patient_profile.prisma` (`historyHDP` field) |

---

## 2026-05-24 — Medication Workflow + Pending Clinical Clarifications

**Prompt to Manisha:**
- [`MANISHA_2026_05_22_MEDICATION_WORKFLOW_PROMPT.md`](./clinical-signoffs/MANISHA_2026_05_22_MEDICATION_WORKFLOW_PROMPT.md) — the medication workflow doc sent to her for review (HOLD step, verification states, side-effect rule wiring)
- [`MANISHA_2026_05_22_PENDING_CLARIFICATIONS_PROMPT.md`](./clinical-signoffs/MANISHA_2026_05_22_PENDING_CLARIFICATIONS_PROMPT.md) — the pending-clarifications doc sent alongside

**Verbatim source-of-truth from Manisha:** [`MANISHA_2026_05_24_MEDICATION_WORKFLOW_SIGNOFF_FULL.md`](./clinical-signoffs/MANISHA_2026_05_24_MEDICATION_WORKFLOW_SIGNOFF_FULL.md) — the actual reply she sent, persisted verbatim into the repo on 2026-06-07 (covers 6 sections + Appendix A FHIR roadmap + Appendix B regulatory flag).

**Engineering distillation:** [`MANISHA_2026_05_24_MEDICATION_WORKFLOW_AND_CLARIFICATIONS_SIGNOFF.md`](./clinical-signoffs/MANISHA_2026_05_24_MEDICATION_WORKFLOW_AND_CLARIFICATIONS_SIGNOFF.md). This is the Niva-audit guide that distils Manisha's reply into per-decision implementation specs.

**Status:** ✅ All decisions signed off; implementation shipped on `nivakaran-dev` → `dev` → `main` (per memory note `project_niva_merged_to_main_directly`).

### Part A — Medication Workflow (5 items)

| # | Decision | Outcome | Spec section | Code location |
|---|---|---|---|---|
| A1 | HOLD two-path patient message | `PROVIDER_DIRECTED_HOLD` → "Your care team has asked you to pause [medname]… do not take it until your care team tells you it is okay" (names the med, persists, in daily check-in). Administrative holds (`AWAITING_RECORDS`, `UNCLEAR_NAME`, `UNCLEAR_DOSE`, `OTHER`) → "Your care team is reviewing your medicine list… keep taking your medicines as usual unless your care team tells you otherwise" (does NOT name the med, displayed once, disappears when hold resolved). **PATIENT SAFETY:** the blanket "stop taking" wording was dangerous for administrative holds — beta-blocker rebound risk. | [Part 14.2 — Medication HOLD action](./CLINICAL_SPEC.md#142-medication-hold-action) | `shared/src/alert-messages.ts` (`systemMsgMedicationHold*`); `backend/prisma/schema/patient_medication.prisma` (`holdReason` enum) |
| A2 | HOLD reason codes (structured dropdown) | `PROVIDER_DIRECTED_HOLD`, `AWAITING_RECORDS`, `UNCLEAR_NAME`, `UNCLEAR_DOSE`, `OTHER`. Admin requires a rationale to set HOLD. | [Part 14.2](./CLINICAL_SPEC.md#142-medication-hold-action) | `patient_medication.prisma` enum; admin Medications tab UI |
| A3 | HOLD escalation ladder | Time-based — 7 days (gentle reminder) / 14 days / 30 days / 45 days (auto-escalate to medical director). | [Part 13](./CLINICAL_SPEC.md#part-13--audit-trail--escalation-engine) | `backend/src/daily_journal/escalation/` (HOLD escalation cron) |
| A4 | Angioedema rules — verify present | Confirmed `RULE_ACE_ANGIOEDEMA` shipped per 2026-05-15/18 sign-off; this was a no-op audit item. | [Part 8.2](./CLINICAL_SPEC.md#82-side-effect--interaction-rules-cluster-7-appendix-a-manisha-2026-05-11) | `shared/src/alert-messages.ts` + `backend/src/daily_journal/engine/angioedema.ts` |
| A5 | First-month adherence nudge | Verbatim wording: "Starting a new medicine can take some getting used to. If you missed a dose, that's okay — just try to take your next one on time. Your care team is here to help if anything makes it hard to stay on schedule." Scope: patient-only, one-time, fires once per first-missed-dose event in the first 30 days of a new medication. Does NOT fire for beta-blocker single-miss carve-out patients (they get the immediate Tier 2 alert instead). | [Part 9](./CLINICAL_SPEC.md#part-9--cluster-6-additions-symptomatic-rules--session-averaging) | `shared/src/alert-messages.ts` (`RULE_FIRST_MONTH_ADHERENCE_NUDGE`); see memory note `reference_first_month_nudge_dedup` |
| A6 | Section 1 — Intake refinements | Confirm combination-pill dedup uses plain-language prompt (verbatim wording in the source doc Section 1). "Not sure" frequency option is the correct Joint Commission "good faith" approach. Post-pilot: add "photo your pill bottle" option for the "something not listed" path (Ward 7/8 patients may know the bottle but not the name). | Cross-cutting (intake UI) | `frontend/src/components/intake/MedicationCard.tsx` + clinical-intake flow |
| A7 | Section 4 — Two missing safety-alert rules | Add to the safety-alert table: **(3)** ACE + angioedema symptoms (Tier 1, fires on any verification status, compressed ladder — already in engine per 2026-05-15 signoff). **(4)** Generic angioedema, any patient (Tier 1, all patients, catches hereditary/ARB/idiopathic). Both shipped under Cluster 8 angioedema work. | [Part 8.2](./CLINICAL_SPEC.md#82-side-effect--interaction-rules-cluster-7-appendix-a-manisha-2026-05-11) | `backend/src/daily_journal/engine/angioedema.ts` |
| A8 | Section 6 — Reconciliation post-pilot priorities | Approved for MVP (Joint Commission "good faith effort" met). Post-pilot priorities (in order): (1) Exportable reconciled medication list — Joint Commission EP 4 required; second cohort. (2) Discrepancy resolution workflow with 5-option structured flow. (3) Medication change audit report for JC audits + quality reporting. | TBD — post-pilot roadmap | Backlog |
| A9 | Appendix A — FHIR medication integration (POST-PILOT) | Three-phase roadmap: Phase 1 (Month 3-4) FHIR read at intake + discrepancy flagging. Phase 2 (Month 5-6) FHIR write of verification status. Phase 3 (Month 7+) full bidirectional sync. Resource mapping: verified→MedicationStatement active; rejected→entered-in-error; discontinued→stopped with reasonCode; on-hold→on-hold with reason note. **DO NOT BUILD UNTIL MVP IS STABLE.** | TBD — post-pilot roadmap | Backlog |
| A10 | Appendix B — Regulatory flag (FHIR write-back + device classification) | **ACTION REQUIRED — counsel agenda within 30 days.** FHIR medication write-back may change Cardioplace's regulatory classification (CDS Section 3060 exemption vs SaMD). 4 questions for counsel (see source doc Appendix B). Must be answered BEFORE Phase 2 design begins. Pilot is unaffected. | n/a — regulatory | Backlog (counsel/CMO) |

### Part B — Pending Clinical Clarifications (5+ items)

| # | Decision | Outcome | Spec section | Code location |
|---|---|---|---|---|
| B1 | DBP ≥ SBP three-tier validation (Q1) | Wording for the three-tier physician + caregiver + patient messages when DBP equals or exceeds SBP (anatomic-impossibility flag). | [Part 1.2](./CLINICAL_SPEC.md#12-base-thresholds-for-all-adults-source-2025-ahaacc-guideline) | `shared/src/alert-messages.ts` (DBP≥SBP validation rule) |
| B2 | Narrow pulse pressure rule (Q2) | Physician-only Tier 3 note at PP < 25 mmHg (mirroring wide-PP treatment); no patient/caregiver tier. | [Part 11](./CLINICAL_SPEC.md#part-11--multi-axis-co-fire-taxonomy-g1g9--b1) | `backend/src/daily_journal/engine/pulse-pressure.ts` |
| B3 | Pre-personalization Level 1 alerts (Q3) | **Engine wins, spec to update:** keep firing Level 1 with the disclaimer in pre-Day-3 mode (the safer of the two options). Spec Part 6 to be revised to match. | [Part 6 — Pre-Day-3 Mode](./CLINICAL_SPEC.md#part-6--pre-day-3-mode) | `backend/src/daily_journal/services/alert-engine.service.ts` (pre-Day-3 disclaimer path) |
| B4 | Angioedema bespoke resolution actions (Q4) | Structured sub-fields for resolution: willGo (Y/N), ED facility, replacement med, outcome. | [Part 12.1 — Tier 1 actions](./CLINICAL_SPEC.md#121-tier-1-contraindication--safety-critical--5-actions-all-require-rationale) | `backend/prisma/schema/diviation_alert.prisma` (`resolutionSubFields*`) |
| B5A | Post-pregnancy flag (regression check) | Confirmed unchanged from prior sign-off; no engine change. | [Part 3 — Pregnancy](./CLINICAL_SPEC.md#part-3--pregnancy-thresholds) | `backend/prisma/schema/patient_profile.prisma` |
| B5C | Aortic stenosis interim rule (Q5C) | Interim: mandatory provider threshold config + HCM-equivalent SBP lower bound (100) until provider sets personalized targets. | [Part 4.10 — Aortic Stenosis](./CLINICAL_SPEC.md#410-aortic-stenosis) | `backend/src/daily_journal/engine/condition-branches.ts` |
| B5D | BP Level 2 "Unable to reach patient — will retry" (regression check) | Confirmed unchanged; schedules fresh T+4h escalation row with `triggeredByResolution=true`. | [Part 12.3 — BP L2 actions](./CLINICAL_SPEC.md#123-bp-level-2-emergency--6-actions-all-require-rationale) | `backend/src/daily_journal/services/escalation.service.ts` |

---

## 2026-05-18 — Cluster 8 Q1–Q3 (Brady + CAD + Adherence)

**Source:** [`MANISHA_2026_05_18_FOLLOWUP_SIGNOFF_BRADY_CAD_ADHERENCE.md`](./clinical-signoffs/MANISHA_2026_05_18_FOLLOWUP_SIGNOFF_BRADY_CAD_ADHERENCE.md)
**Status:** ✅ All three signed off — unblocks `test.fixme()` for Nora HR 45, Paul CAD 145, Aisha adherence, Post-Day3 145/95.

| Q# | Decision | Outcome | Spec section | Code location |
|---|---|---|---|---|
| Q1 | Asymptomatic bradycardia HR 40–49 (no symptoms) | **Fire Tier 3 surveillance row** — HR 40–49 with no symptoms should NOT be silent | [Part 4.6 — Bradycardia](./CLINICAL_SPEC.md#46-bradycardia), [Part 15 Q1](./CLINICAL_SPEC.md#part-15--open-clinical-questions-pending) | `backend/src/daily_journal/engine/hr-branches.ts` (`bradySurveillanceRule`) |
| Q2 | CAD patient default `sbpUpperTarget` | **140** (Stage 2 HTN floor) with phased ramp 160 → 140; provider-set custom thresholds always win | [Part 4.3 — CAD](./CLINICAL_SPEC.md#43-coronary-artery-disease-cad), [Part 15 Q2](./CLINICAL_SPEC.md#q2--cad-patient-default-sbpuppertarget--signed-off) | `backend/src/daily_journal/engine/condition-branches.ts` (`cadDefaultUpper`, `cadRampApplies`) |
| Q3 | Single-miss adherence threshold | Fire `RULE_FIRST_MONTH_ADHERENCE_NUDGE` on a single miss within first 30 days of new med (per-event dedup); 2-of-3 day rolling window stays default for steady-state | [Part 9 — Adherence](./CLINICAL_SPEC.md#part-9--cluster-6-additions-symptomatic-rules--session-averaging), [Part 15 Q3](./CLINICAL_SPEC.md#part-15--open-clinical-questions-pending) | `backend/src/daily_journal/engine/adherence.ts` (first-month nudge logic) |

---

## 2026-05-18 — ACE-Inhibitor Angioedema Rule (P0 pilot blocker)

**Source:** [`MANISHA_2026_05_18_ACE_ANGIOEDEMA_SIGNOFF.md`](./clinical-signoffs/MANISHA_2026_05_18_ACE_ANGIOEDEMA_SIGNOFF.md)
**Status:** ✅ All four decisions approved for immediate implementation. Built in Cluster 8. Pilot-blocker because the Ward 7/8 cohort is predominantly African American — up to 5× the risk of ACE-I angioedema vs. white patients (ALLHAT 0.72% vs 0.31%).

| Decision | Outcome | Spec section | Code location |
|---|---|---|---|
| Q1 — Three-tier wording for `RULE_ACE_ANGIOEDEMA` | Approve with revisions (patient + caregiver + physician); patient told to stop the medication (AAAAI Focused Parameter Update) | [Part 8.2 — Side-effect rules](./CLINICAL_SPEC.md#82-side-effect--interaction-rules-cluster-7-appendix-a-manisha-2026-05-11) | `shared/src/alert-messages.ts` (`RULE_ACE_ANGIOEDEMA` 3-tier messages) |
| Q2 — Compressed escalation ladder | T+0 → T+15m → T+1h → T+4h (airway-emergency cadence) | [Part 13 — Audit / escalation](./CLINICAL_SPEC.md#part-13--audit-trail--escalation-engine) | `backend/src/daily_journal/escalation/ladder-defs.ts` (`TIER_1_ANGIOEDEMA_LADDER`) |
| Q3 — Permanent ACE contraindication after angioedema | Set `aceContraindicatedAt` on resolution; never re-prescribe any ACE inhibitor (class effect) | [Part 4 — Heart Conditions](./CLINICAL_SPEC.md#part-4--heart-condition-modifications) | `backend/prisma/schema/patient_profile.prisma` (`aceContraindicatedAt`, `aceContraindicationReason`); resolution catalog enforces |
| Q4 — Patient T+0 PUSH dispatch | Fire immediately regardless of business hours (airway emergency); full-screen red + 911 CTA | [Part 14 — Escalation](./CLINICAL_SPEC.md#part-14--caregiver-dispatch--medication-hold) | `ladder-defs.ts` (`ANGIOEDEMA_PATIENT_T0`), `escalation.service.ts` |

---

## 2026-05-11 — Cluster 7 / Appendix A + B (Master Consolidated Guide v3)

**Source:** [`MANISHA_2026_05_11_MASTER_GUIDE_V3.md`](./clinical-signoffs/MANISHA_2026_05_11_MASTER_GUIDE_V3.md) + [`MANISHA_2026_05_11_APPENDIX_B_TRANSLATIONS.md`](./clinical-signoffs/MANISHA_2026_05_11_APPENDIX_B_TRANSLATIONS.md)
**Status:** ✅ All items approved for implementation. Items marked "Before pilot launch" are blockers for June 2026 first-cohort go-live.

### Part A — Three clinical sign-off responses (from 2026-05-10 follow-ups)

| Decision | Outcome | Spec section | Code location |
|---|---|---|---|
| Adherence trigger threshold | 2-of-3-day rolling window + β-blocker single-miss carve-out (HFrEF / HCM / AFib) | [Part 9.2](./CLINICAL_SPEC.md#92-manisha-2026-05-10-symptom-buttons--brady-absolute--adherence--hf-decompensation) | `backend/src/daily_journal/engine/adherence.ts` |
| Symptom checklist update | Four new symptom buttons: dizziness, syncope, palpitations, leg swelling | [Part 9.2](./CLINICAL_SPEC.md#92-manisha-2026-05-10-symptom-buttons--brady-absolute--adherence--hf-decompensation) | `frontend/src/components/cardio/CheckIn.tsx` |
| Brady co-fire | HR<40 → Tier 1 (was Tier 2); β-blocker dizziness / orthostatic / syncope rules added | [Part 4.6 — Bradycardia](./CLINICAL_SPEC.md#46-bradycardia) | `backend/src/daily_journal/engine/hr-branches.ts`, `condition-branches.ts` |

### Part B — Seven health literacy workflow gaps

| Gap | Outcome | Pilot-blocker? | Spec section |
|---|---|---|---|
| Gap 1 | Reading-level for patient-facing copy → ≤6th-grade Flesch-Kincaid | Yes | Cross-cutting |
| Gap 2–3 | (See source doc for details) | Various | Cross-cutting |
| Gap 4 | (Pilot-blocker per memory note `reference_manisha_master_guide_v3_2026_05_11`) | **Yes** | Cross-cutting |
| Gap 5 | **Caregiver dispatch + name-the-patient wording.** Clinical-tier wording (`caregiverMessage` on every rule) shipped; `RULE_HF_CAREGIVER_EDEMA` + caregiver-routed `RULE_ACE_ANGIOEDEMA` / `RULE_GENERIC_ANGIOEDEMA` signed off. **Implementation:** see [`CAREGIVER_GAP5_IMPLEMENTATION_HANDOFF.md`](./clinical-signoffs/CAREGIVER_GAP5_IMPLEMENTATION_HANDOFF.md) — covers `PatientCaregiver` model, intake/profile UI, admin UI, dispatch wiring. **§1 dispatch-channel decision still pending** (see "Pending" section at bottom of this log). | Yes | [Part 14 — Caregiver dispatch](./CLINICAL_SPEC.md#part-14--caregiver-dispatch--medication-hold) |
| Gap 6 | (See source doc) | Various | Cross-cutting |
| Gap 7 | (Pilot-blocker per memory note `reference_manisha_master_guide_v3_2026_05_11`) | **Yes** | Cross-cutting |

> **Note:** Full per-gap details are in the source document. Some gaps deferred to post-pilot per Niva's audit work (2026-05-29).

### Appendix A — 11 medication side-effect patient-facing messages

Six rules implemented; see [Part 10.1 — Six new rules](./CLINICAL_SPEC.md#101-six-new-rules) for the full table.

### Appendix B — 7 translation additions

26 original messages + 7 new = 33 total in the package. Forwarded to translators per source doc; translation work tracked separately.

---

## 2026-05-10 — Cluster 6 Round 2 (Q7–Q11)

**Source:** Email — no separate `.docx` archive (questions + answers in chat). Memory note: `reference_manisha_clinical_signoff_2026_05_09` (which folded together rounds 1 + 2).

| Decision | Outcome | Spec section | Code location |
|---|---|---|---|
| Q7 — Brady tier | HR<40 → Tier 1 (was Tier 2) | [Part 4.6](./CLINICAL_SPEC.md#46-bradycardia) | `hr-branches.ts` |
| Q8 — Adherence | 2-of-3-day rolling window + β-blocker single-miss carve-out (HFrEF / HCM / AFib) | [Part 9.2](./CLINICAL_SPEC.md#92-manisha-2026-05-10-symptom-buttons--brady-absolute--adherence--hf-decompensation) | `adherence.ts` |
| Q9 — Symptom buttons | Add dizziness, syncope, palpitations, leg swelling | [Part 9.2](./CLINICAL_SPEC.md#92-manisha-2026-05-10-symptom-buttons--brady-absolute--adherence--hf-decompensation) | `frontend/src/components/cardio/CheckIn.tsx` |
| Q10 — HF decompensation rule | Fire Level 1 Low on leg swelling OR >2 lbs/24h weight gain | [Part 9.2](./CLINICAL_SPEC.md#92-manisha-2026-05-10-symptom-buttons--brady-absolute--adherence--hf-decompensation) | `condition-branches.ts` (HF decompensation) |
| Q11 — DHP-CCB peripheral edema | Tier 3; suppress for HF patients (owned by decompensation rule) | [Part 8.2](./CLINICAL_SPEC.md#82-side-effect--interaction-rules-cluster-7-appendix-a-manisha-2026-05-11) | `condition-branches.ts` |

---

## 2026-05-09 — Cluster 6 Round 1 (Q1–Q6)

**Source:** Email — see [`CLAUDE_CODE_CLUSTER_6_MANISHA_DECISIONS.md`](../Documents/cardioplace-handoffs/CLAUDE_CODE_CLUSTER_6_MANISHA_DECISIONS.md) for the question-set; answers folded inline.

| Q# | Decision | Outcome | Spec section | Code location |
|---|---|---|---|---|
| Q1 | Loop-diuretic + SBP <90 | Strict <90 (no 90–92 band); HF rule takes precedence | [Part 4.2 — HFrEF](./CLINICAL_SPEC.md#42-heart-failure--hfref-reduced-ejection-fraction) | `condition-branches.ts` |
| Q2 | Session averaging contract | 2 readings required for non-emergency; single sufficient for Level 2 / pregnancy severe | [Part 5.2 — Session averaging](./CLINICAL_SPEC.md#52-session-averaging-contract-manisha-2026-05-09-q2) | `backend/src/daily_journal/services/session-finalize.service.ts` |
| Q3 | Pregnancy + RUQ pain symptom override precedence | Pregnancy-specific override fires; general override suppressed; suppression audit-logged | [Part 1.3 — Symptom override](./CLINICAL_SPEC.md#13-symptom-override--level-2-at-any-bp) | `engine/symptom-override.ts` |
| Q4 | Pregnancy + ACE/ARB + SBP ≥160 co-fire | Both rule rows kept (dual-axis fire) | [Part 3 — Pregnancy](./CLINICAL_SPEC.md#part-3--pregnancy-thresholds) | `engine/contraindications.ts` (pregnancy ACE/ARB) + pregnancy-thresholds.ts |
| Q5 | Tachycardia window + HR>130 | 8h consecutive-reading window (tightened from 24h); HR>130 → Tier 2 single-reading exception | [Part 4.5 — Tachycardia](./CLINICAL_SPEC.md#45-tachycardia-non-afib) | `engine/condition-branches.ts` (tachycardia path) |
| Q6 | Pregnancy patient wording | Finalised per source | [Part 3 — Pregnancy](./CLINICAL_SPEC.md#part-3--pregnancy-thresholds) | `shared/src/alert-messages.ts` (pregnancy rules) |

---

## 2025-XX — v2.0 Addendum

**Source:** `_MConverter.eu_healplace-cardio-engineering-addendum-v2.md` (legacy artifact; in repo history).
**Status:** ✅ Folded into Parts V2-A through V2-F of CLINICAL_SPEC.md.

Patient self-report onboarding ("trust then verify"); medication intake (visual cards); 3-layer provider dashboard; 5-step Tier 1 / 4-step Tier 2 / 3-step BP Level 2 escalation ladders; JCAHO 15-field audit trail; silent literacy architecture.

---

## 2025-XX — v1.0 Base Spec

**Source:** `_MConverter.eu_healplace-cardio-clinical-signoff-v1.md` (legacy artifact; in repo history).
**Status:** ✅ Folded into Parts 1–8 of CLINICAL_SPEC.md.

Original AHA-aligned rule set: age buckets, base thresholds, symptom overrides, pregnancy, 8 cardiac conditions, 4 medication linkages, pre-measurement checklist, normal BP fluctuation, pre-Day-3 mode, pulse pressure derived alert.

---

## Pending — Open Decisions Not Yet Sent

These are the open questions next on the queue for Dr. Singal. Once she signs off, append a new row above with the source artifact + outcome.

| Topic | Status | Owner |
|---|---|---|
| BD6 — Retrospective symptom reporting (>24h symptoms) | Manisha noted "needs separate sign-off document" 2026-06-06 | Duwaragie to draft |
| Backlog tickets D4 #1 + #2 — `[age]` + `[medication list]` placeholder threading | Manisha said backlog; no immediate signoff needed | Engineering backlog |
| Q4 from 2026-06-02 — DHP-CCB + Aortic Stenosis Tier 1 + soft-block | Signed off but implementation pending | Engineering backlog |
| Q6 from 2026-06-02 — Per-session dedup for repeated same-rule triggers | Signed off but implementation pending; current per-reading behavior is the safer interim | Engineering backlog |
| **Caregiver dispatch channel (Gap 5 §1)** — Option A (lightweight User + dashboard) vs Option B (contact + SMS/email via Twilio) vs Option C (no dispatch, patient shows them) | **Pending Manisha + healthcare counsel.** PHI-over-SMS consent/compliance question. Niva's recommendation per [`CAREGIVER_GAP5_IMPLEMENTATION_HANDOFF.md`](./clinical-signoffs/CAREGIVER_GAP5_IMPLEMENTATION_HANDOFF.md) §1: Option B with a swappable channel abstraction. Blocks dispatch (§3/§6) but not schema/UI (§2/§4/§5). | Duwaragie to send prompt |
| **App-A FHIR write-back + device classification** (regulatory) — 4 questions for healthcare counsel | **Pending counsel.** Manisha flagged 2026-05-24 — agenda within 30 days; answer needed BEFORE Phase 2 design begins. Pilot unaffected. | Whoever owns the counsel relationship |
| **2026-05-11 master guide Gap 6** — details TBD pending review | Source doc lists Gap 6 without text in the audit guide; verify against the verbatim 5/11 source | Duwaragie to verify |

---

## Maintaining this log

When a new sign-off arrives from Dr. Singal:

1. **Archive the source** — convert any `.docx`/`.pdf` she sent to `.md` (using `pandoc`) and commit to `docs/clinical-signoffs/MANISHA_YYYY_MM_DD_TOPIC.md`. Originals can stay in `Documents/cardioplace-handoffs/` for personal archive, but the repo copy is the source-of-truth.
2. **Add a new section at the top of this log** (reverse-chronological) with the table of decisions.
3. **Update [CLINICAL_SPEC.md Changelog](./CLINICAL_SPEC.md#changelog)** with a one-line summary referencing the new section here.
4. **Inline-update [CLINICAL_SPEC.md](./CLINICAL_SPEC.md)** body sections where the decision changes the spec text. Cite the sign-off round inline (e.g., `(Manisha 2026-06-06, D5)`).
5. **Commit on `duwaragie-round2-fixes`** (or current perennial branch) so it ships with the next PR to `dev`.

The combination of the per-decision ledger here + inline spec updates + Changelog summary gives three levels of trace from "what was decided" through to "where is it in code."
