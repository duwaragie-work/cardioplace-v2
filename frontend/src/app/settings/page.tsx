'use client';

// Patient settings. Currently hosts biometric (Face ID / fingerprint) sign-in
// management — an optional second factor layered on top of OTP / magic-link.
// Enable adds the current device; the list lets the patient remove any device.
// Gracefully degrades: the "Set up" button only appears on devices that have a
// built-in biometric.

import { useCallback, useEffect, useState } from 'react';
import {
  Fingerprint,
  Loader2,
  Trash2,
  ShieldCheck,
  Plus,
  Info,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  isBiometricSupported,
  registerBiometric,
  listBiometricCredentials,
  deleteBiometricCredential,
  type WebAuthnCredentialRow,
} from '@/lib/services/webauthn.service';

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

export default function SettingsPage() {
  const { user, isLoading } = useAuth();

  const [supported, setSupported] = useState(false);
  const [credentials, setCredentials] = useState<WebAuthnCredentialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabling, setEnabling] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [isSupported, creds] = await Promise.all([
        isBiometricSupported(),
        listBiometricCredentials(),
      ]);
      setSupported(isSupported);
      setCredentials(creds);
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
      await registerBiometric();
      setNotice('Biometric sign-in is on for this device.');
      await load();
    } catch (err) {
      const e = err as Error & { code?: string };
      // A user-cancelled prompt isn't an error worth shouting about.
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove device.');
    } finally {
      setRemovingId(null);
    }
  }

  if (isLoading || (!user && !isLoading)) return null;

  return (
    <main
      id="main"
      className="min-h-screen"
      style={{ backgroundColor: '#FAFBFF' }}
    >
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-6 md:py-8">
      <h1
        className="text-xl font-bold mb-1"
        style={{ color: 'var(--brand-text-primary)' }}
      >
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
            <h2
              className="text-[15px] font-bold"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              Face ID / fingerprint
            </h2>
            <p
              className="text-[13px] mt-0.5 leading-relaxed"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              Add a faster, more secure step after your email code. You&apos;ll
              still use your email code as a backup.
            </p>
          </div>
        </div>

        {/* Status / feedback */}
        {(error || notice) && (
          <div className="px-5 pb-1">
            {error && (
              <p
                role="alert"
                className="text-[13px] font-semibold px-3 py-2 rounded-lg"
                style={{
                  color: 'var(--brand-alert-red)',
                  backgroundColor: 'var(--brand-alert-red-light)',
                }}
              >
                {error}
              </p>
            )}
            {notice && !error && (
              <p
                className="text-[13px] font-semibold px-3 py-2 rounded-lg inline-flex items-center gap-1.5"
                style={{
                  color: 'var(--brand-success-green, #166534)',
                  backgroundColor: 'var(--brand-success-green-light, #DCFCE7)',
                }}
              >
                <CheckCircle2 className="w-4 h-4" />
                {notice}
              </p>
            )}
          </div>
        )}

        {loading ? (
          <div className="px-5 py-8 flex justify-center">
            <Loader2
              className="w-5 h-5 animate-spin"
              style={{ color: 'var(--brand-text-muted)' }}
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
                    <ShieldCheck
                      className="w-4 h-4 shrink-0"
                      style={{ color: 'var(--brand-success-green, #16a34a)' }}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-[13.5px] font-semibold truncate"
                        style={{ color: 'var(--brand-text-primary)' }}
                      >
                        {c.deviceName || 'Registered device'}
                      </p>
                      <p
                        className="text-[11.5px]"
                        style={{ color: 'var(--brand-text-muted)' }}
                      >
                        Added {formatDate(c.createdAt)}
                        {c.lastUsedAt
                          ? ` · last used ${formatDate(c.lastUsedAt)}`
                          : ''}
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

            {/* Enable button — only when the device has a biometric. */}
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
                    {credentials.length > 0
                      ? 'Add this device'
                      : 'Set up Face ID / fingerprint'}
                  </>
                )}
              </button>
            ) : (
              <div
                className="flex items-start gap-2.5 rounded-xl px-3 py-3 text-[13px]"
                style={{
                  backgroundColor: 'var(--brand-background, #FAFBFF)',
                  color: 'var(--brand-text-muted)',
                }}
              >
                <Info className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  Face ID or fingerprint isn't available on this device. You can still sign in with your email code.
                </span>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
    </main>
  );
}
