import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { CreateAssignmentDto } from './dto/create-assignment.dto.js'
import type { UpdateAssignmentDto } from './dto/update-assignment.dto.js'

// Which user roles qualify for each assignment slot.
const PRIMARY_ALLOWED = ['PROVIDER', 'MEDICAL_DIRECTOR'] as const
const BACKUP_ALLOWED = ['PROVIDER', 'MEDICAL_DIRECTOR'] as const
const MEDICAL_DIRECTOR_ALLOWED = ['MEDICAL_DIRECTOR'] as const

@Injectable()
export class AssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  async create(patientUserId: string, dto: CreateAssignmentDto) {
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

  async update(patientUserId: string, dto: UpdateAssignmentDto) {
    const existing = await this.prisma.patientProviderAssignment.findUnique({
      where: { userId: patientUserId },
    })
    if (!existing) throw new NotFoundException('Assignment not found')

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
    return {
      statusCode: 200,
      message: 'Assignment updated',
      data: updated,
    }
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
