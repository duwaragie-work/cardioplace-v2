# Clinical Specification — Rule-Based BP Alert Logic

**Clinical authority:** Dr. Manisha Singal
**Status:** v2.3 — reflects engine state through 2026-06-07
**Last sign-off folded in:** 2026-06-06 (Open Decisions D1–D6 + Backdating Policy)
**Pending decisions:** Tracking in [`MANISHA_DECISIONS_LOG.md`](./MANISHA_DECISIONS_LOG.md) → "Pending — Open Decisions Not Yet Sent"
**Full audit trail:** [`MANISHA_DECISIONS_LOG.md`](./MANISHA_DECISIONS_LOG.md) — every signed-off decision, source artifact (archived under [`clinical-signoffs/`](./clinical-signoffs/)), spec section, and code location.

This document is the canonical source of truth for every alert rule, threshold, symptom trigger, medication contraindication, and escalation tier. When the code disagrees with this document, the code is wrong.

> **For reviewers:** the spec organises by clinical concern (Part 1–7 by patient population, Part 8 onward by feature). Cluster 6 and Cluster 7 additions are folded into their natural homes (e.g. β-blocker SOB lives under Part 7 — medication linkages) AND summarised in [Part 9](#part-9--cluster-6-additions-symptomatic-rules--session-averaging) / [Part 10](#part-10--cluster-7-additions-side-effect--interaction-rules) for traceability against the sign-off rounds. The [Changelog](#changelog) below indexes every behavioural delta since v1.0.

---

## Changelog

Each entry cites the sign-off round (Dr. Singal date + reference) and the spec section where the new rule lives. Use `git log -- docs/CLINICAL_SPEC.md` for granular history.

| Date | Round | Summary | Spec section |
|---|---|---|---|
| 2025-XX | v1.0 sign-off | Original AHA-aligned rule set: age buckets, base thresholds, symptom overrides, pregnancy, 8 cardiac conditions, 4 medication linkages, pre-measurement checklist, normal BP fluctuation, pre-Day-3 mode, pulse pressure derived alert. | Parts 1–8 |
| 2025-XX | v2.0 addendum | Patient self-report onboarding ("trust then verify"); medication intake (visual cards); 3-layer provider dashboard; 5-step Tier 1 / 4-step Tier 2 / 3-step BP Level 2 escalation ladders; JCAHO 15-field audit trail; silent literacy architecture. | Parts V2-A through V2-F |
| 2026-04-22 | Phase/7 | T+N escalation cron + ladder definitions + 15-field audit columns wired (`@nestjs/schedule`, `EscalationEvent`). Patient ack propagates to escalation rows. | [Part 13](#part-13--audit-trail--escalation-engine) |
| 2026-05-08 | Engine audit | Multi-axis co-fire fix (G1–G9 + B1): one DeviationAlert row per clinical axis on the same reading. Pulse-pressure annotation rides as physician note when another rule fires. | [Part 11](#part-11--multi-axis-co-fire-taxonomy-g1g9--b1) |
| 2026-05-09 | Cluster 6 Q1–Q5 | Q1 loop-diuretic strict <90 (no 90–92 band, HF takes precedence). Q2 session averaging requires 2 readings for non-emergency; single sufficient for Level 2 / pregnancy severe. Q3 RUQ pain → pregnancy override suppresses general (audit-logged). Q4 pregnancy + ACE/ARB + SBP ≥160 keeps both alert rows. Q5 tachycardia 8h consecutive window + HR>130 single-reading Tier 2 exception. Q6 pregnancy patient wording finalised. | [Part 9](#part-9--cluster-6-additions-symptomatic-rules--session-averaging) + revisions to Parts 5, 7, 12 |
| 2026-05-10 | Cluster 6 Q7–Q11 | HR<40 → Tier 1 (was Tier 2). Four new symptom buttons: dizziness, syncope, palpitations, leg swelling. Adherence rolling 2-of-3-day window + β-blocker single-miss carve-out (HFrEF / HCM / AFib). HF decompensation rule (leg swelling OR >2 lbs/24h weight gain). DHP-CCB peripheral edema Tier 3 (suppressed for HF — owned by decompensation rule). | [Part 9](#part-9--cluster-6-additions-symptomatic-rules--session-averaging) |
| 2026-05-11 | Cluster 7 / Appendix A | Six new side-effect / interaction rules: β-blocker fatigue (Tier 3), β-blocker SOB HF (Tier 2 escalates), β-blocker SOB non-HF (Tier 3), NSAID + antihypertensive interaction (Tier 3), ACE inhibitor cough (Tier 3), HF caregiver ankle edema (Tier 3, caregiver-routed). HCM low BP patient wording revised per Appendix B1.4 (preload-dependent, name the symptoms). Medication HOLD verification status added + patient inbox system message. CAREGIVER recipient role on escalation routing. | [Part 10](#part-10--cluster-7-additions-side-effect--interaction-rules) |
| 2026-05-13 | Audit + compliance | Auto-resolve sweep removed (`resolveOpenAlerts` deleted). Alerts now stay OPEN until provider explicitly resolves OR patient acks. JCAHO 15-field audit columns enforced as authoritative. `BP_L2_UNABLE_TO_REACH_RETRY` schedules fresh T+4h escalation row with `triggeredByResolution=true`. | [Part 12](#part-12--resolution-actions-catalog) + [Part 13](#part-13--audit-trail--escalation-engine) |
| 2026-05-15 | Doc refresh | Doc rewrite. No engine changes. | n/a |
| 2026-05-18 | Cluster 8 ACE Angioedema | New rule `RULE_ACE_ANGIOEDEMA` + compressed ladder (T+0 → T+15m → T+1h → T+4h). Permanent ACE contraindication on resolution (`aceContraindicatedAt`). P0 pilot blocker — Ward 7/8 cohort 5× risk per ALLHAT. Patient T+0 PUSH dispatch. | [Part 8.2](#82-side-effect--interaction-rules-cluster-7-appendix-a-manisha-2026-05-11) + [Part 13](#part-13--audit-trail--escalation-engine) + [Part 14](#part-14--caregiver-dispatch--medication-hold) |
| 2026-05-24 | Medication Workflow + Clarifications | **A1 — HOLD two-path patient message** (`PROVIDER_DIRECTED_HOLD` names the med + persists; administrative holds don't name med + disappear on resolution; patient-safety: rebound-risk fix). A2 — HOLD reason-code enum. A3 — HOLD escalation ladder 7/14/30/45 days. A4 — angioedema rules audit (no-op confirm). A5 — first-month adherence nudge wording + dedup scope. B1 — DBP ≥ SBP validation tier wording. B2 — narrow PP < 25 → physician-only Tier 3. B3 — pre-Day-3 fires Level 1 with disclaimer (spec to match engine). B4 — angioedema structured resolution sub-fields. B5C — Aortic stenosis interim HCM-equivalent (SBP ≥100). | [Part 14.2](#142-medication-hold-action) + [Part 9](#part-9--cluster-6-additions-symptomatic-rules--session-averaging) + [Part 6](#part-6--pre-day-3-mode) + [Part 4.10](#410-aortic-stenosis) + [Part 12.1](#121-tier-1-contraindication--safety-critical--5-actions-all-require-rationale) |
| 2026-05-18 | Cluster 8 Q1–Q3 | Q1 brady HR 40–49 (no symptoms) → fire Tier 3 surveillance. Q2 CAD default `sbpUpperTarget` 160 → 140 phased ramp. Q3 single-miss adherence nudge in first 30 days of new med. Unblocks `test.fixme()` for Nora HR 45 / Paul CAD 145 / Aisha adherence. | [Part 4.3](#43-coronary-artery-disease-cad) + [Part 4.6](#46-bradycardia) + [Part 9](#part-9--cluster-6-additions-symptomatic-rules--session-averaging) + [Part 15](#part-15--open-clinical-questions-pending) Q1–Q3 |
| 2026-06-02 | Manisha Q1–Q7 reply | Q1 A5 nudge hybrid wording. **Q2 P0 safety — revert HFREF_HIGH to single-reading** (session-averaging suppressed clinically meaningful high readings). Q3 no-conditions patients use STANDARD mode. Q4 DHP-CCB + AS → Tier 1 + soft-block (backlog). Q5 Stage 2 axis-specific physician wording. Q6 per-session dedup (backlog). Q7 rename to `historyHDP` phase 1. | [Part 1.2](#12-base-thresholds-for-all-adults-source-2025-ahaacc-guideline) + [Part 4.2](#42-heart-failure--hfref-reduced-ejection-fraction) + [Part 3](#part-3--pregnancy-thresholds) |
| 2026-06-06 | Open Decisions D1–D6 + Backdating | D1 `TIER_3_INFO` teal → info-blue (admin chrome). D2 CAD physician wording reconciled (engine 140/70 stands). D4 gestational age threaded into pregnancy + ACE/ARB physician messages (conditional exception activated — pilot includes pregnant patients). D5 new `TIER_1_CONTRAINDICATION` patient EMAIL at T+0. D6 re-instate `BP_LEVEL_1_HIGH` patient EMAIL at T+0 (cohort-gated: STANDARD + HIGH only). Backdating: 911 CTA suppression on 1–24h delayed entries; L1 provider-only disclaimer; CMS 99454 accept-but-tag. | [Part 3](#part-3--pregnancy-thresholds) + [Part 4.3](#43-coronary-artery-disease-cad) + [Part 14](#part-14--caregiver-dispatch--medication-hold) + [Part 15 Q2](#q2--cad-patient-default-sbpuppertarget--signed-off) |
| 2026-06-07 | Audit trail formalised | Created [`MANISHA_DECISIONS_LOG.md`](./MANISHA_DECISIONS_LOG.md) — canonical per-decision ledger. Archived all signed-off source documents to [`docs/clinical-signoffs/`](./clinical-signoffs/) so the audit trail survives local file loss. | n/a — meta change |

---

## Sign-off history

| Sign-off round | Date | Source artifact | Scope |
|---|---|---|---|
| v1.0 base spec | 2025-XX | `_MConverter.eu_healplace-cardio-clinical-signoff-v1.md` | Parts 1–8 |
| v2.0 addendum | 2025-XX | `_MConverter.eu_healplace-cardio-engineering-addendum-v2.md` | Parts V2-A through V2-F |
| Cluster 6 round 1 (Q1–Q6) | 2026-05-09 | Email + handoff doc `CLAUDE_CODE_CLUSTER_6_MANISHA_DECISIONS.md` | [Part 9](#part-9--cluster-6-additions-symptomatic-rules--session-averaging) |
| Cluster 6 round 2 (Q7–Q11) | 2026-05-10 | Email | [Part 9](#part-9--cluster-6-additions-symptomatic-rules--session-averaging) |
| Cluster 7 / Appendix A + B | 2026-05-11 | [`clinical-signoffs/MANISHA_2026_05_11_MASTER_GUIDE_V3.md`](./clinical-signoffs/MANISHA_2026_05_11_MASTER_GUIDE_V3.md) + [`MANISHA_2026_05_11_APPENDIX_B_TRANSLATIONS.md`](./clinical-signoffs/MANISHA_2026_05_11_APPENDIX_B_TRANSLATIONS.md) | [Part 10](#part-10--cluster-7-additions-side-effect--interaction-rules) |
| Cluster 8 ACE Angioedema | 2026-05-18 | [`clinical-signoffs/MANISHA_2026_05_18_ACE_ANGIOEDEMA_SIGNOFF.md`](./clinical-signoffs/MANISHA_2026_05_18_ACE_ANGIOEDEMA_SIGNOFF.md) | Cross-cutting (Part 8 + Part 13 + Part 14) |
| Cluster 8 Q1–Q3 (Brady + CAD + Adherence) | 2026-05-18 | [`clinical-signoffs/MANISHA_2026_05_18_FOLLOWUP_SIGNOFF_BRADY_CAD_ADHERENCE.md`](./clinical-signoffs/MANISHA_2026_05_18_FOLLOWUP_SIGNOFF_BRADY_CAD_ADHERENCE.md) | [Part 4.3](#43-coronary-artery-disease-cad) + [Part 4.6](#46-bradycardia) + [Part 9](#part-9--cluster-6-additions-symptomatic-rules--session-averaging) + [Part 15](#part-15--open-clinical-questions-pending) Q1–Q3 |
| Medication Workflow + Pending Clarifications | 2026-05-24 | [`clinical-signoffs/MANISHA_2026_05_24_MEDICATION_WORKFLOW_AND_CLARIFICATIONS_SIGNOFF.md`](./clinical-signoffs/MANISHA_2026_05_24_MEDICATION_WORKFLOW_AND_CLARIFICATIONS_SIGNOFF.md) (working source; original Manisha reply not separately archived — see log for context). Prompts: [`MANISHA_2026_05_22_MEDICATION_WORKFLOW_PROMPT.md`](./clinical-signoffs/MANISHA_2026_05_22_MEDICATION_WORKFLOW_PROMPT.md) + [`MANISHA_2026_05_22_PENDING_CLARIFICATIONS_PROMPT.md`](./clinical-signoffs/MANISHA_2026_05_22_PENDING_CLARIFICATIONS_PROMPT.md). | [Part 14.2](#142-medication-hold-action) + [Part 9](#part-9--cluster-6-additions-symptomatic-rules--session-averaging) + [Part 6](#part-6--pre-day-3-mode) + [Part 4.10](#410-aortic-stenosis) |
| Manisha Q1–Q7 reply | 2026-06-02 | [`clinical-signoffs/MANISHA_2026_06_02_REPLY_Q1_TO_Q7.md`](./clinical-signoffs/MANISHA_2026_06_02_REPLY_Q1_TO_Q7.md) | Cross-cutting; Q2 P0 safety on [Part 4.2](#42-heart-failure--hfref-reduced-ejection-fraction) |
| Open Decisions D1–D6 + Backdating | 2026-06-06 | [`clinical-signoffs/MANISHA_2026_06_06_OPEN_DECISIONS_AND_BACKDATING_SIGNOFF.md`](./clinical-signoffs/MANISHA_2026_06_06_OPEN_DECISIONS_AND_BACKDATING_SIGNOFF.md) | [Part 3](#part-3--pregnancy-thresholds) + [Part 4.3](#43-coronary-artery-disease-cad) + [Part 14](#part-14--caregiver-dispatch--medication-hold) + [Part 15 Q2](#q2--cad-patient-default-sbpuppertarget--signed-off) |

> **Full per-decision audit trail:** [`MANISHA_DECISIONS_LOG.md`](./MANISHA_DECISIONS_LOG.md). This table is the high-level index; the log file has the per-decision ledger.

---

## PART 1 — Base System: Age Groupings, Thresholds, Symptom Overrides

### 1.1 Age groupings (3 buckets, not 6)

Engineering proposed six age buckets. Dr. Singal reduced to three. The 2025 AHA/ACC Hypertension Guideline applies identical BP classification thresholds across all adult age groups. Age affects CVD risk estimation and treatment initiation, not alert thresholds.

| Group | Characteristics | Threshold effect |
|---|---|---|
| 18–39 | Lower baseline CVD risk; PREVENT risk calculator not validated below age 30. Lifestyle modification may be trialed 3–6 months before pharmacotherapy in stage 1 HTN. | Standard upper-bound thresholds. Lower-bound uses standard defaults (SBP 90). Dashboard flag: "Lower baseline risk — confirm sustained elevation before escalation." |
| 40–64 | Rising CVD prevalence; PREVENT risk score validated and relevant. Higher likelihood of comorbid conditions. | Standard upper-bound thresholds. System prompts comorbidity-specific threshold logic at onboarding. |
| 65+ | Highest prevalence of isolated systolic hypertension and wide pulse pressure. Greater susceptibility to hypotension and orthostatic drops. Treatment target remains 130/80 but adverse effects of intensive lowering require closer monitoring. | Standard upper-bound thresholds. **Lower-bound sensitivity raised: Level 1 Low fires at SBP < 100 (not 90).** Dashboard flag: "Assess for orthostatic symptoms and fall risk." |

Upper emergency thresholds are **uniform across all age groups** — not age-modified.

**Signed off:** ✅ Three age groups. ✅ 65+ lower bound SBP 100. ✅ Upper-bound thresholds age-invariant.

### 1.2 Base thresholds for all adults (Source: 2025 AHA/ACC Guideline)

| Category | SBP (mmHg) | DBP (mmHg) | Platform Alert Level |
|---|---|---|---|
| Normal | <120 | and <80 | No alert |
| Elevated | 120–129 | and <80 | No alert (informational on dashboard) |
| Stage 1 HTN | 130–139 | or 80–89 | No alert (informational on dashboard) |
| Stage 2 HTN | ≥140 | or ≥90 | Dashboard flag; no push alert |
| Severe Stage 2 | ≥160 | or ≥100 | **Level 1 High** — notify provider |
| Hypertensive Emergency | ≥180 | or ≥120 | **Level 2** — immediate provider notification; prompt symptom assessment |

Clinical note: A true hypertensive emergency requires evidence of acute target organ damage. At the Level 2 threshold, the system prompts the patient for symptom assessment rather than auto-classifying as emergency.

**Reading requirement:** all Level 1 thresholds evaluate against a **session-averaged** SBP/DBP (≥2 readings within the session window). Hypertensive Emergency (Level 2) and the Pregnancy severe range (≥160/110) fire on a **single reading** — see [Part 5](#part-5--session-averaging--bp-fluctuation) for the session-averaging contract.

**Signed off:** ✅ Classification schema. ✅ L1 High at ≥160/100. ✅ L2 at ≥180/120. ✅ Symptom-assessment prompt (not auto-emergency). ✅ Single-reading sufficient for Level 2 / emergency (Manisha 2026-05-09 Q2).

### 1.3 Symptom override — Level 2 at any BP

The following symptoms trigger Level 2 regardless of the BP number. Target organ damage can manifest even below 180/110–120 mmHg.

Level 2 symptom triggers:
- Severe headache unresponsive to analgesics
- Visual changes (blurred vision, scotomata, vision loss)
- Altered mental status or confusion
- Chest pain or acute dyspnea
- Focal neurological deficits (weakness, numbness, speech difficulty)
- Severe epigastric or right upper quadrant pain (especially in pregnant patients — preeclampsia with severe features)

**Pregnancy precedence (Manisha 2026-05-09 Q3):** when a pregnant patient reports RUQ pain alone among the general-override triggers, the pregnancy-specific override fires and the general override is **suppressed**. The suppression is audit-logged for JCAHO compliance. If the pregnant patient also reports another general-override symptom (e.g. focal neuro deficit), both rules fire on distinct axes.

**Signed off:** ✅ Symptom override list. ✅ Triggers symptom-assessment prompt, not auto-emergency. ✅ RUQ pregnancy precedence (Manisha 2026-05-09 Q3).

---

## PART 2 — Gender

**Identical alert thresholds for male and female patients.** No sex-differentiated cutoffs in current guidelines (2025 AHA/ACC). Uniform thresholds for MVP.

**Post-pregnancy risk flag** (approved pending further team discussion): Female patients with documented history of preeclampsia or gestational hypertension get a dashboard notation for enhanced monitoring even outside pregnancy. Implemented as a flag, not a threshold modification.

**Signed off:** ✅ Identical thresholds. ✅ Post-pregnancy flag approved pending implementation feedback.

---

## PART 3 — Pregnancy Thresholds

**Sources:** 2025 AHA/ACC §11.5; CHAP Trial (Tita et al., NEJM 2022); ACOG Practice Bulletin No. 222

Pregnancy thresholds differ fundamentally from general adult thresholds. ACOG defines pregnancy hypertension as SBP ≥140 or DBP ≥90 (not 130/80). Severe hypertension in pregnancy (SBP ≥160 or DBP ≥110) is a medical emergency requiring treatment within 15 minutes.

| Alert Level | Threshold | Reading requirement | Action |
|---|---|---|---|
| Level 1 High | SBP ≥140 or DBP ≥90 | Session-averaged | Notify provider; assess for preeclampsia features |
| Level 2 (Emergency) | SBP ≥160 or DBP ≥110 | **Single reading sufficient** (ACOG severe range — treat within 15 minutes) | Immediate provider notification; treat within 15 minutes |
| Symptom Override | New headache, visual changes, RUQ pain, edema — at any BP | Single reading sufficient | Level 2 trigger — assess for preeclampsia with severe features |

### Medication safety (non-configurable)

- **ACE inhibitors and ARBs are CONTRAINDICATED in pregnancy (teratogenic).** If a pregnant patient's medication record includes these agents, the system must generate an immediate Tier 1 alert.
- Preferred medications: labetalol (beta blocker), long-acting nifedipine (CCB) — per CHAP trial protocol.

### Co-fire: pregnancy + ACE/ARB + SBP ≥160 (Manisha 2026-05-09 Q4)

Two distinct clinical problems → two separate alert rows. The engine emits both the Tier 1 contraindication (`RULE_PREGNANCY_ACE_ARB`) AND the BP Level 2 emergency (`RULE_PREGNANCY_L2`) on the same reading. They are independently resolvable. The patient sees the 911 emergency screen first; the ACE/ARB contraindication surfaces after acknowledgment. See [Part 11](#part-11--multi-axis-co-fire-taxonomy-g1g9--b1) for the multi-axis pipeline.

### Gestational age tracking

**Manual provider flagging** for pregnancy status — patient self-reports `isPregnant` + `pregnancyDueDate` (EDD); provider verifies at onboarding.

**Per Manisha Open-Decisions sign-off 2026-06-06 (Decision 4, conditional exception):** The pilot population includes pregnant patients on ACE/ARB, so **gestational age is now threaded** through the alert engine to the physician-tier message. The engine derives GA from `PatientProfile.pregnancyDueDate` at fire-time using `40 − weeks-until-EDD`, clamps to the 0–45 plausible range, and emits as `metadata.gestationalAgeWeeks` on the rule result. The registry physician messages render it as `(Xw gestation)`. Rules carrying GA:

- `RULE_PREGNANCY_L2` (BP ≥160 / DBP ≥110 in pregnancy)
- `RULE_PREGNANCY_L1_HIGH` (BP ≥140/90 in pregnancy)
- `RULE_PREGNANCY_ACE_ARB` (Tier 1 contraindication — most clinically meaningful because teratogenic ACE/ARB risk differs by trimester)

The other Decision-4 placeholders (`[age]` + `[medication list]`) remain backlog per Manisha — she did not exempt them. See [`MANISHA_DECISIONS_LOG.md → 2026-06-06`](./MANISHA_DECISIONS_LOG.md) for the full decision context.

**Engine implementation:**
- `backend/src/daily_journal/engine/pregnancy-thresholds.ts` — `gestationalAgeWeeksFromProfile(dueDate, now)` shared helper
- `backend/src/daily_journal/engine/contraindications.ts` — `pregnancyAceArbRule` populates `metadata.gestationalAgeWeeks`
- `backend/src/daily_journal/services/output-generator.service.ts` — propagates metadata → `AlertContext`
- `shared/src/alert-messages.ts` — `gestationalAgePhrase(ctx)` helper renders the "(Xw gestation)" suffix

**Safety-net:** pregnancy thresholds + ACE/ARB contraindication activate immediately on patient self-report, before provider verification. UNVERIFIED meds in a pregnant patient's list still fire the contraindication.

**Signed off:** ✅ Pregnancy thresholds (L1 ≥140/90, L2 ≥160/110). ✅ Pregnancy symptom override. ✅ ACE/ARB contraindication non-configurable. ✅ Manual provider flagging for pregnancy status. ✅ Dual-row co-fire on ACE/ARB + SBP ≥160 (Manisha 2026-05-09 Q4). ✅ Gestational-age threading into pregnancy + ACE/ARB physician messages (Manisha 2026-06-06 Decision 4 — conditional exception activated for pilot).

---

## PART 4 — Heart Condition Modifications

**General principle:** For complex cardiac conditions, the provider must set personalised thresholds at onboarding. Standard population thresholds apply only as fallback when no provider configuration exists.

### 4.1 Diagnosed Hypertension (on treatment)

Treatment target per 2025 AHA/ACC: 130/80 mmHg (encourage 120 mmHg systolic in high-risk patients).

| Parameter | Standard Mode | Personalised Mode |
|---|---|---|
| Level 1 High | SBP ≥160 | ≥20 mmHg above provider-set upper target |
| Level 1 Low | SBP <90 | Below provider-set lower target |
| Level 2 | SBP ≥180 or any emergency symptom | Non-configurable |

The "≥20 mmHg above provider-set upper target" is a **platform-specific heuristic**, not from a specific guideline recommendation. Document as such.

**Signed off:** ✅ +20 mmHg personalised heuristic.

### 4.2 Heart Failure — HFrEF (Reduced Ejection Fraction)

Patients are often therapeutically managed at SBP 90–110 on guideline-directed medical therapy. Standard thresholds would generate constant false alerts. 2025 AHA/ACC acknowledges optimal BP goal unknown in HFrEF. OPTIMIZE-HF registry: SBP <130 mmHg associated with worse outcomes in hospitalized HFrEF patients.

| Parameter | Threshold | Notes |
|---|---|---|
| Default Lower Bound | SBP <85 | Applies only if no provider configuration |
| Default Upper Bound | SBP ≥160 | Applies only if no provider configuration |
| Level 2 | SBP ≥180 or any emergency symptom | Non-configurable |

**MANDATORY**: Do not enroll HFrEF patients without provider-configured thresholds. Flag for mandatory configuration before monitoring begins.

**Medication**: Nondihydropyridine CCBs (diltiazem, verapamil) are harmful in HFrEF due to negative inotropic effects — flag if present.

**HF decompensation surveillance** (Cluster 6, Manisha 2026-05-10): HF patients (any HF flag) trigger a Level 1 Low decompensation alert when they report **leg swelling** OR record a **>2 lbs weight gain within 24 hours**. The rule lives on its own clinical axis so it coexists with any HFrEF / HFpEF / DCM SBP rule on the same reading.

**Caregiver ankle edema** (Cluster 7, Manisha 2026-05-11): HF + leg swelling also fires a caregiver-routed Tier 3 row (`RULE_HF_CAREGIVER_EDEMA`) — message asks the caregiver to weigh the patient over the next two days and watch for breathing changes. Dispatch is gated behind `CAREGIVER_DISPATCH_ENABLED=true` until the patient ↔ caregiver relation ships (see [Part 14](#part-14--caregiver-dispatch--medication-hold)).

**Signed off:** ✅ Mandatory provider configuration. ✅ SBP <85 default lower bound fallback. ✅ HF decompensation rule (Manisha 2026-05-10). ✅ Caregiver ankle edema (Manisha 2026-05-11).

### 4.3 Coronary Artery Disease (CAD)

Treatment target: 130/80. **Critical**: coronary perfusion occurs during diastole. Aggressive diastolic lowering causes myocardial ischaemia.

| Parameter | Threshold | Notes |
|---|---|---|
| Level 1 High | SBP ≥140 (default once Cluster 8 Q2 ramp applies; legacy default 160; provider may override) | Standard |
| **CRITICAL Lower Bound** | **DBP <70** | **Applies regardless of systolic value** |
| Level 2 | SBP ≥180 or any emergency symptom | Non-configurable |
| Annotation (physician) | SBP 140–160 (above CAD goal but below CAD high threshold) | "Consider switching antihypertensive class rather than dose reduction." Rides on `RULE_CAD_DBP_CRITICAL` when both fire. |

Evidence: CLARIFY registry (22,672 hypertensive CAD patients) — J-shaped relationship, lowest risk at DBP 70–79, significantly increased risk DBP <70 (HR 1.50, 95% CI 1.31–1.72). AHA/ACC/ASH: "caution in inducing decreases in DBP to <60 mmHg" in CAD patients, particularly >60 years.

**Signed off:** ✅ DBP <70 alert. ✅ SBP 140–160 physician annotation (phase/26 fix). ✅ Cluster 8 Q2 default `sbpUpperTarget` ramp 160 → 140 (Manisha 2026-05-18, reconfirmed Open-Decisions sign-off 2026-06-06). 130/80 is the AHA/ACC treatment target; 140 is the alert threshold — they are distinct by design (firing at 130 would generate high alert volume since >60% of CAD patients with hypertension sit in the 130–139 range). Engine ramp lives in `condition-branches.ts` (`cadDefaultUpper`); see also Cluster 8 Q2 DBP-high default 80.

### 4.4 Atrial Fibrillation (AFib)

BP thresholds follow standard ranges. Primary monitoring shifts to heart rate.

| Parameter | Threshold | Notes |
|---|---|---|
| BP Level 1 | Standard thresholds | Same as Part 1.2 |
| **HR Level 1 High** | **HR >110 bpm** | Rate-uncontrolled AFib; 2023 ACC/AHA lenient rate control |
| **HR Level 1 Low** | **HR <50 bpm** | Clinically significant bradycardia |
| BP Lower Bound | SBP <90 | Standard |
| AFib palpitations | Palpitations + `hasAFib` | Level 1 Low — possible paroxysmal recurrence (Cluster 6, Manisha 2026-05-10) |

**BP measurement accuracy**: Oscillometric monitors provide valid SBP in AF but show small, consistent DBP overestimation. Platform must:
- Flag AFib patient readings with note: "Readings may have higher variability due to irregular rhythm"
- **Require ≥3 readings per session** before generating an alert (the only session-average minimum that is hard-coded above the 2-reading floor in [Part 5](#part-5--session-averaging--bp-fluctuation))

**Signed off:** ✅ HR thresholds (>110 high, <50 low). ✅ Mandate ≥3 readings for AFib patients. ✅ AFib palpitations rule (Manisha 2026-05-10).

### 4.5 Tachycardia (non-AFib)

| Parameter | Threshold | Notes |
|---|---|---|
| HR Alert (sustained) | Resting HR >100 bpm on **≥2 consecutive readings within 8 hours** | Reduces false positives from transient causes (Cluster 6 Q5, Manisha 2026-05-09: window tightened from 24h to 8h) |
| **HR Severe (single-reading)** | **HR >130 bpm on a single reading** | **Tier 2 fires immediately** — no consecutive-reading wait (Cluster 6 Q5, Manisha 2026-05-09) |
| Tachycardia palpitations | Palpitations + HR >100 (no AFib) | Level 1 High — symptomatic tachycardia (Cluster 6, Manisha 2026-05-10) |
| BP Thresholds | Standard | Unless provider configures otherwise |

Tag all readings with HR context on provider dashboard.

**Signed off:** ✅ 8h consecutive-reading window (Manisha 2026-05-09 Q5). ✅ HR>130 single-reading exception. ✅ Tachy palpitations rule.

### 4.6 Bradycardia

| Parameter | Threshold | Tier | Notes |
|---|---|---|---|
| **HR Absolute** | **HR <40 bpm** | **Tier 1 (non-dismissable)** | Cluster 6 (Manisha 2026-05-10) promoted from Tier 2. Gated on `hasBradycardia` OR β-blocker — does not fire on a random reading in a healthy patient. |
| HR Symptomatic | HR 40–49 + any of: altered mental status, chest pain or dyspnea, focal neuro deficit, **dizziness, syncope** | Level 1 Low | Cluster 6 widened the symptom predicate to include the new dizziness + syncope buttons. Gated on `hasBradycardia` OR β-blocker. |
| BP Lower Bound | SBP <90 | Level 1 Low | Elevated hypotension risk |
| **Beta-blocker suppression** | **Do not alert on HR 50–60** | n/a | Therapeutic target; satisfied by the rule threshold structure (no rule fires in 50–60). |
| β-blocker dizziness | Dizziness + SBP <100 + on β-blocker | Tier 3 | Possible drug-induced hypotension (Cluster 6, Manisha 2026-05-10) |
| Orthostatic hypotension | Dizziness + SBP drop ≥15 mmHg from prior reading | Level 1 Low | Cluster 6 (Manisha 2026-05-10) |
| Syncope (general) | Syncope reported + no brady flag + HR ≥50 | Level 1 Low | Syncope is always at least Level 1 (Cluster 6, Manisha 2026-05-10) |

**Open question (Q1 in [Part 15](#part-15--open-clinical-questions-pending)):** HR 40–49 with **no symptoms reported** is intentionally silent today. Pending Manisha sign-off on whether a surveillance row should fire.

**Signed off:** ✅ HR <40 → Tier 1 (Manisha 2026-05-10). ✅ Symptomatic predicate widened to include dizziness + syncope. ✅ β-blocker suppression 50–60. ✅ β-blocker dizziness, orthostatic, syncope rules.

### 4.7 Hypertrophic Cardiomyopathy (HCM)

Dynamic outflow obstruction worsens with low BP and low volume. Aggressive BP lowering is dangerous.

| Parameter | Threshold | Notes |
|---|---|---|
| Lower Bound | SBP <100 | All HCM patients |
| Upper Bound | Standard thresholds (default 160) | Push for provider-configured personalised thresholds |
| Level 2 | SBP ≥180 or any emergency symptom | Non-configurable |

**MANDATORY**: Flag HCM patients for mandatory provider threshold configuration at onboarding.

**Medication safety flag** (approved): Flag HCM patients prescribed pure vasodilators (dihydropyridine CCBs, nitrates) or loop diuretics — these can worsen LVOT obstruction. Aligns with 2024 AHA/ACC HCM guideline.

**Patient-facing wording (Cluster 7 Appendix B1.4, Manisha 2026-05-11):** the `RULE_HCM_LOW` message names the symptoms the patient should watch for — dizziness, lightheadedness, fainting — because HCM is preload-dependent and low BP reduces perfusion. The wording explicitly tells the patient to contact the care team today.

**Signed off:** ✅ SBP <100 lower bound. ✅ Mandatory provider configuration. ✅ Vasodilator/nitrate safety flag. ✅ Preload-dependent patient wording (Manisha 2026-05-11).

### 4.8 Dilated Cardiomyopathy (DCM)

Managed as HFrEF. DCM is the most common cause of HFrEF.

| Parameter | Threshold | Notes |
|---|---|---|
| Default Lower Bound | SBP <85 | Applies only if no provider configuration |
| Upper Bound | Standard thresholds (default 160) | — |
| Level 2 | SBP ≥180 or any emergency symptom | Non-configurable |

Provider-set thresholds required. Same mandatory configuration as HFrEF.

**Resolver behaviour:** when a patient flags DCM alone (no HF flag, no HF type) the profile resolver returns `resolvedHFType=HFREF` so the engine applies HFrEF thresholds. When the patient flags DCM + Heart Failure, the declared HF type is honoured. See `profile-resolver.service.ts` `resolveHFType`.

**Signed off:** ✅ DCM aligned with HFrEF.

### 4.9 Heart Failure — HFpEF (Preserved Ejection Fraction) — added in v2

Different hemodynamic considerations from HFrEF; increasingly prevalent.

| Parameter | Threshold | Notes |
|---|---|---|
| Level 1 Low | SBP <110 | Higher than HFrEF's <85, reflects J-curve data showing increased risk below 120 |
| Level 1 High | SBP ≥160 | Standard |
| Level 2 | SBP ≥180 or any emergency symptom | Non-configurable |
| Medication flag | Flag beta-blockers if prescribed solely for hypertension in HFpEF (not for AF or rate control) | Requires intake-flow capture of indication (see [Part 15](#part-15--open-clinical-questions-pending) gap §3.4). Not currently fired by engine — flag-only, deferred. |

Provider-configured thresholds **recommended but not mandatory** (unlike HFrEF).

**Signed off:** ✅ Add HFpEF-specific logic. ⏳ Beta-blocker-for-HTN-only flag deferred — requires intake change.

### 4.10 Aortic Stenosis

**Deferred to post-MVP.** Severe aortic stenosis shares hemodynamic concerns with HCM (fixed obstruction, preload dependence) but is deferred.

**Signed off:** ✅ Defer to post-MVP.

---

## PART 5 — Session Averaging & BP Fluctuation

**Source:** AHA Home Blood Pressure Monitoring Scientific Statement; 2025 AHA/ACC Guidelines; Cluster 6 Q2 sign-off (Manisha 2026-05-09).

Rule engine must account for physiological variability to avoid false alerts.

### 5.1 Physiological variability

| Factor | Expected Variation | Platform Implication |
|---|---|---|
| Diurnal variation | BP 10–20% lower during sleep (nocturnal dipping) | Account for time-of-day context if readings are timestamped (helper `getReadingContext`, dashboard-consumed) |
| Reading-to-reading variability | 5–10 mmHg between consecutive measurements | Tolerated via averaging within a session window |
| Home vs. office difference | Home readings typically 5–10 mmHg lower than office | Thresholds calibrated for home monitoring |

### 5.2 Session averaging contract (Manisha 2026-05-09 Q2)

The engine groups readings into "sessions" by `JournalEntry.sessionId` (5-minute rolling window). All non-emergency rules evaluate against the **session average** (mean SBP, mean DBP, mean HR), not the single latest reading.

| Alert tier | Reading requirement | Trigger basis |
|---|---|---|
| **Level 2 emergency** (SBP ≥180 OR DBP ≥120 OR any symptom override) | **Single reading sufficient** | Individual reading. Patient-safety override — emergency must not wait for a second reading. |
| **Pregnancy SBP ≥160 OR DBP ≥110** (ACOG severe range) | **Single reading sufficient** | Individual reading (treat within 15 minutes). |
| **Tier 1 contraindications** | Single reading sufficient (medication state + condition flag are not BP-noisy) | Reading event |
| **Level 1 High / Low, Tier 2, Tier 3** | **Minimum 2 readings, ≥1 minute apart** | Session average |
| Single-reading L1 informational | Single reading + threshold cross | Logged with "single-reading session — confirm with next session" annotation. Provider sees the row; no patient push. |
| AFib (existing) | ≥3 readings | Unchanged. |
| Pre-Day-3 mode | 2-reading rule still applies for averaging | Level 1 fires with the standard-threshold disclaimer; emergency (BP Level 2) fires unchanged (Manisha 2026-05-24 Q3 — supersedes the prior "suppress" behavior). See [Part 6](#part-6--pre-day-3-mode). |

**Single-reading finalization endpoint:** if a patient submits one reading and the 5-minute session window expires without a second reading arriving, the engine **finalizes the session as single-reading** (`JournalEntry.singleReadingFinalized=true`). The reading then evaluates against thresholds with the single-reading-informational annotation. This unblocks patients who legitimately took only one reading from being silently dropped.

**Patient prompt:** after the first reading lands, the patient app prompts "Take a second reading in about 1 minute" with a 5-minute timeout. Frontend implementation; see also the related `JournalEntry.medicationScheduledLater` flag for adherence handling.

**Signed off:** ✅ 2-reading minimum for non-emergency. ✅ Single sufficient for L2 / pregnancy severe / Tier 1 contraindications. ✅ AFib ≥3 unchanged. ✅ Single-reading L1 informational annotation. ✅ Single-reading-finalize timeout (Manisha 2026-05-09 Q2).

### 5.3 Time-of-day context

Helper exists; not consumed in rule-firing — purely contextual for dashboard chart rendering. No threshold shift for nocturnal readings.

---

## PART 6 — Pre-Day-3 Mode

For any patient with **fewer than 7 readings**, the system does not present personalized output. It applies fixed AHA thresholds and labels the alert: **"standard threshold — personalization begins after 7 readings."** Protects first-cohort patients from acting on personalised thresholds the system isn't qualified to compute for their specific baseline.

**Note:** the section title's "Day-3" framing is a historical misnomer — the gate is **7 readings**, not 3 days. Engine constant `PRE_DAY_3_MIN_READINGS = 7`.

**Level 1 behavior (Manisha 2026-05-24 Q3 — option a, supersedes prior "suppress"):** Pre-personalization Level 1 alerts **fire** with the standard-threshold disclaimer rather than being suppressed. The earlier "non-emergency suppressed (log only)" rule is retired — a patient in the baseline window who crosses a Level 1 threshold still gets the alert, clearly labelled as standard-threshold. Emergency (BP Level 2) fires unchanged. The disclaimer wording reads "personalization begins after 7 readings" (not "Day 3"), and the provider alert detail surfaces an "X of 7 baseline readings" progress note.

**Signed off:** ✅ Fixed thresholds + personalization disclaimer for first 7 readings. ✅ Level 1 fires with disclaimer (Manisha 2026-05-24 Q3).

---

## PART 7 — Pre-Measurement Checklist

Patient-facing checklist, shown before each reading. Eight items:

1. No caffeine in the last 30 minutes ✅
2. No smoking in the last 30 minutes ✅
3. No exercise in the last 30 minutes ✅
4. Bladder has been emptied ✅
5. Seated quietly for at least 5 minutes ✅
6. Back supported, feet flat, arm supported at heart level ✅
7. Not talking during measurement ✅
8. Cuff placed on bare upper arm (not over clothing) ✅

If any not met → reading tagged as "suboptimal measurement conditions" on provider dashboard, **retained in alert logic** (flag only, not excluded). The `suboptimalMeasurement` flag propagates through every `DeviationAlert` row and appends a suffix to physician messages.

**Signed off:** ✅ Checklist items. ✅ Flag only (retain in alert logic).

---

## PART 8 — Medication Class Alert Logic

Full drug interaction mapping deferred. MVP covers the four highest-risk linkages from v1, plus the Cluster 7 side-effect / interaction rules.

### 8.1 v1 MVP linkages (4)

| Priority | Medication Class | Trigger | Alert Type |
|---|---|---|---|
| 1 | ACE inhibitors / ARBs | Patient flagged as pregnant (any verification status, including UNVERIFIED) | **Immediate contraindication alert — teratogenic; non-configurable (Tier 1)** |
| 2 | Beta-blockers | HR 50–60 bpm | **Suppress HR alert** — therapeutic target; alert only at HR <50 (with symptoms) or HR <40 (always) |
| 3 | Loop diuretics | **SBP <90 (strict)** — Cluster 6 Q1 (Manisha 2026-05-09): dropped the 90–92 "trending low" band; home monitor tolerance is ±3–5 mmHg so 90–92 falls within measurement noise. Tier 3 physician note. **Suppressed for HF patients** — HFrEF / HFpEF / DCM rules already cover hypotension on their own thresholds. | Tier 3 |
| 4 | Nondihydropyridine CCBs (diltiazem, verapamil) | Patient flagged as HFrEF (only fires on VERIFIED meds — UNVERIFIED meds + HFrEF do NOT fire this contraindication, unlike pregnancy ACE/ARB) | **Contraindication alert — negative inotropic; harmful in HFrEF (Tier 1)** |

**Signed off:** ✅ Four linkages as MVP scope. ✅ ACE/ARB + pregnancy non-configurable. ✅ Loop-diuretic strict <90 (Manisha 2026-05-09 Q1).

### 8.2 Side-effect + interaction rules (Cluster 7 Appendix A, Manisha 2026-05-11)

| Rule | Trigger | Tier | Notes |
|---|---|---|---|
| `RULE_BETA_BLOCKER_FATIGUE` | Patient on any β-blocker + reports `fatigue` symptom | **Tier 3** | Common dose-dependent side effect. Patient-facing reassurance + "contact care team if limiting." |
| `RULE_BETA_BLOCKER_SOB_HF` | β-blocker + `hasHeartFailure` (or `resolvedHFType` ∈ {HFREF, HFPEF}) + reports `shortnessOfBreath` | **Tier 2 — escalates** | Decompensation risk. Physician notified via Tier 2 ladder. Patient told to contact care team today + 911 if worsening at rest. |
| `RULE_BETA_BLOCKER_SOB_NON_HF` | β-blocker (no HF) + reports `shortnessOfBreath` | Tier 3 | Possible bronchospasm or exercise intolerance side-effect. Patient told to mention at next visit. |
| `RULE_NSAID_ANTIHTN_INTERACTION` | Patient reports `nsaidUse` (per-reading checkbox) OR has chronic NSAID in med list + any antihypertensive in med list | Tier 3 | Generic single message — no ACE/ARB/diuretic differentiation. Recommends acetaminophen alternative. Antihypertensive class set: `ACE_INHIBITOR`, `ARB`, `BETA_BLOCKER`, `DHP_CCB`, `NDHP_CCB`, `LOOP_DIURETIC`, `THIAZIDE`, `MRA`, `ARNI`. |
| `RULE_ACE_COUGH` | Patient on ACE inhibitor + reports `dryCough` | Tier 3 | Bradykinin-mediated; mentions ARB switch option. |
| `RULE_HF_CAREGIVER_EDEMA` | HF patient + reports `legSwelling` | Tier 3, **caregiver-routed** | Asks caregiver to weigh patient over next 2 days + watch for breathing changes. Fires alongside `RULE_HF_DECOMPENSATION` on the same reading (different axes). Dispatch gated behind `CAREGIVER_DISPATCH_ENABLED=true` — see [Part 14](#part-14--caregiver-dispatch--medication-hold). |

**New JournalEntry symptom flags** (Cluster 7 schema migration `20260514120000`): `fatigue`, `shortnessOfBreath`, `dryCough`, `nsaidUse`. All `Boolean DEFAULT false`. Patient self-reports via the symptom-checkbox panel on the daily journal entry form.

**New DrugClass enum value:** `NSAID` (ibuprofen, naproxen, celecoxib). Patient self-reports chronic NSAID use as a separate medication; the per-reading `nsaidUse` flag captures acute use ("took an Advil this morning").

**Signed off:** ✅ All six rules — Manisha 2026-05-11.

### 8.3 NDHP-CCB + HFrEF verification gate

The NDHP-CCB + HFrEF contraindication only fires on **VERIFIED** medications. UNVERIFIED meds in an HFrEF patient's list do NOT fire this rule — the verification flag is the safety gate.

Pregnancy ACE/ARB is the opposite: fires on **any** verification status (including UNVERIFIED), because pregnancy + ACE/ARB is so dangerous that we'd rather false-positive than wait for provider verification.

---

## PART 9 — Cluster 6 Additions: Symptomatic Rules + Session Averaging

This section consolidates Cluster 6 sign-off (Manisha 2026-05-09 + 2026-05-10). Individual rules also surface in their natural homes (Parts 1, 4, 5, 7, 8, 12).

### 9.1 Manisha 2026-05-09 (Q1–Q6)

| Q | Decision | Lives in |
|---|---|---|
| Q1 | Loop diuretic Tier 3 strict SBP <90 — drop 90–92 band; HF takes precedence. | [Part 8.1](#81-v1-mvp-linkages-4) |
| Q2 | Session averaging: 2 readings minimum for non-emergency, single sufficient for Level 2 + pregnancy severe. Single-reading-informational annotation for L1 threshold cross at single reading. | [Part 5.2](#52-session-averaging-contract-manisha-2026-05-09-q2) |
| Q3 | RUQ pain: pregnancy override fires alone, general override suppressed (audit-logged). Edge case: pregnant patient with RUQ + non-RUQ symptom → both fire on distinct axes. | [Part 1.3](#13-symptom-override--level-2-at-any-bp) |
| Q4 | Pregnancy + ACE + SBP ≥160 → keep both alert rows (independently resolvable). | [Part 3](#part-3--pregnancy-thresholds) |
| Q5 | Tachycardia: 8-hour consecutive-reading window (was 24h) + HR >130 single-reading Tier 2 exception. | [Part 4.5](#45-tachycardia-non-afib) |
| Q6 | Pregnancy patient wording: plain-language wording final; remove in-code TODO. | Patient message registry (`shared/src/alert-messages.ts`) |

### 9.2 Manisha 2026-05-10 (symptom buttons + brady absolute + adherence + HF decompensation)

| Decision | Description | Lives in |
|---|---|---|
| HR <40 → Tier 1 | Promoted from Tier 2. Non-dismissable. Gated on `hasBradycardia` OR on β-blocker. | [Part 4.6](#46-bradycardia) |
| 4 new symptom buttons | `dizziness`, `syncope`, `palpitations`, `legSwelling` added to JournalEntry. Patient self-reports via daily journal entry. | Schema (`backend/prisma/schema/daily_journal.prisma`) |
| Brady-symptomatic predicate widened | `bradySymptomaticRule` now fires on HR 40–49 + (`alteredMentalStatus` ∥ `chestPainOrDyspnea` ∥ `focalNeuroDeficit` ∥ `dizziness` ∥ `syncope`). | [Part 4.6](#46-bradycardia) |
| Orthostatic hypotension | Dizziness + SBP drop ≥15 mmHg from prior reading → Level 1 Low. | [Part 4.6](#46-bradycardia) |
| β-blocker dizziness | Dizziness + SBP <100 + on β-blocker → Tier 3 (possible drug-induced hypotension). | [Part 4.6](#46-bradycardia) |
| AFib palpitations | Palpitations + `hasAFib` → Level 1 Low (possible paroxysmal recurrence). | [Part 4.4](#44-atrial-fibrillation-afib) |
| Tachy palpitations | Palpitations + HR >100 + no AFib → Level 1 High (symptomatic tachycardia). | [Part 4.5](#45-tachycardia-non-afib) |
| Palpitations general | Palpitations + HR ≤100 + no AFib → Tier 3 ("consider monitor"). | [Part 4.5](#45-tachycardia-non-afib) |
| Syncope general | Syncope + no brady flag + HR ≥50 → Level 1 Low (syncope is always at least L1). | [Part 4.6](#46-bradycardia) |
| HF decompensation | HF patient + (`legSwelling` ∥ weight gain >2 lbs/24h) → Level 1 Low on its own axis. Coexists with HFREF/HFPEF/DCM SBP rules. | [Part 4.2](#42-heart-failure--hfref-reduced-ejection-fraction) |
| DHP-CCB peripheral edema | Non-HF patient + `legSwelling` + on DHP-CCB → Tier 3. Suppressed for HF patients (decompensation rule owns the patient-visible message). | [Part 8.1](#81-v1-mvp-linkages-4) |
| Adherence rolling window | Default trigger: ≥2 missed-medication-days within rolling 3 days → Tier 2 yellow badge. Escalates to provider push at 3-of-7 days. **β-blocker single-miss carve-out:** patient with `hasHeartFailure` ∥ `hasHCM` ∥ `hasAFib` AND a single β-blocker miss → fires immediately (rebound tachycardia / hypertensive risk per 2018 ACC/AHA bradycardia + AHA HTN scientific statements). | [Part 12](#part-12--resolution-actions-catalog) (Tier 2 ladder) |
| Bug #11 — deadlock retry | EscalationService T+0 dispatch + AlertEngineService.evaluate wrapped in `$transaction(…, { isolationLevel: 'Serializable' })` with retry on `P2034`/`40P01`. Fixes silent rollback on Prisma Cloud DB concurrency — alerts the engine should fire were getting silently dropped during deadlocks. | Engine infrastructure |

### 9.3 Cluster 6 rule IDs

Eight new entries in `shared/src/rule-ids.ts`:

- `BRADY_ABSOLUTE` (Tier 1)
- `HF_DECOMPENSATION` (BP_LEVEL_1_LOW)
- `DHP_CCB_LEG_SWELLING` (TIER_3_INFO)
- `BETA_BLOCKER_DIZZINESS` (TIER_3_INFO)
- `ORTHOSTATIC_HYPOTENSION` (BP_LEVEL_1_LOW)
- `AFIB_PALPITATIONS` (BP_LEVEL_1_LOW)
- `TACHY_WITH_PALPITATIONS` (BP_LEVEL_1_HIGH)
- `PALPITATIONS_GENERAL` (TIER_3_INFO)
- `SYNCOPE_GENERAL` (BP_LEVEL_1_LOW)
- `MEDICATION_MISSED` (TIER_2_DISCREPANCY) was already present, message + rolling-window logic Cluster 6.

---

## PART 10 — Cluster 7 Additions: Side-Effect + Interaction Rules

This section consolidates Cluster 7 sign-off (Manisha 2026-05-11, Appendix A + B). Engine implementation lands via the `nivakaran-dev` branch (commits `b7a644c` schema → `6162a56` tests). Individual rules also surface in their natural homes (Parts 4, 8, 14).

### 10.1 Six new rules

See [Part 8.2](#82-side-effect--interaction-rules-cluster-7-appendix-a-manisha-2026-05-11) for the full rule table. Summary:

| Rule | Tier |
|---|---|
| `RULE_BETA_BLOCKER_FATIGUE` | Tier 3 |
| `RULE_BETA_BLOCKER_SOB_HF` | Tier 2 — **escalates** |
| `RULE_BETA_BLOCKER_SOB_NON_HF` | Tier 3 |
| `RULE_NSAID_ANTIHTN_INTERACTION` | Tier 3 |
| `RULE_ACE_COUGH` | Tier 3 |
| `RULE_HF_CAREGIVER_EDEMA` | Tier 3 (caregiver-routed) |

### 10.2 HCM low BP wording revision (Appendix B1.4)

The existing `RULE_HCM_LOW` patient + caregiver + physician messages are revised to explicitly name preload-dependence and the symptoms to watch for (dizziness, lightheadedness, fainting). No new rule — message-only delta in `shared/src/alert-messages.ts`. See [Part 4.7](#47-hypertrophic-cardiomyopathy-hcm).

### 10.3 Medication HOLD verification status (Appendix A.7 / B1.7)

See [Part 14.2](#142-medication-hold-action).

### 10.4 Schema additions

`backend/prisma/migrations/20260514120000_cluster_7_appendix_a_inputs`:

- `JournalEntry.fatigue` BOOLEAN DEFAULT false
- `JournalEntry.shortnessOfBreath` BOOLEAN DEFAULT false
- `JournalEntry.dryCough` BOOLEAN DEFAULT false
- `JournalEntry.nsaidUse` BOOLEAN DEFAULT false
- `DrugClass` enum: `NSAID` added
- `MedicationVerificationStatus` enum: `HOLD` added

`CAREGIVER` is added to the TypeScript `RecipientRole` union in `backend/src/daily_journal/escalation/ladder-defs.ts` — **no DB enum change** for `UserRole` (caregivers route via `EscalationEvent.recipientRoles: String[]`).

---

## PART 11 — Multi-Axis Co-Fire Taxonomy (G1–G9 + B1)

**Source:** Niva multi-axis fix (2026-05-08), `axis-pipeline.spec.ts`.

A single reading can fire **multiple** `DeviationAlert` rows when they sit on distinct clinical axes. Each row starts its own ladder and resolves independently. The pipeline runs in three stages with an axis-keyed Map:

| Stage | Axes claimed | Rules |
|---|---|---|
| A — pre-gate | `contraindication`, `emergency` | Tier 1 contraindications (PREGNANCY_ACE_ARB, NDHP_HFREF, BRADY_ABSOLUTE) + symptom overrides (SYMPTOM_OVERRIDE_PREGNANCY, SYMPTOM_OVERRIDE_GENERAL) + RULE_ABSOLUTE_EMERGENCY |
| B — pregnancy emergency | `emergency` | RULE_PREGNANCY_L2 (independent of Stage A symptom override) |
| C — condition / standard / HR / info | `bp-high`, `sbp-low`, `dbp-low`, `hr`, `info` | All BP / HR / Tier 3 rules — first to claim each axis wins |

### Documented co-fire pairings

| Pair | Trigger | Why both |
|---|---|---|
| G1 — Loop diuretic + age 65+ | Loop diuretic on med list + SBP 89 + age ≥65 | Tier 3 loop-diuretic Tier 3 AND age-65 L1 Low fire on different axes. (After Cluster 6 Q1: loop-diuretic only fires <90, so 89 is the band where both apply.) |
| G2 — Pulse pressure wide + condition rule | PP >60 alongside a condition-axis rule firing | Pulse-pressure annotation rides as physician note on the dominant alert; if nothing else fires, surfaces as standalone Tier 3 row. |
| G3 — Pre-Day-3 + session averaging | Single reading + threshold cross in pre-Day-3 | Single-reading-informational row + Pre-Day-3 disclaimer ride on the same alert. |
| G4 — Adherence + BP rule | 2-of-3-day adherence pattern + same-reading L1 alert | Tier 2 adherence + L1 BP fire on different axes (adherence runs in Pass 2). |
| G5 — HFpEF DBP 95 | HFpEF Stage 2 DBP elevation | HFPEF_HIGH fires on bp-high axis; no other rule preempts. |
| G6 — CAD + age 65+ | CAD patient, age ≥65, SBP 145 | Currently silent — see Q2 in [Part 15](#part-15--open-clinical-questions-pending). |
| G7 — NDHP-CCB + HFREF_LOW | HFrEF patient on diltiazem + SBP <85 | NDHP_HFREF Tier 1 + HFREF_LOW L1 fire on different axes. |
| G8 — HCM low + DHP-CCB | HCM patient on amlodipine + SBP <100 | HCM_LOW L1 + HCM_VASODILATOR Tier 3 fire on different axes. |
| G9 — Pregnancy ACE + L2 | Pregnant on lisinopril at SBP 165 | PREGNANCY_ACE_ARB Tier 1 + PREGNANCY_L2 BP L2 fire on different axes. **Pre-niva-fix only Tier 1 fired and the patient never got the 911 message.** |
| B1 — RUQ pain (non-pregnant) | Non-pregnant patient + RUQ pain | SYMPTOM_OVERRIDE_GENERAL fires (RUQ included in general symptom list per §1.3). Pre-fix: only pregnant patients triggered any RUQ rule. |
| HF decompensation + HF caregiver edema | HF patient + leg swelling | RULE_HF_DECOMPENSATION (BP_LEVEL_1_LOW, physician) + RULE_HF_CAREGIVER_EDEMA (Tier 3, caregiver) fire on different axes (Cluster 7). |
| Brady-AMS co-fire | HR <40 + altered mental status | BRADY_ABSOLUTE Tier 1 (contraindication axis) + SYMPTOM_OVERRIDE_GENERAL BP L2 (emergency axis) fire on different axes (Cluster 6). |

**Axis claim rule:** within each axis, the first rule to return non-null wins. Subsequent rules on the same axis return null. Tests cover all 11 pairings in `backend/src/daily_journal/services/axis-pipeline.spec.ts`.

---

## PART 12 — Resolution Actions Catalog

**Source:** `backend/src/daily_journal/escalation/resolution-actions.ts` — derived from CLINICAL_SPEC v2.0 §V2-D resolution tables.

Every alert requires an admin-selected resolution action before it can be marked RESOLVED. The closed catalog below is enforced by the resolve endpoint.

### 12.1 Tier 1 (Contraindication / safety-critical) — 5 actions, all require rationale

| Action | Label |
|---|---|
| `TIER1_DISCONTINUED` | Confirmed — medication discontinued / will contact patient |
| `TIER1_CHANGE_ORDERED` | Confirmed — medication change ordered |
| `TIER1_FALSE_POSITIVE` | False positive — patient is not [condition] / medication incorrect |
| `TIER1_ACKNOWLEDGED` | Acknowledged — provider aware, clinical rationale documented |
| `TIER1_DEFERRED` | Deferred to in-person visit |

### 12.2 Tier 2 (Discrepancy / non-adherence) — 5 actions

Rationale required only for `TIER2_REVIEWED_NO_ACTION` (the "no action" outlier).

| Action | Label | Rationale required? |
|---|---|---|
| `TIER2_REVIEWED_NO_ACTION` | Reviewed — no action needed | ✅ |
| `TIER2_WILL_CONTACT` | Will contact patient to discuss | — |
| `TIER2_CHANGE_ORDERED` | Medication change ordered | — |
| `TIER2_PHARMACY_RECONCILE` | Referred to pharmacy for reconciliation | — |
| `TIER2_DEFERRED` | Deferred to next scheduled visit | — |

### 12.3 BP Level 2 (Emergency) — 6 actions, all require rationale

| Action | Label | Special behaviour |
|---|---|---|
| `BP_L2_CONTACTED_MED_ADJUSTED` | Patient contacted — medication adjusted | — |
| `BP_L2_CONTACTED_ADVISED_ED` | Patient contacted — advised to go to ED | — |
| `BP_L2_CONTACTED_RECHECK` | Patient contacted — BP re-check requested | — |
| `BP_L2_SEEN_IN_OFFICE` | Patient seen in office — management updated | — |
| `BP_L2_REVIEWED_TRENDING_DOWN` | Reviewed — BP trending down, no immediate action | — |
| `BP_L2_UNABLE_TO_REACH_RETRY` | Unable to reach patient — will retry | **Leaves alert OPEN.** Schedules fresh T+4h `EscalationEvent` with `triggeredByResolution=true` — cron dispatches primary + backup again at the retry time. |

### 12.4 No automatic resolution

The auto-resolve sweep (`resolveOpenAlerts` function previously at `alert-engine.service.ts:572-587`) is **deleted** (2026-05-13). A clean reading no longer silently resolves prior alerts. Alerts stay OPEN until:

1. Provider explicitly resolves via the admin endpoint (with a resolution action + rationale per the catalog above), OR
2. Patient acknowledges (sets `acknowledgedAt` + `acknowledgedByUserId`).

The auto-resolve removal closes a JCAHO gap: pre-fix, automatic resolution wrote NULL into `resolutionAction` + `resolutionRationale`, breaking the 15-field audit trail.

---

## PART 13 — Audit Trail + Escalation Engine

### 13.1 JCAHO 15-field audit trail

Every alert row carries the full 15 fields (NPSG.03.06.01). Schema mapping:

| # | Field | Column |
|---|---|---|
| 1 | Alert ID | `DeviationAlert.id` |
| 2 | Alert type (Tier 1 / Tier 2 / BP Level 2) | `DeviationAlert.tier` |
| 3 | Alert trigger | `DeviationAlert.ruleId` |
| 4 | Patient ID | `DeviationAlert.userId` |
| 5 | Alert generation timestamp | `DeviationAlert.createdAt` |
| 6 | Escalation level | `EscalationEvent.escalationLevel` (joined rows) |
| 7 | Escalation timestamp | `EscalationEvent.triggeredAt` per row |
| 8 | Recipients notified | `EscalationEvent.recipientRoles` + `recipientIds` |
| 9 | Acknowledgment timestamp | `DeviationAlert.acknowledgedAt` (Cluster 6 schema addition) |
| 10 | Resolution timestamp | `DeviationAlert.resolvedAt` (Cluster 6 schema addition) |
| 11 | Time to acknowledgment | Derived: `acknowledgedAt − createdAt` |
| 12 | Time to resolution | Derived: `resolvedAt − createdAt` |
| 13 | Escalation triggered? (Y/N) | `DeviationAlert.escalated` boolean |
| 14 | Resolution action (catalog) | `DeviationAlert.resolutionAction` |
| 15 | Resolution rationale | `DeviationAlert.resolutionRationale` |

**Additional audit columns added Cluster 6:**

- `acknowledgedByUserId` — who acknowledged (patient or provider user ID)
- `updatedAt` — Prisma `@updatedAt` for change tracking

**Patient ack propagation:** when the patient acknowledges via the patient app, `DeviationAlert.acknowledgedAt` + `acknowledgedByUserId` are written, AND the corresponding `EscalationEvent` rows pick up `acknowledgedAt` + `acknowledgedBy` to halt the ladder.

### 13.2 Escalation ladders

Source: `backend/src/daily_journal/escalation/ladder-defs.ts`. Four ladder kinds:

#### Tier 1 (Contraindication / non-BP safety-critical)

| Step | Offset | Recipients | Channels | After-hours |
|---|---|---|---|---|
| T+0 | 0 | Primary provider | PUSH, EMAIL, DASHBOARD | Queue until business hours (BACKUP gets immediate push as safety net) |
| T+4h | 4h | Primary + Backup | PUSH | Queue |
| T+8h | 8h | Medical director | PUSH, DASHBOARD | Queue (animated red banner) |
| T+24h | 24h | Healplace ops | PUSH, PHONE | Queue |
| T+48h | 48h | Healplace ops (formal incident report) | DASHBOARD | Queue |

#### Tier 2 (Discrepancy / non-adherence)

| Step | Offset | Recipients | Channels | After-hours |
|---|---|---|---|---|
| T+0 | 0 | Primary provider | DASHBOARD (badge only) | Queue |
| TIER2_48H | 48h | Primary provider | PUSH, DASHBOARD (yellow banner) | Queue |
| TIER2_7D | 7d | Backup | DASHBOARD | Queue |
| TIER2_14D | 14d | Healplace ops | DASHBOARD | Queue |

#### BP Level 1 (non-emergent stage-2 HTN / hypotension)

| Step | Offset | Recipients | Channels | After-hours |
|---|---|---|---|---|
| T+0 | 0 | Primary provider | EMAIL, DASHBOARD | Queue |
| T+0 (patient) | 0 | Patient | PUSH, DASHBOARD | **Fire immediately** (informational — patient doesn't have to open the app) |
| T+24h | 24h | Primary + Backup | PUSH, EMAIL, DASHBOARD | Queue |
| T+72h | 72h | Medical director | EMAIL, DASHBOARD | Queue |
| T+7D | 7d | Healplace ops | DASHBOARD | Queue |

#### BP Level 2 (Emergency)

Two ladder variants depending on whether symptoms were reported:

**BP_LEVEL_2_LADDER** (absolute emergency, no symptoms):

| Step | Offset | Recipients | Channels | After-hours |
|---|---|---|---|---|
| T+0 | 0 | Primary + Backup + Patient | PUSH, EMAIL, DASHBOARD | **Fire immediately** |
| T+2h | 2h | Medical director | PUSH | **Fire immediately** |
| T+4h | 4h | Healplace ops | PUSH, PHONE | **Fire immediately** |

**BP_LEVEL_2_SYMPTOM_OVERRIDE_LADDER** (symptoms reported):

T+0 and T+4h identical to above. T+2h adds PATIENT as a recipient with a follow-up message: "Have you called 911?"

### 13.3 After-hours handling

| Tier | After-hours behavior |
|---|---|
| Tier 1 | Queue for first business day. T+0 BACKUP gets immediate push as safety net. Escalation clock starts next business day. |
| **BP Level 2** | **EXCEPTION — fires immediately. Patient emergency message fires. Provider + backup notified simultaneously. Clock starts immediately.** |
| Tier 2 | Queue for next business day. No after-hours notification. |
| BP Level 1 | Primary's ladder queues. Patient T+0 row fires immediately (informational push). |

### 13.4 Practice-level configuration — required before enrollment

**MANDATORY:**
- Primary provider per patient (cannot enroll without)
- Practice-level backup (cannot activate Tier 1 without)
- Medical director / supervising physician (cannot activate escalation without)
- After-hours protocol (mandatory for HF/HCM practices)

**OPTIONAL (with defaults):**
- Notification preferences → Default: push + email for Tier 1; push only for BP Level 2
- Business hours → Default: Mon–Fri, 8 AM – 6 PM local

### 13.5 Monthly analytics report (per practice)

Total alerts by tier, % acknowledged within target window, % requiring escalation, mean time to acknowledgment/resolution, alerts resolved without action + documentation rate, alerts reaching Healplace ops, provider-level volume (flag overload).

---

## PART 14 — Caregiver Dispatch + Medication Hold

Cluster 7 additions (Manisha 2026-05-11).

### 14.1 Caregiver dispatch

**Architecture:** when a caregiver-routed rule fires (today only `RULE_HF_CAREGIVER_EDEMA`), the engine writes a `DASHBOARD` `Notification` row to every caregiver linked to the patient. Tier 3 rules have no escalation ladder; this notification is their only delivery channel.

**Routing rule list** (in `EscalationService`):

```
CAREGIVER_ROUTED_RULES = { 'RULE_HF_CAREGIVER_EDEMA' }
```

**Gating:** dispatch is suppressed unless `CAREGIVER_DISPATCH_ENABLED=true`. Default OFF. Production stays silent until Lakshitha's Gap 5 ships the `PatientCaregiver` relation + admin UI.

**Recipient role:** `CAREGIVER` is added to the TypeScript `RecipientRole` union (`ladder-defs.ts`). No DB enum change — `EscalationEvent.recipientRoles` is `String[]` so the value flows through opaquely. `UserRole` is unchanged.

### 14.2 Medication HOLD action

**Trigger:** admin marks a `PatientMedication` as `HOLD` via the admin app (with a required rationale for the audit log). On submit, the engine writes a `DASHBOARD` `Notification` to the patient's inbox with the `systemMsgMedicationHold(drugName)` body.

**Patient message** (Appendix B1.7, abridged):
> "Your care team has placed [drug] on hold while they review it. This means you should NOT take [drug] until they tell you it is safe to restart. If you have questions, call your care team. If you feel unwell after recently taking it — chest pain, severe weakness, fainting — call 911."

**Schema:** `MedicationVerificationStatus.HOLD` added to the enum. Admin requires a rationale to set HOLD (parallel to REJECT). Notification dispatch failures are logged but do not roll back the status change — the medication is held regardless of whether the notification landed.

**Adherence interaction:** medications in HOLD state are excluded from the adherence-rule's miss count (the patient is correctly NOT taking the held med).

---

## PART 15 — Clinical Questions Ledger

Historical record of questions that were once pending Manisha sign-off. All three questions in this section have now been signed off (2026-05-18 + 2026-06-06). Kept here as an audit aid — `git blame` + the entries below show when each was answered. New open questions live in [`MANISHA_DECISIONS_LOG.md`](./MANISHA_DECISIONS_LOG.md) → "Pending — Open Decisions Not Yet Sent."

### Q1 — Asymptomatic bradycardia in HR 40–49 (no symptoms reported) ✅ SIGNED OFF

**Sign-off:** Manisha 2026-05-18 (Cluster 8 Q1, brady portion of the follow-up sign-off doc).

**Decision:** Fire a **Tier 3 surveillance row** for HR 40–49 with no symptoms. Rationale (from sign-off doc): the 2018 ACC/AHA/HRS Bradycardia Guideline adopted HR 50 bpm (not 60) as the threshold for clinically relevant bradycardia. In a remote-monitoring platform for cardiovascular patients on rate-controlling medications, sustained HR 40–49 is clinically meaningful — the MESA study found HR <50 bpm was associated with markedly elevated mortality (over 2× the 60–69 reference range) among patients taking HR-modifying drugs.

**Engine implementation:** `backend/src/daily_journal/engine/hr-branches.ts` — `bradySurveillanceRule` fires when HR 40–49 with no symptom flags and the patient is on an HR-modifying medication OR has `hasBradycardia=true`. Counts consecutive sessions for the brady-surveillance escalation (Cluster 8 Q1).

**Test status:** `qa/tests/09:800` (Nora HR 45) unblocked.

### Q2 — CAD patient default `sbpUpperTarget` ✅ SIGNED OFF

**Sign-off:** Manisha 2026-05-18 (Cluster 8), reconfirmed Open-Decisions sign-off 2026-06-06 (Decision 2).

**Decision:** Default `sbpUpperTarget` = **140** (Stage 2 HTN floor) once the phased ramp applies. AHA/ACC treatment target 130/80 is preserved as the *treatment goal* surfaced in the physician-tier message, but the *alert threshold* is 140 — firing at 130 would generate high alert volume in a population where >60% of patients already sit in the 130–139 range.

**Engine implementation:** `backend/src/daily_journal/engine/condition-branches.ts` — `cadDefaultUpper` returns 140 when `cadRampApplies(ctx)` is true (Phase 1 = newly enrolled at/after 2026-05-18; Phase 2 = + Cedar Hill existing patients; Phase 3 = all CAD patients). Provider-set custom `PatientThreshold.sbpUpperTarget` always wins. Companion CAD DBP-high default = 80 ramps with the same gate.

**Test status:** `qa/tests/09:916` (Paul CAD 145) — unblock + assert the engine fires `RULE_CAD_HIGH` with `thresholdValue = 140` once the ramp applies for this patient.

### Q3 — Single-miss adherence threshold ✅ SIGNED OFF

**Sign-off:** Manisha 2026-05-18 (Cluster 8 Q3, adherence portion of the follow-up sign-off doc).

**Decision:** Fire `RULE_FIRST_MONTH_ADHERENCE_NUDGE` (Tier 3 educational) on a **single missed dose** within the first 30 days of any new medication. Per-event dedup: fires once per first-missed-dose event in the new-med window, even if multiple same-day missed-med check-ins are submitted (see memory note `reference_first_month_nudge_dedup`). The 2-of-3-day rolling window stays the default for steady-state adherence drift; the new-med window is the carve-out.

**Engine implementation:** `backend/src/daily_journal/engine/adherence.ts` — first-month nudge path; β-blocker single-miss carve-out for HFrEF / HCM / AFib (from Cluster 6 round 2) is unchanged.

**Test status:** Aisha adherence `test.fixme()` unblocked.

---

## PART 16 — v2.0 Addendum: Onboarding, Medication, Dashboard, Escalation

*Sections V2-A through V2-F. Largely unchanged from v2.0 sign-off; engine implementation details now folded into Parts 9–14.*

### V2-A. Patient Self-Report Onboarding — "Trust Then Verify"

**Core decision:** Patients self-report at enrollment. System immediately activates appropriate threshold set. Provider verification follows within 48–72 hours. **System does not wait for admin entry.**

#### Why (safety rationale)
Without immediate activation, a pregnant patient would be monitored at SBP ≥160 instead of pregnancy-appropriate ≥140 — missing a 20 mmHg window where preeclampsia intervention is critical. An HFrEF patient on GDMT with SBP 95 would trigger constant false-low-BP alerts.

#### Evidence
- Pregnancy status: ≥87% agreement with medical records
- Cardiac diagnoses (HF, CAD, AFib): Good concordance
- Medications: ≥95% sensitivity/specificity/PPV vs. pharmacy records; κ=0.90 agreement with national prescribing data

#### Flow
**Step 1 — Patient intake (immediate):**
- Pregnancy status: Yes / No / Not applicable
- Cardiac conditions: checkboxes (Heart Failure, AFib, CAD, HCM, DCM, None)
- HF type if applicable: HFrEF / HFpEF / Not sure
- Medications: visual card selection (see V2-B)
→ System immediately applies appropriate thresholds

**Step 2 — Provider verification (48–72h):**
- Provider reviews intake against medical records
- Confirms or corrects clinical profile
- Corrections trigger automatic threshold update
- Discrepancies logged for quality tracking

**Step 3 — Safety-net logic (until verification complete):**
- Apply the **more conservative threshold** when ambiguous
- "Heart failure, type unknown" → apply HFrEF defaults (lower bound SBP <85)
- "Pregnant" → immediately activate pregnancy thresholds + ACE/ARB contraindication check (even on UNVERIFIED meds)
- Dashboard shows "Awaiting Provider Verification" badge on unverified profiles

### V2-B. Medication Intake — Selection-First, Free-Text-Last

**Patient is primary source.** Clinical question: "what is actually being taken," not "what was prescribed." Evidence: 30% of prescribed meds not in blood; 23% of detected meds not in the medical record.

#### Screen 1 — Four drug classes, visual cards
Cards show: pill icon (actual color/shape) + brand name (large) + plain-language purpose + audio button. Patient taps ✅ "I take this" or ❌ "I don't take this."

- **ACE Inhibitors**: Lisinopril, Enalapril, Ramipril, Benazepril → "Lowers blood pressure."
- **ARBs**: Losartan, Valsartan, Irbesartan, Olmesartan → "Lowers blood pressure."
- **Beta-Blockers**: Metoprolol (Toprol/Lopressor), Carvedilol (Coreg), Atenolol, Bisoprolol → "Lowers blood pressure and heart rate."
- **Calcium Channel Blockers**: Amlodipine (Norvasc), Diltiazem (Cardizem), Nifedipine (Procardia), Verapamil (Calan) → "Lowers blood pressure."

⚠️ **Backend must distinguish Diltiazem and Verapamil (nondihydropyridine CCBs) from Amlodipine and Nifedipine (dihydropyridine CCBs)** via subtle color-coded border. Needed for HFrEF contraindication alert. Patient doesn't need to understand.

#### Screen 2 — "I take something not listed here"
Category screen with icons:
- 💊 "Water pill" (furosemide, HCTZ, spironolactone)
- 💊 "Blood thinner" (warfarin, apixaban, rivaroxaban)
- 💊 "Cholesterol medicine" (atorvastatin, rosuvastatin)
- 💊 "Heart rhythm medicine" (amiodarone, flecainide)
- 💊 "Diabetes medicine that also helps the heart" (empagliflozin/Jardiance, dapagliflozin/Farxiga)
- 💊 "Other medicine not listed" → voice input (STT with fuzzy matching) OR photo capture (label reviewed by provider)

All "Other" entries **flagged as unverified. No automated alerts until provider confirms drug class** (except pregnancy ACE/ARB, which fires regardless — patient safety override).

#### Screen 3 — Combination pills
Own cards on Screen 1 with "2-in-1" badge:
- Lisinopril + HCTZ (Zestoretic)
- Losartan + HCTZ (Hyzaar)
- Amlodipine + Benazepril (Lotrel)
- Sacubitril + Valsartan (Entresto) — label: "Heart failure medicine"
- Amlodipine + Atorvastatin (Caduet)

**Deduplication**: If patient selects both "Lisinopril" AND "Lisinopril + HCTZ" → prompt with pill images to clarify.
**Backend mapping**: Each combo maps to component classes. Entresto → registers as ARB → triggers pregnancy contraindication check.

#### Screen 4 — Dose (simplified)
**Do NOT require dose entry.** Ask only: "How many times a day do you take this?"
Options: Once / Twice / Three times / **As needed** / Not sure. (`AS_NEEDED` added to `MedicationFrequency` enum 2026-05.)
Dose verification deferred to provider.

#### NSAID intake (Cluster 7)

Two surface paths capture NSAID exposure:

- **Per-reading checkbox** (`JournalEntry.nsaidUse`): "Did you take a pain reliever like ibuprofen, Advil, Aleve, or naproxen recently?" → fires `RULE_NSAID_ANTIHTN_INTERACTION` if patient on any antihypertensive.
- **Chronic NSAID in med list**: patient self-reports an NSAID under "Other medicine" → tagged `drugClass = NSAID`. Same rule fires.

### V2-C. Provider Dashboard — Verify → Resolve → Document

SMASH dashboard reference: 43 practices, 40.7% reduction in hazardous prescribing at 12 months.

#### Visual rules
- Traffic light: red / yellow / green for alert severity
- Only high-severity is interruptive
- Clinicians respond with 1–2 clicks
- Font weight conveys hierarchy

#### Layer 1 — Medication Alerts Panel (always-visible top of dashboard)

**🔴 RED BANNER — Tier 1 (Contraindication / Safety)**
Non-dismissable without documented action. See [Part 12.1](#121-tier-1-contraindication--safety-critical--5-actions-all-require-rationale) for the 5-action catalog.

Display: "⚠️ CONTRAINDICATION: Patient reports [drug] — patient flagged as [condition]. Immediate review required."

**🟡 YELLOW BADGE — Tier 2 (Discrepancy / Non-Adherence)**
Numbered badge on medication tab. Non-interruptive. 5-action catalog at [Part 12.2](#122-tier-2-discrepancy--non-adherence--5-actions).

Discrepancy labels:
- "Prescribed but not reported by patient" → potential non-adherence
- "Reported by patient but not in medical record" → unreported source
- "Dose discrepancy" → frequency mismatch

**🟢 GREEN — Tier 3 (Informational)**
Visible only in medication detail view. Examples: "Beta-blocker — HR alert threshold adjusted to <50 bpm" / "Last medication update: 12 days ago."

#### Layer 2 — Medication Reconciliation View

Side-by-side:
- **LEFT**: Patient-Reported (drug name, "I take this," frequency)
- **RIGHT**: Provider-Verified / Prescribed (drug name, dose, frequency)
- **STATUS**: ✅ Matched / ⚠️ Discrepancy / 🔵 Unverified / 🟠 **On Hold** (Cluster 7)
- **ACTION REQUIRED**: specific next step

Per-discrepancy resolution workflows:

**"Prescribed but not reported" (non-adherence signal):**
1. Patient confirmed not taking — address next visit
2. Patient confirmed taking — self-report incomplete
3. Medication discontinued by another provider
4. Will contact patient to discuss (triggers follow-up task)

**"Reported but not prescribed":**
1. Confirmed — adding to prescribed list
2. OTC/supplement — noted, no action
3. Prescribed by another provider — will obtain records
4. Patient error — not actually taking

**"Dose/frequency discrepancy":**
1. Patient-reported frequency correct — updating
2. Prescribed frequency correct — will educate patient
3. Intentional change by another provider — updating

**On Hold action (Cluster 7):** see [Part 14.2](#142-medication-hold-action).

#### Layer 3 — Medication Timeline

Chronological log. Each entry: timestamp, source (patient update / provider verification / BP-triggered inquiry / monthly check-in / **medication hold**), what changed, resolution + provider name, associated BP trend link.

#### Notification cadence per tier

| Tier | Channel | Window |
|---|---|---|
| Tier 1 Contraindication | Push + email, interruptive, non-dismissable | Same business day |
| Tier 1 Stopped all BP meds | Push, interruptive | Same business day |
| Tier 2 Non-adherence signal | Badge, non-interruptive | 48 hours |
| Tier 2 Unreported medication | Badge | 48 hours |
| Tier 2 Dose discrepancy | Badge | 48 hours |
| Tier 3 Context note | Passive, detail view only | No response required |
| Tier 3 Stale list (>30 days) | Passive, patient profile | No response required |

#### Joint Commission compliance (NPSG.03.06.01)

- EP 1 → Patient self-report + provider verification = two-column view
- EP 2 → Name, dose (deferred), frequency (patient-reported), route (oral default), purpose (visual cards)
- EP 3 → Side-by-side reconciliation with resolution actions
- EP 4 → Exportable reconciled list in visual card format
- EP 5 → Micro-education at each medication check-in

15-field audit detail in [Part 13.1](#131-jcaho-15-field-audit-trail).

### V2-D. Alert Escalation Pathways

*Detail folded into [Part 13](#part-13--audit-trail--escalation-engine).* This section retains the framing rationale.

#### Why

JAMA Network Open study (552 remote BP alerts): 37.9% resulted in no clinical action; of those, 93.8% had no documented rationale; 66.3% had no documentation of any kind. Escalation system prevents this.

#### Four-level response model

- **Level 1 — Direct loop**: Automated patient feedback (e.g., "Call 911 if symptoms"). Built into patient-facing alerts.
- **Level 2 — Mediated response**: Data to care team for action. Standard provider notification.
- **Level 3 — Urgent escalation**: Escalation pathway for unacknowledged alerts.
- **Level 4 — 24/7 emergency**: Patient calls 911. Outside platform scope; reinforced via education.

**Healplace operates at Levels 2 and 3.**

### V2-E. Silent Architecture (Health Literacy)

Platform bridges health literacy challenges without requiring disclosure. All patient-facing interfaces work equally for readers and non-readers.

- Icon-based condition selection (heart icon for HF, lightning bolt for AFib) alongside text
- Pill images and color-coded categories — no typed drug names required
- Audio prompts / voice-guided intake as alternative to text
- No element requires the patient to disclose inability to read
- Interface works identically for readers and non-readers — no differentiation
- "Why this matters" micro-education at each check-in: brief, visual, repeated

Evidence: meta-analysis of 54 RCTs — pictorial health information produced large knowledge improvements in lower health literacy populations; icons with few words are the most helpful format.

**Pilot blockers (frontend, not engine):** Gap 4 icon-paired checklists, Gap 5 caregiver integration workflow, Gap 7 privacy/trust onboarding. See Lakshitha's track.

### V2-F. MVP vs Post-MVP Feature Table

#### PRIORITY 1 — Safety-critical (ship at launch)

1. Patient self-report intake (checkboxes + visual medication cards) — ✅ MVP
2. Immediate threshold activation on patient-reported data — ✅ MVP
3. Tier 1 contraindication alerts (ACE/ARB+pregnancy, NDHP-CCB+HFrEF) — ✅ MVP
4. Tier 1 red banner non-dismissable — ✅ MVP
5. Tier 1 escalation chain (T+0 → T+4h → T+8h → T+24h → T+48h) — ✅ MVP
6. BP Level 2 dual notification (provider + backup simultaneous at T+0) — ✅ MVP
7. Patient-facing emergency message for SBP ≥180 or emergency symptoms — ✅ MVP
8. Practice-level configuration enforcement (backup + medical director) — ✅ MVP
9. Immutable audit trail (15 fields) — ✅ MVP
10. After-hours handling (BP Level 2 fires immediately regardless) — ✅ MVP

#### PRIORITY 2 — Core functionality (ship at launch)

11. Visual card-based medication selection (~20 meds + 5 combos) — ✅ MVP
12. DHP vs NDHP-CCB visual differentiation — ✅ MVP
13. Combination pill deduplication — ✅ MVP
14. "Not listed" category-guided tier + voice + photo — ✅ MVP
15. Frequency-only dose capture (+ `AS_NEEDED`) — ✅ MVP
16. "Awaiting Provider Verification" badge — ✅ MVP
17. Provider verification workflow (confirm/correct/hold) — ✅ MVP
18. Tier 2 badge for patient-initiated medication changes — ✅ MVP
19. Tier 3 passive context notes — ✅ MVP
20. Resolution action logging for all Tier 1 — ✅ MVP
21. Structured resolution actions for T1/T2/BP L2 — ✅ MVP
22. Monthly medication check-in prompt — ✅ MVP
23. Unverified medication handling — ✅ MVP
24. Tier 2 badge + first escalation at 48h — ✅ MVP
25. Six side-effect / interaction rules (Cluster 7) — ✅ MVP
26. Medication HOLD action (Cluster 7) — ✅ MVP

#### PRIORITY 3 — Design now, activate post-MVP

27. Side-by-side medication reconciliation view — ⚠️ Design data model + UI
28. Exportable reconciled medication list — ⚠️ Design template
29. Monthly escalation analytics report — ⚠️ Design data model
30. Discrepancy logging architecture — ⚠️ Design schema
31. Caregiver dispatch surface (UI + relation) — ⚠️ Engine ready; gated behind `CAREGIVER_DISPATCH_ENABLED` until Lakshitha Gap 5

#### PRIORITY 4 — Post-MVP roadmap

32. Full two-column reconciliation with resolution workflow — ❌ Defer
33. BP-pattern-triggered medication inquiries — ❌ Defer
34. BP-medication correlation overlay on trend graphs — ❌ Defer
35. Adherence pattern visualization — ❌ Defer
36. Automated monthly analytics reports — ❌ Defer
37. Video micro-education with teach-back — ❌ Defer
38. On-call provider rotation scheduling — ❌ Defer
39. Multi-site configuration for health systems — ❌ Defer
40. Patient 911 acknowledgment tracking — ❌ Defer
41. Configurable escalation timing per practice — ❌ Defer
42. Auto-generated visual medication summary pushed to patient app — ❌ Defer
43. HFpEF beta-blocker-for-HTN-only flag — ❌ Defer (requires intake change to capture prescribing indication)

---

## Translation pipeline + language support

Source: Cluster 7 Appendix B (Manisha 2026-05-11). Coordination track — engine produces English strings; vendor translates.

**Supported languages (MVP):** English (`en`), Spanish (`es`), Amharic (`am`), French (`fr`), German (`de`). Stored on `User.preferredLanguage`; default `en`.

**Appendix B priority tiers** (Manisha sign-off — strings authored by engineering, vendor-translated):

- **Priority 1** — safety-critical patient messages (Tier 1 contraindications, BP L2 emergency, ACE angioedema caregiver string). Required before any non-English patient enrolls.
- **Priority 2** — Tier 2 + Level 1 messages.
- **Priority 3** — Tier 3 side-effect strings (β-blocker fatigue, ACE cough, etc.) and caregiver edema. Lower urgency.

**Amharic audio workflow:** Amharic speakers may have limited literacy; the patient app's audio-button track is the primary delivery channel. Recording vendor coordinates with engineering on which strings need audio versions.

---

## Pulse Pressure derived alert

Server-side calculation: `pulsePressure = SBP − DBP`. If `> 60 mmHg`, flag in physician-facing output only. No patient-facing or caregiver-facing alert. No age/condition adjustment. Applied to session-averaged SBP/DBP.

**Annotation behaviour:** when another rule fires on the same reading, the wide-PP framing rides as a physician-message annotation. When nothing else fires, surfaces as a standalone `RULE_PULSE_PRESSURE_WIDE` Tier 3 row. See [Part 11](#part-11--multi-axis-co-fire-taxonomy-g1g9--b1).

---

## Appendix — Closed Rule List

This appendix enumerates every rule the engine can fire. Adding a rule requires (a) a new entry in `shared/src/rule-ids.ts`, (b) a matching message-registry entry in `shared/src/alert-messages.ts` (enforced at module init by `OutputGenerator.onModuleInit`), and (c) clinical sign-off captured in the [Changelog](#changelog).

### Tier 1 (Contraindication)

| Rule ID | Tier | Trigger |
|---|---|---|
| `RULE_PREGNANCY_ACE_ARB` | TIER_1_CONTRAINDICATION | Pregnant patient + ACE/ARB on med list (any verification status) |
| `RULE_NDHP_HFREF` | TIER_1_CONTRAINDICATION | HFrEF (or DCM alone) + VERIFIED NDHP-CCB |
| `RULE_BRADY_ABSOLUTE` | TIER_1_CONTRAINDICATION | HR <40 + (`hasBradycardia` ∥ β-blocker) — Cluster 6 |

### BP Level 2 (Emergency)

| Rule ID | Tier | Trigger |
|---|---|---|
| `RULE_ABSOLUTE_EMERGENCY` | BP_LEVEL_2 | SBP ≥180 ∥ DBP ≥120 (single reading) |
| `RULE_PREGNANCY_L2` | BP_LEVEL_2 | Pregnancy + SBP ≥160 ∥ DBP ≥110 (single reading, ACOG severe range) |
| `RULE_SYMPTOM_OVERRIDE_GENERAL` | BP_LEVEL_2_SYMPTOM_OVERRIDE | Any of: severeHeadache, visualChanges, alteredMentalStatus, chestPainOrDyspnea, focalNeuroDeficit, severeEpigastricPain, ruqPain |
| `RULE_SYMPTOM_OVERRIDE_PREGNANCY` | BP_LEVEL_2_SYMPTOM_OVERRIDE | Pregnant + (newOnsetHeadache ∥ ruqPain ∥ edema). RUQ pain alone suppresses general override. |

### BP Level 1 — Standard / Personalised / Age

| Rule ID | Tier | Trigger |
|---|---|---|
| `RULE_STANDARD_L1_HIGH` | BP_LEVEL_1_HIGH | SBP ≥160 ∥ DBP ≥100 (session-averaged) |
| `RULE_STANDARD_L1_LOW` | BP_LEVEL_1_LOW | SBP <90 (session-averaged, age <65) |
| `RULE_AGE_65_LOW` | BP_LEVEL_1_LOW | Age ≥65 + SBP <100 |
| `RULE_PERSONALIZED_HIGH` | BP_LEVEL_1_HIGH | SBP ≥ (provider upper target + 20) — when threshold seeded |
| `RULE_PERSONALIZED_LOW` | BP_LEVEL_1_LOW | SBP < provider lower target |

### BP Level 1 — Condition branches

| Rule ID | Tier | Trigger |
|---|---|---|
| `RULE_HFREF_LOW` / `RULE_HFREF_HIGH` | BP_LEVEL_1_LOW / HIGH | HFrEF SBP <85 / ≥160 (or provider thresholds) |
| `RULE_HFPEF_LOW` / `RULE_HFPEF_HIGH` | BP_LEVEL_1_LOW / HIGH | HFpEF SBP <110 / ≥160 |
| `RULE_CAD_DBP_CRITICAL` | BP_LEVEL_1_LOW | CAD + DBP <70 |
| `RULE_CAD_HIGH` | BP_LEVEL_1_HIGH | CAD + SBP ≥160 (default — see Q2) |
| `RULE_HCM_LOW` / `RULE_HCM_HIGH` | BP_LEVEL_1_LOW / HIGH | HCM SBP <100 / ≥160. Patient wording revised Cluster 7. |
| `RULE_DCM_LOW` / `RULE_DCM_HIGH` | BP_LEVEL_1_LOW / HIGH | DCM (no HF flag) SBP <85 / ≥160 |
| `RULE_HF_DECOMPENSATION` | BP_LEVEL_1_LOW | HF + (legSwelling ∥ weight gain >2 lbs/24h) — Cluster 6 |

### HR axes

| Rule ID | Tier | Trigger |
|---|---|---|
| `RULE_AFIB_HR_HIGH` / `RULE_AFIB_HR_LOW` | BP_LEVEL_1_HIGH / LOW | AFib + HR >110 / <50 |
| `RULE_TACHY_HR` | BP_LEVEL_1_HIGH | `hasTachycardia` + HR >100 with prior reading >100 within 8h, OR HR >130 single-reading (Cluster 6 Q5) |
| `RULE_BRADY_HR_SYMPTOMATIC` | BP_LEVEL_1_LOW | HR 40–49 + symptom + (`hasBradycardia` ∥ β-blocker) |
| `RULE_BRADY_HR_ASYMPTOMATIC` | BP_LEVEL_1_LOW | Legacy — superseded by `RULE_BRADY_ABSOLUTE` Tier 1. Retained as enum entry; not currently fired. |
| `RULE_ORTHOSTATIC_HYPOTENSION` | BP_LEVEL_1_LOW | Dizziness + SBP drop ≥15 from prior — Cluster 6 |
| `RULE_BETA_BLOCKER_DIZZINESS` | TIER_3_INFO | Dizziness + SBP <100 + β-blocker — Cluster 6 |
| `RULE_AFIB_PALPITATIONS` | BP_LEVEL_1_LOW | Palpitations + AFib — Cluster 6 |
| `RULE_TACHY_WITH_PALPITATIONS` | BP_LEVEL_1_HIGH | Palpitations + HR >100 + no AFib — Cluster 6 |
| `RULE_PALPITATIONS_GENERAL` | TIER_3_INFO | Palpitations + HR ≤100 + no AFib — Cluster 6 |
| `RULE_SYNCOPE_GENERAL` | BP_LEVEL_1_LOW | Syncope + no brady flag + HR ≥50 — Cluster 6 |

### Side-effect / Interaction (Cluster 7)

| Rule ID | Tier | Trigger |
|---|---|---|
| `RULE_BETA_BLOCKER_FATIGUE` | TIER_3_INFO | β-blocker + fatigue |
| `RULE_BETA_BLOCKER_SOB_HF` | TIER_2_DISCREPANCY | β-blocker + HF + shortnessOfBreath — **escalates** |
| `RULE_BETA_BLOCKER_SOB_NON_HF` | TIER_3_INFO | β-blocker (no HF) + shortnessOfBreath |
| `RULE_NSAID_ANTIHTN_INTERACTION` | TIER_3_INFO | (nsaidUse ∥ NSAID in med list) + any antihypertensive |
| `RULE_ACE_COUGH` | TIER_3_INFO | ACE inhibitor + dryCough |
| `RULE_HF_CAREGIVER_EDEMA` | TIER_3_INFO | HF + legSwelling — caregiver-routed (gated by `CAREGIVER_DISPATCH_ENABLED`) |
| `RULE_DHP_CCB_LEG_SWELLING` | TIER_3_INFO | Non-HF + legSwelling + DHP-CCB |
| `RULE_HCM_VASODILATOR` | TIER_3_INFO | HCM + (VASODILATOR_NITRATE ∥ DHP_CCB ∥ LOOP_DIURETIC) |
| `RULE_LOOP_DIURETIC_HYPOTENSION` | TIER_3_INFO | Loop diuretic + SBP <90 (strict, non-HF — Cluster 6 Q1) |
| `RULE_PULSE_PRESSURE_WIDE` | TIER_3_INFO | PP >60 (physician-only — annotation when other rule fired, row otherwise) |

### Tier 2 — Adherence

| Rule ID | Tier | Trigger |
|---|---|---|
| `RULE_MEDICATION_MISSED` | TIER_2_DISCREPANCY | ≥2 missed-medication-days within rolling 3 days. β-blocker single-miss carve-out for HFrEF / HCM / AFib. |

---

**Reflects Manisha sign-off through 2026-05-11. Pending decisions: 3 questions in [Part 15](#part-15--open-clinical-questions-pending) (asked 2026-05-15).**
