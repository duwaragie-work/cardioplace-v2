import { Controller, Get, Req } from '@nestjs/common'
import type { Request } from 'express'
import { ThresholdService } from './threshold.service.js'

type AuthedReq = Request & { user: { id: string } }

/**
 * Patient-facing read of their own threshold. Returns `null` (not 404) when
 * no threshold has been set yet — the dashboard uses that to decide whether
 * to render the "Your goal" card (Flow D, D2).
 *
 * Authoring routes stay on the admin-only ThresholdController per spec.
 */
@Controller('me/threshold')
export class MeThresholdController {
  constructor(private readonly service: ThresholdService) {}

  @Get()
  findMine(@Req() req: AuthedReq) {
    return this.service.findByPatientOrNull(req.user.id)
  }
}
