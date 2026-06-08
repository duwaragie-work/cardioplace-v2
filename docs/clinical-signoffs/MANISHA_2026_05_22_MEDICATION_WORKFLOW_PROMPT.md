 Cardioplace v2 — Medication Workflow
 For Dr. Manisha Singal's review · Prepared 2026-05-22


 Purpose
 This document describes the end-to-end medication workflow as currently implemented, for clinical review.
 It covers how a patient reports medications, how the care team verifies and holds them, how medications
 drive safety alerts, and how adherence and reconciliation work. We would value your confirmation that the
 handling — especially the new HOLD step and the medication-linked safety rules — is clinically correct.


 1. Patient self-report (intake)
• Patients select medications from visual cards for the four core classes (ACE inhibitors, ARBs,
    beta-blockers, calcium-channel blockers), with pill images, plain-language purpose, and audio.
•   Calcium-channel blockers are internally distinguished as dihydropyridine vs non-dihydropyridine
    (needed for the heart-failure contraindication); the patient does not need to know the difference.
•   A 'something not listed' path captures other medicines by category (water pill, blood thinner, cholesterol,
    rhythm, SGLT2, other) plus voice or photo entry; these are flagged unverified.
•   Combination pills have their own cards with de-duplication (selecting both Lisinopril and Lisinopril +
    HCTZ prompts a clarification).
•   Dose is captured as frequency only (once / twice / three times / as needed / not sure); exact dose is left
    to provider verification.
•   Recent NSAID use is captured both as a per-reading check and as a chronic medication entry.


 2. Trust-then-verify
 The system activates appropriate thresholds immediately on patient self-report; the provider verifies within
 48–72 hours. This avoids a monitoring gap (for example, a pregnant patient is protected by pregnancy
 thresholds and the ACE/ARB contraindication right away, even before verification).


 3. Verification states (including HOLD)
          State              Meaning                           Effect

          Verified           Provider confirmed the            Full rule set applies, including verified-only
                             medication                        contraindications.

          Unverified         Patient-reported, not yet         Safety-critical rules still apply (for example
                             confirmed                         pregnancy + ACE/ARB); verified-only rules wait.

          Rejected           Provider determined the patient   Removed from the active medication picture (with
                             is not taking it                  rationale logged).

          On Hold (new)      Care team paused the              Patient receives a system message not to take it
                             medication                        until told otherwise; the medication is excluded from
                                                               the adherence miss-count while held; a rationale is
                                                               required and the change is audited.




Cardioplace v2 — Medication Workflow                                                                                   Page 1
 4. Medication-linked safety alerts
          Trigger                                   Alert                          Notes

          Pregnant patient + ACE inhibitor or       Tier 1 contraindication        Fires on any verification status,
          ARB                                                                      including unverified (patient-safety
                                                                                   override; teratogenic).

          HFrEF + non-dihydropyridine CCB           Tier 1 contraindication        Fires on verified medications only
          (diltiazem / verapamil)                                                  (verification is the safety gate
                                                                                   here).

          Loop diuretic + low systolic (strict,     Tier 3 note                    Heart-failure patients are covered
          non-HF)                                                                  by their own thresholds instead.

          HCM + vasodilator / nitrate / loop        Tier 3 note                    Can worsen outflow obstruction.
          diuretic

          Beta-blocker + fatigue / shortness of     Tier 3 (HF                     Side-effect surveillance; HF +
          breath / dizziness                        shortness-of-breath            shortness of breath is treated as
                                                    escalates to Tier 2)           possible decompensation.

          ACE inhibitor + dry cough                 Tier 3 note                    Mentions the ARB-switch option.

          NSAID + any antihypertensive              Tier 3 note                    Interaction reminder; recommends
                                                                                   acetaminophen alternative.



 5. Adherence
• Default trigger: two missed-medication days within a rolling three-day window (Tier 2), escalating with
    continued misses.
•   Beta-blocker single-miss carve-out: for heart-failure, HCM, or AFib patients a single missed beta-blocker
    dose fires immediately (rebound risk).
•   First-month educational nudge: a one-time, gentle, patient-only message after the first reported missed
    dose within 30 days of enrollment.
•   Medications on hold are correctly excluded from the miss-count.


 6. Reconciliation & audit
 The provider view presents patient-reported medications alongside the verified / prescribed list with a
 status for each (matched, discrepancy, unverified, on hold). The full side-by-side reconciliation workflow
 and an exportable reconciled list are planned next steps. Every medication state change — verification,
 hold, rejection, and any alert resolution — is recorded in the 15-field audit trail.

 Review request: please confirm the verification states (especially HOLD), the medication-linked alert triggers and tiers, and
 the adherence carve-outs reflect your clinical intent. Any wording or threshold change is straightforward to apply.




Cardioplace v2 — Medication Workflow                                                                                       Page 2
