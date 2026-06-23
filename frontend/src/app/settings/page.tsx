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
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  isBiometricSupported,
  registerBiometric,
  listBiometricCredentials,
  deleteBiometricCredential,
  getRecoveryStatus,
  regenerateRecoveryCodes,
  type WebAuthnCredentialRow,
  type RecoveryStatus,
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
  const [enabling, setEnabling] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
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

  async function handleEnable() {
    if (enabling) return;
    setEnabling(true);
    setError(null);
    setNotice(null);
    try {
      const result = await registerBiometric();
      // First passkey → the backend returns recovery codes to save once.
      if (result.recoveryCodes && result.recoveryCodes.length > 0) {
        setCodesToShow(result.recoveryCodes);
      } else {
        setNotice('Biometric sign-in is on for this device.');
      }
      await load();
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code !== 'cancelled') {
        setError(e.message || 'Could not set up biometric.');
      }
    } finally {
      setEnabling(false);
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
                        <p className="text-[13.5px] font-semibold truncate" style={{ color: 'var(--brand-text-primary)' }}>
                          {c.deviceName || 'Registered device'}
                        </p>
                        <p className="text-[11.5px]" style={{ color: 'var(--brand-text-muted)' }}>
                          Added {formatDate(c.createdAt)}
                          {c.lastUsedAt ? ` · last used ${formatDate(c.lastUsedAt)}` : ''}
                        </p>
                      </div>
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

              {supported ? (
                <button
                  type="button"
                  data-testid="settings-enable-biometric"
                  onClick={() => void handleEnable()}
                  disabled={enabling}
                  className="w-full h-12 rounded-full bg-[#7B00E0] font-semibold text-white text-sm hover:bg-[#6600BC] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer inline-flex items-center justify-center gap-2"
                >
                  {enabling ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Setting up…
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      {credentials.length > 0 ? 'Add this device' : 'Set up Face ID / fingerprint'}
                    </>
                  )}
                </button>
              ) : (
                <div
                  className="flex items-start gap-2.5 rounded-xl px-3 py-3 text-[13px]"
                  style={{ backgroundColor: 'var(--brand-background, #FAFBFF)', color: 'var(--brand-text-muted)' }}
                >
                  <Info className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    Face ID or fingerprint isn&apos;t available on this device. You
                    can set it up on a phone or tablet that has it.
                  </span>
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
          <div className="relative w-full sm:max-w-md bg-white sm:rounded-3xl rounded-t-3xl max-h-[92dvh] overflow-y-auto p-5">
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
