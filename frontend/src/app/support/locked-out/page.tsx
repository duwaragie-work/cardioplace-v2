'use client';

// Public, unauthenticated "I can't sign in" form. Allow-listed in proxy.ts.

import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { submitLockedOut } from '@/lib/services/support.service';

const STATUS_BANNER =
  'You can also check the status of an existing request by clicking the link in your confirmation email.';

export default function LockedOutPage() {
  const [email, setEmail] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
      setErr(e2 instanceof Error ? e2.message : 'Could not submit your request.');
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
          <h1 className="text-2xl font-bold text-slate-800">Need help signing in?</h1>
          <p className="text-sm text-slate-500 mt-1">
            Tell us what’s happening and our team will call you to verify your identity
            before making any account changes.
          </p>
        </div>

        {done ? (
          <div
            data-testid="locked-out-success"
            className="rounded-2xl bg-white border border-slate-200 p-6 text-center"
          >
            <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
            <p className="text-[14px] text-slate-700">
              Thanks — your request <span className="font-mono">{done}</span> is in. Our
              team will reach out to verify your identity before any changes are made.
            </p>
            <p className="text-[12px] text-slate-400 mt-3">{STATUS_BANNER}</p>
            <Link
              href="/sign-in"
              className="inline-block mt-4 text-[13px] font-semibold text-[#7B00E0]"
            >
              Back to sign in
            </Link>
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
              placeholder="Your account email"
              aria-label="Email"
              data-testid="locked-out-email"
              className="w-full text-[14px] rounded-xl border border-slate-200 p-3 outline-none"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="What’s happening? (e.g. I lost my authenticator app and recovery codes)"
              aria-label="Description"
              data-testid="locked-out-description"
              className="w-full text-[14px] rounded-xl border border-slate-200 p-3 outline-none resize-y"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Callback phone (optional)"
              aria-label="Callback phone"
              className="w-full text-[14px] rounded-xl border border-slate-200 p-3 outline-none"
            />
            {err && <p className="text-[13px] text-red-600">{err}</p>}
            <button
              type="submit"
              disabled={busy || !email.trim() || !description.trim()}
              data-testid="locked-out-submit"
              className="w-full h-11 rounded-full bg-[#7B00E0] text-white text-sm font-semibold disabled:opacity-50 hover:bg-[#6600BC] transition-colors"
            >
              {busy ? 'Submitting…' : 'Request help'}
            </button>
            <p className="text-[12px] text-slate-400 text-center">{STATUS_BANNER}</p>
          </form>
        )}

        <div className="text-center mt-4">
          <Link href="/sign-in" className="text-[13px] text-slate-500">
            ← Back to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
