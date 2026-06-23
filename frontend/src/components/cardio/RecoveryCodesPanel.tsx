'use client';

// Shows a freshly-generated set of biometric recovery codes ONCE, with copy /
// download and a "I saved them" acknowledgement. Used at first biometric
// setup, after a recovery-code sign-in (regenerated set), and from Settings
// (regenerate). The codes can't be shown again, so we make saving them the
// gate before continuing.

import { useState } from 'react';
import { KeyRound, Copy, Check, Download, AlertTriangle } from 'lucide-react';

interface Props {
  codes: string[];
  /** Called once the patient confirms they've saved the codes. */
  onAcknowledge: () => void;
  acknowledgeLabel?: string;
}

export default function RecoveryCodesPanel({
  codes,
  onAcknowledge,
  acknowledgeLabel = 'I’ve saved my codes — continue',
}: Props) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  function copy() {
    void navigator.clipboard?.writeText(codes.join('\n')).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  function download() {
    const blob = new Blob(
      [
        'Cardioplace — biometric recovery codes\n',
        'Keep these somewhere safe. Each code works once.\n',
        'Use one to sign in if you cannot use Face ID / fingerprint.\n\n',
        codes.join('\n'),
        '\n',
      ],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cardioplace-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div
        className="mb-4 flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm"
        style={{
          backgroundColor: 'var(--brand-warning-amber-light, #FEF3C7)',
          color: 'var(--brand-warning-amber-text, #92400E)',
        }}
        role="status"
      >
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          <strong>Save these recovery codes now.</strong> They&apos;re the only
          way to sign in if you ever can&apos;t use Face ID / fingerprint (for
          example on a new phone). They won&apos;t be shown again.
        </span>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <KeyRound className="w-4 h-4 text-gray-700" />
        <h2 className="text-sm font-bold text-gray-900">Your recovery codes</h2>
      </div>

      <ul
        data-testid="recovery-codes-list"
        className="grid grid-cols-2 gap-2 rounded-xl border border-[#e5d9f2] bg-gray-50 p-4 font-mono text-[13px] tracking-wider text-gray-800"
      >
        {codes.map((rc) => (
          <li key={rc} className="text-center py-1">
            {rc}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex gap-3">
        <button
          type="button"
          onClick={copy}
          className="flex-1 h-11 rounded-lg border border-[#e5d9f2] font-semibold text-sm text-[#7B00E0] hover:bg-[#7B00E0]/5 transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={download}
          className="flex-1 h-11 rounded-lg border border-[#e5d9f2] font-semibold text-sm text-[#7B00E0] hover:bg-[#7B00E0]/5 transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
        >
          <Download className="w-4 h-4" />
          Download
        </button>
      </div>

      <label className="mt-5 flex items-start gap-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          data-testid="recovery-codes-ack"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="mt-0.5 w-4 h-4 accent-[#7B00E0]"
        />
        <span className="text-sm text-gray-700">
          I&apos;ve saved my recovery codes somewhere safe.
        </span>
      </label>

      <button
        type="button"
        data-testid="recovery-codes-continue"
        onClick={onAcknowledge}
        disabled={!saved}
        className="mt-5 w-full h-14 bg-[#7B00E0] rounded-full shadow-[0px_10px_15px_rgba(123,0,224,0.25)] font-semibold text-white text-base hover:bg-[#6600BC] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {acknowledgeLabel}
      </button>
    </div>
  );
}
