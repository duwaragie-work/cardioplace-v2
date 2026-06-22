import { Controller, Get, Req } from '@nestjs/common'
import type { Request } from 'express'
import { ProfileNotFoundException } from '@cardioplace/shared'
import { ThresholdService } from './threshold.service.js'
import { ProfileResolverService } from '../daily_journal/services/profile-resolver.service.js'

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
  constructor(
    private readonly service: ThresholdService,
    private readonly profileResolver: ProfileResolverService,
  ) {}

  @Get()
  findMine(@Req() req: AuthedReq) {
    return this.service.findByPatientOrNull(req.user.id)
  }

  /**
   * Item C / Bug 24 — the EFFECTIVE high-alert threshold (pregnancy / HFrEF /
   * CAD overrides applied on top of any custom threshold), so the dashboard
   * shows the same alert point the engine uses. Returns null data when the
   * patient has no clinical profile yet (the dashboard hides the goal card).
   */
  @Get('effective')
  async findMineEffective(@Req() req: AuthedReq) {
    try {
      const data = await this.profileResolver.getEffectiveThreshold(req.user.id)
      return { statusCode: 200, message: 'Effective threshold computed', data }
    } catch (err) {
      if (err instanceof ProfileNotFoundException) {
        return { statusCode: 200, message: 'No clinical profile yet', data: null }
      }
      throw err
    }
  }
}
