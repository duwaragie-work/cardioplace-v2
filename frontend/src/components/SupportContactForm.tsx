'use client';

import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import {
  submitContact,
  type SupportCategory,
} from '@/lib/services/support.service';

const CATEGORIES: { value: SupportCategory; label: string }[] = [
  { value: 'ACCOUNT', label: 'Account' },
  { value: 'MFA', label: 'MFA' },
  { value: 'CLINICAL', label: 'Clinical question' },
  { value: 'BUG', label: 'Bug' },
  { value: 'OTHER', label: 'Other' },
];

/** In-app "Contact support" form for signed-in patients → /v2/support/contact. */
export default function SupportContactForm() {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<SupportCategory>('ACCOUNT');
  const [pref, setPref] = useState<'EMAIL' | 'PHONE' | ''>('');
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
        contactPreference: pref || undefined,
      });
      setDone(r.ticketNumber);
      setSubject('');
      setBody('');
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not send your message.');
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
        Thanks — your request <span className="font-mono">{done}</span> was received. We’ll
        get back to you by email.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="support-contact-form">
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject"
        aria-label="Subject"
        data-testid="support-contact-subject"
        className="w-full text-[14px] rounded-xl border border-slate-200 p-3 outline-none"
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value as SupportCategory)}
        aria-label="Category"
        data-testid="support-contact-category"
        className="w-full text-[14px] rounded-xl border border-slate-200 p-3 outline-none bg-white"
      >
        {CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        placeholder="How can we help?"
        aria-label="Message"
        data-testid="support-contact-body"
        className="w-full text-[14px] rounded-xl border border-slate-200 p-3 outline-none resize-y"
      />
      <fieldset className="flex items-center gap-4 text-[13px] text-slate-600">
        <span className="text-slate-400">Prefer to be reached by:</span>
        {(['EMAIL', 'PHONE'] as const).map((p) => (
          <label key={p} className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="contactPreference"
              checked={pref === p}
              onChange={() => setPref(p)}
              // data-no-min-target opts out of the globals.css 44×44 WCAG
              // touch-target floor, which balloons raw radios and breaks this
              // row (the admin app has no such floor, so it looked fine there).
              // The label is the touch target, so the radio stays a 16px square
              // with the brand accent — mirrors the CaregiversCard fix (#79).
              data-no-min-target
              className="h-4 w-4 shrink-0 accent-[var(--brand-primary-purple)] cursor-pointer"
            />
            {p === 'EMAIL' ? 'Email' : 'Phone'}
          </label>
        ))}
      </fieldset>
      {err && <p className="text-[13px] text-red-600">{err}</p>}
      <button
        type="submit"
        disabled={busy || !subject.trim() || !body.trim()}
        data-testid="support-contact-submit"
        className="h-11 px-6 rounded-full bg-[#7B00E0] text-white text-sm font-semibold disabled:opacity-50 hover:bg-[#6600BC] transition-colors"
      >
        {busy ? 'Sending…' : 'Send message'}
      </button>
    </form>
  );
}
