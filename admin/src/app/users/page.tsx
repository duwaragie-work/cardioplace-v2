'use client';

// /users — admin user management. Phase/23.
//
// Role gate: COORDINATOR, HEALPLACE_OPS, SUPER_ADMIN. Anyone else gets
// the same 403 card the /patients page renders for unauthorized roles
// (see admin/src/app/patients/page.tsx for the mirror pattern).

import Link from 'next/link';
import { Shield } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { canManageUsers } from '@/lib/roleGates';
import UserInvitePanel from '@/components/user-management/UserInvitePanel';

export default function UsersPage() {
  const { user, isLoading } = useAuth();

  if (isLoading) return null;
  if (!user) return null;

  if (!canManageUsers(user)) {
    return (
      <div
        className="h-full flex items-center justify-center"
        style={{ backgroundColor: 'var(--brand-background)' }}
      >
        <div
          className="text-center p-8 rounded-2xl bg-white max-w-sm"
          style={{ boxShadow: 'var(--brand-shadow-card)' }}
          data-testid="admin-users-access-denied"
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
            You need Coordinator, HEALPLACE OPS, or Super Admin access to manage users.
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
      <UserInvitePanel />
    </div>
  );
}
