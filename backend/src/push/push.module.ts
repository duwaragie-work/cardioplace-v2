import { Global, Module } from '@nestjs/common'
import { PushController } from './push.controller.js'
import { WebPushService } from './web-push.service.js'

/**
 * Web Push transport. Global so WebPushService can be injected anywhere that
 * wants to push directly (like EmailModule), though the primary dispatch path
 * is the push-dispatch Prisma extension → PUSH_EVENTS.NOTIFICATION_CREATED →
 * WebPushService's @OnEvent handler.
 */
@Global()
@Module({
  controllers: [PushController],
  providers: [WebPushService],
  exports: [WebPushService],
})
export class PushModule {}
