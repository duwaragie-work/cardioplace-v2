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
  /**
   * The notification's REAL copy — often clinical ("Angioedema alert
   * reviewed", "Lisinopril has been on hold for 45 days"). It rides this
   * in-process event only so a handler could log/route on it; WebPushService
   * deliberately DROPS it and pushes a fixed generic notice instead.
   *
   * Do NOT forward these to a device. A push renders on a locked phone with no
   * authentication, so clinical context here is PHI in the clear (HIPAA). The
   * real copy is shown in-app, behind auth, when the patient taps. See
   * web-push.service.ts `send`, which takes only the id by design.
   */
  title: string
  body: string
  notificationId: string
}
