'use client';

import { useCallback, useEffect, useState } from 'react';
import { LifeBuoy, Search } from 'lucide-react';
import {
  listTickets,
  type SupportTicketRow,
} from '@/lib/services/support.service';
import TicketCard from './TicketCard';

// CLOSED is the terminal state the auto-close cron sets 14 days after resolve.
// Without it here, closed tickets were unfilterable and invisible to triage.
const STATUSES = ['', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const CATEGORIES = ['', 'ACCOUNT', 'MFA', 'CLINICAL', 'BUG', 'OTHER'];
const PRIORITIES = ['', 'HIGH', 'NORMAL', 'LOW'];

export default function SupportQueue() {
  const [rows, setRows] = useState<SupportTicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listTickets({ status, category, priority, search, limit: 100 });
      setRows(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load tickets');
    } finally {
      setLoading(false);
    }
  }, [status, category, priority, search]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 md:py-8">
      <div className="flex items-center gap-3 mb-6">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
          style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
        >
          <LifeBuoy className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--brand-text-primary)' }}>
            Support
          </h1>
          <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
            Triage tickets, verify identity, and run account actions.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-2 px-3 h-9 rounded-full bg-white border border-slate-200 flex-1 min-w-[180px]">
          <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ticket #, email, subject, Cardioplace ID"
            aria-label="Search tickets"
            data-testid="support-search"
            className="flex-1 text-[12px] outline-none bg-transparent min-w-0"
          />
        </div>
        <Select value={status} onChange={setStatus} options={STATUSES} label="Status" />
        <Select value={category} onChange={setCategory} options={CATEGORIES} label="Category" />
        <Select value={priority} onChange={setPriority} options={PRIORITIES} label="Priority" />
      </div>

      <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
        {loading ? (
          <p className="px-4 py-10 text-center text-[13px] text-slate-400">Loading…</p>
        ) : error ? (
          <p className="px-4 py-10 text-center text-[13px] text-red-600">{error}</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-slate-400" data-testid="support-empty">
            No tickets match these filters.
          </p>
        ) : (
          rows.map((t) => <TicketCard key={t.id} ticket={t} />)
        )}
      </div>
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  label: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="h-9 px-3 rounded-full bg-white border border-slate-200 text-[12px] text-slate-600 outline-none"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o === '' ? `All ${label.toLowerCase()}` : o.replace('_', ' ')}
        </option>
      ))}
    </select>
  );
}
