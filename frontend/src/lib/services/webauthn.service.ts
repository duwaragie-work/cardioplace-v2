// Patient biometric (WebAuthn / passkeys — Face ID / fingerprint).
// Optional second factor layered on top of OTP / magic-link. This wraps the
// backend endpoints + the @simplewebauthn/browser ceremony, and gracefully
// no-ops on devices without a platform authenticator.
//
// Backend controller: backend/src/auth/auth.controller.ts
//   POST /api/v2/auth/webauthn/register/start          (authenticated)
//   POST /api/v2/auth/webauthn/register/verify         (authenticated)
//   POST /api/v2/auth/webauthn/authenticate/options    (public, post-OTP)
//   POST /api/v2/auth/webauthn/authenticate/verify     (public, post-OTP)
//   POST /api/v2/auth/webauthn/authenticate/recover    (public, post-OTP)
//   GET    /api/v2/auth/webauthn/credentials           (authenticated)
//   DELETE /api/v2/auth/webauthn/credentials/:id       (authenticated)

import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import type { OtpVerifyResponse } from '@/lib/auth-context';
import { fetchWithAuth } from './token';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

/** sessionStorage key the sign-in page stashes the challenge token under before
 *  routing to /sign-in/biometric. Tab-scoped, survives a refresh. */
export const WEBAUTHN_CHALLENGE_STORAGE_KEY = 'cp_patient_webauthn_challenge';

export interface WebAuthnCredentialRow {
  id: string;
  /** The authenticator's public credential id — lets the FE recognise "this
   *  device" by matching it against the locally-remembered ids. */
  credentialId: string;
  deviceName: string | null;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function messageFrom(data: Record<string, unknown>, fallback: string): string {
  const m = data.message;
  if (typeof m === 'string' && m) return m;
  if (Array.isArray(m) && typeof m[0] === 'string') return m[0];
  return fallback;
}

/** True only when the browser supports WebAuthn AND the device has a built-in
 *  biometric (Touch ID / Face ID / Windows Hello / Android fingerprint). On
 *  anything else this returns false so the UI hides the option entirely. */
export async function isBiometricSupported(): Promise<boolean> {
  try {
    if (!browserSupportsWebAuthn()) return false;
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

/** A short, human-friendly label for the current device, used as the default
 *  name when registering. Best-effort from the user agent. */
export function describeThisDevice(): string {
  if (typeof navigator === 'undefined') return 'This device';
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android device';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows device';
  return 'This device';
}

// ─── Registration (authenticated — from settings) ─────────────────────────────

/** 'platform' = register THIS device's Face ID / fingerprint.
 *  'cross-platform' = register ANOTHER device via the browser's QR flow. */
export type RegisterMode = 'platform' | 'cross-platform';

/** Max passkeys a patient can register. */
export const MAX_BIOMETRIC_DEVICES = 3;

/** localStorage of **credentialId**s that belong to THIS device — lets Settings
 *  hide "Set up this device" once it's done. WebAuthn doesn't tell the page
 *  which list entry is the current device, so we remember it ourselves: on a
 *  successful platform registration AND on every successful biometric login on
 *  this device (so already-registered devices are recognised too). */
const THIS_DEVICE_KEY = 'cp_patient_webauthn_this_device';

export function getThisDeviceCredentialIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(THIS_DEVICE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** Remember a credentialId as belonging to this device. */
function rememberThisDeviceCredential(credentialId: string) {
  try {
    const ids = new Set(getThisDeviceCredentialIds());
    ids.add(credentialId);
    localStorage.setItem(THIS_DEVICE_KEY, JSON.stringify([...ids]));
  } catch {
    /* localStorage unavailable — detection just falls back to showing the button */
  }
}

export interface RegisterBiometricResult {
  id: string;
  deviceName: string | null;
  /** Present ONLY on the first passkey — the account-wide recovery codes to
   *  show + save once. Omitted when adding a 2nd/3rd device. */
  recoveryCodes?: string[];
}

/**
 * Run the full enable-biometric ceremony: fetch options → prompt → persist.
 * `mode` 'platform' registers THIS device (Face ID / fingerprint); on success
 * we remember it locally so the button can hide. `mode` 'cross-platform' lets
 * the browser offer the QR / use-a-phone flow to register ANOTHER device.
 * Throws a friendly Error on cancel/failure; first passkey carries recovery codes.
 */
export async function registerBiometric(
  mode: RegisterMode = 'platform',
  deviceName?: string,
): Promise<RegisterBiometricResult> {
  const startRes = await fetchWithAuth(
    `${API_URL}/api/v2/auth/webauthn/register/start`,
    { method: 'POST', body: JSON.stringify({ mode }) },
  );
  const startData = await readJson(startRes);
  if (!startRes.ok) {
    throw new Error(messageFrom(startData, 'Could not start biometric setup.'));
  }
  const { options, registrationToken } = startData as unknown as {
    options: PublicKeyCredentialCreationOptionsJSON;
    registrationToken: string;
  };

  let attestation;
  try {
    attestation = await startRegistration({ optionsJSON: options });
  } catch (err) {
    throw toCeremonyError(err, 'register');
  }

  // Name it. For a 'platform' passkey it's THIS device, so the user-agent is
  // accurate. For 'cross-platform' the passkey was created on ANOTHER device
  // (via QR) that the browser can't identify — so use a generic label, since
  // sniffing the current browser would mislabel it (e.g. "Windows device" for
  // a passkey that's actually on an Android phone).
  const resolvedName =
    deviceName ??
    (mode === 'cross-platform' ? 'Phone or tablet' : describeThisDevice());

  const verifyRes = await fetchWithAuth(
    `${API_URL}/api/v2/auth/webauthn/register/verify`,
    {
      method: 'POST',
      body: JSON.stringify({
        registrationToken,
        response: attestation,
        deviceName: resolvedName,
      }),
    },
  );
  const verifyData = await readJson(verifyRes);
  if (!verifyRes.ok) {
    throw new Error(messageFrom(verifyData, 'Biometric setup could not be saved.'));
  }
  const result = verifyData as unknown as RegisterBiometricResult;
  // Only a 'platform' passkey lives on THIS device — remember its credentialId
  // so Settings can hide the "set up this device" button. A 'cross-platform'
  // one was just created on a different device, so we don't mark it here.
  if (mode === 'platform') rememberThisDeviceCredential(attestation.id);
  return result;
}

/** List the patient's registered biometric devices. */
export async function listBiometricCredentials(): Promise<
  WebAuthnCredentialRow[]
> {
  const res = await fetchWithAuth(
    `${API_URL}/api/v2/auth/webauthn/credentials`,
  );
  if (!res.ok) {
    const data = await readJson(res);
    throw new Error(messageFrom(data, 'Could not load your devices.'));
  }
  return (await res.json()) as WebAuthnCredentialRow[];
}

/** Rename a registered device (cosmetic label only). */
export async function renameBiometricCredential(
  id: string,
  deviceName: string,
): Promise<void> {
  const res = await fetchWithAuth(
    `${API_URL}/api/v2/auth/webauthn/credentials/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ deviceName: deviceName.trim() }) },
  );
  if (!res.ok) {
    const data = await readJson(res);
    throw new Error(messageFrom(data, 'Could not rename this device.'));
  }
}

/** Remove (disable) a registered device. */
export async function deleteBiometricCredential(id: string): Promise<void> {
  const res = await fetchWithAuth(
    `${API_URL}/api/v2/auth/webauthn/credentials/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    const data = await readJson(res);
    throw new Error(messageFrom(data, 'Could not remove this device.'));
  }
}

// ─── Sign-in second factor (pre-token, public) ────────────────────────────────

/** Run the full biometric sign-in ceremony: fetch options → prompt → verify.
 *  Returns the auth response (tokens) on success. Throws a friendly Error
 *  (with `.code` set for cancel / no-credential) otherwise. */
export async function authenticateBiometric(
  challengeToken: string,
): Promise<OtpVerifyResponse> {
  const optsRes = await fetch(
    `${API_URL}/api/v2/auth/webauthn/authenticate/options`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken }),
    },
  );
  const optsData = await readJson(optsRes);
  if (!optsRes.ok) {
    throw new Error(messageFrom(optsData, 'Your sign-in session expired.'));
  }

  let assertion;
  try {
    assertion = await startAuthentication({
      optionsJSON: optsData as unknown as PublicKeyCredentialRequestOptionsJSON,
    });
  } catch (err) {
    throw toCeremonyError(err, 'authenticate');
  }
  // This passkey is on THIS device — remember it so Settings recognises the
  // device (covers devices registered before this tracking existed).
  rememberThisDeviceCredential(assertion.id);

  const verifyRes = await fetch(
    `${API_URL}/api/v2/auth/webauthn/authenticate/verify`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken, response: assertion }),
    },
  );
  const verifyData = await readJson(verifyRes);
  if (!verifyRes.ok) {
    throw new Error(messageFrom(verifyData, 'Biometric verification failed.'));
  }
  return verifyData as unknown as OtpVerifyResponse;
}

/** Recovery-code sign-in — the only fallback when biometric can't be used on
 *  this device. Consumes ONLY the one code; the rest stay valid. The response
 *  carries `recoveryRemaining` so we can tell the patient how many are left. */
export async function signInWithRecoveryCode(
  challengeToken: string,
  recoveryCode: string,
): Promise<OtpVerifyResponse & { recoveryRemaining: number }> {
  const res = await fetch(
    `${API_URL}/api/v2/auth/webauthn/authenticate/recovery`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken, recoveryCode: recoveryCode.trim() }),
    },
  );
  const data = await readJson(res);
  if (!res.ok) {
    throw new Error(messageFrom(data, 'Invalid or already-used recovery code.'));
  }
  return data as unknown as OtpVerifyResponse & { recoveryRemaining: number };
}

// ─── Recovery codes management (authenticated — Settings) ─────────────────────

export interface RecoveryStatus {
  remaining: number;
  hasBiometric: boolean;
}

/** How many backup codes remain + whether biometric is set up. */
export async function getRecoveryStatus(): Promise<RecoveryStatus> {
  const res = await fetchWithAuth(
    `${API_URL}/api/v2/auth/webauthn/recovery-codes`,
  );
  if (!res.ok) {
    const data = await readJson(res);
    throw new Error(messageFrom(data, 'Could not load recovery status.'));
  }
  return (await res.json()) as RecoveryStatus;
}

/** Regenerate the recovery codes (invalidates the old set). Returns the new
 *  codes to show + save once. */
export async function regenerateRecoveryCodes(): Promise<string[]> {
  const res = await fetchWithAuth(
    `${API_URL}/api/v2/auth/webauthn/recovery-codes/regenerate`,
    { method: 'POST', body: '{}' },
  );
  const data = await readJson(res);
  if (!res.ok) {
    throw new Error(messageFrom(data, 'Could not generate new recovery codes.'));
  }
  return (data as { recoveryCodes: string[] }).recoveryCodes;
}

/** Normalize a browser ceremony error into a friendly Error. A cancelled /
 *  unavailable prompt (NotAllowedError) is the common case — flagged with
 *  `.code = 'cancelled'` so callers can offer the right fallback. */
function toCeremonyError(
  err: unknown,
  phase: 'register' | 'authenticate',
): Error & { code?: string } {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'AbortError') {
    const e = new Error(
      phase === 'register'
        ? 'Setup was cancelled or timed out. Please try again.'
        : 'Biometric was cancelled or is not available on this device.',
    ) as Error & { code?: string };
    e.code = 'cancelled';
    return e;
  }
  if (name === 'InvalidStateError') {
    const e = new Error('This device is already set up.') as Error & {
      code?: string;
    };
    e.code = 'already_registered';
    return e;
  }
  const e = new Error(
    err instanceof Error ? err.message : 'Something went wrong.',
  ) as Error & { code?: string };
  e.code = 'error';
  return e;
}
