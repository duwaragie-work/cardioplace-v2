'use client';

// Phase/24 — Provider leaderboard. Same card shape as the tier table.
// Rows are pre-sorted server-side by `alertsTouched` desc.

import { Bot, User } from 'lucide-react';
import type { ProviderLeaderboardRow } from '@cardioplace/shared';
import { formatDuration } from '@/lib/services/reports.service';

interface Props {
  rows: ProviderLeaderboardRow[];
}

function initialsFor(name: string): string {
  return name
    .split(/\s+|@/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function Avatar({ row }: { row: ProviderLeaderboardRow }) {
  if (row.providerId === null) {
    return (
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={{
          backgroundColor: 'var(--brand-background)',
          color: 'var(--brand-text-muted)',
        }}
        aria-hidden
      >
        <Bot className="w-4 h-4" />
      </div>
    );
  }
  const ini = initialsFor(row.name);
  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold"
      style={{
        backgroundColor: 'var(--brand-primary-purple-light)',
        color: 'var(--brand-primary-purple)',
      }}
      aria-hidden
    >
      {ini || <User className="w-4 h-4" />}
    </div>
  );
}

export default function ReportByProviderTable({ rows }: Props) {
  const hasAny = rows.length > 0;

  return (
    <section
      className="bg-white rounded-2xl overflow-hidden"
      style={{ boxShadow: 'var(--brand-shadow-card)' }}
      aria-label="Provider leaderboard"
      data-testid="report-by-provider"
    >
      <div
        className="px-5 py-3 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--brand-border)' }}
      >
        <h2
          className="text-[13px] font-bold uppercase tracking-wider"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          By provider
        </h2>
        <span
          className="text-[11px]"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          {rows.length} {rows.length === 1 ? 'actor' : 'actors'}
        </span>
      </div>

      {!hasAny && (
        <div
          className="px-5 py-10 text-center text-[13px]"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          No provider activity in this window.
        </div>
      )}

      {/* Desktop table — lg+ */}
      {hasAny && (
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full">
            <thead style={{ backgroundColor: 'var(--brand-background)' }}>
              <tr>
                <th
                  scope="col"
                  className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  Provider
                </th>
                <th
                  scope="col"
                  className="text-right px-3 py-3 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  Alerts touched
                </th>
                <th
                  scope="col"
                  className="text-right px-3 py-3 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  Acknowledged
                </th>
                <th
                  scope="col"
                  className="text-right px-3 py-3 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  Resolved
                </th>
                <th
                  scope="col"
                  className="text-right px-5 py-3 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  Mean ack
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr
                  key={`${r.providerId ?? 'system'}-${idx}`}
                  style={{ borderTop: '1px solid var(--brand-border)' }}
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar row={r} />
                      <span
                        className="text-[12px] font-semibold truncate"
                        style={{
                          color:
                            r.providerId === null
                              ? 'var(--brand-text-muted)'
                              : 'var(--brand-text-primary)',
                        }}
                      >
                        {r.name}
                      </span>
                    </div>
                  </td>
                  <td
                    className="px-3 py-3 text-right text-[12px] font-bold"
                    style={{ color: 'var(--brand-text-primary)' }}
                  >
                    {r.alertsTouched}
                  </td>
                  <td
                    className="px-3 py-3 text-right text-[12px]"
                    style={{ color: 'var(--brand-text-secondary)' }}
                  >
                    {r.acknowledgedCount}
                  </td>
                  <td
                    className="px-3 py-3 text-right text-[12px]"
                    style={{ color: 'var(--brand-text-secondary)' }}
                  >
                    {r.resolvedCount}
                  </td>
                  <td
                    className="px-5 py-3 text-right text-[12px]"
                    style={{ color: 'var(--brand-text-secondary)' }}
                  >
                    {formatDuration(r.meanAckSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile / tablet cards */}
      {hasAny && (
        <div className="lg:hidden">
          {rows.map((r, idx) => (
            <div
              key={`${r.providerId ?? 'system'}-card-${idx}`}
              className="px-5 py-4"
              style={{
                borderTop: idx > 0 ? '1px solid var(--brand-border)' : undefined,
              }}
            >
              <div className="flex items-center gap-2.5 mb-3 min-w-0">
                <Avatar row={r} />
                <div className="min-w-0 flex-1">
                  <p
                    className="text-[13px] font-semibold truncate"
                    style={{
                      color:
                        r.providerId === null
                          ? 'var(--brand-text-muted)'
                          : 'var(--brand-text-primary)',
                    }}
                  >
                    {r.name}
                  </p>
                  <p
                    className="text-[11px]"
                    style={{ color: 'var(--brand-text-muted)' }}
                  >
                    {r.alertsTouched} alerts touched
                  </p>
                </div>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-[11px]">
                <Stat label="Acked" value={String(r.acknowledgedCount)} />
                <Stat label="Resolved" value={String(r.resolvedCount)} />
                <Stat label="Mean ack" value={formatDuration(r.meanAckSeconds)} />
              </dl>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="px-2 py-1.5 rounded-lg text-center"
      style={{ backgroundColor: 'var(--brand-background)' }}
    >
      <dt
        className="text-[10px] uppercase tracking-wider font-semibold"
        style={{ color: 'var(--brand-text-muted)' }}
      >
        {label}
      </dt>
      <dd
        className="font-bold mt-0.5"
        style={{ color: 'var(--brand-text-primary)' }}
      >
        {value}
      </dd>
    </div>
  );
}
