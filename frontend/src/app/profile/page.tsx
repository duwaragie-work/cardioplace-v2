'use client';

// Patient profile (Flow E3). Six sections:
//   • Account info (email, sign out)
//   • Assigned Care Team (read-only — from PatientProviderAssignment)
//   • Demographics (gender, height) — Edit deep-links to /clinical-intake?step=A1
//   • Pregnancy (only if gender=FEMALE) — Edit → ?step=A2
//   • Conditions (+ HF subtype) with verification badges — Edit → ?step=A3
//   • Medications (verification badge per row) — Edit → ?step=A5
//
// Editing any clinical section flips profileVerificationStatus back to
// UNVERIFIED on the backend (intake.service already does this on POST), and
// the dashboard's D1 badge surfaces the new "awaiting provider verification"
// state automatically on next visit.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { fetchWithAuth } from '@/lib/services/token';
import {
  Pencil,
  Heart,
  Activity,
  Stethoscope,
  Sparkles,
  Pill,
  Baby,
  Users,
  ShieldCheck,
  ShieldAlert,
  LogOut,
  CheckCircle2,
  Clock,
  Info,
  X,
  User as UserIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n';
import MicButton from '@/components/intake/MicButton';
import AudioButton from '@/components/intake/AudioButton';
import { formatHeightFtIn } from '@/lib/units';
import { matchToCatalog } from '@cardioplace/shared';
import {
  getMyPatientProfile,
  getMyMedications,
  getMyCareTeam,
  type PatientProfileDto,
  type PatientMedicationDto,
  type CareTeamDto,
} from '@/lib/services/intake.service';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

type TFn = (key: TranslationKey) => string;

function frequencyLabel(f: PatientMedicationDto['frequency'], t: TFn): string {
  switch (f) {
    case 'ONCE_DAILY': return t('profile.freqOnceDaily');
    case 'TWICE_DAILY': return t('profile.freqTwiceDaily');
    case 'THREE_TIMES_DAILY': return t('profile.freqThreeTimesDaily');
    case 'AS_NEEDED': return t('profile.freqAsNeeded');
    case 'UNSURE': return t('profile.freqUnknown');
    default: return '—';
  }
}

function genderLabel(g: string | null | undefined, t: TFn): string {
  if (!g) return t('profile.notSet');
  if (g === 'MALE') return t('intake.a1.genderMale');
  if (g === 'FEMALE') return t('intake.a1.genderFemale');
  if (g === 'OTHER') return t('intake.a1.genderOther');
  return g.charAt(0) + g.slice(1).toLowerCase();
}

function hfTypeLabel(hfType: string | null | undefined, t: TFn): string {
  switch (hfType) {
    case 'HFREF': return t('profile.hfHfrEf');
    case 'HFPEF': return t('profile.hfHfpEf');
    case 'UNKNOWN': return t('profile.hfToConfirm');
    case 'NOT_APPLICABLE': return '';
    default: return '';
  }
}

function initialsFor(name?: string | null, email?: string | null): string {
  const source = (name || email || '').trim();
  if (!source) return 'U';
  return source
    .split(/\s+|@/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth profile (User table) — name, email, dob, communication preference.
// Lives separately from PatientProfile (which is clinical intake).
// ─────────────────────────────────────────────────────────────────────────────

type CommPref = 'TEXT_FIRST' | 'AUDIO_FIRST' | null;

interface AuthProfileDto {
  id: string;
  email: string | null;
  name: string | null;
  dateOfBirth: string | null;
  timezone: string | null;
  communicationPreference: CommPref;
  preferredLanguage: string | null;
}

async function fetchAuthProfile(): Promise<AuthProfileDto | null> {
  const res = await fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL}/api/v2/auth/profile`);
  if (!res.ok) return null;
  return (await res.json()) as AuthProfileDto;
}

async function patchAuthProfile(payload: {
  name?: string | null;
  dateOfBirth?: string | null;
  communicationPreference?: CommPref;
}): Promise<AuthProfileDto> {
  // Backend's PATCH only returns the patched fields (no email, no id), so
  // we re-fetch the full GET after a successful write to keep the UI state
  // consistent with the database.
  const res = await fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL}/api/v2/auth/profile`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Request failed: ${res.status}`);
  }
  // Discard PATCH response, refetch full profile.
  await res.json().catch(() => null);
  const fresh = await fetchAuthProfile();
  if (!fresh) throw new Error('Could not reload profile after save.');
  return fresh;
}

// Note: HTTP-level error messages from patchAuthProfile flow through
// untranslated — matches the pre-existing pattern across the app where backend
// errors bubble up in their original language (backlog item flagged in Flow C).

function commPrefLabel(p: CommPref, t: TFn): string {
  if (p === 'TEXT_FIRST') return t('profile.commPrefText');
  if (p === 'AUDIO_FIRST') return t('profile.commPrefAudio');
  return t('profile.notSet');
}

/** Track whether a CSS media query matches; updates on resize. */
function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reusable section components
// ─────────────────────────────────────────────────────────────────────────────

function SectionCard({
  title,
  icon,
  editHref,
  onEdit,
  scrollable = false,
  audioText,
  editTestId,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  /** Deep-link to a wizard step. Omit for read-only sections. */
  editHref?: string;
  /** Inline edit handler — opens a local modal. Use instead of editHref
      when the field lives on User (not PatientProfile) so we don't have
      to round-trip through the wizard. */
  onEdit?: () => void;
  /** When true, the card fills its parent height and the body scrolls
      INSIDE the card (below the title + Edit chrome) using the thin
      purple scrollbar. The title row stays pinned. */
  scrollable?: boolean;
  /** Phase/26 silent-literacy — when provided, renders an AudioButton in
      the header that reads this composed summary aloud. Defaults to the
      title alone if omitted. */
  audioText?: string;
  /** Optional test hook forwarded to the Edit link/button for Playwright. */
  editTestId?: string;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <div
      className={
        'rounded-2xl bg-white ' +
        (scrollable ? 'flex flex-col h-full overflow-hidden' : '')
      }
      style={{
        boxShadow: '0 1px 12px rgba(123,0,224,0.06)',
        border: '1px solid var(--brand-border)',
      }}
    >
      <div
        className="shrink-0 flex items-center justify-between gap-3 px-5 pt-4 pb-3"
        style={{ borderBottom: '1px solid var(--brand-border)' }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="shrink-0 rounded-xl flex items-center justify-center"
            style={{
              width: 32,
              height: 32,
              backgroundColor: 'var(--brand-primary-purple-light)',
              color: 'var(--brand-primary-purple)',
            }}
          >
            {icon}
          </div>
          <h2
            className="text-[15px] font-bold truncate"
            style={{ color: 'var(--brand-text-primary)' }}
          >
            {title}
          </h2>
          <AudioButton size="sm" text={audioText ?? title} />
        </div>
        {editHref && (
          <Link
            href={editHref}
            data-testid={editTestId}
            className="shrink-0 inline-flex items-center gap-1 h-8 px-3 rounded-full text-[12px] font-bold cursor-pointer transition hover:opacity-85"
            style={{
              backgroundColor: 'var(--brand-primary-purple-light)',
              color: 'var(--brand-primary-purple)',
            }}
          >
            <Pencil className="w-3.5 h-3.5" />
            {t('common.edit')}
          </Link>
        )}
        {onEdit && !editHref && (
          <button
            type="button"
            data-testid={editTestId}
            onClick={onEdit}
            className="shrink-0 inline-flex items-center gap-1 h-8 px-3 rounded-full text-[12px] font-bold cursor-pointer transition hover:opacity-85"
            style={{
              backgroundColor: 'var(--brand-primary-purple-light)',
              color: 'var(--brand-primary-purple)',
            }}
          >
            <Pencil className="w-3.5 h-3.5" />
            {t('common.edit')}
          </button>
        )}
      </div>
      <div
        className={
          'px-5 py-4 ' +
          (scrollable ? 'flex-1 overflow-y-auto thin-scrollbar min-h-0' : '')
        }
      >
        {children}
      </div>
    </div>
  );
}

function VerifiedBadge({ status }: { status?: string | null }) {
  const { t } = useLanguage();
  if (status === 'VERIFIED') {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
        style={{
          backgroundColor: 'var(--brand-success-green-light)',
          color: 'var(--brand-success-green)',
        }}
      >
        <CheckCircle2 aria-hidden="true" className="w-3 h-3" />
        {t('profile.verified')}
      </span>
    );
  }
  if (status === 'CORRECTED') {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
        style={{
          backgroundColor: 'var(--brand-accent-teal-light)',
          color: 'var(--brand-accent-teal)',
        }}
      >
        <ShieldCheck aria-hidden="true" className="w-3 h-3" />
        {t('profile.correctedByTeam')}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
      style={{
        backgroundColor: 'var(--brand-warning-amber-light)',
        color: 'var(--brand-warning-amber-text)',
      }}
    >
      <Clock aria-hidden="true" className="w-3 h-3" />
      {t('profile.awaitingVerification')}
    </span>
  );
}

function MedVerifiedBadge({ status }: { status: PatientMedicationDto['verificationStatus'] }) {
  const { t } = useLanguage();
  if (status === 'VERIFIED') return <VerifiedBadge status="VERIFIED" />;
  if (status === 'REJECTED') {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
        style={{ backgroundColor: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red-text)' }}
      >
        <ShieldAlert aria-hidden="true" className="w-3 h-3" />
        {t('profile.rejectedByTeam')}
      </span>
    );
  }
  return <VerifiedBadge status="UNVERIFIED" />;
}

function Row({ label, value, testId }: { label: string; value: React.ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className="flex items-baseline justify-between gap-3 py-2">
      <span className="text-[12.5px] shrink-0" style={{ color: 'var(--brand-text-muted)' }}>
        {label}
      </span>
      <span
        className="text-[13.5px] font-semibold text-right min-w-0 flex-1"
        style={{ color: 'var(--brand-text-primary)', wordBreak: 'break-word' }}
      >
        {value}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton
// ─────────────────────────────────────────────────────────────────────────────

function Bone({ w, h, rounded = 'rounded-md' }: { w: number | string; h: number; rounded?: string }) {
  return (
    <div
      className={`animate-pulse ${rounded}`}
      style={{ width: w, height: h, backgroundColor: '#EDE9F6' }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Personal-info edit modal — name, DOB, communication preference. Email
// stays read-only (it's the auth identity). PATCHes /api/v2/auth/profile.
// ─────────────────────────────────────────────────────────────────────────────

function PersonalInfoModal({
  current,
  onClose,
  onSaved,
}: {
  current: AuthProfileDto;
  onClose: () => void;
  onSaved: (next: AuthProfileDto) => void;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState(current.name ?? '');
  const [commPref, setCommPref] = useState<CommPref>(current.communicationPreference);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const dirty =
    (name || '') !== (current.name ?? '') ||
    commPref !== current.communicationPreference;

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setError('');
    try {
      const next = await patchAuthProfile({
        name: name.trim() || null,
        communicationPreference: commPref,
      });
      onSaved(next);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('profile.saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: 'rgba(15,23,42,0.5)' }}
    >
      <div className="absolute inset-0" onClick={onClose} />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="personal-info-title"
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
        className="relative w-full sm:max-w-md bg-white sm:rounded-2xl rounded-t-2xl flex flex-col overflow-hidden"
        style={{
          maxHeight: '90dvh',
          boxShadow: '0 8px 48px rgba(0,0,0,0.18)',
        }}
      >
        <div
          className="shrink-0 flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--brand-border)' }}
        >
          <div className="flex items-center gap-2">
            <h2 id="personal-info-title" className="text-[16px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
              {t('profile.editPersonalInfo')}
            </h2>
            <AudioButton size="sm" text={t('profile.editPersonalInfo')} />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 rounded-full flex items-center justify-center cursor-pointer"
            style={{ backgroundColor: 'var(--brand-background)' }}
            aria-label={t('accessibility.closeDialog')}
          >
            <X className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto thin-scrollbar p-5 space-y-4">
          <div>
            <label htmlFor="profile-edit-name" className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--brand-text-secondary)' }}>
              {t('profile.nameLabel')}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="profile-edit-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('profile.namePlaceholder')}
                className="flex-1 h-11 px-3 rounded-xl border text-[14px] outline-none"
                style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-primary)' }}
              />
              <MicButton
                inputId="profile-edit-name"
                onTranscript={(text) => setName(text)}
              />
            </div>
          </div>

          <div>
            <label htmlFor="profile-edit-email" className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--brand-text-secondary)' }}>
              {t('profile.email')} <span className="font-normal" style={{ color: 'var(--brand-text-muted)' }}>{t('profile.emailCannotChange')}</span>
            </label>
            <input
              id="profile-edit-email"
              type="email"
              value={current.email ?? ''}
              readOnly
              className="w-full h-11 px-3 rounded-xl border text-[14px] cursor-not-allowed"
              style={{
                borderColor: 'var(--brand-border)',
                color: 'var(--brand-text-muted)',
                backgroundColor: 'var(--brand-background)',
              }}
            />
          </div>

          <div>
            <label className="block text-[12px] font-semibold mb-2" style={{ color: 'var(--brand-text-secondary)' }}>
              {t('profile.commPrefLabel')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: null, label: t('profile.notSet') },
                { value: 'TEXT_FIRST' as const, label: t('profile.commPrefText') },
                { value: 'AUDIO_FIRST' as const, label: t('profile.commPrefAudio') },
              ]).map((opt) => {
                const active = commPref === opt.value;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    data-testid={`profile-comm-preference-${opt.value ?? 'null'}`}
                    onClick={() => setCommPref(opt.value)}
                    className="h-10 rounded-xl border-2 text-[12.5px] font-semibold transition cursor-pointer"
                    style={{
                      borderColor: active ? 'var(--brand-primary-purple)' : 'var(--brand-border)',
                      backgroundColor: active ? 'var(--brand-primary-purple-light)' : 'transparent',
                      color: active ? 'var(--brand-primary-purple)' : 'var(--brand-text-muted)',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div
          className="shrink-0 px-5 py-3"
          style={{ borderTop: '1px solid var(--brand-border)' }}
        >
          {error && (
            <p
              className="text-[12.5px] font-semibold text-center mb-2 px-3 py-1.5 rounded-lg"
              style={{ color: 'var(--brand-alert-red-text)', backgroundColor: 'var(--brand-alert-red-light)' }}
            >
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-11 rounded-full border-2 text-sm font-semibold cursor-pointer"
              style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-secondary)' }}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className="flex-1 h-11 rounded-full text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
              style={{ backgroundColor: 'var(--brand-primary-purple)' }}
            >
              {saving ? t('profile.saving') : t('profile.saveChangesBtn')}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FAFBFF' }}>
      <div className="max-w-2xl mx-auto px-4 md:px-8 py-6 space-y-4">
        <div className="space-y-3">
          <Bone w={140} h={20} />
          <Bone w={'60%'} h={12} />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-2xl bg-white p-5 space-y-3"
            style={{ border: '1px solid var(--brand-border)' }}
          >
            <Bone w={140} h={14} />
            <Bone w={'70%'} h={11} />
            <Bone w={'85%'} h={11} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const router = useRouter();
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const { t } = useLanguage();

  const [profile, setProfile] = useState<PatientProfileDto | null>(null);
  const [meds, setMeds] = useState<PatientMedicationDto[]>([]);
  const [careTeam, setCareTeam] = useState<CareTeamDto | null>(null);
  const [authProfile, setAuthProfile] = useState<AuthProfileDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPersonalEdit, setShowPersonalEdit] = useState(false);

  // Match the right column's height to the left column's natural height.
  // CSS grid alone always sizes the row to the taller side; we want the
  // medications card to clamp to the LEFT column even when the med list
  // is much longer (the card body then scrolls inside via thin-scrollbar).
  const leftColumnRef = useRef<HTMLDivElement>(null);
  const [leftHeight, setLeftHeight] = useState<number | undefined>(undefined);
  const isMd = useMatchMedia('(min-width: 768px)');

  useEffect(() => {
    const node = leftColumnRef.current;
    if (!node || typeof window === 'undefined' || !('ResizeObserver' in window)) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (typeof h === 'number') setLeftHeight(Math.round(h));
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [loading]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/sign-in');
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [p, m, c, a] = await Promise.all([
        getMyPatientProfile().catch(() => null),
        getMyMedications().catch(() => []),
        getMyCareTeam().catch(() => null),
        fetchAuthProfile().catch(() => null),
      ]);
      if (cancelled) return;
      setProfile(p);
      setMeds(Array.isArray(m) ? m : []);
      setCareTeam(c);
      setAuthProfile(a);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, isLoading]);

  if (isLoading || loading) return <ProfileSkeleton />;

  const verificationStatus = profile?.profileVerificationStatus ?? 'UNVERIFIED';
  const showPregnancy = profile?.gender === 'FEMALE';
  const activeMeds = meds.filter((m) => !m.discontinuedAt);
  // Condition labels reuse Flow A intake keys — they're the same strings the
  // patient saw on A3 selection. HCM/DCM drop the parenthetical abbreviation
  // (not present in Flow A); the dedicated HF type row below covers the case
  // where subtype disambiguation matters.
  const conditions: { label: string; on: boolean; kind: 'hf' | 'af' | 'cad' | 'hcm' | 'dcm' }[] = [
    { kind: 'hf', label: t('intake.a3.hfTitle'), on: !!profile?.hasHeartFailure },
    { kind: 'af', label: t('intake.a3.afTitle'), on: !!profile?.hasAFib },
    { kind: 'cad', label: t('intake.a3.cadTitle'), on: !!profile?.hasCAD },
    { kind: 'hcm', label: t('intake.a3.hcmTitle'), on: !!profile?.hasHCM },
    { kind: 'dcm', label: t('intake.a3.dcmTitle'), on: !!profile?.hasDCM },
  ];
  const onConditions = conditions.filter((c) => c.on);

  return (
    // Page uses natural document scroll — no viewport lock. The left column
    // stacks About + Pregnancy + Conditions at their natural heights and the
    // page grows if it needs to. The right column (Medications) stretches
    // to match the left column's height via CSS grid `align-items: stretch`,
    // and scrolls inside its card if the medication list exceeds that.
    <main id="main" className="min-h-screen" style={{ backgroundColor: '#FAFBFF' }}>
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-6 space-y-4">
        {/* Page header — avatar + name + email on the left, sign-out CTA top right */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="shrink-0 rounded-2xl flex items-center justify-center text-white font-bold text-[18px] sm:text-[20px]"
              style={{
                width: 56,
                height: 56,
                background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
                boxShadow: '0 4px 12px rgba(123,0,224,0.25)',
              }}
              aria-hidden
            >
              {initialsFor(user?.name, user?.email)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1
                  data-testid="profile-name"
                  className="text-[20px] sm:text-[22px] font-bold leading-tight truncate"
                  style={{ color: 'var(--brand-text-primary)' }}
                >
                  {user?.name ?? t('profile.yourProfile')}
                </h1>
                <AudioButton
                  size="sm"
                  text={`${user?.name ?? t('profile.yourProfile')}. ${user?.email ?? ''}`}
                />
              </div>
              <p className="text-[12.5px] truncate" style={{ color: 'var(--brand-text-muted)' }}>
                {user?.email ?? '—'}
              </p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {profile && <VerifiedBadge status={verificationStatus} />}
                {!profile && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                    style={{
                      backgroundColor: 'var(--brand-warning-amber-light)',
                      color: 'var(--brand-warning-amber-text)',
                    }}
                  >
                    <Info className="w-3 h-3" />
                    {t('profile.notStarted')}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            data-testid="profile-signout"
            type="button"
            onClick={logout}
            className="shrink-0 inline-flex items-center gap-1.5 h-10 px-3 sm:px-4 rounded-full font-bold text-[12.5px] cursor-pointer transition hover:opacity-85"
            style={{
              backgroundColor: 'var(--brand-alert-red-light)',
              color: 'var(--brand-alert-red-text)',
              border: '1px solid var(--brand-alert-red-light)',
            }}
            aria-label={t('profile.signOut')}
            // Known WCAG debt — chip pattern (red-100 bg + red-600 text at
            // 12.5px bold = 3.95:1, fails AA Normal). Same accepted tradeoff
            // as the admin alert queue rows; tracked in theme.css "KNOWN DEBT".
            data-axe-debt="avatar-orange-small-text"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">{t('profile.signOut')}</span>
          </button>
        </div>

        {/* No-profile fallback CTA */}
        {!profile && (
          <Link
            href="/clinical-intake"
            className="block rounded-2xl p-4 text-center text-white font-bold text-[14px]"
            style={{
              background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
              boxShadow: 'var(--brand-shadow-button)',
            }}
          >
            {t('profile.completeHealthProfile')}
          </Link>
        )}

        {/* Care team — outside the flexible grid so it always takes its
            natural height, then the grid below fills the remaining viewport
            on md+ (and stacks naturally on mobile). */}
        <SectionCard
          title={t('profile.careTeam')}
          icon={<Users className="w-4 h-4" />}
          audioText={
            careTeam
              ? [
                  `${t('profile.careTeam')}.`,
                  `${t('profile.practice')}: ${careTeam.practice?.name ?? t('profile.notAssigned')}.`,
                  `${t('profile.primaryProvider')}: ${careTeam.primaryProvider?.name ?? t('profile.notAssigned')}.`,
                  `${t('profile.backupProvider')}: ${careTeam.backupProvider?.name ?? t('profile.notAssigned')}.`,
                  `${t('profile.medicalDirector')}: ${careTeam.medicalDirector?.name ?? t('profile.notAssigned')}.`,
                ].join(' ')
              : `${t('profile.careTeam')}. ${t('profile.noCareTeam')}`
          }
        >
          {careTeam ? (
            <div className="space-y-2">
              <Row label={t('profile.practice')} value={careTeam.practice?.name ?? '—'} />
              <Row
                label={t('profile.primaryProvider')}
                value={careTeam.primaryProvider?.name ?? careTeam.primaryProvider?.email ?? '—'}
              />
              <Row
                label={t('profile.backupProvider')}
                value={careTeam.backupProvider?.name ?? careTeam.backupProvider?.email ?? '—'}
              />
              <Row
                label={t('profile.medicalDirector')}
                value={careTeam.medicalDirector?.name ?? careTeam.medicalDirector?.email ?? '—'}
              />
            </div>
          ) : (
            <p className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>
              {t('profile.noCareTeam')}
            </p>
          )}
        </SectionCard>

        {/* Two-column grid below Care Team. CSS grid's default
            `align-items: stretch` makes the right column (Medications)
            match the left column's height — its card scrolls internally
            when the med list exceeds that height. Left column has no
            scroller; if the patient has many conditions the page scrolls
            naturally. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          {/* LEFT column — Personal info → About → Pregnancy (if female) →
              Conditions stacked. No overflow handling: the column takes its
              content height and the page extends if needed. The ref feeds a
              ResizeObserver that drives the right column's height so the
              medications card always matches this column on desktop. */}
          <div ref={leftColumnRef} className="space-y-4">
            <SectionCard
              title={t('profile.personalInfoSection')}
              icon={<UserIcon className="w-4 h-4" />}
              onEdit={authProfile ? () => setShowPersonalEdit(true) : undefined}
              editTestId="profile-name-edit-button"
              audioText={[
                `${t('profile.personalInfoSection')}.`,
                `${t('profile.nameLabel')}: ${authProfile?.name || t('profile.notSet')}.`,
                `${t('profile.email')}: ${authProfile?.email ?? '—'}.`,
                `${t('profile.commPrefLabel')}: ${commPrefLabel(authProfile?.communicationPreference ?? null, t)}.`,
              ].join(' ')}
            >
              <Row label={t('profile.nameLabel')} value={authProfile?.name || t('profile.notSet')} />
              <Row label={t('profile.email')} value={authProfile?.email ?? '—'} />
              <Row
                label={t('profile.commPrefLabel')}
                value={commPrefLabel(authProfile?.communicationPreference ?? null, t)}
              />
            </SectionCard>
            <SectionCard
              title={t('profile.aboutYou')}
              icon={<Info className="w-4 h-4" />}
              editHref={profile ? '/clinical-intake?step=A1' : undefined}
              editTestId="profile-edit-clinical-link"
              audioText={[
                `${t('profile.aboutYou')}.`,
                `${t('profile.gender')}: ${genderLabel(profile?.gender, t)}.`,
                `${t('profile.dobLabel')}: ${authProfile?.dateOfBirth ? formatDate(authProfile.dateOfBirth) : t('profile.notSet')}.`,
                `${t('profile.heightLabel')}: ${profile?.heightCm ? formatHeightFtIn(profile.heightCm) : t('profile.notSet')}.`,
              ].join(' ')}
            >
              <Row label={t('profile.gender')} value={genderLabel(profile?.gender, t)} />
              <Row
                label={t('profile.dobLabel')}
                value={authProfile?.dateOfBirth ? formatDate(authProfile.dateOfBirth) : t('profile.notSet')}
              />
              <Row
                label={t('profile.heightLabel')}
                value={profile?.heightCm ? formatHeightFtIn(profile.heightCm) : t('profile.notSet')}
              />
            </SectionCard>

            {showPregnancy && (
              <SectionCard
                title={t('profile.pregnancySection')}
                icon={<Baby className="w-4 h-4" />}
                editHref="/clinical-intake?step=A2"
                audioText={(() => {
                  const parts: string[] = [`${t('profile.pregnancySection')}.`];
                  parts.push(
                    profile?.isPregnant === true
                      ? `${t('profile.currentlyPregnant')}: ${t('common.yes')}.`
                      : profile?.isPregnant === false
                        ? `${t('profile.currentlyPregnant')}: ${t('common.no')}.`
                        : `${t('profile.currentlyPregnant')}: ${t('profile.notSpecified')}.`,
                  );
                  if (profile?.isPregnant && profile?.pregnancyDueDate) {
                    parts.push(`${t('profile.dueDate')}: ${formatDate(profile.pregnancyDueDate)}.`);
                  }
                  if (profile?.historyPreeclampsia) {
                    parts.push(`${t('intake.a2.preeclampsiaTitle')}: ${t('common.yes')}.`);
                  }
                  return parts.join(' ');
                })()}
              >
                <Row
                  testId="profile-pregnancy"
                  label={t('profile.currentlyPregnant')}
                  value={
                    profile?.isPregnant === true
                      ? t('common.yes')
                      : profile?.isPregnant === false
                        ? t('common.no')
                        : t('profile.notSpecified')
                  }
                />
                {profile?.isPregnant && (
                  <Row
                    label={t('profile.dueDate')}
                    value={profile?.pregnancyDueDate ? formatDate(profile.pregnancyDueDate) : t('profile.notSet')}
                  />
                )}
                {profile?.historyPreeclampsia && (
                  <Row label={t('intake.a2.preeclampsiaTitle')} value={t('common.yes')} />
                )}
              </SectionCard>
            )}

            <SectionCard
              title={t('profile.conditionsSection')}
              icon={<Heart className="w-4 h-4" />}
              editHref={profile ? '/clinical-intake?step=A3' : undefined}
              audioText={(() => {
                const parts: string[] = [`${t('profile.conditionsSection')}.`];
                if (onConditions.length === 0 && !profile?.diagnosedHypertension) {
                  parts.push(t('profile.noConditions'));
                  return parts.join(' ');
                }
                if (onConditions.length > 0) {
                  parts.push(`${onConditions.map((c) => c.label).join(', ')}.`);
                }
                if (profile?.hasHeartFailure && profile?.heartFailureType && profile.heartFailureType !== 'NOT_APPLICABLE') {
                  parts.push(`${t('profile.hfTypeLabel')}: ${hfTypeLabel(profile.heartFailureType, t)}.`);
                }
                if (profile?.diagnosedHypertension) {
                  parts.push(`${t('profile.diagnosedHtn')}.`);
                }
                return parts.join(' ');
              })()}
            >
              {onConditions.length === 0 && !profile?.diagnosedHypertension ? (
                <p className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>
                  {t('profile.noConditions')}
                </p>
              ) : (
                <div className="space-y-2">
                  {onConditions.map((c) => (
                    // flex-wrap so the verification badge drops to its own
                    // line when the column is narrow (e.g. tablets where the
                    // 2-col grid leaves the right column ~340px wide), but
                    // sits inline with the label when there's room.
                    <div key={c.kind} className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        {c.kind === 'hf' && <Heart className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-primary-purple)' }} />}
                        {c.kind === 'af' && <Activity className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-primary-purple)' }} />}
                        {c.kind === 'cad' && <Stethoscope className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-primary-purple)' }} />}
                        {(c.kind === 'hcm' || c.kind === 'dcm') && <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-primary-purple)' }} />}
                        <span className="text-[13px] font-semibold" style={{ color: 'var(--brand-text-primary)', wordBreak: 'break-word' }}>
                          {c.label}
                        </span>
                      </div>
                      <div className="shrink-0">
                        <VerifiedBadge status={verificationStatus} />
                      </div>
                    </div>
                  ))}
                  {profile?.hasHeartFailure && profile?.heartFailureType && profile.heartFailureType !== 'NOT_APPLICABLE' && (
                    <Row label={t('profile.hfTypeLabel')} value={hfTypeLabel(profile.heartFailureType, t)} />
                  )}
                  {profile?.diagnosedHypertension && (
                    <div className="flex items-center justify-between gap-2 flex-wrap pt-2" style={{ borderTop: '1px solid var(--brand-border)' }}>
                      <span className="text-[13px] font-semibold min-w-0" style={{ color: 'var(--brand-text-primary)', wordBreak: 'break-word' }}>
                        {t('profile.diagnosedHtn')}
                      </span>
                      <div className="shrink-0">
                        <VerifiedBadge status={verificationStatus} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </SectionCard>
          </div>

          {/* RIGHT column — Medications. Height is JS-driven from the LEFT
              column's measured height on md+ so the card never grows
              past the left side regardless of how many meds are reported.
              On mobile the height is undefined (natural flow). The
              SectionCard's `scrollable` prop turns the body into a
              flex-1 scroll area inside, with the thin purple scrollbar. */}
          <div
            className="md:overflow-hidden"
            style={
              isMd && leftHeight
                ? { height: `${leftHeight}px` }
                : undefined
            }
          >
          <SectionCard
            title={t('profile.medicationsSection')}
            icon={<Pill className="w-4 h-4" />}
            editHref={profile ? '/clinical-intake?step=A5' : undefined}
            scrollable
            audioText={(() => {
              const parts: string[] = [`${t('profile.medicationsSection')}.`];
              if (activeMeds.length === 0) {
                parts.push(t('profile.noMedications'));
                return parts.join(' ');
              }
              // Silent-literacy: include each med's plain-language purpose in
              // the audio readout. Freeform meds use the Gemini-simplified
              // `plainLanguageDescription` from the drug-enrichment service;
              // catalog meds (which the enrichment service skips) fall back
              // to the hand-written `purpose` on the shared catalog entry.
              const medSentences = activeMeds.map((m) => {
                const combo = m.isCombination ? ` (${t('profile.combinationPill')})` : '';
                const catalogPurpose = !m.plainLanguageDescription
                  ? matchToCatalog(m.drugName)?.purpose
                  : null;
                const purposeLine = m.plainLanguageDescription || catalogPurpose;
                const purpose = purposeLine ? `. ${purposeLine}` : '';
                return `${m.drugName}${combo}, ${frequencyLabel(m.frequency, t)}${purpose}`;
              });
              parts.push(`${medSentences.join('. ')}.`);
              return parts.join(' ');
            })()}
          >
            {activeMeds.length === 0 ? (
              <p className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>
                {t('profile.noMedications')}
              </p>
            ) : (
              <div className="space-y-2">
                {activeMeds.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-xl p-3 flex gap-3"
                    style={{ backgroundColor: 'var(--brand-background)', border: '1px solid var(--brand-border)' }}
                  >
                    {/* Pill image — only rendered for freeform meds that
                        actually got a DailyMed hit; catalog meds keep their
                        existing layout (no thumb). */}
                    {m.pillImageUrl && (
                      <img
                        src={m.pillImageUrl}
                        alt=""
                        aria-hidden="true"
                        className="w-10 h-10 rounded-md object-cover shrink-0"
                        style={{ border: '1px solid var(--brand-border)' }}
                        onError={(e) => {
                          // DailyMed URL went stale or 404'd — drop the image
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      {/* Row 1: name (truncates to single line) + verified badge */}
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <p
                          className="text-[13.5px] font-bold leading-tight truncate min-w-0 flex-1"
                          style={{ color: 'var(--brand-text-primary)' }}
                          title={m.drugName}
                        >
                          {m.drugName}
                        </p>
                        <div className="shrink-0">
                          <MedVerifiedBadge status={m.verificationStatus} />
                        </div>
                      </div>
                      {/* Plain-language indication. Freeform meds use the
                          drug-enrichment service's Gemini-simplified text;
                          catalog meds fall back to the hand-written purpose
                          string from the shared catalog. Either way every
                          med shows what it's for in plain language. */}
                      {(() => {
                        const purposeLine =
                          m.plainLanguageDescription ||
                          matchToCatalog(m.drugName)?.purpose;
                        return purposeLine ? (
                          <p
                            className="text-[11.5px] mt-0.5 leading-snug"
                            style={{ color: 'var(--brand-text-secondary)' }}
                          >
                            {purposeLine}
                          </p>
                        ) : null;
                      })()}
                      {/* Row 2: optional 2-in-1 badge + frequency */}
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        {m.isCombination && (
                          <span
                            className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider"
                            style={{ backgroundColor: 'var(--brand-accent-teal)', color: 'white' }}
                          >
                            {t('profile.combinationPill')}
                          </span>
                        )}
                        <p
                          className="text-[12px]"
                          style={{ color: 'var(--brand-text-muted)' }}
                        >
                          {frequencyLabel(m.frequency, t)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
          </div>
        </div>
        {/* /grid */}

        {/* Re-verification reminder — visible whenever the profile is unverified */}
        {profile && verificationStatus === 'UNVERIFIED' && (
          <div
            className="rounded-2xl px-4 py-3 flex items-start gap-3"
            style={{
              backgroundColor: 'var(--brand-warning-amber-light)',
              border: '1px solid #FCD34D',
            }}
          >
            <Clock className="w-5 h-5 mt-0.5 shrink-0" style={{ color: 'var(--brand-warning-amber-text)' }} />
            <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--brand-text-primary)' }}>
              {t('profile.reviewingChanges')}
            </p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showPersonalEdit && authProfile && (
          <PersonalInfoModal
            current={authProfile}
            onClose={() => setShowPersonalEdit(false)}
            onSaved={(next) => setAuthProfile(next)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
