'use client';

// Patient-facing Privacy Policy for the Cardioplace v2 pilot.
//
// Counsel-reviewed content (v2026-05-08), reflecting
// Cardioplace_Patient_Privacy_Policy.docx. Do not edit wording without
// legal/compliance sign-off.

import {
  PolicyContact,
  PolicySection,
  PolicyShell,
} from '@/components/cardio/policy/PolicyShell';

export default function PrivacyPage() {
  return (
    <PolicyShell
      kind="privacy"
      title="Privacy Policy"
      intro="How Healplace.com, Inc. collects, uses, stores, and protects your personal and health information when you use Cardioplace."
      lastUpdated="May 8, 2026"
    >
      <PolicySection number="1" title="Introduction">
        <p>
          This Privacy Policy explains how Healplace.com, Inc.
          (&quot;Healplace&quot;) collects, uses, stores, and protects
          personal and health information when you use Cardioplace.
        </p>
      </PolicySection>

      <PolicySection number="2" title="Information we collect">
        <p>The information we hold about you falls into the following groups:</p>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>
            <strong>Identity Information</strong> — name, date of birth,
            email address, phone number.
          </li>
          <li>
            <strong>Health Information</strong> — blood pressure readings,
            symptoms, medications, diagnoses, pregnancy status, care team
            assignments.
          </li>
          <li>
            <strong>Communication Information</strong> — chat messages, voice
            interactions and transcripts, escalation communications.
          </li>
          <li>
            <strong>Technical and Security Information</strong> — device
            identifiers, IP addresses, browser information, session activity,
            audit logs.
          </li>
        </ul>
      </PolicySection>

      <PolicySection number="3" title="How we use information">
        <ul className="list-disc pl-6 space-y-1.5">
          <li>Operate the Cardioplace platform.</li>
          <li>Run escalation and alert workflows.</li>
          <li>Support care coordination.</li>
          <li>Communicate with you.</li>
          <li>Maintain compliance and audit records.</li>
          <li>Improve the platform using de-identified and aggregated data.</li>
        </ul>
      </PolicySection>

      <PolicySection number="4" title="Who may access information">
        <p>Information may be shared with:</p>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>Your authorized care team.</li>
          <li>Authorized Healplace personnel.</li>
          <li>HIPAA-compliant service providers.</li>
          <li>Regulators or legal authorities where required by law.</li>
        </ul>
        <p>
          We do not sell personal information and do not use your
          information for advertising.
        </p>
      </PolicySection>

      <PolicySection number="5" title="Security">
        <ul className="list-disc pl-6 space-y-1.5">
          <li>Encryption in transit and at rest.</li>
          <li>Role-based access controls.</li>
          <li>Audit logging.</li>
          <li>Access monitoring.</li>
          <li>Secure infrastructure hosted in the United States.</li>
        </ul>
      </PolicySection>

      <PolicySection number="6" title="Retention">
        <p>Clinical and audit records may be retained as required by:</p>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>HIPAA.</li>
          <li>Medical record retention laws.</li>
          <li>Joint Commission standards.</li>
          <li>Participating clinic policies.</li>
        </ul>
        <p>
          If you request account deletion, we will delete or de-identify
          information that is not required to be retained by law or for
          compliance purposes.
        </p>
      </PolicySection>

      <PolicySection number="7" title="Your rights">
        <p>Subject to applicable law, you may:</p>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>Access your information.</li>
          <li>Request corrections.</li>
          <li>Request a portable copy of your information.</li>
          <li>Withdraw participation.</li>
          <li>Request deletion or de-identification where permitted.</li>
        </ul>
        <p>
          Requests may be submitted to{' '}
          <a
            href="mailto:privacy@healplace.com"
            className="font-semibold underline underline-offset-2"
            style={{ color: 'var(--brand-primary-purple, #7B00E0)' }}
          >
            privacy@healplace.com
          </a>
          .
        </p>
      </PolicySection>

      <PolicySection number="8" title="Cookies and device identifiers">
        <p>
          Cardioplace uses essential cookies and device identifiers for
          authentication, security, and platform functionality. We do not
          use third-party advertising trackers.
        </p>
      </PolicySection>

      <PolicySection number="9" title="Children">
        <p>Cardioplace is intended for adults 18 years and older.</p>
      </PolicySection>

      <PolicySection number="10" title="Breach notification">
        <p>
          If a security incident affecting your protected health information
          occurs, we will provide notification consistent with HIPAA and
          applicable law.
        </p>
      </PolicySection>

      <PolicySection number="11" title="Changes to this policy">
        <p>
          We may update this policy periodically. Material changes will be
          communicated through the app or by email.
        </p>
      </PolicySection>

      <PolicyContact
        heading="Contact"
        organization="Healplace.com, Inc."
        emails={['privacy@healplace.com', 'security@healplace.com']}
      />
    </PolicyShell>
  );
}
