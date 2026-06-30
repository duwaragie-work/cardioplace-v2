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
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
  ) {}

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

  async list(actor: ActorUser) {
    // Role-scoped: PROVIDER + MED_DIR see only practices they're members
    // of (via PracticeProvider / PracticeMedicalDirector joins). OPS/SUPER
    // get undefined back = no filter. Empty array short-circuits to zero
    // practices for a scoped role with no memberships yet.
    const scopeIds = await this.access.practiceScopeIds(actor)
    const where = scopeIds === undefined ? {} : { id: { in: scopeIds } }
    const practices = await this.prisma.practice.findMany({
      where,
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

  async findOne(actor: ActorUser, id: string) {
    // Scope enforcement: PROVIDER + MED_DIR can only view their own
    // practices. Treat out-of-scope as 404 (not 403) so the caller can't
    // probe practice-id existence by reading the error code.
    const scopeIds = await this.access.practiceScopeIds(actor)
    if (scopeIds !== undefined && !scopeIds.includes(id)) {
      throw new NotFoundException('Practice not found')
    }
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
  async listStaff(actor: ActorUser, id: string) {
    // Same scope rule as findOne — keep the staff list behind the same
    // practice-visibility gate.
    const scopeIds = await this.access.practiceScopeIds(actor)
    if (scopeIds !== undefined && !scopeIds.includes(id)) {
      throw new NotFoundException('Practice not found')
    }
    const practice = await this.prisma.practice.findUnique({
      where: { id },
      select: { id: true },
    })
    if (!practice) throw new NotFoundException('Practice not found')

    // Three sources of practice staff, unioned:
    //   1. PatientProviderAssignment slots (primary/backup/MD) — historical
    //      derivation that still works for existing data
    //   2. PracticeProvider — explicit provider membership (May 2026 add)
    //   3. PracticeMedicalDirector — explicit MD membership (May 2026 add)
    // The explicit joins let a practice be staffed BEFORE the first patient
    // assignment, which the care-team cascading dropdown depends on.
    const [assignments, providerMembers, mdMembers] = await Promise.all([
      this.prisma.patientProviderAssignment.findMany({
        where: { practiceId: id },
        select: {
          primaryProviderId: true,
          backupProviderId: true,
          medicalDirectorId: true,
        },
      }),
      this.prisma.practiceProvider.findMany({
        where: { practiceId: id },
        select: { userId: true },
      }),
      this.prisma.practiceMedicalDirector.findMany({
        where: { practiceId: id },
        select: { userId: true },
      }),
    ])

    // Track which slots each user has filled so the UI can show role badges.
    // Users sourced only from the explicit joins (no current patient
    // assignment) carry an empty slot set — they're staffed for the
    // practice but not yet on anyone's care team.
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
    for (const m of providerMembers) ensure(m.userId)
    for (const m of mdMembers) ensure(m.userId).add('MEDICAL_DIRECTOR')

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
    // Count UNIQUE staff per practice from all sources, mirroring listStaff:
    //   1. PatientProviderAssignment slots (primary/backup/MD) — legacy
    //      derivation that still holds for practices with assigned patients.
    //   2. PracticeProvider — explicit provider membership (invite/OPS add).
    //   3. PracticeMedicalDirector — explicit MD membership.
    //   4. PracticeCoordinator — the practice's coordinator.
    // Without 2–4 a freshly-staffed practice with no patient assignments yet
    // reported 0 staff even though providers/MDs/coordinators were members.
    const [assignments, providers, mds, coordinators] = await Promise.all([
      this.prisma.patientProviderAssignment.findMany({
        where: { practiceId: { in: practiceIds } },
        select: {
          practiceId: true,
          primaryProviderId: true,
          backupProviderId: true,
          medicalDirectorId: true,
        },
      }),
      this.prisma.practiceProvider.findMany({
        where: { practiceId: { in: practiceIds } },
        select: { practiceId: true, userId: true },
      }),
      this.prisma.practiceMedicalDirector.findMany({
        where: { practiceId: { in: practiceIds } },
        select: { practiceId: true, userId: true },
      }),
      this.prisma.practiceCoordinator.findMany({
        where: { practiceId: { in: practiceIds } },
        select: { practiceId: true, userId: true },
      }),
    ])
    const buckets = new Map<string, Set<string>>()
    const add = (practiceId: string, userId: string | null | undefined) => {
      if (!userId) return
      const set = buckets.get(practiceId) ?? new Set<string>()
      set.add(userId)
      buckets.set(practiceId, set)
    }
    for (const a of assignments) {
      add(a.practiceId, a.primaryProviderId)
      add(a.practiceId, a.backupProviderId)
      add(a.practiceId, a.medicalDirectorId)
    }
    for (const p of providers) add(p.practiceId, p.userId)
    for (const m of mds) add(m.practiceId, m.userId)
    for (const c of coordinators) add(c.practiceId, c.userId)

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

  // ─── PracticeProvider / PracticeMedicalDirector explicit membership ──────
  // Lets OPS / SUPER_ADMIN populate a practice with staff BEFORE the first
  // patient assignment so the care-team cascading dropdown is populated on
  // first use. Both joins are many-to-many — a user can belong to multiple
  // practices. Idempotent: ON CONFLICT DO NOTHING via Prisma's @@unique.

  async addProvider(practiceId: string, userId: string) {
    await this.assertPracticeAndUser(practiceId, userId, 'PROVIDER')
    try {
      await this.prisma.practiceProvider.create({
        data: { practiceId, userId },
      })
    } catch (err) {
      // P2002 = already a member. Idempotent — silent success.
      if (
        err instanceof Error &&
        (err as { code?: string }).code !== 'P2002'
      ) {
        throw err
      }
    }
    return { statusCode: 200, message: 'Provider added to practice' }
  }

  async removeProvider(practiceId: string, userId: string) {
    await this.prisma.practiceProvider.deleteMany({
      where: { practiceId, userId },
    })
    return { statusCode: 200, message: 'Provider removed from practice' }
  }

  async addMedicalDirector(practiceId: string, userId: string) {
    await this.assertPracticeAndUser(practiceId, userId, 'MEDICAL_DIRECTOR')
    try {
      await this.prisma.practiceMedicalDirector.create({
        data: { practiceId, userId },
      })
    } catch (err) {
      if (
        err instanceof Error &&
        (err as { code?: string }).code !== 'P2002'
      ) {
        throw err
      }
    }
    return { statusCode: 200, message: 'Medical director added to practice' }
  }

  async removeMedicalDirector(practiceId: string, userId: string) {
    await this.prisma.practiceMedicalDirector.deleteMany({
      where: { practiceId, userId },
    })
    return { statusCode: 200, message: 'Medical director removed from practice' }
  }

  private async assertPracticeAndUser(
    practiceId: string,
    userId: string,
    requiredRole: 'PROVIDER' | 'MEDICAL_DIRECTOR',
  ) {
    const [practice, user] = await Promise.all([
      this.prisma.practice.findUnique({
        where: { id: practiceId },
        select: { id: true },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, roles: true },
      }),
    ])
    if (!practice) throw new NotFoundException('Practice not found')
    if (!user) throw new NotFoundException(`User ${userId} not found`)
    if (!user.roles.includes(requiredRole)) {
      throw new BadRequestException(
        `User ${userId} lacks required role ${requiredRole} (has: ${user.roles.join(', ')})`,
      )
    }
  }
}
