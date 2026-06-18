'use client';

// /reports — Practice analytics. Two tabs:
//   • Monthly  — Monthly Practice Analytics Report (phase/24)
//   • Adherence — 90-day Medication Adherence Report (phase/25)
//
// Role gate: MEDICAL_DIRECTOR, HEALPLACE_OPS, SUPER_ADMIN. Mirrors the
// 403 card layout from /users + /patients for consistency.

import { useState } from 'react';
import Link from 'next/link';
import { ClipboardList, HeartPulse, Shield } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { canViewReports } from '@/lib/roleGates';
import ReportsPanel from '@/components/reports/ReportsPanel';
import AdherencePanel from '@/components/adherence/AdherencePanel';

type ReportTab = 'monthly' | 'adherence';

export default function ReportsPage() {
  const { user, isLoading } = useAuth();
  const [tab, setTab] = useState<ReportTab>('monthly');

  if (isLoading) return null;
  if (!user) return null;

  if (!canViewReports(user)) {
    return (
      <div
        className="h-full flex items-center justify-center"
        style={{ backgroundColor: 'var(--brand-background)' }}
      >
        <div
          className="text-center p-8 rounded-2xl bg-white max-w-sm"
          style={{ boxShadow: 'var(--brand-shadow-card)' }}
          data-testid="admin-reports-access-denied"
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: 'var(--brand-alert-red-light)' }}
          >
            <Shield
              className="w-7 h-7"
              style={{ color: 'var(--brand-alert-red)' }}
            />
          </div>
          <h1
            className="text-xl font-bold mb-2"
            style={{ color: 'var(--brand-text-primary)' }}
          >
            403 Access Denied
          </h1>
          <p
            className="text-sm mb-4"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            You need Medical Director, HEALPLACE OPS, or Super Admin access
            to view reports.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold text-white transition hover:opacity-90"
            style={{ backgroundColor: 'var(--brand-primary-purple)' }}
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full" style={{ backgroundColor: '#FAFBFF' }}>
      {/* Tab bar — same max width as the panels below so it lines up. */}
      <div className="max-w-[1200px] mx-auto px-4 md:px-8 pt-6">
        <div
          className="inline-flex items-center gap-1 p-1 rounded-full bg-white"
          style={{ boxShadow: 'var(--brand-shadow-card)' }}
          role="tablist"
          aria-label="Report type"
        >
          <TabButton
            active={tab === 'monthly'}
            onClick={() => setTab('monthly')}
            icon={<ClipboardList className="w-4 h-4" />}
            label="Monthly"
            testid="report-tab-monthly"
          />
          <TabButton
            active={tab === 'adherence'}
            onClick={() => setTab('adherence')}
            icon={<HeartPulse className="w-4 h-4" />}
            label="Adherence"
            testid="report-tab-adherence"
          />
        </div>
      </div>

      {tab === 'monthly' ? <ReportsPanel /> : <AdherencePanel />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  testid,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  testid: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testid}
      className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-[13px] font-semibold transition"
      style={{
        backgroundColor: active ? 'var(--brand-primary-purple)' : 'transparent',
        color: active ? 'white' : 'var(--brand-text-secondary)',
      }}
    >
      {icon}
      {label}
    </button>
  );
}
