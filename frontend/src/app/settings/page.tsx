'use client';

// Patient settings — biometric (Face ID / fingerprint) sign-in management.
// Biometric is a REQUIRED second factor once set up; recovery codes are the
// only fallback. So this page also manages those codes (remaining count +
// regenerate) and nudges the patient to add a phone passkey when they only
// have a desktop one (a desktop passkey can't travel to a phone).

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Fingerprint,
  Loader2,
  Trash2,
  ShieldCheck,
  Plus,
  Info,
  CheckCircle2,
  KeyRound,
  Smartphone,
  Pencil,
  Check,
  X,
  Mail,
  AlertTriangle,
  Power,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  selfDeactivateAccount,
  requestSelfClose,
} from '@/lib/services/auth.service';
import {
  isBiometricSupported,
  registerBiometric,
  listBiometricCredentials,
  deleteBiometricCredential,
  renameBiometricCredential,
  getRecoveryStatus,
  regenerateRecoveryCodes,
  getThisDeviceCredentialIds,
  MAX_BIOMETRIC_DEVICES,
  type WebAuthnCredentialRow,
  type RecoveryStatus,
  type RegisterMode,
} from '@/lib/services/webauthn.service';
import RecoveryCodesPanel from '@/components/cardio/RecoveryCodesPanel';
import NotificationSettings from '@/components/cardio/NotificationSettings';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Heuristic: does this device label look like a phone / tablet? */
function looksLikePhone(name: string | null): boolean {
  return /iphone|ipad|android|phone|tablet|pixel|galaxy/i.test(name ?? '');
}

export default function SettingsPage() {
  const { user, isLoading, logout } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  // ── Account lifecycle (phase/28) ──────────────────────────────────────────
  const [dangerBusy, setDangerBusy] = useState<null | 'deactivate' | 'close'>(null);
  const [dangerError, setDangerError] = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closeRequested, setCloseRequested] = useState(false);

  async function handleSelfDeactivate() {
    if (dangerBusy) return;
    setDangerBusy('deactivate');
    setDangerError(null);
    try {
      await selfDeactivateAccount();
      // Session is already dead server-side (tokenVersion bumped) — clear the
      // local session and bounce to sign-in.
      try {
        await logout();
      } catch {
        // logout is best-effort; the redirect below is what matters.
      }
      router.replace('/sign-in');
    } catch (e) {
      setDangerError(e instanceof Error ? e.message : t('settings.danger.error'));
      setConfirmDeactivate(false);
    } finally {
      setDangerBusy(null);
    }
  }

  async function handleRequestClose() {
    if (dangerBusy) return;
    setDangerBusy('close');
    setDangerError(null);
    try {
      await requestSelfClose();
      setConfirmClose(false);
      setCloseRequested(true);
    } catch (e) {
      setDangerError(e instanceof Error ? e.message : t('settings.danger.error'));
    } finally {
      setDangerBusy(null);
    }
  }

  const [supported, setSupported] = useState(false);
  const [credentials, setCredentials] = useState<WebAuthnCredentialRow[]>([]);
  const [recovery, setRecovery] = useState<RecoveryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabling, setEnabling] = useState<RegisterMode | null>(null);
  const [thisDeviceIds, setThisDeviceIds] = useState<string[]>([]);
  const [regenerating, setRegenerating] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [savingRename, setSavingRename] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // When set, the recovery-codes overlay is shown (first setup / regenerate).
  const [codesToShow, setCodesToShow] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [isSupported, creds, rec] = await Promise.all([
        isBiometricSupported(),
        listBiometricCredentials(),
        getRecoveryStatus(),
      ]);
      setSupported(isSupported);
      setCredentials(creds);
      setRecovery(rec);
      setThisDeviceIds(getThisDeviceCredentialIds());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.error.load'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isLoading && user) void load();
  }, [isLoading, user, load]);

  async function handleAdd(mode: RegisterMode) {
    if (enabling) return;
    setEnabling(mode);
    setError(null);
    setNotice(null);
    try {
      const result = await registerBiometric(mode);
      // First passkey → the backend returns recovery codes to save once.
      if (result.recoveryCodes && result.recoveryCodes.length > 0) {
        setCodesToShow(result.recoveryCodes);
      } else {
        setNotice(
          mode === 'platform'
            ? t('settings.bio.noticeOn')
            : t('settings.bio.noticeAdded'),
        );
      }
      await load();
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code !== 'cancelled') {
        setError(e.message || t('settings.bio.errorSetup'));
      }
    } finally {
      setEnabling(null);
    }
  }

  function startRename(id: string, current: string | null) {
    setEditingId(id);
    setEditName(current ?? '');
    setError(null);
    setNotice(null);
  }

  async function handleRename(id: string) {
    const name = editName.trim();
    if (!name || savingRename) {
      setEditingId(null);
      return;
    }
    setSavingRename(true);
    setError(null);
    try {
      await renameBiometricCredential(id, name);
      setCredentials((prev) =>
        prev.map((c) => (c.id === id ? { ...c, deviceName: name } : c)),
      );
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.bio.errorRename'));
    } finally {
      setSavingRename(false);
    }
  }

  async function handleRemove(id: string) {
    if (removingId) return;
    setRemovingId(id);
    setError(null);
    setNotice(null);
    try {
      await deleteBiometricCredential(id);
      setCredentials((prev) => prev.filter((c) => c.id !== id));
      setNotice(t('settings.bio.deviceRemoved'));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.bio.errorRemove'));
    } finally {
      setRemovingId(null);
    }
  }

  async function handleRegenerate() {
    if (regenerating) return;
    setRegenerating(true);
    setError(null);
    setNotice(null);
    try {
      const codes = await regenerateRecoveryCodes();
      setCodesToShow(codes);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.recovery.errorRegenerate'));
    } finally {
      setRegenerating(false);
    }
  }

  if (isLoading || (!user && !isLoading)) return null;

  const hasBiometric = credentials.length > 0;
  const hasPhone = credentials.some((c) => looksLikePhone(c.deviceName));
  const nudgePhone = hasBiometric && !hasPhone;
  const atMax = credentials.length >= MAX_BIOMETRIC_DEVICES;
  // This device already has a passkey if any of its locally-remembered
  // credentialIds is still in the list (matched at register + biometric login).
  const thisDeviceRegistered = credentials.some((c) =>
    thisDeviceIds.includes(c.credentialId),
  );
  // "Set up this device" — only when supported, not already done here, under cap.
  const canAddThisDevice = supported && !thisDeviceRegistered && !atMax;
  // The cross-device (QR) enrollment flow was REMOVED (2026-07-14). Biometric is
  // now bound to the device that registers it: a passkey created over QR lives
  // on a DIFFERENT device whose id we can't know, so it could never be bound
  // correctly. Each device now enables biometric for itself, from its own
  // Settings — which is also the flow the patient population can actually
  // follow. Signing in on a new device never prompts for biometric or a QR
  // ceremony; it's OTP / magic-link, then an optional opt-in here.

  return (
    <main id="main" className="min-h-screen" style={{ backgroundColor: '#FAFBFF' }}>
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-6 md:py-8">
        {/* Page header — gradient icon + title, matching the admin app */}
        <div className="flex items-center gap-3 min-w-0 mb-6">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
            style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
            aria-hidden
          >
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate" style={{ color: 'var(--brand-text-primary)' }}>
              {t('settings.title')}
            </h1>
            <p className="text-[12px] truncate" style={{ color: 'var(--brand-text-muted)' }}>
              {t('settings.subtitle')}
            </p>
          </div>
        </div>

        {/* Security section label */}
        <p
          className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          {t('settings.security')}
        </p>

        {/* Factor 1 — Email one-time code (always on, read-only) */}
        <section
          className="rounded-2xl bg-white overflow-hidden mb-4"
          style={{ border: '1px solid var(--brand-border)' }}
        >
          <div className="p-5 flex items-start gap-4">
            <span
              className="shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center text-white"
              style={{
                background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
                boxShadow: '0 4px 16px rgba(123,0,224,0.28)',
              }}
              aria-hidden
            >
              <Mail className="w-6 h-6" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[15px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                  {t('settings.email.title')}
                </h2>
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                  style={{
                    backgroundColor: 'var(--brand-success-green-light, #DCFCE7)',
                    color: 'var(--brand-success-green, #166534)',
                  }}
                >
                  <Check className="w-3 h-3" />
                  {t('settings.badge.alwaysOn')}
                </span>
              </div>
              <p className="text-[13px] mt-0.5 leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
                {t('settings.email.desc')}
              </p>
            </div>
          </div>
          <div className="px-5 pb-5">
            <div
              className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5"
              style={{ border: '1px solid var(--brand-border)' }}
            >
              <div className="min-w-0">
                <p
                  className="text-[11px] font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  {t('settings.email.sentTo')}
                </p>
                <p
                  className="mt-0.5 text-[13.5px] font-medium truncate"
                  style={{ color: 'var(--brand-text-primary)' }}
                >
                  {user?.email || '—'}
                </p>
              </div>
              <span className="shrink-0 text-[11.5px]" style={{ color: 'var(--brand-text-muted)' }}>
                {t('settings.email.cantChange')}
              </span>
            </div>
          </div>
        </section>

        {/* Factor 2 — Biometric (Face ID / fingerprint) */}
        <section
          className="rounded-2xl bg-white overflow-hidden"
          style={{ border: '1px solid var(--brand-border)' }}
        >
          <div className="p-5 flex items-start gap-4">
            <span
              className="shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center text-white"
              style={{
                background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
                boxShadow: '0 4px 16px rgba(123,0,224,0.28)',
              }}
              aria-hidden
            >
              <Fingerprint className="w-6 h-6" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[15px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                  {t('settings.bio.title')}
                </h2>
                {hasBiometric ? (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                    style={{
                      backgroundColor: 'var(--brand-success-green-light, #DCFCE7)',
                      color: 'var(--brand-success-green, #166534)',
                    }}
                  >
                    <Check className="w-3 h-3" />
                    {t('settings.badge.on')}
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                    style={{
                      backgroundColor: 'var(--brand-primary-purple-light)',
                      color: 'var(--brand-primary-purple)',
                    }}
                  >
                    {t('settings.badge.recommended')}
                  </span>
                )}
              </div>
              <p className="text-[13px] mt-0.5 leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
                {t('settings.bio.desc')}
              </p>
            </div>
          </div>

          {(error || notice) && (
            <div className="px-5 pb-1">
              {error && (
                <p
                  role="alert"
                  className="text-[13px] font-semibold px-3 py-2 rounded-lg"
                  style={{ color: 'var(--brand-alert-red)', backgroundColor: 'var(--brand-alert-red-light)' }}
                >
                  {error}
                </p>
              )}
              {notice && !error && (
                <p
                  className="text-[13px] font-semibold px-3 py-2 rounded-lg inline-flex items-center gap-1.5"
                  style={{ color: 'var(--brand-success-green, #166534)', backgroundColor: 'var(--brand-success-green-light, #DCFCE7)' }}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {notice}
                </p>
              )}
            </div>
          )}

          {loading ? (
            <div className="px-5 pb-5 space-y-2" aria-hidden>
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-xl px-3 py-3"
                  style={{ border: '1px solid var(--brand-border)' }}
                >
                  <span
                    className="w-4 h-4 rounded-full animate-pulse shrink-0"
                    style={{ backgroundColor: 'var(--brand-border)' }}
                  />
                  <div className="flex-1 space-y-1.5">
                    <span
                      className="block h-3 rounded animate-pulse"
                      style={{ backgroundColor: 'var(--brand-border)', width: '55%' }}
                    />
                    <span
                      className="block h-2.5 rounded animate-pulse"
                      style={{ backgroundColor: 'var(--brand-border)', width: '35%' }}
                    />
                  </div>
                </div>
              ))}
              <span
                className="block h-12 rounded-full animate-pulse mt-3"
                style={{ backgroundColor: 'var(--brand-border)' }}
              />
            </div>
          ) : (
            <div className="px-5 pb-5">
              {/* Registered devices */}
              {credentials.length > 0 && (
                <ul className="mb-4 space-y-2">
                  {credentials.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                      style={{ border: '1px solid var(--brand-border)' }}
                    >
                      <ShieldCheck className="w-4 h-4 shrink-0" style={{ color: 'var(--brand-success-green, #16a34a)' }} />
                      <div className="min-w-0 flex-1">
                        {editingId === c.id ? (
                          <input
                            autoFocus
                            data-testid="settings-rename-input"
                            value={editName}
                            maxLength={40}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); void handleRename(c.id); }
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            placeholder={t('settings.bio.deviceName')}
                            className="w-full h-8 px-2 rounded-lg border border-[#e5d9f2] text-[13.5px] outline-none focus:ring-2 focus:ring-[#7B00E0]"
                            style={{ color: 'var(--brand-text-primary)' }}
                          />
                        ) : (
                          <>
                            <p className="text-[13.5px] font-semibold truncate" style={{ color: 'var(--brand-text-primary)' }}>
                              {c.deviceName || t('settings.bio.registeredDevice')}
                            </p>
                            <p className="text-[11.5px]" style={{ color: 'var(--brand-text-muted)' }}>
                              {t('settings.bio.added')} {formatDate(c.createdAt)}
                              {c.lastUsedAt ? ` · ${t('settings.bio.lastUsed')} ${formatDate(c.lastUsedAt)}` : ''}
                            </p>
                          </>
                        )}
                      </div>
                      {editingId === c.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleRename(c.id)}
                            disabled={savingRename || !editName.trim()}
                            aria-label={t('settings.bio.saveNameAria')}
                            className="shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-[var(--brand-primary-purple-light)] disabled:opacity-50 cursor-pointer"
                            style={{ color: 'var(--brand-primary-purple)' }}
                          >
                            {savingRename ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            disabled={savingRename}
                            aria-label={t('common.cancel')}
                            className="shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-gray-100 disabled:opacity-50 cursor-pointer"
                            style={{ color: 'var(--brand-text-muted)' }}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => startRename(c.id, c.deviceName)}
                            aria-label={t('settings.bio.renameAria')}
                            className="shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-[var(--brand-primary-purple-light)] cursor-pointer"
                            style={{ color: 'var(--brand-text-muted)' }}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRemove(c.id)}
                            disabled={removingId === c.id}
                            aria-label={t('settings.bio.removeAria')}
                            className="shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-[var(--brand-alert-red-light)] disabled:opacity-50 cursor-pointer"
                            style={{ color: 'var(--brand-alert-red)' }}
                          >
                            {removingId === c.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* Nudge to add a phone passkey when only desktop ones exist */}
              {nudgePhone && (
                <div
                  className="mb-4 flex items-start gap-2.5 rounded-xl px-3 py-3 text-[13px]"
                  style={{ backgroundColor: 'var(--brand-primary-purple-light)', color: 'var(--brand-primary-purple)' }}
                >
                  <Smartphone className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    <strong>{t('settings.bio.nudgeTitle')}</strong>{' '}
                    {t('settings.bio.nudgeBody')}
                  </span>
                </div>
              )}

              {/* Max reached */}
              {atMax && (
                <div
                  className="flex items-start gap-2.5 rounded-xl px-3 py-3 text-[13px]"
                  style={{ backgroundColor: 'var(--brand-background, #FAFBFF)', color: 'var(--brand-text-muted)' }}
                >
                  <Info className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    {t('settings.bio.maxReached').replace(
                      '{count}',
                      String(MAX_BIOMETRIC_DEVICES),
                    )}
                  </span>
                </div>
              )}

              {/* Button 1 — set up THIS device (hidden once this device is done) */}
              {canAddThisDevice && (
                <button
                  type="button"
                  data-testid="settings-enable-biometric"
                  onClick={() => void handleAdd('platform')}
                  disabled={enabling !== null}
                  className="w-full h-12 rounded-full bg-[#7B00E0] font-semibold text-white text-sm hover:bg-[#6600BC] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer inline-flex items-center justify-center gap-2"
                >
                  {enabling === 'platform' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t('settings.bio.settingUp')}
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      {hasBiometric ? t('settings.bio.setupThis') : t('settings.bio.setupFirst')}
                    </>
                  )}
                </button>
              )}

              {/* "This device not supported" note — only when nothing else to show */}
              {!supported && !thisDeviceRegistered && !atMax && (
                <div
                  className="flex items-start gap-2.5 rounded-xl px-3 py-3 text-[13px] mb-3"
                  style={{ backgroundColor: 'var(--brand-background, #FAFBFF)', color: 'var(--brand-text-muted)' }}
                >
                  <Info className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{t('settings.bio.notSupported')}</span>
                </div>
              )}

              {/* The cross-device (QR) enrollment button was removed — biometric
                  is bound to the device that registers it, so each device now
                  enables it from its own Settings. */}
            </div>
          )}
        </section>

        {/* Notifications — turn out-of-app push on/off for this device */}
        <div className="mt-4">
          <NotificationSettings />
        </div>

        {/* Recovery codes card — only meaningful once biometric is set up */}
        {!loading && hasBiometric && (
          <section
            className="mt-4 rounded-2xl bg-white overflow-hidden"
            style={{ border: '1px solid var(--brand-border)' }}
          >
            <div className="p-5 flex items-start gap-4">
              <span
                className="shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ backgroundColor: 'var(--brand-primary-purple-light)', color: 'var(--brand-primary-purple)' }}
                aria-hidden
              >
                <KeyRound className="w-6 h-6" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[15px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                    {t('settings.recovery.title')}
                  </h2>
                  {(recovery?.remaining ?? 0) <= 3 ? (
                    <span
                      className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                      style={{
                        backgroundColor: 'var(--brand-warning-amber-light, #FEF3C7)',
                        color: 'var(--brand-warning-amber, #92400E)',
                      }}
                    >
                      {t('settings.recovery.runningLow')}
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                      style={{
                        backgroundColor: 'var(--brand-background, #FAFBFF)',
                        color: 'var(--brand-text-muted)',
                      }}
                    >
                      {t('settings.recovery.fallback')}
                    </span>
                  )}
                </div>
                <p className="text-[13px] mt-0.5 leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
                  {t('settings.recovery.desc')}
                  <span className="font-semibold">
                    {' '}
                    {t('settings.recovery.remaining').replace(
                      '{count}',
                      String(recovery?.remaining ?? 0),
                    )}
                  </span>
                </p>
              </div>
            </div>
            <div className="px-5 pb-5">
              <button
                type="button"
                data-testid="settings-regenerate-codes"
                onClick={() => void handleRegenerate()}
                disabled={regenerating}
                className="w-full h-11 rounded-full border border-[#7B00E0] font-semibold text-sm text-[#7B00E0] hover:bg-[#7B00E0]/5 transition-colors disabled:opacity-50 cursor-pointer inline-flex items-center justify-center gap-2"
              >
                {regenerating && <Loader2 className="w-4 h-4 animate-spin" />}
                {regenerating ? t('settings.recovery.generating') : t('settings.recovery.generate')}
              </button>
              <p className="text-[11.5px] mt-2" style={{ color: 'var(--brand-text-muted)' }}>
                {t('settings.recovery.replaceNote')}
              </p>
            </div>
          </section>
        )}
        {/* ── Danger zone (phase/28) — patient self-service lifecycle ────── */}
        <p
          className="mt-8 mb-2 px-1 text-[11px] font-bold uppercase tracking-wide"
          style={{ color: 'var(--brand-alert-red)' }}
        >
          {t('settings.danger.title')}
        </p>

        <section
          className="rounded-2xl bg-white overflow-hidden"
          style={{ border: '1px solid var(--brand-alert-red-light, #FEE2E2)' }}
        >
          {/* Deactivate (reversible) */}
          <div className="p-5">
            <div className="flex items-start gap-4">
              <span
                className="shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{
                  backgroundColor: 'var(--brand-warning-amber-light, #FEF3C7)',
                  color: 'var(--brand-warning-amber, #92400E)',
                }}
                aria-hidden
              >
                <Power className="w-6 h-6" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                  {t('settings.danger.deactivate.title')}
                </h2>
                <p className="text-[13px] mt-0.5 leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
                  {t('settings.danger.deactivate.desc')}
                </p>
              </div>
            </div>
            <div className="mt-3">
              {confirmDeactivate ? (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <span
                    className="flex-1 text-[12.5px] font-medium"
                    style={{ color: 'var(--brand-warning-amber, #92400E)' }}
                  >
                    {t('settings.danger.deactivate.confirm')}
                  </span>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setConfirmDeactivate(false)}
                      disabled={!!dangerBusy}
                      className="h-10 px-4 rounded-full border font-semibold text-sm disabled:opacity-50 cursor-pointer"
                      style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-secondary)' }}
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={handleSelfDeactivate}
                      disabled={!!dangerBusy}
                      data-testid="settings-deactivate-confirm"
                      className="h-10 px-4 rounded-full text-white font-semibold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                      style={{ backgroundColor: 'var(--brand-warning-amber, #D97706)' }}
                    >
                      {dangerBusy === 'deactivate' && <Loader2 className="w-4 h-4 animate-spin" />}
                      {t('settings.danger.deactivate.button')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeactivate(true)}
                  data-testid="settings-deactivate"
                  className="h-10 px-4 rounded-full border font-semibold text-sm cursor-pointer"
                  style={{ borderColor: 'var(--brand-warning-amber, #D97706)', color: 'var(--brand-warning-amber, #92400E)' }}
                >
                  {t('settings.danger.deactivate.button')}
                </button>
              )}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--brand-border)' }} />

          {/* Permanent close (irreversible, email-confirmed) */}
          <div className="p-5">
            <div className="flex items-start gap-4">
              <span
                className="shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center text-white"
                style={{ backgroundColor: 'var(--brand-alert-red)' }}
                aria-hidden
              >
                <AlertTriangle className="w-6 h-6" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                  {t('settings.danger.close.title')}
                </h2>
                <p className="text-[13px] mt-0.5 leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
                  {t('settings.danger.close.desc')}
                </p>
              </div>
            </div>
            <div className="mt-3">
              {closeRequested ? (
                <p
                  className="text-[13px] font-semibold px-3 py-2.5 rounded-lg inline-flex items-start gap-2"
                  style={{
                    color: 'var(--brand-success-green, #166534)',
                    backgroundColor: 'var(--brand-success-green-light, #DCFCE7)',
                  }}
                >
                  <Mail className="w-4 h-4 mt-0.5 shrink-0" />
                  {t('settings.danger.close.requested')}
                </p>
              ) : confirmClose ? (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <span
                    className="flex-1 text-[12.5px] font-medium"
                    style={{ color: 'var(--brand-alert-red)' }}
                  >
                    {t('settings.danger.close.confirm')}
                  </span>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setConfirmClose(false)}
                      disabled={!!dangerBusy}
                      className="h-10 px-4 rounded-full border font-semibold text-sm disabled:opacity-50 cursor-pointer"
                      style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-secondary)' }}
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={handleRequestClose}
                      disabled={!!dangerBusy}
                      data-testid="settings-close-confirm"
                      className="h-10 px-4 rounded-full text-white font-semibold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                      style={{ backgroundColor: 'var(--brand-alert-red)' }}
                    >
                      {dangerBusy === 'close' && <Loader2 className="w-4 h-4 animate-spin" />}
                      {t('settings.danger.close.button')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClose(true)}
                  disabled={!!dangerBusy}
                  data-testid="settings-close-request"
                  className="h-10 px-4 rounded-full text-white font-semibold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                  style={{ backgroundColor: 'var(--brand-alert-red)' }}
                >
                  {t('settings.danger.close.button')}
                </button>
              )}
            </div>
          </div>

          {dangerError && (
            <div className="px-5 pb-5">
              <p
                role="alert"
                className="text-[13px] font-semibold px-3 py-2 rounded-lg"
                style={{ color: 'var(--brand-alert-red)', backgroundColor: 'var(--brand-alert-red-light)' }}
              >
                {dangerError}
              </p>
            </div>
          )}
        </section>

        {/* Support has moved OUT of Settings. Everything now lives on the one
            adaptive /support hub (the consolidation Lakshitha asked for — it
            used to be split across Settings, the sign-in page and the footer).
            All that remains here is a signpost. */}
        <p
          className="mb-2 mt-6 px-1 text-[11px] font-bold uppercase tracking-wide"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          {t('settings.support.title')}
        </p>
        <section
          className="rounded-2xl bg-white overflow-hidden p-5"
          style={{ border: '1px solid var(--brand-border)' }}
          data-testid="settings-support"
        >
          <p className="text-[13px] mb-4" style={{ color: 'var(--brand-text-muted)' }}>
            {t('settings.support.intro')}
          </p>
          <a
            href="/support"
            data-testid="settings-support-link"
            className="inline-flex items-center gap-1 text-[13px] font-semibold"
            style={{ color: 'var(--brand-primary-purple)' }}
          >
            {t('settings.support.goToSupport')}
          </a>
        </section>
      </div>

      {/* Recovery-codes overlay (first setup / regenerate) */}
      {codesToShow && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ backgroundColor: 'rgba(15,23,42,0.5)' }}
        >
          <div className="relative w-full sm:max-w-md bg-white sm:rounded-3xl rounded-t-3xl max-h-[92dvh] overflow-y-auto p-5 pt-14">
            <button
              type="button"
              onClick={() => setCodesToShow(null)}
              aria-label={t('common.close')}
              className="absolute right-4 top-4 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 cursor-pointer"
            >
              <X className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
            </button>
            <RecoveryCodesPanel
              codes={codesToShow}
              acknowledgeLabel={t('settings.recovery.done')}
              onAcknowledge={() => setCodesToShow(null)}
            />
          </div>
        </div>
      )}
    </main>
  );
}
