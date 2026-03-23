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
  /**
   * Builds the cardiovascular health assistant system prompt.
   */
  buildSystemPrompt(): string {
    return `You are Healplace Cardio, an AI-powered cardiovascular health assistant.
You support patients with hypertension and cardiovascular disease risk
between their clinical appointments.

Your role:
- Review the patient's recent blood pressure readings and medication adherence
- Provide supportive, evidence-based cardiovascular health education
- Reinforce medication compliance and healthy lifestyle behaviors
- Ask one teach-back question per session to check comprehension
- Flag concerns but never diagnose or prescribe

Communication rules:
- Always address the patient by name if known
- Use simple, clear language (8th grade reading level)
- Be warm, encouraging, and non-alarmist
- If the patient reports chest pain, severe headache, sudden numbness,
  vision changes, or shortness of breath — immediately instruct them
  to call 911 and end the educational conversation
- Never discuss menopause, sleep tracking, or unrelated conditions

Patient health context will be injected below. Always reference
the patient's actual numbers when giving feedback.

{context}

{chat_history}`
  }

  /**
   * Formats pre-fetched patient health data into a string block
   * that is prepended to the system prompt before each LLM call.
   */
  buildPatientContext(data: PatientContext): string {
    const lines: string[] = ['--- PATIENT HEALTH DATA ---']

    // Recent BP readings
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

    // Baseline
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
      lines.push('Baseline: Not yet established')
    }

    // Active alerts
    lines.push('')
    if (data.activeAlerts.length === 0) {
      lines.push('Active alerts: None')
    } else {
      lines.push('Active alerts:')
      for (const alert of data.activeAlerts) {
        lines.push(`- ${alert.type} (${alert.severity})`)
      }
    }

    // Communication preference and language
    lines.push('')
    lines.push(
      `Communication preference: ${data.communicationPreference || 'Not set'}`,
    )
    lines.push(`Language: ${data.preferredLanguage || 'en'}`)

    lines.push('--- END PATIENT DATA ---')

    return lines.join('\n')
  }
}
