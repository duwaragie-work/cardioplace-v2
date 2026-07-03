'use client';

// Public, unauthenticated "I can't sign in" form. Allow-listed in proxy.ts.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { submitLockedOut } from '@/lib/services/support.service';

export default function LockedOutPage() {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Pre-fill the email from the sign-in "reactivate" CTA (?email=...). Read the
  // URL directly so this page needs no Suspense boundary for useSearchParams.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get('email');
    if (e) setEmail(e);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !description.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await submitLockedOut({
        email: email.trim(),
        description: description.trim(),
        contactPhone: phone.trim() || undefined,
      });
      setDone(r.ticketNumber);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t('support.locked.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      id="main"
      className="min-h-[100dvh] flex flex-col items-center justify-center px-4 py-10"
      style={{ backgroundColor: '#FAFBFF' }}
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 bg-red-50">
            <AlertCircle className="w-7 h-7 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">{t('support.locked.title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('support.locked.subtitle')}</p>
        </div>

        {done ? (
          <div
            data-testid="locked-out-success"
            className="rounded-2xl bg-white border border-slate-200 p-6 text-center"
          >
            <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
            <p className="text-[14px] text-slate-700">
              {t('support.locked.successLead')}{' '}
              <span className="font-mono">{done}</span> {t('support.locked.successTail')}
            </p>
            <p className="text-[12px] text-slate-400 mt-3">{t('support.locked.statusBanner')}</p>
          </div>
        ) : (
          <form
            onSubmit={submit}
            data-testid="locked-out-form"
            className="rounded-2xl bg-white border border-slate-200 p-6 space-y-3"
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('support.locked.email')}
              aria-label={t('support.locked.email')}
              data-testid="locked-out-email"
              className="w-full text-[14px] rounded-xl border border-slate-200 p-3 outline-none"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder={t('support.locked.description')}
              aria-label={t('support.locked.description')}
              data-testid="locked-out-description"
              className="w-full text-[14px] rounded-xl border border-slate-200 p-3 outline-none resize-y"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t('support.locked.phone')}
              aria-label={t('support.locked.phone')}
              className="w-full text-[14px] rounded-xl border border-slate-200 p-3 outline-none"
            />
            {err && <p className="text-[13px] text-red-600">{err}</p>}
            <button
              type="submit"
              disabled={busy || !email.trim() || !description.trim()}
              data-testid="locked-out-submit"
              className="w-full h-11 rounded-full bg-[#7B00E0] text-white text-sm font-semibold disabled:opacity-50 hover:bg-[#6600BC] transition-colors"
            >
              {busy ? t('support.locked.submitting') : t('support.locked.submit')}
            </button>
            <p className="text-[12px] text-slate-400 text-center">
              {t('support.locked.statusBanner')}
            </p>
          </form>
        )}

        <div className="text-center mt-4">
          <Link href="/sign-in" className="text-[13px] text-slate-500">
            ← {t('support.locked.backToSignIn')}
          </Link>
        </div>
      </div>
    </main>
  );
}
