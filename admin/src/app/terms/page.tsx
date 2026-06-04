'use client';

// Admin-app-facing Terms of Service for the Cardioplace v2 pilot.
//
// Counsel-applied content (v2026-05-20). Previous counsel-reviewed
// version was v2026-05-08; this revision adds: DC medical licensure
// + annual training + BAA cross-reference (§1), HIPAA Minimum
// Necessary standard (§3), 24-hour incident reporting timeframe
// (§8), organizational offboarding responsibility (§9), Terms-
// change notification process (§10). Do not edit wording without
// legal/compliance sign-off.

import {
  PolicyContact,
  PolicySection,
  PolicyShell,
} from '@/components/policy/PolicyShell';

export default function TermsPage() {
  return (
    <PolicyShell
      kind="terms"
      title="Admin Terms of Service"
      intro="These Terms govern access to the Cardioplace admin platform operated by Healplace.com, Inc."
      lastUpdated="May 20, 2026"
    >
      <PolicySection number="1" title="Eligibility">
        <p>You may access the platform only if:</p>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>You are authorized by a participating organization.</li>
          <li>
            You hold any required licenses or credentials. Clinical users
            practicing in the District of Columbia must hold an active
            license issued by the DC Department of Health Board of Medicine
            (or equivalent licensing body for your role).
          </li>
          <li>
            You have completed required HIPAA and privacy training. Training
            must be renewed annually.
          </li>
        </ul>
        <p>
          Your organization&apos;s use of Cardioplace is governed by a
          separate Business Associate Agreement (BAA) executed between
          Healplace.com, Inc. and the organization. Nothing in these Terms
          supersedes the BAA.
        </p>
      </PolicySection>

      <PolicySection number="2" title="Accounts and security">
        <p>Accounts are individual and may not be shared.</p>
        <p>
          Authentication occurs using one-time codes or secure sign-in links
          delivered to your work email.
        </p>
        <p>You are responsible for:</p>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>Maintaining the security of your email account.</li>
          <li>Preventing unauthorized access.</li>
          <li>Reporting suspected compromise immediately.</li>
        </ul>
      </PolicySection>

      <PolicySection number="3" title="Permitted use">
        <p>
          You may use Cardioplace solely for authorized healthcare
          operations, treatment, payment, and care coordination purposes.
        </p>
        <p>
          You must access only the minimum patient information necessary to
          perform your authorized function, consistent with the HIPAA
          Minimum Necessary standard (45 CFR § 164.502(b)).
        </p>
        <p>You may not:</p>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>Access records without authorization.</li>
          <li>Share patient information outside approved workflows.</li>
          <li>Record or distribute protected information.</li>
          <li>Attempt to bypass security controls.</li>
          <li>Use the platform for non-clinical purposes.</li>
        </ul>
      </PolicySection>

      <PolicySection number="4" title="Clinical responsibility">
        <p>
          Cardioplace provides clinical workflow support and escalation
          tools. Clinical decisions remain the responsibility of the treating
          licensed clinician.
        </p>
        <p>Cardioplace does not independently diagnose or treat patients.</p>
      </PolicySection>

      <PolicySection number="5" title="Alert response expectations">
        <p>
          Organizations using Cardioplace are responsible for maintaining
          appropriate on-call coverage and escalation workflows.
        </p>
        <p>
          Alert acknowledgments, resolutions, and escalation activity are
          logged for compliance and patient-safety review.
        </p>
      </PolicySection>

      <PolicySection number="6" title="Audit trails">
        <p>All platform activity may be logged, including:</p>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>Sign-ins.</li>
          <li>Record access.</li>
          <li>Alert actions.</li>
          <li>Communication activity.</li>
          <li>Threshold changes.</li>
        </ul>
        <p>
          Audit records are retained in accordance with legal and compliance
          requirements.
        </p>
      </PolicySection>

      <PolicySection number="7" title="Pilot status">
        <p>
          Certain Cardioplace deployments may operate as pilot-stage services
          undergoing active clinical evaluation. Features may evolve over
          time.
        </p>
        <p>
          Service commitments may be governed separately by enterprise
          agreements or participation agreements.
        </p>
      </PolicySection>

      <PolicySection number="8" title="Security requirements">
        <p>Users must:</p>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>Protect patient information.</li>
          <li>Lock unattended devices.</li>
          <li>Use organization-approved devices.</li>
          <li>
            Report suspected incidents immediately, and in any event no later
            than 24 hours after discovery.
          </li>
        </ul>
      </PolicySection>

      <PolicySection number="9" title="Suspension and termination">
        <p>Access may be suspended or terminated if:</p>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>Organizational authorization ends.</li>
          <li>Security or compliance concerns arise.</li>
          <li>These Terms are violated.</li>
        </ul>
        <p>
          Upon termination of employment or removal of authorization, the
          participating organization is responsible for promptly disabling
          user access to Cardioplace.
        </p>
      </PolicySection>

      <PolicySection number="10" title="Changes to these Terms">
        <p>
          We may update these Terms periodically. Material changes will be
          communicated to participating organizations and, where appropriate,
          individual users in advance of the effective date. Continued use
          after the effective date constitutes acceptance of the updated
          Terms.
        </p>
      </PolicySection>

      <PolicySection number="11" title="Limitation of liability">
        <p>
          To the maximum extent permitted by law, Healplace.com, Inc. shall
          not be liable for indirect, incidental, or consequential damages
          arising from use of the platform, except where prohibited by law.
        </p>
      </PolicySection>

      <PolicySection number="12" title="Governing law">
        <p>These Terms are governed by the laws of the District of Columbia.</p>
      </PolicySection>

      <PolicyContact
        heading="Contact"
        emails={[
          'support@healplace.com',
          'privacy@healplace.com',
          'security@healplace.com',
        ]}
      />
    </PolicyShell>
  );
}
