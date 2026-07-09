import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { Prisma } from '../generated/prisma/client.js'
import { SecurityIncidentActionType } from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type {
  AssignIncidentDto,
  EscalateDto,
  IncidentNoteDto,
  ListExceptionsQuery,
  ListIncidentsQuery,
  MarkBenignDto,
  ResolveIncidentDto,
} from './dto/worklist.dto.js'

/** The acting reviewer — mirrors SupportActor (id is the ops user id). */
export interface WorklistActor {
  id: string
}

/**
 * L3 reviewer worklist + security-incident lifecycle.
 *
 * READS the AuditException rows N7's cron produces and WRITES the triage trail
 * back onto them (acknowledge / mark-benign / escalate) — the "examine + act"
 * half of §164.312(b). Escalate opens a SecurityIncident (§164.308(a)(6)) that
 * then carries its own assign → work → resolve lifecycle.
 *
 * We never mutate N7's detection fields — only the reviewer-owned columns it
 * left null. A row that N7 marked (or we set) RESOLVED / FALSE_POSITIVE is
 * terminal: the cron treats it as sticky, so re-triage is rejected here too.
 */
@Injectable()
export class WorklistService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Audit-exception worklist ───────────────────────────────────────────

  async listExceptions(query: ListExceptionsQuery) {
    const page = query.page ?? 1
    const limit = query.limit ?? 50
    const skip = (page - 1) * limit

    const where: Prisma.AuditExceptionWhereInput = {}
    if (query.status) where.status = query.status
    if (query.severity) where.severity = query.severity
    if (query.detectorId) where.detectorId = query.detectorId
    if (query.practiceContext) where.practiceContext = query.practiceContext
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.auditException.findMany({
        where,
        skip,
        take: limit,
        // Most urgent first: open before triaged, then severity, then recency.
        orderBy: [{ status: 'asc' }, { severity: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.auditException.count({ where }),
    ])
    return { data, total, page, limit }
  }

  getException(id: string) {
    return this.requireException(id)
  }

  async acknowledgeException(actor: WorklistActor, id: string) {
    const ex = await this.requireException(id)
    this.assertTriageable(ex.status)
    return this.prisma.auditException.update({
      where: { id: ex.id },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedBy: actor.id,
        acknowledgedAt: new Date(),
      },
    })
  }

  async markBenign(actor: WorklistActor, id: string, dto: MarkBenignDto) {
    const ex = await this.requireException(id)
    this.assertTriageable(ex.status)
    return this.prisma.auditException.update({
      where: { id: ex.id },
      data: {
        status: 'FALSE_POSITIVE',
        benignBy: actor.id,
        benignAt: new Date(),
        benignReason: dto.reason,
      },
    })
  }

  /** Escalate → open a SecurityIncident and mark the exception RESOLVED (it is
   *  now tracked by the incident). Returns both so the UI can route to the
   *  incident. */
  async escalateException(actor: WorklistActor, id: string, dto: EscalateDto) {
    const ex = await this.requireException(id)
    this.assertTriageable(ex.status)

    return this.prisma.$transaction(async (tx) => {
      const incident = await tx.securityIncident.create({
        data: {
          status: 'OPEN',
          // Same three values in both enums; default from the exception.
          severity: dto.severity ?? ex.severity,
          title: dto.title ?? ex.summary.slice(0, 200),
          summary: dto.notes ? `${ex.summary}\n\n${dto.notes}` : ex.summary,
          sourceExceptionId: ex.id,
          sourceDetectorId: ex.detectorId,
          practiceContext: ex.practiceContext,
          openedByOpsId: actor.id,
          assignedToOpsId: actor.id,
        },
      })
      await tx.securityIncidentAction.create({
        data: {
          incidentId: incident.id,
          opsUserId: actor.id,
          actionType: SecurityIncidentActionType.OPENED,
          metadata: { fromExceptionId: ex.id, detectorId: ex.detectorId },
        },
      })
      const exception = await tx.auditException.update({
        where: { id: ex.id },
        data: {
          status: 'RESOLVED',
          escalatedToIncidentId: incident.id,
          escalatedAt: new Date(),
          // Record the reviewer if they escalated straight from OPEN.
          acknowledgedBy: ex.acknowledgedBy ?? actor.id,
          acknowledgedAt: ex.acknowledgedAt ?? new Date(),
        },
      })
      return { incident, exception }
    })
  }

  // ─── Security-incident lifecycle ────────────────────────────────────────

  async listIncidents(query: ListIncidentsQuery) {
    const page = query.page ?? 1
    const limit = query.limit ?? 50
    const skip = (page - 1) * limit

    const where: Prisma.SecurityIncidentWhereInput = {}
    if (query.status) where.status = query.status
    if (query.severity) where.severity = query.severity
    if (query.practiceContext) where.practiceContext = query.practiceContext
    if (query.assignedToOpsId) where.assignedToOpsId = query.assignedToOpsId
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.securityIncident.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ status: 'asc' }, { severity: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.securityIncident.count({ where }),
    ])
    return { data, total, page, limit }
  }

  async getIncident(id: string) {
    const incident = await this.prisma.securityIncident.findUnique({
      where: { id },
      include: { actions: { orderBy: { performedAt: 'desc' } } },
    })
    if (!incident) throw new NotFoundException('Security incident not found')
    return incident
  }

  async assignIncident(
    actor: WorklistActor,
    id: string,
    dto: AssignIncidentDto,
  ) {
    const incident = await this.requireIncident(id)
    const assignee = dto.assignToOpsId ?? actor.id
    await this.prisma.securityIncident.update({
      where: { id: incident.id },
      data: {
        assignedToOpsId: assignee,
        // Picking up an OPEN incident moves it into progress.
        status:
          incident.status === 'OPEN' ? 'IN_PROGRESS' : incident.status,
      },
    })
    await this.recordIncidentAction(
      incident.id,
      actor.id,
      SecurityIncidentActionType.ASSIGNED,
      { assignedToOpsId: assignee },
    )
    return this.getIncident(incident.id)
  }

  async addIncidentNote(
    actor: WorklistActor,
    id: string,
    dto: IncidentNoteDto,
  ) {
    const incident = await this.requireIncident(id)
    await this.recordIncidentAction(
      incident.id,
      actor.id,
      SecurityIncidentActionType.NOTE_ADDED,
      { note: dto.note },
    )
    return this.getIncident(incident.id)
  }

  async resolveIncident(
    actor: WorklistActor,
    id: string,
    dto: ResolveIncidentDto,
  ) {
    const incident = await this.requireIncident(id)
    if (incident.status === 'RESOLVED') {
      throw new BadRequestException('Incident is already resolved')
    }
    await this.prisma.securityIncident.update({
      where: { id: incident.id },
      data: {
        status: 'RESOLVED',
        resolutionNotes: dto.resolutionNotes,
        resolvedByOpsId: actor.id,
        resolvedAt: new Date(),
      },
    })
    await this.recordIncidentAction(
      incident.id,
      actor.id,
      SecurityIncidentActionType.RESOLVED,
      { resolutionNotes: dto.resolutionNotes },
    )
    return this.getIncident(incident.id)
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async requireException(id: string) {
    const ex = await this.prisma.auditException.findUnique({ where: { id } })
    if (!ex) throw new NotFoundException('Audit exception not found')
    return ex
  }

  private async requireIncident(id: string) {
    const incident = await this.prisma.securityIncident.findUnique({
      where: { id },
    })
    if (!incident) throw new NotFoundException('Security incident not found')
    return incident
  }

  /** A RESOLVED / FALSE_POSITIVE exception is terminal (N7 treats it as sticky). */
  private assertTriageable(status: string) {
    if (status === 'RESOLVED' || status === 'FALSE_POSITIVE') {
      throw new BadRequestException(
        'This exception has already been dispositioned',
      )
    }
  }

  private recordIncidentAction(
    incidentId: string,
    opsUserId: string,
    actionType: SecurityIncidentActionType,
    metadata: Record<string, unknown>,
  ) {
    return this.prisma.securityIncidentAction.create({
      data: {
        incidentId,
        opsUserId,
        actionType,
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
  }
}
