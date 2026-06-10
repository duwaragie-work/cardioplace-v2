# Cardioplace v2 — Document 1 (Patient App) Copy Review with Suggested Responses

Cardioplace v2 — Document 1 (Patient App) Copy Review with Suggested
Responses

Prepared for: Dr. Manisha Singal · Rengan · Duwaragie (Engineering)
Prepared by: Clinical Copy Review

Date: June 2, 2026

Source: Cardioplace Product Copy Inventory — Document 1 of 2 (Patient
App), dated May 26, 2026

Status: Complete screen-by-screen review with suggested wording,
clinical rationale, tone guidance, and translation flags

> \---

### HOW TO USE THIS DOCUMENT

This document provides a complete review of Document 1 (Patient App — 30
screens, \~900 items). For each screen section, the following are
provided:

  - > Suggested wording — the recommended patient-facing copy for each
    > item group

  - > Spoken variant — where the audio/TTS version should differ from
    > screen text

  - > Clinical rationale — the guideline or evidence basis, with
    > citations

  - > Tone notes — specific guidance on warmth, reading level, and
    > patient experience

  - > Translation flags — items requiring special attention for the
    > 5-language build (English, Spanish, French, German, Amharic)

  - > Open decision points — items requiring Dr. Singal's or
    > engineering's input before finalizing GUIDING PRINCIPLES (applied
    > throughout):

<!-- end list -->

1.  > Reading level: ≤ 6th-grade Flesch-Kincaid for all patient-facing
    > copy. The AMA, NIH, and US DHHS recommend patient education
    > materials be written at or below the 6th-grade reading level.
    > Studies consistently show that most health app content exceeds
    > this threshold (mean 9th–10th grade), contributing to poor
    > comprehension and nonadherence.

2.  > Sentence length: ≤ 20 words per sentence. Short sentences,
    > bulleted lists, and actionable content are essential elements of
    > health-literate design.

3.  > Terminology: Use "your care team" (not "your doctor" or "your
    > provider"). Use "blood pressure" (not "BP") in patient-facing
    > copy. Use "top number" and "bottom number" (not "systolic" and
    > "diastolic") except where the clinical term is parenthetically
    > included.

4.  > Tone: Warm, human, non-judgmental. The goal is that a patient
    > feels a person on the other side, not a machine. Never guilt,
    > never alarm unnecessarily, always offer a next step.

5.  > Emergency copy: Must be unambiguous, action-oriented, and
    > localized. Remote monitoring is not a substitute for emergency
    > services — this must be stated clearly.

6.  > Silent literacy: Never use the word "literacy." Never imply the
    > patient is being assessed or tested. Adapt to the patient through
    > voice, visuals, and simple language without calling attention to
    > it.

> \---

OPEN DECISION POINTS (8 items — resolve before final implementation)

\#1 — VERBATIM CODE STRINGS: Are the actual code strings available for
line-by-line markup, or should engineering map these templates to each
rule/screen?

\#2 — ALERT THRESHOLDS: Should this document include recommended numeric
thresholds (e.g., HFrEF Low = SBP 90, CAD DBP Critical = DBP 60), or are
these already defined in the codebase?

\#3 — ESCALATION TIER DEFINITIONS: What are the current tier definitions
and expected response times? This affects all "What happens next" copy.
The HRS Expert Consensus Statement recommends that high-priority alerts
be reviewed and acted upon within 1 business day, and that patients be
clearly informed that remote monitoring does not substitute for
emergency services.

\#4 — SPOKEN VARIANT SCOPE: For the 132-item daily check-in wizard and
65-item dashboard, how many items have distinct spoken variants vs.
simply reading screen text aloud?

\#5 — EMERGENCY NUMBER LOCALIZATION: Should localized emergency numbers
be specified per locale (112 Germany, 15/112 France, 911 US, 911
Ethiopia), or handled separately? This is the highest-priority
localization item — emergency copy is safety-critical.

\#6 — HEALTH ASSISTANT GUARDRAILS: Is the Health Assistant AI-powered?
If so, clinical guardrails and scope limitations must be implemented.
The APA Resource Document on Digital Mental Health recommends informed
consent processes stating the potential risk of loss of personal privacy
and other risks when using apps.

\#7 — CAREGIVER PERMISSIONS MODEL: What level of information do
caregivers see (alerts only? readings? medications?)? This affects
consent language and caregiver copy.

\#8 — BP PHOTO OCR VALIDATION: What is the current OCR accuracy rate? If
below clinical threshold, the confirm modal copy should be more
cautious.

> \---

### SCREEN-BY-SCREEN REVIEW

> \==================================================================
> 
> \=

1.  > WELCOME / LANDING (15 items)

> \==================================================================
> 
> \=

### HEADER NAV

Suggested: "Cardioplace" (logo) · "About" · "Sign in" · "Get started"

Tone: Clean, minimal. "Get started" is warmer than "Sign up" or
"Register." HERO

Suggested: "Track your blood pressure. Stay connected to your care team.
Feel supported every day."

Tone: Warm, benefit-led, no clinical language. One sentence per line for
scannability. Three short promises that cover the core value
proposition.

Spoken variant: Same, read conversationally with brief pauses between
sentences. HERO CTA

Suggested: "Get started"

Tone: Action-oriented, low-commitment. Avoid "Sign up" (implies
obligation) or "Register" (clinical/bureaucratic).

### TRUST BADGES

Suggested: Display DC Hospital Association logo prominently. Add "Built
with doctors and patients" or similar human-centered trust signal.

Tone: Trust badges should feel earned, not boastful. Emphasize
partnership over authority. PARTNER FOOTER

Suggested: "A partnership with the DC Hospital Association" BP CARD
ILLUSTRATION

Tone: Should depict diverse patients (age, race, body type). Avoid
stock-photo feel. Illustrations are often warmer than photographs for
health apps.

> \==================================================================
> 
> \=

2.  > HOMEPAGE / MARKETING (56 items)

> \==================================================================

### \= HERO

Suggested: "Your heart health, in your hands — with your care team right
beside you."

Tone: Empowering but not isolating. The "right beside you" clause
prevents the patient from feeling alone.

### HERO CHAT INPUT

Suggested placeholder: "Ask a question about your health…" Tone:
Conversational, inviting. Low barrier to engagement. HERO PROMPT CHIPS

Suggested: "Ask about my blood pressure" · "What do my readings mean?" ·
"Learn about my medications"

Tone: First-person ("my") makes it feel personal. Avoid clinical
phrasing. HERO CTA

Suggested: "Get started — it's free"

Tone: If the pilot is free, say so. Removes a barrier. PARTNERSHIP
BANNER

Suggested: "Cardioplace is built in partnership with the DC Hospital
Association and leading cardiologists."

Tone: Credibility through partnership, not self-promotion. FEATURES
(intro)

Suggested: "Everything you need to stay on top of your heart health."
FEATURE CARD 1 (BP tracking)

Suggested: "Check your blood pressure at home. Your care team sees it
right away."

Tone: ≤ 15 words. Benefit-centric. Emphasizes the connection, not the
technology. FEATURE CARD 2 (Alerts)

Suggested: "If something looks off, your care team is notified
automatically." Tone: Reassuring, not alarming. "Looks off" is warmer
than "is abnormal." FEATURE CARD 3 (Medications)

Suggested: "Keep track of your medications and get reminders when you
need them." FEATURE CARD 3 MOCK

Tone: If this is a UI mockup illustration, ensure it shows realistic but
non-alarming data. Avoid showing emergency-level readings in marketing
materials.

FEATURE CARD 4 (Support)

Suggested: "Your caregivers can stay in the loop and help when it
matters." SILENT LITERACY

Suggested: "Cardioplace adapts to you — with voice, visuals, and simple
language — so you can focus on your health, not on figuring out an app."

Tone: CRITICAL — Never use the word "literacy." Never imply the patient
is being assessed or that they have a reading difficulty. This section
should feel like a feature, not an accommodation.

Translation flag: The concept of "silent literacy" may not translate
directly. In each language, the copy should convey "the app adapts to
you" without any implication of assessment.

### TARGET AUDIENCE — FOR PATIENTS CARD

Suggested: "Easy to use. Built around you. Connected to your care team."
TARGET AUDIENCE — FOR CARE TEAMS CARD

Suggested: "Real-time patient data. Guideline-based alerts. Streamlined
workflows." Tone: This card targets clinicians — clinical language is
appropriate here.

### TARGET AUDIENCE — FOR HEALTH SYSTEMS CARD

Suggested: "Scalable remote monitoring with built-in health equity
design." Tone: This card targets administrators — system-level language
is appropriate. CTA (bottom of page)

Suggested: "Ready to get started?"

CTA button: "Create your account"

> \==================================================================
> 
> \=

3.  > LANDING CHROME (22 items)

> \==================================================================
> 
> \=

### HEADER NAV

Suggested: "Cardioplace" (logo) · "About" · "Sign in" HEADER CTA

Suggested: "Get started" FOOTER CTA

Suggested: "Ready to get started?" FOOTER BRAND

Suggested: "Cardioplace · A heart health companion" Tone: "Companion" is
warmer than "platform" or "tool." FOOTER LINKS

Suggested: "About" · "Terms of Service" · "Privacy Policy" · "Contact"
FOOTER CONTACT

Suggested: "Questions? Reach us at \[email\] or \[phone\]."

Tone: Accessible, human. Include both email and phone — some patients
prefer voice. FOOTER BOTTOM

Suggested: "© 2026 Cardioplace. All rights reserved."

> \==================================================================
> 
> \=

4.  > SIGN IN (45 items)

> \==================================================================

### \= HEADING

### 

Suggested: "Welcome back"

Tone: Warm, personal. Not "Sign in to your account" (transactional).
MODE TOGGLE

Suggested: "Sign in with a code" / "Sign in with a link"

Tone: Plain language. Avoid "OTP" or "magic link" in patient-facing
copy. EMAIL FIELD

Suggested: "Your email address" OTP FLOW

  - > Prompt: "We sent a 6-digit code to your email. Enter it below."

  - > Resend: "Didn't get it? Send a new code"

  - > Success: "Code accepted."

Tone: Conversational. "Didn't get it?" is warmer than "Resend
verification code." MAGIC LINK FLOW

  - > Prompt: "We sent a sign-in link to your email. Click it to sign
    > in."

  - > Fallback: "Didn't get it? Send a new link"

  - > Tip: "Check your spam folder if you don't see it." STATUS MESSAGES

  - > Success: "You're signed in."

  - > Loading: "Signing you in…" Tone: Brief, warm.

### ERROR MESSAGES

  - > Invalid code: "That code doesn't match. Please check and try
    > again."

  - > Expired code: "That code has expired. We've sent you a new one."

  - > Invalid email: "Please enter a valid email address."

  - > Too many attempts: "Too many attempts. Please wait a few minutes
    > and try again."

  - > Generic: "Something went wrong. Please try again."

Tone: CRITICAL — Never show raw error codes or technical messages.
Always suggest a next step. Never blame the patient ("You entered the
wrong code" → "That code doesn't match").

### TERMS

Suggested: "By signing in, you agree to our Terms of Service and Privacy
Policy."

Medical disclaimer (must be visible at sign-in): "Cardioplace helps you
track your health and stay connected to your care team. It is not a
substitute for medical advice, diagnosis, or treatment. In an emergency,
call 911."

Clinical rationale: The FDA's guidance on mobile medical applications
and the APA's Resource Document on Digital Mental Health both recommend
clear disclaimers that apps are aids to care delivery, not replacements
for provider interactions. Informed consent should be voluntary and
transparent.

Translation flag: OPEN DECISION POINT \#5 — Emergency number must be
localized. INFO PANEL

Suggested: "Your information is private and secure. Only your care team
can see your health data."

Clinical rationale: The AHA Policy Statement on Health Information
Collection, Sharing, and Use emphasizes that patients should understand
who has access to their data. HIPAA protects individually identifiable
health information collected by covered entities, but patients may
assume broader protections than actually exist.

> \==================================================================
> 
> \=

1.  > MAGIC LINK CALLBACK (6 items)

> \==================================================================

### \= PROCESSING

Suggested: "Signing you in…" ERROR

Suggested: "Something went wrong. Please try signing in again." Tone:
Brief, warm, no technical language. Offer a clear next step.

> \==================================================================
> 
> \=

2.  > ONBOARDING (16 items)

> \==================================================================

### \= HEADING

Suggested: "Welcome to Cardioplace — let's get you set up" Tone:
Friendly, collaborative ("let's").

### NAME FIELD

Suggested: "What should we call you?"

Tone: This is the preferred name, not the legal name. Use this name
throughout the app (greeting card, spoken summaries).

### COMM PREF FIELD

Suggested: "How would you like to hear from your care team?" Options:
"Text message" · "Email" · "Phone call"

Tone: Respect patient autonomy. The JACC Scientific Statement on
Consumer Mobile Technologies emphasizes that tools should allow users to
"self-tailor" aspects of the intervention that best align with their
individual preferences.

### ACTIONS

Suggested: "Continue" (not "Submit" or "Next")

Tone: "Continue" implies a journey; "Submit" implies a form. INFO PANEL

Suggested: "This will take about 5–10 minutes. Your answers help your
care team personalize your experience."

Tone: Set expectations. Patients are more likely to complete intake if
they know the time commitment.

> \==================================================================
> 
> \=

3.  > CLINICAL INTAKE WIZARD (138 items)

> \==================================================================
> 
> \=

## \*\*\*\* HIGHEST CLINICAL PRIORITY — THIS SECTION DRIVES ALL ALERT

> **LOGIC** \*\*\*\* A0b INTRO

Suggested: "We're going to ask you some questions about your health.
Your answers help us watch for things that matter most to you and your
care team. You can update these anytime."

Spoken variant: Same, read conversationally.

Tone: Reassuring. "You can update these anytime" reduces pressure to get
everything perfect. DATE FIELDS

Standard date picker. Use locale-appropriate format (MM/DD/YYYY for US,
DD/MM/YYYY for others).

### DOB VALIDATION

  - > Implausible date: "That date doesn't look right. Please check and
    > try again."

  - > Under 18: "Cardioplace is currently available for adults 18 and
    > older."

  - > Future date: "Please enter a date in the past." Tone: Gentle, not
    > accusatory.

### A1 DEMOGRAPHICS

  - > Sex: "What sex were you assigned at birth?" (Options: Female ·
    > Male)

Clinical rationale: Biological sex affects drug metabolism, angioedema
risk (2–4× higher in Black patients taking ACE inhibitors), and
pregnancy eligibility. This is a clinical field, not a gender identity
field.

  - > Race/ethnicity: "This information helps your care team provide the
    > best care for you. You may choose more than one."

Options: Per OMB categories.

Clinical rationale: Race/ethnicity data informs ACE inhibitor angioedema
risk stratification and may affect BP treatment targets. The AHA
Scientific Statement on Patient-Centered Cardiovascular Care emphasizes
that equitable care requires addressing social determinants of health.

Tone: Explain why the question is being asked. Patients are more willing
to share demographic data when they understand the clinical purpose.

### A2 PREGNANCY

  - > Question: "Are you currently pregnant?"

  - > If yes: "How far along are you? (weeks)" — free-text or picker

  - > Follow-up: "Have you ever had high blood pressure during a
    > previous pregnancy (preeclampsia or gestational hypertension)?"

Clinical rationale: Per ACOG Practice Bulletin 222, history of
preeclampsia is a major risk factor for recurrence. Up to 50% of women
with gestational hypertension will eventually develop preeclampsia,
especially if diagnosed before 32 weeks. This field drives the
pregnancy-specific alert thresholds and symptom override rules.

Translation flag: "Preeclampsia" needs a plain-language parenthetical in
all languages: "(a condition where blood pressure gets dangerously high
during pregnancy)."

NOTE: Per the separate Pending Clarifications document (Q7), the
recommended approach is to rename the schema field from
historyPreeclampsia to historyHDP and update the patient-facing question
to: "Have you ever had high blood pressure during a pregnancy? This
includes preeclampsia, gestational hypertension, or HELLP syndrome."

### A3 CONDITIONS

Patient-friendly labels with parenthetical explanations:

  - > "Heart failure (your heart doesn't pump as well as it should)"

  - > "Coronary artery disease (narrowed or blocked heart arteries)"

  - > "Hypertrophic cardiomyopathy (thickened heart muscle)"

  - > "Dilated cardiomyopathy (enlarged, weakened heart)"

  - > "Atrial fibrillation (irregular heartbeat)"

  - > "High blood pressure (hypertension)"

  - > "Diabetes"

  - > "Aortic stenosis (a narrowed heart valve)"

Instruction: "Check all that apply. If you're not sure, that's okay —
your care team can help." Tone: Non-judgmental. "If you're not sure"
normalizes uncertainty.

Clinical rationale: Each condition maps to a specific alert rule branch
in the engine. Aortic stenosis should be included per the Pending
Clarifications document (Q4), as it now drives the new RULE*DHP*CCB*AS
contraindication warning.*

A4 HF TYPE (conditional on A3 = heart failure)

Suggested: "Do you know your heart's pumping strength (ejection
fraction)?" Options:

  - > "Reduced — 40% or less (HFrEF)"

  - > "Mildly reduced — 41% to 49% (HFmrEF)"

  - > "Preserved — 50% or more (HFpEF)"

  - > "I'm not sure"

Fallback: "If you don't know, that's completely fine. Your care team can
fill this in."

Clinical rationale: This distinction drives different alert thresholds
(HFrEF vs. HFpEF) and medication safety rules (NDHP-CCB contraindication
in HFrEF). The 2025 AHA/ACC guideline recommends SBP 130 mmHg in HFrEF
with hypertension.

### A5 MEDICATIONS

Intro: "Please list all the medications you take — including
prescriptions, over-the-counter medicines, and supplements."

Grouping (patient-friendly):

  - > "Blood pressure medications"

  - > "Heart rhythm medications"

  - > "Water pills (diuretics)"

  - > "Blood thinners"

  - > "Pain medications (including over-the-counter like ibuprofen or
    > naproxen)"

  - > "Other medications or supplements"

Tone: "Getting this right helps us watch for side effects and
interactions." Clinical rationale: Each medication class maps to
specific alert rules:

  - > ACE inhibitors/ARBs → pregnancy contraindication
    > (RULE*PREGNANCY*ACE*ARB)*

  - > NDHP-CCBs → HFrEF contraindication (RULE*NDHP*HFREF)

  - > DHP-CCBs → aortic stenosis warning (RULE*DHP*CCB*AS, new per Q4)*

  - > NSAIDs → antihypertensive interaction
    > (RULE*NSAID*ANTIHTN*INTERACTION)*

  - > Beta-blockers → dizziness, fatigue, SOB monitoring

  - > Loop diuretics → hypotension monitoring A5 OTHER MEDS

Suggested: "Do you take any over-the-counter pain medications like
ibuprofen (Advil, Motrin) or naproxen (Aleve)?"

Clinical rationale: NSAIDs reduce the BP-lowering effect of ACE
inhibitors, ARBs, diuretics, and beta-blockers by 2–10 mmHg. This is a
commonly missed interaction.

### A6 COMBOS

Suggested: "Some medications come as a combination pill. If yours does,
you can enter it as one item."

### A7 DEDUP MODAL

Suggested: "It looks like \[Medication A\] and \[Medication B\] might be
the same medication. Are they the same?"

Options: "Yes, same medication" / "No, they're different" Tone: Helpful,
not accusatory.

### A8 CATEGORIES / A9 FREQUENCY

Standard UX.

Frequency options: "Once a day" · "Twice a day" · "Three times a day" ·
"As needed" · "Other"

### A10 REVIEW

Screen text: "Please review your information below. If anything looks
wrong, tap 'Edit' to change it."

Spoken variant: "Here's a summary of what you entered. \[Read back
conditions and medications\]. Does everything look right?"

Tone: Give the patient control. Review screens reduce errors and build
trust. A11 COMPLETE

Suggested: "You're all set\! Your care team now has the information they
need to personalize your experience. You can update this anytime in your
profile."

Tone: Celebratory. Consider a brief animation or checkmark. This is a
moment of accomplishment.

### WIZARD NAV

  - > Back: "Back"

  - > Next: "Continue"

  - > Skip: "Skip for now" (only where clinically safe to skip — NOT on
    > conditions, medications, or pregnancy)

### VALIDATION

  - > Required field: "This field is needed to continue."

  - > Invalid entry: "Please check this entry and try again." Tone:
    > Brief, non-judgmental.

### EXIT SAVE MODAL

Suggested: "Your progress has been saved. You can come back and finish
anytime." Tone: Reassuring, not guilt-inducing. Never say "You haven't
finished" or "Incomplete." EXIT SAVE MODAL (EDIT MODE)

Suggested: "You have unsaved changes. Would you like to save before
leaving?" PROFILE EXISTS

Suggested: "It looks like you already have a profile. Would you like to
update it?" RE-ADD REJECTED MODAL

Suggested: "Your care team made a change to your profile. \[Field name\]
was updated to \[new value\]. If you have questions, please contact your
care team."

Tone: Transparent, not alarming. The patient should understand what
changed and why.

> \==================================================================
> 
> \=

1.  > DASHBOARD (65 items)

> \==================================================================
> 
> \=

### ACTIVE ALERT BANNER

Color-code by severity:

  - > Red: Emergency (angioedema, BP Level 2)

  - > Orange/Yellow: Urgent (BP Level 1, medication contraindication)

  - > Blue: Informational (Tier 3, surveillance)

Copy should match the corresponding alert rule from Document 2.

### GREETING CARD

Suggested: "Good \[morning/afternoon/evening\], \[preferred name\]."

Tone: Use time-of-day greeting. Use the name from onboarding ("What
should we call you?"). This small personalization significantly improves
engagement.

### BP STAT CARD

Suggested: "Your last reading: \[SBP/DBP\] mmHg · \[Date\]"

Context line: "Your \[week/month\] average is \[X/Y\] — that's \[within
/ above / below\] your target of \[target\]."

Tone: CRITICAL — Always contextualize the number. Raw numbers without
interpretation are anxiety-provoking. The AHA/AMA Joint Policy Statement
recommends that home BP be assessed based on the average of all
readings, not individual readings — the dashboard should reinforce this
by showing averages prominently.

### STREAK CARD

Suggested: "You've checked in \[N\] days in a row — \[encouraging
phrase\]\!" Phrases by streak length:

  - > 1–3 days: "Great start\!"

  - > 4–7 days: "You're building a great habit\!"

  - > 8–14 days: "Impressive — keep it up\!"

  - > 15–30 days: "Your care team can see the difference\!"

  - > 30+ days: "Amazing dedication to your health\!"

Clinical rationale: Gamification elements (streaks, badges) are
evidence-based engagement strategies. The JACC Scientific Statement on
Consumer Mobile Technologies notes that push notifications,
gamification, and accountability features can modify engagement in
disengaged patients.

### CHECK-INS CARD / TODAY'S CHECK-IN CTA

Not yet completed: "Time for your daily check-in" Completed: "Today's
check-in is done. Nice work\!" Tone: Encouraging, not nagging.

### PERSONAL GOAL CARD

Suggested: "Your goal: \[patient-set goal\]. \[Progress indicator\]."

Tone: Patient-driven. Never impose goals. The AHA Scientific Statement
on Patient-Centered Cardiovascular Care emphasizes that care should
align with patients' goals, values, and preferences.

### BP TREND CHART

  - > Y-axis: SBP and DBP with target range shaded in green

  - > X-axis: Date

  - > Tooltip: "This dot shows your reading on \[date\]: \[SBP/DBP\]
    > mmHg."

Tone: Visual clarity over data density. Patients with HF found that
visuals showing changes in symptoms were among the most favored app
features.

### BP TREND CHART TOOLTIP

Suggested: "\[Date\]: \[SBP/DBP\] mmHg" Tone: Minimal, informative.

### HEAR SUMMARY PILL

Label: "Hear your summary"

Tone: This is a key accessibility feature. Make it prominent.

HEAR SUMMARY (SPOKEN OVERVIEW) — spoken aloud only Suggested script:

"Here's your summary for today. Your blood pressure this morning was
\[X\] over \[Y\]. That's \[within your target / a little higher than
your target / a little lower than your target\]. \[Your weight today was
X pounds.\] \[You've taken your medications today. / Don't forget to
take your medications.\] \[Your care team left you a message — check
your notifications.\] Have a good \[morning/afternoon/evening\]."

Tone: Conversational, warm, brief. Say "blood pressure" not "BP." Say "X
over Y" not "X slash Y." End on a positive note.

Translation flag: Spoken summaries must be carefully translated — they
are the primary interface for patients who prefer audio. The HRS Expert
Consensus Statement recommends that patient education be individualized
to support patient communication preferences, including auditory
information.

### NOTIFICATIONS PANEL

Suggested: "You have \[N\] new notification(s)." / "No new notifications
— you're all caught up\!"

> \==================================================================
> 
> \=

1.  > DAILY CHECK-IN WIZARD (132 items)

> \==================================================================
> 
> \=

## \*\*\*\* HIGH CLINICAL PRIORITY — THIS IS THE PRIMARY DATA COLLECTION INTERFACE \*\*\*\*

### WIZARD NAV

  - > Back: "Back"

  - > Next: "Continue"

  - > Done: "Finish check-in" SESSION BANNER

Suggested: "\[Morning/Evening\] check-in · \[Date\]" INTAKE REQUIRED
GATE

Suggested: "Before you can start checking in, we need a few more details
about your health. This helps us watch for things that matter to you."

CTA: "Complete your health profile"

Tone: Explain the "why." Patients are more likely to complete intake
when they understand its purpose.

### RESUME PROMPT

Suggested: "Welcome back\! Let's pick up where you left off." OPEN
SESSION PROMPT

Suggested: "You have an unfinished check-in from earlier. Would you like
to continue or start fresh?"

Options: "Continue where I left off" / "Start a new check-in" SAVE AND
EXIT MODAL

Suggested: "Your progress has been saved. You can come back and finish
anytime." B1 CHECKLIST

Suggested: "Today's check-in:"

  - > ☐ Blood pressure reading

  - > ☐ Weight (shown only for HF patients)

  - > ☐ Medications

  - > ☐ How you're feeling

Tone: Visual checklist gives patients a sense of progress and
completion. B2 READING (BP entry)

Screen text: "Enter your blood pressure reading"

Fields: "Top number (systolic)" · "Bottom number (diastolic)" · "Heart
rate (pulse)"

Instruction: "If you're not sure which number is which, the top number
is usually the larger one."

Spoken variant (BP measurement guidance):

"Before you take your reading, here are a few tips. Sit in a chair with
your back supported and your feet flat on the floor. Rest your arm on a
table with the cuff at heart level. Relax for five minutes before you
start. Don't talk while the cuff is inflating. Take two readings, about
one minute apart."

Clinical rationale: Per the AHA/AMA Joint Policy Statement on
Self-Measured Blood Pressure Monitoring at Home, proper preparation and
positioning are critical for accurate BP measurements. The individual
should empty the bladder, rest for 5 minutes, sit with back and arm
supported, legs uncrossed, feet flat on the floor, cuff on bare midarm
at heart level, and avoid talking or using electronic devices during
measurement. Two readings at least 1 minute apart are recommended.

The JAMA Internal Medicine patient education resource on home BP
monitoring similarly recommends: "Measure your blood pressure after
sitting in a quiet space for 5 minutes. You should have an empty bladder
and uncrossed legs, and avoid caffeine before checking."

Translation flag: SAFETY-CRITICAL — This spoken guidance must be
carefully and accurately translated in all 5 languages. Measurement
technique instructions directly affect data quality and alert accuracy.

WEIGHT STEP (conditional on HF) Screen text: "What is your weight
today?"

Field: "\[number\] pounds" (with kg toggle for non-US locales)

Context: "Tracking your weight helps your care team watch for fluid
changes."

Spoken variant: "What is your weight today? Sudden weight gain can be a
sign that fluid is building up."

Clinical rationale: Daily weight monitoring is standard in HF remote
monitoring programs. MEDICATION STEP

Screen text: "Did you take all your medications today?"

Options: "Yes, all of them" · "I missed one or more" · "I'm not sure"

If missed: "Which medication(s) did you miss?" (show medication list
from profile)

Tone: CRITICAL — Non-judgmental. Never say "You failed to take…" The AHA
Scientific Statement on Medication Adherence emphasizes that adherence
interventions should be non-judgmental and that reminder messages
combined with educational content improve engagement.

Spoken variant: "Did you take all your medications today? If you missed
any, that's okay — just let us know which ones."

### B3 SYMPTOMS

Screen text: "Are you experiencing any of these today?" Checklist
(patient-friendly labels):

  - > "Shortness of breath (trouble breathing)"

  - > "Chest pain or pressure"

  - > "Dizziness or lightheadedness"

  - > "Swelling in your legs, ankles, or feet"

  - > "Heart racing or fluttering (palpitations)"

  - > "Fainting or nearly fainting"

  - > "Severe headache"

  - > "Vision changes (blurry vision, seeing spots)"

  - > "Feeling very tired (fatigue)"

  - > "Dry cough that won't go away"

  - > "Swelling of your face, lips, tongue, or throat"

  - > "None of the above"

Instruction: "Check all that apply."

Clinical rationale: Each symptom maps to one or more alert rules in
Document 2:

  - > Face/lip/tongue/throat swelling → angioedema emergency
    > (RULE*ACE*ANGIOEDEMA, RULE*GENERIC*ANGIOEDEMA)

  - > Chest pain + syncope → symptom override
    > (RULE*SYMPTOM*OVERRIDE*GENERAL)*

  - > Leg swelling → DHP-CCB side effect (RULE*DHP*CCB*LEG*SWELLING), HF
    > decompensation (RULE*HF*DECOMPENSATION)

  - > Dizziness → beta-blocker side effect
    > (RULE*BETA*BLOCKER*DIZZINESS), orthostatic hypotension
    > (RULE*ORTHOSTATIC*HYPOTENSION)*

  - > Palpitations → AFib (RULE*AFIB*PALPITATIONS), tachycardia
    > (RULE*TACHY*WITH*PALPITATIONS)*

  - > Dry cough → ACE cough (RULE*ACE*COUGH)

  - > Fatigue → beta-blocker fatigue (RULE*BETA*BLOCKER*FATIGUE)*

  - > SOB → beta-blocker SOB (RULE*BETA*BLOCKER*SOB*HF,
    > RULE*BETA*BLOCKER*SOB*NON*HF)*

> B3 SYMPTOMS (PREGNANCY) — additional items for pregnant patients

  - > "Severe headache that won't go away"

  - > "Vision changes (blurry vision, seeing spots, or flashing lights)"

  - > "Pain in your upper belly, especially on the right side"

  - > "Sudden swelling of your face or hands"

  - > "Trouble breathing"

> Clinical rationale: Per ACOG Practice Bulletin 222, these are warning
> signs of preeclampsia with severe features. New-onset headache
> unresponsive to medication, visual disturbances, and severe persistent
> right upper quadrant or epigastric pain are diagnostic criteria for
> preeclampsia with severe features. These symptoms should trigger the
> pregnancy symptom override alert (RULE*SYMPTOM*OVERRIDE*PREGNANCY).*

Translation flag: "Upper belly, especially

# Cardioplace v2 — Document 2 (Alert Messages & Emails) Copy Review with Suggested Responses

Cardioplace v2 — Document 2 (Alert Messages & Emails) Copy Review with
Suggested Responses

Prepared for: Dr. Manisha Singal · Rengan · Duwaragie (Engineering)
Prepared by: Clinical Copy Review

Date: June 2, 2026

Source: Cardioplace Product Copy Inventory — Document 2 of 2 (Alert
Messages & Emails), dated May 26, 2026

Status: Complete rule-by-rule review with three-tier wording (patient /
caregiver / clinician), clinical rationale, tone guidance, and
translation flags

> \---

### HOW TO USE THIS DOCUMENT

This document provides a complete review of Document 2 (Alert Messages &
Emails — 50+ alert rules, 7 email templates, 3 system messages, 2
notification types). For every alert rule, the following are provided:

  - > Three-tier wording — patient-facing, caregiver-facing, and
    > clinician-facing copy

  - > Spoken variant — where the audio/TTS version should differ from
    > screen text

  - > Clinical rationale — the guideline or evidence basis, with
    > citations

  - > Tone notes — specific guidance on warmth, urgency calibration, and
    > reading level

  - > Translation flags — items requiring special attention for the
    > 5-language build

  - > Threshold references — the BP/HR values that trigger each rule
    > (for cross-reference with codebase)

GUIDING PRINCIPLES (applied throughout):

1.  > Patient copy: ≤ 6th-grade reading level. Warm, non-alarming
    > (except emergencies). Always offer a next step. Never use "BP" —
    > always "blood pressure." Never use "systolic/diastolic" without
    > "top number/bottom number."

2.  > Caregiver copy: Slightly more clinical than patient copy, but
    > still plain language. Always include the patient's name and what
    > action (if any) the caregiver should take.

3.  > Clinician copy: Clinical precision. Include the numeric reading,
    > the rule that fired, the threshold, and the patient's relevant
    > conditions/medications. Concise — clinicians scan, not read.

4.  > Emergency copy: Unambiguous, action-oriented, localized. "Call
    > 911" must be localized per OPEN DECISION POINT \#5.

5.  > Tone calibration: The severity of the tone must match the severity
    > of the alert. Tier 3 (informational) should feel calm and
    > educational. Tier 1 (urgent) should feel serious but not panicked.
    > Emergency (angioedema, BP Level 2) should feel urgent and
    > directive.

> \---

### OPEN DECISION POINTS AFFECTING DOCUMENT 2

\#2 — ALERT THRESHOLDS: Threshold values are referenced below based on
standard clinical guidelines. Confirm these match the codebase values.

\#3 — ESCALATION TIER DEFINITIONS: Expected response times per tier
affect "What happens next" copy and email acknowledgment language.

\#5 — EMERGENCY NUMBER LOCALIZATION: All "Call 911" copy must be
localized (112 Germany, 15/112 France, 911 US, 911 Ethiopia).

> \---

### ALERT RULES — THREE-TIER WORDING

Each rule below provides suggested wording for all three tiers (patient,
caregiver, clinician). Where the rule has only 1 or 2 items in the
inventory, only those tiers are provided.

> ═════════════════════════════════════════════════════
> 
> ══
> 
> SHARED FRAGMENT (3 items) — *fragments*
> 
> ═════════════════════════════════════════════════════
> 
> ══

These are reusable text fragments inserted into multiple alert messages.
Fragment 1 — Emergency CTA:

"If you are having chest pain, trouble breathing, or feel like you might
faint, call 911 right away."

Fragment 2 — Care team notification: "Your care team has been notified."
Fragment 3 — Do not stop medication:

"Please do not stop taking any medication on your own without talking to
your care team."

Tone: Fragment 1 is safety-critical and must be localized. Fragment 3 is
essential — patients who receive alarming alerts may self-discontinue
medications, which can be dangerous.

> ═════════════════════════════════════════════════════
> 
> ══
> 
> ALERT: PREGNANCY ACE/ARB (3 items) — RULE*PREGNANCY*ACE*ARB*
> 
> ═════════════════════════════════════════════════════
> 
> ══
> 
> Trigger: Pregnant patient has ACE inhibitor or ARB in medication list.
> 
> Clinical rationale: ACE inhibitors and ARBs are contraindicated in
> pregnancy due to risk of fetal renal agenesis, oligohydramnios, and
> neonatal renal failure. This is an FDA black box warning.
> 
> PATIENT: "One of your medications (\[medication name\]) is not
> recommended during pregnancy. Please do not stop taking it on your own
> — your care team has been notified and will contact you to discuss a
> safe alternative."
> 
> Spoken variant: Same, read clearly and calmly.
> 
> CAREGIVER: "\[Patient name\] is taking a medication (\[medication
> name\]) that is not recommended during pregnancy. Their care team has
> been notified and will follow up."
> 
> CLINICIAN: "CONTRAINDICATION — Pregnant patient on \[ACE
> inhibitor/ARB\]: \[medication name\]. ACE/ARBs are contraindicated in
> pregnancy (FDA Category D/X). Recommend immediate substitution.
> Patient has been advised not to self-discontinue."
> 
> Tone: Serious but not panicked. The patient should not be frightened
> into abruptly stopping the medication (rebound hypertension risk). The
> clinician message must be actionable.
> 
> Translation flag: "Not recommended during pregnancy" must be precisely
> translated — avoid ambiguity that could be interpreted as "optional."
> 
> ═════════════════════════════════════════════════════
> 
> ══
> 
> ALERT: NDHP CCB IN HFrEF (3 items) — RULE*NDHP*HFREF
> 
> ═════════════════════════════════════════════════════
> 
> ══
> 
> Trigger: HFrEF patient has non-dihydropyridine CCB (diltiazem,
> verapamil) in medication list.

Clinical rationale: NDHP-CCBs have negative inotropic effects and are
associated with worsening HF and increased mortality in HFrEF. The 2022
AHA/ACC/HFSA HF guideline lists them as potentially harmful.

PATIENT: "One of your medications (\[medication name\]) may need to be
reviewed because of your heart condition. Your care team has been
notified. Please do not stop taking it on your own."

CAREGIVER: "\[Patient name\] is taking a medication (\[medication
name\]) that may need to be reviewed given their heart failure
diagnosis. Their care team has been notified."

CLINICIAN: "CONTRAINDICATION — HFrEF patient on non-dihydropyridine CCB:
\[medication name\] (diltiazem/verapamil). NDHP-CCBs are potentially
harmful in HFrEF (negative inotropy). Recommend review and
substitution."

> ═════════════════════════════════════════════════════
> 
> ══

ALERT: SYMPTOM OVERRIDE GENERAL (3 items) —
RULE*SYMPTOM*OVERRIDE*GENERAL*

> ═════════════════════════════════════════════════════
> 
> ══

Trigger: Patient reports chest pain, syncope, or severe symptoms
regardless of BP reading.

Clinical rationale: Symptoms of acute target organ damage (chest pain,
syncope, severe headache with neurological symptoms) require urgent
evaluation regardless of the BP value.

PATIENT: "Based on what you reported, your care team needs to know right
away. If you are having chest pain, trouble breathing, or feel like you
might faint, call 911. Otherwise, your care team has been notified and
will contact you."

Spoken variant: Read with measured urgency. Pause before "call 911."

CAREGIVER: "\[Patient name\] reported symptoms that need attention:
\[symptom list\]. Their care team has been notified. If \[patient name\]
is having chest pain, trouble breathing, or feels faint, please help
them call 911."

CLINICIAN: "SYMPTOM OVERRIDE — Patient reported: \[symptom list\] at
\[time\]. BP at time of report: \[SBP/DBP\] mmHg, HR \[X\] bpm. Symptoms
triggered override regardless of BP threshold. Recommend urgent clinical
assessment."

> ═════════════════════════════════════════════════════
> 
> ══
> 
> ALERT: SYMPTOM OVERRIDE PREGNANCY (3 items) —
> RULE*SYMPTOM*OVERRIDE*PREGNANCY*
> 
> ═════════════════════════════════════════════════════
> 
> ══

Trigger: Pregnant patient reports severe headache, vision changes, RUQ
pain, sudden facial/hand swelling, or trouble breathing.

Clinical rationale: Per ACOG Practice Bulletin 222, these are warning
signs of preeclampsia with severe features. New-onset headache
unresponsive to medication, visual disturbances, and severe persistent
right upper quadrant or epigastric pain are diagnostic criteria for
preeclampsia with severe features.

PATIENT: "Some of the symptoms you reported can be serious during
pregnancy. Please call your doctor or go to the hospital right away. If
you have trouble breathing or a very bad headache that won't go away,
call 911."

Spoken variant: Read slowly and clearly. This is a high-anxiety moment.

CAREGIVER: "\[Patient name\] reported pregnancy-related symptoms that
may be serious: \[symptom list\]. Please help them contact their doctor
or go to the hospital. If they have trouble breathing, call 911."

CLINICIAN: "PREGNANCY SYMPTOM OVERRIDE — \[Gestational age\] weeks.
Patient reported: \[symptom list\]. BP: \[SBP/DBP\] mmHg. Evaluate for
preeclampsia with severe features. ACOG criteria: headache unresponsive
to medication, visual disturbances, RUQ/epigastric pain,
thrombocytopenia, elevated LFTs, renal insufficiency."

> ═════════════════════════════════════════════════════
> 
> ══

ALERT: ABSOLUTE EMERGENCY (3 items) — RULE*ABSOLUTE*EMERGENCY

> ═════════════════════════════════════════════════════
> 
> ══

Trigger: SBP ≥180 and/or DBP ≥120 WITH symptoms (chest pain, SOB,
neurological symptoms, vision changes).

Clinical rationale: Per 2025 AHA/ACC guideline and AHA Scientific
Statement on Acute BP Management, SBP/DBP \>180/110–120 mmHg with
evidence of new or worsening target-organ damage constitutes a
hypertensive emergency requiring immediate evaluation.

PATIENT: "Your blood pressure is dangerously high and you are having
symptoms that need emergency care. Call 911 or go to the nearest
emergency room right now. Do not wait."

Spoken variant: "Your blood pressure is dangerously high. You need
emergency care right now. Call 9-1-1 or go to the nearest emergency
room. Do not wait."

CAREGIVER: "URGENT — \[Patient name\]'s blood pressure is dangerously
high (\[SBP/DBP\] mmHg) and they are having symptoms. Please help them
call 911 or get to the nearest emergency room immediately."

CLINICIAN: "HYPERTENSIVE EMERGENCY — BP \[SBP/DBP\] mmHg with symptoms:

\[symptom list\]. Meets criteria for hypertensive emergency (SBP ≥180
and/or DBP ≥120 with target organ damage). Patient advised to call 911.
Immediate evaluation required."

Tone: This is the most urgent alert in the system. Patient copy must be
directive, not suggestive. "Call 911 right now" not "You may want to
consider calling 911."

Translation flag: HIGHEST PRIORITY — Emergency number localization. "Do
not wait" must be unambiguous in all languages.

> ═════════════════════════════════════════════════════
> 
> ══

ALERT: PREGNANCY LEVEL 2 (3 items) — RULE*PREGNANCY*L2

> ═════════════════════════════════════════════════════
> 
> ══

Trigger: Pregnant patient with SBP ≥160 and/or DBP ≥110.

Clinical rationale: Per ACOG, severe hypertension in pregnancy (SBP ≥160
or DBP ≥110, confirmed within 15 minutes) is a medical emergency.
Antihypertensive treatment should be initiated within 30–60 minutes.
Untreated severe hypertension in pregnancy significantly increases the
risk of intracranial hemorrhage.

PATIENT: "Your blood pressure is very high. During pregnancy, this needs
urgent attention. Please call your doctor or go to the hospital right
away. If you can't reach your doctor, call 911."

CAREGIVER: "URGENT — \[Patient name\]'s blood pressure is very high
(\[SBP/DBP\] mmHg) during pregnancy. Please help them contact their
doctor or go to the hospital immediately."

CLINICIAN: "PREGNANCY BP LEVEL 2 — BP \[SBP/DBP\] mmHg at \[gestational
age\] weeks. Meets ACOG criteria for severe hypertension in pregnancy
(SBP ≥160 or DBP ≥110). Initiate antihypertensive therapy within 30–60
min. Evaluate for preeclampsia with severe features."

> ═════════════════════════════════════════════════════
> 
> ══
> 
> ALERT: PREGNANCY LEVEL 1 HIGH (3 items) — RULE*PREGNANCY*L1*HIGH*
> 
> ═════════════════════════════════════════════════════
> 
> ══

Trigger: Pregnant patient with SBP 140–159 and/or DBP 90–109.

Clinical rationale: Per AHA Scientific Statement on Hypertension in
Pregnancy, hypertension in pregnancy is defined as BP ≥140/90 mmHg.
Treatment thresholds vary by society but most international guidelines
recommend treatment at ≥140/90. The CHAP trial demonstrated benefit of
treating chronic hypertension in pregnancy to a target 140/90.

PATIENT: "Your blood pressure is higher than recommended during
pregnancy. Your care team has been notified and will follow up with you.
If you develop a severe headache, vision changes, or upper belly pain,
call your doctor right away."

CAREGIVER: "\[Patient name\]'s blood pressure is elevated (\[SBP/DBP\]
mmHg) during pregnancy. Their care team has been notified. Watch for
severe headache, vision changes, or upper belly pain — if these occur,
help them contact their doctor immediately."

CLINICIAN: "PREGNANCY BP LEVEL 1 HIGH — BP \[SBP/DBP\] mmHg at
\[gestational

age\] weeks. Above pregnancy HTN threshold (≥140/90). Monitor for
progression to severe range or preeclampsia features. Current
medications: \[list\]."

> ═════════════════════════════════════════════════════
> 
> ══

ALERT: HFrEF LOW (3 items) — RULE*HFREF*LOW

> ═════════════════════════════════════════════════════
> 
> ══

Trigger: HFrEF patient with SBP 90 mmHg (suggested threshold).

Clinical rationale: In HFrEF, the relationship between SBP and outcomes
is J-shaped. SBP 90 mmHg is associated with significantly worse
outcomes. However, low SBP should not preclude uptitration of GDMT if
the patient is asymptomatic.

PATIENT: "Your blood pressure is lower than expected. If you feel dizzy,
lightheaded, or faint, please sit or lie down right away. Your care team
has been notified."

CAREGIVER: "\[Patient name\]'s blood pressure is low (\[SBP/DBP\] mmHg).
If they feel dizzy or lightheaded, help them sit or lie down. Their care
team has been notified."

CLINICIAN: "HFrEF LOW BP — SBP \[X\] mmHg (threshold 90). Patient on:
\[medication list\]. Assess for symptomatic hypotension. Consider GDMT
dose adjustment if symptomatic. Note: asymptomatic low SBP alone is not
a contraindication to GDMT continuation per 2022 AHA/ACC/HFSA
guideline."

> ═════════════════════════════════════════════════════
> 
> ══

ALERT: HFrEF HIGH (3 items) — RULE*HFREF*HIGH

> ═════════════════════════════════════════════════════
> 
> ══

Trigger: HFrEF patient with SBP ≥130 mmHg.

Clinical rationale: The 2025 AHA/ACC guideline recommends SBP 130 mmHg
in HFrEF with hypertension. SBP ≥130 in HFrEF may indicate suboptimal
GDMT or need for medication adjustment. Per the Pending Clarifications
document (Q2), this rule should fire on single-reading (not
session-averaged).

PATIENT: "Your blood pressure is a bit higher than your target. Your
care team has been notified and may want to adjust your treatment."

CAREGIVER: "\[Patient name\]'s blood pressure is above their target
(\[SBP/DBP\] mmHg). Their care team has been notified."

CLINICIAN: "HFrEF HIGH BP — SBP \[X\] mmHg (threshold ≥130). Current
GDMT: \[medication list with doses\]. Consider uptitration of GDMT or
addition of antihypertensive therapy per 2025 AHA/ACC guideline."

> ═════════════════════════════════════════════════════
> 
> ══

ALERT: HFpEF LOW (3 items) — RULE*HFPEF*LOW

> ═════════════════════════════════════════════════════
> 
> ══

Trigger: HFpEF patient with SBP 90 mmHg (suggested threshold).

PATIENT: "Your blood pressure is lower than expected. If you feel dizzy
or lightheaded, please sit or lie down. Your care team has been
notified."

CAREGIVER: "\[Patient name\]'s blood pressure is low (\[SBP/DBP\] mmHg).
Their care team has been notified."

CLINICIAN: "HFpEF LOW BP — SBP \[X\] mmHg (threshold 90). Current
medications: \[list\]. Assess for symptomatic hypotension and volume
status."

> ═════════════════════════════════════════════════════
> 
> ══

ALERT: HFpEF HIGH (3 items) — RULE*HFPEF*HIGH

> ═════════════════════════════════════════════════════
> 
> ══

Trigger: HFpEF patient with SBP ≥130 mmHg.

PATIENT: "Your blood pressure is higher than your target. Your care team
has been notified."

CAREGIVER: "\[Patient name\]'s blood pressure is above their target
(\[SBP/DBP\] mmHg). Their care team has been notified."

CLINICIAN: "HFpEF HIGH BP — SBP \[X\] mmHg (threshold ≥130). Current
medications: \[list\]. Consider antihypertensive optimization."

> ═════════════════════════════════════════════════════
> 
> ══
> 
> ALERT: CAD DBP CRITICAL (3 items) — RULE*CAD*DBP*CRITICAL*
> 
> ═════════════════════════════════════════════════════
> 
> ══
> 
> Trigger: CAD patient with DBP 60 mmHg.
> 
> Clinical rationale: In CAD, low DBP compromises coronary perfusion
> (which occurs primarily during diastole). The J-curve phenomenon in
> CAD suggests that DBP 60 mmHg is associated with increased
> cardiovascular events.
> 
> PATIENT: "Your bottom blood pressure number is lower than expected. If
> you feel dizzy, have chest pain, or feel faint, please sit down and
> call your care team. If symptoms are severe, call 911."
> 
> CAREGIVER: "\[Patient name\]'s diastolic blood pressure is critically
> low (\[DBP\] mmHg). If they have chest pain or feel faint, help them
> call 911."
> 
> CLINICIAN: "CAD DBP CRITICAL — DBP \[X\] mmHg (threshold 60). CAD
> patient — low DBP may compromise coronary perfusion. Current
> medications: \[list\]. Assess for symptomatic hypotension. Consider
> dose reduction of antihypertensives, particularly vasodilators."
> 
> ═════════════════════════════════════════════════════
> 
> ══
> 
> ALERT: CAD HIGH SBP (3 items) — RULE*CAD*HIGH
> 
> ═════════════════════════════════════════════════════
> 
> ══
> 
> Trigger: CAD patient with SBP ≥130 mmHg.
> 
> Clinical rationale: The 2025 AHA/ACC guideline recommends SBP 130 mmHg
> in patients with CAD.
> 
> PATIENT: "Your blood pressure is higher than your target. Your care
> team has been notified."

CAREGIVER: "\[Patient name\]'s blood pressure is above their target
(\[SBP/DBP\] mmHg). Their care team has been notified."

CLINICIAN: "CAD HIGH BP — SBP \[X\] mmHg (threshold ≥130). Current
medications: \[list\]. Consider antihypertensive optimization per 2025
AHA/ACC guideline."

> ═════════════════════════════════════════════════════
> 
> ══

ALERT: CAD DBP HIGH (3 items) — RULE*CAD*DBP*HIGH*

> ═════════════════════════════════════════════════════
> 
> ══

Trigger: CAD patient with DBP ≥80 mmHg (or ≥90, confirm threshold).

PATIENT: "Your blood pressure is higher than your target. Your care team
has been notified."

CAREGIVER: "\[Patient name\]'s blood pressure is above their target
(\[SBP/DBP\] mmHg). Their care team has been notified."

CLINICIAN: "CAD DBP HIGH — DBP \[X\] mmHg (threshold ≥\[80/90\]).
Current medications: \[list\]. Consider antihypertensive adjustment."

> ═════════════════════════════════════════════════════
> 
> ══

ALERT: HCM LOW (3 items) — RULE*HCM*LOW

> ═════════════════════════════════════════════════════
> 
> ══

Trigger: HCM patient with SBP 90 mmHg.

Clinical rationale: In HCM, hypotension can worsen dynamic LVOT
obstruction. Patients should avoid dehydration and vasodilators.

PATIENT: "Your blood pressure is lower than expected. Please drink some
water and sit or lie down. Avoid standing up quickly. Your care team has
been notified."

CAREGIVER: "\[Patient name\]'s blood pressure is low (\[SBP/DBP\] mmHg).
Help them sit or lie down and drink water. Their care team has been
notified."

CLINICIAN: "HCM LOW BP — SBP \[X\] mmHg (threshold 90). Hypotension may
worsen dynamic LVOT obstruction. Current medications: \[list\]. Assess
hydration status. Review vasodilator use. Avoid volume depletion."

> ═════════════════════════════════════════════════════
> 
> ══

ALERT: HCM HIGH (3 items) — RULE*HCM*HIGH

> ═════════════════════════════════════════════════════
> 
> ══
> 
> Trigger: HCM patient with SBP ≥130 mmHg.
> 
> PATIENT: "Your blood pressure is higher than your target. Your care
> team has been notified."
> 
> CAREGIVER: "\[Patient name\]'s blood pressure is above their target
> (\[SBP/DBP\] mmHg). Their care team has been notified."
> 
> CLINICIAN: "HCM HIGH BP — SBP \[X\] mmHg (threshold ≥130). Current
> medications: \[list\]. Consider antihypertensive adjustment. Avoid
> pure vasodilators in obstructive HCM."
> 
> ═════════════════════════════════════════════════════
> 
> ══
> 
> ALERT: HCM VASODILATOR (1 item) — RULE*HCM*VASODILATOR
> 
> ═════════════════════════════════════════════════════
> 
> ══
> 
> Trigger: HCM patient has a vasodilator in medication list.
> 
> Clinical rationale: Vasodilators (including DHP-CCBs, nitrates, PDE5
> inhibitors) can worsen dynamic LVOT obstruction in obstructive HCM by
> reducing afterload.
> 
> CLINICIAN: "HCM VASODILATOR ALERT — Patient with HCM is on
> \[medication name\] (vasodilator class). Vasodilators may worsen
> dynamic LVOT obstruction in obstructive HCM. Review indication and
> consider alternative."
> 
> Tone: Informational — clinician-only alert. No patient or caregiver
> message needed.
> 
> ═════════════════════════════════════════════════════
> 
> ══
> 
> ALERT: DCM LOW (3 items) — RULE*DCM*LOW
> 
> ═════════════════════════════════════════════════════
> 
> ══
> 
> Trigger: DCM patient with SBP 90 mmHg.
> 
> PATIENT: "Your blood pressure is lower than expected. If you feel
> dizzy or lightheaded, please sit or lie down. Your care team has been
> notified."
> 
> CAREGIVER: "\[Patient name\]'s blood pressure is low (\[SBP/DBP\]
> mmHg). Their care team has been notified."

CLINICIAN: "DCM LOW BP — SBP \[X\] mmHg (threshold 90). Current
medications: \[list\]. Assess for symptomatic hypotension. Consider GDMT
dose adjustment if symptomatic."

> ═════════════════════════════════════════════════════
> 
> ══

ALERT: DCM HIGH (3 items) — RULE*DCM*HIGH

> ═════════════════════════════════════════════════════
> 
> ══
> 
> Trigger: DCM patient with SBP ≥130 mmHg.
> 
> PATIENT: "Your blood pressure is higher than your target. Your care
> team has been notified."
> 
> CAREGIVER: "\[Patient name\]'s blood pressure is above their target
> (\[SBP/DBP\] mmHg). Their care team has been notified."
> 
> CLINICIAN: "DCM HIGH BP — SBP \[X\] mmHg (threshold ≥130). Current
> medications: \[list\]. Consider antihypertensive optimization."
> 
> ═════════════════════════════════════════════════════
> 
> ══
> 
> ALERT: PERSONALIZED HIGH (3 items) — RULE*PERSONALIZED*HIGH
> 
> ═════════════════════════════════════════════════════
> 
> ══
> 
> Trigger: Patient exceeds provider-set personalized upper threshold.
> 
> PATIENT: "Your blood pressure is higher than the target your care team
> set for you. They've been notified."
> 
> CAREGIVER: "\[Patient name\]'s blood pressure (\[SBP/DBP\] mmHg) is
> above their personalized target. Their care team has been notified."
> 
> CLINICIAN: "PERSONALIZED HIGH — BP \[SBP/DBP\] mmHg exceeds
> patient-specific threshold of \[threshold SBP/DBP\]. Current
> medications: \[list\]. Review and adjust as indicated."
> 
> ═════════════════════════════════════════════════════
> 
> ══
> 
> ALERT: PERSONALIZED LOW (3 items) — RULE*PERSONALIZED*LOW
> 
> ═════════════════════════════════════════════════════
> 
> ══

Trigger: Patient falls below provider-set personalized lower threshold.

PATIENT: "Your blood pressure is lower than the target your care team
set for you. If you feel dizzy or lightheaded, please sit or lie down.
They've been notified."

CAREGIVER: "\[Patient name\]'s blood pressure (\[SBP/DBP\] mmHg) is
below their personalized target. Their care team has been notified."

CLINICIAN: "PERSONALIZED LOW — BP \[SBP/DBP\] mmHg below
patient-specific threshold of \[threshold SBP/DBP\]. Current
medications: \[list\]. Assess for symptomatic hypotension."

> ═════════════════════════════════════════════════════
> 
> ══
> 
> ALERT: STANDARD LEVEL 1 HIGH (3 items) — RULE*STANDARD*L1*HIGH*
> 
> ═════════════════════════════════════════════════════
> 
> ══

Trigger: SBP ≥160 and/or DBP ≥100 (severe Stage 2 HTN).

Clinical rationale: Per 2025 AHA/ACC guideline, Stage 2 HTN is SBP ≥140
or DBP ≥90. Severe Stage 2 (≥160/100) warrants more urgent follow-up.

PATIENT: "Your blood pressure is quite high. Your care team has been
notified and will follow up with you."

CAREGIVER: "\[Patient name\]'s blood pressure is significantly elevated
(\[SBP/DBP\] mmHg). Their care team has been notified."

CLINICIAN: Per Pending Clarifications Q5, use axis-specific wording:

  - > SBP-only trigger: "BP Level 1 High — severe Stage 2 SBP (SBP ≥160)
    > at \[SBP/DBP\] mmHg."

  - > DBP-only trigger: "BP Level 1 High — severe Stage 2 DBP (DBP ≥100)
    > at \[SBP/DBP\] mmHg."

  - > Both trigger: "BP Level 1 High — severe Stage 2 (≥160/100) at
    > \[SBP/DBP\] mmHg." Current medications: \[list\].

> ═════════════════════════════════════════════════════
> 
> ══

ALERT: STANDARD LEVEL 1 LOW (3 items) — RULE*STANDARD*L1*LOW*

> ═════════════════════════════════════════════════════
> 
> ══

Trigger: SBP 90 mmHg (suggested threshold).

PATIENT: "Your blood pressure is lower than expected. If you feel dizzy
or lightheaded, please sit or lie down. Your care team has been
notified."

CAREGIVER: "\[Patient name\]'s blood pressure is low (\[SBP/DBP\] mmHg).
If they feel dizzy, help them sit or lie down. Their care team has been
notified."

CLINICIAN: "BP LEVEL 1 LOW — SBP \[X\] mmHg (threshold 90). Current
medications: \[list\]. Assess for symptomatic hypotension. Review
antihypertensive regimen."

> ═════════════════════════════════════════════════════
> 
> ══

ALERT: AGE 65+ LOW (3 items) — RULE*AGE*65*LOW*

> ═════════════════════════════════════════════════════
> 
> ══
> 
> Trigger: Patient age ≥65 with SBP 90 mmHg (or condition-specific lower
> threshold).
> 
> Clinical rationale: Older adults are at higher risk for orthostatic
> hypotension and falls. The AHA Scientific Statement on OH in
> Hypertension notes that OH affects \~10% of hypertensive adults and is
> associated with dementia, cardiovascular disease, stroke, and death.
> Intensive BP treatment does not generally cause OH, but some
> antihypertensive classes may unmask it.
> 
> PATIENT: "Your blood pressure is lower than expected. Please be
> careful when standing up
> 
> — move slowly. If you feel dizzy or unsteady, sit or lie down right
> away. Your care team has been notified."
> 
> CAREGIVER: "\[Patient name\]'s blood pressure is low (\[SBP/DBP\]
> mmHg). Please watch for dizziness or unsteadiness, especially when
> standing. Their care team has been notified."
> 
> CLINICIAN: "AGE 65+ LOW BP — SBP \[X\] mmHg. Age \[X\]. Current
> medications: \[list\]. Assess for orthostatic hypotension (sustained
> SBP drop ≥20 or DBP drop ≥10 within 3 min of standing). Review
> medications for OH-aggravating agents. Consider fall risk assessment."
> 
> ═════════════════════════════════════════════════════
> 
> ══
> 
> ALERT: AFib HR HIGH (3 items) — RULE*AFIB*HR*HIGH*
> 
> ═════════════════════════════════════════════════════
> 
> ══
> 
> Trigger: AFib patient with HR \>110 bpm (lenient target) or \>100 bpm
> (if HF or symptomatic).

Clinical rationale: The 2023 ACC/AHA/ACCP/HRS AF guideline recommends a
resting HR target of 100–110 bpm in patients without HF. In patients
with HF or reduced LVEF, stricter rate control (80 bpm) may be
warranted.

PATIENT: "Your heart rate is faster than expected. If you feel your
heart racing, feel short of breath, or feel dizzy, please sit down and
rest. Your care team has been notified."

CAREGIVER: "\[Patient name\]'s heart rate is elevated (\[HR\] bpm). If
they feel their heart racing or are short of breath, help them sit down.
Their care team has been notified."

CLINICIAN: "AFib HR HIGH — HR \[X\] bpm (threshold \>110). AFib patient.
Current rate control: \[medication list\]. Assess for triggers (missed
medication, dehydration, infection, caffeine). Consider rate control
adjustment. If HF present, stricter target (80 bpm) may apply."

> ═════════════════════════════════════════════════════
> 
> ══

ALERT: AFib HR LOW (3 items) — RULE*AFIB*HR*LOW*

> ═════════════════════════════════════════════════════
> 
> ══
> 
> Trigger: AFib patient with HR 50 bpm (suggested threshold).
> 
> PATIENT: "Your heart rate is slower than expected. If you feel dizzy,
> lightheaded, or faint, please sit or lie down. Your care team has been
> notified."
> 
> CAREGIVER: "\[Patient name\]'s heart rate is low (\[HR\] bpm). If they
> feel dizzy or faint, help them sit or lie down. Their care team has
> been notified."
> 
> CLINICIAN: "AFib HR LOW — HR \[X\] bpm (threshold 50). Current

# Cardioplace v2 — Q1, Q4, Q5, Q6, Q7 Engineering Action Brief (MVP-Pilot)

Cardioplace v2 — Q1, Q4, Q5, Q6, Q7 Engineering Action Brief MVP-Pilot
Streamlined Guidance

Date: June 2, 2026

Audience: Engineering team (Duwaragie / Niva) Approved by: Dr. Singal
(pending sign-off)

> \---

CORE PRINCIPLE (repeated from Q2/Q3 brief)

The engine ALERTS — it does not DIAGNOSE or DECIDE. Every alert is a
flag for clinician review. The system should be sensitive (catch real
events) rather than specific (suppress noise).

> \---

### MASTER PRIORITY TABLE — ALL 7 QUESTIONS

Q | Topic | Priority | Code Change? | MVP-Blocking?

> \---|--------------------------------|----------------|---------------|---------------
> 
> Q1 | Adherence nudge wording | MEDIUM | Yes (string) | No — cosmetic
> Q2 | Session-averaging HFREF*HIGH | HIGH | Yes (logic) | YES — safety*
> Q3 | No-conditions personalization | NONE | No | No

Q4 | DHP-CCB + Aortic Stenosis | LOW | Defer | No — see below

Q5 | Stage 2 axis-specific wording | MEDIUM | Yes (string) | No — but
fixes confusion

Q6 | Per-reading vs per-session | LOW | Defer | No — cosmetic/UX Q7 |
Gestational HTN vs preeclampsia| LOW | Yes (rename) | No — cosmetic

> \---

### Q1 — ADHERENCE NUDGE WORDING

VERDICT: USE HYBRID VERSION (sign-off warmth + Niva's educational
sentence)

Priority: MEDIUM — string patch, not logic change What to do:

Patch the template string to this exact wording:

"Starting a new medicine can take some getting used to. If you missed a
dose, that's okay — just try to take your next one on time. Taking your
medicine every day helps keep your blood pressure steady. Your care team
is here to help if anything makes it hard to stay on schedule."

Why this hybrid:

  - > The "that's okay — just" clause from the sign-off version is
    > clinically important. The AHA Scientific Statement on Medication
    > Adherence emphasizes that adherence interventions should be
    > non-judgmental — shaming language drives patients away from
    > reporting missed doses.

  - > Niva's added sentence ("Taking your medicine every day helps keep
    > your blood pressure steady") is a valid educational reinforcement.
    > A 2026 systematic review of nudge-based interventions found that
    > 58% of nudge interventions significantly improved self-monitoring
    > adherence, with educational content being a key driver.

  - > The hybrid preserves warmth AND adds evidence-supported education.
    > Code change:

File: First-month adherence nudge template string Change: Replace
current string with hybrid above

Also: Fix code comment from "Verbatim from sign-off doc p.7" → "Hybrid
of sign-off + educational sentence (approved \[date\])"

Translation flag: "that's okay" must be translated idiomatically, not
literally, in all 5 languages

> \---
> 
> Q4 — DHP-CCB + AORTIC STENOSIS

VERDICT: DEFER TO POST-MVP. Flag for Phase 2.

Priority: LOW for MVP — this is a real clinical concern but the evidence
is nuanced and the implementation is complex

Why defer (not dismiss):

The evidence is genuinely conflicting:

  - > The FDA label for amlodipine explicitly warns: "Symptomatic
    > hypotension is possible, particularly in patients with severe
    > aortic stenosis."

  - > A 2020 retrospective study (Saeed et al.) found CCB use was
    > associated with a 7-fold increased mortality in moderate-to-severe
    > AS (HR 7.09; 95% CI 2.15–23.38).

  - > BUT a large 2025 Japanese registry (Yamamoto et al., n=2,460
    > severe AS patients) found CCBs were the most commonly prescribed
    > antihypertensive (71.7%) and showed comparable outcomes to non-CCB
    > therapy, with syncope rates of only \~1%.

  - > A 2024 JAMA review (Otto et al.) notes that first-line
    > antihypertensives for AS are "not well-established" and recommends
    > ACE inhibitors/ARBs as first-line, with beta-blockers as
    > alternatives — but does not list CCBs as absolutely
    > contraindicated.

Why this doesn't block MVP:

  - > The system currently tracks AS as a boolean only (no severity
    > grading). A contraindication warning without severity context
    > could generate false alarms for mild AS patients where CCBs are
    > likely safe.

  - > The clinical risk is primarily in SEVERE AS. Without severity
    > data, the alert would be imprecise.

  - > This is a provider-prescribed medication — the provider who
    > prescribed the CCB to an AS patient presumably made a clinical
    > judgment. An alert questioning that judgment without severity
    > context adds noise without clear safety benefit.

What to do NOW (zero code change):

  - > Add a ticket to the Phase 2 backlog: "RULE*DHP*CCB*AS: Add Tier 1
    > admin-only alert when AS patient has DHP-CCB in med list.
    > Requires: (1) severity grading for AS, or (2) decision to fire for
    > all AS regardless of severity."*

  - > In the interim, the existing clinical intake review process should
    > catch this — the provider reviews the patient's condition +
    > medication list during onboarding.

What Phase 2 looks like (post-MVP):

  - > Add Tier 1 admin-only alert (no patient-facing message)

  - > Soft-block modal during intake when AS patient adds a DHP-CCB

  - > Admin alert text: "Patient with aortic stenosis is taking
    > \[medication name\] (DHP-CCB). The FDA label notes risk of
    > symptomatic hypotension in severe AS. Please review."

> \---

### Q5 — STAGE 2 AXIS-SPECIFIC WORDING VERDICT: APPROVE ALL 3 VARIANT STRINGS

Priority: MEDIUM — fixes a genuinely misleading clinician message

What to do:

Patch the physician message template to use conditional logic:

String 1 (SBP-only): "BP Level 1 High — severe Stage 2 SBP (SBP ≥160) at
\[SBP\]/\[DBP\] mmHg."

String 2 (DBP-only): "BP Level 1 High — severe Stage 2 DBP (DBP ≥100) at
\[SBP\]/\[DBP\] mmHg."

String 3 (both): "BP Level 1 High — severe Stage 2 (≥160/100) at
\[SBP\]/\[DBP\] mmHg." Why this matters:

The current wording ("≥160/100") implies both axes met the threshold.
When a clinician sees "severe Stage 2 (≥160/100) at 119/109 mmHg," the
SBP of 119 contradicts the "≥160" in the label. This erodes trust in the
alert system. The 2025 AHA/ACC guideline defines hypertension stages
using OR logic — SBP and DBP independently trigger classification.

The wording should reflect which axis actually triggered. Code change:

> File: Physician message template for RULE*STANDARD*L1*HIGH* Logic:

if (sbp \>= 160 && dbp \>= 100) → string 3 else if (sbp \>= 160) →
string 1

else if (dbp \>= 100) → string 2

This is wording-only — no threshold logic changes

Test: Submit reading 119/109 → clinician sees "severe Stage 2 DBP (DBP
≥100)" Test: Submit reading 165/85 → clinician sees "severe Stage 2
SBP (SBP ≥160)" Test: Submit reading 170/105 → clinician sees "severe
Stage 2 (≥160/100)"

> \---

### Q6 — PER-READING VS PER-SESSION FIRING

VERDICT: KEEP CURRENT BEHAVIOR (per-reading firing) FOR MVP. Add visual
grouping later.

Priority: LOW — UX improvement, not safety issue Why keep per-reading
for MVP:

  - > Per-reading firing is the conservative, safe default. It preserves
    > granularity and ensures no alert is suppressed.

  - > The admin queue clutter is a UX problem, not a clinical safety
    > problem. Clinicians can scan past duplicate alerts; they cannot
    > recover from a suppressed alert.

  - > Per-session dedup requires careful logic around which value to
    > display (session average? worst reading? most recent?), edge cases
    > around session boundaries, and the emergency-tier exception. This
    > is non-trivial engineering for a UX improvement.

  - > The existing partial UI grouping ("3 alerts from same reading"
    > header) is adequate for MVP.

What to do NOW:

  - > No code change

  - > Confirm that the existing visual grouping header in admin UI is
    > working correctly

  - > Add a ticket to Phase 2 backlog: "Per-session dedup: consolidate
    > same-rule alerts within a session into one alert with linked
    > readings as evidence. Exception: emergency-tier alerts always fire
    > per-reading."

What Phase 2 looks like:

  - > One DeviationAlert per (session*id, rule*id) pair

  - > Display session-averaged value in alert

  - > Link individual readings as evidence in alert detail

  - > Emergency-tier alerts (RULE*ABSOLUTE*EMERGENCY,
    > RULE*ACE*ANGIOEDEMA,

> RULE*GENERIC*ANGIOEDEMA) exempt from dedup
> 
> \---

### Q7 — GESTATIONAL HTN VS PREECLAMPSIA

> VERDICT: KEEP COMBINED FLAG FOR MVP. Rename field for clarity.
> Priority: LOW — rename only, no logic change
> 
> Why one combined flag is fine for MVP:

  - > Per ACOG Practice Bulletin 222, gestational hypertension and
    > preeclampsia share similar management in the acute monitoring
    > context — both require enhanced surveillance, both use the same BP
    > thresholds for severe-range classification (≥160/110), and both
    > warrant the same symptom monitoring (headache, vision changes, RUQ
    > pain).

  - > Up to 50% of women with gestational hypertension eventually
    > develop preeclampsia, especially when diagnosed before 32 weeks —
    > so the conditions exist on a spectrum.

  - > The distinction matters most for long-term cardiovascular risk
    > stratification (a 2026 JAMA Internal Medicine study showed
    > different HDP subtypes carry heterogeneous long-term CV risk). But
    > long-term risk stratification is not an MVP feature.

  - > For the alert engine's purposes, the clinical actions triggered by
    > either condition are identical: monitor BP closely, watch for
    > severe features, alert the care team.

What to do NOW (minimal change):

  - > Rename schema field: historyPreeclampsia → historyHDP

  - > Update patient-facing intake question: "Have you ever had high
    > blood pressure during a pregnancy? (This includes preeclampsia,
    > gestational hypertension, or HELLP syndrome.)"

  - > Update admin display label: "History of preeclampsia" → "History
    > of hypertensive disorder of pregnancy (HDP)"

  - > Update all code references to the old field name

  - > Database migration: existing historyPreeclampsia=true →
    > historyHDP=true

  - > No engine rule logic changes needed Phase 2 (post-MVP):

  - > Add subtype fields: historyPreeclampsia, historyGestationalHtn,
    > historyHELLP

  - > Update intake UI with subtype checkboxes

  - > Refine engine rules if differential risk stratification is needed

> \---

### MVP LAUNCH CHECKLIST — ALL 7 QUESTIONS

MUST DO BEFORE PILOT (safety-critical):

  - > Q2: Revert RULE*HFREF*HIGH to single-reading firing

  - > Q2: Verify session-averaging applies ONLY to
    > RULE*STANDARD*L1*HIGH*

  - > Q2: Test — Carol (HFrEF), single reading SBP 135 → alert fires

  - > Q3: Test — Daniel (no conditions), 8+ readings → stays STANDARD
    > mode

  - > Q3: Add clarifying code comment

> SHOULD DO BEFORE PILOT (fixes confusion/trust):

  - > Q1: Patch adherence nudge to hybrid wording

  - > Q5: Patch physician message to 3 axis-specific variants

  - > Q5: Test all 3 trigger scenarios (SBP-only, DBP-only, both)

  - > Q7: Rename historyPreeclampsia → historyHDP + update intake
    > question CAN DEFER TO POST-MVP (UX/completeness):

  - > Q4: DHP-CCB + AS contraindication rule (backlog ticket)

  - > Q6: Per-session dedup (backlog ticket)

  - > Q7: HDP subtype differentiation (backlog ticket)

  - > Q3: Admin dashboard "7+ readings" provider prompt (backlog ticket)

> \---

THE LINE WE DO NOT CROSS (repeated for completeness) ALERTING (what we
do) | DECIDING (what we never do)

> \-----------------------------------|-----------------------------------

Flag readings outside thresholds | Auto-adjust thresholds

Notify clinician of patterns | Recommend medication changes Show patient
their reading + context| Tell patient their BP is "normal" Surface
contraindication flags | Withhold medications

Use guideline thresholds as default| Override guidelines with algorithms

Every alert ends with a handoff to the care team — never with a clinical
conclusion.

# Cardioplace v2 — Q2 & Q3 Engineering Action Brief (MVP-Pilot)

Cardioplace v2 — Q2 & Q3 Engineering Action Brief MVP-Pilot Streamlined
Guidance

Date: June 2, 2026

Audience: Engineering team (Duwaragie / Niva) Approved by: Dr. Singal
(pending sign-off)

> \---

### CORE PRINCIPLE FOR MVP

The engine ALERTS — it does not DIAGNOSE or DECIDE. Every alert is a
flag for clinician review. The system should be sensitive (catch real
events) rather than specific (suppress noise). Clinicians tolerate a
manageable number of false-positive flags far better than a single
missed true-positive.

This principle drives both answers below.

> \---

### Q2 — SESSION-AVERAGING ON HFREF*HIGH* VERDICT: REVERT TO SINGLE-READING FIRING

Priority: HIGH — code change required before pilot launch What to do:

1.  > Remove session-averaging logic from RULE*HFREF*HIGH (SBP ≥130 for
    > HFrEF patients)

2.  > Each individual reading that crosses SBP ≥130 should independently
    > trigger the alert

3.  > Session-averaging stays ONLY for RULE*STANDARD*L1*HIGH (Stage 2
    > band: SBP ≥160 or DBP ≥100) — this is the only rule where it was
    > originally spec'd*

> Why this matters for MVP safety:

  - > The HFrEF therapeutic window is narrow (\~120–130 mmHg).
    > Suppressing alerts at ≥130 via averaging risks missing clinically
    > actionable readings.

  - > If a patient takes one reading at SBP 145 and leaves,
    > session-averaging means the alert NEVER fires. That is an
    > unacceptable gap for an HFrEF patient.

  - > A false-positive at SBP 132 is low-cost (clinician reviews, takes
    > no action). A missed alert at SBP 145 in HFrEF is high-cost.

Noise management (instead of session-averaging):

  - > Use per-session dedup (see Q6): if 3 readings in one session all
    > trigger HFREF*HIGH, consolidate into 1 alert with all 3 readings
    > attached as evidence. This controls admin queue clutter without
    > suppressing the alert itself.*

Code change summary:

> File/module: Alert engine — RULE*HFREF*HIGH evaluation
> 
> Change: Remove session-average gate; evaluate each reading
> independently against threshold
> 
> Test: Submit 1 reading at SBP 135 for Carol (HFrEF) → alert should
> fire immediately (not wait for 2nd reading)
> 
> Test: Submit 3 readings at SBP 135, 140, 132 in one session → 1
> consolidated alert (per Q6 dedup), not 3 separate alerts, and not 0
> alerts
> 
> \---

### Q3 — PERSONALIZATION FOR PATIENTS WITH NO CONDITION FLAGS VERDICT: CURRENT IMPLEMENTATION IS CORRECT — NO CODE CHANGE

> Priority: NONE — no code change needed for pilot launch What stays the
> same:

  - > Patients with no condition flags (like Daniel — isolated essential
    > hypertension) remain on mode=STANDARD indefinitely unless a
    > provider explicitly sets PatientThreshold rows

  - > "Personalization begins after 7 readings" means providers CAN now
    > set personalized thresholds — it does NOT mean the engine
    > auto-derives them

> Why auto-derivation is off the table:

  - > For essential hypertension, the standard thresholds (SBP 130
    > target per 2025 AHA/ACC guideline) ARE the correct thresholds.
    > There is nothing to "personalize" without a clinical reason.

  - > Auto-derivation from baseline readings could normalize dangerously
    > high BP. Example: patient's first 7 readings average 155/95 →
    > engine sets "personalized" threshold at 155 → patient stops
    > getting alerts for readings that are clearly above guideline
    > targets. This crosses the line from alerting into clinical
    > decision-making.

  - > The system should never suppress guideline-based alerts without
    > explicit provider authorization.

One small enhancement (NICE-TO-HAVE, not MVP-blocking):

  - > After a patient's 7th reading, show a one-time prompt on the
    > provider admin dashboard: "This patient now has 7+ readings.
    > Review their baseline and consider setting personalized
    > thresholds."

  - > This bridges the spec language and the implementation without any
    > engine logic change.

  - > If this is too much for MVP, skip it. The system is safe without
    > it. Code change summary:

File/module: None

Change: Add clarifying code comment only — "Personalization requires
explicit provider-set PatientThreshold rows. The 7-reading milestone
enables provider decision-making, not auto-derivation."

Optional: Admin dashboard prompt after 7th reading (defer to post-MVP if
needed)

> \---

MVP LAUNCH CHECKLIST (Q2 + Q3 only)

MUST DO (before pilot):

> Revert RULE*HFREF*HIGH to single-reading firing
> 
> Verify session-averaging is applied ONLY to RULE*STANDARD*L1*HIGH*
> Test: Carol (HFrEF) single reading SBP 135 → alert fires

Test: Daniel (no conditions) at 8+ readings → stays STANDARD mode Add
code comment clarifying personalization = provider-set only DEFER TO
POST-MVP:

> Admin dashboard "7+ readings" provider prompt
> 
> Per-session dedup UI grouping (Q6 — related but separate ticket)
> 
> \---

### THE LINE WE DO NOT CROSS

For the pilot and beyond, the engine must stay on the "alert" side of
this boundary: ALERTING (what we do) | DECIDING (what we never do)

> \-----------------------------------|-----------------------------------

Flag readings outside thresholds | Auto-adjust thresholds

Notify clinician of patterns | Recommend medication changes Show patient
their reading + context| Tell patient their BP is "normal" Surface
contraindication flags | Withhold medications

Use guideline thresholds as default| Override guidelines with algorithms

Every alert message should end with a handoff to the care team — never
with a clinical conclusion. The patient should feel informed and
supported; the clinician should feel empowered, not bypassed.

This principle is what builds trust, supports compliance, and protects
outcomes.

# Cardioplace v2 — Clinical Clarifications Response (Q1–Q7)

Cardioplace v2 — Clinical Clarifications Response

Response to: Pending clinical clarifications — Cardioplace v2 audit
(2026-06-01) Prepared for: Duwaragie (Engineering) · Niva · Dr. Manisha
Singal · Rengan Date: June 2, 2026

> Source document:
> Cardioplace*v2*Manisha*Pending*Clarifications*2026-06-01.pdf*

### \---OVERVIEW

This document provides evidence-based clinical recommendations for each
of the 7 open questions (Q1–Q7) raised in Duwaragie's Round-2 audit memo
dated 2026-06-01. Each answer includes the recommendation, clinical
rationale with literature citations, and the specific action required
for engineering.

Note: The audit memo states "6 open clinical questions" but contains 7
(Q1–Q7). All 7 are addressed below.

> \---

### SUMMARY TABLE

Question | Topic | Recommendation | Action for Engineering

> \---------|-------------------------------------|-----------------------------------------------------------------
> 
> \------|------------------------------------------

Q1 | A5 nudge wording | Use hybrid: sign-off version + Niva's
educational sentence | Patch template string to hybrid wording

> Q2 | Session-averaging on HFREF*HIGH | Revert to single-reading
> firing*
> 
> *| Remove session-averaging from HFREF*HIGH rule

Q3 | No-conditions personalization | Interpretation (a) — STANDARD
unless provider sets thresholds | No code change needed

Q4 | DHP-CCB + AS contraindication | Add Tier 1 admin alert + soft-block
on intake; fire for all AS pts | New rule: RULE*DHP*CCB*AS*

Q5 | Stage 2 axis-specific wording | Approve all 3 variant strings

| Patch 3 template variants

Q6 | Per-reading vs per-session firing | Per-session dedup (one alert
per session+rule, readings as evidence) | Consolidate to one
DeviationAlert per (session, rule)

Q7 | Gestational HTN vs preeclampsia | Phase 1: rename to historyHDP
(combined); Phase 2: add subtypes | Rename field + update intake
question text

> \---

### Q1 — A5 FIRST-MONTH ADHERENCE NUDGE: WORDING RECONCILIATION

RECOMMENDATION: Use the 2026-05-24 sign-off version as canonical, but
incorporate Niva's added sentence with a modification.

CANONICAL WORDING (hybrid — use this exact string):

"Starting a new medicine can take some getting used to. If you missed a
dose, that's okay — just try to take your next one on time. Taking your
medicine every day helps keep your blood pressure steady. Your care team
is here to help if anything makes it hard to stay on schedule."

### CLINICAL RATIONALE:

The signed-off version's "that's okay — just" softening clause is
clinically important. The AHA Scientific Statement on Medication
Adherence (Choudhry et al., Hypertension 2022) emphasizes that adherence
interventions should be non-judgmental and that reminder messages
combined with educational content improve engagement more than reminders
alone. Informational text messages that include educational content in
addition to reminders have been shown to produce greater BP reduction
than interactive messages alone.

Niva's added sentence ("Taking your medicine every day helps keep your
blood pressure steady") is a valid educational reinforcement. A 2025
behavioral nudging study (Ademi et al., Stud Health Technol Inform 2025)
found that motivational prompts and feedback mechanisms significantly
influenced adherence behaviors in smartphone-based interventions.

The hybrid version preserves the warmth of the sign-off version while
adding Niva's evidence-supported educational sentence.

### ACTION FOR ENGINEERING:

  - > Patch the template string in the first-month adherence nudge rule
    > to the hybrid wording above

  - > Update Niva's code comment from "Verbatim from sign-off doc p.7"
    > to "Hybrid of sign-off doc p.7 + educational sentence (approved
    > 2026-06-02)"

### EVIDENCE:

  - > Choudhry NK, Kronish IM, Vongpatanasin W, et al. Medication
    > Adherence and Blood Pressure Control: A Scientific Statement From
    > the American Heart Association.

Hypertension. 2022;79(1):e1-e14.

  - > Ademi A, Landolt A, Sariyar M. Enhancing Medication Adherence
    > Through Behavioral Nudging: Potentials of a Smartphone App-Based
    > Approach. Stud Health Technol Inform. 2025;332:108-112.

> \---

### Q2 — SESSION-AVERAGING: SHOULD IT EXTEND TO PERSONALIZED HFREF*HIGH?*

> RECOMMENDATION: Revert to single-reading firing for HFREF*HIGH (SBP
> ≥130). Do not extend session-averaging to this rule.*

### CLINICAL RATIONALE:

> The rationale for session-averaging in the Stage 2 HTN band (SBP ≥160
> / DBP ≥100) is sound — at those thresholds, the clinical concern is
> sustained severe hypertension, and averaging suppresses cuff artifact.
> However, the HFREF*HIGH threshold of SBP ≥130 operates in a
> fundamentally different clinical context.*

1.  > J-shaped risk curve in HFrEF: In HFrEF, the relationship between
    > SBP and outcomes is J-shaped — both high and low SBP are
    > associated with worse outcomes, and the optimal SBP range appears
    > to be approximately 120–130 mmHg (Arundel et al., JACC 2019; Chen
    > et al., JACC Heart Fail 2022). This narrow therapeutic window
    > means that delays in alerting at SBP

≥130 carry more clinical risk than at SBP ≥160.

2.  > Delay risk with session-averaging: If a patient takes one reading
    > of SBP 145 and leaves without a second reading, the alert never
    > fires under session-averaging. At the Stage 2 band (≥160), this
    > delay is acceptable because the threshold is high enough that a
    > single artifact is unlikely to be clinically significant. At SBP
    > ≥130 in HFrEF, the margin is narrower and the clinical context
    > (potential need for GDMT adjustment) warrants prompt notification.

3.  > Guideline context: The 2025 AHA/ACC guideline recommends a goal
    > SBP 130 mmHg in HFrEF with hypertension, but acknowledges that the
    > optimal BP goal is unknown and that low SBP should not preclude
    > uptitration of guideline-directed medical therapy (Jones et al.,
    > JACC 2025).

4.  > Session-averaging vs. longitudinal averaging: The AHA/AMA Joint
    > Policy Statement (Shimbo et al., Circulation 2020) and the JACC
    > Scientific Expert Panel (Muntner et al., JACC 2019) recommend that
    > home BP readings be averaged over multiple days for diagnostic and
    > management decisions — not within a single session for acute
    > alerting purposes. Session-averaging for alert suppression is an
    > engineering convenience, not a guideline recommendation.

### ACTION FOR ENGINEERING:

  - > Remove session-averaging logic from the HFREF*HIGH rule*

  - > Revert to single-reading firing (matching the original 2026-05-09
    > spec)

  - > Session-averaging should remain in place ONLY for the Stage 2 HTN
    > band (SBP ≥160 or DBP ≥100)

### EVIDENCE:

  - > Arundel C, Lam PH, Gill GS, et al. Systolic Blood Pressure and
    > Outcomes in Patients With Heart Failure With Reduced Ejection
    > Fraction. JACC. 2019;73(24):3054-3063.

  - > Chen K, Li C, Cornelius V, et al. Prognostic Value of Time in
    > Blood Pressure Target Range Among Patients With Heart Failure.
    > JACC Heart Fail. 2022;10(6):369-379.

  - > Jones DW, Ferdinand KC, Taler SJ, et al. 2025 AHA/ACC Guideline
    > for the Management of High Blood Pressure in Adults. JACC.
    > 2025;86(18):1567-1678.

  - > Shimbo D, Artinian NT, Basile JN, et al. Self-Measured Blood
    > Pressure Monitoring at Home: AHA/AMA Joint Policy Statement.
    > Circulation. 2020;142(4):e42-e63.

  - > Muntner P, Einhorn PT, Cushman WC, et al. Blood Pressure
    > Assessment in Adults: JACC Scientific Expert Panel. JACC.
    > 2019;73(3):317-335.

> \---

### Q3 — PERSONALIZATION ELIGIBILITY FOR PATIENTS WITH NO CONDITION FLAGS

RECOMMENDATION: Confirm interpretation (a) — patients stay STANDARD
unless a provider explicitly sets personalized thresholds.

### CLINICAL RATIONALE:

The 2025 AHA/ACC guideline classifies hypertension using fixed
thresholds (Stage 1: SBP 130–139 or DBP 80–89; Stage 2: SBP ≥140 or DBP
≥90) and applies risk-based treatment decisions on top of these
categories. For a patient with isolated essential hypertension and no
comorbidities, the standard thresholds ARE the guideline-recommended
thresholds — there is no clinical basis for auto-deriving personalized
thresholds from a 7-reading baseline.

Auto-derivation (interpretation b) would require the engine to make
clinical assumptions about what constitutes an acceptable BP range for
each patient, which is a provider-level clinical judgment. The
"personalization begins after 7 readings" language should be understood
as: after 7 readings, the provider has enough baseline data to make an
informed decision about whether to set personalized thresholds. Until
then — and unless the provider acts — standard thresholds apply.

DANGEROUS EDGE CASE: If a patient's first 7 readings are all elevated
(e.g., averaging 155/95), auto-derivation could set a "personalized"
threshold that normalizes dangerously high BP. This is clinically
unacceptable.

### ACTION FOR ENGINEERING:

### 

  - > No code change needed — current implementation is correct

  - > Add a code comment clarifying the interpretation: "Personalization
    > requires explicit provider-set PatientThreshold rows. The
    > 7-reading minimum enables provider decision-making, not
    > auto-derivation."

  - > Consider adding a provider-facing prompt after 7 readings: "This
    > patient now has 7+ readings. Review their baseline and consider
    > setting personalized thresholds."

### EVIDENCE:

  - > Jones DW, Ferdinand KC, Taler SJ, et al. 2025 AHA/ACC Guideline
    > for the Management of High Blood Pressure in Adults. JACC.
    > 2025;86(18):1567-1678.

> \---
> 
> Q4 — DHP-CCB + AORTIC STENOSIS: CONTRAINDICATION WARNING?

RECOMMENDATION: Yes, add a contraindication warning — but the evidence
is more nuanced than a blanket contraindication, and severity matters.

EVIDENCE REVIEW (conflicting data):

AGAINST CCBs in AS:

  - > 2024 JAMA review (Otto et al.): First-line antihypertensive
    > medications for AS are "not well-established." ACE inhibitors/ARBs
    > are safe and well-tolerated; beta-blockers are a reasonable
    > alternative. CCBs are not recommended as first-line.

  - > 2009 Lancet review (Carabello & Paulus): "Experience with other
    > vasodilators, such as calcium-channel blockers, is scarce in
    > aortic stenosis" and "such drugs should be used with great
    > caution."

  - > 2020 retrospective study (Saeed et al., Int J Cardiol): In 314
    > patients with moderate-to-severe asymptomatic AS, CCB use was
    > associated with a 7-fold increased hazard ratio for all-cause
    > mortality (HR 7.09; 95% CI 2.15–23.38), independent of age,
    > hypertension, diabetes, LVEF, and aortic valve area.

  - > 2021 review (Basile et al., J Clin Med): CCBs "have proved to be
    > unsafe" in AS. FOR CCBs in AS (newer data):

  - > 2025 Japanese registry study (Yamamoto et al., Circ J; CURRENT
    > AS-2, n=2,460): In patients with severe AS and hypertension, CCBs
    > were the most commonly prescribed antihypertensive (71.7%) and
    > were associated with comparable clinical outcomes to non-CCB
    > therapy, with syncope rates of only \~1% regardless of CCB use.

### RECOMMENDED IMPLEMENTATION:

(a) Existing AS patient + DHP-CCB already in med list:

  - > Add a TIER 1 INFORMATIONAL ADMIN ALERT (not Tier 3)

  - > Admin alert text: "This patient has aortic stenosis and is taking
    > a dihydropyridine calcium channel blocker (\[medication name\]).
    > CCBs may cause hypotension in patients with significant aortic
    > stenosis. Please review."

  - > NO patient-facing nudge — the patient should not be alarmed about
    > a medication their provider may have intentionally prescribed.

(b) AS patient adding DHP-CCB during clinical intake:

  - > Add a SOFT-BLOCK MODAL on the patient side: "You've indicated you
    > have aortic stenosis. One of the medications you entered
    > (\[medication name\]) may need to be reviewed by your care team.
    > Please confirm this is correct."

  - > On the admin side, fire the same Tier 1 alert. SEVERITY THRESHOLD:

Since the system currently tracks AS as a boolean only, the
contraindication warning should fire for ALL AS patients on DHP-CCBs,
with the admin alert noting that the clinical significance depends on
stenosis severity. If severity grading is added in the future, the
warning could be restricted to moderate-to-severe AS (aortic valve area
≤1.5 cm² or mean gradient ≥20 mmHg).

### ACTION FOR ENGINEERING:

  - > Create new rule: RULE*DHP*CCB*AS*

  - > Trigger conditions: patient.conditions includes "aortic*stenosis"
    > AND patient.medications includes any DHP-CCB (amlodipine,
    > nifedipine, felodipine, nicardipine, isradipine, clevidipine)*

  - > Alert tier: Tier 1 (admin/provider only)

  - > Patient-side: Soft-block modal during intake only (not a
    > persistent alert)

  - > Rule should fire on: (a) profile creation/update when both
    > conditions are met, and (b) medication addition during intake when
    > AS is already flagged

### EVIDENCE:

  - > Otto CM, Newby DE, Hillis GS. Calcific Aortic Stenosis: A Review.
    > JAMA. 2024;332(23):2014-2026.

  - > Carabello BA, Paulus WJ. Aortic Stenosis. Lancet.
    > 2009;373(9667):956-66.

  - > Saeed S, et al. Antihypertensive Treatment With Calcium Channel
    > Blockers in Patients With Moderate or Severe Aortic Stenosis. Int
    > J Cardiol. 2020;298:122-125.

  - > Basile C, et al. Arterial Hypertension in Aortic Valve Stenosis: A
    > Critical Update. J Clin Med. 2021;10(23):5553.

  - > Yamamoto K, et al. Safety of Calcium Channel Blockers in Patients
    > With Severe Aortic Stenosis and Hypertension. Circ J.
    > 2025;89(9):1528-1537.

> \---

### Q5 — STAGE 2 PHYSICIAN MESSAGE WORDING WHEN ONLY DBP TRIGGERS

RECOMMENDATION: Approve all 3 variant strings as proposed. This is
clinically correct and important.

### CLINICAL RATIONALE:

The 2025 AHA/ACC guideline defines hypertension stages using "or" logic
— Stage 1 is SBP 130–139 OR DBP 80–89; Stage 2 is SBP ≥140 OR DBP ≥90.
SBP and DBP can

independently trigger a stage classification. The current wording
("≥160/100") is misleading because it implies a conjunctive threshold
(both must be met).

### APPROVED TEMPLATE STRINGS:

1.  > SBP-only trigger:

"BP Level 1 High — severe Stage 2 SBP (SBP ≥160) at \[SBP\]/\[DBP\]
mmHg."

2.  > DBP-only trigger:

"BP Level 1 High — severe Stage 2 DBP (DBP ≥100) at \[SBP\]/\[DBP\]
mmHg."

3.  > Both trigger:

"BP Level 1 High — severe Stage 2 (≥160/100) at \[SBP\]/\[DBP\] mmHg."
ACTION FOR ENGINEERING:

  - > Patch the physician message template to use conditional logic:
    
      - > if (sbp \>= 160 && dbp \>= 100): use string 3
    
      - > else if (sbp \>= 160): use string 1
    
      - > else if (dbp \>= 100): use string 2

  - > This is a wording-only fix; no threshold logic changes needed
    > EVIDENCE:

  - > Jones DW, Ferdinand KC, Taler SJ, et al. 2025 AHA/ACC Guideline
    > for the Management of High Blood Pressure in Adults. JACC.
    > 2025;86(18):1567-1678.

> \---

### Q6 — PER-READING VS PER-SESSION FIRING FOR REPEATED SAME-RULE TRIGGERS

RECOMMENDATION: Move to per-session dedup (interpretation b) — one alert
per (session, rule) pair, with individual readings linked as evidence.

### CLINICAL RATIONALE:

The AHA/AMA Joint Policy Statement (Shimbo et al., Circulation 2020)
recommends that home BP be assessed based on the average of all readings
in a monitoring period, not individual readings. The JACC Scientific
Expert Panel (Muntner et al., JACC 2019) similarly recommends that
"multiple readings should be taken and averaged at each assessment."

Firing 3 separate alerts for 3 readings in the same session (e.g.,
145/105 → 130/110 → 128/108) creates clinically unhelpful noise — the
provider needs to know that the session average was elevated, not that
each individual reading crossed the threshold.

Per-session dedup with linked evidence preserves clinical granularity
(the provider can still see all 3 readings) while reducing admin queue
clutter.

### IMPORTANT CAVEATS:

1.  > This dedup should apply ONLY to same-rule triggers within a single
    > session. If different rules fire in the same session (e.g., one
    > reading triggers HFREF*HIGH and another triggers TACHY*HR), those
    > should remain separate alerts.

2.  > The session-averaged value should be used for the alert display.
    > The individual readings should be accessible in the alert detail
    > view as linked evidence.

3.  > For emergency-tier alerts (angioedema, BP Level 2), per-reading
    > firing should be preserved — do NOT dedup emergency alerts.

### ACTION FOR ENGINEERING:

  - > Consolidate to one DeviationAlert per (session*id, rule*id) pair

  - > The alert should display the session-averaged BP value

  - > Link individual readings as evidence rows in the alert detail view

  - > Add visual grouping header in admin UI: "Based on \[N\] readings
    > in this session"

  - > EXCEPTION: Emergency-tier alerts (RULE*ABSOLUTE*EMERGENCY,
    > RULE*ACE*ANGIOEDEMA, RULE*GENERIC*ANGIOEDEMA) should continue to
    > fire per-reading

### EVIDENCE:

  - > Shimbo D, et al. Self-Measured Blood Pressure Monitoring at Home:
    > AHA/AMA Joint Policy Statement. Circulation. 2020;142(4):e42-e63.

  - > Muntner P, et al. Blood Pressure Assessment in Adults: JACC
    > Scientific Expert Panel. JACC. 2019;73(3):317-335.

> \---

### Q7 — GESTATIONAL HTN AS A SEPARATE FIELD, OR SUBSUMED UNDER PREECLAMPSIA?

RECOMMENDATION: Use two distinct flags (interpretation b) — but
implement as a phased approach.

### CLINICAL RATIONALE:

Gestational hypertension and preeclampsia are clinically distinct
entities with different diagnostic criteria, different management
pathways, and — critically — different long-term cardiovascular risk
profiles:

1.  > ACOG Practice Bulletin 222 (2020): Gestational hypertension is
    > hypertension without proteinuria or severe features after 20
    > weeks; preeclampsia requires proteinuria or end-organ dysfunction.
    > Up to 50% of women with gestational hypertension will eventually
    > develop preeclampsia, especially if diagnosed before 32 weeks.

2.  > 2025 AHA/ACC guideline: Treats gestational hypertension and
    > preeclampsia as related but distinct entities, noting that up to
    > 30% of women with gestational hypertension ultimately develop
    > preeclampsia.

3.  > 2022 NEJM review (Magee et al.): Among women with prior
    > preeclampsia, 15% had gestational hypertension and 15% had
    > preeclampsia in a subsequent pregnancy — these are different
    > recurrence patterns.

4.  > 2026 JAMA Internal Medicine study (Kwak et al.): Different
    > hypertensive disorder subtypes carry heterogeneous long-term
    > cardiovascular risk, with superimposed preeclampsia carrying the
    > highest risk (\~10% cumulative CV events at 10 years) and
    > gestational hypertension carrying a lower but still elevated risk
    > compared to normotensive pregnancies.

### PHASED IMPLEMENTATION:

PHASE 1 (now — minimal schema change):

  - > Rename the existing field from historyPreeclampsia to historyHDP
    > (hypertensive disorder of pregnancy)

  - > Update the patient-facing question to: "Have you ever had high
    > blood pressure during a pregnancy? This includes preeclampsia,
    > gestational hypertension, or HELLP syndrome."

  - > This captures both conditions under one flag without losing data

  - > All existing engine rules that branch on historyPreeclampsia
    > should be updated to reference historyHDP — no logic changes
    > needed since the clinical management in the acute monitoring
    > context is similar

PHASE 2 (future — when engine rules are refined):

  - > Add subtype differentiation:
    
      - > historyPreeclampsia (Boolean)
    
      - > historyGestationalHtn (Boolean)
    
      - > historyHELLP (Boolean)

  - > Update intake UI to ask: "Which of the following did you
    > experience?" with checkboxes

  - > Refine engine rules to branch differently based on subtype (e.g.,
    > different risk stratification, different alert thresholds)

### RATIONALE FOR PHASED APPROACH:

For the current alert logic, the management of gestational hypertension
and preeclampsia in the acute monitoring context (BP thresholds, symptom
monitoring, medication contraindications) is similar enough that a
single flag is functionally adequate. The distinction matters more for
long-term risk stratification, which is a future feature.

### ACTION FOR ENGINEERING:

Phase 1 (implement now):

  - > Rename schema field: historyPreeclampsia → historyHDP

  - > Update all code references to the old field name

  - > Update patient-facing intake question text (see above)

  - > Update admin display label from "History of preeclampsia" to
    > "History of hypertensive disorder of pregnancy"

  - > No engine rule logic changes needed Phase 2 (future sprint):

  - > Add schema fields: historyPreeclampsia, historyGestationalHtn,
    > historyHELLP

  - > Update intake UI with subtype checkboxes

  - > Refine engine rules as needed EVIDENCE:

  - > ACOG Practice Bulletin 222. Gestational Hypertension and
    > Preeclampsia. Obstet Gynecol. 2020;135(6):e237-e260.

\- Jones DW, et al. 2025 AHA/ACC Guideline. JACC. 2025;86(18):1567-1678.

  - > Magee LA, Nicolaides KH, von Dadelszen P. Preeclampsia. NEJM.
    > 2022;386(19):1817-1832.

  - > Kwak S, et al. Hypertensive Disorders of Pregnancy Subtypes and
    > Long-Term Cardiovascular Risk. JAMA Intern Med. 2026.

> \---

### ADDITIONAL NOTES FOR ENGINEERING

1.  > CODE COMMENT HYGIENE: Several of Niva's code comments reference
    > "Verbatim from sign-off doc" when the strings have been modified.
    > After implementing these changes, audit all code comments that
    > reference the sign-off document and update them to reflect the
    > actual source of each string.

2.  > REGRESSION TESTING: Q2 (session-averaging revert) and Q6
    > (per-session dedup) both affect the alert-firing pipeline. These
    > should be tested together to ensure they don't interact
    > unexpectedly. Specifically:
    
      - > Q2 removes session-averaging for HFREF*HIGH (single-reading
        > firing)*
    
      - > Q6 adds per-session dedup (one alert per session+rule)
    
      - > Net effect for HFREF*HIGH: each reading fires independently,
        > but if multiple readings in one session all trigger
        > HFREF*HIGH, they should be deduped into one alert with the
        > session-averaged value

3.  > Q4 NEW RULE: The RULE*DHP*CCB*AS rule is net-new. It should be
    > added to the rule registry, the admin alert queue, and the intake
    > validation pipeline. It does NOT need patient-facing alert copy
    > (only the soft-block modal during intake).*

4.  > Q7 MIGRATION: Renaming historyPreeclampsia to historyHDP requires
    > a database migration. Existing patient data should be preserved
    > (all current historyPreeclampsia=true values become
    > historyHDP=true).

> \---

### END OF DOCUMENT

> Prepared: June 2, 2026
> 
> Status: Ready for Dr. Singal's review and sign-off
> 
> Next step: Once Dr. Singal confirms or modifies these recommendations,
> Duwaragie and Niva can lock the code.
