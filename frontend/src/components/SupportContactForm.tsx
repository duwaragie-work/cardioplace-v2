'use client';

import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n';
import {
  submitContact,
  type SupportCategory,
} from '@/lib/services/support.service';

const CATEGORIES: { value: SupportCategory; labelKey: TranslationKey }[] = [
  { value: 'ACCOUNT', labelKey: 'support.form.categoryAccount' },
  { value: 'MFA', labelKey: 'support.form.categoryMfa' },
  { value: 'CLINICAL', labelKey: 'support.form.categoryClinical' },
  { value: 'BUG', labelKey: 'support.form.categoryBug' },
  { value: 'OTHER', labelKey: 'support.form.categoryOther' },
];

/** In-app "Contact support" form for signed-in patients → /v2/support/contact. */
export default function SupportContactForm() {
  const { t } = useLanguage();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<SupportCategory>('ACCOUNT');
  // Phone contact isn't available yet (no call-center / phone-ID verification),
  // so Email is the default and the only selectable option (Fix 6).
  const [pref, setPref] = useState<'EMAIL' | 'PHONE'>('EMAIL');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await submitContact({
        subject: subject.trim(),
        body: body.trim(),
        category,
        contactPreference: pref,
      });
      setDone(r.ticketNumber);
      setSubject('');
      setBody('');
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t('support.form.error'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div
        data-testid="support-contact-success"
        className="flex items-start gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-[13px] text-emerald-800"
      >
        <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          {t('support.form.successPrefix')}{' '}
          <span className="font-mono">{done}</span> {t('support.form.successSuffix')}
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="support-contact-form">
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder={t('support.form.subject')}
        aria-label={t('support.form.subject')}
        data-testid="support-contact-subject"
        className="w-full text-[14px] rounded-xl border border-slate-200 p-3 outline-none"
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value as SupportCategory)}
        aria-label={t('support.form.category')}
        data-testid="support-contact-category"
        className="w-full text-[14px] rounded-xl border border-slate-200 p-3 outline-none bg-white"
      >
        {CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {t(c.labelKey)}
          </option>
        ))}
      </select>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        placeholder={t('support.form.messagePlaceholder')}
        aria-label={t('support.form.message')}
        data-testid="support-contact-body"
        className="w-full text-[14px] rounded-xl border border-slate-200 p-3 outline-none resize-y"
      />
      <fieldset className="flex items-center gap-4 text-[13px] text-slate-600">
        <span className="text-slate-400">{t('support.form.reachBy')}</span>
        {(['EMAIL', 'PHONE'] as const).map((p) => {
          const disabled = p === 'PHONE'; // phone support not yet available (Fix 6)
          return (
            <label
              key={p}
              className={`flex items-center gap-1.5 ${
                disabled ? 'cursor-not-allowed text-slate-300' : 'cursor-pointer'
              }`}
            >
              <input
                type="radio"
                name="contactPreference"
                checked={pref === p}
                disabled={disabled}
                onChange={() => setPref(p)}
                // data-no-min-target opts out of the globals.css 44×44 WCAG
                // touch-target floor, which balloons raw radios and breaks this
                // row (the admin app has no such floor, so it looked fine there).
                // The label is the touch target, so the radio stays a 16px square
                // with the brand accent — mirrors the CaregiversCard fix (#79).
                data-no-min-target
                className="h-4 w-4 shrink-0 accent-[var(--brand-primary-purple)] cursor-pointer disabled:cursor-not-allowed"
              />
              {p === 'EMAIL' ? t('support.form.email') : t('support.form.phone')}
              {disabled && (
                <span className="text-[11px] text-slate-400">{t('support.form.comingSoon')}</span>
              )}
            </label>
          );
        })}
      </fieldset>
      {err && <p className="text-[13px] text-red-600">{err}</p>}
      <button
        type="submit"
        disabled={busy || !subject.trim() || !body.trim()}
        data-testid="support-contact-submit"
        className="h-11 px-6 rounded-full bg-[#7B00E0] text-white text-sm font-semibold disabled:opacity-50 hover:bg-[#6600BC] transition-colors"
      >
        {busy ? t('support.form.sending') : t('support.form.send')}
      </button>
    </form>
  );
}
