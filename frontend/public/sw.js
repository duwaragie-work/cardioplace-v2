/* Cardioplace patient service worker — PUSH ONLY.
 *
 * Deliberately has NO `fetch` handler and does NO caching, so it cannot affect
 * normal app loading/navigation. It exists solely to receive Web Push messages
 * (so a PUSH-channel Notification reaches the patient with the app closed) and
 * to focus/open the app when the notification is clicked.
 */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = data.title || 'Cardioplace';
  const options = {
    // Notification icons must be raster (PNG) — browsers render SVG icons as
    // blank. Icon = the app mark; badge = the small monochrome status-bar glyph.
    body: data.body || '',
    icon: '/cardioplace-icon-192.png',
    // badge: '/cardioplace-badge-96.png',
    data: { notificationId: data.notificationId || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing tab if the app is already open, else open one.
        for (const client of clientList) {
          if ('focus' in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow('/');
      }),
  );
});
