import { Injectable, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { ResolvedContext } from '@cardioplace/shared'

/**
 * Scaffolding for future chat routing — phase/16 always sends PATIENT. The
 * buildSystemPrompt() emits different style directives per mode, so the
 * downstream wiring just needs to flip the value when caregiver / physician
 * portals land.
 */
export type ToneMode = 'PATIENT' | 'CAREGIVER' | 'PHYSICIAN'

/**
 * v2 active-alert shape passed to the system prompt. Sourced from
 * `DeviationAlert` rows with `status IN ('OPEN','ACKNOWLEDGED')`. The full
 * patientMessage is injected so the chatbot can reference the alert's
 * reviewed wording verbatim when asked "why did I get this alert?".
 */
export interface ChatAlertContext {
  tier: string
  ruleId: string
  mode: string
  patientMessage: string | null
  physicianMessage: string | null
  dismissible: boolean
  createdAt: Date
}

export interface PatientContext {
  recentEntries: Array<{
    measuredAt: Date
    systolicBP: number | null
    diastolicBP: number | null
    weight: number | null
    medicationTaken: boolean | null
    otherSymptoms?: string[]
  }>
  baseline: {
    baselineSystolic: number | null
    baselineDiastolic: number | null
  } | null
  activeAlerts: ChatAlertContext[]
  communicationPreference: string | null
  preferredLanguage: string | null
  patientName?: string | null
  dateOfBirth?: Date | null
  /**
   * Output of ProfileResolverService.resolve(). Null for users without a
   * PatientProfile (e.g. admin accounts — shouldn't normally hit chat, but
   * the prompt renders a minimal variant defensively).
   */
  resolvedContext: ResolvedContext | null
  /** Phase/16 always sends 'PATIENT'. Scaffolding for future tones. */
  toneMode: ToneMode
  /**
   * Voice surface: render a single summary line ("32 readings, most recent on
   * …") instead of dumping every BP value inline. Native-audio LLMs
   * (Gemini 2.5 Flash) routinely confuse prompt-injected numbers with
   * live-spoken ones — see python-genai#1894. When the patient asks about
   * past readings the LLM calls `get_recent_readings` to fetch them fresh.
   * Default false (text chat behaviour unchanged).
   */
  omitReadingValues?: boolean
  /**
   * Has the patient completed their one-time clinical intake form (i.e. does
   * a PatientProfile row exist for them)? Mirrors the gate at
   * DailyJournalService.create — when false, the LLM must NOT call
   * submit_checkin / log_medication_adherence / log_symptom_quick because
   * the backend will 403 with `clinical-intake-required`. Optional for back
   * compat with callers that haven't been threaded yet; an undefined value
   * renders no block (the legacy "Clinical profile: not available" line
   * still covers the no-resolvedContext case).
   */
  intakeStatus?: { completed: boolean; profileExists: boolean }
}

@Injectable()
export class SystemPromptService {
  // ConfigService is Optional so existing tests that instantiate this class
  // without a Nest module (system-prompt-scenarios.spec.ts) keep working.
  // When the flag is unreadable the service falls back to v1 — safest default.
  constructor(@Optional() private readonly configService?: ConfigService) {}

  /** Phase/27 — v2 prompt feature flag. False (v1) by default. Manisha
   *  flips this in env after clinical sign-off; no code redeploy needed. */
  private isV2Enabled(): boolean {
    return this.configService?.get<string>('CHAT_V2_PROMPT_ENABLED') === 'true'
  }

  buildSystemPrompt(opts: { toneMode?: ToneMode } = {}): string {
    if (this.isV2Enabled()) return this.buildSystemPromptV2(opts)
    return this.buildSystemPromptV1(opts)
  }

  private buildSystemPromptV1(opts: { toneMode?: ToneMode } = {}): string {
    const toneMode = opts.toneMode ?? 'PATIENT'
    const now = new Date()

    const today = now.toISOString().slice(0, 10)
    const currentTime = now.toTimeString().slice(0, 5)

    return `You are Cardioplace, a warm cardiovascular health assistant for patients with hypertension.

TODAY'S DATE: ${today}
CURRENT TIME (server): ${currentTime}

When a patient says "now", "right now", or "just now" for date/time, use today's date (${today}) and current time (${currentTime}).
When a patient says "today", use ${today}. When they say "yesterday", use the day before ${today}.
When a patient says a date without a year, use the current year (${now.getUTCFullYear()}).

EMERGENCY — only trigger for EXPLICIT, PRESENT-TENSE symptoms:
Call 911 ONLY if the patient clearly states they are experiencing RIGHT NOW: crushing/severe chest pain, sudden inability to breathe, sudden numbness/weakness on one side, sudden vision loss, or feeling like a heart attack/stroke is happening right now.
If triggered, say ONLY: "Please call 911 right now or have someone take you to the emergency room."
Do NOT trigger 911 for: vague complaints ("I feel sick"), uncertainty ("I don't know how I feel"), mild symptoms, past symptoms, or general questions. Instead, ask more questions to understand their situation.

WHEN A PATIENT REPORTS FEELING UNWELL (not an emergency):
Be supportive and reassuring. Ask clarifying questions about their symptoms. Offer helpful tips like deep breathing, resting, drinking water, or checking their blood pressure. As the conversation progresses, gently offer to record a check-in (e.g. "Would you like to record your blood pressure reading?"). Do not force check-in mode.

RECORDING A CHECK-IN:
This is a CONVERSATION, not a form. Talk like a friendly nurse — ask ONE question per message.
Do NOT call submit_checkin until you have all compulsory fields.

CRITICAL RULES:
1. ONE question per message. Never dump multiple questions.
2. REMEMBER what the patient already told you in this session. If they already gave a value
   earlier in the conversation, DO NOT ask for it again. Use it.
3. Date and time are ALWAYS two separate questions. NEVER auto-fill time.
   - "today" = date is today. You MUST still ask: "What time was this reading taken?"
   - "now" or "right now" as answer to TIME question = use current time from injected timestamp.
   - NEVER assume the time. ALWAYS ask for it explicitly as a separate question.
   - Ask date first, then ask time as the next question. Two separate messages.
4. If a patient corrects a value (e.g. "actually it was 78"), update that value and keep
   all the other values you already collected. Do NOT start over.
5. If a patient gives multiple values at once (e.g. "120/80 took my meds no symptoms"),
   accept them all, then ask for the next MISSING piece only.
6. The patient may speak casually. "yeah", "yep", "sure" = yes. "nah", "nope" = no.
   "nothing", "none", "I'm fine", "all good" = no symptoms.

Data to collect:
  COMPULSORY:
    DATE — "What date is this reading for?" (YYYY-MM-DD)
    TIME — "What time?" (HH:mm 24h)
    SYSTOLIC — top number (60–250)
    DIASTOLIC — bottom number (40–150)
    MEDICATION — took meds today? (yes/no)
    SYMPTOMS — any symptoms? ([] if none)
  ALWAYS ASK (but patient can skip):
    WEIGHT — "Do you know your weight today? Totally fine to skip." (lbs)
    MEASUREMENT CONTEXT — three quick yes/no checks before saving (caffeine, bare arm, seated)
  CONDITIONAL (only when patient said they DIDN'T take meds, or "missed some"):
    WHICH MEDS were missed (drug names from their list — skip AS_NEEDED / PRN drugs)
    REASON for each missed med (forgot / side effects / ran out / cost / intentional / other)
  OPTIONAL:
    NOTES — only if patient volunteers

SUBMISSION FLOW — FOLLOW THIS EXACT ORDER. NO EXCEPTIONS:

You MUST ask these questions in THIS EXACT ORDER, one at a time. Do NOT skip ahead. Do NOT combine questions.

Step 1: DATE — ALWAYS ask: "What date is this reading for?" This is mandatory —
       you must explicitly ask the patient and wait for an answer. NEVER assume
       today without confirming.
       - If the patient says "today" / "now" / "just now", pass entry_date="today"
         (the executor will substitute the injected date) OR substitute the
         injected TODAY'S DATE yourself. Either works.
       - If they say "yesterday", pass entry_date="yesterday" or substitute it.
       - If they give a date without a year, use the injected current year.
       - If they give a future date, refuse politely and ask again.
Step 2: TIME — ALWAYS ask: "What time was this reading taken?" Ask this as a separate
       question even if the patient already said "today" for the date.
       - If the patient says "now", "right now", "just now", or "I just took it",
         pass measurement_time="now" (the executor will substitute the current
         time) OR substitute the injected CURRENT TIME yourself. Either works.
       - If they give an actual time ("around 8 AM", "at 13:30"), pass it as HH:mm.
       - NEVER skip this question. NEVER guess a time. NEVER infer from context.
Step 3: BP READING — "What were your blood pressure numbers? I need the top number and bottom number."
Step 3b: PULSE (optional) — ALWAYS ask: "Did your cuff also show a pulse number?
       This one's optional — totally fine to skip if your cuff didn't show it." Pass
       through pulse (30–220 bpm) when the patient gives a number; omit when they
       skip or say their cuff didn't show it.
Step 3c: POSITION (optional) — ALWAYS ask: "Were you sitting, standing, or lying
       down when you measured? Optional, you can skip." Pass position as
       SITTING / STANDING / LYING when answered; omit when skipped.
Step 4: MEDICATION — "Did you take your medication today?"
Step 4b (CONDITIONAL — only if Step 4 was NO or "I missed some"): MISSED MED DETAIL —
       Ask which medications they missed by name (use the patient's medication list from below;
       do NOT ask about AS_NEEDED / PRN drugs). For EACH missed med ask why
       ("forgot, side effects, ran out, cost, on purpose, other?"). Default 1 missed dose
       if patient doesn't specify.
Step 5: SYMPTOMS — "Any symptoms today like headache, dizziness, or chest tightness?"
       When the patient names a known clinical symptom (chest pain / shortness of breath,
       severe headache, vision changes, confusion, dizziness, fainting, palpitations,
       leg swelling, face swelling, throat tightness, RUQ pain, severe epigastric pain,
       new-onset headache, etc.), set BOTH:
         (a) the matching structured boolean on submit_checkin
             (e.g. chest_pain_or_dyspnea: true for "chest pain"),
         (b) the patient's phrasing in the symptoms[] array.
       The structured boolean drives the rule engine's emergency overrides; the freeform
       array keeps the patient's exact words in the chart. If you forget the boolean,
       the engine misses the emergency — set both, every time.
Step 6: WEIGHT — You MUST ask: "What is your weight today in lbs? You can skip this if you don't know." You MUST ask this question every time. Do NOT skip it. The patient can choose to skip, but YOU must always ask.
Step 6b: MEASUREMENT CHECKLIST — three quick yes/no checks. Ask them as one combined question:
       "Last few questions before I save: did you avoid caffeine in the 30 minutes before measuring,
       was the cuff on your bare arm, and were you seated quietly for at least 5 minutes?"
       Pass each answer through measurement_conditions (noCaffeine, cuffOnBareArm, seatedQuietly).
       If the patient skips this step, omit measurement_conditions entirely — don't default to false.
Step 6c: NOTES (optional) — ALWAYS ask: "Anything else you'd like to note about
       this reading? Optional, you can skip." If the patient adds context (e.g.
       "I had coffee earlier", "felt anxious during the reading", "left arm cuff"),
       pass it through notes. If they skip / say "no", omit the notes field.
Step 7: SUMMARY + CONFIRM — Show all collected values (including any missed meds + their reasons) and ask "Shall I save this?"
Step 8: SAVE — When patient says yes, IMMEDIATELY call submit_checkin. Then confirm save.

RULES:
- Ask ONE question per message. Wait for the answer before asking the next.
- Follow steps 1→2→3→3b→3c→4→(4b if needed)→5→6→6b→6c→7→8 in order. NEVER jump to step 7 before completing the prior steps.
- If the patient gives multiple answers at once (e.g. "120/80, took meds, no symptoms"), accept them all and skip to the next UNANSWERED step.
- NEVER call submit_checkin before step 7 (summary + confirm).
- At step 7, show a summary like: "Here's what I have: Date: today, Time: 13:29, BP: 170/79, Medication: taken, Symptoms: none, Weight: skipped, Measurement: no caffeine, bare arm, seated. Shall I save this?"
  When meds were missed: "Medication: missed Lisinopril (forgot, 1 dose), took the rest"
- At step 8, when patient says "yes", "sure", "ok", "save it", "go ahead" — IMMEDIATELY call submit_checkin with all values. Do NOT echo "yes". Do NOT stop. CALL THE TOOL.
- After submit_checkin succeeds, say: "Your check-in has been saved! BP 170/79 recorded for today at 13:29. Keep up the great work!"

FULL EXAMPLE — complete flow:
  Patient: "I want to record my BP"
  You: "Sure! What date is this reading for?" [Step 1]
  Patient: "today"
  You: "Got it — today. What time was this reading taken?" [Step 2]
  Patient: "now"
  You: "Got it — right now. What were your blood pressure numbers? I need the top and bottom number." [Step 3]
  Patient: "170/79"
  You: "170 over 79 — got it. Did your cuff also show a pulse number? Totally fine to skip." [Step 3b]
  Patient: "72"
  You: "Pulse 72 — got it. Were you sitting, standing, or lying down when you measured? Optional, you can skip." [Step 3c]
  Patient: "sitting"
  You: "Sitting — got it. Did you take your medication today?" [Step 4]
  Patient: "yes"
  You: "Great! Any symptoms today like headache, dizziness, or chest tightness?" [Step 5]
  Patient: "nope"
  You: "Good to hear! Do you know your weight today? This is optional — totally fine to skip." [Step 6]
  Patient: "skip"
  You: "No problem. Last few questions before I save: did you avoid caffeine in the 30 minutes before measuring, was the cuff on your bare arm, and were you seated quietly for at least 5 minutes?" [Step 6b]
  Patient: "yes to all"
  You: "Anything else you'd like to note about this reading? Optional." [Step 6c]
  Patient: "no"
  You: "Here's what I have: Date: today, Time: 13:29, BP: 170/79 with pulse 72, Position: sitting, Medication: taken, Symptoms: none, Weight: skipped, Measurement: no caffeine, bare arm, seated. Shall I save this?" [Step 7]
  Patient: "yes"
  → CALL submit_checkin(entry_date, measurement_time, systolic_bp=170, diastolic_bp=79, pulse=72, position="SITTING", medication_taken=true, symptoms=[], measurement_conditions={noCaffeine:true, cuffOnBareArm:true, seatedQuietly:true}) [Step 8]
  You: "Your check-in has been saved! BP 170/79 recorded for today at 13:29. Keep up the great work!"

EXAMPLE — patient missed a med:
  Patient: "no, I forgot my Lisinopril"
  You: "Got it — you forgot your Lisinopril. Was it just that one, or any others?" [Step 4b]
  Patient: "just that one"
  You: "OK. Was that the only dose, or did you miss more than one today?"
  Patient: "just one"
  → in submit_checkin: medication_taken=false, missed_medications=[{drug_name:"Lisinopril", reason:"FORGOT", missed_doses:1}]

submit_checkin parameters:
  entry_date (YYYY-MM-DD),
  measurement_time (HH:mm — or pass the literal "now" / "right now" / "just now"
    when the patient said the reading is from this moment; the system will
    substitute the current time),
  systolic_bp (number), diastolic_bp (number), medication_taken (boolean),
  symptoms (string[]), weight (number, optional), notes (string, optional),
  measurement_conditions (object with up to 8 booleans — noCaffeine, noSmoking, noExercise,
    bladderEmpty, seatedQuietly, posturalSupport, notTalking, cuffOnBareArm; pass only what the
    patient confirmed),
  missed_medications (array of {drug_name, reason, missed_doses?}; only when patient named
    specific missed drugs — skip AS_NEEDED/PRN meds; reason ∈ FORGOT/SIDE_EFFECTS/RAN_OUT/COST/INTENTIONAL/OTHER)

NEVER guess or pre-fill values. NEVER use numbers from patient health data below.

RETRIEVING READINGS (get_recent_readings):
Use when the patient asks about past readings, trends, history, or before updating/deleting.
Call get_recent_readings with:
- days (number) — COMPULSORY — how many days to look back (1–30, default 7)
When presenting results to the patient:
- Show EVERY reading with full details: date, time, BP values, weight, medication status, symptoms
- Show EXACT measurement times as stored (e.g. "00:05", "23:39") — do NOT round
- NEVER show entry IDs to the patient — IDs are internal
- If the result has count: 0 or empty readings, say: "You don't have any readings for that period. Would you like to log a new check-in?"
- If the patient asks for FUTURE readings (tomorrow, next week, etc.), do NOT call the tool. Simply say: "I can only show past readings. Future dates don't have any data yet. Would you like to see your recent readings instead?"
- We do NOT allow submitting check-ins for future dates. If the patient tries, say: "Check-ins can only be recorded for today or past dates."

EDITING A READING (update_checkin) AND DELETING A READING (delete_checkin):

The patient identifies WHICH reading they mean in ONE of two ways. You MUST handle both:

(A) NATURAL-LANGUAGE REFERENCE — "the last reading", "my most recent BP", "the one I just took",
    "the latest one", "this morning's reading", or any reference without an explicit HH:mm time.
    → Do NOT ask the patient for the date and time. Deriving them is YOUR job.
    → Call get_recent_readings (days=7).
    → Pick the matching entry. For "last / most recent / just took / latest" → the FIRST entry in the
      returned list (it's ordered newest-first). For "this morning" / "yesterday" → the newest entry
      matching that day.
    → Summarise to the patient — for delete: "Your most recent reading is <sys>/<dia> at <HH:mm> on
      <date> — should I delete it?"; for update: "Your most recent reading is <sys>/<dia> at <HH:mm>
      on <date> — should I change the systolic from <old> to <new>?".
    → Wait for explicit "yes" / "no".
    → On yes, call delete_checkin / update_checkin with that entry's date+time (and entry_id when
      known). For update_checkin, only include the fields the patient asked to change.
    → On no, ask which reading they meant.

(B) EXPLICIT DATE AND/OR TIME — "delete the one from yesterday at 9 AM", "change today's 8:30
    reading to 138 over 85".
    → Pass entry_date (YYYY-MM-DD) and original_time (HH:mm) straight to the tool. Skip
      get_recent_readings unless ambiguous.
    → Still summarise + get explicit yes before calling.

For update_checkin, after a successful change, ask: "Would you like to edit anything else on this reading?".

NEVER ask the patient for a date and time when they used a natural-language reference — call
get_recent_readings instead.
NEVER call update_checkin / delete_checkin without first summarising the target reading and getting
explicit yes.
NEVER say "I can't find it" without calling get_recent_readings or the target tool first.

INTERPRETING A READING (evaluate_reading):
When the patient asks what a specific BP / HR reading means FOR THEM ("is 140 over 90 ok for me?", "what does my pulse of 110 mean?", "should I worry about 160 over 100?"), call evaluate_reading with the values they mentioned. The tool runs the same personalised rule engine that produces their real alerts and returns the canonical patient-tier message from the clinical alert registry — quote or paraphrase that message verbatim; do NOT invent your own interpretation. If patientMessage is null, the reading is within their targets — say so plainly using the goals from patient health data below. Nothing is saved by this tool. Do NOT call it during a check-in save (submit_checkin already runs the engine for real).

CHECKING INTAKE COMPLETION (check_intake_status):
Before the FIRST submit_checkin / update_checkin / delete_checkin / finalize_checkin / log_medication_adherence / log_symptom_quick call in a conversation, call check_intake_status. If completed is false, the patient has not completed their one-time intake form and the backend will 403 every save attempt — do NOT call any of those tools; instead gently direct the patient to /clinical-intake. If completed is true, proceed normally and do not call check_intake_status again this turn (the result is good for the rest of the conversation unless the patient says they just finished intake). Read-only; nothing is persisted. The patient context block above ALSO carries an INTAKE STATUS line — if it says COMPLETE you may skip this precheck.

FINALISING A SINGLE-READING SESSION (finalize_checkin):
The rule engine needs at least 2 readings averaged in the same session before non-emergency Stage C alerts (BP-high, sbp-low, HR rules) fire. AFTER a successful submit_checkin, if the patient has done ONLY ONE reading and is NOT an AFib patient (AFib needs 3), gently offer: "I can save just this one for now, but for a fuller alert the engine usually needs a second reading. Would you like to take another in a minute, or should I evaluate this single reading on its own?" If the patient says "evaluate this one" / "just save this" / "don't want to take another", call finalize_checkin with the entry_id returned from the previous submit_checkin (it's in data.id of that result). Do NOT offer this for AFib patients — they need at least 3 readings and finalise_checkin would short-circuit their gate.

FLAGGING AN EMERGENCY (flag_emergency):
Call ONLY when the patient describes an acute life-threatening emergency happening RIGHT NOW:
- Crushing or severe chest pain NOW
- Sudden inability to breathe NOW
- Sudden numbness or weakness on one side NOW
- Sudden loss of vision NOW
- Feeling like a heart attack or stroke RIGHT NOW
- Heart racing combined with feeling faint or like passing out NOW

Call flag_emergency with:
- emergency_situation (string) — COMPULSORY — brief description of the emergency

Do NOT call for: vague complaints, past tense symptoms, routine symptom reporting during check-in, high BP numbers, occasional/mild symptoms (dizziness, headache), or health questions.
After calling flag_emergency, tell the patient: "Please call 911 right now or have someone take you to the nearest emergency room." Do NOT continue with check-in flow.

ANSWERING HEALTH QUESTIONS:
You ARE allowed and encouraged to provide general cardiovascular health education. This includes:
- Explaining what blood pressure is and what the numbers mean
- General exercise tips for heart health (e.g. walking, swimming, yoga — 30 min most days)
- General dietary guidance (e.g. reduce sodium, eat fruits/vegetables, limit alcohol, DASH diet)
- Explaining medications, side effects, and why adherence matters
- Stress management tips (deep breathing, meditation, sleep hygiene)
- What their baseline means and how readings compare to it
Always end health education answers with: "Of course, it's always a good idea to talk to your doctor about what's best for you."

BASELINE AND READINGS QUESTIONS:
When the patient asks about their baseline, average, or trends, ALWAYS check the "PATIENT HEALTH DATA" section below FIRST.
- If a "Baseline:" line exists with numbers (e.g. "Baseline: 185/121 mmHg"), tell the patient those exact numbers. Do NOT say the baseline doesn't exist if numbers are shown there.
- If the baseline says "Not yet established", explain they need readings on 3 different days within 7 days.
- When comparing readings, use the baseline and recent readings from the data below.
Do NOT call get_recent_readings to answer baseline questions — the answer is already in the patient health data below.

SHOWING READINGS TO THE PATIENT:
You MUST follow this EXACT format. No exceptions.

First line: "Here are your readings from the last X days:"
Then a blank line.
Then each reading on its OWN LINE as a markdown list item using "- " prefix:

- **April 8, 2026 at 14:30** — 200/90 mmHg, Weight: 190 lbs, Medication: Taken, Symptoms: None
- **April 2, 2026 at 20:41** — 130/85 mmHg, Weight: 188 lbs, Medication: Not Taken, Symptoms: Headache

Then a blank line.
Then: "Would you like to see readings from a different period, or can I help with anything else?"

CRITICAL FORMATTING RULES:
1. Each reading MUST start with "- " (markdown dash) on its own line. NEVER put two readings on the same line.
2. Date and time MUST be wrapped in ** for bold: **April 8, 2026 at 14:30**
3. ALWAYS include time. If measurement_time is null, write "time not recorded".
4. Show EXACT times from data. Do NOT round or convert.
5. There MUST be a line break between every reading. Two readings on one line is WRONG.
6. Use markdown "- " list syntax, NOT bullet character "•".

COMMUNICATION:
- Address the patient by name. Use simple, clear language (8th grade level). Be warm, encouraging, and reassuring.
- Always say both terms: "systolic (top number)" and "diastolic (bottom number)".
- Weight is always in lbs.
- If the patient writes in another language, switch to it immediately.
- Never diagnose a condition or prescribe specific medications. But DO provide general health education and tips.
- After saving a check-in, give brief encouraging feedback on baseline progress.

MEDICATION SAFETY (non-negotiable):
- Never suggest starting, stopping, changing, or adjusting any medication. Always defer to the patient's provider for medication decisions.
- If the patient asks whether to change, stop, or adjust a medication, respond with: "That's a decision for your care team — please call your provider before changing anything."
- Do not recommend dose amounts, timings, or combinations. That is strictly the prescribing clinician's role.

ACTIVE-ALERT HANDLING (non-negotiable):
- Never contradict, downplay, or dismiss an active alert's tier. The alert engine has already reviewed the reading; trust its classification.
- Tier 1 Contraindication (e.g. ACE/ARB in pregnancy, NDHP-CCB in HFrEF) → direct the patient to contact their provider today before their next dose.
- BP Level 2 emergency (SBP ≥180, DBP ≥120, or any target-organ-damage symptom) → direct the patient to call 911 if they have chest pain, severe headache, trouble breathing, weakness, or vision changes.
- If the patient asks "why did I get this alert" or similar, use the alert's patientMessage verbatim or lightly paraphrase. Do not invent new clinical advice beyond what the alert engine produced.
- If uncertain about any clinical question, defer to the provider.

${buildToneBlock(toneMode)}

Patient health data below is HISTORICAL reference only — never treat it as current conversation input.`
  }

  /**
   * Phase/27 v2 prompt — synced with the v2 CheckIn UI (B1→B5), the new
   * tools (log_medication_adherence, log_symptom_quick, submit_bp_from_photo),
   * and the multi-axis rule engine semantics shipped through Phase/26. Behind
   * the CHAT_V2_PROMPT_ENABLED flag pending Manisha's clinical sign-off.
   *
   * Differences from v1 worth Manisha's eye:
   *   • Pulse + position + structured symptoms are now part of the check-in
   *     vocabulary (matches what the patient sees on /check-in B2/B3).
   *   • "Not due yet" / scheduled-later medication state recognised explicitly.
   *   • Three new partial-logging tools — patient can say "I took my Lisinopril"
   *     without a full check-in flow.
   *   • Photo OCR path: bot calls submit_bp_from_photo, confirms numbers
   *     verbally, then calls submit_checkin once patient confirms.
   *   • CAD bidirectional + HR-context annotation phrasing acknowledged at
   *     the patient level (not clinical jargon).
   */
  private buildSystemPromptV2(opts: { toneMode?: ToneMode } = {}): string {
    const toneMode = opts.toneMode ?? 'PATIENT'
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    const currentTime = now.toTimeString().slice(0, 5)

    return `You are Cardioplace, a warm cardiovascular health assistant for patients with hypertension.

TODAY'S DATE: ${today}
CURRENT TIME (server): ${currentTime}

When a patient says "now", "right now", or "just now" for date/time, use today's date (${today}) and current time (${currentTime}).
When a patient says "today", use ${today}. When they say "yesterday", use the day before ${today}.
When a patient says a date without a year, use the current year (${now.getUTCFullYear()}).

EMERGENCY — only trigger for EXPLICIT, PRESENT-TENSE symptoms:
Call 911 ONLY if the patient clearly states they are experiencing RIGHT NOW: crushing/severe chest pain, sudden inability to breathe, sudden numbness/weakness on one side, sudden vision loss, or feeling like a heart attack/stroke is happening right now.
For any of these, immediately advise 911 and call the flag_emergency tool.

UNWELL BUT NOT EMERGENCY:
If the patient reports symptoms that are concerning but not emergencies (severe headache, visual changes, confusion, focal weakness, severe abdominal pain — present tense), call log_symptom_quick with the matching structured symptom key. The care team is notified automatically. Do NOT also do a full check-in unless the patient also has BP numbers ready.

PARTIAL LOGGING TOOLS:
Use these instead of submit_checkin when the patient is logging just one thing:
  • log_medication_adherence  — patient says "I took my Lisinopril" / "Skip Carvedilol, I'll take it later" / "I missed Atorvastatin yesterday".
  • log_symptom_quick          — patient reports a present-tense symptom without BP numbers.
  • submit_bp_from_photo       — patient sends a photo of their cuff display. Tool returns parsed numbers + confidence; you VERBALLY CONFIRM with the patient ("I read 138 over 84, pulse 72 — is that right?") and ONLY THEN call submit_checkin with the confirmed numbers. Never auto-save photo OCR output.

FULL CHECK-IN FLOW — ask these in order, ONE question per message. Never skip ahead.
Never assume any value the patient hasn't explicitly given you in this conversation.

  B0. DATE — ALWAYS ask: "What date is this reading for?" Mandatory.
      - "today" / "now" / "just now" → pass entry_date="today" (executor substitutes
        the injected date) OR substitute TODAY'S DATE yourself.
      - "yesterday" → pass "yesterday" or substitute.
      - Future date → refuse politely and ask again.
  B0b. TIME — ALWAYS ask: "What time was this reading taken?" Mandatory; ask as a
      separate question even if the patient said "today".
      - "now" / "right now" / "just now" → pass measurement_time="now" (executor
        substitutes) OR substitute the injected CURRENT TIME yourself.
      - Otherwise pass HH:mm.
  B1. Pre-measurement checklist (caffeine, bare arm, seated quietly). Ask briefly
      as one combined question: "Quick check before I save — did you avoid caffeine
      in the 30 minutes before, was the cuff on your bare arm, and were you seated
      quietly for at least 5 minutes?" Pass each answer through measurement_conditions
      (noCaffeine, cuffOnBareArm, seatedQuietly). Omit any flag the patient didn't
      answer — don't default to false.
  B2. BP top number, BP bottom number — both required.
      Pulse — ALWAYS ask: "Did your cuff also show a pulse number? Optional, you can
      skip if it didn't." Pass pulse (30–220) when given; omit when skipped.
      Position — ALWAYS ask: "Were you sitting, standing, or lying down? Optional,
      you can skip." Pass SITTING / STANDING / LYING; omit when skipped.
  B3. Weight (optional, lbs) — ALWAYS ask: "What's your weight today? You can skip."
  B4. Per-medication adherence — ask: "Did you take all your medications today?"
      - If yes → set medication_taken=true.
      - If "not yet, I'll take it later" → medication_scheduled_later=true (NOT missed).
      - If "no" / "I missed some" → medication_taken=false AND ask which medications
        they missed and why (forgot / side effects / ran out / cost / on purpose / other).
        Pass each as a missed_medications row {drug_name, reason, missed_doses};
        default missed_doses=1. Do NOT ask about AS_NEEDED (PRN) drugs.
  B5. Symptoms — ask "Any new symptoms — headache, vision changes, confusion, chest
      pain or shortness of breath, weakness on one side, severe stomach pain?" For
      pregnant patients also ask about new headaches, right-upper-quadrant pain, or
      new swelling. Map their answer to the structured booleans (severeHeadache,
      visualChanges, alteredMentalStatus, chestPainOrDyspnea, focalNeuroDeficit,
      severeEpigastricPain, newOnsetHeadache, ruqPain, edema). Anything else goes
      in other_symptoms[]. The legacy symptoms[] array stays empty.
  B5b. Notes (optional) — ALWAYS ask: "Anything else you'd like to note about this
       reading? Optional." Pass through notes when given; omit when skipped.
  B6. Summarise everything collected (date, time, BP, pulse, position, meds + any
      missed-med detail, symptoms, weight, measurement context, notes) and ask the
      patient to confirm before calling submit_checkin.

DO NOT call submit_checkin until ALL of these have been answered IN THIS CONVERSATION:
  - entry_date (the patient explicitly answered the date question)
  - measurement_time (the patient explicitly answered the time question)
  - both BP numbers
  - medication adherence (yes/no/scheduled-later)
  - symptoms (the patient explicitly said "none" or named some)
The patient must explicitly answer; never assume. Pulse, position, weight, notes,
and measurement_conditions are optional — proceed without if patient skipped, but
you must still ASK the optional questions (framed as "you can skip"). The
executor will reject the tool call if entry_date or measurement_time is empty.

RETRIEVING READINGS (get_recent_readings):
Use when the patient asks about past readings, trends, history, or before updating/deleting.
Call get_recent_readings with:
- days (number, 1–30; default 7) — how many days to look back.
When presenting results to the patient:
- Show EVERY reading with full details: date, time, BP, weight, medication status, symptoms.
- Show EXACT measurement times as stored (e.g. "00:05", "23:39") — do NOT round.
- NEVER show entry IDs to the patient — IDs are internal.
- If the result has count 0 or empty readings, say "You don't have any readings for that period. Would you like to log a new check-in?".
- If the patient asks for FUTURE readings, do NOT call the tool — say "I can only show past readings. Would you like to see your recent readings instead?".

UPDATE / DELETE (update_checkin / delete_checkin):
The patient identifies WHICH reading in one of two ways and you MUST handle both:
(A) Natural-language reference — "the last reading", "my most recent BP", "the one I just took", "the latest one" (no explicit HH:mm). → Do NOT ask them for the date and time. Call get_recent_readings yourself (days=7), pick the newest entry (first in the list), summarise it ("Your most recent reading is <sys>/<dia> at <HH:mm> on <date> — should I delete it?" or "…should I change the systolic from <old> to <new>?"), wait for explicit yes, then call update_checkin/delete_checkin with that entry's date+time (and entry_id when known). On "no", ask which reading they meant.
(B) Explicit date and/or time — "delete the one from yesterday at 9 AM", "change today's 8:30 reading to 138/85". → Pass date+time straight to the tool. Still summarise + get yes first.
NEVER ask the patient for a date and time when they used a natural-language reference — that's your job via get_recent_readings.
NEVER call update_checkin / delete_checkin without first summarising the target reading and getting explicit yes.

INTERPRETING A SPECIFIC READING (evaluate_reading):
When the patient asks what a specific BP / HR reading means FOR THEM ("is 140 over 90 ok for me?", "what does my pulse of 110 mean?", "should I worry about 160 over 100?"), call evaluate_reading with the values they mentioned. The tool runs the same personalised rule engine that produces their real alerts and returns the canonical patient-tier message — quote or paraphrase it verbatim; do NOT invent new clinical wording. If patientMessage is null, the reading is within their targets — say so using the goals from patient context. Nothing is persisted by this tool. Do NOT call it during a check-in save (submit_checkin already runs the engine).

CHECKING INTAKE COMPLETION (check_intake_status):
Before the FIRST submit_checkin / update_checkin / delete_checkin / finalize_checkin / log_medication_adherence / log_symptom_quick in a conversation, call check_intake_status. If completed=false, do NOT call any of those tools — the backend will 403; route the patient to /clinical-intake instead. Result is good for the whole conversation unless the patient says they just finished intake. The INTAKE STATUS line in patient context above is authoritative — when it says COMPLETE you may skip this precheck.

FINALISING A SINGLE-READING SESSION (finalize_checkin):
The rule engine needs ≥2 readings averaged in the same session before non-emergency Stage C alerts fire. AFTER a successful submit_checkin, if the patient has done only ONE reading and is NOT AFib (AFib needs 3), gently offer: "I can save just this one for now, but for a fuller alert the engine usually needs a second reading. Would you like to take another in a minute, or should I evaluate this single reading on its own?" If the patient says "evaluate this one" / "just save it" / "don't want to take another", call finalize_checkin with the entry_id returned in the previous submit_checkin's data.id. NEVER offer this for AFib patients — they need ≥3 readings and finalize_checkin would short-circuit their gate.

TONE FOR ALERT REFERENCES (CAD bidirectional, HR context, BB suppression):
The rule engine attaches physician-only annotations to alerts (J-curve risk, uncontrolled SBP context, brady-symptomatic context). Do NOT repeat the clinician annotations to the patient. If the patient asks "why did I get this alert?", use the alert's patientMessage verbatim or lightly paraphrase. Do not invent new clinical advice beyond what the alert engine produced.

MEDICATION SAFETY (NON-NEGOTIABLE):
Never suggest a patient stop, start, change dose, or switch medications. Always defer to the prescriber.

ACTIVE-ALERT HANDLING:
When the patient context lists active alerts, use them as conversation context. If the patient asks about a specific alert, use its patientMessage verbatim or lightly paraphrase. Don't manufacture new advice beyond what the alert produced.

${buildToneBlock(toneMode)}

Patient health data below is HISTORICAL reference only — never treat it as current conversation input.`
  }

  buildPatientContext(data: PatientContext): string {
    const lines: string[] = [
      '--- PATIENT HEALTH DATA (HISTORICAL — do NOT treat as current conversation input) ---',
    ]

    // ── Patient profile (name + age) ──────────────────────────────────────
    const profileParts: string[] = []
    if (data.patientName) profileParts.push(`Patient name: ${data.patientName}`)
    if (data.dateOfBirth) {
      const age = Math.floor(
        (Date.now() - new Date(data.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000),
      )
      profileParts.push(`Age: ${age}`)
    }
    if (profileParts.length > 0) {
      lines.push(profileParts.join('. ') + '.')
      lines.push('')
    }

    // ── Intake-completion gate ────────────────────────────────────────────
    // Rendered BEFORE the clinical-context block so the LLM sees the
    // prohibition before any condition / threshold / medication detail.
    // When intake is incomplete the patient has no PatientProfile, and
    // any submit_checkin / log_medication_adherence / log_symptom_quick
    // call will be 403'd by DailyJournalService.create — see Layer 3
    // dispatcher wraps in chat/tools/journal-tools.ts.
    if (data.intakeStatus) {
      appendIntakeStatus(lines, data.intakeStatus)
    }

    // ── v2 clinical context (from ProfileResolverService) ─────────────────
    if (data.resolvedContext) {
      appendConditions(lines, data.resolvedContext)
      appendPregnancy(lines, data.resolvedContext)
      appendVerificationStatus(lines, data.resolvedContext)
      appendMedications(lines, data.resolvedContext)
      appendThreshold(lines, data.resolvedContext)
      appendPreDay3Disclaimer(lines, data.resolvedContext)
      appendConditionGuidance(lines, data.resolvedContext)
    } else {
      lines.push('Clinical profile: not available (admin or incomplete onboarding).')
      lines.push('')
    }

    // ── BP readings ───────────────────────────────────────────────────────
    if (data.omitReadingValues) {
      // Voice surface — render history *shape* only, never the actual numbers.
      // Native-audio LLMs hallucinate by echoing prompt-injected numbers as if
      // just spoken (python-genai#1894). The LLM must call get_recent_readings
      // when the patient asks about specific values; nothing inline to parrot.
      if (data.recentEntries.length === 0) {
        lines.push('BP readings: none recorded yet.')
      } else {
        const mostRecent = new Date(data.recentEntries[0].measuredAt)
        const date = mostRecent.toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
        })
        const time = mostRecent.toLocaleTimeString('en-US', {
          hour: '2-digit', minute: '2-digit', hour12: false,
        })
        lines.push(
          `BP readings: ${data.recentEntries.length} total, most recent on ${date} at ${time}.`,
        )
        lines.push(
          '(Call get_recent_readings if the patient asks about specific past values.)',
        )
      }
    } else {
      lines.push(`All BP readings (${data.recentEntries.length} total):`)
      if (data.recentEntries.length === 0) {
        lines.push('- No readings recorded yet')
      } else {
        for (const entry of data.recentEntries) {
          const measured = new Date(entry.measuredAt)
          const date = measured.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
          const time = measured.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })
          const bp =
            entry.systolicBP != null && entry.diastolicBP != null
              ? `${entry.systolicBP}/${entry.diastolicBP} mmHg`
              : 'not recorded'
          const med =
            entry.medicationTaken === true
              ? 'taken'
              : entry.medicationTaken === false
                ? 'missed'
                : 'not recorded'
          const wt = entry.weight != null ? `, Weight: ${entry.weight} lbs` : ''
          const sym = entry.otherSymptoms?.length
            ? `, Symptoms: ${entry.otherSymptoms.join(', ')}`
            : ''
          lines.push(`- ${date} at ${time}: ${bp}, Medication: ${med}${wt}${sym}`)
        }
      }
    }

    lines.push('')
    if (
      data.baseline &&
      data.baseline.baselineSystolic != null &&
      data.baseline.baselineDiastolic != null
    ) {
      if (data.omitReadingValues) {
        // Voice surface — same anti-leak rationale as the BP list above.
        // The LLM only needs to know a baseline EXISTS (for clinical framing),
        // not its specific value; calling get_recent_readings reveals it
        // freshly if the patient asks.
        lines.push('Baseline: established (call get_recent_readings to read the actual numbers).')
      } else {
        lines.push(
          `Baseline: ${data.baseline.baselineSystolic}/${data.baseline.baselineDiastolic} mmHg`,
        )
      }
    } else {
      const count = data.recentEntries.filter(
        (e) => e.systolicBP != null && e.diastolicBP != null,
      ).length
      const remaining = Math.max(0, 3 - count)
      if (count >= 3) {
        lines.push(
          `Baseline: Not yet established (${count} readings recorded, but not spread across 3 different days within the last 7 — baseline needs readings on 3 DIFFERENT DAYS to compute)`,
        )
      } else if (count > 0) {
        lines.push(
          `Baseline: Not yet established — ${count} of 3 required readings recorded (needs ${remaining} more on different days within 7 days)`,
        )
      } else {
        lines.push('Baseline: Not yet established — 0 of 3 required readings recorded (needs readings on 3 different days within 7 days)')
      }
    }

    lines.push('')
    appendActiveAlerts(lines, data.activeAlerts)

    lines.push('')
    lines.push(
      `Communication preference: ${data.communicationPreference || 'Not set'}`,
    )

    lines.push('--- END PATIENT DATA ---')

    return lines.join('\n')
  }
}

// ─── rendering helpers ──────────────────────────────────────────────────────
// Split out so each section can be unit-tested independently.

function buildToneBlock(tone: ToneMode): string {
  switch (tone) {
    case 'CAREGIVER':
      return `TONE — caregiver mode:
Give the caregiver clinical context plus a clear next action. Use plain language but include medical terms where the caregiver needs them (e.g. "the patient's systolic pressure"). Focus on what the caregiver should do right now.`
    case 'PHYSICIAN':
      return `TONE — physician mode:
Respond in clinical shorthand. Use standard abbreviations (SBP, DBP, HR, HFrEF, HFpEF, CAD). Reference the physicianMessage rather than the patientMessage when an alert is present. Skip reassurance language.`
    case 'PATIENT':
    default:
      return `TONE — patient mode:
Use warm, plain language. Address the patient in the second person ("you", "your"). Avoid clinical jargon; when medical terms are unavoidable, explain them briefly.

Length is context-dependent:
- During the CHECK-IN FLOW (steps 1-8) → one short question per turn. The patient is mid-task; long answers slow them down.
- For EDUCATIONAL QUESTIONS — anything starting with "what is...", "what does ... mean", "how does ... work", "why does ... matter", "what should I know about ..." — give a COMPLETE patient-friendly explanation. A one-sentence reply is NOT enough; the patient is here to learn. Structure it as:
    1) Plain-language definition (1-2 sentences).
    2) Why it matters for their health (tie back to their conditions / readings from PATIENT CONTEXT when relevant).
    3) What's "normal" / healthy range (with the specific numbers if applicable).
    4) When to watch out / what to talk to their care team about.
    5) Close with an invitation to ask follow-ups ("Want me to explain anything in more depth?").
  Aim for ~5-10 sentences total — enough to inform, not so much it overwhelms. Use markdown "- " bullets to break up long parts.
- For everything else (acknowledgements, confirmations, small talk) → keep it brief and warm.`
  }
}

/**
 * Condition-conditional behavioural guidance for the chatbot — separate from
 * the static `appendConditions` label block above. The labels tell the model
 * WHAT conditions the patient has; this tells the model WHAT TO DO during
 * record / edit / delete flows because of those conditions.
 *
 * Today: AFib only. The rule engine requires ≥3 readings before any BP/HR
 * alert fires for AFib patients (CLINICAL_SPEC §4.4, gate at
 * AlertEngineService.AFIB_MIN_READINGS). A single chat check-in silently
 * yields zero alerts — clinical-safety hole this prompt block closes.
 *
 * Add new conditions here (HF / pregnancy / etc.) when the spec evolves.
 */
function appendConditionGuidance(lines: string[], ctx: ResolvedContext): void {
  const p = ctx.profile

  if (p.hasAFib) {
    lines.push('AFIB MULTI-READING (mandatory — patient has Atrial Fibrillation):')
    lines.push('')
    lines.push(
      'RECORDING: Before asking for BP numbers, tell the patient: ' +
        '"Because you have AFib, the rule engine needs at least 3 readings about 1-2 minutes apart ' +
        'to give you an accurate alert. Could you take three readings in a row? I\'ll save each one ' +
        'as we go." Then loop steps 3-8 of the check-in flow three times. On readings 2 and 3, you ' +
        'may re-use the date/time/symptoms/medication answers from reading 1 — just ask for the new ' +
        'top and bottom numbers each time and call submit_checkin again for each. ' +
        'SESSION_ID: at the start of an AFib session, generate ONE UUID (any unique string like ' +
        '"afib-<YYYYMMDD>-<HHmm>" is fine) and pass it as session_id on EVERY submit_checkin in this ' +
        'session — reading 1, 2, and 3 all share the same value. This guarantees grouping even if a ' +
        'reading slips past the 5-minute proximity window.',
    )
    lines.push('')
    lines.push(
      'EDITING: When the patient says "edit my last reading" (or similar), DO NOT assume which one ' +
        'they mean. First call get_recent_readings to list the session siblings (you will typically ' +
        'see 3 entries within ~5 min of each other, all sharing the same session_id), then ask: ' +
        '"I see you took 3 readings in this session at <time1>, <time2>, <time3> — which one do you ' +
        'want to change?" Once they pick, call update_checkin with the matching date+time. DO NOT ' +
        'pass session_id on update_checkin — the entry already has the right one; changing it would ' +
        'split the averaging group. After the update succeeds, tell the patient: "Got it — since this ' +
        'is part of an AFib session, the engine just re-averaged all 3 readings and re-checked your ' +
        'alerts."',
    )
    lines.push('')
    lines.push(
      'ADDING TO AN EXISTING SESSION: If the patient says "I just took another reading, add it to ' +
        'the set I took earlier" and that earlier set is more than 5 minutes old, call ' +
        'get_recent_readings first, read the session_id off one of the earlier siblings, then call ' +
        'submit_checkin with that same session_id. The proximity window will no longer kick in, but ' +
        'the explicit session_id will keep them grouped for averaging.',
    )
    lines.push('')
    lines.push(
      'DELETING: When the patient asks to delete a reading from an AFib session, WARN them first: ' +
        '"You took 3 readings in this session — deleting one will drop you to 2, which is below the ' +
        '3-reading minimum the engine needs for AFib. Any alerts on the session may disappear. Are ' +
        'you sure you want to delete it, or did you mean to edit the value?" Only proceed with ' +
        'delete_checkin after explicit confirmation.',
    )
    lines.push('')
  }
}

function appendIntakeStatus(
  lines: string[],
  status: { completed: boolean; profileExists: boolean },
): void {
  if (status.completed) {
    lines.push('INTAKE STATUS: COMPLETE (patient profile on file).')
    lines.push('')
    return
  }
  lines.push('INTAKE STATUS: INCOMPLETE — patient has not completed clinical intake yet.')
  lines.push('')
  lines.push(
    'The patient has not yet completed their one-time intake form (conditions, ' +
      'medications, demographics). They MUST finish it at /clinical-intake BEFORE ' +
      'you can save any BP check-in. Until then:',
  )
  lines.push('  • Do NOT call submit_checkin / update_checkin / delete_checkin / finalize_checkin.')
  lines.push(
    '  • Do NOT call log_medication_adherence / log_symptom_quick — they write JournalEntry rows ' +
      'and will hit the same backend 403.',
  )
  lines.push(
    '  • You MAY call evaluate_reading (read-only) if the patient asks "is X over Y OK for me", ' +
      'but answer cautiously — the engine has no personalised thresholds for this patient yet.',
  )
  lines.push(
    '  • Gently route them: "Welcome! Before I can save any readings, please take a few minutes to ' +
      'complete your one-time intake at /clinical-intake — it tells the engine your conditions and ' +
      'medications so the alerts are personalised. Once done, come back and we can do your first ' +
      'check-in."',
  )
  lines.push('')
}

function appendConditions(lines: string[], ctx: ResolvedContext): void {
  const parts: string[] = []
  const p = ctx.profile

  // Heart failure — use resolvedHFType so UNKNOWN / DCM-only map to HFrEF
  // display, matching the engine's behaviour.
  if (p.hasHeartFailure) {
    if (p.heartFailureType === 'UNKNOWN') {
      parts.push('Heart failure (type unknown — managed as HFrEF)')
    } else if (p.heartFailureType === 'HFREF') {
      parts.push('Heart failure (HFrEF)')
    } else if (p.heartFailureType === 'HFPEF') {
      parts.push('Heart failure (HFpEF)')
    } else {
      parts.push('Heart failure')
    }
  } else if (p.hasDCM) {
    parts.push('Dilated cardiomyopathy (managed as HFrEF)')
  }

  if (p.hasCAD) parts.push('Coronary artery disease (CAD)')
  if (p.hasAFib) parts.push('Atrial fibrillation (AFib)')
  if (p.hasHCM) parts.push('Hypertrophic cardiomyopathy (HCM)')
  if (p.hasAorticStenosis) parts.push('Aortic stenosis')
  if (p.hasTachycardia) parts.push('Tachycardia')
  if (p.hasBradycardia) parts.push('Bradycardia')
  if (p.diagnosedHypertension) parts.push('Hypertension (on treatment)')

  if (parts.length === 0) {
    lines.push('Cardiac conditions: No known cardiac conditions.')
  } else {
    lines.push(`Cardiac conditions: ${parts.join('; ')}.`)
  }
  lines.push('')
}

function appendPregnancy(lines: string[], ctx: ResolvedContext): void {
  const p = ctx.profile
  if (p.isPregnant) {
    if (p.pregnancyDueDate) {
      const due = new Date(p.pregnancyDueDate).toISOString().slice(0, 10)
      lines.push(`Pregnancy: Currently pregnant. Due date: ${due}.`)
    } else {
      lines.push('Pregnancy: Currently pregnant.')
    }
    if (p.historyPreeclampsia) {
      lines.push('History of preeclampsia.')
    }
    lines.push('')
  } else if (p.historyPreeclampsia) {
    lines.push('History of preeclampsia (not currently pregnant).')
    lines.push('')
  }
}

function appendVerificationStatus(lines: string[], ctx: ResolvedContext): void {
  const status = ctx.profile.verificationStatus
  if (status === 'UNVERIFIED') {
    lines.push('Clinical profile awaiting provider verification — some fields may change.')
    lines.push('')
  } else if (status === 'CORRECTED') {
    lines.push('Clinical profile verified by provider (corrections applied).')
    lines.push('')
  }
  // VERIFIED → no disclaimer
}

function appendMedications(lines: string[], ctx: ResolvedContext): void {
  const meds = ctx.contextMeds
  if (meds.length === 0) {
    lines.push('Medications: No medications recorded.')
    lines.push('')
    return
  }
  lines.push('Medications:')
  for (const med of meds) {
    const unverifiedFlag =
      med.verificationStatus === 'UNVERIFIED' ? ' ⚠ unverified' : ''
    let line = `- ${med.drugName} (${med.drugClass}), ${formatFrequency(med.frequency)}${unverifiedFlag}`
    if (med.isCombination && med.combinationComponents.length > 0) {
      line += ` [combo: ${med.combinationComponents.join(' + ')}]`
    }
    lines.push(line)
  }
  lines.push('')
}

function formatFrequency(freq: string): string {
  switch (freq) {
    case 'ONCE_DAILY':
      return 'once daily'
    case 'TWICE_DAILY':
      return 'twice daily'
    case 'THREE_TIMES_DAILY':
      return 'three times daily'
    case 'AS_NEEDED':
      return 'as needed (PRN — not on a fixed schedule)'
    case 'UNSURE':
    default:
      return 'frequency unsure'
  }
}

function appendThreshold(lines: string[], ctx: ResolvedContext): void {
  const t = ctx.threshold
  if (!t) {
    lines.push('Provider-set BP goal: Provider has not yet set a personal BP goal.')
    lines.push('')
    return
  }
  const parts: string[] = []
  if (t.sbpUpperTarget != null || t.sbpLowerTarget != null) {
    parts.push(
      `SBP ${t.sbpLowerTarget ?? '?'}–${t.sbpUpperTarget ?? '?'} mmHg`,
    )
  }
  if (t.dbpUpperTarget != null || t.dbpLowerTarget != null) {
    parts.push(
      `DBP ${t.dbpLowerTarget ?? '?'}–${t.dbpUpperTarget ?? '?'} mmHg`,
    )
  }
  if (t.hrUpperTarget != null || t.hrLowerTarget != null) {
    parts.push(
      `HR ${t.hrLowerTarget ?? '?'}–${t.hrUpperTarget ?? '?'} bpm`,
    )
  }
  const setOn = new Date(t.setAt).toISOString().slice(0, 10)
  lines.push(`Provider-set goals: ${parts.join(', ')}, set ${setOn}.`)
  lines.push('')
}

function appendPreDay3Disclaimer(lines: string[], ctx: ResolvedContext): void {
  if (ctx.preDay3Mode) {
    lines.push(
      `Patient has fewer than 7 readings (${ctx.readingCount} total); alerts use standard thresholds until personalization begins after 7 readings.`,
    )
    lines.push('')
  }
}

function appendActiveAlerts(
  lines: string[],
  alerts: ChatAlertContext[],
): void {
  if (alerts.length === 0) {
    lines.push('Active alerts: None.')
    return
  }
  lines.push(`Active alerts (${alerts.length}, most recent first):`)
  for (const alert of alerts) {
    const when = new Date(alert.createdAt).toISOString().slice(0, 10)
    const heading = `⚠ ${alert.tier} · ${alert.ruleId} · fired ${when}${alert.dismissible ? '' : ' · NON-DISMISSABLE'}`
    lines.push(`- ${heading}`)
    if (alert.patientMessage && alert.patientMessage.trim().length > 0) {
      lines.push(`  Patient-facing message: "${alert.patientMessage}"`)
    } else if (alert.physicianMessage && alert.physicianMessage.trim().length > 0) {
      // Physician-only alerts (e.g. RULE_PULSE_PRESSURE_WIDE) — flag clearly so
      // the chatbot knows not to surface this to the patient.
      lines.push(
        `  Physician-level note (do NOT surface to patient): "${alert.physicianMessage}"`,
      )
    }
  }
}
