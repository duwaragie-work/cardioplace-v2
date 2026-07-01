'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';

export default function ReplyBox({
  onSend,
}: {
  onSend: (body: string) => Promise<void>;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try {
      await onSend(text);
      setBody('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">
        Reply to user
      </p>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Type a reply — it is emailed to the user and shown in their in-app notifications."
        data-testid="support-reply-input"
        className="w-full text-[13px] rounded-xl border border-slate-200 p-3 outline-none resize-y"
      />
      <div className="flex justify-end mt-2">
        <button
          type="button"
          onClick={send}
          disabled={busy || !body.trim()}
          data-testid="support-reply-send"
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-white text-sm font-semibold disabled:opacity-50"
          style={{ backgroundColor: 'var(--brand-primary-purple)' }}
        >
          <Send className="w-3.5 h-3.5" /> {busy ? 'Sending…' : 'Send reply'}
        </button>
      </div>
    </div>
  );
}
