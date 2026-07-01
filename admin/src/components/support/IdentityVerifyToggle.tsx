'use client';

import { useState } from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';

export default function IdentityVerifyToggle({
  verified,
  onVerify,
}: {
  verified: boolean;
  onVerify: (method: string, notes?: string) => Promise<void>;
}) {
  const [method, setMethod] = useState('Phone callback + security questions');
  const [notes, setNotes] = useState('');
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
        Verify the requester out-of-band (phone callback) before any reset. Sensitive
        actions are blocked until you confirm here.
      </p>
      <input
        value={method}
        onChange={(e) => setMethod(e.target.value)}
        placeholder="Verification method"
        aria-label="Verification method"
        className="w-full text-[13px] rounded-xl border border-slate-200 p-2.5 outline-none mb-2"
      />
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (e.g. confirmed DOB + last 4 of phone)"
        aria-label="Verification notes"
        className="w-full text-[13px] rounded-xl border border-slate-200 p-2.5 outline-none mb-3"
      />
      <button
        type="button"
        disabled={busy || !method.trim()}
        data-testid="support-verify-identity"
        onClick={async () => {
          setBusy(true);
          try {
            await onVerify(method.trim(), notes.trim() || undefined);
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
