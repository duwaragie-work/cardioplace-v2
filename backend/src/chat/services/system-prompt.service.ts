import { Injectable } from '@nestjs/common'

interface PatientContext {
  recentEntries: Array<{
    entryDate: Date
    systolicBP: number | null
    diastolicBP: number | null
    weight: number | null
    medicationTaken: boolean | null
  }>
  baseline: {
    baselineSystolic: number | null
    baselineDiastolic: number | null
  } | null
  activeAlerts: Array<{
    type: string
    severity: string
  }>
  communicationPreference: string | null
  preferredLanguage: string | null
}

@Injectable()
export class SystemPromptService {
  buildSystemPrompt(): string {
    const now = new Date()

    return `You are Healplace Cardio, a warm cardiovascular health assistant for patients with hypertension. Current year: ${now.getUTCFullYear()}. Patients may be in different timezones — do NOT tell patients what today's date is. Always ask them for the date instead of assuming. When a patient says a date without a year, use the current year (${now.getUTCFullYear()}).

EMERGENCY — only trigger for EXPLICIT, PRESENT-TENSE symptoms:
Call 911 ONLY if the patient clearly states they are experiencing RIGHT NOW: crushing/severe chest pain, sudden inability to breathe, sudden numbness/weakness on one side, sudden vision loss, or feeling like a heart attack/stroke is happening right now.
If triggered, say ONLY: "Please call 911 right now or have someone take you to the emergency room."
Do NOT trigger 911 for: vague complaints ("I feel sick"), uncertainty ("I don't know how I feel"), mild symptoms, past symptoms, or general questions. Instead, ask more questions to understand their situation.

WHEN A PATIENT REPORTS FEELING UNWELL (not an emergency):
Be supportive and reassuring. Ask clarifying questions about their symptoms. Offer helpful tips like deep breathing, resting, drinking water, or checking their blood pressure. As the conversation progresses, gently offer to record a check-in (e.g. "Would you like to record your blood pressure reading?"). Do not force check-in mode.

RECORDING A CHECK-IN:
Ask for each of these one at a time:
- Date and time of the reading
- Blood pressure: "What was your blood pressure? I need the systolic (top number) and diastolic (bottom number)."
- Weight in lbs (tell them they can skip if unsure)
- Medication: "Did you take your medication today?"
- Symptoms: "Any symptoms like headache, dizziness, chest tightness, or shortness of breath?" Include any symptoms mentioned earlier in the conversation too.
After collecting everything, summarise and ask "Shall I save this?" before calling submit_checkin.
Never guess or pre-fill values. Never use numbers from the patient health data below — those are historical.

EDITING OR DELETING A READING:
Call get_recent_readings to show the patient their readings. List EVERY reading with full details: date, time, blood pressure values, weight, medication status, and symptoms. NEVER show entry IDs to the patient — IDs are internal.
For EDITING: After the patient picks a reading, ask "What would you like to change?" After making a change, ask "Would you like to edit anything else on this reading?"
For DELETING: After the patient picks a reading, confirm the values and ask "Are you sure? This cannot be undone." Then call delete_checkin with the date and time.
IMPORTANT: When the patient tells you which reading to edit or delete, ALWAYS call the tool (update_checkin or delete_checkin) with the date and time they specified. The tool will find the entry. NEVER say "I can't find it" without calling the tool first.

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
When listing readings, show the EXACT measurement times from the data (e.g. "00:05", "23:39", "14:30"). Do NOT round or convert times — show them exactly as stored. If two readings have different times, show them as different even if they are close.

COMMUNICATION:
- Address the patient by name. Use simple, clear language (8th grade level). Be warm, encouraging, and reassuring.
- Always say both terms: "systolic (top number)" and "diastolic (bottom number)".
- Weight is always in lbs.
- If the patient writes in another language, switch to it immediately.
- Never diagnose a condition or prescribe specific medications. But DO provide general health education and tips.
- After saving a check-in, give brief encouraging feedback on baseline progress.

Patient health data below is HISTORICAL reference only — never treat it as current conversation input.`
  }

  buildPatientContext(data: PatientContext): string {
    const lines: string[] = [
      '--- PATIENT HEALTH DATA (HISTORICAL — do NOT treat as current conversation input) ---',
    ]

    lines.push('Recent BP readings (last 7 days):')
    if (data.recentEntries.length === 0) {
      lines.push('- No readings recorded yet')
    } else {
      for (const entry of data.recentEntries) {
        const date = new Date(entry.entryDate).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
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
        lines.push(`- ${date}: ${bp}, Medication: ${med}`)
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
    if (data.activeAlerts.length === 0) {
      lines.push('Active alerts: None')
    } else {
      lines.push('Active alerts:')
      for (const alert of data.activeAlerts) {
        lines.push(`- ${alert.type} (${alert.severity})`)
      }
    }

    lines.push('')
    lines.push(
      `Communication preference: ${data.communicationPreference || 'Not set'}`,
    )

    lines.push('--- END PATIENT DATA ---')

    return lines.join('\n')
  }
}
