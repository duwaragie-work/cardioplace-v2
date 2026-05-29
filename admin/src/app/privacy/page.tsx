'use client';

// Admin-app-facing Privacy Policy for the Cardioplace v2 pilot.
//
// Counsel-reviewed content (v2026-05-08), reflecting
// Cardioplace_Admin_Privacy_Policy.docx. Do not edit wording without
// legal/compliance sign-off.

import {
  PolicyContact,
  PolicySection,
  PolicyShell,
} from '@/components/policy/PolicyShell';

export default function PrivacyPage() {
  return (
    <PolicyShell
      kind="privacy"
      title="Admin Privacy Policy"
      intro="How Healplace.com, Inc. collects, uses, stores, and protects your information when you access the Cardioplace admin platform."
      lastUpdated="May 8, 2026"
    >
      <PolicySection number="1" title="Introduction">
        <p>
          This Privacy Policy explains how Healplace.com, Inc. (&quot;Healplace,&quot;
          &quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) collects, uses,
          stores, and protects information relating to users of the
          Cardioplace admin platform (&quot;Cardioplace&quot;). Cardioplace
          is a clinical monitoring and escalation platform operated by
          Healplace.com, Inc.
        </p>
        <p>
          This policy applies to clinicians, nurses, medical directors, care
          coordinators, administrators, and authorized operations personnel
          who access the Cardioplace admin platform.
        </p>
        <p>This policy supplements, and does not replace:</p>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>
            Any participation agreement between Healplace and your
            organization.
          </li>
          <li>Any applicable Business Associate Agreement (&quot;BAA&quot;).</li>
          <li>Your organization&apos;s HIPAA and privacy policies.</li>
        </ul>
      </PolicySection>

      <PolicySection number="2" title="Information we collect">
        <ul className="list-disc pl-6 space-y-1.5">
          <li>
            <strong>Identity Information</strong> — name, work email address,
            organization and assigned practice, professional role and
            permissions.
          </li>
          <li>
            <strong>Authentication and Security Information</strong> —
            sign-in method, device identifiers, IP address, browser and
            user-agent data, session timestamps, timezone and approximate
            region.
          </li>
          <li>
            <strong>Operational and Audit Information</strong> — patient
            records accessed, alerts acknowledged or resolved, threshold
            modifications, medication verifications, chat and call activity,
            escalation actions, profile updates, administrative actions.
          </li>
          <li>
            <strong>System and Support Information</strong> — error logs,
            system diagnostics, session duration, technical support records.
          </li>
        </ul>
      </PolicySection>

      <PolicySection number="3" title="How we use information">
        <ul className="list-disc pl-6 space-y-1.5">
          <li>Authenticate and authorize access.</li>
          <li>Deliver clinical alerting and escalation workflows.</li>
          <li>Maintain legally required audit trails.</li>
          <li>Support patient-safety review and compliance obligations.</li>
          <li>Investigate security incidents and suspected misuse.</li>
          <li>Maintain system reliability and operational integrity.</li>
          <li>
            Improve the platform using de-identified and aggregated
            information only.
          </li>
        </ul>
      </PolicySection>

      <PolicySection number="4" title="Audit trails and accountability">
        <p>
          Cardioplace maintains immutable audit records of actions performed
          within the platform. Audit trails are required for:
        </p>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>HIPAA compliance.</li>
          <li>Joint Commission review.</li>
          <li>Patient-safety investigation.</li>
          <li>Clinical accountability.</li>
        </ul>
        <p>Audit records may include:</p>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>User actions.</li>
          <li>Alert resolutions.</li>
          <li>Escalation timestamps.</li>
          <li>Access events.</li>
          <li>Communication activity.</li>
        </ul>
        <p>Audit logs cannot be edited or deleted by end users.</p>
      </PolicySection>

      <PolicySection number="5" title="Who may access your information">
        <p>Your activity may be accessible to:</p>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>Your organization&apos;s authorized administrators.</li>
          <li>Privacy and compliance personnel.</li>
          <li>
            Authorized Healplace support and security personnel on a strict
            need-to-know basis.
          </li>
          <li>
            Government regulators or legal authorities where required by law.
          </li>
        </ul>
        <p>
          We do not sell personal information and do not use admin activity
          information for advertising or marketing.
        </p>
      </PolicySection>

      <PolicySection number="6" title="Security">
        <ul className="list-disc pl-6 space-y-1.5">
          <li>Encryption in transit using HTTPS/TLS.</li>
          <li>Encryption at rest.</li>
          <li>Role-based access controls.</li>
          <li>Session monitoring.</li>
          <li>Access logging.</li>
          <li>Least-privilege operational access.</li>
        </ul>
      </PolicySection>

      <PolicySection number="7" title="Data retention">
        <ul className="list-disc pl-6 space-y-1.5">
          <li>As required by HIPAA and applicable law.</li>
          <li>In accordance with organizational retention policies.</li>
          <li>
            As necessary for patient-safety review, compliance, legal
            obligations, and operational integrity.
          </li>
        </ul>
        <p>
          Security logs are generally retained for at least 90 days and
          longer where required for investigation or compliance.
        </p>
      </PolicySection>

      <PolicySection number="8" title="Personal devices">
        <p>
          Users may access Cardioplace only on devices permitted under their
          organization&apos;s security policies. Shared, unmanaged, or public
          devices should not be used to access patient information.
        </p>
      </PolicySection>

      <PolicySection number="9" title="Your rights">
        <p>Subject to legal and operational limitations, you may:</p>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>Access your profile information.</li>
          <li>Request correction of inaccurate information.</li>
          <li>
            Request a copy of audit records associated with your account.
          </li>
          <li>Request account deactivation through your organization.</li>
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

      <PolicySection number="10" title="Breach notification">
        <p>
          If a security incident affecting your information or accessible
          patient information occurs, Healplace will provide notification
          consistent with HIPAA breach notification requirements and
          applicable law.
        </p>
      </PolicySection>

      <PolicySection number="11" title="Changes to this policy">
        <p>
          We may update this policy periodically. Material changes will be
          communicated through the platform or by email.
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
