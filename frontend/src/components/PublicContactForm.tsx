'use client';

import { useState } from 'react';
import { CheckCircle2, Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { submitPublicContact } from '@/lib/services/support.service';

/**
 * Public, non-PHI "send us a message" for the signed-out `/support` hub
 * → POST /v2/support/public-contact.
 *
 * Deliberately has NO category picker: the backend forces OTHER, so a
 * signed-out visitor can never file a clinical ticket. The form carries an
 * explicit "don't include health information" notice because this is the one
 * support surface that must stay PHI-free (the submitter is unauthenticated,
 * so nothing here is covered by the patient's own access controls).
 *
 * Replaces the old LandingFooter `/api/contact` form, which created no ticket
 * and showed success even when the request failed.
 */
export default function PublicContactForm() {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !subject.trim() || !message.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await submitPublicContact({
        email: email.trim(),
        subject: subject.trim(),
        message: message.trim(),
      });
      setDone(r.ticketNumber);
      setSubject('');
      setMessage('');
    } catch (e2) {
      // Surface the real failure — the form this replaces swallowed errors and
      // showed success regardless.
      setErr(e2 instanceof Error ? e2.message : t('support.publiccontact.error'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div
        data-testid="public-contact-success"
        className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800"
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {t('support.publiccontact.successLead')}{' '}
          <span className="font-mono">{done}</span>{' '}
          {t('support.publiccontact.successTail')}
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="public-contact-form">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t('support.publiccontact.email')}
        aria-label={t('support.publiccontact.email')}
        data-testid="public-contact-email"
        className="w-full rounded-xl border border-slate-200 p-3 text-[14px] outline-none"
      />
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder={t('support.publiccontact.subject')}
        aria-label={t('support.publiccontact.subject')}
        data-testid="public-contact-subject"
        className="w-full rounded-xl border border-slate-200 p-3 text-[14px] outline-none"
      />
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        placeholder={t('support.publiccontact.message')}
        aria-label={t('support.publiccontact.message')}
        data-testid="public-contact-message"
        className="w-full resize-y rounded-xl border border-slate-200 p-3 text-[14px] outline-none"
      />
      <p className="flex items-start gap-1.5 text-[12px] text-slate-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t('support.publiccontact.noPhi')}
      </p>
      {err && <p className="text-[13px] text-red-600">{err}</p>}
      <button
        type="submit"
        disabled={busy || !email.trim() || !subject.trim() || !message.trim()}
        data-testid="public-contact-submit"
        className="h-11 rounded-full bg-[#7B00E0] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#6600BC] disabled:opacity-50"
      >
        {busy ? t('support.publiccontact.sending') : t('support.publiccontact.send')}
      </button>
    </form>
  );
}
