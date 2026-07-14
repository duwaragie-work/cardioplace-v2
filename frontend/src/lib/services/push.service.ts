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

// Explicit per-device opt-out. Turning push OFF in Settings must STICK: browser
// permission stays `granted` after we unsubscribe, so without this flag the auto
// re-registration on the next page load would silently re-subscribe and pushes
// would keep coming. registerPush() honours this flag; enablePush() clears it.
const PUSH_OPTOUT_KEY = 'cp_push_optout';

function isOptedOut(): boolean {
  try {
    return localStorage.getItem(PUSH_OPTOUT_KEY) === '1';
  } catch {
    return false;
  }
}

function setOptedOut(value: boolean): void {
  try {
    if (value) localStorage.setItem(PUSH_OPTOUT_KEY, '1');
    else localStorage.removeItem(PUSH_OPTOUT_KEY);
  } catch {
    /* localStorage unavailable — opt-out just won't persist */
  }
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
  if (isOptedOut()) return; // user turned push OFF on this device — respect it
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

/** Live push state for this browser, for the Settings toggle. `permission` is
 *  the browser-level (per-site) choice; `subscribed` is whether THIS browser
 *  currently has an active push subscription. */
export interface PushStatus {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!supported()) {
    return { supported: false, permission: 'unsupported', subscribed: false };
  }
  // An explicit opt-out means OFF, even if a stale browser subscription lingers.
  if (isOptedOut()) {
    return { supported: true, permission: Notification.permission, subscribed: false };
  }
  let subscribed = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    subscribed = Boolean(await reg?.pushManager.getSubscription());
  } catch {
    subscribed = false;
  }
  return { supported: true, permission: Notification.permission, subscribed };
}

/** Outcome of an explicit user-initiated enable, so the UI can message it.
 *  Unlike registerPush() (silent, for auto-registration), this reports WHY it
 *  failed so Settings can guide the patient. */
export type PushEnableResult =
  | 'enabled'
  | 'denied' // user has blocked notifications at the browser level
  | 'unsupported' // browser/device can't do web push (e.g. iOS Safari in a tab)
  | 'unavailable' // push disabled server-side (no VAPID key)
  | 'error';

/**
 * User-initiated enable from Settings. Same ceremony as registerPush() but
 * returns a typed result instead of swallowing everything, so the toggle can
 * show "blocked — allow it in browser settings" vs "not supported" vs success.
 */
export async function enablePush(): Promise<PushEnableResult> {
  if (!supported()) return 'unsupported';
  // Explicit enable clears any prior opt-out so auto-registration works again.
  setOptedOut(false);
  try {
    const publicKey = await getVapidPublicKey();
    if (!publicKey) return 'unavailable';

    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return 'denied';
    } else if (Notification.permission === 'denied') {
      return 'denied';
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
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return 'error';

    const res = await fetchWithAuth(`${API}/api/v2/push/subscribe`, {
      method: 'POST',
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      }),
    });
    return res.ok ? 'enabled' : 'error';
  } catch {
    return 'error';
  }
}

/** Drop this browser's subscription (call on logout, or from the Settings
 *  toggle). Best-effort. */
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

/**
 * User-initiated turn-OFF from Settings. Unlike unsubscribePush() (used on
 * logout), this records a per-device opt-out FIRST so auto-registration won't
 * silently re-subscribe on the next page load — the reason "turn off" appeared
 * to do nothing. Then it drops the subscription. Idempotent, never throws.
 */
export async function disablePush(): Promise<void> {
  setOptedOut(true);
  await unsubscribePush();
}
