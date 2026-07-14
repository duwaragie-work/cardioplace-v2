import { Injectable } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { ListAccessLogQuery } from './dto/list-access-log.query.js'
import { ListAuthLogQuery } from './dto/list-auth-log.query.js'

/**
 * Read side of the HIPAA audit trail (§164.312(b) — the "examine" half, sprint
 * L2). Paginated, filtered reads over the append-only AccessLog / AuthLog tables
 * for the ops audit-review console. READ-ONLY by design: the write side is the
 * access-log Prisma extension; this service never creates/updates/deletes.
 *
 * Neither AccessLog nor AuthLog is a PHI_MODEL, so these reads are NOT
 * re-logged by the access-log extension (no recursion) and are untouched by the
 * soft-delete extension (which scopes to JournalEntry only).
 */
@Injectable()
export class AccessLogReadService {
  constructor(private readonly prisma: PrismaService) {}

  async listAccessLogs(query: ListAccessLogQuery) {
    const page = query.page ?? 1
    const limit = query.limit ?? 50
    const skip = (page - 1) * limit

    const where: Prisma.AccessLogWhereInput = {}
    if (query.actorId) where.actorId = query.actorId
    if (query.actorType) where.actorType = query.actorType
    if (query.action) where.action = query.action
    if (query.modelName) where.modelName = query.modelName
    if (query.recordId) where.recordId = query.recordId
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.accessLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.accessLog.count({ where }),
    ])
    return { data, total, page, limit }
  }

  async listAuthLogs(query: ListAuthLogQuery) {
    const page = query.page ?? 1
    const limit = query.limit ?? 50
    const skip = (page - 1) * limit

    const where: Prisma.AuthLogWhereInput = {}
    if (query.event) where.event = query.event
    if (query.userId) where.userId = query.userId
    if (query.identifier) {
      where.identifier = { contains: query.identifier, mode: 'insensitive' }
    }
    if (query.success != null) where.success = query.success === 'true'
    if (query.practiceContext) where.practiceContext = query.practiceContext
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.authLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.authLog.count({ where }),
    ])
    return { data, total, page, limit }
  }
}
