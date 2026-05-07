import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import type { Request } from 'express'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js'
import { DrugEnrichmentService } from './drug-enrichment.service.js'

const MAX_DAILY_PER_USER = 60
const counter = new Map<string, { dayKey: string; count: number }>()

function dayKey(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD UTC
}

@Controller('v2/medications')
@UseGuards(JwtAuthGuard)
export class DrugEnrichmentController {
  private readonly logger = new Logger(DrugEnrichmentController.name)

  constructor(private readonly enrichment: DrugEnrichmentService) {}

  @Post('enrich')
  async enrich(
    @Body() body: { drugName?: unknown; locale?: unknown },
    @Req() req: Request,
  ) {
    const drugName = typeof body?.drugName === 'string' ? body.drugName.trim() : ''
    if (!drugName) throw new BadRequestException('drugName is required')
    if (drugName.length > 200) throw new BadRequestException('drugName too long')

    const locale = typeof body?.locale === 'string' ? body.locale : 'en'

    const userId = (req.user as { id: string } | undefined)?.id
    if (!userId) throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED)

    const today = dayKey()
    const entry = counter.get(userId)
    if (entry && entry.dayKey === today && entry.count >= MAX_DAILY_PER_USER) {
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'Daily enrichment limit reached' },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
    if (!entry || entry.dayKey !== today) {
      counter.set(userId, { dayKey: today, count: 1 })
    } else {
      entry.count += 1
    }

    return await this.enrichment.enrich(drugName, locale)
  }
}
