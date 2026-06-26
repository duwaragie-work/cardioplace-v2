// Provider/admin TOTP MFA service (Manisha 2026-06-12 Access Control §6).
// Wraps the backend MFA endpoints. Two auth shapes:
//   • enroll/start + enroll/complete + admin reset run POST-first-factor, so
//     they go through fetchWithAuth (bearer + cookie attached automatically).
//   • challenge + recovery run PRE-token (the user only holds the short-lived
//     challenge token), so they use a plain credentialed fetch.
//
// Backend controller: backend/src/auth/auth.controller.ts
//   POST /api/v2/auth/mfa/enroll/start
//   POST /api/v2/auth/mfa/enroll/complete
//   POST /api/v2/auth/mfa/challenge          (public)
//   POST /api/v2/auth/mfa/recovery           (public)
//   POST /api/v2/auth/admin/mfa/reset/:userId

import type { AdminAuthResponse } from '@/lib/auth-context';
import { fetchWithAuth } from './token';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

/** Discriminated response the verify-OTP / select-practice / magic-link
 *  endpoints return when an enrolled provider/admin must clear MFA before
 *  tokens are issued. */
export type MfaRequiredResponse = {
  status: 'MFA_REQUIRED';
  challengeToken: string;
};

/** Returned by /mfa/challenge and /mfa/recovery for a MULTI-practice provider:
 *  the second factor is cleared, but they must still pick a practice before
 *  tokens are issued. The FE stashes this and routes to /sign-in/select-practice. */
export type PracticeSelectResponse = {
  status: 'PRACTICE_SELECT_REQUIRED';
  challengeToken: string;
  practices: Array<{ id: string; name: string }>;
};

export type EnrollStartResponse = {
  provisioningUri: string;
  qrCodeDataUrl: string;
  enrollmentToken: string;
};

export type EnrollCompleteResponse = {
  recoveryCodes: string[];
};

/** sessionStorage key the sign-in / select-practice pages stash the challenge
 *  token under before routing to /sign-in/mfa-challenge. Tab-scoped, survives
 *  a refresh, cleared once tokens are issued. */
export const MFA_CHALLENGE_STORAGE_KEY = 'cp_admin_mfa_challenge';

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

// ─── Enrollment (authenticated) ───────────────────────────────────────────────

/** Step 1 — generate a secret + QR. The secret is never persisted; it rides
 *  back inside the signed enrollmentToken until the first code is verified. */
export async function startEnrollment(): Promise<EnrollStartResponse> {
  const res = await fetchWithAuth(`${API_URL}/api/v2/auth/mfa/enroll/start`, {
    method: 'POST',
    body: '{}',
  });
  const data = await readJson(res);
  if (!res.ok) {
    throw new Error(messageFrom(data, 'Could not start MFA setup.'));
  }
  return data as unknown as EnrollStartResponse;
}

/** Step 2 — verify the first code, persist the encrypted secret, and receive
 *  the one-time recovery codes (shown to the user exactly once). */
export async function completeEnrollment(
  enrollmentToken: string,
  code: string,
): Promise<EnrollCompleteResponse> {
  const res = await fetchWithAuth(`${API_URL}/api/v2/auth/mfa/enroll/complete`, {
    method: 'POST',
    body: JSON.stringify({ enrollmentToken, code }),
  });
  const data = await readJson(res);
  if (!res.ok) {
    throw new Error(messageFrom(data, 'That code was not accepted.'));
  }
  return data as unknown as EnrollCompleteResponse;
}

/** Generate a fresh set of recovery codes for the enrolled user, invalidating
 *  all prior codes. Returns the new codes once (shown for copy/download). */
export async function regenerateRecoveryCodes(): Promise<EnrollCompleteResponse> {
  const res = await fetchWithAuth(
    `${API_URL}/api/v2/auth/mfa/recovery-codes/regenerate`,
    {
      method: 'POST',
      body: '{}',
    },
  );
  const data = await readJson(res);
  if (!res.ok) {
    throw new Error(messageFrom(data, 'Could not generate new recovery codes.'));
  }
  return data as unknown as EnrollCompleteResponse;
}

// ─── Sign-in second factor (pre-token, public) ────────────────────────────────

/** Exchange the challenge token + 6-digit TOTP code for the real token pair. */
export async function verifyChallenge(
  challengeToken: string,
  code: string,
): Promise<AdminAuthResponse | PracticeSelectResponse> {
  const res = await fetch(`${API_URL}/api/v2/auth/mfa/challenge`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeToken, code }),
  });
  const data = await readJson(res);
  if (!res.ok) {
    const err = new Error(messageFrom(data, 'Invalid code.')) as Error & {
      errorCode?: string;
    };
    err.errorCode =
      typeof data.errorCode === 'string' ? data.errorCode : undefined;
    throw err;
  }
  return data as unknown as AdminAuthResponse | PracticeSelectResponse;
}

/** Sign in with a one-time recovery code. Standard backup login — the code is
 *  consumed but the authenticator is left intact (no reset / re-enroll). */
export async function verifyRecovery(
  challengeToken: string,
  recoveryCode: string,
): Promise<AdminAuthResponse | PracticeSelectResponse> {
  const res = await fetch(`${API_URL}/api/v2/auth/mfa/recovery`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeToken, recoveryCode }),
  });
  const data = await readJson(res);
  if (!res.ok) {
    throw new Error(messageFrom(data, 'Invalid or already-used recovery code.'));
  }
  return data as unknown as AdminAuthResponse | PracticeSelectResponse;
}

// ─── Admin reset (authenticated, SUPER_ADMIN / HEALPLACE_OPS) ──────────────────

/** Wipe a user's MFA so they re-enroll on next sign-in. Reason is required and
 *  audited. The backend blocks self-reset. */
export async function resetUserMfa(
  userId: string,
  reason: string,
): Promise<{ message: string }> {
  const res = await fetchWithAuth(
    `${API_URL}/api/v2/auth/admin/mfa/reset/${encodeURIComponent(userId)}`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  );
  const data = await readJson(res);
  if (!res.ok) {
    throw new Error(messageFrom(data, 'Could not reset MFA for this user.'));
  }
  return data as unknown as { message: string };
}

/** Wipe a patient's biometric (Face ID / fingerprint) + recovery codes so they
 *  re-enroll on next sign-in. For the lost-both support case. Reason audited. */
export async function resetPatientBiometric(
  userId: string,
  reason: string,
): Promise<{ message: string }> {
  const res = await fetchWithAuth(
    `${API_URL}/api/v2/auth/admin/webauthn/reset/${encodeURIComponent(userId)}`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  );
  const data = await readJson(res);
  if (!res.ok) {
    throw new Error(messageFrom(data, 'Could not reset biometric for this user.'));
  }
  return data as unknown as { message: string };
}
