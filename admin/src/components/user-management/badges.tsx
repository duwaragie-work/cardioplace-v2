'use client';

// Shared role + status badge components used across the user-management UI.

import type { UserRole } from '@/lib/roleGates';
import type { UserListStatus } from '@/lib/services/user-management.service';

function roleLabel(role: UserRole): string {
  switch (role) {
    case 'PATIENT':
      return 'Patient';
    case 'PROVIDER':
      return 'Provider';
    case 'MEDICAL_DIRECTOR':
      return 'MD';
    case 'COORDINATOR':
      return 'Coordinator';
    case 'HEALPLACE_OPS':
      return 'OPS';
    case 'SUPER_ADMIN':
      return 'Super Admin';
    default:
      return role;
  }
}

function roleChrome(role: UserRole): { bg: string; color: string } {
  switch (role) {
    case 'PATIENT':
      return {
        bg: 'var(--brand-primary-purple-light)',
        color: 'var(--brand-primary-purple)',
      };
    case 'PROVIDER':
      return {
        bg: 'var(--brand-warning-amber-light)',
        color: 'var(--brand-warning-amber)',
      };
    case 'MEDICAL_DIRECTOR':
      return {
        bg: 'var(--brand-alert-red-light)',
        color: 'var(--brand-alert-red)',
      };
    case 'COORDINATOR':
      return {
        bg: 'var(--brand-accent-teal-light)',
        color: 'var(--brand-accent-teal)',
      };
    case 'HEALPLACE_OPS':
      return { bg: '#E2E8F0', color: '#475569' };
    case 'SUPER_ADMIN':
      return { bg: '#FECACA', color: '#7F1D1D' };
    default:
      return {
        bg: 'var(--brand-background)',
        color: 'var(--brand-text-muted)',
      };
  }
}

export function RoleBadge({ role }: { role: UserRole }) {
  const c = roleChrome(role);
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide"
      style={{ backgroundColor: c.bg, color: c.color }}
    >
      {roleLabel(role)}
    </span>
  );
}

interface StatusBadgeProps {
  status: UserListStatus;
  /** Override the text content (used for the COORDINATOR-scoped patient list
   *  where the backend returns user-facing strings like "Active"/"Deactivated"
   *  directly, not the underlying enum). */
  label?: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  let bg: string;
  let color: string;
  let text: string;
  switch (status) {
    case 'ACTIVE':
      bg = 'var(--brand-success-green-light)';
      color = 'var(--brand-success-green)';
      text = label ?? 'Active';
      break;
    case 'INVITE_PENDING':
      bg = 'var(--brand-warning-amber-light)';
      color = 'var(--brand-warning-amber)';
      text = label ?? 'Invite Pending';
      break;
    case 'DEACTIVATED':
      bg = '#E5E7EB';
      color = '#374151';
      text = label ?? 'Deactivated';
      break;
    case 'BLOCKED':
    case 'SUSPENDED':
      bg = 'var(--brand-alert-red-light)';
      color = 'var(--brand-alert-red)';
      text = label ?? (status === 'BLOCKED' ? 'Blocked' : 'Suspended');
      break;
    default:
      bg = 'var(--brand-background)';
      color = 'var(--brand-text-muted)';
      text = label ?? String(status);
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide whitespace-nowrap"
      style={{ backgroundColor: bg, color }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      {text}
    </span>
  );
}

export { roleLabel };
