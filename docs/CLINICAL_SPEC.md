# Clinical Specification — Rule-Based BP Alert Logic

**Clinical authority:** Dr. Manisha Singal
**Status:** v1.0 sign-off complete + v2.0 addendum (onboarding, medication, provider dashboard, escalation)
**Source:** This document consolidates the two clinical sign-off documents provided by Dr. Singal. Every bracketed `[Approved]` or marked decision below is already signed off and locked. Open questions at the end.

This document is the canonical source of truth for every alert rule, threshold, symptom trigger, medication contraindication, and escalation tier. When the code disagrees with this document, the code is wrong.

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

**Signed off:** ✅ Classification schema. ✅ L1 High at ≥160/100. ✅ L2 at ≥180/120. ✅ Symptom-assessment prompt (not auto-emergency).

### 1.3 Symptom override — Level 2 at any BP

The following symptoms trigger Level 2 regardless of the BP number. Target organ damage can manifest even below 180/110–120 mmHg.

Level 2 symptom triggers:
- Severe headache unresponsive to analgesics
- Visual changes (blurred vision, scotomata, vision loss)
- Altered mental status or confusion
- Chest pain or acute dyspnea
- Focal neurological deficits (weakness, numbness, speech difficulty)
- Severe epigastric or right upper quadrant pain (especially in pregnant patients — preeclampsia with severe features)

**Signed off:** ✅ Symptom override list. ✅ Triggers symptom-assessment prompt, not auto-emergency.

---

## PART 2 — Gender

**Identical alert thresholds for male and female patients.** No sex-differentiated cutoffs in current guidelines (2025 AHA/ACC). Uniform thresholds for MVP.

**Post-pregnancy risk flag** (approved pending further team discussion): Female patients with documented history of preeclampsia or gestational hypertension get a dashboard notation for enhanced monitoring even outside pregnancy. Implemented as a flag, not a threshold modification.

**Signed off:** ✅ Identical thresholds. ✅ Post-pregnancy flag approved pending implementation feedback.

---

## PART 3 — Pregnancy Thresholds

**Sources:** 2025 AHA/ACC §11.5; CHAP Trial (Tita et al., NEJM 2022); ACOG Practice Bulletin No. 222

Pregnancy thresholds differ fundamentally from general adult thresholds. ACOG defines pregnancy hypertension as SBP ≥140 or DBP ≥90 (not 130/80). Severe hypertension in pregnancy (SBP ≥160 or DBP ≥110) is a medical emergency requiring treatment within 15 minutes.

| Alert Level | Threshold | Action |
|---|---|---|
| Level 1 High | SBP ≥140 or DBP ≥90 | Notify provider; assess for preeclampsia features |
| Level 2 (Emergency) | SBP ≥160 or DBP ≥110 | Immediate provider notification; treat within 15 minutes |
| Symptom Override | New headache, visual changes, RUQ pain, edema — at any BP | Level 2 trigger — assess for preeclampsia with severe features |

### Medication safety (non-configurable)

- **ACE inhibitors and ARBs are CONTRAINDICATED in pregnancy (teratogenic).** If a pregnant patient's medication record includes these agents, the system must generate an immediate Tier 1 alert.
- Preferred medications: labetalol (beta blocker), long-acting nifedipine (CCB) — per CHAP trial protocol.

### Gestational age tracking

**Manual provider flagging**, not automatic gestational-age tracking. Patient self-reports `isPregnant`, provider verifies at onboarding. System does not track weeks.

**Signed off:** ✅ Pregnancy thresholds (L1 ≥140/90, L2 ≥160/110). ✅ Pregnancy symptom override. ✅ ACE/ARB contraindication non-configurable. ✅ Manual provider flagging for pregnancy status.

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

**Signed off:** ✅ Mandatory provider configuration. ✅ SBP <85 default lower bound fallback.

### 4.3 Coronary Artery Disease (CAD)

Treatment target: 130/80. **Critical**: coronary perfusion occurs during diastole. Aggressive diastolic lowering causes myocardial ischaemia.

| Parameter | Threshold | Notes |
|---|---|---|
| Level 1 High | SBP ≥160 | Standard |
| **CRITICAL Lower Bound** | **DBP <70** | **Applies regardless of systolic value** |
| Level 2 | SBP ≥180 or any emergency symptom | Non-configurable |

Evidence: CLARIFY registry (22,672 hypertensive CAD patients) — J-shaped relationship, lowest risk at DBP 70–79, significantly increased risk DBP <70 (HR 1.50, 95% CI 1.31–1.72). AHA/ACC/ASH: "caution in inducing decreases in DBP to <60 mmHg" in CAD patients, particularly >60 years.

**Signed off:** ✅ DBP <70 alert (chose over DBP <65 and two-tier options).

### 4.4 Atrial Fibrillation (AFib)

BP thresholds follow standard ranges. Primary monitoring shifts to heart rate.

| Parameter | Threshold | Notes |
|---|---|---|
| BP Level 1 | Standard thresholds | Same as Part 1.2 |
| **HR Level 1 High** | **HR >110 bpm** | Rate-uncontrolled AFib; 2023 ACC/AHA lenient rate control |
| **HR Level 1 Low** | **HR <50 bpm** | Clinically significant bradycardia |
| BP Lower Bound | SBP <90 | Standard |

**BP measurement accuracy**: Oscillometric monitors provide valid SBP in AF but show small, consistent DBP overestimation. Platform must:
- Flag AFib patient readings with note: "Readings may have higher variability due to irregular rhythm"
- **Require ≥3 readings per session** before generating an alert

**Signed off:** ✅ HR thresholds (>110 high, <50 low). ✅ Mandate ≥3 readings for AFib patients.

### 4.5 Tachycardia (non-AFib)

| Parameter | Threshold | Notes |
|---|---|---|
| HR Alert | Resting HR >100 bpm on **≥2 consecutive readings** | Reduces false positives from transient causes |
| BP Thresholds | Standard | Unless provider configures otherwise |

Tag all readings with HR context on provider dashboard.

**Signed off:** ✅ Two-consecutive-reading requirement.

### 4.6 Bradycardia

| Parameter | Threshold | Notes |
|---|---|---|
| HR Level 1 (symptomatic) | HR <50 bpm | With symptoms |
| HR Level 1 (asymptomatic) | HR <40 bpm | Regardless of symptoms |
| BP Lower Bound | SBP <90 | Elevated hypotension risk |
| **Beta-blocker override** | **Do not alert on HR 50–60** | Therapeutic target; requires medication list cross-reference |

**Signed off:** ✅ Tiered bradycardia thresholds. ✅ Beta-blocker suppression 50–60.

### 4.7 Hypertrophic Cardiomyopathy (HCM)

Dynamic outflow obstruction worsens with low BP and low volume. Aggressive BP lowering is dangerous.

| Parameter | Threshold | Notes |
|---|---|---|
| Lower Bound | SBP <100 | All HCM patients |
| Upper Bound | Standard thresholds | Push for provider-configured personalised thresholds |
| Level 2 | SBP ≥180 or any emergency symptom | Non-configurable |

**MANDATORY**: Flag HCM patients for mandatory provider threshold configuration at onboarding.

**Medication safety flag** (approved): Flag HCM patients prescribed pure vasodilators (dihydropyridine CCBs, nitrates) or high-dose diuretics — these can worsen LVOT obstruction. Aligns with 2024 AHA/ACC HCM guideline.

**Signed off:** ✅ SBP <100 lower bound. ✅ Mandatory provider configuration. ✅ Vasodilator/nitrate safety flag.

### 4.8 Dilated Cardiomyopathy (DCM)

Managed as HFrEF. DCM is the most common cause of HFrEF.

| Parameter | Threshold | Notes |
|---|---|---|
| Default Lower Bound | SBP <85 | Applies only if no provider configuration |
| Upper Bound | Standard thresholds | — |
| Level 2 | SBP ≥180 or any emergency symptom | Non-configurable |

Provider-set thresholds required. Same mandatory configuration as HFrEF.

**Signed off:** ✅ DCM aligned with HFrEF.

### 4.9 Heart Failure — HFpEF (Preserved Ejection Fraction) — added in v2

Different hemodynamic considerations from HFrEF; increasingly prevalent.

| Parameter | Threshold | Notes |
|---|---|---|
| Level 1 Low | SBP <110 | Higher than HFrEF's <85, reflects J-curve data showing increased risk below 120 |
| Level 1 High | SBP ≥160 | Standard |
| Level 2 | SBP ≥180 or any emergency symptom | Non-configurable |
| Medication flag | Flag beta-blockers if prescribed solely for hypertension in HFpEF (not for AF or rate control) | — |

Provider-configured thresholds **recommended but not mandatory** (unlike HFrEF).

**Signed off:** ✅ Add HFpEF-specific logic.

### 4.10 Aortic Stenosis

**Deferred to post-MVP.** Severe aortic stenosis shares hemodynamic concerns with HCM (fixed obstruction, preload dependence) but is deferred.

**Signed off:** ✅ Defer to post-MVP.

---

## PART 5 — Normal BP Fluctuation Ranges

**Source:** AHA Home Blood Pressure Monitoring Scientific Statement; 2025 AHA/ACC Guidelines

Rule engine must account for physiological variability to avoid false alerts.

| Factor | Expected Variation | Platform Implication |
|---|---|---|
| Diurnal variation | BP 10–20% lower during sleep (nocturnal dipping) | Account for time-of-day context if readings are timestamped |
| Reading-to-reading variability | 5–10 mmHg between consecutive measurements | Use averaged readings (2–3 per session) — not single readings — for alert logic |
| Home vs. office difference | Home readings typically 5–10 mmHg lower than office | Thresholds calibrated for home monitoring |

**Critical**: 2025 AHA/ACC recommends BP targets based on averaged readings from multiple sessions. **Platform averages 2–3 readings per session before applying alert logic.**

**Signed off:** ✅ Averaged readings for alerts (not single readings). ✅ Thresholds calibrated for home BP monitoring. ✅ Time-of-day context for nocturnal readings.

---

## PART 6 — Non-Physiological Factors (Pre-Measurement Checklist)

Patient-facing checklist, shown before each reading. Eight items:

1. No caffeine in the last 30 minutes ✅
2. No smoking in the last 30 minutes ✅
3. No exercise in the last 30 minutes ✅
4. Bladder has been emptied ✅
5. Seated quietly for at least 5 minutes ✅
6. Back supported, feet flat, arm supported at heart level ✅
7. Not talking during measurement ✅
8. Cuff placed on bare upper arm (not over clothing) ✅

If any not met → reading tagged as "suboptimal measurement conditions" on provider dashboard, **retained in alert logic** (flag only, not excluded).

**Signed off:** ✅ Checklist items. ✅ Flag only (retain in alert logic).

---

## PART 7 — Medication Class Alert Logic (MVP scope: 4 linkages)

Full drug interaction mapping deferred. MVP covers the four highest-risk linkages.

| Priority | Medication Class | Trigger | Alert Type |
|---|---|---|---|
| 1 | ACE inhibitors / ARBs | Patient flagged as pregnant | **Immediate contraindication alert — teratogenic; non-configurable (Tier 1)** |
| 2 | Beta-blockers | HR 50–60 bpm | **Suppress HR alert** — therapeutic target; alert only below HR 50 |
| 3 | Loop diuretics | SBP <90 | Increased lower-bound BP sensitivity; flag hypotension risk |
| 4 | Nondihydropyridine CCBs (diltiazem, verapamil) | Patient flagged as HFrEF | **Contraindication alert — negative inotropic; harmful in HFrEF (Tier 1)** |

**Signed off:** ✅ Four linkages as MVP scope. ✅ ACE/ARB + pregnancy non-configurable. ✅ Specific alert triggers approved.

---

## PART 8 — Open Questions Resolved in v1 Sign-Off

1. **CAD Diastolic**: ✅ DBP <70 (chose over <65 and two-tier)
2. **AFib reading protocol**: ✅ Mandate ≥3 readings
3. **Pregnancy module scope**: ✅ Manual provider flagging (not auto gestational age tracking)
4. **Home vs. office calibration**: ✅ Home-calibrated
5. **HFpEF gap**: ✅ Add HFpEF-specific logic (see Part 4.9)
6. **Aortic stenosis**: ✅ Defer to post-MVP
7. **65+ lower bound**: ✅ SBP <100 (raised from standard <90)
8. **Suboptimal measurement conditions**: ✅ Flag only (retain in alert logic)

---

## v2.0 ADDENDUM — Onboarding, Medication, Dashboard, Escalation

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
- "Pregnant" → immediately activate pregnancy thresholds + ACE/ARB contraindication check
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

All "Other" entries **flagged as unverified. No automated alerts until provider confirms drug class.**

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
Options: Once / Twice / Three times / Not sure.
Dose verification deferred to provider.

### V2-C. Provider Dashboard — Verify → Resolve → Document

SMASH dashboard reference: 43 practices, 40.7% reduction in hazardous prescribing at 12 months.

#### Visual rules
- Traffic light: red / yellow / green for alert severity
- Only high-severity is interruptive
- Clinicians respond with 1–2 clicks
- Font weight conveys hierarchy

#### Layer 1 — Medication Alerts Panel (always-visible top of dashboard)

**🔴 RED BANNER — Tier 1 (Contraindication / Safety)**
Non-dismissable without documented action.
Display: "⚠️ CONTRAINDICATION: Patient reports [drug] — patient flagged as [condition]. Immediate review required."

Resolution options (must select one):
1. "Confirmed — medication discontinued / will contact patient."
2. "Confirmed — medication change ordered."
3. "False positive — patient is not [condition] / medication incorrect" (requires explanation)
4. "Acknowledged — provider aware, clinical rationale documented" (requires free-text)
5. "Deferred to in-person visit — appointment within [24h / 48h / 1 week]."

All resolutions timestamped and logged.

**🟡 YELLOW BADGE — Tier 2 (Discrepancy / Non-Adherence)**
Numbered badge on medication tab (e.g., "Medications ⚠️3"). Non-interruptive.

Discrepancy labels:
- "Prescribed but not reported by patient" → potential non-adherence
- "Reported by patient but not in medical record" → unreported source
- "Dose discrepancy" → frequency mismatch

Resolution options:
1. "Reviewed — no action needed" (requires reason)
2. "Will contact patient to discuss."
3. "Medication change ordered."
4. "Referred to pharmacy for reconciliation."
5. "Deferred to next scheduled visit."

**🟢 GREEN — Tier 3 (Informational)**
Visible only in medication detail view.
Examples: "Beta-blocker — HR alert threshold adjusted to <50 bpm" / "Last medication update: 12 days ago"

#### Layer 2 — Medication Reconciliation View

Side-by-side:
- **LEFT**: Patient-Reported (drug name, "I take this," frequency)
- **RIGHT**: Provider-Verified / Prescribed (drug name, dose, frequency)
- **STATUS**: ✅ Matched / ⚠️ Discrepancy / 🔵 Unverified
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

#### Layer 3 — Medication Timeline

Chronological log. Each entry: timestamp, source (patient update / provider verification / BP-triggered inquiry / monthly check-in), what changed, resolution + provider name, associated BP trend link.

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

### V2-D. Alert Escalation Pathways

#### Why

JAMA Network Open study (552 remote BP alerts): 37.9% resulted in no clinical action; of those, 93.8% had no documented rationale; 66.3% had no documentation of any kind. Escalation system prevents this.

#### Four-level response model

- **Level 1 — Direct loop**: Automated patient feedback (e.g., "Call 911 if symptoms"). Built into patient-facing alerts.
- **Level 2 — Mediated response**: Data to care team for action. Standard provider notification.
- **Level 3 — Urgent escalation**: Escalation pathway for unacknowledged alerts.
- **Level 4 — 24/7 emergency**: Patient calls 911. Outside platform scope; reinforced via education.

**Healplace operates at Levels 2 and 3.**

#### Tier 1 escalation (Contraindication / Safety-critical)

Applies to: ACE/ARB + pregnancy, NDHP-CCB + HFrEF, patient stops all BP meds, SBP ≥180 or emergency symptoms.

| Step | Action |
|---|---|
| T+0 | Push to assigned provider. Red banner on dashboard (non-dismissable). Automated email to provider. Dual-channel (app + email). |
| T+4h (no ack) | Re-send push with escalation flag: "UNACKNOWLEDGED — [Alert] for [Patient] — [X] hours ago". Simultaneously notify practice-level backup (nurse coordinator / clinical pharmacist / covering provider). |
| T+8h (no ack) | Push to medical director / supervising physician. Dashboard: blinking/animated red banner. Escalation log entry generated. |
| T+24h / 1 business day | Healplace clinical ops team notified. Healplace contacts practice by phone. For ACE/ARB + pregnancy: Healplace may contact patient with scripted message: "Your care team has been notified about your medicines. Please do not stop or change any medicine without talking to your doctor." |
| T+48h (unresolved) | Formal incident report in compliance module. Practice notified of documented safety event. |

#### Tier 2 escalation (Discrepancy / Non-Adherence)

| Step | Action |
|---|---|
| T+0 | Badge on dashboard. No push. |
| T+48h | Convert to yellow banner. Single push: "You have [N] unreviewed medication discrepancies." |
| T+7 days | Notify backup. Flag: "Overdue — escalated to backup." |
| T+14 days | Compliance flag in monthly report. Healplace ops notified. No further push. |

#### BP Level 2 escalation (SBP ≥180 or emergency symptoms)

⚠️ **Patient-facing emergency message fires FIRST, before any provider notification logic.**

| Step | Action |
|---|---|
| T+0 | **PATIENT**: "Your blood pressure is very high. If you have chest pain, severe headache, difficulty breathing, or vision changes, call 911 now." **PROVIDER**: Push to assigned provider AND backup simultaneously (dual from start). Dashboard red banner with current BP + reported symptoms. |
| T+2h (no ack either) | Push to medical director. If emergency symptoms: second patient message: "Have you called 911?" |
| T+4h (still no ack) | Healplace ops notified → phone contact to practice. If emergency symptoms + no 911 ack: Healplace may contact patient directly. |

#### After-hours handling

| Tier | After-hours behavior |
|---|---|
| Tier 1 | Queue for first business day. Immediate push to backup. Escalation clock starts next business day. |
| **BP Level 2** | **EXCEPTION — fires immediately. Patient emergency message fires. Provider + backup notified simultaneously. Clock starts immediately.** |
| Tier 2 | Queue for next business day. No after-hours notification. |

#### Audit trail — 15 required fields

**Auto-populated (13 fields):**
1. Alert ID
2. Alert type (Tier 1 / Tier 2 / BP Level 2)
3. Alert trigger
4. Patient ID
5. Alert generation timestamp
6. Escalation level
7. Escalation timestamp
8. Recipients notified
9. Acknowledgment timestamp
10. Resolution timestamp
11. Time to acknowledgment (calculated)
12. Time to resolution (calculated)
13. Escalation triggered? (Y/N)

**Provider-input (2 fields):**
14. Resolution action (from predefined list)
15. Resolution rationale (free-text; required for Tier 1, optional for Tier 2)

#### BP Level 2 resolution actions

1. Patient contacted — medication adjusted
2. Patient contacted — advised to go to ED
3. Patient contacted — BP re-check requested
4. Patient seen in office — management updated
5. Reviewed — BP trending down, no immediate action (requires trend documentation)
6. Unable to reach patient — will retry (triggers follow-up at T+4h)

#### Practice-level configuration — required before enrollment

**MANDATORY:**
- Primary provider per patient (cannot enroll without)
- Practice-level backup (cannot activate Tier 1 without)
- Medical director / supervising physician (cannot activate escalation without)
- After-hours protocol (mandatory for HF/HCM practices)

**OPTIONAL (with defaults):**
- Notification preferences → Default: push + email for Tier 1; push only for BP Level 2
- Business hours → Default: Mon–Fri, 8 AM – 6 PM local

#### Monthly analytics report (per practice)

Total alerts by tier, % acknowledged within target window, % requiring escalation, mean time to acknowledgment/resolution, alerts resolved without action + documentation rate, alerts reaching Healplace ops, provider-level volume (flag overload).

### V2-E. Silent Architecture (Health Literacy)

Platform bridges health literacy challenges without requiring disclosure. All patient-facing interfaces work equally for readers and non-readers.

- Icon-based condition selection (heart icon for HF, lightning bolt for AFib) alongside text
- Pill images and color-coded categories — no typed drug names required
- Audio prompts / voice-guided intake as alternative to text
- No element requires the patient to disclose inability to read
- Interface works identically for readers and non-readers — no differentiation
- "Why this matters" micro-education at each check-in: brief, visual, repeated

Evidence: meta-analysis of 54 RCTs — pictorial health information produced large knowledge improvements in lower health literacy populations; icons with few words are the most helpful format.

### V2-F. MVP vs Post-MVP Feature Table

#### PRIORITY 1 — Safety-critical (ship at launch)

1. Patient self-report intake (checkboxes + visual medication cards) — ✅ MVP
2. Immediate threshold activation on patient-reported data — ✅ MVP
3. Tier 1 contraindication alerts (ACE/ARB+pregnancy, NDHP-CCB+HFrEF) — ✅ MVP
4. Tier 1 red banner non-dismissable — ✅ MVP
5. Tier 1 escalation chain (T+4h → T+8h → T+24h → T+48h) — ✅ MVP
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
15. Frequency-only dose capture — ✅ MVP
16. "Awaiting Provider Verification" badge — ✅ MVP
17. Provider verification workflow (confirm/correct) — ✅ MVP
18. Tier 2 badge for patient-initiated medication changes — ✅ MVP
19. Tier 3 passive context notes — ✅ MVP
20. Resolution action logging for all Tier 1 — ✅ MVP
21. Structured resolution actions for T1/T2/BP L2 — ✅ MVP
22. Monthly medication check-in prompt — ✅ MVP
23. Unverified medication handling — ✅ MVP
24. Tier 2 badge + first escalation at 48h — ✅ MVP

#### PRIORITY 3 — Design now, activate post-MVP

25. Side-by-side medication reconciliation view — ⚠️ Design data model + UI
26. Exportable reconciled medication list — ⚠️ Design template
27. Monthly escalation analytics report — ⚠️ Design data model
28. Discrepancy logging architecture — ⚠️ Design schema

#### PRIORITY 4 — Post-MVP roadmap

29. Full two-column reconciliation with resolution workflow — ❌ Defer
30. BP-pattern-triggered medication inquiries — ❌ Defer
31. BP-medication correlation overlay on trend graphs — ❌ Defer
32. Adherence pattern visualization — ❌ Defer
33. Automated monthly analytics reports — ❌ Defer
34. Video micro-education with teach-back — ❌ Defer
35. On-call provider rotation scheduling — ❌ Defer
36. Multi-site configuration for health systems — ❌ Defer
37. Patient 911 acknowledgment tracking — ❌ Defer
38. Configurable escalation timing per practice — ❌ Defer
39. Auto-generated visual medication summary pushed to patient app — ❌ Defer

---

## Pre-Day-3 mode

For any patient with fewer than 7 readings, the system does not present personalized output. It applies fixed AHA thresholds and labels the alert explicitly: **"standard threshold — personalization begins after Day 3."** Protects first-cohort patients from acting on predictions the model is not qualified to make for their specific baseline.

## Pulse Pressure derived alert

Server-side calculation: `pulsePressure = SBP − DBP`. If `> 60 mmHg`, flag in physician-facing output only. No patient-facing or caregiver-facing alert. No age/condition adjustment. Applied to session-averaged SBP/DBP.

## Session averaging rule

Rule engine averages 2–3 readings per session before applying alert logic. AFib patients require ≥3 readings before any alert fires. Readings are grouped by `sessionId` on JournalEntry.
