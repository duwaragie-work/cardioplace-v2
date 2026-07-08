// Web Push registration for the patient app. Registers the push-only service
// worker, subscribes the browser, and stores the subscription per user on the
// backend so PUSH-channel Notifications reach the patient with the app closed.
//
// Every entry point is defensive and NEVER throws: unsupported browser, denied
// permission, push disabled server-side (no VAPID key), or a network error all
// resolve quietly. Push is an enhancement — it must never break the app.
import { fetchWithAuth } from './token';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const SW_URL = '/sw.js';

function supported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// VAPID public key arrives base64url-encoded; the Push API wants a Uint8Array
// backed by a plain ArrayBuffer (not SharedArrayBuffer) for applicationServerKey.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function getVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetchWithAuth(`${API}/api/v2/push/vapid-public-key`);
    if (!res.ok) return null;
    const data = (await res.json()) as { publicKey?: string | null };
    return data.publicKey ?? null;
  } catch {
    return null;
  }
}

/**
 * Register the SW + subscribe this browser, then persist the subscription.
 * Call after the patient is authenticated. Safe to call repeatedly — the SW
 * registration and the backend upsert are both idempotent.
 */
export async function registerPush(): Promise<void> {
  if (!supported()) return;
  try {
    const publicKey = await getVapidPublicKey();
    if (!publicKey) return; // push disabled server-side — nothing to do

    // Only prompt when the user hasn't already decided. A denied permission
    // stays denied until the user changes it in browser settings.
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;
    } else if (Notification.permission !== 'granted') {
      return;
    }

    const reg = await navigator.serviceWorker.register(SW_URL);
    await navigator.serviceWorker.ready;

    const existing = await reg.pushManager.getSubscription();
    const subscription =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));

    const json = subscription.toJSON() as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;

    await fetchWithAuth(`${API}/api/v2/push/subscribe`, {
      method: 'POST',
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      }),
    });
  } catch {
    // Push is best-effort — swallow everything.
  }
}

/** Drop this browser's subscription (call on logout). Best-effort. */
export async function unsubscribePush(): Promise<void> {
  if (!supported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    const subscription = await reg?.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe().catch(() => undefined);
    await fetchWithAuth(`${API}/api/v2/push/unsubscribe`, {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    });
  } catch {
    // best-effort
  }
}
