/**
 * Bell-badge counting, extracted from Navbar so it can actually be tested.
 *
 * The rule that matters: the badge must count exactly what the /notifications
 * in-app inbox renders, or the two disagree. This previously counted PUSH rows
 * only, which silently dropped every DASHBOARD-channel row — including the
 * whole SUPPORT_* family. The visible symptom was that support could reply to a
 * patient and the bell never lit up, so the reply was only discoverable by
 * opening /notifications on spec.
 *
 * Mirrors the filter in app/notifications/page.tsx.
 */
export interface BadgeCountableNotification {
  channel?: string;
  title?: string;
  body?: string;
}

/** Content identity used to spot a PUSH row that duplicates a DASHBOARD one. */
const contentKey = (n: BadgeCountableNotification): string => `${n.title} ${n.body}`;

/**
 * How many notifications belong on the bell badge.
 *
 * - EMAIL rows are excluded: they're a delivery-tracking record, not an inbox item.
 * - A PUSH row whose content matches a DASHBOARD row is excluded, so one
 *   dual-dispatched notification counts once rather than twice.
 * - Everything else counts, DASHBOARD very much included.
 */
export function countInAppNotifications(
  notifications: BadgeCountableNotification[],
): number {
  const dashboardKeys = new Set(
    notifications.filter((n) => n.channel === 'DASHBOARD').map(contentKey),
  );
  return notifications.filter((n) => {
    if (n.channel === 'EMAIL') return false;
    if (n.channel === 'PUSH' && dashboardKeys.has(contentKey(n))) return false;
    return true;
  }).length;
}
