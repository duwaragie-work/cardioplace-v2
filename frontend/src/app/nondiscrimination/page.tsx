import type { Metadata } from 'next';
import PendingPolicyPage from '@/components/cardio/policy/PendingPolicyPage';

/**
 * Nondiscrimination Notice (ACA §1557) — nondiscrimination + language-assistance
 * taglines. Likely required given the federally-funded Ward 7/8 Medicare pilot;
 * legal to confirm applicability. Awaiting legal copy.
 */
export const metadata: Metadata = {
  title: 'Nondiscrimination Notice — Cardioplace',
  robots: { index: false, follow: false },
};

export default function NondiscriminationPage() {
  return (
    <PendingPolicyPage
      kind="nondiscrimination"
      title="Nondiscrimination Notice"
      intro="Our nondiscrimination commitments and available language assistance."
    />
  );
}
