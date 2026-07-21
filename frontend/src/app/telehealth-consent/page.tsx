import type { Metadata } from 'next';
import PendingPolicyPage from '@/components/cardio/policy/PendingPolicyPage';

/**
 * Consent to Telehealth & Remote Monitoring — consent to remote BP monitoring
 * and communications (SMS/email), plus the limits of the service ("not for
 * emergencies — call 911"). Awaiting legal copy.
 */
export const metadata: Metadata = {
  title: 'Telehealth & Remote Monitoring Consent — Cardioplace',
  robots: { index: false, follow: false },
};

export default function TelehealthConsentPage() {
  return (
    <PendingPolicyPage
      kind="telehealth"
      title="Telehealth & Remote Monitoring Consent"
      intro="What you consent to when using remote blood-pressure monitoring, and the limits of this service."
    />
  );
}
