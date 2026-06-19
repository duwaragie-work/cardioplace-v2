'use client';

// "My account" profile page. Read-only summary of the signed-in user's
// account (identity, roles, practice, preferences) with a single
// "Edit profile" action that opens EditProfileModal for the display name.
// Identity fields (email, roles, account status) are surfaced read-only —
// they're changed through user management, not here. Security (two-factor
// auth) lives on the Settings page.

import { useCallback, useEffect, useState } from 'react';
import {
  Pencil,
  ShieldCheck,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { RoleBadge, StatusBadge } from '@/components/user-management/badges';
import type { UserListStatus } from '@/lib/services/user-management.service';
import { ALL_LOCALES } from '@/i18n';
import { useAuth } from '@/lib/auth-context';
import {
  getMyProfile,
  type MyProfile,
} from '@/lib/services/profile.service';
import EditProfileModal from './EditProfileModal';

function initialsFor(name?: string | null, email?: string | null): string {
  const source = (name || email || '').trim();
  if (!source) return 'A';
  return source
    .split(/\s+|@/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function languageLabel(code: string | null): string {
  if (!code) return 'Not set';
  const match = ALL_LOCALES.find((l) => l.code === code);
  return match ? `${match.flag} ${match.nativeName}` : code;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** A label-left / value-right detail row. */
function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between gap-4 px-4 py-3.5"
      style={{ borderTop: '1px solid var(--brand-border)' }}
    >
      <p
        className="text-[13px] font-medium shrink-0"
        style={{ color: 'var(--brand-text-muted)' }}
      >
        {label}
      </p>
      <div
        className="text-[13.5px] font-semibold text-right min-w-0 break-words"
        style={{ color: 'var(--brand-text-primary)' }}
      >
        {children}
      </div>
    </div>
  );
}

export default function ProfileScreen() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProfile(await getMyProfile());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your profile.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function handleSaved(patch: { name: string }) {
    setProfile((prev) => (prev ? { ...prev, ...patch } : prev));
  }

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
            <p className="text-[13px] font-bold">Couldn’t load your profile</p>
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

  const displayName = profile.name || user?.name || 'Admin user';

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-6 md:py-8">
      {/* Header card — avatar + name + edit action (side-by-side, no banner) */}
      <div
        className="rounded-2xl bg-white p-5 flex items-center gap-4"
        style={{ border: '1px solid var(--brand-border)' }}
      >
        <span
          className="shrink-0 w-16 h-16 rounded-2xl flex items-center justify-center text-white text-[22px] font-bold"
          style={{
            background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
            boxShadow: '0 4px 16px rgba(123,0,224,0.28)',
          }}
          aria-hidden
        >
          {initialsFor(profile.name, profile.email)}
        </span>
        <div className="min-w-0 flex-1">
          <h1
            className="text-[18px] font-bold leading-tight truncate"
            style={{ color: 'var(--brand-text-primary)' }}
          >
            {displayName}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {profile.roles.length > 0 ? (
              profile.roles.map((r) => <RoleBadge key={r} role={r} />)
            ) : (
              <span className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
                No role assigned
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          data-testid="admin-profile-edit-trigger"
          className="btn-admin-secondary shrink-0 self-start"
        >
          <Pencil className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Edit profile</span>
        </button>
      </div>

      {/* Account details */}
      <p
        className="mt-6 mb-2 px-1 text-[11px] font-bold uppercase tracking-wide"
        style={{ color: 'var(--brand-text-muted)' }}
      >
        Account details
      </p>
      <div
        className="rounded-2xl bg-white overflow-hidden [&>div:first-child]:border-t-0"
        style={{ border: '1px solid var(--brand-border)' }}
      >
        <InfoRow label="Email">
          <span className="inline-flex items-center gap-2 justify-end flex-wrap">
            {profile.email || '—'}
            {profile.email && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                style={
                  profile.emailVerified
                    ? {
                        backgroundColor: 'var(--brand-success-green-light)',
                        color: 'var(--brand-success-green)',
                      }
                    : {
                        backgroundColor: 'var(--brand-warning-amber-light)',
                        color: 'var(--brand-warning-amber)',
                      }
                }
              >
                <ShieldCheck className="w-3 h-3" />
                {profile.emailVerified ? 'Verified' : 'Unverified'}
              </span>
            )}
          </span>
        </InfoRow>

        <InfoRow label="Account status">
          <StatusBadge status={profile.accountStatus.toUpperCase() as UserListStatus} />
        </InfoRow>

        <InfoRow label="Active practice">
          {profile.activePractice?.name ?? (
            <span style={{ color: 'var(--brand-text-muted)' }}>
              Organization-wide access
            </span>
          )}
        </InfoRow>

        <InfoRow label="Preferred language">
          {languageLabel(profile.preferredLanguage)}
        </InfoRow>

        <InfoRow label="Timezone">
          {profile.timezone || (
            <span style={{ color: 'var(--brand-text-muted)' }}>Not set</span>
          )}
        </InfoRow>

        <InfoRow label="Member since">{formatDate(profile.createdAt)}</InfoRow>
      </div>

      {/* Multi-practice memberships (only when 2+) */}
      {profile.availablePractices.length > 1 && (
        <>
          <p
            className="mt-6 mb-2 px-1 text-[11px] font-bold uppercase tracking-wide"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            Practice memberships
          </p>
          <div
            className="rounded-2xl bg-white overflow-hidden"
            style={{ border: '1px solid var(--brand-border)' }}
          >
            {profile.availablePractices.map((p, i) => (
              <div
                key={p.id}
                className="flex items-center gap-2.5 px-4 py-3 text-[13px]"
                style={{
                  color: 'var(--brand-text-primary)',
                  borderTop: i === 0 ? 'none' : '1px solid var(--brand-border)',
                }}
              >
                <span className="truncate font-medium">{p.name}</span>
                {profile.activePractice?.id === p.id && (
                  <span
                    className="ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                    style={{
                      backgroundColor: 'var(--brand-primary-purple-light)',
                      color: 'var(--brand-primary-purple)',
                    }}
                  >
                    Active
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <EditProfileModal
        open={editing}
        profile={profile}
        onClose={() => setEditing(false)}
        onSaved={handleSaved}
      />
    </div>
  );
}
