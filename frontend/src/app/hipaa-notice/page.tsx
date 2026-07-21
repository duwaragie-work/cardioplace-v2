import type { Metadata } from 'next';
import PendingPolicyPage from '@/components/cardio/policy/PendingPolicyPage';

/**
 * HIPAA Notice of Privacy Practices — the non-optional one for a clinical app
 * (how PHI is used/disclosed and the patient's rights: access, amendment,
 * accounting of disclosures).
 *
 * This file is a SERVER component purely so it can export `metadata`. Next
 * cannot export metadata from a client component, and PolicyShell is
 * `'use client'` — so the noindex would silently not happen if the whole route
 * were a client component. Awaiting copy from legal: noindex + unlinked.
 */
export const metadata: Metadata = {
  title: 'HIPAA Notice of Privacy Practices — Cardioplace',
  robots: { index: false, follow: false },
};

export default function HipaaNoticePage() {
  return (
    <PendingPolicyPage
      kind="hipaa"
      title="HIPAA Notice of Privacy Practices"
      intro="How your health information is used and disclosed, and your rights over it."
    />
  );
}
