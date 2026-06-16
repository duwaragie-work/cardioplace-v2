# Cardioplace D4 Backlog #1 — Patient Age Wording Sign-Off

**Title:** Patient Age in Physician-Tier Messages — Clinical Wording Sign-Off
**Date:** 2026-06-09
**Prepared for:** Duwaragie Kugaraj (Dev 3), Ruhim (CTO)
**Reviewed by:** Dr. Manisha Singal (CMO)
**Re:** D4 Decision 4 backlog #1 — `patientAgeYears` rendering in per-rule physician messages (issue #68)
**Status:** SIGNED OFF — proceed with implementation per decisions below

---

## Overview

Engineering has landed the plumbing for the `agePhrase(ctx)` helper (issue #68). The patient's age, computed at fire-time from `User.dateOfBirth`, is available to every alert message and renders `"(age X)"` or empty string when DOB is missing or implausible (>130 years).

No engine changes, no escalation behavior changes, no schema changes — purely wording.

Helper behavior confirmed:
- Renders `"(age X)"` inline after BP/HR value
- Empty when DOB is missing, future-dated, or implausibly high

---

## Candidate A — `RULE_BRADY_SURVEILLANCE`

**Decision:** APPROVED AS DRAFTED

**Proposed wording:**

> BRADY SURVEILLANCE — HR ${hr} bpm (age ${ageX}). Sustained HR ≤49 bpm in a patient on rate-controlling medication. Consider 24h ambulatory monitoring.

**Clinical rationale:**

The MESA study (Dharod et al., JAMA Internal Medicine 2016) demonstrated a J-shaped mortality curve in patients on HR-modifying medications. Among 902 participants taking HR-modifying drugs, HR <50 bpm was associated with a hazard ratio of 2.42 (95% CI 1.39–4.20; P=0.002) for all-cause mortality, compared with the 60–69 bpm reference range. This elevated risk was not observed in participants not taking HR-modifying drugs (HR 0.71, 95% CI 0.41–1.09; P=0.12).

Age is a critical contextual variable for interpreting this finding:
- The MESA cohort enrolled adults aged 45–84 years (mean age 62 ± 10.2 years)
- Physiologic bradycardia (e.g., athletic conditioning) is more common in younger adults and carries no adverse prognosis
- In older adults on rate-controlling medications, bradycardia more likely reflects excessive pharmacologic effect or conduction disease
- The clinical decision (hold medication, reduce dose, order ambulatory monitoring, or reassure) is directly influenced by whether the patient is 48 or 78

Surfacing age helps the provider rapidly distinguish physiologic from pharmacologic bradycardia and calibrate the urgency of the response.

**Evidence basis:**
- MESA study (Dharod et al., JAMA Intern Med 2016;176(2):219-227)
- 2023 ACC/AHA/ACCP/HRS AF Guideline, Section 7.1: rate-control targets and populations that may benefit from lower HR goals

---

## Candidate B — `RULE_CAD_DBP_CRITICAL`

**Decision:** APPROVED AS DRAFTED

**Proposed wording:**

> CAD DBP CRITICAL — DBP < ${threshold}: ${bp} (age ${ageX}). Low DBP may compromise coronary perfusion (J-curve). Assess for symptomatic hypotension. Consider dose reduction of antihypertensives, particularly vasodilators.

**Clinical rationale:**

Age is the single most important confounder in the DBP J-curve relationship, and surfacing it at the point of alert is directly clinically informative.

The 2025 AHA/ACC Hypertension Guideline states that in CCD patients with SBP <130 mmHg, a DBP between 70 and 80 mmHg is associated with reduced cardiovascular events without an increase in serious adverse events. The 2023 AHA/ACC CCD Guideline confirms: "Optimal diastolic BP for clinical outcomes appears to be in the range of 70 to 80 mm Hg."

The AHA/ACC/ASH 2015 Scientific Statement on Hypertension in CAD provides the physiologic basis: coronary perfusion occurs almost exclusively during diastole, and the lower autoregulatory limit is shifted upward in patients with structural CAD and LV hypertrophy. In the INVEST secondary analysis, the primary outcome (all-cause death, nonfatal stroke, nonfatal MI) doubled when DBP was <70 mmHg and quadrupled when <60 mmHg.

Why age matters specifically for this rule:
- The AHA/ACC/ASH statement explicitly notes: "Age, DBP, and cardiovascular risk are positively associated until approximately 50 years of age. For the remainder of life, DBP decreases and pulse pressure widens, whereas cardiovascular risk increases exponentially."
- "The prevalence of fatal ischemic cardiac events increases by 64-fold as age doubles from 40 to 80 years."
- A MESA analysis found that DBP <60 mmHg was associated with increased coronary events (HR 1.69, 95% CI 1.02–2.79) and all-cause mortality (HR 1.48, 95% CI 1.10–2.00), with the association appearing strongest in individuals with subclinical atherosclerosis
- The effects of low DBP cannot be separated easily from those of aging in predicting MI risk — this confounder is precisely why surfacing age helps the provider interpret the J-curve alert

A CAD patient with DBP 55 at age 52 carries a different risk profile than the same reading at age 79. The provider needs age to judge whether the J-curve note is the primary concern or an incidental detail.

**Evidence basis:**
- 2025 AHA/ACC Hypertension Guideline, Section 5.3.3: CCD (Jones et al., JACC 2025;86(18):1567-1678)
- 2023 AHA/ACC CCD Guideline, Section 4.2.7: BP Management (Virani et al., JACC 2023;82(9):833-955)
- AHA/ACC/ASH Scientific Statement on HTN in CAD (Rosendorff et al., JACC 2015;65(18):1998-2038)
- MESA DBP and coronary events (Rahman et al., Am J Cardiol 2017;120(10):1797-1803)
- MESA DBP and subclinical myocardial damage (McEvoy et al., JACC 2016;68(16):1713-1722)

---

## Candidate C — `RULE_STANDARD_L1_HIGH`

**Decision:** APPROVED AS DRAFTED

**Proposed wording:**

> BP Level 1 High — severe Stage 2 (≥160/100) at ${bp} (age ${ageX}).

**Clinical rationale:**

The 2025 AHA/ACC Hypertension Guideline uses a risk-based rather than age-based framework for treatment initiation thresholds. The key differentiator is CVD risk (PREVENT ≥7.5%), clinical CVD, diabetes, or CKD — not a specific age cutoff. However, age remains a practical proxy for risk stratification at the point of triage for several reasons:

- The prior 2017 guideline included a specific recommendation for adults ≥65 years with SBP 130–139 mmHg, and the 2025 guideline notes that individualization may be required in patients with limited life expectancy, frailty, or high comorbidity burden
- The 2025 guideline recommends shared decision-making for BP goals in patients with "limited life expectancy or [who are] institutionalized due to high burden of frailty and comorbidity" — age is a key input to this judgment
- Adverse effects of intensive antihypertensive therapy (hypotension, syncope, injurious falls, electrolyte abnormalities) are more common in older adults
- A 165/100 reading in a 42-year-old versus a 78-year-old carries different clinical urgency profiles: the younger patient may need workup for secondary causes; the older patient may need assessment of tolerability and fall risk before intensifying therapy
- The 2022 ACC/AHA harmonization statement notes that for older adults (≥65 years), the target is SBP <130 mmHg "if tolerated," with treatment decisions based on clinical judgment, patient preference, and team-based risk/benefit assessment for those with high comorbidity burden

The age suffix adds value without changing the alert's clinical action — it helps the provider contextualize the reading and calibrate the response.

**Clinical note:** Duwaragie correctly flagged uncertainty about this candidate. The age suffix is less critical here than in Candidates A and B, where age directly modifies the clinical interpretation of the finding (bradycardia physiology, J-curve perfusion risk). For RULE_STANDARD_L1_HIGH, age is contextual rather than interpretive — but it is still useful for rapid triage and is consistent with the platform's goal of surfacing clinically relevant patient context in physician-tier messages.

**Evidence basis:**
- 2025 AHA/ACC Hypertension Guideline, Section 5.2.2: Treatment Thresholds (Jones et al., JACC 2025;86(18):1567-1678)
- AHA/ACC Scientific Statement on Risk Assessment for BP Management (Khan et al., JACC 2025;86(18):1539-1559)
- 2025 Guideline-at-a-Glance (Gulati et al., JACC 2025;86(18):1560-1566)
- ACC/AHA and ESC/ESH Harmonization (Whelton et al., JACC 2022;80(12):1192-1201)

---

## Rules NOT receiving the age suffix — confirmed

The following rule categories are correctly excluded from the `agePhrase` suffix:

- Patient-tier wording: age isn't useful to the patient seeing their own alert
- Caregiver-tier wording: same logic — caregivers don't need raw age
- Pregnancy rules that already have gestational age: adding `"(age X)"` on top would clutter
- Emergency rules (`RULE_ABSOLUTE_EMERGENCY`, angioedema, etc.): the action is age-independent; adding age noise distracts from the 911 instruction

No additional rules are recommended for the age suffix at this time.

---

## Summary table

| Candidate | Rule | Decision | Key rationale |
|---|---|---|---|
| A | `RULE_BRADY_SURVEILLANCE` | APPROVED | MESA J-curve: HR <50 on rate-controlling meds → HR 2.42 for mortality; age distinguishes physiologic from pharmacologic bradycardia |
| B | `RULE_CAD_DBP_CRITICAL` | APPROVED | Age is the most important confounder in DBP J-curve; fatal ischemic events increase 64-fold from age 40 to 80 |
| C | `RULE_STANDARD_L1_HIGH` | APPROVED | Age contextualizes triage urgency and tolerability assessment; less critical than A/B but consistent with platform goals |

---

## Next steps

1. Patch the 3 approved rule messages in `shared/src/alert-messages.ts` (Candidates A, B, C)
2. Update message-registry snapshot tests
3. Ship as follow-on commit to the perennial branch
4. Close issue #68 (D4 #1)

No engine change, no escalation behavior change, no schema change — purely wording.

---

## References

1. Association of Asymptomatic Bradycardia With Incident Cardiovascular Disease and Mortality: The Multi-Ethnic Study of Atherosclerosis (MESA). Dharod A, Soliman EZ, Dawood F, et al. JAMA Internal Medicine. 2016;176(2):219-27. doi:10.1001/jamainternmed.2015.7655.
2. 2023 ACC/AHA/ACCP/HRS Guideline for the Diagnosis and Management of Atrial Fibrillation. Writing Committee Members, Joglar JA, Chung MK, et al. JACC. 2024;83(1):109-279. doi:10.1016/j.jacc.2023.08.017.
3. 2025 AHA/ACC/AANP/AAPA/ABC/ACCP/ACPM/AGS/AMA/ASPC/NMA/PCNA/SGIM Guideline for the Prevention, Detection, Evaluation, and Management of High Blood Pressure in Adults. Jones DW, Ferdinand KC, Taler SJ, et al. JACC. 2025;86(18):1567-1678. doi:10.1016/j.jacc.2025.05.007.
4. 2023 AHA/ACC/ACCP/ASPC/NLA/PCNA Guideline for the Management of Patients With Chronic Coronary Disease. Virani SS, Newby LK, Arnold SV, et al. JACC. 2023;82(9):833-955. doi:10.1016/j.jacc.2023.04.003.
5. Treatment of Hypertension in Patients With Coronary Artery Disease: A Scientific Statement. Rosendorff C, Lackland DT, Allison M, et al. JACC. 2015;65(18):1998-2038. doi:10.1016/j.jacc.2015.02.038.
6. Diastolic Blood Pressure, Subclinical Myocardial Damage, and Cardiac Events. McEvoy JW, Chen Y, Rawlings A, et al. JACC. 2016;68(16):1713-1722. doi:10.1016/j.jacc.2016.07.754.
7. Relation of Diastolic Blood Pressure and Coronary Artery Calcium to Coronary Events and Outcomes (MESA). Rahman F, Al Rifai M, Blaha MJ, et al. Am J Cardiol. 2017;120(10):1797-1803. doi:10.1016/j.amjcard.2017.07.094.
8. Use of Risk Assessment to Guide Decision-Making for Blood Pressure Management. Khan SS, Lloyd-Jones DM, Abdalla M, et al. JACC. 2025;86(18):1539-1559. doi:10.1016/j.jacc.2025.08.001.
9. ACC/AHA and ESC/ESH Harmonization of Blood Pressure/Hypertension Guidelines. Whelton PK, Carey RM, Mancia G, et al. JACC. 2022;80(12):1192-1201. doi:10.1016/j.jacc.2022.07.005.
10. 2025 High Blood Pressure Guideline-at-a-Glance. Gulati M, Moore MM, Cibotti-Sun M. JACC. 2025;86(18):1560-1566. doi:10.1016/j.jacc.2025.07.010.
