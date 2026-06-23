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

export interface RegisterBiometricResult {
  id: string;
  deviceName: string | null;
  /** Present ONLY on the first passkey — the account-wide recovery codes to
   *  show + save once. Omitted when adding a 2nd/3rd device. */
  recoveryCodes?: string[];
}

/**
 * Run the full enable-biometric ceremony: fetch options → prompt Face ID /
 * fingerprint → persist the credential. Throws a friendly Error on cancel or
 * failure. On the first passkey, the result carries the recovery codes.
 */
export async function registerBiometric(
  deviceName?: string,
): Promise<RegisterBiometricResult> {
  const startRes = await fetchWithAuth(
    `${API_URL}/api/v2/auth/webauthn/register/start`,
    { method: 'POST', body: '{}' },
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

  const verifyRes = await fetchWithAuth(
    `${API_URL}/api/v2/auth/webauthn/register/verify`,
    {
      method: 'POST',
      body: JSON.stringify({
        registrationToken,
        response: attestation,
        deviceName: deviceName ?? describeThisDevice(),
      }),
    },
  );
  const verifyData = await readJson(verifyRes);
  if (!verifyRes.ok) {
    throw new Error(messageFrom(verifyData, 'Biometric setup could not be saved.'));
  }
  return verifyData as unknown as RegisterBiometricResult;
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
 *  this device. Consumes a code and signs in. The response carries a freshly
 *  regenerated set of codes (`recoveryCodes`) to show + save once. */
export async function signInWithRecoveryCode(
  challengeToken: string,
  recoveryCode: string,
): Promise<OtpVerifyResponse & { recoveryCodes: string[] }> {
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
  return data as unknown as OtpVerifyResponse & { recoveryCodes: string[] };
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
