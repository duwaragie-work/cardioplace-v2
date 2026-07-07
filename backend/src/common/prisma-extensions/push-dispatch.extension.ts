import type { EventEmitter2 } from '@nestjs/event-emitter'
import { Prisma } from '../../generated/prisma/client.js'
import {
  PUSH_EVENTS,
  type PushNotificationCreatedEvent,
} from '../../push/push.events.js'

/**
 * Fires real out-of-app Web Push for PUSH-channel Notifications with ZERO
 * call-site changes — the same "one extension covers every write" approach the
 * audit extension uses. Wraps `notification.create`: after the row is persisted,
 * if its channel is PUSH it emits PUSH_EVENTS.NOTIFICATION_CREATED, which the
 * WebPushService's @OnEvent handler turns into a browser push.
 *
 * SAFETY: the emit is fire-and-forget and fully guarded — it runs AFTER
 * `query(args)` returns (so the row exists and any audit write already
 * happened) and any throw here is swallowed. A push failure can never affect
 * notification creation or the caller. EMAIL / DASHBOARD / PHONE rows are
 * untouched.
 *
 * KNOWN EDGE: a `notification.create` inside a transaction that later rolls back
 * would still have emitted — a rare, low-harm spurious push (the message was one
 * we intended to send anyway). Accepted for MVP; revisit if a rollback-heavy
 * PUSH path appears. `createMany` is deliberately NOT wrapped (it returns a
 * count, not rows); no PUSH path uses it today.
 */
export function pushDispatchExtension(eventEmitter: EventEmitter2) {
  return Prisma.defineExtension({
    name: 'push-dispatch',
    query: {
      notification: {
        async create({ args, query }) {
          const result = await query(args)
          try {
            const row = result as {
              id?: string
              userId?: string
              title?: string
              body?: string
              channel?: string
            } | null
            if (row && row.channel === 'PUSH' && row.userId && row.id) {
              const event: PushNotificationCreatedEvent = {
                userId: row.userId,
                title: row.title ?? '',
                body: row.body ?? '',
                notificationId: row.id,
              }
              eventEmitter.emit(PUSH_EVENTS.NOTIFICATION_CREATED, event)
            }
          } catch {
            // Dispatch must never affect the write path — swallow everything.
          }
          return result
        },
      },
    },
  })
}
