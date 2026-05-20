# Cardioplace v2 — English Clinical Copy for Translation

**For:** Professional medical translators (Spanish + Amharic)
**Source language:** English (US)
**Target languages:** Spanish (es), Amharic (am)
**Sign-off:** Dr. Manisha Singal, CMO
**Version:** v2026-05-15

---

## Changelog

### v2026-05-15
- **Appendix B additions** — 7 new strings from Cluster 7 (Manisha 5/11 sign-off): B1.1 through B1.7. Covers β-blocker side effects, NSAID interaction, ACE cough, HCM low BP, HF caregiver edema, ACE angioedema (caregiver), and the medication-Hold system message.
- **Priority labels** added to the new strings (Priority 1 = pilot launch / safety-critical, 2 = patient adherence + patient-tier, 3 = caregiver + informational).
- **Placeholder-variable docs** expanded — the "Variables (do not translate)" table now documents every token that appears in the copy (`[BP]`, `[HR]`, `[med_name]`, `[med_name_1, med_name_2]`, `[symptom]`, `[patient_name]`, `[X]`).
- **Translator-brief fixes** — item 3.2 header threshold typo corrected; item 3.3 gains an age-dependent "When this fires" note; item 3.8 gains a β-blocker terminology translator note.

### v1 (initial release)
- Priority 1–3 strings 1.1–4.6 + the 8-item pre-measurement checklist. Dr. Singal sign-off.

---

## Translator brief

Cardioplace is a remote blood-pressure monitoring app for patients with cardiovascular conditions. The strings below are **patient-facing clinical alerts** — they appear on the patient's phone when the system detects a concerning reading or pattern. Many recipients are low-literacy older adults, pregnant women, or recent immigrants, so the English copy has been deliberately simplified by the prescribing physician.

### Workflow

1. **You translate** English → target language. Do NOT use machine translation. Preserve all bracketed placeholders verbatim (e.g. `[BP]`, `[med_name]`).
2. **A second translator back-translates** your version → English.
3. **Dr. Singal reviews** the back-translation for clinical accuracy.
4. **A native-speaking community health worker** reviews for cultural appropriateness + plain-language comprehension.

### Amharic-specific requirement

Many Amharic speakers may not read Ge'ez script. **Every Amharic message must also be delivered as a recorded audio file** so it can be played aloud on the patient's phone. Please plan for audio recording after text sign-off.

### Placeholder variables (do not translate)

These tokens are replaced by the platform at runtime with the patient's real
data. **Preserve every bracketed token exactly as written** — do not
translate the word inside the brackets, do not remove the brackets, do not
change the order of multiple tokens within a sentence. Translate only the
words *around* the tokens.

| Placeholder | Meaning | Example value |
|---|---|---|
| `[BP]` | Blood pressure reading (systolic/diastolic, with unit) | "165/95 mmHg" |
| `[HR]` | Heart rate, with unit | "HR 48 bpm" |
| `[med_name]` | Single medication name | "Lisinopril" |
| `[med_name_1, med_name_2]` | Multiple medication names (preserve the target-language list separator) | "Lisinopril, Metoprolol" |
| `[symptom]` | Self-reported symptom name | "severe headache" |
| `[patient_name]` | Patient's first name (caregiver-tier messages) | "Aisha" |
| `[X]` | A small whole number, context-dependent | 2 (e.g. "missed doses on [X] of the last 3 days") |

Example — English: "Your blood pressure of `[BP]` is higher than your goal."
The translated sentence must still contain `[BP]` verbatim in the correct
grammatical position for the target language.

### Tone notes

- Direct and warm, not clinical or scolding
- Action-oriented (what to do next)
- Avoid "non-compliant" / "non-adherent" — both are dispreferred in plain-language patient communication
- The 911 emergency call-to-action is non-negotiable; localize to the equivalent emergency number in the target locale (e.g., 911 stays in US English/Spanish; for Amharic-speaking patients in DC, also keep 911)

---

## Priority 1 — Safety-critical (translate first)

### 1.1 BP Level 2 — Absolute emergency (very high blood pressure)

> Your blood pressure is very high: **[BP]**. If you have chest pain, severe headache, trouble breathing, weakness, or vision changes, call 911 now.

**When this fires:** Systolic ≥180 mmHg or diastolic ≥120 mmHg. The patient sees this on a full-screen red emergency page with a giant 911-call button.

---

### 1.2 BP Level 2 — Symptom override during pregnancy

> You reported a symptom that needs urgent attention during pregnancy at **[BP]**. If you have chest pain, severe headache, difficulty breathing, or vision changes, call 911 now.

**When this fires:** A pregnant patient logs a check-in and reports a symptom that may indicate preeclampsia (new-onset headache, right-upper-quadrant pain, edema), regardless of how high or normal the BP is.

**Important:** Do NOT translate "preeclampsia" — that word does not appear in this patient message. The plain-language version is intentional.

---

### 1.3 BP Level 2 — Symptom override (general, non-pregnant)

> Your blood pressure reading is **[BP]** and you reported serious symptoms. If you have chest pain, severe headache, trouble breathing, weakness, or vision changes, call 911 now.

**When this fires:** Patient reports any of: severe headache unresponsive to analgesics, vision changes, altered mental status, chest pain or acute dyspnea, focal neurological deficits, severe epigastric/RUQ pain — regardless of how high the BP is.

---

### 1.4 BP Level 2 — Pregnancy severe-range (≥160/110)

> Your blood pressure reading is **[BP]**, which is very high for pregnancy. If you have chest pain, severe headache, trouble breathing, weakness, or vision changes, call 911 now.

**When this fires:** Pregnant patient with SBP ≥160 OR DBP ≥110. ACOG considers this severe-range hypertension requiring treatment within 15 minutes.

---

### 1.5 Tier 1 — Pregnancy + ACE inhibitor / ARB (medication contraindication)

**Variant A — single drug:**
> Your care team needs to review **[med_name]** because you are pregnant. Please call your provider today before taking your next dose.

**Variant B — multiple drugs:**
> Your care team needs to review **[med_name_1, med_name_2]** because you are pregnant. Please call your provider today before taking your next dose.

**Variant C — drug name unknown:**
> Your care team needs to review your blood pressure medicine because you are pregnant. Please call your provider today before taking your next dose.

**When this fires:** Pregnant patient is taking an ACE inhibitor (e.g., Lisinopril, Enalapril) or an ARB (e.g., Losartan, Valsartan). These are teratogenic and must be discontinued.

---

### 1.6 Tier 1 — Heart failure + Diltiazem/Verapamil (medication contraindication)

> Your care team needs to review one of your heart medicines with you. Please call your provider today before taking your next dose.

**When this fires:** Patient with reduced-ejection-fraction heart failure is taking a non-dihydropyridine calcium channel blocker (Diltiazem or Verapamil). These drugs are negatively inotropic and harmful in this population.

---

### 1.7 Tier 1 — ACE inhibitor angioedema (medication side effect emergency)

> You reported swelling of your face, lips, or tongue. This needs urgent medical attention. Call 911 or go to the nearest emergency room now.

**When this fires:** Patient on an ACE inhibitor (e.g., Lisinopril, Enalapril) reports facial, lip, or tongue swelling. This is a sign of possible angioedema — a life-threatening allergic reaction. Fires Tier 1 with emergency call-to-action; same dispatch profile as the other Priority 1 emergencies above.

---

## Priority 2 — Medication adherence (translate next)

These reflect a recent clinical decision: an alert fires when a patient reports missing doses on **2 of the last 3 days** (or after a single miss for beta-blockers in heart failure / HCM / AFib patients).

### 2.1 Patient — generic missed-dose pattern

> It looks like you may have missed your medicine a couple of times recently. Taking your medicine regularly helps keep your blood pressure steady. If something is making it hard to stay on schedule, your care team can help.

---

### 2.2 Patient — specific medications named

> It looks like you may have missed **[med_name_1, med_name_2]** a couple of times recently. These medicines help protect your heart and keep your blood pressure steady. If anything is making it hard to take them, your care team can help.

---

### 2.3 Patient — beta-blocker single-miss exception

> It looks like you may have missed **[med_name]** today. This medicine is important for your heart. Please try to take your next dose on time, and let your care team know if anything is making it hard to stay on schedule.

**When this fires:** First missed beta-blocker dose for a patient with HFrEF, HCM, or AFib. Beta-blocker rebound is dangerous, so the alert fires immediately rather than waiting for a 2-of-3 pattern.

---

## Priority 2 — Other patient-tier alerts (translate next)

### 3.1 Pregnancy L1 High (≥140/90, sub-emergency)

> Your blood pressure reading is **[BP]**, which is higher than the goal for pregnancy. Please contact your care team today.

---

### 3.2 Standard L1 High (general, ≥160/100)

> Your blood pressure reading is **[BP]**, which is higher than your goal. Please contact your care team within the next 24 hours.

---

### 3.3 Standard L1 Low (age-dependent: SBP <90 general, SBP <100 if 65+)

> Your blood pressure reading is **[BP]**, which is lower than your goal. Sit or lie down if you feel dizzy, and contact your care team if this happens again.

**When this fires:** Systolic BP below 90 for the general population. The threshold rises to **below 100 for patients aged 65 and older** (age-65 override) — older adults are more likely to trigger this alert and are at higher risk of dizziness and falls at low blood pressure. The "sit or lie down if you feel dizzy" fall-precaution wording is intentional and must be preserved in translation; it matters most for the elderly cohort.

---

### 3.4 Heart failure (HFrEF) — Low

> Your blood pressure reading is **[BP]**, which is lower than your goal for your heart condition. Please contact your care team today.

---

### 3.5 Heart failure (HFrEF) — High

> Your blood pressure reading is **[BP]**, which is higher than your goal for your heart condition. Please contact your care team today.

---

### 3.6 Coronary artery disease — diastolic critically low

> Your blood pressure reading is **[BP]**. The bottom number is lower than your goal, which can affect blood flow to your heart. Please contact your care team today.

---

### 3.7 AFib — heart rate too high (>110 bpm)

> Your heart rate is **[HR]**, which is higher than your goal. Please contact your care team today.

---

### 3.8 AFib — heart rate too low (<50 bpm)

> Your heart rate is **[HR]**, which is lower than your goal. Sit or lie down if you feel dizzy, and contact your care team if this happens again.

**Translator note:** A low heart rate in AFib patients is most often caused by β-blockers — heart-rate-slowing medications (common examples: metoprolol, atenolol, carvedilol). The patient string deliberately does **not** name the drug class; this note is context only, so you translate the tone correctly (reassuring, action-oriented — not alarming). Do not add the drug names to the translated patient text.

---

## Priority 3 — Caregiver tier (translate after Priority 1 and 2)

These messages go to a designated caregiver, not the patient.

### 4.1 Caregiver — emergency BP

> The patient's blood pressure is very high: **[BP]**. If they have chest pain, severe headache, trouble breathing, weakness, or vision changes, call 911 now.

### 4.2 Caregiver — pregnancy symptom override

> The pregnant patient reported symptoms consistent with preeclampsia at **[BP]**. If they have chest pain, severe headache, difficulty breathing, or vision changes, call 911 now.

(Translator note: keep "preeclampsia" — caregivers benefit from the medical term.)

### 4.3 Caregiver — Tier 1 pregnancy + ACE/ARB

> The patient is pregnant and is taking **[med_name_1, med_name_2]**, which need urgent provider review. Please help them contact their care team today.

### 4.4 Caregiver — Tier 1 NDHP + HF

> The patient has a heart-failure diagnosis and is taking a medication that needs urgent provider review. Please help them contact their care team today.

### 4.5 Caregiver — medication missed (generic)

> **[patient_name]** has reported missing medication doses on **[X]** of the last 3 days. A gentle check-in may help identify any barriers.

### 4.6 Caregiver — medication missed (with drug names)

> **[patient_name]** has reported missing **[med_name_1, med_name_2]** on **[X]** of the last 3 days. A gentle check-in may help — common reasons include side effects, cost, or forgetting.

---

## Priority 3 — 8-item pre-measurement checklist (translate last)

Patients see these as a checklist before taking each blood pressure reading.

1. No caffeine in the last 30 minutes
2. No smoking in the last 30 minutes
3. No exercise in the last 30 minutes
4. Bladder has been emptied
5. Seated quietly for at least 5 minutes
6. Back supported, feet flat, arm supported at heart level
7. Not talking during measurement
8. Cuff placed on bare upper arm (not over clothing)

---

## Appendix B — Cluster 7 side-effect / interaction additions (v2026-05-15)

Seven new strings added after Dr. Singal's 5/11 Cluster 7 sign-off. English
copy below is the canonical text from the platform's message registry
(`shared/src/alert-messages.ts`) — translate verbatim, same placeholder rules
as the rest of this package. Priority labels: **P1** = pilot launch /
safety-critical, **P2** = patient adherence + patient-tier alert, **P3** =
caregiver-tier + informational.

### B1.1 — DHP-CCB ankle/leg swelling (patient) — **P3**

> You reported swelling in your ankles or legs. This can sometimes happen with your blood-pressure medicine. It is usually not dangerous, but your care team should know — they may want to adjust your medicine.

**When this fires:** Patient on a dihydropyridine calcium-channel blocker (e.g. amlodipine) reports leg/ankle swelling and has **no** heart-failure flag. Informational — surfaces in the patient inbox, no escalation. **Glossary:** "dihydropyridine calcium-channel blocker" is a common BP medicine class; the patient string deliberately avoids the term — keep the plain wording.

### B1.2 — Heart-failure ankle swelling / fluid overload (patient) — **P2**

> You reported swelling in your ankles or legs (or a quick weight gain). Because of your heart condition, your care team needs to know about this right away. Please also let them know if you have gained weight, feel more short of breath, or are having trouble lying flat.

**When this fires:** Heart-failure patient reports leg swelling and/or rapid (>2 lb/24 h) weight gain — possible decompensation. Escalates on the Tier 2 ladder. **Glossary:** "trouble lying flat" = orthopnea; keep the plain phrasing.

### B1.3 — ACE-inhibitor cough (patient) — **P3**

> You reported a dry, tickly cough. This is a common side effect of one of your blood-pressure medicines — it usually starts within the first few weeks of starting it. It is not dangerous, but if the cough is bothering you, please let your care team know. There is a related medicine that often does not cause this cough that they can switch you to.

**When this fires:** Patient on an ACE inhibitor (e.g. Lisinopril, Enalapril) reports a dry cough. Informational — patient inbox, no escalation. The "related medicine" is an ARB; do **not** name it in the translation.

### B1.4 — HCM patient, low blood pressure (patient) — **P2**

> Your blood pressure reading is **[BP]**, which is too low for you. With your heart condition, low blood pressure can reduce blood flow to your body — watch for dizziness, lightheadedness, or feeling faint. Please contact your care team today.

**When this fires:** Patient with hypertrophic cardiomyopathy (HCM) records a low BP. HCM patients are preload-dependent, so low BP can reduce perfusion — the symptom watch-list is clinically important and must be preserved. Preserve `[BP]` verbatim. **Glossary:** "hypertrophic cardiomyopathy" — a thickened-heart-muscle condition; the patient string uses "your heart condition" instead — keep that plain phrasing.

### B1.5 — Heart-failure ankle swelling (caregiver) — **P3**

> **[patient_name]** reported new swelling in their ankles or legs. With heart failure, this can be an early sign of fluid build-up. Please weigh them today and tomorrow morning — if they gain more than 2 pounds, or if breathing gets harder, contact their care team. Keep an eye on swelling, breathing, and weight over the next few days.

**When this fires:** Caregiver-routed counterpart of B1.2 — heart-failure patient with new ankle edema; the caregiver is asked to monitor weight + breathing. Preserve `[patient_name]` verbatim. Audience is the **caregiver**, not the patient — second-person about the patient.

### B1.6 — ACE-inhibitor angioedema (caregiver) — **P1** ⚠ PILOT BLOCKER

> The patient reported swelling of their face, lips, or tongue. This can be a dangerous reaction to one of their blood-pressure medicines and needs urgent medical attention. Call 911 or take them to the nearest emergency room now. Do not let them take another dose of that medicine.

**Status:** ⚠ **DRAFT — PILOT BLOCKER.** The patient-tier equivalent already ships as **item 1.7** above. This caregiver-tier variant is drafted but **not yet wired in `alert-messages.ts`**; final wording is **pending Dr. Singal sign-off**. Translate it now so the vendor is not on the critical path, but treat the English as provisional and re-confirm against the final string before pilot. **When this fires:** Patient on an ACE inhibitor reports facial/lip/tongue swelling — possible life-threatening angioedema. Emergency call-to-action — localize "911" per the locale rule in the brief; keep the 911 instruction non-negotiable.

### B1.7 — Medication-Hold system message (patient) — **P1**

> Your care team has placed **[med_name]** on hold while they review it. This means you should NOT take **[med_name]** until they tell you it is safe to restart. If you have questions, call your care team. If you feel unwell after recently taking it — chest pain, severe weakness, fainting — call 911.

**When this fires:** A provider marks a medication "Hold" in the admin app; this message is dispatched straight to the patient's inbox (not an alert-engine rule). `[med_name]` appears **twice** — both occurrences must be preserved. Safety-critical: the emphatic "NOT" and the 911 instruction must carry through in translation.

---

## What to deliver back

For each language (Spanish, Amharic):

1. **Translation file** — same numbering as above, with translated strings preserving all `[bracketed]` placeholders verbatim
2. **Translator's notes** — flag any English wording that doesn't translate cleanly or has cultural concerns
3. **(Amharic only)** — audio recording per message, MP3 or WAV, voiced by a native speaker, no background music. Same numbering.

Email back to: [your engineering team contact email]

Thank you. Patient safety in the first cohort depends on this work.

— Cardioplace clinical team
