Cardioplace v2 — Master Consolidated Guide: APPENDIX B (Translation
Package Review and Additions)

APPENDIX B — TRANSLATION PACKAGE REVIEW AND ADDITIONS

Supplement to: Cardioplace v2 Master Consolidated Implementation Guide

From: Dr. Manisha Singal, CMO

Date: May 11, 2026

\---

**OVERVIEW**

The engineering team's translation package
(CLINICAL*TRANSLATION*PACKAGE\_EN, dated April 27, 2026) was reviewed
against all signed-off clinical decisions from the v1.0 spec, v2.0
addendum, and all subsequent clinical sign-off rounds.\* The package is
well-constructed. The following items need to be added or refined before
forwarding to translators.\*\*

The original package contained 26 messages. After this review, the total
is **33 messages** (26 original + 7 new).

\---

**B1. MISSING MESSAGES — ADD TO TRANSLATION PACKAGE**

Seven messages were signed off during clinical review rounds but were
not included in the original translation package. Each is listed below
with its exact string, priority tier, and the clinical decision that
generated it.

**B1.1 — DHP-CCB ankle/leg edema — non-HF patient (add as item 3.9,
Priority 2)**

\`\`\`

"You reported swelling in your ankles or legs. This can

sometimes happen with \[med\_name\].\* It is usually not dangerous,\*\*

but your care team should know. They may want to adjust your

medicine."

\`\`\`

Source: Signed off in Item 2a clinical review. Tier 3. Fires when a
patient on a DHP-CCB (e.g., amlodipine, nifedipine) reports ankle/leg
swelling AND does NOT have HFrEF, HFpEF, or DCM.

\---

**B1.2 — HF patient ankle/leg edema — any medication (add as item 3.10,
Priority 2)**

\`\`\`

"You reported swelling in your ankles or legs. Because of your

heart condition, your care team needs to know about this right

away. Please also let them know if you have gained weight, feel

more short of breath, or are having trouble lying flat."

\`\`\`

Source: Signed off in Item 2a clinical review. Tier 2. Fires when a
patient with HFrEF, HFpEF, or DCM reports ankle/leg swelling, regardless
of medication. IMPORTANT: The HF check runs FIRST — if a patient has
both HF and takes a DHP-CCB, they get THIS message (Tier 2), not the
side-effect message (B1.1, Tier 3). Safety takes priority.

\---

**B1.3 — ACE inhibitor dry cough (add as item 3.11, Priority 2)**

\`\`\`

"You reported a cough that won't go away. This can sometimes

happen with \[med\_name\].\* Do not stop taking your medicine on\*\*

your own — let your care team know, and they can help find

a different option if needed."

\`\`\`

Source: Signed off in side effects review. Tier 3. This is the most
common reason patients self-discontinue ACE inhibitors (affects up to
20% of patients), so the message explicitly tells them not to
self-discontinue.

\---

**B1.4 — HCM patient — low BP (add as item 3.12, Priority 2)**

\`\`\`

"Your blood pressure reading is \[BP\], which is lower than your

goal for your heart condition. Please contact your care team

today — do not skip any meals or let yourself get dehydrated."

\`\`\`

Source: Identified during package review. Tier 2. Fires when a patient
with hypertrophic cardiomyopathy (HCM) has SBP below 100. Low BP and low
volume states worsen dynamic outflow obstruction in HCM. The added
guidance about meals and hydration is specific to this population.

\---

**B1.5 — Caregiver — HF patient ankle/leg edema (add as item 4.7,
Priority 3)**

\`\`\`

"\[patient\_name\] reported swelling in their ankles or legs.\*

Because of their heart condition, their care team needs to

know. Please check if they have also gained weight or feel

more short of breath."

\`\`\`

Source: Caregiver message needed to match patient message B1.2 (item
3.10). Tier 2.

\---

**B1.6 — Caregiver — ACE inhibitor angioedema (add as item 4.8, PRIORITY
1)**

\`\`\`

"\[patient\_name\] reported swelling of their face, lips, or\*

tongue. This needs urgent medical attention. Call 911 now."

\`\`\`

Source: Caregiver message needed to match patient emergency message 1.7.
This is a Tier 1 emergency. IMPORTANT: Although listed in the caregiver
section for organizational purposes, this must be translated with
Priority 1 messages because it is a life-threatening emergency.

\---

**B1.7 — Medication Hold — patient system message (add as item 5.1,
Priority 2)**

\`\`\`

"Your care team is reviewing your medicine list to make sure

everything is up to date. This is a normal part of getting

started. If you have any questions about your medicines, your

care team is here to help."

\`\`\`

Source: Signed off in Q-C(c) clinical review. This is a system message,
not a clinical alert — no emergency action required. Displays once in
the medication section of the app when any medication is in HOLD status.
Does NOT name the specific medication on Hold. Disappears when the Hold
is resolved.

\---

**B2. WORDING REFINEMENTS — CORRECT IN EXISTING PACKAGE**

Three items in the original package need minor corrections before
translation.

**B2.1 — Item 3.2 header typo**

Original: "Standard L1 High (general, ≥160/100 or ≥160/100)"

Corrected: "Standard L1 High (general, ≥160 systolic or ≥100 diastolic)"

The message text itself is correct — only the header/description had the
typo. Fix the header so translators do not misinterpret the threshold.

\---

**B2.2 — Item 3.3 threshold description clarification**

Original description: "SBP less than 90 or 65+ patient SBP less than
100"

Clarified: "SBP below 90 for adults 18–64, OR SBP below 100 for adults
65 and older"

The message text is correct. The description needs clarification so
translators understand the two age-dependent thresholds.

\---

**B2.3 — Item 3.8 threshold description clarification**

Original description: "AFib — heart rate too low (less than 50 bpm)"

Clarified: "AFib — heart rate too low (below 50 bpm). NOTE: Do NOT alert
on HR 50–60 in patients on beta-blockers — this may be the therapeutic
target. Alert only below 50."

The message text is correct. The description needs the beta-blocker
suppression note so translators understand the clinical context
(relevant for translator's notes if they flag the threshold as
potentially alarming).

\---

**B3. ADDITIONAL VARIABLES — ADD TO TRANSLATOR BRIEF**

The original package listed 4 placeholder variables. The following 3
additional variables appear in the new messages and must be added to the
"Variables (do not translate)" section:

|                   |                                                |             |                          |
| ----------------- | ---------------------------------------------- | ----------- | ------------------------ |
| **Placeholder**   | **Meaning**                                    | **Example** | **Used In**              |
| \[HR\]            | Heart rate reading                             | "120 bpm"   | Items 3.7, 3.8           |
| \[patient\_name\] | Patient's first name (caregiver messages only) | "Maria"     | Items 4.5, 4.6, 4.7, 4.8 |
| \[X\]             | Number of days                                 | "2"         | Items 4.5, 4.6           |

\---

**B4. AMHARIC AUDIO WORKFLOW CONFIRMATION**

The original package correctly specifies that every Amharic message must
be delivered as a recorded audio file (MP3 or WAV, voiced by a native
speaker, no background music). This is confirmed and unchanged.

Additional guidance for the audio recordings:

\- Pace should be slow and clear — these are emergency and health
messages, not conversational speech

\- Placeholders (\[BP\], \[med\_name\], etc.) should be read as "your
blood pressure number" or "your medicine name" in the audio template.
The app will splice in the actual values using text-to-speech for the
variable portions.\*

\- If splicing is not technically feasible for MVP, record a generic
version of each message without the variable (e.g., "Your blood pressure
is very high. If you have chest pain, severe headache, trouble
breathing, weakness, or vision changes, call 911 now.") and display the
variable on screen alongside the audio playback.

\---

**B5. TRANSLATION PRIORITY SUMMARY — UPDATED**

|                                    |                                      |                                                         |                                            |
| ---------------------------------- | ------------------------------------ | ------------------------------------------------------- | ------------------------------------------ |
| **Priority**                       | **Messages**                         | **Count**                                               | **Translate By**                           |
| Priority 1 (safety-critical)       | 1.1–1.7 + 4.8 (caregiver angioedema) | 8                                                       | Before pilot launch — BLOCKER              |
| Priority 2 (patient alerts)        | 2.1–2.3, 3.1–3.12, 5.1               | 17                                                      | Before pilot launch — strongly recommended |
| Priority 3 (caregiver + checklist) | 4.1–4.7 + 8-item checklist           | 14                                                      | Before pilot launch — recommended          |
| TOTAL                              |                                      | 39 (33 messages + 6 checklist items counted separately) |                                            |

Note: The original package counted the 8-item checklist as a single
block. For translation tracking purposes, each checklist item is a
separate translatable string, bringing the true total to 39 translatable
strings.

\---

**B6. MESSAGES FROM APPENDIX A (SIDE EFFECTS) — FUTURE TRANSLATION
ADDITIONS**

The 11 medication side effect patient-facing messages in Appendix A of
the master document are NOT included in this translation package. They
will be added to a future translation package revision when they are
implemented:

\- MVP side effect messages (A1–A6): Add to translation package when
engineering implements the side effect alert rules

\- Post-MVP side effect messages (A7–A11): Add to a future translation
package revision

When these are ready for translation, they should be added as items
3.13–3.23 in the Priority 2 section, maintaining the same numbering
convention.

\---

**B7. CHANGE LOG — COMPLETE DIFF FROM ORIGINAL PACKAGE**

|           |          |                                                                                |              |
| --------- | -------- | ------------------------------------------------------------------------------ | ------------ |
| **Item**  | **Type** | **Description**                                                                | **Priority** |
| 3.9       | NEW      | DHP-CCB ankle/leg edema — non-HF patient                                       | Priority 2   |
| 3.10      | NEW      | HF patient ankle/leg edema                                                     | Priority 2   |
| 3.11      | NEW      | ACE inhibitor dry cough                                                        | Priority 2   |
| 3.12      | NEW      | HCM patient low BP                                                             | Priority 2   |
| 4.7       | NEW      | Caregiver — HF ankle/leg edema                                                 | Priority 3   |
| 4.8       | NEW      | Caregiver — ACE inhibitor angioedema                                           | Priority 1   |
| 5.1       | NEW      | Medication Hold — patient system message                                       | Priority 2   |
| 3.2       | FIX      | Header typo corrected (≥160/100 or ≥160/100 → ≥160 systolic or ≥100 diastolic) | —            |
| 3.3       | FIX      | Threshold description clarified for age-dependent logic                        | —            |
| 3.8       | FIX      | Beta-blocker suppression note added to description                             | —            |
| Variables | ADD      | \[HR\], \[patient\_name\], \[X\] added to translator brief                     | —            |

\---

**ACTION REQUIRED**

1\. Engineering team: Merge these additions into the
CLINICAL*TRANSLATION*PACKAGE\_EN file and update the version number\*

2\. Forward the updated package to translators (Spanish + Amharic)

3\. Priority 1 messages (8 strings) must be translated and
back-translated before pilot launch — this is a launch blocker

4\. Priority 2 and 3 messages should be translated concurrently if
timeline permits

\---

Signed: Dr. Manisha Singal, CMO

Date: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\*\*
