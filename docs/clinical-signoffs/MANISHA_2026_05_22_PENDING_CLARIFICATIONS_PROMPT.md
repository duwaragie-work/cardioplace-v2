 Cardioplace v2 — Pending Clinical
 Clarifications
 For Dr. Manisha Singal · Prepared 2026-05-22

 A small number of clinical decisions remain open. None block the pilot, but each one closes a rule in the
 specification and the test suite once decided. Each item states what the system does today, the question,
 and our recommendation.


 1. Readings where diastolic is at or above systolic (and the SBP–DBP
 relationship)
 You noted there is a clinical relationship between the systolic and diastolic values of a single reading, and
 rules that should follow from it — for example a reading entered as 120/140, where the diastolic (140) is
 higher than the systolic (120), or readings where the two values are implausibly close.

 What the system does today
 The engine evaluates systolic and diastolic against their thresholds independently. It does not currently
 validate the relationship between them, so a reading with diastolic at or above systolic is accepted and
 processed as entered.

 The question
• When diastolic is at or above systolic, should the system treat it as a data-entry error (reject and ask the
    patient to re-take), flag it for the provider, or fire a specific alert?
•   Is there a minimum plausible gap between systolic and diastolic below which we should act, and what is
    that value?
•   What action / tier applies in each case?

 Our recommendation
 Pending your guidance. A common, safe pattern is to gently reject physiologically impossible pairs
 (diastolic at or above systolic) at entry with a re-take prompt, while flagging an unusually narrow gap to the
 provider. We will implement exactly the threshold(s) and action(s) you specify.


 2. Narrow pulse pressure
 Related to item 1. Today the engine flags only wide pulse pressure (systolic minus diastolic greater than
 60 mmHg) as a physician-only note. There is no rule for a narrow pulse pressure (a small gap), which can
 indicate low stroke volume or poor cardiac output.

 The question
• Do you want a narrow-pulse-pressure alert? If so, at what value (for example, a gap below 25 mmHg)?
• Physician-only note (as with wide pulse pressure) or a patient-facing alert?
• All patients, or only specific conditions (heart failure, suspected aortic stenosis)?
 Our recommendation




Cardioplace v2 — Pending Clinical Clarifications                                                           Page 1
 If wanted for the pilot, a physician-only note at a narrow-gap threshold (mirroring how wide pulse pressure
 is handled) is the lowest-risk option. This can be defined together with item 1 since both concern the
 systolic–diastolic relationship.


 3. Alerts during the first seven readings (pre-personalization)
 For a patient's first seven readings, the system applies fixed standard thresholds because it cannot yet
 personalize to that patient's baseline.

 What the system does today (and a spec mismatch to settle)
 The written specification says non-emergency (Level 1) alerts should be suppressed during this period,
 with emergencies still firing. The engine today does the opposite for Level 1: it fires the Level 1 alert with a
 disclaimer ('standard threshold — personalization begins after Day 3'). Emergencies fire in both cases.

 The question
• (a) Keep firing Level 1 with the disclaimer (current behavior) — more sensitive; a high reading in week
    one still reaches the provider.
•   (b) Suppress Level 1 until seven readings (original spec text) — quieter onboarding; risk that a real early
    elevation is not flagged until later.

 Our recommendation
 Keep option (a). Firing with the disclaimer is the safer choice for a new, un-baselined patient, and the
 disclaimer makes clear to the provider that thresholds are not yet personalized. If you agree, we update
 the spec text to match; if you prefer (b), it is a small change.


 4. Documenting the resolution of an airway-emergency (angioedema)
 alert
 When a provider resolves an ACE-angioedema alert, the admin app currently offers the same resolution
 actions used for other Tier 1 contraindications (for example 'medication discontinued', 'change ordered',
 'acknowledged', 'deferred to in-person visit'). Angioedema is an airway emergency rather than a
 medication-contraindication review, so those generic actions may not capture what a provider actually did.

 The question
• Are the existing Tier 1 resolution actions acceptable for angioedema, or would you prefer airway-specific
    options?
•   If bespoke, what should the choices be? For example: 'advised patient to call 911 / go to the ED', 'ACE
    inhibitor or ARB stopped', 'epinephrine / treatment given', 'seen in office', or 'false alarm — not
    angioedema'.

 Our recommendation
 The generic Tier 1 actions are safe enough to launch with. A short bespoke set tailored to an airway
 emergency would document the event more accurately; if you would like that, tell us the labels and we will
 add them. Either way the alert stays non-dismissable and fully audited.


 5. Scope confirmations for the pilot


Cardioplace v2 — Pending Clinical Clarifications                                                            Page 2
 Each item below is already built (or intentionally not built) and simply needs a scope decision for the pilot:
 either confirm the current behavior is what you intended, or tell us whether to build it before the pilot or
 defer it to after. The middle column says what the system does today; the right column states exactly what
 we need from you.

           Item                                    Status today                         Decision needed

           Post-pregnancy risk flag (history       Captured at intake and shown as      Confirm 'flag only' is correct, or
           of preeclampsia / gestational           an informational flag on the admin   tell us to also apply an
           HTN)                                    dashboard; no threshold change       elevated-risk threshold outside
                                                   applied                              pregnancy.

           HFpEF beta-blocker prescribed           Not implemented (needs an            Needed before the pilot, or can
           for hypertension only                   intake question to capture why the   it wait? (Our recommendation:
                                                   beta-blocker was prescribed)         post-pilot.)

           Aortic stenosis rules                   Deferred (shares hemodynamics        Needed before the pilot, or
                                                   with HCM)                            post-pilot? (Our
                                                                                        recommendation: post-pilot.)

           BP Level-2 resolution action            Implemented as the 6th Level-2       Confirm this action is approved
           'Unable to reach patient — will         resolution action (schedules a       as worded.
           retry'                                  retry escalation)

 Once these are answered, the rules in items 1–2 get built to your specification, the pre-personalization behavior is finalized,
 and the scope items in item 5 are locked for the pilot. Thank you.




Cardioplace v2 — Pending Clinical Clarifications                                                                             Page 3
