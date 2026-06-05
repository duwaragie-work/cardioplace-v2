'use client';

// /reports — Monthly Practice Analytics Report (phase/24).
//
// Role gate: MEDICAL_DIRECTOR, HEALPLACE_OPS, SUPER_ADMIN. Mirrors the
// 403 card layout from /users + /patients for consistency.

import Link from 'next/link';
import { Shield } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { canViewReports } from '@/lib/roleGates';
import ReportsPanel from '@/components/reports/ReportsPanel';

export default function ReportsPage() {
  const { user, isLoading } = useAuth();

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
      <ReportsPanel />
    </div>
  );
}
