import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import {
  Prisma,
  VerificationChangeType,
  VerifierRole,
} from '../generated/prisma/client.js'
import type { PatientCaregiver } from '../generated/prisma/client.js'
import type { CaregiverDto } from '@cardioplace/shared'
import { PrismaService } from '../prisma/prisma.service.js'
import type { CreateCaregiverDto } from './dto/create-caregiver.dto.js'
import type { UpdateCaregiverDto } from './dto/update-caregiver.dto.js'

type ActorRole = 'PATIENT' | 'ADMIN'

/**
 * Gap 5 — caregiver relationship CRUD + consent capture + PHI-sharing audit.
 *
 * A caregiver is a contact attached to a patient. Dispatch of the signed-off
 * caregiverMessage (escalation.service.ts) is hard-gated on `consentGivenAt`.
 * Every create/update/consent change writes a ProfileVerificationLog row
 * (fieldPath `caregiver:<id>`) — caregiver config is PHI-sharing and so is
 * JCAHO-relevant.
 */
@Injectable()
export class CaregiverService {
  private readonly logger = new Logger(CaregiverService.name)

  constructor(private readonly prisma: PrismaService) {}

  async list(patientUserId: string): Promise<{ data: CaregiverDto[] }> {
    const rows = await this.prisma.patientCaregiver.findMany({
      where: { patientUserId, active: true },
      orderBy: { createdAt: 'asc' },
    })
    return { data: rows.map(toDto) }
  }

  async create(
    patientUserId: string,
    actorUserId: string,
    actorRole: ActorRole,
    dto: CreateCaregiverDto,
  ): Promise<{ data: CaregiverDto }> {
    this.validateChannelContact(dto.notifyChannel, dto.email, dto.phone)

    const consentAt = dto.consentGiven ? new Date() : null
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.patientCaregiver.create({
        data: {
          patientUserId,
          name: dto.name.trim(),
          relationship: nullableTrim(dto.relationship),
          phone: nullableTrim(dto.phone),
          email: nullableTrim(dto.email),
          notifyChannel: dto.notifyChannel ?? 'NONE',
          consentGivenAt: consentAt,
          consentGivenBy: consentAt ? actorUserId : null,
        },
      })
      await this.writeAudit(tx, patientUserId, actorUserId, actorRole, created, null)
      return created
    })
    return { data: toDto(row) }
  }

  async update(
    patientUserId: string,
    caregiverId: string,
    actorUserId: string,
    actorRole: ActorRole,
    dto: UpdateCaregiverDto,
  ): Promise<{ data: CaregiverDto }> {
    const existing = await this.requireOwned(patientUserId, caregiverId)

    // Resolve the effective channel/contact for validation (incoming or existing).
    const nextChannel = dto.notifyChannel ?? existing.notifyChannel
    const nextEmail =
      dto.email !== undefined ? nullableTrim(dto.email) : existing.email
    const nextPhone =
      dto.phone !== undefined ? nullableTrim(dto.phone) : existing.phone
    this.validateChannelContact(nextChannel, nextEmail, nextPhone)

    const data: Prisma.PatientCaregiverUpdateInput = {}
    if (dto.name !== undefined) data.name = dto.name.trim()
    if (dto.relationship !== undefined) data.relationship = nullableTrim(dto.relationship)
    if (dto.phone !== undefined) data.phone = nullableTrim(dto.phone)
    if (dto.email !== undefined) data.email = nullableTrim(dto.email)
    if (dto.notifyChannel !== undefined) data.notifyChannel = dto.notifyChannel
    if (dto.active !== undefined) data.active = dto.active
    // Consent: true stamps now (idempotent — keep the first stamp); false revokes.
    if (dto.consentGiven === true && existing.consentGivenAt == null) {
      data.consentGivenAt = new Date()
      data.consentGivenBy = actorUserId
    } else if (dto.consentGiven === false) {
      data.consentGivenAt = null
      data.consentGivenBy = null
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.patientCaregiver.update({
        where: { id: caregiverId },
        data,
      })
      await this.writeAudit(tx, patientUserId, actorUserId, actorRole, updated, existing)
      return updated
    })
    return { data: toDto(row) }
  }

  /** Soft-disable (active=false) — preserves the audit of who could receive PHI. */
  async remove(
    patientUserId: string,
    caregiverId: string,
    actorUserId: string,
    actorRole: ActorRole,
  ): Promise<{ data: { id: string; active: boolean } }> {
    const existing = await this.requireOwned(patientUserId, caregiverId)
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.patientCaregiver.update({
        where: { id: caregiverId },
        data: { active: false },
      })
      await this.writeAudit(tx, patientUserId, actorUserId, actorRole, updated, existing)
      return updated
    })
    return { data: { id: row.id, active: row.active } }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async requireOwned(
    patientUserId: string,
    caregiverId: string,
  ): Promise<PatientCaregiver> {
    const row = await this.prisma.patientCaregiver.findUnique({
      where: { id: caregiverId },
    })
    if (!row || row.patientUserId !== patientUserId) {
      throw new NotFoundException('Caregiver not found for this patient.')
    }
    return row
  }

  private validateChannelContact(
    channel: string | undefined,
    email: string | null | undefined,
    phone: string | null | undefined,
  ): void {
    if (channel === 'EMAIL' && !email) {
      throw new BadRequestException('Email is required when notifyChannel is EMAIL.')
    }
    if (channel === 'SMS' && !phone) {
      throw new BadRequestException('Phone is required when notifyChannel is SMS.')
    }
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    patientUserId: string,
    actorUserId: string,
    actorRole: ActorRole,
    next: PatientCaregiver,
    previous: PatientCaregiver | null,
  ): Promise<void> {
    await tx.profileVerificationLog.create({
      data: {
        userId: patientUserId,
        fieldPath: `caregiver:${next.id}`,
        previousValue: previous
          ? (serialize(previous) as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        newValue: serialize(next) as Prisma.InputJsonValue,
        changedBy: actorUserId,
        changedByRole:
          actorRole === 'ADMIN' ? VerifierRole.ADMIN : VerifierRole.PATIENT,
        changeType:
          actorRole === 'ADMIN'
            ? VerificationChangeType.ADMIN_CORRECT
            : VerificationChangeType.PATIENT_REPORT,
      },
    })
  }
}

function nullableTrim(v: string | null | undefined): string | null {
  if (v == null) return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

function toDto(c: PatientCaregiver): CaregiverDto {
  return {
    id: c.id,
    patientUserId: c.patientUserId,
    name: c.name,
    relationship: c.relationship,
    phone: c.phone,
    email: c.email,
    notifyChannel: c.notifyChannel,
    consentGivenAt: c.consentGivenAt ? c.consentGivenAt.toISOString() : null,
    active: c.active,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }
}

// Minimum-Necessary audit snapshot — config fields only, no PHI beyond the
// caregiver's own contact details (which the patient supplied).
function serialize(c: PatientCaregiver): Record<string, unknown> {
  return {
    name: c.name,
    relationship: c.relationship,
    email: c.email,
    phone: c.phone,
    notifyChannel: c.notifyChannel,
    consentGiven: c.consentGivenAt != null,
    active: c.active,
  }
}
