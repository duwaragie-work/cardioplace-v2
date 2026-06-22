'use client';

// Settings page. Account-level controls for the signed-in user, grouped
// into sections. Today it hosts Security (two-factor authentication); it's
// structured so more sections (notifications, appearance, …) can slot in
// later without reshaping the page — add another <SettingsSection>.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  KeyRound,
  Check,
  Loader2,
  AlertCircle,
  ShieldCheck,
} from 'lucide-react';
import { getMyProfile, type MyProfile } from '@/lib/services/profile.service';
import RecoveryCodesModal from '@/components/profile/RecoveryCodesModal';

/** A titled settings section: heading + description + a bordered card body. */
function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 first:mt-0">
      <div className="flex items-start gap-2.5 px-1 mb-2">
        <Icon
          className="w-4 h-4 mt-0.5 shrink-0"
          style={{ color: 'var(--brand-text-muted)' }}
        />
        <div>
          <h2
            className="text-[13.5px] font-bold leading-tight"
            style={{ color: 'var(--brand-text-primary)' }}
          >
            {title}
          </h2>
          <p
            className="text-[12px] mt-0.5"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            {description}
          </p>
        </div>
      </div>
      <div
        className="rounded-2xl bg-white overflow-hidden"
        style={{ border: '1px solid var(--brand-border)' }}
      >
        {children}
      </div>
    </section>
  );
}

export default function SettingsScreen() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRecoveryCodes, setShowRecoveryCodes] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2
          className="w-5 h-5 animate-spin"
          style={{ color: 'var(--brand-text-muted)' }}
        />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-10">
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
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-6 md:py-8">
      <h1
        className="text-[22px] font-bold mb-6"
        style={{ color: 'var(--brand-text-primary)' }}
      >
        Settings
      </h1>

      {/* Security — two-factor authentication */}
      <SettingsSection
        icon={ShieldCheck}
        title="Security"
        description="Protect your account with a second sign-in step."
      >
        <div className="flex items-start gap-3 px-4 py-4">
          <span
            className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-white"
            style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
            aria-hidden
          >
            <KeyRound className="w-4 h-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p
                className="text-[13.5px] font-semibold"
                style={{ color: 'var(--brand-text-primary)' }}
              >
                Two-factor authentication
              </p>
              {profile.mfaEnabled ? (
                <span
                  data-testid="admin-settings-mfa-status"
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                  style={{
                    backgroundColor: 'var(--brand-success-green-light)',
                    color: 'var(--brand-success-green)',
                  }}
                >
                  <Check className="w-3 h-3" />
                  Enabled
                </span>
              ) : (
                <span
                  data-testid="admin-settings-mfa-status"
                  className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                  style={{
                    backgroundColor: 'var(--brand-warning-amber-light)',
                    color: 'var(--brand-warning-amber)',
                  }}
                >
                  {profile.mfaRequired ? 'Setup required' : 'Not set up'}
                </span>
              )}
            </div>
            <p
              className="mt-0.5 text-[12px]"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              {profile.mfaEnabled
                ? 'An authenticator app is protecting your account.'
                : 'Add a second step at sign-in using an authenticator app.'}
            </p>
          </div>
        </div>

        <div
          className="flex flex-col sm:flex-row gap-2 px-4 pb-4 pt-3.5"
          style={{ borderTop: '1px solid var(--brand-border)' }}
        >
          <Link
            href="/sign-in/mfa-enroll"
            data-testid="admin-settings-mfa-link"
            className="btn-admin-secondary flex-1 justify-center"
          >
            {profile.mfaEnabled ? 'Reset authenticator' : 'Set up'}
          </Link>
          {profile.mfaEnabled && (
            <button
              type="button"
              onClick={() => setShowRecoveryCodes(true)}
              data-testid="admin-settings-recovery-codes"
              className="btn-admin-secondary flex-1 justify-center"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Recovery codes
            </button>
          )}
        </div>
      </SettingsSection>

      <RecoveryCodesModal
        open={showRecoveryCodes}
        onClose={() => setShowRecoveryCodes(false)}
      />
    </div>
  );
}
