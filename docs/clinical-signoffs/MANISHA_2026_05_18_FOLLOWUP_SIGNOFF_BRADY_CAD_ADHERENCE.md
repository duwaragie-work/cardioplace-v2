# Cardioplace v2 — Clinical Sign-Off: Asymptomatic Bradycardia, CAD Default Threshold, and Single-Miss Adherence

Clinical Sign-Off — Three Follow-Up Questions (May 15, 2026)

From: Dr. Manisha Singal, CEO

To: Engineering Team (Cardioplace v2 backend)

Date: May 18, 2026

Re: Response to MANISHA*FOLLOWUP*2026*05*15

Status: SIGNED OFF — all three decisions approved. Unblocks test.fixme()
markers for Nora HR 45, Paul CAD 145, Post-Day3 145/95, and Aisha
adherence.

\---

**Q1 — ASYMPTOMATIC BRADYCARDIA IN HR 40–49 (NO SYMPTOMS REPORTED)**

**DECISION: Yes — fire a Tier 3 surveillance row. HR 40–49 with no
symptoms should NOT be silent.**

**Why this matters clinically**

The 2018 ACC/AHA/HRS Bradycardia Guideline adopted HR 50 bpm (not 60) as
the threshold for clinically relevant bradycardia, reflecting population
studies that commonly use this lower
cutoff.[\[1\]](#wigginton-jg,-agarwal-s,-bartos-ja,-et-al.-\<a-target="_blank"-href="https://www.ahajournals.org/doi/10.1161/cir.0000000000001376?url_ver=z39.88-2003&rfr_id=ori:rid:crossref.org&rfr_dat=cr_pub%20%200pubmed"\>part-9:-adult-advanced-life-support:-2025-american-heart-association-guidelines-for-cardiopulmonary-resuscitation-and-emergency-cardiovascular-care\</a\>.-circulation.-2025;152\(16_suppl_2\):s538-s577.-doi:10.1161/cir.0000000000001376.)[\[2\]](#writing-committee-members,-kusumoto-fm,-schoenfeld-mh,-et-al.-\<a-target="_blank"-href="https://doi.org/10.1016/j.hrthm.2018.10.037"\>2018-acc/aha/hrs-guideline-on-the-evaluation-and-management-of-patients-with-bradycardia-and-cardiac-conduction-delay:-a-report-of-the-american-college-of-cardiology/american-heart-association-task-force-on-clinical-practice-guidelines-and-the-heart-rhythm-society\</a\>.-heart-rhythm.-2019;16\(9\):e128-e226.-doi:10.1016/j.hrthm.2018.10.037.)
The 2025 AHA ACLS Guideline reaffirms this
threshold.[\[1\]](#wigginton-jg,-agarwal-s,-bartos-ja,-et-al.-\<a-target="_blank"-href="https://www.ahajournals.org/doi/10.1161/cir.0000000000001376?url_ver=z39.88-2003&rfr_id=ori:rid:crossref.org&rfr_dat=cr_pub%20%200pubmed"\>part-9:-adult-advanced-life-support:-2025-american-heart-association-guidelines-for-cardiopulmonary-resuscitation-and-emergency-cardiovascular-care\</a\>.-circulation.-2025;152\(16_suppl_2\):s538-s577.-doi:10.1161/cir.0000000000001376.)
Asymptomatic sinus bradycardia does not require pacing and is not an
indication for in-hospital
monitoring.[\[3\]](#sandau-ke,-funk-m,-auerbach-a,-et-al.-\<a-target="_blank"-href="https://www.ahajournals.org/doi/10.1161/cir.0000000000000527?url_ver=z39.88-2003&rfr_id=ori:rid:crossref.org&rfr_dat=cr_pub%20%200pubmed"\>update-to-practice-standards-for-electrocardiographic-monitoring-in-hospital-settings:-a-scientific-statement-from-the-american-heart-association\</a\>.-circulation.-2017;136\(19\):e273-e344.-doi:10.1161/cir.0000000000000527.)
However, in a remote monitoring platform for cardiovascular patients on
rate-controlling medications, sustained HR 40–49 is clinically
meaningful for two reasons:

1\. The MESA study (JAMA Internal Medicine, 6,814 participants) found
that among patients taking HR-modifying medications (predominantly
beta-blockers), HR 50 bpm was associated with markedly elevated
mortality — over twice as high as the 60–69 bpm reference range. In
contrast, among patients NOT on HR-modifying drugs, bradycardia was NOT
associated with elevated mortality. This means the platform's population
(cardiac patients on beta-blockers, CCBs, digoxin) is the exact
population where asymptomatic bradycardia carries
risk.[\[4\]](#dharod-a,-soliman-ez,-dawood-f,-et-al.-\<a-target="_blank"-href="https://jamanetwork.com/journals/jamainternalmedicine/fullarticle/10.1001/jamainternmed.2015.7655?utm_source=openevidence&utm_medium=referral"\>association-of-asymptomatic-bradycardia-with-incident-cardiovascular-disease-and-mortality:-the-multi-ethnic-study-of-atherosclerosis-\(mesa\)\</a\>.-jama-internal-medicine.-2016;176\(2\):219-27.-doi:10.1001/jamainternmed.2015.7655.)

The following figure from the MESA study illustrates this differential
mortality pattern:

2\. The AHA Drug-Induced Arrhythmias Scientific Statement notes that
approximately 50% of patients with drug-induced bradycardia experience
persistence or recurrence even after medication discontinuation and may
still need a pacemaker. Early surveillance allows the provider to
identify a trend before the patient becomes
symptomatic.[\[5\]](#tisdale-je,-chung-mk,-campbell-kb,-et-al.-\<a-target="_blank"-href="https://www.ahajournals.org/doi/abs/10.1161/cir.0000000000000905?url_ver=z39.88-2003&rfr_id=ori:rid:crossref.org&rfr_dat=cr_pub%20%200pubmed"\>drug-induced-arrhythmias:-a-scientific-statement-from-the-american-heart-association\</a\>.-circulation.-2020;142\(15\):e214-e233.-doi:10.1161/cir.0000000000000905.)

3\. Beta-blocker-induced bradyarrhythmia develops within 2 months of
treatment initiation with most beta-blockers (early failure type),
making surveillance especially important for newly enrolled
patients.[\[6\]](#motoishi-h,-uesawa-y,-ishii-nozawa-r.-\<a-target="_blank"-href="https://pubmed.ncbi.nlm.nih.gov/39443084"\>evaluation-of-β-blocker-induced-bradyarrhythmia-using-an-analysis-of-the-japanese-adverse-drug-event-report-database\</a\>.-biological-&-pharmaceutical-bulletin.-2024;47\(10\):1668-1674.-doi:10.1248/bpb.b24-00305.)

**Implementation**

\`\`\`

RULE*BRADY*SURVEILLANCE (NEW RULE):

WHEN: patient.hr \&gt;= 40 AND patient.hr 50

AND patient.symptoms NOT INCLUDES

("dizziness", "syncope", "alteredMentalStatus",

"chestPain", "dyspnea")

AND reading is session-averaged (per Q2 from May 9 batch)

THEN: Fire Tier 3 (info-only chart event)

→ Dashboard badge: yellow dot, no push notification

→ No patient-facing message (patient is asymptomatic)

→ Provider sees the reading flagged on the trend chart

PHYSICIAN-FACING WORDING:

"Tier 3 — Surveillance: Resting HR \[X\] bpm (asymptomatic).

Patient is on \[med*name\] (\[DRUG*CLASS\]). *Consider: Is this*

the therapeutic target? Trend review recommended. If HR

persists 45 on multiple sessions, consider ECG and

medication dose review."

\`\`\`

**What this does NOT do:**

\- Does NOT fire a patient-facing message (patient is asymptomatic — no
reason to alarm them)

\- Does NOT fire a caregiver message

\- Does NOT fire a push notification to the provider

\- Does NOT escalate through the T+0 → T+4h ladder

**What this DOES do:**

\- Creates a visible chart event so the provider can see the trend

\- Flags the reading on the dashboard with a yellow dot

\- If HR persists 45 on 3+ consecutive sessions → auto-escalate to Tier
2 with physician message: "Sustained asymptomatic bradycardia HR 45 on
\[X\] consecutive sessions. ECG and medication review recommended."

**Interaction with existing rules:**

\- If the patient ALSO reports symptoms (dizziness, syncope, etc.) →
RULE*BRADY*SYMPTOMATIC fires instead (Tier 2), per the May 10 sign-off

\- If HR drops below 40 → RULE*BRADY*ABSOLUTE fires (Tier 1 emergency),
regardless of symptoms — unchanged

\- Beta-blocker suppression (HR 50–60 = no alert) remains unchanged —
this new rule only covers the 40–49 band

**Test case resolution:** Nora HR 45 → Tier 3 surveillance row fires.
test.fixme() resolved.

\---

**Q2 — CAD PATIENT DEFAULT sbpUpperTarget**

**DECISION: Option (b) — set default sbpUpperTarget to 140 for CAD
patients without a provider-set custom threshold.**

This is the most nuanced of the three questions. Here is the reasoning
for choosing 140 over the other options:

**Why NOT 130 (Option a):**

The 2025 AHA/ACC Guideline and the 2023 AHA/ACC Chronic Coronary Disease
Guideline both recommend a BP target of 130/80 mmHg for adults with CCD
and hypertension (Class 1, Level
B-R).[\[7\]](#jones-dw,-ferdinand-kc,-taler-sj,-et-al.-\<a-target="_blank"-href="https://linkinghub.elsevier.com/retrieve/pii/s0735-1097\(25\)06480-0"\>2025-aha/acc/aanp/aapa/abc/accp/acpm/ags/ama/aspc/nma/pcna/sgim-guideline-for-the-prevention,-detection,-evaluation,-and-management-of-high-blood-pressure-in-adults:-a-report-of-the-american-college-of-cardiology/american-heart-association-joint-committee-on-clinical-practice-guidelines\</a\>.-journal-of-the-american-college-of-cardiology.-2025;86\(18\):1567-1678.-doi:10.1016/j.jacc.2025.05.007.)[\[8\]](#virani-ss,-newby-lk,-arnold-sv,-et-al.-\<a-target="_blank"-href="https://linkinghub.elsevier.com/retrieve/pii/s0735-1097\(23\)05281-6"\>2023-aha/acc/accp/aspc/nla/pcna-guideline-for-the-management-of-patients-with-chronic-coronary-disease:-a-report-of-the-american-heart-association/american-college-of-cardiology-joint-committee-on-clinical-practice-guidelines\</a\>.-journal-of-the-american-college-of-cardiology.-2023;82\(9\):833-955.-doi:10.1016/j.jacc.2023.04.003.)
However, 130 is a treatment target, not an alert threshold. There is a
critical distinction:

\- Treatment target = the BP the provider is trying to achieve through
medication titration

\- Alert threshold = the BP at which the remote monitoring platform
should notify the provider that something may be wrong

Setting the alert at 130 means every CAD patient with SBP 131 generates
a provider notification. In a population where the average treated SBP
is 130–139 mmHg, this creates massive alert volume. The 2025 AHA/ACC
guideline itself acknowledges that "adverse effects of intensive
antihypertensive therapy have received less careful scrutiny" and that
"individualization of the BP target may be required." A platform that
alerts at 130 for every CAD patient without provider input is making a
treatment intensity decision that should be the
provider's.[\[7\]](#jones-dw,-ferdinand-kc,-taler-sj,-et-al.-\<a-target="_blank"-href="https://linkinghub.elsevier.com/retrieve/pii/s0735-1097\(25\)06480-0"\>2025-aha/acc/aanp/aapa/abc/accp/acpm/ags/ama/aspc/nma/pcna/sgim-guideline-for-the-prevention,-detection,-evaluation,-and-management-of-high-blood-pressure-in-adults:-a-report-of-the-american-college-of-cardiology/american-heart-association-joint-committee-on-clinical-practice-guidelines\</a\>.-journal-of-the-american-college-of-cardiology.-2025;86\(18\):1567-1678.-doi:10.1016/j.jacc.2025.05.007.)

**Why NOT 160 (Option d — current fallback):**

The current fallback of 160 is too permissive for CAD patients. A CAD
patient sitting at SBP 155 for weeks with no alert is a missed
opportunity for intervention. The 2025 AHA/ACC guideline defines Stage 2
hypertension at ≥140 mmHg and recommends pharmacotherapy at this level
for all adults with clinical
CVD.[\[7\]](#jones-dw,-ferdinand-kc,-taler-sj,-et-al.-\<a-target="_blank"-href="https://linkinghub.elsevier.com/retrieve/pii/s0735-1097\(25\)06480-0"\>2025-aha/acc/aanp/aapa/abc/accp/acpm/ags/ama/aspc/nma/pcna/sgim-guideline-for-the-prevention,-detection,-evaluation,-and-management-of-high-blood-pressure-in-adults:-a-report-of-the-american-college-of-cardiology/american-heart-association-joint-committee-on-clinical-practice-guidelines\</a\>.-journal-of-the-american-college-of-cardiology.-2025;86\(18\):1567-1678.-doi:10.1016/j.jacc.2025.05.007.)
Leaving the threshold at 160 means the platform does not flag Stage 2
hypertension in a population where it is explicitly indicated for
treatment.

**Why 140 (Option b):**

140 is the Stage 2 hypertension floor — the threshold at which ALL
guidelines agree pharmacotherapy is indicated, regardless of risk
level.[\[7\]](#jones-dw,-ferdinand-kc,-taler-sj,-et-al.-\<a-target="_blank"-href="https://linkinghub.elsevier.com/retrieve/pii/s0735-1097\(25\)06480-0"\>2025-aha/acc/aanp/aapa/abc/accp/acpm/ags/ama/aspc/nma/pcna/sgim-guideline-for-the-prevention,-detection,-evaluation,-and-management-of-high-blood-pressure-in-adults:-a-report-of-the-american-college-of-cardiology/american-heart-association-joint-committee-on-clinical-practice-guidelines\</a\>.-journal-of-the-american-college-of-cardiology.-2025;86\(18\):1567-1678.-doi:10.1016/j.jacc.2025.05.007.)
For CAD patients specifically:

\- The CLARIFY registry (22,672 hypertensive CAD patients, 5-year
follow-up) found the lowest cardiovascular risk at SBP 120–129 and DBP
70–79, with significantly increased risk at SBP ≥140 (HR 1.58, 95% CI
1.42–1.77 for DBP
≥80).[\[9\]](#vidal-petiot-e,-greenlaw-n,-ford-i,-et-al.-\<a-target="_blank"-href="https://pubmed.ncbi.nlm.nih.gov/29084876"\>relationships-between-components-of-blood-pressure-and-cardiovascular-events-in-patients-with-stable-coronary-artery-disease-and-hypertension\</a\>.-hypertension-\(dallas,-tex.-:-1979\).-2018;71\(1\):168-176.-doi:10.1161/hypertensionaha.117.10204.)

\- The 2023 CCD Guideline recommends 130/80 as the target but
acknowledges that the evidence base for the specific threshold comes
from trials where the achieved SBP was typically
130–139.[\[8\]](#virani-ss,-newby-lk,-arnold-sv,-et-al.-\<a-target="_blank"-href="https://linkinghub.elsevier.com/retrieve/pii/s0735-1097\(23\)05281-6"\>2023-aha/acc/accp/aspc/nla/pcna-guideline-for-the-management-of-patients-with-chronic-coronary-disease:-a-report-of-the-american-heart-association/american-college-of-cardiology-joint-committee-on-clinical-practice-guidelines\</a\>.-journal-of-the-american-college-of-cardiology.-2023;82\(9\):833-955.-doi:10.1016/j.jacc.2023.04.003.)

\- The 2025 AHA/ACC Performance Measures for CCD use 130/80 as the
quality
metric.[\[10\]](#williams-ms,-levine-gn,-kalra-d,-et-al.-\<a-target="_blank"-href="https://linkinghub.elsevier.com/retrieve/pii/s0735-1097\(25\)00282-7"\>2025-aha/acc-clinical-performance-and-quality-measures-for-patients-with-chronic-coronary-disease:-a-report-of-the-american-college-of-cardiology/american-heart-association-joint-committee-on-performance-measures\</a\>.-journal-of-the-american-college-of-cardiology.-2025;85\(25\):2504-2535.-doi:10.1016/j.jacc.2025.02.001.)

140 is the defensible middle ground: it catches every CAD patient who is
clearly above target without generating noise for patients in the
130–139 zone where the provider may be intentionally managing
conservatively (e.g., elderly CAD patient with orthostatic symptoms, CAD
patient with low DBP where further SBP reduction would drop DBP below
70).

**Critical addition — the diastolic threshold matters MORE than systolic
for CAD:**

The CLARIFY registry demonstrated a J-shaped relationship between DBP
and cardiovascular events in CAD patients, with the lowest risk at DBP
70–79 mmHg and significantly increased risk at DBP 70 (HR 1.50, 95% CI
1.31–1.72).[\[9\]](#vidal-petiot-e,-greenlaw-n,-ford-i,-et-al.-\<a-target="_blank"-href="https://pubmed.ncbi.nlm.nih.gov/29084876"\>relationships-between-components-of-blood-pressure-and-cardiovascular-events-in-patients-with-stable-coronary-artery-disease-and-hypertension\</a\>.-hypertension-\(dallas,-tex.-:-1979\).-2018;71\(1\):168-176.-doi:10.1161/hypertensionaha.117.10204.)
This J-curve persisted even after controlling for pulse pressure,
meaning it is not simply a marker of arterial
stiffness.[\[9\]](#vidal-petiot-e,-greenlaw-n,-ford-i,-et-al.-\<a-target="_blank"-href="https://pubmed.ncbi.nlm.nih.gov/29084876"\>relationships-between-components-of-blood-pressure-and-cardiovascular-events-in-patients-with-stable-coronary-artery-disease-and-hypertension\</a\>.-hypertension-\(dallas,-tex.-:-1979\).-2018;71\(1\):168-176.-doi:10.1161/hypertensionaha.117.10204.)
The INVEST study showed the primary outcome doubled when DBP was 70 mmHg
and quadrupled when 60
mmHg.[\[11\]](#mcevoy-jw,-chen-y,-rawlings-a,-et-al.-\<a-target="_blank"-href="https://pubmed.ncbi.nlm.nih.gov/27590090"\>diastolic-blood-pressure,-subclinical-myocardial-damage,-and-cardiac-events:-implications-for-blood-pressure-control\</a\>.-journal-of-the-american-college-of-cardiology.-2016;68\(16\):1713-1722.-doi:10.1016/j.jacc.2016.07.754.)[\[12\]](#warren-j,-nanayakkara-s,-andrianopoulos-n,-et-al.-\<a-target="_blank"-href="https://pubmed.ncbi.nlm.nih.gov/31171090"\>impact-of-pre-procedural-blood-pressure-on-long-term-outcomes-following-percutaneous-coronary-intervention\</a\>.-journal-of-the-american-college-of-cardiology.-2019;73\(22\):2846-2855.-doi:10.1016/j.jacc.2019.03.493.)

The platform already has the CAD diastolic lower bound alert at DBP 70
(signed off in v1.0 spec §5.3, updated from 65 in v2.0). This diastolic
alert is arguably more important than the systolic upper bound for
preventing coronary events in CAD patients.

**Implementation**

\`\`\`

CAD PATIENT THRESHOLD DEFAULTS (when no provider-set custom threshold):

sbpUpperTarget = 140

dbpUpperTarget = 80 (unchanged)

sbpLowerTarget = 90 (standard)

dbpLowerTarget = 70 (CAD-specific, already implemented)

ALERT LOGIC:

IF patient.conditions INCLUDES "CAD"

AND patient.sbp \&gt;= 140 (session-averaged)

AND PatientThreshold.sbpUpperTarget NOT custom-set

THEN fire Tier 2 (Level 1 High equivalent)

→ Physician message:

"Tier 2 — CAD patient SBP \[X\] mmHg (session average),

above default target of 140. Treatment target per

AHA/ACC: 130/80. Consider medication adjustment.

NOTE: Monitor DBP — coronary perfusion risk if DBP 70."

PROVIDER DASHBOARD NOTE (always visible for CAD patients):

"CAD patient — AHA/ACC treatment target: 130/80.

Default alert threshold: SBP ≥140 / DBP 70.

Customize thresholds in patient settings."

\`\`\`

**Ramp consideration:** The engineering team correctly flagged that
changing from 160 to 140 will increase alert volume for existing CAD
patients. Recommended approach:

\- Phase 1 (pilot launch): Apply 140 default to all newly enrolled CAD
patients

\- Phase 2 (1 week post-launch): Apply to existing CAD patients at Cedar
Hill first

\- Phase 3 (2 weeks post-launch): Apply to all practices

\- Provider notification: When the threshold changes, send a one-time
dashboard message: "CAD patient alert threshold updated from SBP ≥160 to
SBP ≥140 per AHA/ACC guideline alignment. Customize in patient
settings."

**Test case resolution:** Paul CAD SBP 145 → Tier 2 alert fires (145 ≥
140). test.fixme() resolved.

\---

**Q3 — SINGLE-MISS ADHERENCE THRESHOLD**

**DECISION: Option (c) — keep the 2-of-3-day rolling window. A single
one-off miss remains invisible to the patient. Add a Tier 3 educational
nudge for first-month patients only.**

This question has been addressed in detail in two prior sign-off rounds
(the original 5-question batch and the May 10 follow-up). The answer is
consistent: the 2-of-3-day rolling window is the correct default
threshold.

**Why NOT single-miss for all patients (Option a):**

The AHA Scientific Statement on Medication Adherence defines
nonadherence using the widely adopted ≥80% threshold — a single missed
dose does not meet any validated nonadherence
definition.[\[13\]](#choudhry-nk,-kronish-im,-vongpatanasin-w,-et-al.-\<a-target="_blank"-href="https://www.ncbi.nlm.nih.gov/pmc/articles/pmc11485247/"\>medication-adherence-and-blood-pressure-control:-a-scientific-statement-from-the-american-heart-association\</a\>.-hypertension-\(dallas,-tex.-:-1979\).-2022;79\(1\):e1-e14.-doi:10.1161/hyp.0000000000000203.)
Long-acting antihypertensives maintain most of their BP-lowering effect
for 24–48 hours after a missed dose. A single-miss alert for every
patient would generate Tier 2 badges for patients who simply forgot to
log (took the medication but didn't report it), took the dose 2 hours
late, or had a one-time disruption to their routine. The AHA statement
notes that electronic monitors are most effective "when combined with
reminder messages for patients who have missed doses" — but the key
finding is that targeted reminders outperform universal
ones.[\[13\]](#choudhry-nk,-kronish-im,-vongpatanasin-w,-et-al.-\<a-target="_blank"-href="https://www.ncbi.nlm.nih.gov/pmc/articles/pmc11485247/"\>medication-adherence-and-blood-pressure-control:-a-scientific-statement-from-the-american-heart-association\</a\>.-hypertension-\(dallas,-tex.-:-1979\).-2022;79\(1\):e1-e14.-doi:10.1161/hyp.0000000000000203.)

**Why NOT 2 consecutive misses (Option b):**

Two consecutive misses of the SAME medication is too narrow. A patient
who misses Lisinopril on Monday and Metoprolol on Wednesday has a
non-adherence pattern, but Option b would not detect it because neither
medication was missed consecutively. The 2-of-3-day rolling window
captures cross-medication patterns.

**The QA team's concern is valid — address it with a first-month
educational nudge:**

The QA team flagged that first-month patients on a new medication may
benefit from a gentle nudge after one miss. This is clinically
supported: the AHA statement identifies the first 30 days as the
highest-risk period for non-adherence, and beta-blocker-induced
bradyarrhythmia develops within 2 months of initiation with most
agents.[\[6\]](#motoishi-h,-uesawa-y,-ishii-nozawa-r.-\<a-target="_blank"-href="https://pubmed.ncbi.nlm.nih.gov/39443084"\>evaluation-of-β-blocker-induced-bradyarrhythmia-using-an-analysis-of-the-japanese-adverse-drug-event-report-database\</a\>.-biological-&-pharmaceutical-bulletin.-2024;47\(10\):1668-1674.-doi:10.1248/bpb.b24-00305.)[\[13\]](#choudhry-nk,-kronish-im,-vongpatanasin-w,-et-al.-\<a-target="_blank"-href="https://www.ncbi.nlm.nih.gov/pmc/articles/pmc11485247/"\>medication-adherence-and-blood-pressure-control:-a-scientific-statement-from-the-american-heart-association\</a\>.-hypertension-\(dallas,-tex.-:-1979\).-2022;79\(1\):e1-e14.-doi:10.1161/hyp.0000000000000203.)[\[14\]](#simon-st,-kini-v,-levy-ae,-ho-pm.-\<a-target="_blank"-href="https://pubmed.ncbi.nlm.nih.gov/34380627"\>medication-adherence-in-cardiovascular-medicine\</a\>.-bmj-\(clinical-research-ed.\).-2021;374:n1493.-doi:10.1136/bmj.n1493.)
The eHealth meta-analysis found that combined interventions (SMS +
telephone support) were the most effective for improving adherence in
CVD patients (SMD 0.89, 95% CI
0.22–1.57).[\[15\]](#miao-y,-luo-y,-zhao-y,-et-al.-\<a-target="_blank"-href="https://pubmed.ncbi.nlm.nih.gov/39008845"\>effectiveness-of-ehealth-interventions-in-improving-medication-adherence-among-patients-with-cardiovascular-disease:-systematic-review-and-meta-analysis\</a\>.-journal-of-medical-internet-research.-2024;26:e58013.-doi:10.2196/58013.)

**Implementation — hybrid approach:**

\`\`\`

DEFAULT RULE (all patients, all medications):

2-of-3-day rolling window → Tier 2 (unchanged)

BETA-BLOCKER EXCEPTION (HFrEF/HCM/AFib):

Single miss → Tier 2 (unchanged from prior sign-off)

NEW — FIRST-MONTH EDUCATIONAL NUDGE:

IF patient.enrollmentDate 30 days ago

AND patient reports first missed dose (any medication)

AND this is the FIRST time the nudge has fired

THEN fire Tier 3 educational message (one-time only)

→ Patient message:

"Starting a new medicine can take some getting used to.

If you missed a dose, try to take your next one on time.

Taking your medicine every day helps keep your blood

pressure steady. Your care team is here to help if

anything makes it hard to stay on schedule."

→ No provider notification (Tier 3, info-only)

→ Fires ONCE per patient (not per medication, not per miss)

→ After the one-time nudge, revert to 2-of-3 rolling window

\`\`\`

**Why one-time only:** The nudge is educational, not clinical. Firing it
repeatedly would create the same noise problem as Option a. One gentle
message in the first month establishes the expectation that the system
is watching and the care team is available. After that, the 2-of-3
pattern threshold takes over.

**Test case resolution:** Aisha single miss → Tier 3 educational nudge
fires (if within first 30 days of enrollment). If beyond 30 days, no
alert fires on single miss — 2-of-3 rolling window applies. test.fixme()
resolved.

\---

**SUMMARY TABLE**

| **\#** | **Question**                | **Decision**                                                                  | **Default Value**                                | **Test Case Resolved** | **References**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | --------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1     | Asymptomatic brady HR 40–49 | Tier 3 surveillance (no patient message) + auto-escalate if 45 on 3+ sessions | HR 40–49 = Tier 3                                | Nora HR 45 ✓           | [\[1\]](#wigginton-jg,-agarwal-s,-bartos-ja,-et-al.-\<a-target="_blank"-href="https://www.ahajournals.org/doi/10.1161/cir.0000000000001376?url_ver=z39.88-2003&rfr_id=ori:rid:crossref.org&rfr_dat=cr_pub%20%200pubmed"\>part-9:-adult-advanced-life-support:-2025-american-heart-association-guidelines-for-cardiopulmonary-resuscitation-and-emergency-cardiovascular-care\</a\>.-circulation.-2025;152\(16_suppl_2\):s538-s577.-doi:10.1161/cir.0000000000001376.)[\[2\]](#writing-committee-members,-kusumoto-fm,-schoenfeld-mh,-et-al.-\<a-target="_blank"-href="https://doi.org/10.1016/j.hrthm.2018.10.037"\>2018-acc/aha/hrs-guideline-on-the-evaluation-and-management-of-patients-with-bradycardia-and-cardiac-conduction-delay:-a-report-of-the-american-college-of-cardiology/american-heart-association-task-force-on-clinical-practice-guidelines-and-the-heart-rhythm-society\</a\>.-heart-rhythm.-2019;16\(9\):e128-e226.-doi:10.1016/j.hrthm.2018.10.037.)[\[3\]](#sandau-ke,-funk-m,-auerbach-a,-et-al.-\<a-target="_blank"-href="https://www.ahajournals.org/doi/10.1161/cir.0000000000000527?url_ver=z39.88-2003&rfr_id=ori:rid:crossref.org&rfr_dat=cr_pub%20%200pubmed"\>update-to-practice-standards-for-electrocardiographic-monitoring-in-hospital-settings:-a-scientific-statement-from-the-american-heart-association\</a\>.-circulation.-2017;136\(19\):e273-e344.-doi:10.1161/cir.0000000000000527.)[\[4\]](#dharod-a,-soliman-ez,-dawood-f,-et-al.-\<a-target="_blank"-href="https://jamanetwork.com/journals/jamainternalmedicine/fullarticle/10.1001/jamainternmed.2015.7655?utm_source=openevidence&utm_medium=referral"\>association-of-asymptomatic-bradycardia-with-incident-cardiovascular-disease-and-mortality:-the-multi-ethnic-study-of-atherosclerosis-\(mesa\)\</a\>.-jama-internal-medicine.-2016;176\(2\):219-27.-doi:10.1001/jamainternmed.2015.7655.)[\[5\]](#tisdale-je,-chung-mk,-campbell-kb,-et-al.-\<a-target="_blank"-href="https://www.ahajournals.org/doi/abs/10.1161/cir.0000000000000905?url_ver=z39.88-2003&rfr_id=ori:rid:crossref.org&rfr_dat=cr_pub%20%200pubmed"\>drug-induced-arrhythmias:-a-scientific-statement-from-the-american-heart-association\</a\>.-circulation.-2020;142\(15\):e214-e233.-doi:10.1161/cir.0000000000000905.) |
| Q2     | CAD default sbpUpperTarget  | Option (b) — 140 mmHg                                                         | sbpUpperTarget = 140                             | Paul CAD 145 ✓         | [\[6\]](#motoishi-h,-uesawa-y,-ishii-nozawa-r.-\<a-target="_blank"-href="https://pubmed.ncbi.nlm.nih.gov/39443084"\>evaluation-of-β-blocker-induced-bradyarrhythmia-using-an-analysis-of-the-japanese-adverse-drug-event-report-database\</a\>.-biological-&-pharmaceutical-bulletin.-2024;47\(10\):1668-1674.-doi:10.1248/bpb.b24-00305.)[\[7\]](#jones-dw,-ferdinand-kc,-taler-sj,-et-al.-\<a-target="_blank"-href="https://linkinghub.elsevier.com/retrieve/pii/s0735-1097\(25\)06480-0"\>2025-aha/acc/aanp/aapa/abc/accp/acpm/ags/ama/aspc/nma/pcna/sgim-guideline-for-the-prevention,-detection,-evaluation,-and-management-of-high-blood-pressure-in-adults:-a-report-of-the-american-college-of-cardiology/american-heart-association-joint-committee-on-clinical-practice-guidelines\</a\>.-journal-of-the-american-college-of-cardiology.-2025;86\(18\):1567-1678.-doi:10.1016/j.jacc.2025.05.007.)[\[8\]](#virani-ss,-newby-lk,-arnold-sv,-et-al.-\<a-target="_blank"-href="https://linkinghub.elsevier.com/retrieve/pii/s0735-1097\(23\)05281-6"\>2023-aha/acc/accp/aspc/nla/pcna-guideline-for-the-management-of-patients-with-chronic-coronary-disease:-a-report-of-the-american-heart-association/american-college-of-cardiology-joint-committee-on-clinical-practice-guidelines\</a\>.-journal-of-the-american-college-of-cardiology.-2023;82\(9\):833-955.-doi:10.1016/j.jacc.2023.04.003.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Q3     | Single-miss adherence       | Option (c) — 2-of-3 rolling + first-month educational nudge                   | 2/3 days (default); single-miss nudge in month 1 | Aisha adherence ✓      | [\[9\]](#vidal-petiot-e,-greenlaw-n,-ford-i,-et-al.-\<a-target="_blank"-href="https://pubmed.ncbi.nlm.nih.gov/29084876"\>relationships-between-components-of-blood-pressure-and-cardiovascular-events-in-patients-with-stable-coronary-artery-disease-and-hypertension\</a\>.-hypertension-\(dallas,-tex.-:-1979\).-2018;71\(1\):168-176.-doi:10.1161/hypertensionaha.117.10204.)[\[10\]](#williams-ms,-levine-gn,-kalra-d,-et-al.-\<a-target="_blank"-href="https://linkinghub.elsevier.com/retrieve/pii/s0735-1097\(25\)00282-7"\>2025-aha/acc-clinical-performance-and-quality-measures-for-patients-with-chronic-coronary-disease:-a-report-of-the-american-college-of-cardiology/american-heart-association-joint-committee-on-performance-measures\</a\>.-journal-of-the-american-college-of-cardiology.-2025;85\(25\):2504-2535.-doi:10.1016/j.jacc.2025.02.001.)[\[11\]](#mcevoy-jw,-chen-y,-rawlings-a,-et-al.-\<a-target="_blank"-href="https://pubmed.ncbi.nlm.nih.gov/27590090"\>diastolic-blood-pressure,-subclinical-myocardial-damage,-and-cardiac-events:-implications-for-blood-pressure-control\</a\>.-journal-of-the-american-college-of-cardiology.-2016;68\(16\):1713-1722.-doi:10.1016/j.jacc.2016.07.754.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

\---

**ADDITIONAL NOTE — Post-Day3 145/95 Test Case**

The engineering team listed "Post-Day3 145/95" as a test.fixme() gated
on these answers. This test case is resolved by Q2: a CAD patient at
145/95 post-Day-3 (after the pre-Day-3 learning period) now fires a Tier
2 alert because 145 ≥ 140 (the new default sbpUpperTarget). The DBP of
95 also exceeds the dbpUpperTarget of 80, providing a second independent
alert trigger.

\---

**CONFIRMATION OF APPENDIX A SIDE-EFFECT RULES**

The engineering team noted that Niva shipped the Appendix A side-effect
rules this week (beta-blocker fatigue/SOB, NSAID interaction, ACE cough,
HF caregiver edema, medication hold). These are confirmed as correctly
implemented per the master consolidated guide. No changes needed — roll
to production as planned.

\---

Signed: Dr. Manisha Singal, CEO

Date: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

# References

1.  [Part 9: Adult Advanced Life Support: 2025 American Heart
    Association Guidelines for Cardiopulmonary Resuscitation and
    Emergency Cardiovascular
    Care.](https://www.ahajournals.org/doi/10.1161/CIR.0000000000001376?url_ver=Z39.88-2003&rfr_id=ori:rid:crossref.org&rfr_dat=cr_pub%20%200pubmed)
    Wigginton JG, Agarwal S, Bartos JA, et al. Circulation.
    2025;152(16\_suppl\_2):S538-S577. doi:10.1161/CIR.0000000000001376.

2.  [2018 ACC/AHA/HRS Guideline on The evaluation and Management
    Of patients With Bradycardia and Cardiac conduction Delay: A Report
    of the American College of Cardiology/American Heart Association
    Task Force on Clinical Practice Guidelines and the Heart Rhythm
    Society.](https://doi.org/10.1016/j.hrthm.2018.10.037) Writing
    Committee Members, Kusumoto FM, Schoenfeld MH, et al. Heart Rhythm.
    2019;16(9):e128-e226. doi:10.1016/j.hrthm.2018.10.037.

3.  [Update to Practice Standards for Electrocardiographic Monitoring in
    Hospital Settings: A Scientific Statement From the American Heart
    Association.](https://www.ahajournals.org/doi/10.1161/CIR.0000000000000527?url_ver=Z39.88-2003&rfr_id=ori:rid:crossref.org&rfr_dat=cr_pub%20%200pubmed)
    Sandau KE, Funk M, Auerbach A, et al. Circulation.
    2017;136(19):e273-e344. doi:10.1161/CIR.0000000000000527.

4.  [Association of Asymptomatic Bradycardia With Incident
    Cardiovascular Disease and Mortality: The Multi-Ethnic Study of
    Atherosclerosis
    (MESA).](https://jamanetwork.com/journals/jamainternalmedicine/fullarticle/10.1001/jamainternmed.2015.7655?utm_source=openevidence&utm_medium=referral)
    Dharod A, Soliman EZ, Dawood F, et al. JAMA Internal Medicine.
    2016;176(2):219-27. doi:10.1001/jamainternmed.2015.7655.

5.  [Drug-Induced Arrhythmias: A Scientific Statement From the American
    Heart
    Association.](https://www.ahajournals.org/doi/abs/10.1161/CIR.0000000000000905?url_ver=Z39.88-2003&rfr_id=ori:rid:crossref.org&rfr_dat=cr_pub%20%200pubmed)
    Tisdale JE, Chung MK, Campbell KB, et al. Circulation.
    2020;142(15):e214-e233. doi:10.1161/CIR.0000000000000905.

6.  [Evaluation of Β-Blocker-Induced Bradyarrhythmia Using an Analysis
    of the Japanese Adverse Drug Event Report
    Database.](https://pubmed.ncbi.nlm.nih.gov/39443084) Motoishi H,
    Uesawa Y, Ishii-Nozawa R. Biological & Pharmaceutical Bulletin.
    2024;47(10):1668-1674. doi:10.1248/bpb.b24-00305.

7.  [2025 AHA/ACC/AANP/AAPA/ABC/ACCP/ACPM/AGS/AMA/ASPC/NMA/PCNA/SGIM
    Guideline for the Prevention, Detection, Evaluation, and Management
    of High Blood Pressure in Adults: A Report of the American College
    of Cardiology/American Heart Association Joint Committee on Clinical
    Practice
    Guidelines.](https://linkinghub.elsevier.com/retrieve/pii/S0735-1097\(25\)06480-0)
    Jones DW, Ferdinand KC, Taler SJ, et al. Journal of the American
    College of Cardiology. 2025;86(18):1567-1678.
    doi:10.1016/j.jacc.2025.05.007.

8.  [2023 AHA/ACC/ACCP/ASPC/NLA/PCNA Guideline for the Management of
    Patients With Chronic Coronary Disease: A Report of the American
    Heart Association/American College of Cardiology Joint Committee on
    Clinical Practice
    Guidelines.](https://linkinghub.elsevier.com/retrieve/pii/S0735-1097\(23\)05281-6)
    Virani SS, Newby LK, Arnold SV, et al. Journal of the American
    College of Cardiology. 2023;82(9):833-955.
    doi:10.1016/j.jacc.2023.04.003.

9.  [Relationships Between Components of Blood Pressure and
    Cardiovascular Events in Patients With Stable Coronary Artery
    Disease and Hypertension.](https://pubmed.ncbi.nlm.nih.gov/29084876)
    Vidal-Petiot E, Greenlaw N, Ford I, et al. Hypertension (Dallas,
    Tex. : 1979). 2018;71(1):168-176.
    doi:10.1161/HYPERTENSIONAHA.117.10204.

10. [2025 AHA/ACC Clinical Performance and Quality Measures for Patients
    With Chronic Coronary Disease: A Report of the American College of
    Cardiology/American Heart Association Joint Committee on Performance
    Measures.](https://linkinghub.elsevier.com/retrieve/pii/S0735-1097\(25\)00282-7)
    Williams MS, Levine GN, Kalra D, et al. Journal of the American
    College of Cardiology. 2025;85(25):2504-2535.
    doi:10.1016/j.jacc.2025.02.001.

11. [Diastolic Blood Pressure, Subclinical Myocardial Damage, and
    Cardiac Events: Implications for Blood Pressure
    Control.](https://pubmed.ncbi.nlm.nih.gov/27590090) McEvoy JW, Chen
    Y, Rawlings A, et al. Journal of the American College of Cardiology.
    2016;68(16):1713-1722. doi:10.1016/j.jacc.2016.07.754.

12. [Impact of Pre-Procedural Blood Pressure on Long-Term Outcomes
    Following Percutaneous Coronary
    Intervention.](https://pubmed.ncbi.nlm.nih.gov/31171090) Warren J,
    Nanayakkara S, Andrianopoulos N, et al. Journal of the American
    College of Cardiology. 2019;73(22):2846-2855.
    doi:10.1016/j.jacc.2019.03.493.

13. [Medication Adherence and Blood Pressure Control: A Scientific
    Statement From the American Heart
    Association.](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11485247/)
    Choudhry NK, Kronish IM, Vongpatanasin W, et al. Hypertension
    (Dallas, Tex. : 1979). 2022;79(1):e1-e14.
    doi:10.1161/HYP.0000000000000203.

14. [Medication Adherence in Cardiovascular
    Medicine.](https://pubmed.ncbi.nlm.nih.gov/34380627) Simon ST, Kini
    V, Levy AE, Ho PM. BMJ (Clinical Research Ed.). 2021;374:n1493.
    doi:10.1136/bmj.n1493.

15. [Effectiveness of eHealth Interventions in Improving Medication
    Adherence Among Patients With Cardiovascular Disease: Systematic
    Review and Meta-Analysis.](https://pubmed.ncbi.nlm.nih.gov/39008845)
    Miao Y, Luo Y, Zhao Y, et al. Journal of Medical Internet Research.
    2024;26:e58013. doi:10.2196/58013.
