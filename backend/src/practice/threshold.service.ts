import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import {
  ActorUser,
  PatientAccessService,
} from '../common/patient-access.service.js'
import { Prisma } from '../generated/prisma/client.js'
import {
  NotificationChannel,
  VerifierRole,
  VerificationChangeType,
} from '../generated/prisma/enums.js'
import { systemMsgThresholdUpdated } from '@cardioplace/shared'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  pickDisplayName,
  resolveUserDisplays,
} from '../common/user-name-resolver.js'
import { EnrollmentService } from './enrollment.service.js'
import type { UpsertThresholdDto } from './dto/upsert-threshold.dto.js'

// JCAHO audit snapshot — the clinically-meaningful threshold targets only
// (no Prisma Date/internal columns), so previous/new diff cleanly in the
// ProfileVerificationLog.
interface ThresholdSnapshot {
  sbpUpperTarget: number | null
  sbpLowerTarget: number | null
  dbpUpperTarget: number | null
  dbpLowerTarget: number | null
  hrUpperTarget: number | null
  hrLowerTarget: number | null
  notes: string | null
}

@Injectable()
export class ThresholdService {
  private readonly logger = new Logger(ThresholdService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
    private readonly enrollment: EnrollmentService,
  ) {}

  async create(
    actor: ActorUser,
    patientUserId: string,
    dto: UpsertThresholdDto,
    ctx?: { practiceId: string | null },
  ) {
    // Role-scope gate: PROVIDER must be in panel; MED_DIR must head the
    // patient's practice. OPS/SUPER short-circuit through.
    await this.access.assertCanAccessPatient(actor, patientUserId)
    await this.assertPatientExists(patientUserId)
    this.validateRanges(dto)

    try {
      const threshold = await this.prisma.patientThreshold.create({
        data: {
          userId: patientUserId,
          setByProviderId: actor.id,
          ...dto,
        },
      })
      // Finding 4 — JCAHO audit: a clinical-staff threshold write is a
      // state-change action and must leave an actor + before/after trail.
      await this.writeThresholdAudit(
        patientUserId,
        actor.id,
        Prisma.JsonNull,
        this.thresholdSnapshot(threshold),
        ctx?.practiceId ?? null,
      )
      // IVR-04 — if this threshold clears the re-enrollment gate for a patient
      // who was auto-reverted, restore enrollment + catch up deferred alerts.
      // No-op for first-time / still-blocked / already-enrolled patients.
      await this.enrollment.autoReEnrollIfGateCleared(actor, patientUserId)
      // THR-034 — let the patient know their monitoring targets were set.
      await this.notifyPatientThresholdUpdated(patientUserId)
      return {
        statusCode: 201,
        message: 'Threshold created',
        data: threshold,
      }
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Threshold already exists for this patient — use PATCH to update',
        )
      }
      throw err
    }
  }

  async findByPatient(patientUserId: string) {
    const threshold = await this.prisma.patientThreshold.findUnique({
      where: { userId: patientUserId },
    })
    if (!threshold) throw new NotFoundException('Threshold not found')
    const names = await resolveUserDisplays(this.prisma, [threshold.setByProviderId])
    return {
      statusCode: 200,
      message: 'Threshold retrieved',
      data: {
        ...threshold,
        setByName: pickDisplayName(threshold.setByProviderId, names),
      },
    }
  }

  /**
   * Patient-facing read — returns `null` when no threshold has been set,
   * rather than 404'ing. Used by the dashboard to decide whether to render
   * the "Your goal" card.
   */
  async findByPatientOrNull(patientUserId: string) {
    const threshold = await this.prisma.patientThreshold.findUnique({
      where: { userId: patientUserId },
    })
    return {
      statusCode: 200,
      message: threshold ? 'Threshold retrieved' : 'No threshold set yet',
      data: threshold,
    }
  }

  async update(
    actor: ActorUser,
    patientUserId: string,
    dto: UpsertThresholdDto,
    ctx?: { practiceId: string | null },
  ) {
    await this.access.assertCanAccessPatient(actor, patientUserId)
    const existing = await this.prisma.patientThreshold.findUnique({
      where: { userId: patientUserId },
    })
    if (!existing) throw new NotFoundException('Threshold not found')

    this.validateRanges({
      sbpUpperTarget: dto.sbpUpperTarget ?? existing.sbpUpperTarget ?? undefined,
      sbpLowerTarget: dto.sbpLowerTarget ?? existing.sbpLowerTarget ?? undefined,
      dbpUpperTarget: dto.dbpUpperTarget ?? existing.dbpUpperTarget ?? undefined,
      dbpLowerTarget: dto.dbpLowerTarget ?? existing.dbpLowerTarget ?? undefined,
      hrUpperTarget: dto.hrUpperTarget ?? existing.hrUpperTarget ?? undefined,
      hrLowerTarget: dto.hrLowerTarget ?? existing.hrLowerTarget ?? undefined,
    })

    // PatientThreshold.userId is @unique, so full history tables can't live
    // here without a schema change. Overwrite in place + bump setAt/setBy.
    // The replacedAt field is left untouched (dead while active).
    const updated = await this.prisma.patientThreshold.update({
      where: { userId: patientUserId },
      data: {
        ...dto,
        setByProviderId: actor.id,
        setAt: new Date(),
      },
    })
    // Finding 4 — JCAHO audit: capture the prior targets → new targets diff.
    await this.writeThresholdAudit(
      patientUserId,
      actor.id,
      this.thresholdSnapshot(existing),
      this.thresholdSnapshot(updated),
      ctx?.practiceId ?? null,
    )
    // IVR-04 — restore enrollment if this update clears the gate for an
    // auto-reverted patient (e.g. a threshold edit that finally fits).
    await this.enrollment.autoReEnrollIfGateCleared(actor, patientUserId)
    // THR-034 — notify the patient their monitoring targets changed.
    await this.notifyPatientThresholdUpdated(patientUserId)
    return {
      statusCode: 200,
      message: 'Threshold updated',
      data: updated,
    }
  }

  /**
   * THR-033 — clear a patient's personalized threshold. Removes the row (the
   * patient reverts to the standard threshold table) and, when the condition
   * still REQUIRES one (§4.2), drops an enrolled patient back to NOT_ENROLLED
   * via the enrollment-gap revert. Writes a JCAHO "threshold cleared" audit row.
   */
  async delete(
    actor: ActorUser,
    patientUserId: string,
    ctx?: { practiceId: string | null },
  ) {
    await this.access.assertCanAccessPatient(actor, patientUserId)
    const existing = await this.prisma.patientThreshold.findUnique({
      where: { userId: patientUserId },
    })
    if (!existing) throw new NotFoundException('Threshold not found')

    await this.prisma.patientThreshold.delete({ where: { userId: patientUserId } })
    // JCAHO audit — previous targets → cleared (null).
    await this.prisma.profileVerificationLog.create({
      data: {
        userId: patientUserId,
        fieldPath: 'threshold',
        previousValue: this.thresholdSnapshot(
          existing,
        ) as unknown as Prisma.InputJsonValue,
        newValue: Prisma.JsonNull,
        changedBy: actor.id,
        changedByRole: VerifierRole.ADMIN,
        changeType: VerificationChangeType.ADMIN_THRESHOLD_UPDATE,
        rationale: 'Personalized threshold cleared.',
        practiceContext: ctx?.practiceId ?? null,
      },
    })
    // Cascade: a still-mandatory enrolled patient must drop back to NOT_ENROLLED.
    await this.enrollment.revertIfThresholdGap(actor, patientUserId)
    return { statusCode: 200, message: 'Threshold cleared', data: null }
  }

  // THR-034 — best-effort patient inbox notice that their targets changed.
  // PUSH so it lands in the patient's Notifications tab; failure never blocks
  // the threshold write. NEEDS Dr. Singal sign-off on the wording.
  private async notifyPatientThresholdUpdated(patientUserId: string): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: {
          userId: patientUserId,
          channel: NotificationChannel.PUSH,
          title: 'Monitoring targets updated',
          body: systemMsgThresholdUpdated(),
        },
      })
    } catch (err) {
      this.logger.error(
        `Threshold-updated notification failed for ${patientUserId}`,
        err instanceof Error ? err.stack : err,
      )
    }
  }

  private thresholdSnapshot(t: {
    sbpUpperTarget: number | null
    sbpLowerTarget: number | null
    dbpUpperTarget: number | null
    dbpLowerTarget: number | null
    hrUpperTarget: number | null
    hrLowerTarget: number | null
    notes: string | null
  }): ThresholdSnapshot {
    return {
      sbpUpperTarget: t.sbpUpperTarget ?? null,
      sbpLowerTarget: t.sbpLowerTarget ?? null,
      dbpUpperTarget: t.dbpUpperTarget ?? null,
      dbpLowerTarget: t.dbpLowerTarget ?? null,
      hrUpperTarget: t.hrUpperTarget ?? null,
      hrLowerTarget: t.hrLowerTarget ?? null,
      notes: t.notes ?? null,
    }
  }

  private async writeThresholdAudit(
    patientUserId: string,
    adminId: string,
    previousValue: ThresholdSnapshot | typeof Prisma.JsonNull,
    newValue: ThresholdSnapshot,
    practiceContext: string | null = null,
  ): Promise<void> {
    await this.prisma.profileVerificationLog.create({
      data: {
        userId: patientUserId,
        fieldPath: 'threshold',
        previousValue:
          previousValue as unknown as Prisma.InputJsonValue,
        newValue: newValue as unknown as Prisma.InputJsonValue,
        changedBy: adminId,
        changedByRole: VerifierRole.ADMIN,
        changeType: VerificationChangeType.ADMIN_THRESHOLD_UPDATE,
        rationale: newValue.notes ?? null,
        practiceContext,
      },
    })
  }

  private async assertPatientExists(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, roles: true },
    })
    if (!user) throw new NotFoundException(`Patient user ${userId} not found`)
    if (!user.roles.includes('PATIENT')) {
      throw new BadRequestException(`User ${userId} is not a PATIENT`)
    }
  }

  private validateRanges(t: UpsertThresholdDto) {
    const pairs: Array<[string, number | null | undefined, string, number | null | undefined]> = [
      ['sbpLowerTarget', t.sbpLowerTarget, 'sbpUpperTarget', t.sbpUpperTarget],
      ['dbpLowerTarget', t.dbpLowerTarget, 'dbpUpperTarget', t.dbpUpperTarget],
      ['hrLowerTarget', t.hrLowerTarget, 'hrUpperTarget', t.hrUpperTarget],
    ]
    for (const [lowerName, lower, upperName, upper] of pairs) {
      if (
        lower != null &&
        upper != null &&
        lower >= upper
      ) {
        throw new BadRequestException(
          `${lowerName} (${lower}) must be less than ${upperName} (${upper})`,
        )
      }
    }
  }
}
