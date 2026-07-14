'use client';

// <AuditAccessGate/> — the HIPAA audit-console entry gate (sprint L1,
// §164.312(b)). Wraps the L2 audit-review console: a reviewer sees the console
// ONLY when they (1) hold an org-wide audit role (canManageAudit → SUPER_ADMIN /
// HEALPLACE_OPS), AND (2) have acknowledged the CURRENT Rules of Behavior.
// Un-acknowledged reviewers get a click-through ROB card; the acknowledgment is
// recorded on the AuthLog audit trail via POST /v2/auth/training-ack. Mirrors
// the access-denied card in admin/src/app/support/page.tsx.
//
// Usage (L2): wrap the console page —
//   <AuditAccessGate><AuditConsole /></AuditAccessGate>

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Shield, ClipboardCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { canManageAudit } from '@/lib/roleGates';
import { acknowledgeTraining, getTrainingAckStatus } from '@/lib/services/audit.service';

function GateCard({
  icon,
  iconBg,
  title,
  children,
  testId,
}: {
  icon: ReactNode;
  iconBg: string;
  title: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <div
      className="h-full flex items-center justify-center"
      style={{ backgroundColor: 'var(--brand-background)' }}
    >
      <div
        className="text-center p-8 rounded-2xl bg-white max-w-md"
        style={{ boxShadow: 'var(--brand-shadow-card)' }}
        data-testid={testId}
      >
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ backgroundColor: iconBg }}
        >
          {icon}
        </div>
        <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
          {title}
        </h1>
        {children}
      </div>
    </div>
  );
}

export default function AuditAccessGate({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const [ackState, setAckState] = useState<'checking' | 'needed' | 'ok'>('checking');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasRole = canManageAudit(user);

  useEffect(() => {
    if (isLoading || !user || !hasRole) return;
    let cancelled = false;
    setAckState('checking');
    getTrainingAckStatus()
      .then((s) => {
        if (!cancelled) setAckState(s.acknowledged ? 'ok' : 'needed');
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your acknowledgment status. Please retry.');
      });
    return () => {
      cancelled = true;
    };
  }, [isLoading, user, hasRole]);

  const onAcknowledge = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      await acknowledgeTraining();
      setAckState('ok');
    } catch {
      setError('Could not record your acknowledgment. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, []);

  if (isLoading || !user) return null;

  // ── Role gate — mirror of backend @Roles(SUPER_ADMIN, HEALPLACE_OPS) ──
  if (!hasRole) {
    return (
      <GateCard
        testId="audit-access-denied"
        iconBg="var(--brand-alert-red-light)"
        icon={<Shield className="w-7 h-7" style={{ color: 'var(--brand-alert-red)' }} />}
        title="403 Access Denied"
      >
        <p className="text-sm mb-4" style={{ color: 'var(--brand-text-muted)' }}>
          You need Super Admin or HEALPLACE OPS access to view audit records.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold text-white transition hover:opacity-90"
          style={{ backgroundColor: 'var(--brand-primary-purple)' }}
        >
          Go to Dashboard
        </Link>
      </GateCard>
    );
  }

  // While the ack status is loading, render nothing (avoids a flash of the ROB
  // card for reviewers who have already acknowledged).
  if (ackState === 'checking') return null;

  // ── Rules-of-Behavior acknowledgment gate ──
  if (ackState === 'needed') {
    return (
      <GateCard
        testId="audit-training-ack-gate"
        iconBg="var(--brand-primary-purple-light, #f5f0ff)"
        icon={<ClipboardCheck className="w-7 h-7" style={{ color: 'var(--brand-primary-purple)' }} />}
        title="Rules of Behavior"
      >
        {/* TODO(compliance): replace with Humaira's signed-off Rules-of-Behavior
            text before pilot. This placeholder conveys the intent only. */}
        <p className="text-sm mb-4 text-left" style={{ color: 'var(--brand-text-muted)' }}>
          Audit records contain protected health information (PHI). By continuing you
          confirm that you will access these records only for legitimate oversight
          purposes, will not disclose them outside authorized workflows, and understand
          that all access is itself logged and that misuse may result in sanctions.
        </p>
        {error && (
          <p className="text-sm mb-3" style={{ color: 'var(--brand-alert-red)' }}>
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={onAcknowledge}
          disabled={submitting}
          data-testid="audit-training-ack-button"
          className="inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          style={{ backgroundColor: 'var(--brand-primary-purple)' }}
        >
          {submitting ? 'Recording…' : 'I Acknowledge'}
        </button>
      </GateCard>
    );
  }

  return <>{children}</>;
}
