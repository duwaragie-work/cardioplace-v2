import { Body, Controller, Get, Post, Req } from '@nestjs/common'
import type { Request } from 'express'
import type { UserRole } from '../generated/prisma/enums.js'
import { SubscribeDto, UnsubscribeDto } from './dto/push-subscription.dto.js'
import { WebPushService } from './web-push.service.js'

type AuthedReq = Request & {
  user: { id: string; email: string | null; roles: UserRole[] }
}

/**
 * Web Push subscription management for the patient app. Mounted at
 * `/api/v2/push/*`. JwtAuthGuard is a global APP_GUARD, so every route here
 * requires a signed-in session — a subscription is always tied to the current
 * user (`req.user.id`), never trusted from the body.
 */
@Controller('v2/push')
export class PushController {
  constructor(private readonly webPush: WebPushService) {}

  /** VAPID public key the browser needs to build a PushSubscription. */
  @Get('vapid-public-key')
  vapidPublicKey(): { publicKey: string | null } {
    return { publicKey: this.webPush.getPublicKey() ?? null }
  }

  /** Register (or refresh) this browser's push subscription for the user. */
  @Post('subscribe')
  async subscribe(
    @Req() req: AuthedReq,
    @Body() dto: SubscribeDto,
  ): Promise<{ ok: true }> {
    await this.webPush.saveSubscription(
      req.user.id,
      { endpoint: dto.endpoint, keys: dto.keys },
      req.headers['user-agent'],
    )
    return { ok: true }
  }

  /** Drop this browser's subscription (logout / permission revoked). */
  @Post('unsubscribe')
  async unsubscribe(@Body() dto: UnsubscribeDto): Promise<{ ok: true }> {
    await this.webPush.deleteSubscription(dto.endpoint)
    return { ok: true }
  }
}
