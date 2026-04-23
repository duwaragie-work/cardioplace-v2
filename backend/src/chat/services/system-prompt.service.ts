import { Injectable } from '@nestjs/common'
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
}

@Injectable()
export class SystemPromptService {
  buildSystemPrompt(opts: { toneMode?: ToneMode } = {}): string {
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
  OPTIONAL:
    NOTES — only if patient volunteers

SUBMISSION FLOW — FOLLOW THIS EXACT ORDER. NO EXCEPTIONS:

You MUST ask these questions in THIS EXACT ORDER, one at a time. Do NOT skip ahead. Do NOT combine questions.

Step 1: DATE — "What date is this reading for?"
Step 2: TIME — "What time was this reading taken?" (ask separately, even if they said "today")
Step 3: BP READING — "What were your blood pressure numbers? I need the top number and bottom number."
Step 4: MEDICATION — "Did you take your medication today?"
Step 5: SYMPTOMS — "Any symptoms today like headache, dizziness, or chest tightness?"
Step 6: WEIGHT — You MUST ask: "What is your weight today in lbs? You can skip this if you don't know." You MUST ask this question every time. Do NOT skip it. The patient can choose to skip, but YOU must always ask.
Step 7: SUMMARY + CONFIRM — Show all collected values and ask "Shall I save this?"
Step 8: SAVE — When patient says yes, IMMEDIATELY call submit_checkin. Then confirm save.

RULES:
- Ask ONE question per message. Wait for the answer before asking the next.
- Follow steps 1→2→3→4→5→6→7→8 in order. NEVER jump to step 7 before completing steps 1-6.
- If the patient gives multiple answers at once (e.g. "120/80, took meds, no symptoms"), accept them all and skip to the next UNANSWERED step.
- NEVER call submit_checkin before step 7 (summary + confirm).
- At step 7, show a summary like: "Here's what I have: Date: today, Time: 13:29, BP: 170/79, Medication: taken, Symptoms: none, Weight: skipped. Shall I save this?"
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
  You: "170 over 79 — got it. Did you take your medication today?" [Step 4]
  Patient: "yes"
  You: "Great! Any symptoms today like headache, dizziness, or chest tightness?" [Step 5]
  Patient: "nope"
  You: "Good to hear! Do you know your weight today? This is optional — totally fine to skip." [Step 6]
  Patient: "skip"
  You: "No problem! Here's what I have: Date: today, Time: 13:29, BP: 170/79, Medication: taken, Symptoms: none, Weight: skipped. Shall I save this?" [Step 7]
  Patient: "yes"
  → CALL submit_checkin(entry_date, measurement_time, systolic_bp=170, diastolic_bp=79, medication_taken=true, symptoms=[], weight=null) [Step 8]
  You: "Your check-in has been saved! BP 170/79 recorded for today at 13:29. Keep up the great work!"

submit_checkin parameters:
  entry_date (YYYY-MM-DD), measurement_time (HH:mm), systolic_bp (number),
  diastolic_bp (number), medication_taken (boolean), symptoms (string[]),
  weight (number, optional), notes (string, optional)

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

EDITING A READING (update_checkin):
Flow:
1. Call get_recent_readings first to find the reading
2. List the readings to the patient with full details
3. After patient picks a reading, ask: "What would you like to change?"
4. Confirm the changes with the patient
5. Call update_checkin

Call update_checkin with:
- entry_date (YYYY-MM-DD) — COMPULSORY — date of the reading to update
- original_time (HH:mm) — COMPULSORY — the measurement time of the reading to update
- entry_id (string) — OPTIONAL — entry ID if available from get_recent_readings
Then include ONLY the fields that need to change:
- measurement_time (HH:mm) — new time if changing
- systolic_bp (number, 60–250) — new systolic if changing
- diastolic_bp (number, 40–150) — new diastolic if changing
- medication_taken (boolean) — new status if changing
- weight (number, lbs) — new weight if changing
- symptoms (string array, English) — new symptom list if changing
- notes (string, English) — new notes if changing
After making a change, ask: "Would you like to edit anything else on this reading?"

DELETING A READING (delete_checkin):
Flow:
1. Call get_recent_readings first to find the reading
2. List the readings to the patient with full details
3. After patient picks a reading, confirm: "Are you sure you want to delete the reading from [date] at [time] with BP [systolic]/[diastolic]? This cannot be undone."
4. Only after explicit "yes" confirmation, call delete_checkin

Call delete_checkin with:
- entry_date (YYYY-MM-DD) — COMPULSORY — date of the reading to delete
- original_time (HH:mm) — COMPULSORY — measurement time of the reading to delete
- entry_id (string) — OPTIONAL — entry ID if available from get_recent_readings

IMPORTANT: When the patient tells you which reading to edit or delete, ALWAYS call the tool with the date and time they specified. The tool will find the entry. NEVER say "I can't find it" without calling the tool first.

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

    // ── v2 clinical context (from ProfileResolverService) ─────────────────
    if (data.resolvedContext) {
      appendConditions(lines, data.resolvedContext)
      appendPregnancy(lines, data.resolvedContext)
      appendVerificationStatus(lines, data.resolvedContext)
      appendMedications(lines, data.resolvedContext)
      appendThreshold(lines, data.resolvedContext)
      appendPreDay3Disclaimer(lines, data.resolvedContext)
    } else {
      lines.push('Clinical profile: not available (admin or incomplete onboarding).')
      lines.push('')
    }

    // ── BP readings ───────────────────────────────────────────────────────
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

    lines.push('')
    if (
      data.baseline &&
      data.baseline.baselineSystolic != null &&
      data.baseline.baselineDiastolic != null
    ) {
      lines.push(
        `Baseline: ${data.baseline.baselineSystolic}/${data.baseline.baselineDiastolic} mmHg`,
      )
    } else {
      const count = data.recentEntries.filter(
        (e) => e.systolicBP != null && e.diastolicBP != null,
      ).length
      const remaining = Math.max(0, 3 - count)
      if (count >= 3) {
        lines.push(
          `Baseline: Not yet computed (${count} readings recorded — baseline should be available shortly, may need readings on 3 different days)`,
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
Use warm, plain language. Address the patient in the second person ("you", "your"). Avoid clinical jargon; when medical terms are unavoidable, explain them briefly. Keep responses supportive, encouraging, and short.`
  }
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
      `Patient has fewer than 7 readings (${ctx.readingCount} total); alerts use standard thresholds until personalization begins after Day 3.`,
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
