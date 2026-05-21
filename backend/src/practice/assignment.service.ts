import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  ActorUser,
  PatientAccessService,
} from '../common/patient-access.service.js'
import { Prisma } from '../generated/prisma/client.js'
import {
  VerifierRole,
  VerificationChangeType,
} from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { CreateAssignmentDto } from './dto/create-assignment.dto.js'
import type { UpdateAssignmentDto } from './dto/update-assignment.dto.js'

// JCAHO audit snapshot — the four care-team slots only.
interface AssignmentSnapshot {
  practiceId: string | null
  primaryProviderId: string | null
  backupProviderId: string | null
  medicalDirectorId: string | null
}

// Which user roles qualify for each assignment slot.
const PRIMARY_ALLOWED = ['PROVIDER', 'MEDICAL_DIRECTOR'] as const
const BACKUP_ALLOWED = ['PROVIDER', 'MEDICAL_DIRECTOR'] as const
const MEDICAL_DIRECTOR_ALLOWED = ['MEDICAL_DIRECTOR'] as const

@Injectable()
export class AssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
  ) {}

  async create(
    actor: ActorUser,
    patientUserId: string,
    dto: CreateAssignmentDto,
  ) {
    // MED_DIR is gated to practices they head; OPS/SUPER unscoped. Runs
    // before any DB writes so a denied caller can't see the audit row.
    await this.access.assertCanModifyPracticeAssignment(actor, dto.practiceId)
    // Same clinician in two slots is a coverage anti-pattern — primary +
    // backup must be distinct so escalation has a real fallback. Caught
    // here so a hand-crafted POST can't bypass the frontend dropdown.
    if (dto.primaryProviderId === dto.backupProviderId) {
      throw new BadRequestException(
        'Primary and backup providers must be different',
      )
    }
    await this.assertPatientExists(patientUserId)
    await this.assertPracticeExists(dto.practiceId)
    await this.assertRoles(
      dto.primaryProviderId,
      PRIMARY_ALLOWED,
      'primaryProviderId',
    )
    await this.assertRoles(
      dto.backupProviderId,
      BACKUP_ALLOWED,
      'backupProviderId',
    )
    await this.assertRoles(
      dto.medicalDirectorId,
      MEDICAL_DIRECTOR_ALLOWED,
      'medicalDirectorId',
    )

    try {
      const assignment = await this.prisma.patientProviderAssignment.create({
        data: {
          userId: patientUserId,
          practiceId: dto.practiceId,
          primaryProviderId: dto.primaryProviderId,
          backupProviderId: dto.backupProviderId,
          medicalDirectorId: dto.medicalDirectorId,
        },
      })
      // Finding 4 — JCAHO audit: care-team assignment is a clinical-staff
      // state change and must leave an actor + before/after trail.
      await this.writeAssignmentAudit(
        patientUserId,
        actor.id,
        Prisma.JsonNull,
        this.assignmentSnapshot(assignment),
      )
      return {
        statusCode: 201,
        message: 'Assignment created',
        data: assignment,
      }
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'This patient already has an active assignment — use PATCH to update',
        )
      }
      throw err
    }
  }

  async findByPatient(patientUserId: string) {
    const assignment = await this.prisma.patientProviderAssignment.findUnique({
      where: { userId: patientUserId },
    })
    if (!assignment) throw new NotFoundException('Assignment not found')
    return {
      statusCode: 200,
      message: 'Assignment retrieved',
      data: assignment,
    }
  }

  /**
   * Patient-facing care-team view. Returns the assignment with the three
   * provider names (primary / backup / medical director) populated, or
   * `null` when the patient hasn't been assigned to a care team yet (a
   * legitimate state during enrollment).
   */
  async findCareTeamForPatient(patientUserId: string) {
    const assignment = await this.prisma.patientProviderAssignment.findUnique({
      where: { userId: patientUserId },
      include: {
        practice: { select: { id: true, name: true } },
        primaryProvider: { select: { id: true, name: true, email: true } },
        backupProvider: { select: { id: true, name: true, email: true } },
        medicalDirector: { select: { id: true, name: true, email: true } },
      },
    })
    return {
      statusCode: 200,
      message: assignment ? 'Care team retrieved' : 'No care team assigned yet',
      data: assignment
        ? {
            id: assignment.id,
            practice: assignment.practice,
            primaryProvider: assignment.primaryProvider,
            backupProvider: assignment.backupProvider,
            medicalDirector: assignment.medicalDirector,
            assignedAt: assignment.assignedAt,
          }
        : null,
    }
  }

  async update(
    actor: ActorUser,
    patientUserId: string,
    dto: UpdateAssignmentDto,
  ) {
    const existing = await this.prisma.patientProviderAssignment.findUnique({
      where: { userId: patientUserId },
    })
    if (!existing) throw new NotFoundException('Assignment not found')

    // MED_DIR scope: both the existing practice and (if changing) the new
    // practice must be headed by them. Pre-check before any writes.
    const practicesToCheck = dto.practiceId
      ? [existing.practiceId, dto.practiceId]
      : [existing.practiceId]
    await this.access.assertCanModifyPracticeAssignment(actor, practicesToCheck)

    // Primary != backup after the patch is applied. Build the prospective
    // state by overlaying dto on existing — a partial update that only sets
    // primary still needs to be checked against the existing backup, and
    // vice versa.
    const nextPrimary = dto.primaryProviderId ?? existing.primaryProviderId
    const nextBackup = dto.backupProviderId ?? existing.backupProviderId
    if (nextPrimary === nextBackup) {
      throw new BadRequestException(
        'Primary and backup providers must be different',
      )
    }

    if (dto.practiceId) await this.assertPracticeExists(dto.practiceId)
    if (dto.primaryProviderId)
      await this.assertRoles(
        dto.primaryProviderId,
        PRIMARY_ALLOWED,
        'primaryProviderId',
      )
    if (dto.backupProviderId)
      await this.assertRoles(
        dto.backupProviderId,
        BACKUP_ALLOWED,
        'backupProviderId',
      )
    if (dto.medicalDirectorId)
      await this.assertRoles(
        dto.medicalDirectorId,
        MEDICAL_DIRECTOR_ALLOWED,
        'medicalDirectorId',
      )

    const updated = await this.prisma.patientProviderAssignment.update({
      where: { userId: patientUserId },
      data: dto,
    })
    // Finding 4 — JCAHO audit: capture prior care team → new care team.
    await this.writeAssignmentAudit(
      patientUserId,
      actor.id,
      this.assignmentSnapshot(existing),
      this.assignmentSnapshot(updated),
    )
    return {
      statusCode: 200,
      message: 'Assignment updated',
      data: updated,
    }
  }

  private assignmentSnapshot(a: {
    practiceId: string | null
    primaryProviderId: string | null
    backupProviderId: string | null
    medicalDirectorId: string | null
  }): AssignmentSnapshot {
    return {
      practiceId: a.practiceId ?? null,
      primaryProviderId: a.primaryProviderId ?? null,
      backupProviderId: a.backupProviderId ?? null,
      medicalDirectorId: a.medicalDirectorId ?? null,
    }
  }

  private async writeAssignmentAudit(
    patientUserId: string,
    adminId: string,
    previousValue: AssignmentSnapshot | typeof Prisma.JsonNull,
    newValue: AssignmentSnapshot,
  ): Promise<void> {
    await this.prisma.profileVerificationLog.create({
      data: {
        userId: patientUserId,
        fieldPath: 'assignment',
        previousValue:
          previousValue as unknown as Prisma.InputJsonValue,
        newValue: newValue as unknown as Prisma.InputJsonValue,
        changedBy: adminId,
        changedByRole: VerifierRole.ADMIN,
        changeType: VerificationChangeType.ADMIN_ASSIGNMENT_CHANGE,
        rationale: null,
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
      throw new BadRequestException(
        `User ${userId} is not a PATIENT (roles: ${user.roles.join(', ')})`,
      )
    }
  }

  private async assertPracticeExists(practiceId: string) {
    const found = await this.prisma.practice.findUnique({
      where: { id: practiceId },
      select: { id: true },
    })
    if (!found)
      throw new BadRequestException(`Practice ${practiceId} does not exist`)
  }

  private async assertRoles(
    userId: string,
    allowed: readonly string[],
    slot: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, roles: true },
    })
    if (!user) throw new BadRequestException(`${slot}: user ${userId} not found`)
    if (!user.roles.some((r) => allowed.includes(r))) {
      throw new BadRequestException(
        `${slot}: user ${userId} lacks required role (has: ${user.roles.join(', ')}; need one of: ${allowed.join(', ')})`,
      )
    }
  }
}
