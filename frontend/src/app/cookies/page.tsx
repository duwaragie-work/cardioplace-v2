import type { Metadata } from 'next';
import PendingPolicyPage from '@/components/cardio/policy/PendingPolicyPage';

/** Cookie Policy — pairs with the cookie consent banner. Awaiting legal copy. */
export const metadata: Metadata = {
  title: 'Cookie Policy — Cardioplace',
  robots: { index: false, follow: false },
};

export default function CookiePolicyPage() {
  return (
    <PendingPolicyPage
      kind="cookies"
      title="Cookie Policy"
      intro="How Cardioplace uses cookies and similar technologies."
    />
  );
}
