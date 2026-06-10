# Cardioplace v2 — Medication Workflow: Clinical Review and Sign-Off

**From:** Dr. Manisha Singal, CMO
**To:** Engineering Team (Cardioplace v2)
**Date:** May 24, 2026
**Re:** Clinical review of "Medication Workflow" document dated 2026-05-22
**Status:** APPROVED FOR MVP LAUNCH — no blockers identified. Clarifications and next-version priorities below.

> **Archive note (2026-06-07):** This is the verbatim source-of-truth for Manisha's 2026-05-24 sign-off, persisted to the repo from her original reply. Working-engineering distillation: [`MANISHA_2026_05_24_MEDICATION_WORKFLOW_AND_CLARIFICATIONS_SIGNOFF.md`](./MANISHA_2026_05_24_MEDICATION_WORKFLOW_AND_CLARIFICATIONS_SIGNOFF.md) (Niva audit guide). Prompts she replied to: [`MANISHA_2026_05_22_MEDICATION_WORKFLOW_PROMPT.md`](./MANISHA_2026_05_22_MEDICATION_WORKFLOW_PROMPT.md) + [`MANISHA_2026_05_22_PENDING_CLARIFICATIONS_PROMPT.md`](./MANISHA_2026_05_22_PENDING_CLARIFICATIONS_PROMPT.md).

---

## EVIDENCE-SOURCE LABELING

This document uses three evidence-source labels, consistent with the standard established across all Healplace clinical documentation:

- **[GUIDELINE]** — Threshold or recommendation drawn directly from a published clinical practice guideline (AHA/ACC, ACOG, Joint Commission)
- **[PUBLISHED EVIDENCE]** — Threshold or finding drawn from a published trial, meta-analysis, or scientific statement
- **[EXPERT OPINION]** — Threshold or design decision based on Dr. Singal's clinical judgment, informed by evidence but not directly specified in any guideline

---

## OVERALL ASSESSMENT

The medication workflow is clinically sound and ready for pilot launch. The core architecture — trust-then-verify, four verification states, medication-linked safety alerts, and adherence logic — is consistent with all prior clinical sign-offs across the v1.0 spec, v2.0 addendum, and all subsequent engineering Q rounds.

No launch blockers were identified. One patient-safety refinement (the HOLD state two-path patient message) must be implemented before the first cohort goes live. All other items are confirmations or next-version enhancements.

---

## SECTION 1 — PATIENT SELF-REPORT (INTAKE)

**Status:** APPROVED **[GUIDELINE + PUBLISHED EVIDENCE]**

The visual card approach with pill images, audio, and plain-language purpose descriptions is consistent with the silent-literacy architecture. Evidence supports pictographic medication aids for low-literacy populations — a participatory research study on medication reconciliation for older adults found that visual and simplified approaches significantly improved patient engagement with their medication lists.

Two small refinements for the engineering team:

**Combination pill de-duplication prompt** — Confirm the clarification uses plain language the patient can answer:

```
RECOMMENDED WORDING:
"It looks like you may have selected the same medicine twice.
 Are you taking [Lisinopril] by itself, or [Lisinopril + HCTZ] — a
 combination pill that has two medicines in one?"

→ Button 1: "Just [Lisinopril]"
→ Button 2: "[Lisinopril + HCTZ] (combination)"
→ Button 3: "I'm not sure — my care team can check"
```

**"Not sure" for dose frequency** — This is the correct option. The Joint Commission explicitly recognizes that "a good faith effort to collect this information is recognized as meeting the intent of the requirement" **[GUIDELINE]**. Capturing what the patient knows and flagging the rest for provider verification is exactly the right approach.

**Next version (not a blocker):** Add a "photo your pill bottle" option for the "something not listed" path. This is especially valuable for the Ward 7/8 population where patients may not know medication names but can photograph the label. **[EXPERT OPINION]**

---

## SECTION 2 — TRUST-THEN-VERIFY

**Status:** APPROVED — NO CHANGES NEEDED **[GUIDELINE]**

This is the platform's most important safety design decision. Activating safety-critical rules immediately on patient self-report, with provider verification within 48–72 hours, was explicitly signed off in prior rounds. The pregnancy + ACE/ARB contraindication firing on unverified medications is the canonical example: teratogenic risk is unrecoverable, so the system cannot wait for administrative completeness.

The 2025 AHA/ACC Guideline confirms that ACE inhibitors and ARBs are absolutely contraindicated in pregnancy **[GUIDELINE]**. The platform's decision to fire this rule on unverified medications is the correct safety-first approach.

---

## SECTION 3 — VERIFICATION STATES (INCLUDING HOLD)

**Status:** APPROVED WITH THREE CLARIFICATIONS

The four-state model (Verified, Unverified, Rejected, On Hold) is correct. However, the document's description of the HOLD state is missing three details that were specified in prior sign-offs and must be implemented.

### Clarification 1 — HOLD requires structured reason codes **[EXPERT OPINION]**

The document says "a rationale is required" but does not specify the format. Implement a dropdown with structured codes:

```
HOLD REASON CODES (admin selects one):
→ AWAITING_RECORDS         — waiting for medical records from outside provider
→ UNCLEAR_NAME             — medication name is ambiguous ("the little white pill")
→ UNCLEAR_DOSE             — dose or frequency unclear, needs clarification
→ PROVIDER_DIRECTED_HOLD   — provider explicitly asked to pause this medication
→ OTHER                    — free text required
```

### Clarification 2 — HOLD escalation ladder **[GUIDELINE + EXPERT OPINION]**

A medication sitting on Hold indefinitely is a reconciliation failure. The Joint Commission standard requires that medication reconciliation identify and resolve discrepancies **[GUIDELINE]**. Implement time-based escalation:

```
Day 7:  Dashboard badge on admin's medication tab
        "1 medication has been on Hold for 7 days"

Day 14: Tier 3 flag to assigned provider
        "[Patient name] has [medname] on Hold for 14 days.
         Verification pending: [REASON]. Please review."

Day 30: Tier 2 flag to assigned provider + Medical Director
        "[Patient name] has [medname] unverified for 30 days.
         Medication reconciliation incomplete. Action required."

Day 45: Auto-escalate to CMO review queue
```

The specific day intervals (7/14/30/45) are **[EXPERT OPINION]** — no guideline specifies escalation timing for medication holds in remote monitoring. These intervals are chosen to balance timely resolution against alert fatigue, with the 30-day threshold reflecting the outer bound of what constitutes a reasonable verification window.

### Clarification 3 — HOLD patient message must distinguish two types **[EXPERT OPINION — PATIENT SAFETY CRITICAL]**

**This is the single most important refinement before pilot launch. This is the #1 pre-pilot priority.**

The original document says: "Patient receives a system message not to take it until told otherwise." This is clinically appropriate ONLY when the provider explicitly directed the hold. If the hold is administrative (awaiting records, unclear name), telling the patient to stop taking a medication they are actually taking could cause harm.

**The clinical scenario that makes this critical:** A patient on metoprolol for heart failure has the medication placed on hold because the team is waiting on outside records. That is an administrative hold — nothing is clinically wrong with the medication. Under the original design, that patient gets told to stop taking metoprolol.

Abrupt beta-blocker discontinuation in a heart failure patient carries real rebound risk — rebound tachycardia, hypertension, and potential hemodynamic destabilization **[PUBLISHED EVIDENCE]**. The platform would have instructed a patient to do something harmful because of a paperwork delay.

**The fix — two paths based on hold reason:**

```
PATH 1 — PROVIDER-DIRECTED HOLD:
IF hold_reason == "PROVIDER_DIRECTED_HOLD"
  → Patient sees:
    "Your care team has asked you to pause [medname] until they can
     review it with you. Do not take it until your care team tells
     you it is okay."
  → This is a clinical instruction
  → Display prominently
  → Persist until resolved
  → Include in daily check-in reminder

PATH 2 — ADMINISTRATIVE HOLD:
IF hold_reason IN ("AWAITING_RECORDS", "UNCLEAR_NAME", "UNCLEAR_DOSE", "OTHER")
  → Patient sees:
    "Your care team is reviewing your medicine list to make sure
     everything is up to date. Keep taking your medicines as usual
     unless your care team tells you otherwise."
  → This is informational only
  → Display once
  → Do NOT name the specific medication on Hold
  → Disappear when the Hold is resolved
```

**Why this distinction is non-negotiable:** The platform cannot issue a blanket "stop taking this medication" instruction for administrative reasons. The clinical intent of the hold determines the patient instruction.

This must be built before the first patient is enrolled.

---

## SECTION 4 — MEDICATION-LINKED SAFETY ALERTS

**Status:** APPROVED — ADD TWO MISSING RULES TO THE TABLE **[GUIDELINE + PUBLISHED EVIDENCE]**

The seven alert triggers listed are correct and consistent with all prior sign-offs. Two rules that were signed off in the angioedema document (2026-05-15) are missing from this table and must be added:

```
MISSING RULE 1: ACE inhibitor + angioedema
  Trigger:    Patient on ACE inhibitor reports facial, lip, or tongue swelling
  Alert:      Tier 1 emergency
  Dispatch:   Full-screen red page + 911 button (patient), push + email
              (provider), caregiver if enabled
  Fires on:   ANY verification status
  Escalation: Compressed — T+15m backup, T+1h medical director, T+4h ops
  Notes:      Three-branch physician message (ACE/ARB/neither). Bespoke
              resolution actions (6 options including auto-medication-update
              and permanent contraindication flag). Signed off 2026-05-15.
              [GUIDELINE — AAAAI Focused Parameter Update]

MISSING RULE 2: Generic angioedema (any patient)
  Trigger:    ANY patient reports facial, lip, or tongue swelling
              (regardless of medication profile)
  Alert:      Tier 1 emergency
  Dispatch:   Same as above
  Fires on:   All patients
  Notes:      Catches angioedema from non-ACE causes (hereditary, ARB-related,
              idiopathic). Same 911 CTA and dispatch. Signed off 2026-05-15.
              [EXPERT OPINION — extending emergency dispatch to all-patient
              angioedema regardless of med profile is a safety-first design
              decision]
```

**Additional note:** The table lists "HCM + vasodilator / nitrate / loop diuretic" as Tier 3. This is correct for the alert tier **[GUIDELINE]**. Confirm that HCM patients are also flagged for mandatory provider threshold configuration at onboarding — the same approach now extended to aortic stenosis patients per the most recent clarifications document (2026-05-22).

**Complete medication-linked safety alert table (for engineering reference):**

| #  | TRIGGER                                  | TIER   | FIRES ON      | SOURCE              |
|----|------------------------------------------|--------|---------------|---------------------|
| 1  | Pregnant + ACE/ARB                       | Tier 1 | Any status    | [GUIDELINE]         |
| 2  | HFrEF + NDHP-CCB                         | Tier 1 | Verified only | [GUIDELINE]         |
| 3  | ACE + angioedema symptoms                | Tier 1 | Any status    | [GUIDELINE]         |
| 4  | Generic angioedema (any patient)         | Tier 1 | All patients  | [EXPERT OPINION]    |
| 5  | Loop diuretic + low SBP (non-HF)         | Tier 3 | Verified      | [EXPERT OPINION]    |
| 6  | HCM + vasodilator/nitrate/loop          | Tier 3 | Verified      | [GUIDELINE]         |
| 7  | Beta-blocker + fatigue/SOB/dizzy        | Tier 3 | Verified      | [PUB. EVIDENCE]     |
| 8  | ACE + dry cough                          | Tier 3 | Verified      | [PUB. EVIDENCE]     |
| 9  | NSAID + any antihypertensive             | Tier 3 | Any status    | [GUIDELINE]         |

**HF + SOB escalates to Tier 2.**

---

## SECTION 5 — ADHERENCE

**Status:** APPROVED **[GUIDELINE + PUBLISHED EVIDENCE]**

The adherence logic matches all prior sign-offs:

- 2-of-3 rolling window default ✓ **[PUBLISHED EVIDENCE — AHA ≥80% adherence threshold]**
- Beta-blocker single-miss carve-out for HFrEF/HCM/AFib ✓ **[PUBLISHED EVIDENCE — rebound risk]**
- Medications on Hold excluded from miss-count ✓ **[EXPERT OPINION]**

The first-month educational nudge is a new addition not previously discussed. This is clinically appropriate — the AHA Scientific Statement on Medication Adherence identifies the first month of a new medication as the highest-risk period for non-adherence, and early intervention is most effective **[PUBLISHED EVIDENCE]**.

**Recommended wording for the first-month nudge:**

> "Starting a new medicine can take some getting used to. If you missed a dose, that's okay — just try to take your next one on time. Your care team is here to help if anything makes it hard to stay on schedule."

**Rules for this nudge [EXPERT OPINION]:**

- Patient-only (no provider alert for a single first-month miss)
- One-time (does not repeat after the first occurrence)
- Non-judgmental tone consistent with signed-off adherence messaging and the no-guilt messaging discipline established across all patient-facing copy
- Does NOT fire for beta-blocker single-miss carve-out patients (those patients get the immediate Tier 2 alert instead)

---

## SECTION 6 — RECONCILIATION AND AUDIT

**Status:** APPROVED FOR MVP **[GUIDELINE]**

The current implementation — patient-reported medications alongside verified/prescribed list with status labels — meets the Joint Commission's "good faith effort" standard for medication reconciliation **[GUIDELINE]**. The full side-by-side reconciliation workflow and exportable reconciled list are appropriately deferred to post-pilot.

**Next-version priorities (post-pilot, in order):**

1. **Exportable reconciled medication list** — Joint Commission EP 4 requires that organizations "provide the patient with written information on the medications the patient should be taking at the end of the encounter" **[GUIDELINE]**. The platform should generate a downloadable/printable medication list the patient can carry to appointments. Prioritize for the second cohort.

2. **Discrepancy resolution workflow** — When the provider sees a mismatch between patient-reported and verified medications, the current system shows the discrepancy but does not guide resolution. A structured resolution flow would strengthen the audit trail **[EXPERT OPINION]**:

```
DISCREPANCY RESOLUTION OPTIONS:
→ "Confirmed match — patient is taking this"
→ "Patient is NOT taking this" (→ Rejected)
→ "Patient is taking something different" (→ opens edit flow)
→ "Dose/frequency discrepancy" (→ opens edit flow)
→ "Unable to determine — needs in-person review" (→ On Hold with reason)
```

3. **Medication change audit report** — A downloadable report showing all medication state changes (verification, hold, rejection, alert resolution) for a given patient over a time period. Useful for Joint Commission audits and quality reporting. **[EXPERT OPINION]**

---

## SUMMARY TABLE

| SECTION                  | STATUS                            | ACTION NEEDED                        | PRIORITY        |
|--------------------------|-----------------------------------|--------------------------------------|-----------------|
| 1. Patient self-report   | Approved                          | None (photo-bottle is post-pilot)    | —               |
| 2. Trust-then-verify     | Approved                          | None                                 | —               |
| 3. Verification (HOLD)   | Approved with clarifications      | 3a. Two-path patient message         | **#1 (safety)** |
|                          |                                   | 3b. Reason codes                     | #3              |
|                          |                                   | 3c. Escalation ladder                | #4              |
| 4. Safety alerts         | Approved — add 2 missing rules    | Add angioedema rules (#3 + #4)       | **#2 (blocker)**|
| 5. Adherence             | Approved                          | None                                 | —               |
| 6. Reconciliation        | Approved for MVP                  | Post-pilot priorities listed above   | Post-pilot      |

### Pre-pilot implementation order

1. **HOLD two-path patient message** — Patient safety. Must be built before the first patient is enrolled. A blanket "stop taking this medication" instruction for administrative holds could cause harm.
2. **Angioedema rules added to safety alert table** — Pilot blocker. Already signed off and implemented in the engine (2026-05-15). Just missing from this document's table. Confirm the engine implementation matches the sign-off.
3. **HOLD reason codes** — Audit trail completeness. Structured dropdown, not free text only.
4. **HOLD escalation ladder** — Reconciliation compliance. Time-based escalation at 7/14/30/45 days.

---

## APPENDIX A — FHIR MEDICATION INTEGRATION (POST-PILOT EXPLORATION)

**DO NOT BUILD UNTIL THE MVP MEDICATION WORKFLOW IS STABLE AND VALIDATED WITH REAL PATIENTS.**

This section describes the future-state architecture for bidirectional medication data exchange with EHR systems. It is separated from the MVP workflow above to keep the pilot scope tight.

### Why FHIR medication integration matters

The Techstars application states that Cardioplace has FHIR R4 write capability validated against the HAPI test server. Currently this covers vital signs (BP, HR, weight, SpO2) and alert events. Extending FHIR write-back to medication data would close the loop between the remote monitoring platform and the medical record — when a provider verifies, rejects, or discontinues a medication in Cardioplace, that change would propagate to the EHR.

### Proposed FHIR medication resource mapping

```
CARDIOPLACE EVENT          →  FHIR RESOURCE

Medication verified        →  MedicationStatement
                              (status: active, informationSource: patient,
                               dateAsserted: verification date)

Medication rejected        →  MedicationStatement
                              (status: entered-in-error, note: rejection rationale)

Medication discontinued    →  MedicationStatement
(via angioedema resolution)   (status: stopped, reasonCode: angioedema,
                               note: resolution details)

Medication on Hold         →  MedicationStatement
                              (status: on-hold, note: hold reason code)

Adherence pattern          →  MedicationStatement (adherence extension)
                              or Observation resource with adherence code
```

### Implementation considerations

- **Read before write:** Before Cardioplace writes medication data to an EHR, it should first read the EHR's medication list via FHIR MedicationRequest or MedicationStatement resources. This enables automatic pre-population of the patient's medication profile at intake, reducing self-report burden and improving accuracy.
- **Conflict resolution:** If the EHR medication list and the patient's self-report disagree, the platform should flag the discrepancy for provider review rather than auto-resolving. This is the same principle as the trust-then-verify architecture — the system surfaces the conflict, the clinician decides.
- **Site-specific validation:** FHIR implementation varies significantly across EHR vendors (Epic, Cerner/Oracle Health, MEDITECH). Each production deployment will require site-specific validation of resource formats, authentication, and write permissions. The HAPI test server validation confirms architectural readiness but does not guarantee production compatibility.

### Recommended timeline

```
PHASE 1 (Post-pilot, Month 3–4):
  → FHIR read: Pull EHR medication list at intake
  → Display alongside patient self-report
  → Flag discrepancies for provider review

PHASE 2 (Month 5–6):
  → FHIR write: Medication verification status
  → Write MedicationStatement with status updates
  → Site-specific validation with first EHR partner

PHASE 3 (Month 7+):
  → Full bidirectional sync
  → Medication discontinuation write-back
  → Adherence data as Observation resources
  → Reconciliation report as DocumentReference
```

---

## APPENDIX B — REGULATORY FLAG: FHIR WRITE-BACK AND DEVICE CLASSIFICATION

**ACTION REQUIRED: Add to active healthcare-counsel agenda NOW. Do not wait for Phase 2.**

Writing medication changes back to the EHR creates a bidirectional data flow that may have implications for the platform's regulatory classification. If Cardioplace writes a medication discontinuation to the EHR (e.g., after angioedema resolution), it is functionally modifying the medical record. This should be reviewed with healthcare regulatory counsel as part of the broader FDA SaMD/CDS exemption analysis.

**Why this cannot wait until Phase 2 is being built:** The answer to whether FHIR write-back changes Cardioplace's device classification must be known **before** Phase 2 is designed, not discovered during it. If write-back triggers a different regulatory classification, the architecture of Phase 2 may need to change — and discovering that mid-build is expensive and disruptive.

### What to ask counsel

1. Does writing medication verification status (active/stopped/on-hold) to an EHR via FHIR constitute "modifying the medical record" in a way that changes the platform's regulatory classification?
2. Does the 21st Century Cures Act Clinical Decision Support exemption (Section 3060) cover a platform that writes clinical data back to the EHR, or does write-back move the platform from CDS into Software as a Medical Device territory?
3. If write-back does change the classification, what is the minimum viable FHIR integration that stays within the current exemption? (For example: read-only FHIR may be safe; write-back may not be.)
4. How does this interact with the Unpause SaMD analysis already on the counsel agenda? Can both platforms be evaluated together?

**Owner:** Whoever manages the healthcare regulatory counsel relationship. This item should be added to the same agenda as the Unpause SaMD position, the RPM revenue-structure questions, and any other pending regulatory items.

**Timeline:** Engage counsel on this question within the next 30 days. The answer is needed before Phase 2 design begins (estimated Month 4–5 post-pilot).

This does not affect the pilot. FHIR write-back is correctly deferred to post-pilot. But the regulatory question must be answered before the post-pilot build begins.

---

**Signed:** Dr. Manisha Singal, CMO
**Date:** May 24, 2026
Healplace, Inc. | cardioplace.ai
