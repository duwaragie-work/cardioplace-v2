'use client';

import { useState } from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';

export default function IdentityVerifyToggle({
  verified,
  onVerify,
}: {
  verified: boolean;
  onVerify: (rationale: string) => Promise<void>;
}) {
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);

  if (verified) {
    return (
      <div
        data-testid="support-identity-verified"
        className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-[13px] text-emerald-800"
      >
        <ShieldCheck className="w-4 h-4 shrink-0" />
        Identity verified — account actions are unlocked.
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white border border-amber-200 p-4">
      <div className="flex items-center gap-2 mb-2 text-[13px] font-semibold text-amber-800">
        <ShieldAlert className="w-4 h-4" /> Identity not verified
      </div>
      <p className="text-[12px] text-slate-500 mb-3">
        Confirm the requester’s identity before any reset, then record how you did it.
        Sensitive actions stay blocked until you attest here.
      </p>
      <textarea
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        rows={3}
        placeholder="How was identity verified? (e.g. matched security questions in the reply email; confirmed DOB + last visit date via clinic records)"
        aria-label="Verification rationale"
        data-testid="support-verify-rationale"
        className="w-full text-[13px] rounded-xl border border-slate-200 p-2.5 outline-none resize-y mb-3"
      />
      <button
        type="button"
        disabled={busy || !rationale.trim()}
        data-testid="support-verify-identity"
        onClick={async () => {
          setBusy(true);
          try {
            await onVerify(rationale.trim());
          } finally {
            setBusy(false);
          }
        }}
        className="h-9 px-4 rounded-full text-white text-sm font-semibold disabled:opacity-50"
        style={{ backgroundColor: 'var(--brand-primary-purple)' }}
      >
        {busy ? 'Recording…' : 'Verify identity'}
      </button>
    </div>
  );
}
