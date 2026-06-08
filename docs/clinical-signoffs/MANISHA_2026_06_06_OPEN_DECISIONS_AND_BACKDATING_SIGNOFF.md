# Cardioplace Backdated Readings — Clinical Sign-Off Review

Clinical Sign-Off Review: Backdated Readings & Alert Firing Date:
2026-06-06

Prepared for: Duwaragie Kugaraj (Dev 3), Ruhim (CTO) Reviewed by: Dr.
Manisha Singal (CMO)

Re: Clinical review of consolidated backdated-reading policy (Duwaragie
2026-06-05)

\---

OVERALL ASSESSMENT

The core architecture — accept all data, gate alerts by 24h, dual-gate
logic (structural +

time-window) — is clinically sound and aligned with the 2025 AHA/ACC
guideline framework for distinguishing hypertensive emergency from
severe asymptomatic hypertension. The 24- hour threshold is a reasonable
clinical boundary for the MVP.

\---

RECHECK ITEM \#1: Suppressing the L2 911 CTA on 1–24h Delayed Entries
Status: CLINICALLY APPROPRIATE — SIGN OFF

The 2025 AHA/ACC Hypertension Guidelines define hypertensive emergencies
as severe BP elevations (\>180/120 mmHg) associated with evidence of
acute target organ damage, emphasizing "rapid recognition of the problem
and early initiation of appropriate antihypertensive treatment." The
entire clinical rationale for a 911 CTA rests on the assumption that the
patient is in crisis right now. A reading entered 1–24 hours after
measurement cannot support that assumption.

Firing a 911 CTA on stale data creates two failure modes:

  - > False urgency: The crisis resolved hours ago; the patient panics
    > unnecessarily, potentially calling 911 for a non-event.

  - > False reassurance of action: The system "did something" (fired an
    > alert), but the clinical window for meaningful intervention has
    > narrowed or closed.

The 2025 guidelines also note that patients with severe hypertension
without evidence of acute target organ damage (formerly "hypertensive
urgency") should be managed with reinstitution or intensification of
oral antihypertensive medications in the outpatient setting

— not aggressive acute BP lowering. A delayed entry, by definition,
lacks real-time evidence

of target organ damage, making the provider-verification pathway the
correct clinical posture.

The provider-only flag with the standard escalation ladder is the
correct compromise. It ensures the care team is notified to verify the
patient's current status without triggering an inappropriate
patient-facing emergency response.

Refinement: The provider-only flag message should explicitly prompt the
provider to assess for symptoms of target organ damage when they reach
the patient:

"Delayed entry: patient reported \[BP\] for \[date/time\]. Reading
entered \[X\] hours later. Verify current BP and assess for headache,
visual changes, chest pain, or dyspnea. If unable to reach patient,
escalate per standard protocol."

\---

RECHECK ITEM \#2: L1 Provider-Only Disclaimer Mechanic Status:
WELL-DESIGNED — NO CHANGES NEEDED — SIGN OFF

The approach — identical patient-facing messaging for real-time and
delayed L1 alerts, with a "DELAYED" badge and disclaimer visible only to
the provider — is the right architecture:

  - > Level 1 alerts are inherently less time-sensitive. A 1–24h delay
    > does not fundamentally change the clinical action.

  - > The patient already knows the reading is backdated (they typed in
    > a past time). Repeating this in the alert message adds no clinical
    > value.

  - > The provider needs the delay context for medication titration
    > decisions and audit trail integrity. The "DELAYED" badge on the
    > Alerts tab, the disclaimer in the T+0 escalation email, and the
    > audit-trail entry all serve this purpose.

\---

OPEN QUESTION RESPONSES

CMS Billing (§11 \#7) — Accept-but-don't-count approach for CPT 99454
The accept-but-tag approach is more defensible than hard rejection:

  - > CMS intent is near-real-time monitoring. The delay*band tag
    > creates a transparent audit trail showing which readings reflect
    > genuine daily monitoring versus historical backfill.*

  - > Readings tagged historical*entry (\>24h) should NOT count toward
    > the 16-day threshold.*

  - > Hard rejection destroys data that has legitimate clinical value
    > for trend analysis and provider review.

  - > The billing-export view should clearly delineate: (a) days with
    > real-time or near-real-time entries (count toward 99454), (b) days
    > with only delayed entries 1–24h (likely countable but flag for
    > review), and (c) days with only historical entries \>24h (do not
    > count).

UX for \>24h Entries — Option A vs. Option B

Option B (transparent informational note) is recommended. The AHA/AMA
Joint Policy Statement emphasizes that patients should understand how
their data is used and that the transmission of SMBP readings to the
care team should be transparent. Telling the patient their reading is
recorded but won't trigger a real-time alert is honest, non-judgmental,
and prevents the patient from expecting a follow-up call that won't
come.

Retrospective Symptom Reporting (§11 \#8)

This should be handled separately from BP readings. A patient reporting
"I had chest pain two weeks ago" is qualitatively different from a
backdated BP number. The 24h delay-band framework does not cleanly
apply. A brief separate sign-off document should address: (a) visibility
to the provider as a flagged note, (b) whether it triggers a
non-alerting workflow for next-visit review, and (c) whether certain
symptom types (e.g., chest pain, neurological symptoms) warrant a
different threshold than others.

\---

SUMMARY OF RECOMMENDATIONS

<table>
<thead>
<tr class="header">
<th><strong>Item</strong></th>
<th><blockquote>
<p><strong>Recommendation</strong></p>
</blockquote></th>
<th><blockquote>
<p><strong>Rationale</strong></p>
</blockquote></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><p>L2 911 CTA</p>
<p>suppression (1– 24h)</p></td>
<td><blockquote>
<p>Sign off — clinically appropriate</p>
</blockquote></td>
<td><blockquote>
<p>Stale data cannot confirm active target organ damage; provider-only flag preserves safety</p>
</blockquote></td>
</tr>
<tr class="even">
<td>L1 provider-only disclaimer</td>
<td><blockquote>
<p>Sign off — no changes needed</p>
</blockquote></td>
<td><blockquote>
<p>Patient sees standard message; provider gets delay context for clinical interpretation</p>
</blockquote></td>
</tr>
<tr class="odd">
<td>Provider flag wording</td>
<td><blockquote>
<p>Add symptom- assessment prompt</p>
</blockquote></td>
<td><blockquote>
<p>"Verify current BP and assess for headache, visual changes, chest pain, dyspnea"</p>
</blockquote></td>
</tr>
<tr class="even">
<td>CMS 99454 billing</td>
<td><blockquote>
<p>Accept-but-tag is defensible</p>
</blockquote></td>
<td><blockquote>
<p>delay_band creates transparent audit trail; historical entries don't count toward 16-day requirement</p>
</blockquote></td>
</tr>
</tbody>
</table>

<table>
<thead>
<tr class="header">
<th><strong>Item</strong></th>
<th><blockquote>
<p><strong>Recommendation</strong></p>
</blockquote></th>
<th><blockquote>
<p><strong>Rationale</strong></p>
</blockquote></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>UX for &gt;24h entries</td>
<td><blockquote>
<p>Option B — transparent note</p>
</blockquote></td>
<td><blockquote>
<p>Aligns with AHA/AMA transparency principles and prevents false expectation of follow-up</p>
</blockquote></td>
</tr>
<tr class="even">
<td>Retrospective symptoms</td>
<td><blockquote>
<p>Separate sign-off document needed</p>
</blockquote></td>
<td><blockquote>
<p>Qualitatively different from BP readings; needs its own clinical logic</p>
</blockquote></td>
</tr>
</tbody>
</table>

\--- REFERENCES

  - > 2025 AHA/ACC Hypertension Guidelines (Jones DW et al., JACC
    > 2025;86(18):1567-1678)

  - > 2017 ACC/AHA Hypertension Guidelines (Whelton PK et al., JACC
    > 2018;71(19):e127-e248)

  - > AHA/AMA Joint Policy Statement on Self-Measured Blood Pressure
    > Monitoring (Shimbo D et al., Circulation 2020;142(4):e42-e63)

  - > AHA/AMA Scientific Statement on Implementation Strategies (Abdalla
    > M et al., Hypertension 2023;80(10):e143-e157)

# Cardioplace Open Decisions Post Handoff 4 — Clinical Sign-Off

Clinical Sign-Off: Open Decisions Post Handoff 4 Date: 2026-06-06

Prepared for: Duwaragie Kugaraj (Dev 3), Ruhim (CTO) Reviewed by: Dr.
Manisha Singal (CMO)

Re: Clinical sign-off on 5 open decisions from Handoff 4 (2026-06-04)

Status: SIGNED OFF — proceed with implementation per recommendations
below

\---

DECISION 1 — ALERT BANNER COLORS TIER*1*CONTRAINDICATION: STAY RED —
SIGNED OFF

Contraindication alerts (e.g., ACE inhibitor in pregnancy, NDHP-CCB in
HFrEF) represent situations where continued medication exposure carries
risk of serious harm. ACE inhibitors/ARBs are category X in pregnancy
and can cause renal dysgenesis, oligohydramnios, calvarial and pulmonary
hypoplasia, and fetal death, particularly in the second and third
trimesters. A meta-analysis found that even first-trimester ACE-I/ARB
exposure was associated with nearly doubled odds of major congenital
malformations (OR

\~1.8) compared to unexposed controls.

The visual urgency of red is clinically warranted — this is not a "we'll
get to it" situation. The patient message may say "we'll contact you,"
but the underlying clinical signal is that continued exposure is
harmful. Downgrading to orange/yellow would weaken the visual signal in
a way that could delay provider response.

Duwaragie was right to hold on this. The CDSS literature consistently
recommends that alert color should match clinical severity, and
contraindications are by definition critical.

TIER*3*INFO: MOVE TO BLUE (admin app only) — SIGNED OFF

This is a non-patient-facing change. Blue is the standard informational
color in clinical decision support systems and aligns with the
traffic-light schema already established for the provider dashboard (red
= critical, amber = caution, yellow = elevated, blue/gray =
informational). Green could be confused with "normal/safe" — which is
not the right signal for an informational alert that still requires
provider awareness.

All other tiers: CONFIRMED AS-IS

Evidence basis:

  - > JACC State-of-the-Art Review on cardiovascular medications in
    > pregnancy (Halpern et al., JACC 2019;73(4):457-476)

  - > Meta-analysis of ACE-I/ARB congenital malformation risk (Fu et
    > al., Diabetes Metab Res Rev 2021;37(8):e3453)

  - > CDSS alert fatigue and design literature (Khalifa & Zabani, Stud
    > Health Technol Inform 2016;226:51-4; Hussain et al., JAMIA
    > 2019;26(10):1141-1149)

  - > CDSS design for medication prescribing (Horsky et al., Int J Med
    > Inform 2013;82(6):492-503)

\---

DECISION 2 — CAD THRESHOLD RECONCILIATION

OPTION 1 — UPDATE DOCUMENT 2 WORDING TO MATCH ENGINE (SBP ≥140 / DBP 70)
— SIGNED OFF

The Cluster 8 Q2 sign-off from 2026-05-18 should stand. The engine
threshold of SBP ≥140 is the correct alert-firing threshold; the ≥130
value in Document 2 is a treatment-initiation target, not an alert
threshold.

Clinical reasoning:

The 2023 AHA/ACC Chronic Coronary Disease Guideline recommends a BP
target of 130/80 mmHg for adults with CCD and hypertension (Class 1,
Level B-R). The 2025 AHA/ACC Hypertension Guideline recommends
initiation of antihypertensive medications in adults with clinical CVD
when SBP is ≥130 mmHg or DBP is ≥80 mmHg. These are treatment initiation
thresholds and targets — they define when to start or intensify therapy.

However, the Cardioplace alert engine serves a different purpose: it
fires an alert to the provider when a reading exceeds a threshold that
warrants clinical attention within the remote monitoring workflow. The
engine threshold of SBP ≥140 was chosen to avoid alert fatigue — firing
at 130 in a CAD population where \>60% have hypertension would generate
a very high volume of alerts, many of which would be for patients
already on therapy with readings in the 130–139 range (above target but
not acutely concerning). The CDSS literature shows that excessive
alerting leads to 33–96% of alerts being ignored.

The DBP 70 threshold for the low-DBP alert is clinically appropriate.
The 2023 CCD guideline notes that "optimal diastolic BP for clinical
outcomes appears to be in the range of 70 to 80 mmHg" in patients with
CCD. The AHA/ACC/ASH Scientific Statement on hypertension in CAD
specifically counsels caution with DBP 60 years, due to J-curve concerns
for coronary perfusion. A JAMA Network Open study confirmed that DBP 60
mmHg was associated with significantly increased cardiovascular risk in
patients with treated SBP 130 mmHg. The

engine threshold of 70 provides an appropriate early-warning buffer
above the danger zone of 60.

Action: Update Document 2 physician-tier wording to reference ≥140 (not
≥130) for the alert threshold. Patient and caregiver tiers are fine
as-is.

Evidence basis:

  - > 2023 AHA/ACC Chronic Coronary Disease Guideline (Virani et al.,
    > JACC 2023;82(9):833-955)

  - > 2025 AHA/ACC Hypertension Guideline (Jones et al., JACC
    > 2025;86(18):1567-1678)

  - > AHA/ACC/ASH Scientific Statement on hypertension in CAD
    > (Rosendorff et al., JACC 2015;65(18):1998-2038)

  - > Optimal DBP in treated hypertension (Li et al., JAMA Netw Open
    > 2021;4(2):e2037554)

  - > 2025 AHA/ACC CCD Performance Measures (Williams et al., JACC
    > 2025;85(25):2504-2535)

\---

DECISION 4 — PHYSICIAN-TIER PLACEHOLDERS

OPTION 1 — BACKLOG ALL FOR POST-PILOT — SIGNED OFF (with one conditional
exception)

The missing variables (\[gestational age\], \[age\], \[medication
list\]) are clinically informative but do not change the clinical action
prompted by the alert. The provider receiving a pregnancy-related
contraindication alert will already know the patient is pregnant (it's
in the patient profile) and can look up gestational age and medication
list in the chart. Threading these through the AlertContext is a
quality-of-life improvement, not a safety-critical gap.

Conditional exception: If the pilot includes pregnant patients on ACE
inhibitors/ARBs, the gestational age variable becomes more clinically
meaningful because the teratogenic risk profile differs by trimester —
first-trimester exposure carries a lower (but still elevated) risk
compared to second/third-trimester exposure, which causes the classic
fetopathy (renal dysgenesis, oligohydramnios, pulmonary hypoplasia). If
the pilot population includes pregnant patients, prioritize gestational
age threading. If not, backlog all three.

Backlog ticket: "Thread gestational age + age + medication list through
AlertContext." Estimated cost per Duwaragie: \~1 dev-day to add fields +
26 rule updates + new snapshots.

Evidence basis:

  - > JACC State-of-the-Art Review on cardiovascular medications in
    > pregnancy (Halpern et al., JACC 2019;73(4):457-476)

  - > ADA Standards of Care 2026, Chapter 15: Management of Diabetes in
    > Pregnancy (Diabetes Care 2026;49(S1):S321-S338)

  - > ESC ROPAC Registry: ACE-I/ARB use during pregnancy (van der Zande
    > et al., Am J Cardiol 2024;230:27-36)

\---

DECISION 5 — PATIENT OUT-OF-APP EMAIL FOR TIER*1*CONTRAINDICATION ADD
PATIENT EMAIL AT T+0 — SIGNED OFF

This is the most clinically important of the 5 decisions.

ACE inhibitors and ARBs are category X in pregnancy — they should be
stopped as soon as possible in the first trimester to avoid second- and
third-trimester fetopathy. The ADA Standards of Care 2026 and the JACC
State-of-the-Art Review both emphasize that these medications should be
withheld in the pre-conception period and discontinued promptly upon
discovery of pregnancy. Every additional dose of a contraindicated
medication during pregnancy represents continued fetal exposure to a
known teratogen.

The concern about panic-driven self-discontinuation is valid but is
already addressed by the Document 2 wording, which explicitly states
"please don't stop any medicine without talking to your doctor." The
email body should use this exact framing. The HRS consensus statement
supports the principle that actionable events should be promptly
communicated to patients, with the mode of communication tailored to
clinical relevance and actionability. A medication contraindication is
by definition an actionable event.

The risk calculus is asymmetric: the harm of the patient taking another
dose of a teratogenic medication before opening the app (which could be
hours or days) outweighs the risk of the patient reading an email that
says "important medication alert — your care team is contacting you,
please don't stop any medicine on your own."

Recommended email template:

Subject: Important medication alert from your care team

Body: "We noticed something important about one of your medications.
Your care team is reviewing this and will contact you soon. Please don't
stop any medicine without talking to your doctor. If you have questions,
call \[clinic number\]."

Implementation: Small backend change (\~1 line in the ladder
definition). Email template already supports patient role.

Evidence basis:

  - > JACC State-of-the-Art Review on cardiovascular medications in
    > pregnancy (Halpern et al., JACC 2019;73(4):457-476)

  - > ADA Standards of Care 2026, Chapter 15: Management of Diabetes in
    > Pregnancy (Diabetes Care 2026;49(S1):S321-S338)

  - > ADA Standards of Care 2026, Chapter 10: Cardiovascular Disease and
    > Risk Management (Diabetes Care 2026;49(S1):S216-S245)

  - > 2023 HRS/EHRA/APHRS/LAHRS Expert Consensus Statement on Remote
    > Device Clinic Management (Ferrick et al., Heart Rhythm
    > 2023;20(9):e92-e144)

\---

DECISION 6 — PATIENT OUT-OF-APP EMAIL FOR BP*LEVEL*1*HIGH*
COHORT-SPECIFIC — ADD FOR STANDARD COHORT ONLY — SIGNED OFF

Duwaragie's recommendation is correct. A standard-cohort patient at
165/100 is experiencing a clinically meaningful event — this is severe
Stage 2 hypertension. The 2025 AHA/ACC guidelines recommend medication
initiation at SBP ≥140 for the general population, and a reading of
165/100 is well above this threshold. If the patient doesn't open the
app for hours, they miss the alert entirely.

For personalized-threshold cohorts (HFrEF, HCM), the rationale for
suppressing the patient email is sound: these patients are on tighter
thresholds, their providers are already alerted, and the lower
thresholds would generate more frequent emails that could cause alarm
fatigue in the patient. The distinction is clinically appropriate.

Implementation:

  - > Standard-cohort patients: add patient-EMAIL back to
    > BP*LEVEL*1*HIGH ladder at T+0*

  - > Personalized-threshold cohorts (HFrEF, HCM): leave as-is (no
    > patient email) Evidence basis:

  - > 2025 AHA/ACC Hypertension Guideline (Jones et al., JACC
    > 2025;86(18):1567-1678)

\---

SUMMARY TABLE

<table>
<thead>
<tr class="header">
<th><strong>Decision</strong></th>
<th><blockquote>
<p><strong>Recommendation</strong></p>
</blockquote></th>
<th><strong>Status</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><p>1: TIER&lt;em&gt;1&lt;/em&gt;CONTRAINDICATION</p>
<p>color</p></td>
<td><blockquote>
<p>Stay RED</p>
</blockquote></td>
<td>SIGNED OFF</td>
</tr>
</tbody>
</table>

<table>
<thead>
<tr class="header">
<th><strong>Decision</strong></th>
<th><blockquote>
<p><strong>Recommendation</strong></p>
</blockquote></th>
<th><strong>Status</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>1: TIER&lt;em&gt;3&lt;/em&gt;INFO color</td>
<td><blockquote>
<p>Move to BLUE (admin app only)</p>
</blockquote></td>
<td>SIGNED OFF</td>
</tr>
<tr class="even">
<td>2: CAD threshold</td>
<td><blockquote>
<p>Option 1 — update Doc 2 wording to match engine (140/70)</p>
</blockquote></td>
<td>SIGNED OFF</td>
</tr>
<tr class="odd">
<td>4: Physician placeholders</td>
<td><blockquote>
<p>Option 1 — backlog all (exception: gestational age if pilot includes pregnant patients)</p>
</blockquote></td>
<td>SIGNED OFF</td>
</tr>
<tr class="even">
<td><p>5: TIER&lt;em&gt;1&lt;/em&gt;CONTRAINDICATION</p>
<p>patient email</p></td>
<td><blockquote>
<p>Add patient email at T+0 with "don't stop on your own" framing</p>
</blockquote></td>
<td>SIGNED OFF</td>
</tr>
<tr class="odd">
<td>6: BP&lt;em&gt;LEVEL&lt;/em&gt;1_HIGH patient email</td>
<td><blockquote>
<p>Cohort-specific — add for standard cohort only</p>
</blockquote></td>
<td>SIGNED OFF</td>
</tr>
</tbody>
</table>

\---

NEXT STEPS

All 5 decisions are signed off. Duwaragie can proceed with the follow-on
commit:

1.  > Decision 1: No code change needed for TIER*1*CONTRAINDICATION
    > (stays red). Patch TIER*3*INFO to blue in admin app.

2.  > Decision 2: Update Document 2 physician-tier CAD wording to
    > reference ≥140 / 70.

3.  > Decision 4: Create backlog ticket for AlertContext variable
    > threading. No pilot-blocking work unless pregnant patients are in
    > the pilot population.

4.  > Decision 5: Add patient-EMAIL to TIER*1*CONTRAINDICATION T+0
    > dispatch. Use recommended email template above.

5.  > Decision 6: Add patient-EMAIL to BP*LEVEL*1*HIGH for
    > standard-cohort patients only. Personalized-threshold cohorts
    > remain suppressed.*

No full handoff needed — these are small patches per Duwaragie's
original assessment.
