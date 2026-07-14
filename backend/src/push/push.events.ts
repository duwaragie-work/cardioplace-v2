/**
 * Internal event that carries a just-created PUSH-channel Notification to the
 * WebPushService. Emitted (fire-and-forget) by the push-dispatch Prisma
 * extension after `notification.create` succeeds, so every existing and future
 * PUSH call site is covered with zero call-site changes. Consumed by a single
 * `@OnEvent` handler whose async wrapper swallows errors — a failed push can
 * never propagate back into the notification write path.
 */
export const PUSH_EVENTS = {
  NOTIFICATION_CREATED: 'push.notification.created',
} as const

export interface PushNotificationCreatedEvent {
  userId: string
  title: string
  body: string
  notificationId: string
}
