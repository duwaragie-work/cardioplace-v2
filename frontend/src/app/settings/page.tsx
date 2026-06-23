'use client';

// Patient settings — biometric (Face ID / fingerprint) sign-in management.
// Biometric is a REQUIRED second factor once set up; recovery codes are the
// only fallback. So this page also manages those codes (remaining count +
// regenerate) and nudges the patient to add a phone passkey when they only
// have a desktop one (a desktop passkey can't travel to a phone).

import { useCallback, useEffect, useState } from 'react';
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
  Bluetooth,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
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
  const { user, isLoading } = useAuth();

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
      setError(err instanceof Error ? err.message : 'Could not load settings.');
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
            ? 'Biometric sign-in is on for this device.'
            : 'Your other device was added.',
        );
      }
      await load();
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code !== 'cancelled') {
        setError(e.message || 'Could not set up biometric.');
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
      setError(err instanceof Error ? err.message : 'Could not rename device.');
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
      setNotice('Device removed.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove device.');
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
      setError(err instanceof Error ? err.message : 'Could not regenerate codes.');
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
  // "Add another device" (QR) — available whenever there's room, even on a
  // device with no biometric of its own.
  const canAddAnother = !atMax;

  return (
    <main id="main" className="min-h-screen" style={{ backgroundColor: '#FAFBFF' }}>
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-6 md:py-8">
        <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--brand-text-primary)' }}>
          Settings
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--brand-text-muted)' }}>
          Manage how you sign in to Cardioplace.
        </p>

        {/* Biometric card */}
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
              <h2 className="text-[15px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                Face ID / fingerprint
              </h2>
              <p className="text-[13px] mt-0.5 leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
                After your email code, confirm with Face ID or your fingerprint.
                Keep your recovery codes safe — they&apos;re the only way in if you
                can&apos;t use biometric.
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
            <div className="px-5 py-8 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--brand-text-muted)' }} />
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
                            placeholder="Device name"
                            className="w-full h-8 px-2 rounded-lg border border-[#e5d9f2] text-[13.5px] outline-none focus:ring-2 focus:ring-[#7B00E0]"
                            style={{ color: 'var(--brand-text-primary)' }}
                          />
                        ) : (
                          <>
                            <p className="text-[13.5px] font-semibold truncate" style={{ color: 'var(--brand-text-primary)' }}>
                              {c.deviceName || 'Registered device'}
                            </p>
                            <p className="text-[11.5px]" style={{ color: 'var(--brand-text-muted)' }}>
                              Added {formatDate(c.createdAt)}
                              {c.lastUsedAt ? ` · last used ${formatDate(c.lastUsedAt)}` : ''}
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
                            aria-label="Save name"
                            className="shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-[var(--brand-primary-purple-light)] disabled:opacity-50 cursor-pointer"
                            style={{ color: 'var(--brand-primary-purple)' }}
                          >
                            {savingRename ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            disabled={savingRename}
                            aria-label="Cancel"
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
                            aria-label="Rename device"
                            className="shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-[var(--brand-primary-purple-light)] cursor-pointer"
                            style={{ color: 'var(--brand-text-muted)' }}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRemove(c.id)}
                            disabled={removingId === c.id}
                            aria-label="Remove device"
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
                    <strong>Add your phone too.</strong> A computer passkey only
                    works on that computer. On a phone, tap “Set up” below; or
                    from this computer, choose “use a phone” and scan the QR with
                    your phone.
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
                    You&apos;ve reached the maximum of {MAX_BIOMETRIC_DEVICES}{' '}
                    devices. Remove one above to add another.
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
                      Setting up…
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      {hasBiometric ? 'Set up this device' : 'Set up Face ID / fingerprint'}
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
                  <span>
                    Face ID or fingerprint isn&apos;t available on this device —
                    but you can still add a phone or tablet below.
                  </span>
                </div>
              )}

              {/* Button 2 — add ANOTHER device via QR */}
              {canAddAnother && (
                <div className={canAddThisDevice ? 'mt-3' : ''}>
                  <button
                    type="button"
                    data-testid="settings-add-another-device"
                    onClick={() => void handleAdd('cross-platform')}
                    disabled={enabling !== null}
                    className="w-full h-12 rounded-full border border-[#7B00E0] font-semibold text-[#7B00E0] text-sm hover:bg-[#7B00E0]/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer inline-flex items-center justify-center gap-2"
                  >
                    {enabling === 'cross-platform' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Waiting for the other device…
                      </>
                    ) : (
                      <>
                        <Smartphone className="w-4 h-4" />
                        Add another device (phone / tablet)
                      </>
                    )}
                  </button>
                  <div
                    className="mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-[11.5px]"
                    style={{
                      backgroundColor: 'var(--brand-primary-purple-light)',
                      color: 'var(--brand-primary-purple)',
                    }}
                  >
                    <Bluetooth className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                      <strong>Turn Bluetooth ON on both devices first.</strong>{' '}
                      Then on the next screen choose{' '}
                      <strong>“use a phone or tablet”</strong>, scan the QR with
                      that device, and confirm with its Face ID / fingerprint.
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

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
                <h2 className="text-[15px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                  Recovery codes
                </h2>
                <p className="text-[13px] mt-0.5 leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
                  Use one to sign in if you can&apos;t use Face ID / fingerprint.
                  <span className="font-semibold">
                    {' '}
                    {recovery?.remaining ?? 0} of 10 left.
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
                {regenerating ? 'Generating…' : 'Generate new codes'}
              </button>
              <p className="text-[11.5px] mt-2" style={{ color: 'var(--brand-text-muted)' }}>
                Generating new codes replaces your old ones.
              </p>
            </div>
          </section>
        )}
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
              aria-label="Close"
              className="absolute right-4 top-4 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 cursor-pointer"
            >
              <X className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
            </button>
            <RecoveryCodesPanel
              codes={codesToShow}
              acknowledgeLabel="Done"
              onAcknowledge={() => setCodesToShow(null)}
            />
          </div>
        </div>
      )}
    </main>
  );
}
