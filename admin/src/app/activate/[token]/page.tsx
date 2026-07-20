'use client';

// Invite-activation landing page (admin app). Mirror of the patient app's
// /activate/[token] page — same backend contract, different post-claim
// destination (/dashboard always; admin has no /onboarding flow).
//
// The route is public (see proxy.ts) because the invitee has no session yet.

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { useAuth, type AdminAuthResponse } from '@/lib/auth-context';
import { stashSignInEmail } from '@/lib/signin-prefill';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface InvitePreview {
  email: string;
  name: string;
  role: string;
  practiceName: string | null;
  expiresAt: string;
}

interface PageProps {
  params: Promise<{ token: string }>;
}

const ROLE_LABEL: Record<string, string> = {
  PATIENT: 'Patient',
  COORDINATOR: 'Care Coordinator',
  PROVIDER: 'Provider',
  MEDICAL_DIRECTOR: 'Medical Director',
  HEALPLACE_OPS: 'Healplace Ops',
  SUPER_ADMIN: 'Super Admin',
};

export default function ActivateInvitePage({ params }: PageProps) {
  const { token } = use(params);
  const router = useRouter();
  const { login } = useAuth();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/v2/auth/invite/${encodeURIComponent(token)}`, {
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(
            res.status === 400
              ? 'This invite link is invalid or expired.'
              : `Could not load invite (${res.status})`,
          );
        }
        return res.json() as Promise<InvitePreview>;
      })
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setLoadError(
            err instanceof Error ? err.message : 'Could not load invite.',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleActivate() {
    setActivating(true);
    setActivateError(null);
    try {
      const res = await fetch(
        `${API_URL}/api/v2/auth/invite/${encodeURIComponent(token)}/accept`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        let msg = `Could not activate (${res.status})`;
        try {
          const body = (await res.json()) as { message?: string };
          if (body?.message) msg = body.message;
        } catch {
          // swallow JSON parse errors — keep the status-based message
        }
        throw new Error(msg);
      }
      const data = (await res.json()) as
        | AdminAuthResponse
        | { status: 'SIGN_IN_REQUIRED' };
      // Admin invitees are activated but NOT auto-logged-in — they must sign
      // in via OTP (then MFA), so don't persist any session locally. Send
      // them to the sign-in page with their email prefilled.
      if ('status' in data && data.status === 'SIGN_IN_REQUIRED') {
        // 1.6 — email prefill via sessionStorage, not the URL. `activated=1`
        // is a benign non-PII flag and stays in the query string.
        stashSignInEmail(preview?.email ?? '');
        window.location.href = '/sign-in?activated=1';
        return;
      }
      login(data as AdminAuthResponse);
      window.location.href = '/dashboard';
    } catch (err: unknown) {
      setActivateError(
        err instanceof Error ? err.message : 'Could not activate account.',
      );
      setActivating(false);
    }
  }

  if (!preview && !loadError) {
    return (
      <div className="h-[100dvh] overflow-hidden flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#7B00E0] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-lg text-[#374151]">Loading your invitation…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="h-[100dvh] overflow-hidden flex items-center justify-center bg-white px-4">
        <div className="text-center max-w-md">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: 'var(--brand-alert-red-light)' }}
          >
            <ShieldAlert
              className="w-8 h-8"
              style={{ color: 'var(--brand-alert-red-text)' }}
            />
          </div>
          <h2 className="text-xl font-bold text-[#170c1d] mb-2">
            Invitation link invalid
          </h2>
          <p className="text-[#6b7280] mb-6">{loadError}</p>
          <button
            type="button"
            onClick={() => router.push('/sign-in')}
            className="px-8 py-3 bg-[#7B00E0] text-white rounded-full font-semibold hover:bg-[#6600BC] transition-colors cursor-pointer"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  const expiresAt = new Date(preview!.expiresAt);
  const expiresLabel = Number.isNaN(expiresAt.getTime())
    ? '—'
    : expiresAt.toLocaleString();

  return (
    <div
      className="h-[100dvh] overflow-hidden flex items-center justify-center px-4 py-4"
      style={{ backgroundColor: 'var(--brand-background, #FAFBFF)' }}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl p-6 sm:p-8"
        style={{ boxShadow: 'var(--brand-shadow-card, 0 1px 20px rgba(123,0,224,0.07))' }}
      >
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5"
          style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
        >
          <CheckCircle2 className="w-7 h-7 text-white" />
        </div>

        <h1
          className="text-2xl font-bold text-center mb-2"
          style={{ color: 'var(--brand-text-primary, #170c1d)' }}
        >
          Activate your Cardioplace account
        </h1>
        <p
          className="text-sm text-center mb-6"
          style={{ color: 'var(--brand-text-muted, #6b7280)' }}
        >
          You&apos;ve been invited to join Cardioplace. Confirm the details
          below to set up your account.
        </p>

        <dl className="space-y-3 mb-6">
          <Row label="Name" value={preview!.name} />
          <Row label="Email" value={preview!.email} />
          <Row
            label="Role"
            value={ROLE_LABEL[preview!.role] ?? preview!.role}
          />
          {preview!.practiceName && (
            <Row label="Practice" value={preview!.practiceName} />
          )}
          <Row label="Link expires" value={expiresLabel} muted />
        </dl>

        {activateError && (
          <p
            className="text-sm font-semibold px-3 py-2 rounded-lg mb-4"
            role="alert"
            style={{
              color: 'var(--brand-alert-red, #b91c1c)',
              backgroundColor: 'var(--brand-alert-red-light, #fee2e2)',
            }}
          >
            {activateError}
          </p>
        )}

        <button
          type="button"
          onClick={handleActivate}
          disabled={activating}
          data-testid="activate-confirm"
          className="w-full h-12 rounded-full text-white font-semibold transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ backgroundColor: '#7B00E0' }}
        >
          {activating ? 'Activating…' : 'Activate my account'}
        </button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt
        className="text-xs uppercase tracking-wider font-semibold shrink-0"
        style={{ color: 'var(--brand-text-muted, #6b7280)' }}
      >
        {label}
      </dt>
      <dd
        className="text-sm font-semibold text-right truncate"
        style={{
          color: muted
            ? 'var(--brand-text-muted, #6b7280)'
            : 'var(--brand-text-primary, #170c1d)',
        }}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
