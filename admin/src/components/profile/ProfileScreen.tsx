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
  UserRound,
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

/** Hyphenate the canonical 13-char displayId → CP-PAT-XXXXXXX-C. Mirrors the
 *  local copies in patients/page.tsx + PatientDetailShell (no shared util yet). */
function formatDisplayId(value: string): string {
  if (value.length !== 13 || value.includes('-')) return value;
  return `${value.slice(0, 2)}-${value.slice(2, 5)}-${value.slice(5, 12)}-${value.slice(12)}`;
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

/** Loading placeholder shown instead of a spinner. */
function ProfileSkeleton() {
  return (
    <div className="space-y-5" aria-hidden>
      {/* Hero */}
      <div
        className="rounded-2xl bg-white p-5 flex items-center gap-4"
        style={{ border: '1px solid var(--brand-border)' }}
      >
        <span
          className="shrink-0 w-16 h-16 rounded-2xl animate-pulse"
          style={{ backgroundColor: 'var(--brand-border)' }}
        />
        <div className="flex-1 space-y-2">
          <span
            className="block h-4 rounded animate-pulse"
            style={{ backgroundColor: 'var(--brand-border)', width: '50%' }}
          />
          <span
            className="block h-3 rounded animate-pulse"
            style={{ backgroundColor: 'var(--brand-border)', width: '30%' }}
          />
        </div>
      </div>
      {/* Details */}
      <div
        className="rounded-2xl bg-white overflow-hidden"
        style={{ border: '1px solid var(--brand-border)' }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between px-4 py-3.5"
            style={{ borderTop: i === 0 ? 'none' : '1px solid var(--brand-border)' }}
          >
            <span
              className="h-3 rounded animate-pulse"
              style={{ backgroundColor: 'var(--brand-border)', width: '28%' }}
            />
            <span
              className="h-3 rounded animate-pulse"
              style={{ backgroundColor: 'var(--brand-border)', width: '40%' }}
            />
          </div>
        ))}
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

  const header = (
    <div className="flex items-center gap-3 min-w-0">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
        style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
        aria-hidden
      >
        <UserRound className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <h1
          className="text-xl font-bold truncate"
          style={{ color: 'var(--brand-text-primary)' }}
        >
          My account
        </h1>
        <p
          className="text-[12px] truncate"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          Your profile details, roles, and practice access.
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

  if (loading) return wrap(<ProfileSkeleton />);

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
      </div>,
    );
  }

  const displayName = profile.name || user?.name || 'Admin user';

  return wrap(
    <>
      {/* Identity card — avatar + name + edit action */}
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
          <h2
            className="text-[18px] font-bold leading-tight truncate"
            style={{ color: 'var(--brand-text-primary)' }}
          >
            {displayName}
          </h2>
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
      <div>
      <p
        className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide"
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

        {profile.displayId ? (
          <InfoRow label="Your Cardioplace ID">
            <span
              className="font-mono tracking-tight select-all"
              data-testid="profile-display-id"
              title="Quote this on support calls — it's permanent and unique to your account"
            >
              {formatDisplayId(profile.displayId)}
            </span>
          </InfoRow>
        ) : null}

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
      </div>

      {/* Multi-practice memberships (only when 2+) */}
      {profile.availablePractices.length > 1 && (
        <div>
          <p
            className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide"
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
        </div>
      )}

      <EditProfileModal
        open={editing}
        profile={profile}
        onClose={() => setEditing(false)}
        onSaved={handleSaved}
      />
    </>,
  );
}
