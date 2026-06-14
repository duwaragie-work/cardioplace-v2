import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'

export interface IntakeStatus {
  completed: boolean
  profileExists: boolean
}

/**
 * Lightweight read-only check for "has the patient completed their one-time
 * clinical intake form". Mirrors the gate at
 * DailyJournalService.create (daily_journal.service.ts:37-58):
 * `prisma.patientProfile.findUnique({ where: { userId } })` — if the row
 * exists, intake is considered done.
 *
 * Used by:
 *  • chat + voice system-prompt builders — injects an INTAKE STATUS block so
 *    the LLM proactively prevents BP check-in attempts on incomplete profiles.
 *  • the `check_intake_status` chat / voice tool — explicit precheck the LLM
 *    can run before any submit_checkin / log_* call.
 *
 * Stricter definitions (medications required, provider-verified) were
 * intentionally rejected — we match the backend gate exactly so the LLM's
 * view and the controller's enforcement never disagree.
 */
@Injectable()
export class IntakeStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatus(userId: string): Promise<IntakeStatus> {
    const profile = await this.prisma.patientProfile.findUnique({
      where: { userId },
      select: { userId: true },
    })
    const profileExists = profile !== null
    return { completed: profileExists, profileExists }
  }
}
