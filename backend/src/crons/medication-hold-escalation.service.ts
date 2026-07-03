import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { ClsService } from 'nestjs-cls'
import { runAsCronActor } from '../common/cls/cron-actor.util.js'
import {
  MedicationVerificationStatus,
  NotificationChannel,
} from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'

// Manisha 5/24 Med §4 — medication-reconciliation escalation ladder for meds
// stuck on HOLD. A hold is supposed to be a short administrative pause; if it
// lingers, the care team must be nudged with rising urgency so a patient's med
// list never sits unreconciled indefinitely.
//
//   Day 7  (level 1) → dashboard badge for the primary provider.
//   Day 14 (level 2) → Tier-3 flag to the assigned (primary) provider.
//   Day 30 (level 3) → Tier-2 flag to the primary provider + Medical Director.
//   Day 45 (level 4) → auto-escalate to the CMO review queue (Medical Director
//                      + HEALPLACE_OPS).
//
// Idempotency is anchored on PatientMedication.holdEscalationLevel: each rung
// fires at most once. A med that has been on hold long enough to clear several
// rungs at once (e.g. the cron was down) fires only the highest reached rung.
// Leaving HOLD resets holdEscalationLevel to 0 (see intake.service).

const DAY_MS = 24 * 60 * 60 * 1000

interface HoldRung {
  level: number
  days: number
  title: string
  /** Recipient roles resolved off the patient's PatientProviderAssignment. */
  recipients: Array<'PRIMARY_PROVIDER' | 'MEDICAL_DIRECTOR' | 'HEALPLACE_OPS'>
  channels: NotificationChannel[]
}

// Ordered low → high so we can pick the highest rung a hold has reached.
const HOLD_RUNGS: HoldRung[] = [
  {
    level: 1,
    days: 7,
    title: 'Medication hold — 7-day review',
    recipients: ['PRIMARY_PROVIDER'],
    channels: [NotificationChannel.DASHBOARD],
  },
  {
    level: 2,
    days: 14,
    title: 'Medication hold — 14-day review needed',
    recipients: ['PRIMARY_PROVIDER'],
    channels: [NotificationChannel.DASHBOARD, NotificationChannel.PUSH],
  },
  {
    level: 3,
    days: 30,
    title: 'Medication hold — 30-day escalation',
    recipients: ['PRIMARY_PROVIDER', 'MEDICAL_DIRECTOR'],
    channels: [NotificationChannel.DASHBOARD, NotificationChannel.PUSH],
  },
  {
    level: 4,
    days: 45,
    title: 'Medication hold — 45-day CMO review',
    recipients: ['MEDICAL_DIRECTOR', 'HEALPLACE_OPS'],
    channels: [NotificationChannel.DASHBOARD, NotificationChannel.PUSH],
  },
]

@Injectable()
export class MedicationHoldEscalationService {
  private readonly logger = new Logger(MedicationHoldEscalationService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
  ) {}

  @Cron('0 15 * * *') // daily 15:00 UTC
  async scheduledRun() {
    return runAsCronActor(this.cls, 'cron-medication-hold-escalation', async () => {
      const count = await this.runScan()
      this.logger.log(`Medication-hold escalation scan complete: ${count} rungs fired`)
    })
  }

  /**
   * Public so tests + ops tooling can trigger on demand. Returns the number of
   * escalation rungs fired this pass.
   */
  async runScan(now: Date = new Date()): Promise<number> {
    const held = await this.prisma.patientMedication.findMany({
      where: {
        verificationStatus: MedicationVerificationStatus.HOLD,
        discontinuedAt: null,
        holdSetAt: { not: null },
      },
      select: {
        id: true,
        userId: true,
        drugName: true,
        holdSetAt: true,
        holdEscalationLevel: true,
      },
    })
    if (held.length === 0) return 0

    // Resolve care teams in one batch.
    const userIds = [...new Set(held.map((m) => m.userId))]
    const assignments = await this.prisma.patientProviderAssignment.findMany({
      where: { userId: { in: userIds } },
      select: {
        userId: true,
        primaryProviderId: true,
        medicalDirectorId: true,
      },
    })
    const assignmentByUser = new Map(assignments.map((a) => [a.userId, a]))

    // HEALPLACE_OPS is a role, not an assignment slot — resolve the active ops
    // users once for the day-45 CMO queue rung.
    let opsIds: string[] | null = null

    let fired = 0
    for (const med of held) {
      if (!med.holdSetAt) continue
      const ageDays = Math.floor((now.getTime() - med.holdSetAt.getTime()) / DAY_MS)

      // Highest rung this hold has reached but not yet fired.
      const rung = [...HOLD_RUNGS]
        .reverse()
        .find((r) => ageDays >= r.days && r.level > med.holdEscalationLevel)
      if (!rung) continue

      const assignment = assignmentByUser.get(med.userId)
      const recipientIds = new Set<string>()
      for (const role of rung.recipients) {
        if (role === 'PRIMARY_PROVIDER' && assignment?.primaryProviderId) {
          recipientIds.add(assignment.primaryProviderId)
        } else if (role === 'MEDICAL_DIRECTOR' && assignment?.medicalDirectorId) {
          recipientIds.add(assignment.medicalDirectorId)
        } else if (role === 'HEALPLACE_OPS') {
          if (opsIds === null) opsIds = await this.resolveOpsIds()
          opsIds.forEach((id) => recipientIds.add(id))
        }
      }

      // Always bump the level so a hold with no resolvable care team doesn't
      // re-evaluate the same rung every day (it would never dispatch but would
      // keep churning). Bump happens whether or not anyone was notified.
      await this.prisma.patientMedication.update({
        where: { id: med.id },
        data: { holdEscalationLevel: rung.level },
      })

      if (recipientIds.size === 0) {
        this.logger.warn(
          `Medication ${med.id} hit hold rung ${rung.level} but has no resolvable recipients`,
        )
        continue
      }

      const body = `"${med.drugName}" has been on hold for ${ageDays} days. Please review and reconcile this medication.`
      for (const recipientId of recipientIds) {
        for (const channel of rung.channels) {
          await this.prisma.notification.create({
            data: {
              userId: recipientId,
              patientUserId: med.userId,
              channel,
              title: rung.title,
              body,
              dispatchTrigger: 'SYSTEM_CRON',
            },
          })
        }
      }
      fired++
    }

    return fired
  }

  private async resolveOpsIds(): Promise<string[]> {
    const ops = await this.prisma.user.findMany({
      where: { roles: { has: 'HEALPLACE_OPS' } },
      select: { id: true },
    })
    return ops.map((o) => o.id)
  }
}
