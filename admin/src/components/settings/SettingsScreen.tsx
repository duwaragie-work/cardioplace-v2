'use client';

// Settings page. Account-level security for the signed-in user. Shows every
// sign-in factor on the account as its own card:
//   1. Email one-time code  — always on, read-only (changed via user mgmt)
//   2. Authenticator app    — TOTP setup / status / reset
//   3. Recovery codes       — fallback; remaining/used count + regenerate
// Built so more sections (notifications, appearance, …) can slot in later.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Settings,
  Mail,
  KeyRound,
  LifeBuoy,
  Check,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { getMyProfile, type MyProfile } from '@/lib/services/profile.service';
import RecoveryCodesModal from '@/components/profile/RecoveryCodesModal';
import SupportContactForm from '@/components/SupportContactForm';

// ─── Small presentational helpers ─────────────────────────────────────────────

/** A pill badge with a colour intent. */
function StatusPill({
  intent,
  children,
  icon: Icon,
}: {
  intent: 'success' | 'warning' | 'muted';
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const styles =
    intent === 'success'
      ? {
          backgroundColor: 'var(--brand-success-green-light)',
          color: 'var(--brand-success-green)',
        }
      : intent === 'warning'
        ? {
            backgroundColor: 'var(--brand-warning-amber-light)',
            color: 'var(--brand-warning-amber)',
          }
        : {
            backgroundColor: 'var(--brand-background)',
            color: 'var(--brand-text-muted)',
          };
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
      style={styles}
    >
      {Icon && <Icon className="w-3 h-3" />}
      {children}
    </span>
  );
}

/** One sign-in factor as a card: gradient icon + title/badge + body. */
function FactorCard({
  icon: Icon,
  title,
  badge,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  badge: React.ReactNode;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl bg-white overflow-hidden"
      style={{ border: '1px solid var(--brand-border)' }}
    >
      <div className="flex items-start gap-3 px-4 py-4">
        <span
          className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-white"
          style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
          aria-hidden
        >
          <Icon className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className="text-[13.5px] font-semibold"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              {title}
            </p>
            {badge}
          </div>
          <p
            className="mt-0.5 text-[12px]"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            {description}
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

/** Footer strip inside a card for actions / details. */
function CardFooter({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-4 py-3.5"
      style={{ borderTop: '1px solid var(--brand-border)' }}
    >
      {children}
    </div>
  );
}

// ─── Skeleton (shown while loading instead of a spinner) ───────────────────────

function CardSkeleton() {
  return (
    <div
      className="rounded-2xl bg-white px-4 py-4 flex items-start gap-3"
      style={{ border: '1px solid var(--brand-border)' }}
      aria-hidden
    >
      <span
        className="shrink-0 w-9 h-9 rounded-xl animate-pulse"
        style={{ backgroundColor: 'var(--brand-border)' }}
      />
      <div className="flex-1 space-y-2 py-0.5">
        <span
          className="block h-3.5 rounded animate-pulse"
          style={{ backgroundColor: 'var(--brand-border)', width: '45%' }}
        />
        <span
          className="block h-2.5 rounded animate-pulse"
          style={{ backgroundColor: 'var(--brand-border)', width: '70%' }}
        />
      </div>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="space-y-3">
      <span
        className="block h-3 w-40 rounded animate-pulse mb-2"
        style={{ backgroundColor: 'var(--brand-border)' }}
        aria-hidden
      />
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRecoveryCodes, setShowRecoveryCodes] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setProfile(await getMyProfile());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Header is always rendered; only the section content swaps to a skeleton.
  const header = (
    <div className="flex items-center gap-3 min-w-0">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
        style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
        aria-hidden
      >
        <Settings className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <h1
          className="text-xl font-bold truncate"
          style={{ color: 'var(--brand-text-primary)' }}
        >
          Settings
        </h1>
        <p
          className="text-[12px] truncate"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          Manage how you sign in and keep your account secure.
        </p>
      </div>
    </div>
  );

  const wrap = (inner: React.ReactNode) => (
    <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-6 space-y-5">
      {header}
      {inner}
    </div>
  );

  if (loading) return wrap(<SettingsSkeleton />);

  if (error || !profile) {
    return wrap(
      <div
        className="flex items-start gap-3 px-4 py-4 rounded-xl"
        style={{
          backgroundColor: 'var(--brand-alert-red-light)',
          color: 'var(--brand-alert-red)',
        }}
        role="alert"
      >
        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-[13px] font-bold">Couldn’t load settings</p>
          <p className="text-[12px] mt-0.5">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 text-[12px] font-bold underline cursor-pointer"
          >
            Try again
          </button>
        </div>
      </div>,
    );
  }

  const lowOnCodes =
    profile.mfaEnabled && profile.recoveryCodesRemaining <= 3;

  return wrap(
    <>
      {/* Overall security banner */}
      {profile.mfaEnabled ? (
        <div
          className="flex items-start gap-2.5 rounded-2xl px-4 py-3 text-[13px]"
          style={{
            backgroundColor: 'var(--brand-success-green-light)',
            color: 'var(--brand-success-green)',
          }}
          role="status"
        >
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <strong>Your account is fully protected.</strong> Email code and
            your authenticator app are both active.
          </span>
        </div>
      ) : (
        <div
          className="flex items-start gap-2.5 rounded-2xl px-4 py-3 text-[13px]"
          style={{
            backgroundColor: 'var(--brand-warning-amber-light)',
            color: 'var(--brand-warning-amber)',
          }}
          role="status"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {profile.mfaRequired
              ? 'Action needed: set up your authenticator app to finish securing your account.'
              : 'Add an authenticator app for stronger sign-in protection.'}
          </span>
        </div>
      )}

      {/* Sign-in factors */}
      <div>
        <p
          className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          Sign-in &amp; security
        </p>

        <div className="space-y-3">
          {/* 1 — Email one-time code (primary factor, read-only) */}
          <FactorCard
            icon={Mail}
            title="Email one-time code"
            description="A 6-digit code is emailed to you each time you sign in."
            badge={
              <StatusPill intent="success" icon={Check}>
                Always on
              </StatusPill>
            }
          >
            <CardFooter>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p
                    className="text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--brand-text-muted)' }}
                  >
                    Codes are sent to
                  </p>
                  <p
                    className="mt-0.5 text-[13px] font-medium truncate"
                    style={{ color: 'var(--brand-text-primary)' }}
                  >
                    {profile.email || '—'}
                  </p>
                </div>
                <span
                  className="shrink-0 text-[11px]"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  Can’t be changed here
                </span>
              </div>
            </CardFooter>
          </FactorCard>

          {/* 2 — Authenticator app (TOTP) */}
          <FactorCard
            icon={KeyRound}
            title="Authenticator app"
            description={
              profile.mfaEnabled
                ? 'Enter a 6-digit code from your authenticator app at sign-in.'
                : 'Use Google Authenticator, Microsoft Authenticator, or Authy.'
            }
            badge={
              profile.mfaEnabled ? (
                <StatusPill intent="success" icon={Check}>
                  Enabled
                </StatusPill>
              ) : (
                <StatusPill intent="warning">
                  {profile.mfaRequired ? 'Setup required' : 'Not set up'}
                </StatusPill>
              )
            }
          >
            <CardFooter>
              <Link
                href="/sign-in/mfa-enroll"
                data-testid="admin-settings-mfa-link"
                className="btn-admin-secondary w-full sm:w-auto justify-center"
              >
                {profile.mfaEnabled ? 'Reset authenticator' : 'Set up'}
              </Link>
            </CardFooter>
          </FactorCard>

          {/* 3 — Recovery codes (fallback) — only meaningful once enrolled */}
          {profile.mfaEnabled && (
            <FactorCard
              icon={LifeBuoy}
              title="Recovery codes"
              description="Your backup if you ever lose your authenticator app. Keep them somewhere safe — each code works once."
              badge={
                lowOnCodes ? (
                  <StatusPill intent="warning" icon={AlertTriangle}>
                    Running low
                  </StatusPill>
                ) : (
                  <StatusPill intent="muted">Fallback</StatusPill>
                )
              }
            >
              <CardFooter>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p
                      className="text-[13px] font-bold"
                      style={{
                        color: lowOnCodes
                          ? 'var(--brand-warning-amber)'
                          : 'var(--brand-text-primary)',
                      }}
                    >
                      {profile.recoveryCodesRemaining} of{' '}
                      {profile.recoveryCodesTotal} remaining
                    </p>
                    <p
                      className="text-[11px]"
                      style={{ color: 'var(--brand-text-muted)' }}
                    >
                      {profile.recoveryCodesTotal -
                        profile.recoveryCodesRemaining}{' '}
                      used
                      {lowOnCodes ? ' — generate a new set soon' : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowRecoveryCodes(true)}
                    data-testid="admin-settings-recovery-codes"
                    className="btn-admin-secondary shrink-0 justify-center"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Generate new codes
                  </button>
                </div>
              </CardFooter>
            </FactorCard>
          )}
        </div>
      </div>

      {/* Contact support — in-app form for signed-in staff. */}
      <div className="max-w-2xl mx-auto px-4 md:px-6 pb-8">
        <p
          className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          Contact support
        </p>
        <div
          className="rounded-2xl bg-white p-5"
          style={{ border: '1px solid var(--brand-border)' }}
        >
          <p className="text-[13px] mb-4" style={{ color: 'var(--brand-text-muted)' }}>
            Question about your account, MFA, a clinical topic, or a bug? Send our team a
            message and we’ll follow up by email.
          </p>
          <SupportContactForm />
        </div>
      </div>

      <RecoveryCodesModal
        open={showRecoveryCodes}
        onClose={() => setShowRecoveryCodes(false)}
        onGenerated={() => void load()}
      />
    </>,
  );
}
