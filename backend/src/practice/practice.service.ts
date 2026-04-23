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
      include: { _count: { select: { assignments: true } } },
    })
    // Build per-practice unique-staff counts in one extra query so the J1
    // index can render staff + patient counts without N round-trips.
    const ids = practices.map((p) => p.id)
    const staffCountMap = ids.length > 0 ? await this.staffCounts(ids) : new Map<string, number>()

    return {
      statusCode: 200,
      message: 'Practices retrieved',
      data: practices.map((p) => ({
        id: p.id,
        name: p.name,
        businessHoursStart: p.businessHoursStart,
        businessHoursEnd: p.businessHoursEnd,
        businessHoursTimezone: p.businessHoursTimezone,
        afterHoursProtocol: p.afterHoursProtocol,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        patientCount: p._count.assignments,
        staffCount: staffCountMap.get(p.id) ?? 0,
      })),
    }
  }

  async findOne(id: string) {
    const practice = await this.prisma.practice.findUnique({
      where: { id },
      include: { _count: { select: { assignments: true } } },
    })
    if (!practice) throw new NotFoundException('Practice not found')
    const staffCounts = await this.staffCounts([id])
    return {
      statusCode: 200,
      message: 'Practice retrieved',
      data: {
        id: practice.id,
        name: practice.name,
        businessHoursStart: practice.businessHoursStart,
        businessHoursEnd: practice.businessHoursEnd,
        businessHoursTimezone: practice.businessHoursTimezone,
        afterHoursProtocol: practice.afterHoursProtocol,
        createdAt: practice.createdAt,
        updatedAt: practice.updatedAt,
        patientCount: practice._count.assignments,
        staffCount: staffCounts.get(id) ?? 0,
      },
    }
  }

  // ─── GET /admin/practices/:id/staff ──────────────────────────────────────
  // Deduplicated list of providers (any of primary / backup / medical-director
  // slots) referenced by any patient assignment at this practice. Powers the
  // J2 staff list and the J3 reassignment dropdowns.
  async listStaff(id: string) {
    const practice = await this.prisma.practice.findUnique({
      where: { id },
      select: { id: true },
    })
    if (!practice) throw new NotFoundException('Practice not found')

    const assignments = await this.prisma.patientProviderAssignment.findMany({
      where: { practiceId: id },
      select: {
        primaryProviderId: true,
        backupProviderId: true,
        medicalDirectorId: true,
      },
    })

    // Track which slots each user has filled so the UI can show role badges.
    const slots = new Map<string, Set<'PRIMARY' | 'BACKUP' | 'MEDICAL_DIRECTOR'>>()
    const ensure = (uid: string) => {
      const s = slots.get(uid) ?? new Set()
      slots.set(uid, s)
      return s
    }
    for (const a of assignments) {
      ensure(a.primaryProviderId).add('PRIMARY')
      ensure(a.backupProviderId).add('BACKUP')
      ensure(a.medicalDirectorId).add('MEDICAL_DIRECTOR')
    }

    const ids = Array.from(slots.keys())
    if (ids.length === 0) {
      return { statusCode: 200, message: 'No staff yet', data: [] }
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true, roles: true },
    })

    return {
      statusCode: 200,
      message: 'Staff retrieved',
      data: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        roles: u.roles,
        slots: Array.from(slots.get(u.id) ?? []),
      })),
    }
  }

  /** Internal: unique staff count per practice id. */
  private async staffCounts(practiceIds: string[]): Promise<Map<string, number>> {
    const assignments = await this.prisma.patientProviderAssignment.findMany({
      where: { practiceId: { in: practiceIds } },
      select: {
        practiceId: true,
        primaryProviderId: true,
        backupProviderId: true,
        medicalDirectorId: true,
      },
    })
    const buckets = new Map<string, Set<string>>()
    for (const a of assignments) {
      const set = buckets.get(a.practiceId) ?? new Set<string>()
      set.add(a.primaryProviderId)
      set.add(a.backupProviderId)
      set.add(a.medicalDirectorId)
      buckets.set(a.practiceId, set)
    }
    const out = new Map<string, number>()
    for (const [pid, set] of buckets) out.set(pid, set.size)
    return out
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
