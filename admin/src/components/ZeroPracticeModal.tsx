'use client';

/**
 * Phase/practice-identity (Manisha 2026-06-12 Access Control §1).
 *
 * Defensive zero-state modal. The backend already blocks sign-in for a
 * PROVIDER / MEDICAL_DIRECTOR / COORDINATOR with zero memberships
 * (`resolvePracticeContext` returns `kind:'blocked'`), but a stale session
 * COULD survive if an admin removes the user's last membership while
 * they're already signed in. In that case JwtStrategy throws
 * PRACTICE_MEMBERSHIP_REVOKED on the next request and the FE bounces them
 * to /sign-in/select-practice, BUT a brief window exists between the
 * removal and the next request where the cached `activePractice` is null.
 * This modal is the belt-and-suspenders for that window — visually blocks
 * the dashboard until the user signs out.
 *
 * Not shown for SUPER_ADMIN / HEALPLACE_OPS (they legitimately act with
 * NULL practice context).
 */

import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';

const ORG_WIDE_ROLES = new Set(['SUPER_ADMIN', 'HEALPLACE_OPS']);
const PRACTICE_BOUND_ROLES = new Set([
  'PROVIDER',
  'MEDICAL_DIRECTOR',
  'COORDINATOR',
]);

export default function ZeroPracticeModal() {
  const { user, activePractice, logout } = useAuth();
  const { t } = useLanguage();

  // Only fire for practice-bound roles. Org-wide admins legitimately act
  // with NULL practice context — the modal would be wrong-headed for them.
  const roles = user?.roles ?? [];
  const isOrgWide = roles.some((r) => ORG_WIDE_ROLES.has(r));
  const isPracticeBound = roles.some((r) => PRACTICE_BOUND_ROLES.has(r));
  if (!user || !isPracticeBound || isOrgWide || activePractice) {
    return null;
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="zero-practice-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white px-6 py-7 shadow-xl">
        <h2
          id="zero-practice-title"
          className="text-xl font-semibold text-gray-900 mb-3"
        >
          {t('signIn.zeroPractice.title')}
        </h2>
        <p className="text-sm text-gray-600 mb-6">
          {t('signIn.zeroPractice.body')}
        </p>
        <button
          type="button"
          onClick={() => void logout()}
          className="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-white text-sm font-medium hover:bg-purple-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
        >
          {t('signIn.selectPractice.expired.back')}
        </button>
      </div>
    </div>
  );
}
