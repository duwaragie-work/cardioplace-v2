import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  pickDisplayName,
  resolveUserDisplays,
} from '../common/user-name-resolver.js'
import type { UpsertThresholdDto } from './dto/upsert-threshold.dto.js'

@Injectable()
export class ThresholdService {
  constructor(private readonly prisma: PrismaService) {}

  async create(adminId: string, patientUserId: string, dto: UpsertThresholdDto) {
    await this.assertPatientExists(patientUserId)
    this.validateRanges(dto)

    try {
      const threshold = await this.prisma.patientThreshold.create({
        data: {
          userId: patientUserId,
          setByProviderId: adminId,
          ...dto,
        },
      })
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

  async update(adminId: string, patientUserId: string, dto: UpsertThresholdDto) {
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
        setByProviderId: adminId,
        setAt: new Date(),
      },
    })
    return {
      statusCode: 200,
      message: 'Threshold updated',
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
