import type { Metadata } from 'next';
import PendingPolicyPage from '@/components/cardio/policy/PendingPolicyPage';

/**
 * Accessibility Statement — WCAG conformance and how to request
 * accommodations (Section 508-aligned). Awaiting legal copy.
 */
export const metadata: Metadata = {
  title: 'Accessibility Statement — Cardioplace',
  robots: { index: false, follow: false },
};

export default function AccessibilityPage() {
  return (
    <PendingPolicyPage
      kind="accessibility"
      title="Accessibility Statement"
      intro="Our accessibility commitments and how to request an accommodation."
    />
  );
}
