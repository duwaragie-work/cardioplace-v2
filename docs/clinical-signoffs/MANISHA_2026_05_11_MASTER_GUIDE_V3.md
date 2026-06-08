Cardioplace v2 — Consolidated Implementation Guide: Clinical Sign-Offs,
Health Literacy Gaps, Side Effect Messages, and Translation Additions

Cardioplace v2 — Master Consolidated Implementation Guide

Clinical Sign-Off Responses (Q1–Q3) + Health Literacy Gaps (1–7) +
Medication Side Effect Messages + Translation Package Additions

From: Dr. Manisha Singal, CMO

To: Engineering Team

Date: May 11, 2026

Status: SIGNED OFF — all items approved for implementation

\---

**DOCUMENT OVERVIEW**

This is the single master reference for all outstanding clinical
decisions and implementation guidance. It consolidates four bodies of
work:

\- Part A: Three clinical sign-off responses (adherence trigger, symptom
checklist, brady co-fire) from the May 10 follow-up questions

\- Part B: Seven health literacy workflow gaps with exact implementation
specifications

\- Appendix A: Medication side effect patient-facing messages — 11
scenarios with alert logic and exact strings

\- Appendix B: Translation package review — 5 missing messages and 3
wording refinements

All items are approved. Items marked "Before pilot launch" are blockers
for the June 2026 first-cohort go-live.

\---

**PART A — CLINICAL SIGN-OFF RESPONSES (Q1–Q3)**

\---

**QUESTION 1 — Medication Adherence Rule Trigger Threshold + Three-Tier
Wording**

**Sub-question A — Trigger Threshold**

Engineering's current behavior: Single-miss fires Tier 2.

**ANSWER: Change to 2 missed doses within a rolling 3-day window, with a
beta-blocker single-miss exception.**

Why: The AHA Scientific Statement on Medication Adherence defines
nonadherence at the ≥80% threshold — a single missed dose does not meet
this. Long-acting antihypertensives maintain BP-lowering effect for
24–48 hours after a missed dose (amlodipine: only 6/2 mmHg rise after
two missed days). However, beta-blocker discontinuation carries rebound
tachycardia risk in HFrEF/HCM/AFib patients — these get a single-miss
exception.

\`\`\`

DEFAULT RULE:

IF missed*dose*count \&gt;= 2 within rolling 3-day window

THEN fire Tier 2 (yellow badge, no push, 48h SLA)

BETA-BLOCKER EXCEPTION:

IF patient.conditions INCLUDES ("HFrEF" OR "HCM" OR "AFib")

AND missed*med.drug*class == "BETA\_BLOCKER"\*

THEN fire Tier 2 on FIRST miss

ESCALATION:

IF missed*dose*days \&gt;= 3 within rolling 7-day window

THEN escalate to Tier 2 highlighted flag + push notification

"STOPPED ALL MEDICATIONS": Remains Tier 1. No change.

\`\`\`

**Sub-question B — Three-Tier Wording**

Engineering's current behavior: Patient and caregiver tiers suppressed.

**ANSWER: Do NOT suppress. All three tiers must have active messages.**

Why: Medication non-adherence in cardiovascular patients is a clinical
event, not an administrative one. Suppressing patient and caregiver
tiers means the patient misses doses, nobody tells them the system
noticed, and the only person who sees the alert is a provider with a
48-hour response window. The AHA statement identifies barrier-focused
interventions as more effective than simple reminders — the patient
message "your care team can help" opens the door for barrier reporting.

**Patient tier — active messages:**

Generic:

\`\`\`

"It looks like you may have missed your medicine a couple of

times recently. Taking your medicine regularly helps keep your

blood pressure steady. If something is making it hard to stay

on schedule, your care team can help."

\`\`\`

With specific medications:

\`\`\`

"It looks like you may have missed \[med*name*1, med*name*2\] a

couple of times recently. These medicines help protect your

heart and keep your blood pressure steady. If anything is

making it hard to take them, your care team can help."

\`\`\`

Beta-blocker single-miss (HFrEF/HCM/AFib only):

\`\`\`

"It looks like you may have missed \[med\_name\] today.\* This

medicine is important for your heart. Please try to take your

next dose on time, and let your care team know if anything is

making it hard to stay on schedule."

\`\`\`

**Caregiver tier — active messages:**

Generic:

\`\`\`

"\[patient\_name\] has reported missing medication doses on \[X\]\*

of the last 3 days. A gentle check-in may help identify any

barriers."

\`\`\`

With specific medications:

\`\`\`

"\[patient*name\] has reported missing \[med*name*1, med*name\_2\]\*

on \[X\] of the last 3 days. A gentle check-in may help —

common reasons include side effects, cost, or forgetting."

\`\`\`

**Physician tier — updated wording:**

Generic:

\`\`\`

"Tier 2 — Non-adherence pattern: patient self-reported missed

doses on \[X\]/3 days (no medication specified). Consider barrier

assessment and reconciliation."

\`\`\`

With specific medications:

\`\`\`

"Tier 2 — Non-adherence pattern: \[med*name\] (\[DRUG*CLASS\]) —

missed \[X\]/3 days — reason: \[FORGOT/SIDE\_EFFECTS/COST/OTHER\].\*

Consider barrier assessment; if persistent, evaluate regimen

simplification or longer-acting agent."

\`\`\`

Dashboard display: first-glance shows aggregate count ("missed 2/3
days"); per-medication detail available on click/expand.

\---

**QUESTION 2 — Patient Symptom Checklist Additions**

Engineering's current behavior: 6 fixed buttons + free-text.

**ANSWER: Add all four proposed symptoms. Engineering's recommendation
is clinically correct.**

Why: Each maps to an existing engine rule lacking a precise predicate.
The 2018 ACC/AHA/HRS Bradycardia Guideline defines symptomatic
bradycardia using exactly these symptoms: syncope, presyncope,
dizziness, lightheadedness. The HF-ARC Expert Panel defines acute
decompensated HF using peripheral edema and rapid weight gain. Without
these buttons, the engine uses alteredMentalStatus as an imprecise
proxy.

**Approved buttons — exact wording:**

\`\`\`

Button 7: "Feeling dizzy or lightheaded"

Button 8: "Felt faint or passed out recently"

Button 9: "Heart feels like it's racing or fluttering"

Button 10: "Swelling in your legs or feet, or gained weight quickly"

Button 11: "Anything else?" (moved from position 7)

\`\`\`

**Engine rule alignment:**

\`\`\`

BUTTON 7 — DIZZINESS:

IF bradycardia flag AND hr 50 → RULE*BRADY*SYMPTOMATIC (Tier 2)

IF beta-blocker AND sbp 100 → medication side effect (Tier 3)

IF sbp\_drop \&gt;= 15 vs prior session → orthostatic hypotension (Tier
2)\*

BUTTON 8 — FAINTING:

IF bradycardia flag → RULE*BRADY*SYMPTOMATIC (Tier 2)

escalate to Tier 1 if hr 40

IF no bradycardia flag → general syncope (Tier 2)

NOTE: Syncope is ALWAYS at least Tier 2

BUTTON 9 — PALPITATIONS:

IF AFib flag → AFib symptom flag (Tier 2)

IF hr \&gt; 100 → tachycardia + symptom (Tier 2)

IF hr = 100 AND no AFib → general palpitation (Tier 3)

BUTTON 10 — LEG SWELLING:

IF HFrEF/HFpEF/DCM → HF decompensation (Tier 2)

\+ patient message about heart condition

IF weight\_delta \&gt; 2 lbs in 24h (HF patient) → Tier 2 even without
symptom\*

IF DHP-CCB AND no HF → medication side effect (Tier 3)

\+ patient message about medication

\`\`\`

Translation: Add all 4 buttons to Spanish + Amharic package (Priority
2).

Icons: See Gap 4 in Part B for icon specifications.

\---

**QUESTION 3 — HR + Altered Mental Status: Brady Co-Fire**

Engineering's current behavior: Only RULE*SYMPTOM*OVERRIDE\_GENERAL
fires.\*

**ANSWER: Both rules fire (Option 2 — multi-axis co-fire). Engineering's
recommendation is correct.**

Why: HR 48 + altered mental status points to brady-induced cerebral
hypoperfusion (heart block, Stokes-Adams), requiring ECG, pacemaker
evaluation, beta-blocker dose review — fundamentally different from
hypertensive crisis. The 2025 AHA ACLS Guideline and 2018 ACC/AHA/HRS
Bradycardia Guideline both define symptomatic bradycardia using altered
mental status as a key presentation. A provider receiving only the
BP-emergency framing might triage incorrectly.

\`\`\`

WHEN:

patient.symptom IN ("alteredMentalStatus", "confusion",

"dizziness", "syncope")

AND patient.hr 50

AND (patient.meds INCLUDES "BETA\_BLOCKER"\*

OR patient.conditions INCLUDES "BRADYCARDIA")

THEN fire BOTH:

1\. RULE*SYMPTOM*OVERRIDE\_GENERAL\*

→ BP Level 2, non-dismissible

→ Patient sees emergency screen + 911 CTA

2\. RULE*BRADY*SYMPTOMATIC

→ Tier 2, separate dashboard row

→ Provider sees: "HR \[X\] bpm with \[symptom\]. Patient on

\[med\_name\] (beta-blocker).\* Evaluate for bradycardia-

induced cerebral hypoperfusion. Consider: ECG,

beta-blocker dose review, pacemaker evaluation."

PATIENT-FACING: One emergency screen only (911 CTA).

Brady alert is provider-facing only.

EDGE CASE — HR 40 + any symptom:

Three rules co-fire: SYMPTOM*OVERRIDE + BRADY*SYMPTOMATIC

\+ BRADY\_ABSOLUTE. All appear on dashboard. Patient sees\*

one emergency screen.

\`\`\`

\---

**PART A SUMMARY**

|        |                     |                                      |                                                 |                     |
| ------ | ------------------- | ------------------------------------ | ----------------------------------------------- | ------------------- |
| **\#** | **Question**        | **Decision**                         | **Key Engine Change**                           | **Priority**        |
| 1A     | Adherence trigger   | 2-of-3 days + beta-blocker exception | Change from single-miss to pattern-based        | Before pilot launch |
| 1B     | Three-tier wording  | All tiers ACTIVE (not suppressed)    | Un-suppress patient + caregiver; update strings | Before pilot launch |
| 2      | Symptom checklist   | Add all 4 buttons                    | 4 new buttons + engine rule alignment           | Before pilot launch |
| 3      | Brady + AMS co-fire | Both rules fire (multi-axis)         | Add RULE\<em\>BRADY\</em\>SYMPTOMATIC co-fire   | Before pilot launch |

\---

**PART B — HEALTH LITERACY WORKFLOW GAPS**

\---

**GAP 1 — Digital Teach-Back Confirmation Loop**

What is missing: No mechanism to confirm the patient understood Tier
1/Tier 2 messages.

Why it matters: AHA recommends teach-back as universal precaution.
Meta-analysis: teach-back reduced HF readmission (OR 0.40). Matched
cohort: 15% reduction in hospitalization (RR 0.85), 23% lower
readmission (HR 0.77).

**MVP:** Add "I read this" confirmation button (checkmark icon) to all
Tier 1/Tier 2 alert screens. Logs messageAcknowledged + timestamp. If
not tapped within 15 minutes → provider flag: "Alert delivered but not
acknowledged."

**Post-MVP:** Audio teach-back for 3 highest-risk messages. "Hear again"
tapped \&gt;2x → comprehensionFlag = NEEDS\_FOLLOWUP.\*

**Engineering:** Single UI element on existing alert screen. Timestamp
feeds into audit trail (field 16). "Not acknowledged" flag uses existing
Tier 3 badge mechanism.

\---

**GAP 2 — Pictorial Medication Schedule**

What is missing: No daily visual medication schedule. Patients see text
lists, not visual timelines.

Why it matters: AHA Resistant HTN Statement recommends pictorial
schedules. Flashcard study: adherence improved 44% → 71% PDC (p = 0.007)
in 91.2% low-literacy population.

**MVP:** Visual medication grid — rows = medications (pill images from
existing library), columns = time of day (sunrise/sun/moon icons).
Patient taps pill image to confirm dose taken (checkmark animation).
Each tap sets medicationTaken = true, feeding into Q1A adherence engine.
This grid is the patient HOME SCREEN.

**Post-MVP:** Audio narration on demand. Push notification reminders
with pill images.

**Engineering:** Reuses existing pill image library. Grid generated from
verified medications only (HOLD/UNVERIFIED not shown). Auto-updates on
admin changes. Medication adherence data feeds directly into Q1A 2-of-3
rolling window.

\---

**GAP 3 — Color-Coded BP Gauge**

What is missing: BP displayed as numbers only. AHA: 55% of low-literacy
patients cannot recognize 160/100 as abnormal.

**MVP:** Semicircular color gauge as PRIMARY visual after every BP
session.

\- Green: SBP 120 AND DBP 80

\- Yellow: SBP 120–139 OR DBP 80–89

\- Orange: SBP 140–159 OR DBP 90–99

\- Red: SBP ≥160 OR DBP ≥100

Numeric reading appears below gauge in smaller text. Arrow marker shows
patient's reading. Level 2 readings (≥180/≥120) → existing red emergency
screen takes over. Personalized-threshold patients → gauge zones adjust
to provider-configured bounds.

**Post-MVP:** Audio: "Your blood pressure is in the yellow zone today."
Weekly trend gauge.

**Engineering:** Single reusable UI component. Zone boundaries map to
existing threshold logic. Supplements (does not replace) existing alert
messages.

\---

**GAP 4 — Icon-Paired Checklists + Voice Input**

What is missing: All checklist buttons are text-only. Non-readers cannot
complete them. Free-text field unusable for non-readers.

Why it matters: AHRQ Universal Precautions: design for ALL patients.
AMA: patients with limited literacy hide it. Platform must assume
non-literacy.

**MVP — Pre-Measurement Checklist Icons:**

|        |                    |                           |
| ------ | ------------------ | ------------------------- |
| **\#** | **Item**           | **Icon**                  |
| 1      | No caffeine 30 min | Coffee cup + X            |
| 2      | No smoking 30 min  | Cigarette + X             |
| 3      | No exercise 30 min | Running figure + X        |
| 4      | Bladder emptied    | Toilet + checkmark        |
| 5      | Seated 5 min       | Chair + clock             |
| 6      | Correct posture    | Seated figure (side view) |
| 7      | Not talking        | Speech bubble + X         |
| 8      | Cuff on bare arm   | Arm with cuff, sleeve up  |

**MVP — Symptom Checklist Icons (includes Q2 additions):**

|        |                          |                             |          |
| ------ | ------------------------ | --------------------------- | -------- |
| **\#** | **Button**               | **Icon**                    | **New?** |
| 1      | Severe headache          | Head + lightning bolt       | No       |
| 2      | Vision changes           | Eye + wavy lines            | No       |
| 3      | Confusion                | Head + question mark        | No       |
| 4      | Chest pain/breathing     | Chest/lungs + exclamation   | No       |
| 5      | Weakness/numbness/speech | Arm ↓ + speech bubble X     | No       |
| 6      | Stomach/RUQ pain         | Torso + pain at upper right | No       |
| 7      | Dizzy/lightheaded        | Head + spiral/stars         | YES      |
| 8      | Faint/passed out         | Figure falling              | YES      |
| 9      | Racing/fluttering heart  | Heart + rapid-beat lines    | YES      |
| 10     | Leg swelling/weight gain | Leg + upward arrows         | YES      |
| 11     | Anything else?           | Plus sign in circle         | No       |

**MVP — Voice Input (Button 11):** Replace free-text with microphone
button. Device native speech-to-text. Transcription logged as
freeTextSymptom on provider dashboard. NOT parsed by engine.

**Post-MVP:** Audio playback of each item on tap in all languages.

**Engineering:** Icons = static assets, one-time design. Test with 3–5
Ward 7/8 population members before launch. Voice = native API (iOS
Speech / Android SpeechRecognizer).

**PILOT-LAUNCH BLOCKER:** Icons must be in place before pilot. Text-only
buttons are not usable for the target population.

\---

**GAP 5 — Caregiver Integration Workflow**

What is missing: Caregiver messages exist (now including un-suppressed
adherence messages per Q1B) but onboarding, designation, and interaction
workflow is unspecified.

Why it matters: AHA Telehealth/HF Equity Statement: codesign with
patients AND caregivers. EMPOWER trial: "support partner" model → 75%
maintained ≥80% adherence.

**MVP:**

\- Patient or admin designates up to 2 caregivers at onboarding

\- Fields: name, phone, relationship, preferred language

\- Caregivers receive push notifications for Tier 1, Tier 2, and
adherence alerts (NOT Tier 3)

\- "Got it" acknowledgment button → logs caregiverAcknowledged +
timestamp

\- No access to full dashboard/medication list/BP history — alert
messages only

\- Patient consent checkbox required at onboarding

**Post-MVP:** Caregiver-assisted BP logging. Caregiver sees pictorial
medication schedule. "Check-in call" request to care team.

**Engineering:** New profile field (array of 2 caregiver objects). Same
notification infrastructure, different template. POST
/alerts/{alertId}/caregiver-ack. HIPAA: limited to alert message content
only.

\---

**GAP 6 — Weight Monitoring for HF Patients**

What is missing: BP and HR monitored but not weight. Button 10 captures
subjective swelling but not objective measurement. Daily weight is
standard of care for HF.

Why it matters: EMPOWER trial thresholds: \&gt;3 lbs/24h or \&gt;5
lbs/72h → clinical review. JACC review: daily weight is sentinel signal
(10–20% sensitivity for worsening episodes).

**Post-MVP:**

\- Optional daily weight entry for HFrEF/HFpEF/DCM patients

\- Simple numeric keypad (large buttons, round to nearest pound)

\- Thresholds: \&gt;3 lbs/24h or \&gt;5 lbs/72h → Tier 2 HF
decompensation flag (independent of BP alerts and symptom-based leg
swelling alert)

\- Patient message: "Your weight has gone up more than usual. This can
sometimes mean extra fluid is building up. Your care team needs to know
about this."

\- Provider dashboard: weight trend chart alongside BP trend

\- Future: Bluetooth scale integration

**Engineering:** FHIR R4 already supports weight (LOINC 29463-7). Same
Tier 2 mechanism, different rule ID.

\---

**GAP 7 — Privacy/Trust Statement for Immigrant Populations**

What is missing: Platform collects sensitive data (pregnancy,
medications, history) but does not communicate privacy protections in
accessible formats. Fear of immigration enforcement is a documented
barrier to technology adoption in immigrant communities.

Why it matters: Research on LEP virtual care: privacy/ICE concerns are
significant barriers. Systematic review of CaLD digital health barriers:
trustworthiness is a primary adoption factor.

**MVP:** Privacy statement screen during onboarding, BEFORE any data
collection:

\- Shield icon: "Your health information is private"

\- Doctor icon: "It is only shared with your care team"

\- Government building + X: "It is NOT shared with the government"

\- Office building + X: "It is NOT shared with your employer"

\- Group + X: "It is NOT shared with anyone else"

\- Audio playback in all 5 languages

\- "I understand" button → logs privacyStatementAcknowledged + timestamp

\- Accessible from app settings at any time

**Post-MVP:** Community health worker review for Amharic/Spanish
cultural appropriateness.

**Engineering:** Single static screen inserted before first data
collection step. Distinct icon style from clinical icons. Audio files
added to translation package as Priority 1.

**PILOT-LAUNCH BLOCKER:** Must be in place before collecting data from
immigrant populations.

\---

**PART B SUMMARY**

|        |                                |                                        |              |                    |
| ------ | ------------------------------ | -------------------------------------- | ------------ | ------------------ |
| **\#** | **Gap**                        | **Phase**                              | **Effort**   | **Pilot Blocker?** |
| 1      | Teach-back confirmation        | MVP (button); Post-MVP (audio)         | Small        | No (recommended)   |
| 2      | Pictorial medication schedule  | MVP                                    | Medium       | No (high value)    |
| 3      | Color-coded BP gauge           | MVP                                    | Medium       | No (high value)    |
| 4      | Icon-paired checklists + voice | MVP (icons); Post-MVP (voice)          | Small/Medium | YES (icons)        |
| 5      | Caregiver integration          | MVP (designation); Post-MVP (assisted) | Medium       | No                 |
| 6      | Weight monitoring (HF)         | Post-MVP                               | Medium       | No                 |
| 7      | Privacy/trust statement        | MVP                                    | Small        | YES                |

\---

**APPENDIX A — MEDICATION SIDE EFFECT PATIENT-FACING MESSAGES**

These 11 scenarios cover side effects not yet addressed in
patient-facing messages. Six are MVP-priority; five are post-MVP.

**MVP-PRIORITY SIDE EFFECTS**

**A1. Beta-blocker + dizziness/lightheadedness**

Evidence: Danish cohort (64,722 patients): beta-blockers increased
dizziness risk RR 1.50 vs CCBs. Meta-analysis: RR 1.72 (95% CI
1.39–2.14). Metoprolol FDA label: dizziness in \~10%. AHA orthostatic
hypotension statement: beta-blockers increase sustained OH 2–3 fold.

\`\`\`

Tier: 3 (Tier 2 if concurrent SBP drop \&gt;=15)

Patient message:

"You reported feeling dizzy or lightheaded. This can sometimes

happen with \[med\_name\].\* Try standing up slowly, and let your

care team know — especially if it keeps happening or if you

have fallen."

\`\`\`

**A2. Beta-blocker + fatigue/exercise intolerance**

Evidence: Danish cohort: fatigue among most common complaints.
Metoprolol FDA label: tiredness in \~10%. ACC/AHA HF guideline:
beta-blocker fatigue "generally resolves within several weeks."

\`\`\`

Tier: 3

Patient message:

"You reported feeling more tired than usual. This can sometimes

happen with \[med\_name\], especially when you first start taking\*

it. It often gets better over time. Let your care team know if

it doesn't improve or if it's affecting your daily activities."

\`\`\`

**A3. Beta-blocker + shortness of breath (two variants)**

Evidence: ACCF/AHA Expert Consensus: bronchospasm is key beta-blocker
adverse effect. Metoprolol FDA label: SOB in \~3%. Overlaps with HF
decompensation — requires context-dependent messaging.

\`\`\`

Tier: 3 (non-HF); Tier 2 (HF patient)

HF patient message:

"You reported shortness of breath. Because of your heart

condition, your care team needs to know about this right away.

Please also let them know if you have swelling in your ankles,

weight gain, or trouble lying flat."

Non-HF patient on beta-blocker:

"You reported shortness of breath. This can sometimes happen

with \[med\_name\].\* Let your care team know, especially if you

also have wheezing or if it happens during activities that

didn't bother you before."

\`\`\`

**A4. Any antihypertensive + dizziness + SBP drop ≥15 mmHg**

Evidence: AHA defines orthostatic hypotension as sustained SBP reduction
≥20 or DBP ≥10 within 3 min of standing. JAMA meta-analysis (31,043
patients): OH associated with increased CV events and mortality.

\`\`\`

Tier: 2

Trigger: dizziness reported AND SBP drop \&gt;=15 vs prior session

Patient message:

"You reported feeling dizzy, and your blood pressure readings

have been lower than usual. This may mean your medicine is

lowering your blood pressure too much. Try standing up slowly,

drink plenty of water, and let your care team know."

\`\`\`

**A5. NSAID use + any antihypertensive**

Evidence: Meta-analysis: NSAIDs elevate mean supine BP by 5.0 mmHg. SBP
increase in ACE inhibitor users: 5–10 mmHg. NSAIDs interfere with
diuretics, beta-blockers, ACE inhibitors, ARBs (but not CCBs). In
patients ≥65, NSAID use increased risk of needing antihypertensive
initiation 1.55–1.82x.

\`\`\`

Tier: 3

Trigger: patient reports regular NSAID use during symptom

check-in or medication update

Patient message:

"You mentioned taking a pain medicine like ibuprofen (Advil,

Motrin) or naproxen (Aleve). These medicines can raise blood

pressure and make your blood pressure medicine work less well.

Let your care team know so they can help you find a safer

option for pain."

\`\`\`

**A6. ACE inhibitor + dry cough (patient message — currently
provider-only)**

Note: This rule already exists as a provider-only Tier 3 flag. The gap
is the missing patient-facing message. Cough is the most common reason
for ACE inhibitor discontinuation (up to 20% of patients). Patients may
stop the medication without telling anyone.

\`\`\`

Tier: 3

Patient message:

"You reported a cough that won't go away. This can sometimes

happen with \[med\_name\].\* Do not stop taking your medicine on

your own — let your care team know, and they can help find

a different option if needed."

\`\`\`

**POST-MVP SIDE EFFECTS**

**A7. Sexual dysfunction (beta-blockers, diuretics)**

Evidence: 2025 AHA/ACC Guideline: "discussing sexual function with
patients is essential." Danish cohort: 4.7% one-year risk of ED with
beta-blockers. ARBs have most favorable profile. Nebivolol shows benefit
over non-vasodilatory beta-blockers (OR 2.92).

\`\`\`

Tier: 3 (periodic check-in prompt, not symptom-triggered)

Patient message:

"Some blood pressure medicines can affect sexual function.

If you've noticed any changes, your care team can help.

There are often other medicine options that may work better

for you. You don't need to stop your medicine on your own."

\`\`\`

**A8. Diuretic + muscle cramps/weakness/thirst**

Evidence: HCTZ FDA label: warning signs of electrolyte imbalance include
muscle cramps, weakness, thirst. Signals hypokalemia/hyponatremia →
arrhythmia risk.

\`\`\`

Tier: 3

Patient message:

"You reported muscle cramps \[or: unusual thirst / weakness\].

This can sometimes happen with your water pill (\[med\_name\])\*

and may mean your body needs certain minerals checked. Let

your care team know — they may want to do a blood test."

\`\`\`

**A9. Beta-blocker + depressed mood/anxiety/insomnia**

Evidence: Danish cohort: anxiety/insomnia RR 1.53 vs CCBs (most common
side effect at 6.2%). Depression RR 1.48. Metoprolol FDA label:
depression in \~5%. Propranolol: increased insomnia risk (RR 1.13).

\`\`\`

Tier: 3

Patient message:

"You reported feeling down \[or: trouble sleeping / feeling

anxious\]. Some blood pressure medicines can affect mood and

sleep. Let your care team know — they may be able to adjust

your medicine to help."

\`\`\`

**A10. Verapamil + constipation**

Evidence: Most common verapamil side effect, up to 12% of patients.

\`\`\`

Tier: 3

Patient message:

"You reported constipation. This can sometimes happen with

\[med\_name\].\* Let your care team know if it continues — they

may have suggestions to help."

\`\`\`

**A11. Illness-related dose-holding education
(nausea/vomiting/diarrhea)**

Note: Not a side effect per se but a critical patient education gap.
Volume depletion compounds hypotension and AKI risk in patients on
antihypertensives.

\`\`\`

Tier: 3 (education prompt)

Trigger: patient reports nausea, vomiting, or diarrhea

Patient message:

"You reported feeling sick to your stomach \[or: vomiting /

diarrhea\]. When you are not eating or drinking normally, your

blood pressure medicine may lower your blood pressure too much.

Talk to your care team before taking your next dose."

\`\`\`

**APPENDIX A SUMMARY**

|        |                         |                           |                    |           |                     |
| ------ | ----------------------- | ------------------------- | ------------------ | --------- | ------------------- |
| **\#** | **Side Effect**         | **Drug Class**            | **Tier**           | **Phase** | **Patient Message** |
| A1     | Dizziness               | Beta-blocker              | 3 (2 if +SBP drop) | MVP       | Draft above         |
| A2     | Fatigue                 | Beta-blocker              | 3                  | MVP       | Draft above         |
| A3     | SOB                     | Beta-blocker (2 variants) | 3/2                | MVP       | Two drafts above    |
| A4     | Dizziness + SBP drop    | Any antihypertensive      | 2                  | MVP       | Draft above         |
| A5     | NSAID use               | Any antihypertensive      | 3                  | MVP       | Draft above         |
| A6     | Dry cough (patient msg) | ACE inhibitor             | 3                  | MVP       | Draft above         |
| A7     | Sexual dysfunction      | Beta-blocker, diuretic    | 3                  | Post-MVP  | Draft above         |
| A8     | Muscle cramps/thirst    | Diuretic                  | 3                  | Post-MVP  | Draft above         |
| A9     | Mood/sleep changes      | Beta-blocker              | 3                  | Post-MVP  | Draft above         |
| A10    | Constipation            | Verapamil                 | 3                  | Post-MVP  | Draft above         |
| A11    | Illness dose-holding    | Any antihypertensive      | 3                  | Post-MVP  | Draft above         |

\---

**APPENDIX B — TRANSLATION PACKAGE REVIEW AND ADDITIONS**

The engineering team's translation package
(CLINICAL*TRANSLATION*PACKAGE\_EN, dated April 27, 2026) was reviewed
against all signed-off clinical decisions.\* The package is
well-constructed. The following items need to be added or refined before
forwarding to translators.\*\*

**B1. Missing Messages — Add to Translation Package**
