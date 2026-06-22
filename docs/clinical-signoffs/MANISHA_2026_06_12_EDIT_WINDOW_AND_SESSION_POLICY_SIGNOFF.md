# Cardioplace v2 — Edit/Delete Window + Session Policy: Clinical Sign-Off

**Date:** 2026-06-12
**Prepared for:** Duwaragie Kugaraj (Dev 3), Ruhim (CTO)
**Reviewed by:** Dr. Manisha Singal (CMO)
**Re:** Combined sign-off on (a) the 5-minute create/edit/delete window, (b) emergency rule handling, (c) patient app sessioning, and (d) window duration
**Status:** SIGNED OFF — proceed with implementation per decisions below

---

## Q1 — FRONT-END BUFFER FOR NON-EMERGENCY READINGS

**Decision:** YES — front-end buffer for non-emergency readings is clinically acceptable.

The 5-minute front-end hold is well within the clinical tolerance for non-emergency HBPM data. The AHA/AMA Joint Policy Statement recommends SMBP be based on ≥2 measurements with clinical decisions based on averages over days to weeks — not individual readings in real time. The 2025 AHA/ACC Hypertension Guideline reinforces that a "single reading is inadequate for clinical decision-making." For non-emergency rules, the session window already imposes a comparable wait — the front-end buffer simply shifts where the wait happens, while giving the patient a typo-correction opportunity.

The 5-minute duration (vs. Ruhim's proposed 2 minutes) is appropriate given the multi-step check-in form, the elderly patient population, and the AHA recommendation of ≥5 minutes of quiet rest before BP measurements.

---

## Q2 — EMERGENCY RULES: HOW SHOULD THEY BE HANDLED?

**Decision:** HYBRID — Option D (retake-to-confirm) for BP-only emergencies + Option A (immediate fire) for symptom-override emergencies.

### Part 1: BP-only emergency triggers (RULE_ABSOLUTE_EMERGENCY based on BP ≥180/120 without co-occurring symptoms) → OPTION D

Hypertensive emergency requires target organ damage, not just a number. The 2025 AHA/ACC Hypertension Guideline defines hypertensive emergencies as "severe elevations in BP (>180/120 mmHg) associated with evidence of acute target organ damage." Patients with severe hypertension without evidence of acute target organ damage "should not have aggressive BP lowering in the short-term."

Guidelines universally recommend multiple readings. The 2025 AHA/ACC Guideline states a "single reading is inadequate for clinical decision-making." Acting on a single manually entered reading contradicts this foundational principle.

Spontaneous BP normalization is common — 40–50% of asymptomatic severe hypertension cases in hospitalized patients normalize without antihypertensives. A single extreme home reading is even less reliable.

Real-world RPM programs (Brigham, Penn) use confirmation-first approaches — they trigger alert reports for critical BP values that are triaged by pharmacist/NP with phone calls, not immediate 911 CTAs.

**Implementation of Option D for BP-only emergencies:**

- Patient submits a reading in emergency range (≥180/120)
- App does NOT submit to backend immediately
- Review screen: *"Your reading of [BP] is very high. Please sit calmly for 1 minute, then take a second reading to confirm."*
- Patient takes a second reading after rest period
- **If second reading also emergency** → fire alert (provider paged, full escalation ladder)
- **If second reading NOT emergency** → both readings logged; no emergency alert fires; Tier 3 informational flag to provider: *"Patient's initial reading was [BP1] (emergency range); confirmatory reading was [BP2] (below emergency threshold). No emergency alert fired. Review at next encounter."*
- **If patient declines / closes app** → original reading submitted to backend after 5-minute window expires. Engine evaluates as single unconfirmed reading. **Tier 1 provider-only flag** (not Tier 2): *"Single unconfirmed emergency-range reading: [BP]. Patient did not complete confirmatory measurement. Recommend phone outreach to verify current status."*

### Part 2: Symptom-override emergencies → OPTION A (immediate fire)

Symptom-based emergency rules (chest pain, altered mental status, focal neurologic deficit, angioedema/airway symptoms) bypass the retake-to-confirm flow and fire immediately.

- These symptoms indicate potential acute target organ damage — the defining criterion for hypertensive emergency
- A patient reporting chest pain or neurological symptoms needs immediate triage regardless of BP
- Asking a patient with active chest pain to "sit calmly for 1 minute and retake" is clinically inappropriate
- These rules are not susceptible to typo problems — symptoms are selected from a checklist, not manually typed

### Summary

| Trigger | Behavior |
|---|---|
| BP ≥180/120 WITHOUT symptoms | Option D (retake-to-confirm) |
| BP ≥180/120 WITH symptoms (chest pain, AMS, focal neuro, airway) | Option A (immediate fire) |
| Symptom-only emergencies (angioedema at any BP) | Option A (immediate fire) |

### Typo-on-emergency workflow (already-fired alert)

The "we cannot un-page" principle is correct. Once an emergency alert has fired:
- Alert stays OPEN on provider dashboard
- Patient edits captured in audit log
- Provider resolves manually with documented rationale
- Provider training required as pilot-readiness item

---

## Q3 — PATIENT APP: SINGLE READING OR SESSION-BASED MULTI-READING?

**Decision:** OPTION C (HYBRID) — default single reading with guided prompt for a second reading.

The AHA/AMA Joint Policy Statement, 2017 ACC/AHA Guideline, VA/DoD Hypertension Guideline, and AHA Scientific Statement on BP Measurement all recommend ≥2 readings taken at least 1 minute apart for HBPM. This is a universal recommendation. Restricting patients to one reading per check-in (Option A) directly contradicts guideline consensus.

Ruhim's concern about elderly patient comprehension of "sessions" is valid. The hybrid approach resolves the tension.

### Implementation

1. **Default flow:** Patient takes one reading through the standard simple entry flow. No "session" language anywhere.
2. **After submission, during the 5-minute review window**, the app shows a gentle prompt: *"For the most accurate result, take a second reading after 1 minute of rest. [Take another reading] [I'm done]"*
3. **If patient takes a second reading**, both readings are grouped into the same session and averaged by the engine. Patient never sees the word "session."
4. **If patient taps "I'm done" or the 5-minute window expires**, single reading is submitted as-is.
5. **For AFib-flagged patients specifically:** the prompt after the first reading says *"Your care team has asked you to take 3 readings each time. Please rest 1 minute, then take your next reading."* The prompt repeats after the second reading. Preserves the 3-reading requirement without exposing session semantics.

### Why this is better than A or B

- Option A (single reading only) contradicts AHA/AMA/ACC/AHA/VA-DoD guidance and reduces data quality
- Option B (full session UI) exposes complexity that most elderly patients won't understand, and risks confusion or abandonment
- Option C preserves guideline-recommended multi-reading protocol while keeping the UX simple and non-intimidating

The key insight: the patient doesn't need to understand "sessions." They just need a gentle nudge to take a second reading. The engine handles grouping and averaging invisibly.

---

## Q4 — 5-MINUTE WINDOW DURATION

**Decision:** CONFIRMED AT 5 MINUTES.

- AHA recommends ≥5 minutes of quiet rest before BP measurements — review window aligns with clinical rest period
- Multi-step check-in form requires adequate review time for elderly patients
- Under the Option C hybrid, the 5-minute window also serves as the period during which the patient can take a second confirmatory reading after 1 minute of rest — requires at least 2–3 minutes of the window
- The 2-minute alternative proposed by Ruhim is too short

---

## Implementation Notes

1. **The Option D retake-to-confirm flow requires three new UX screens:** (a) the "please retake" prompt, (b) the second-reading entry, and (c) the "single unconfirmed reading" fallback when the patient declines. **Wording for all three needs CMO sign-off before build** — recommend a brief follow-up wording doc from Duwaragie.

2. **The Q3 hybrid "take another reading" prompt wording also needs CMO sign-off.** Non-judgmental tone — encouraging but not pressuring. Suggested draft: *"For the most accurate result, take a second reading after 1 minute of rest."*

3. **The AFib 3-reading prompt is a special case that should be configurable per patient cohort flag, not hardcoded.** This allows future cohort-specific multi-reading requirements without code changes.

4. **Provider training on the typo-emergency manual resolution workflow** should be added to the pilot-readiness checklist. Providers need to know to check the Timeline + Readings tabs when an emergency alert's reading doesn't match the current value.

5. **The "single unconfirmed reading" provider flag** (when patient declines retake) should be classified as a **Tier 1 provider-only alert** with the standard escalation ladder, **not as a Tier 2 emergency** — the reading is unconfirmed and may be artifactual.

---

## Summary Table

| Question | Decision | Key Rationale |
|---|---|---|
| Q1 Front-end buffer for non-emergency | YES — clinically acceptable | Single readings are inadequate for clinical decisions; session window already imposes comparable wait |
| Q2 Emergency rule handling | HYBRID: Option D for BP-only + Option A for symptom-override | HTN emergency requires target organ damage, not just a number; symptoms indicate potential acute damage and need immediate action |
| Q3 Patient app sessioning | Option C (hybrid) — default single with guided prompt for second | AHA/AMA/ACC/AHA/VA-DoD all recommend ≥2 readings; restricting to 1 contradicts guidelines; session UI is too complex for elderly patients |
| Q4 Window duration | 5 minutes confirmed | Aligns with AHA-recommended ≥5 min rest period; accommodates multi-step form + second reading |
