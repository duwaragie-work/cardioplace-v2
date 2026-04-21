import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import type { CreatePracticeDto } from './dto/create-practice.dto.js'
import type { UpdatePracticeDto } from './dto/update-practice.dto.js'

const DEFAULT_BUSINESS_HOURS = {
  start: '08:00',
  end: '18:00',
  timezone: 'America/New_York',
} as const

@Injectable()
export class PracticeService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePracticeDto) {
    const start = dto.businessHoursStart ?? DEFAULT_BUSINESS_HOURS.start
    const end = dto.businessHoursEnd ?? DEFAULT_BUSINESS_HOURS.end
    const tz = dto.businessHoursTimezone ?? DEFAULT_BUSINESS_HOURS.timezone

    this.validateBusinessHours(start, end, tz)

    const practice = await this.prisma.practice.create({
      data: {
        name: dto.name,
        businessHoursStart: start,
        businessHoursEnd: end,
        businessHoursTimezone: tz,
        afterHoursProtocol: dto.afterHoursProtocol,
      },
    })

    return {
      statusCode: 201,
      message: 'Practice created',
      data: practice,
    }
  }

  async list() {
    const practices = await this.prisma.practice.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return {
      statusCode: 200,
      message: 'Practices retrieved',
      data: practices,
    }
  }

  async findOne(id: string) {
    const practice = await this.prisma.practice.findUnique({ where: { id } })
    if (!practice) throw new NotFoundException('Practice not found')
    return {
      statusCode: 200,
      message: 'Practice retrieved',
      data: practice,
    }
  }

  async update(id: string, dto: UpdatePracticeDto) {
    const existing = await this.prisma.practice.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException('Practice not found')

    const start = dto.businessHoursStart ?? existing.businessHoursStart
    const end = dto.businessHoursEnd ?? existing.businessHoursEnd
    const tz = dto.businessHoursTimezone ?? existing.businessHoursTimezone
    this.validateBusinessHours(start, end, tz)

    const practice = await this.prisma.practice.update({
      where: { id },
      data: {
        name: dto.name,
        businessHoursStart: dto.businessHoursStart,
        businessHoursEnd: dto.businessHoursEnd,
        businessHoursTimezone: dto.businessHoursTimezone,
        afterHoursProtocol: dto.afterHoursProtocol,
      },
    })

    return {
      statusCode: 200,
      message: 'Practice updated',
      data: practice,
    }
  }

  private validateBusinessHours(start: string, end: string, tz: string) {
    // IANA tz via Intl — throws RangeError for invalid.
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz })
    } catch {
      throw new BadRequestException(`Invalid IANA timezone: ${tz}`)
    }

    const startMin = this.toMinutes(start)
    const endMin = this.toMinutes(end)
    if (startMin >= endMin) {
      throw new BadRequestException(
        'businessHoursStart must be earlier than businessHoursEnd',
      )
    }
  }

  private toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number)
    return (h ?? 0) * 60 + (m ?? 0)
  }

  // Used by tests + guards that need a guaranteed-404 when the id is bad.
  async assertExists(id: string) {
    const found = await this.prisma.practice.findUnique({
      where: { id },
      select: { id: true },
    })
    if (!found) throw new ConflictException(`Practice ${id} does not exist`)
  }
}
