/* Cardioplace patient service worker — PUSH ONLY.
 *
 * Deliberately has NO `fetch` handler and does NO caching, so it cannot affect
 * normal app loading/navigation. It exists solely to receive Web Push messages
 * (so a PUSH-channel Notification reaches the patient with the app closed) and
 * to focus/open the app when the notification is clicked.
 */

/* Take over from a previously-installed worker straight away, instead of idling
 * in `waiting` until every open tab is closed — patients who enabled push before
 * this version would otherwise keep running the old worker (no urgent
 * stickiness, no tap-routing) for days.
 *
 * `skipWaiting` is normally risky because a new worker can take control of a
 * page still running assets the OLD worker cached. Safe here specifically
 * because this worker has no `fetch` handler and caches nothing — there is no
 * asset version to mismatch.
 *
 * NOT a PHI safeguard: the lock-screen copy is scrubbed server-side, so even a
 * stale worker renders only the generic notice. This is purely so the UX fixes
 * land promptly.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/* HIPAA — lock-screen safety: the payload the server sends is already generic
 * (fixed title/body, no clinical context — see web-push.service.ts). This
 * worker renders exactly what it receives and never fetches or derives extra
 * detail, so nothing clinical can reach a locked screen. The real copy lives
 * in-app, behind auth, and is reached by tapping.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = data.title || 'Cardioplace';
  const urgent = data.urgent === true;
  const options = {
    // Notification icons must be raster (PNG) — browsers render SVG icons as
    // blank. Icon = the app mark; badge = the small monochrome status-bar glyph.
    body: data.body || '',
    icon: '/cardioplace-icon-192.png',
    // badge: '/cardioplace-badge-96.png',
    // Urgent = a BP Level 2 / Tier 1 alert. Make it sticky so it can't be
    // silently swiped past, and buzz a distinct pattern — the copy is
    // deliberately vague, so the PHONE has to convey "act now". Neither the
    // flag nor the vibration reveals WHAT is wrong.
    requireInteraction: urgent,
    vibrate: urgent ? [200, 100, 200, 100, 200] : [200],
    // Urgent pushes get their own tag so a later routine push can't collapse
    // over an unread emergency.
    tag: urgent ? 'cardioplace-urgent' : 'cardioplace-update',
    renotify: urgent,
    data: {
      notificationId: data.notificationId || null,
      // Server-routed: alert-linked pushes go to the alert detail, everything
      // else to the bell. The server picks it because only the server knows
      // which stream the notification renders in.
      path: data.path || '/notifications?tab=notifications',
    },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

const FALLBACK_TARGET = '/notifications?tab=notifications';

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // The notice itself says nothing about what happened, so the tap is the ONLY
  // way the patient learns why they were pinged — it has to land on the right
  // page, not the home page.
  const target = (event.notification.data && event.notification.data.path) || FALLBACK_TARGET;
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing tab if the app is already open, else open one.
        for (const client of clientList) {
          if ('focus' in client) {
            // Focus alone would strand the patient on whatever page they had
            // open, with no idea why the phone buzzed — steer the tab too.
            return 'navigate' in client
              ? client.navigate(target).then((c) => (c || client).focus())
              : client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(target);
        }
      }),
  );
});
