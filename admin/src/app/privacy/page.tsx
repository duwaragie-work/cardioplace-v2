'use client';

// Admin-app-facing Privacy Policy for the Cardioplace v2 pilot.
//
// Counsel-reviewed content (v2026-05-08), reflecting
// Cardioplace_Admin_Privacy_Policy.docx. Do not edit wording without
// legal/compliance sign-off.

import LandingHeader from '@/components/LandingHeader';
import LandingFooter from '@/components/LandingFooter';

export default function PrivacyPage() {
  const lastUpdated = 'May 8, 2026';

  return (
    <div className="bg-white flex flex-col min-h-screen">
      <LandingHeader activeLink="" />

      <main id="main" className="flex-1 pt-[80px] pb-12 px-4 sm:px-6 lg:px-12">
        <div className="max-w-[820px] mx-auto">
          <header className="mb-8 md:mb-10">
            <h1 className="font-bold text-[#170c1d] text-3xl sm:text-4xl lg:text-[44px] tracking-[-0.5px] mb-3">
              Admin Privacy Policy
            </h1>
            <p className="text-[#6b7280] text-sm">
              Last updated: {lastUpdated}
            </p>
          </header>

          <div className="space-y-8 text-[#1f2937] text-[15px] leading-relaxed">

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">1. Introduction</h2>
              <p className="mb-3">
                This Privacy Policy explains how Healplace.com, Inc.
                (&quot;Healplace,&quot; &quot;we,&quot; &quot;our,&quot; or
                &quot;us&quot;) collects, uses, stores, and protects
                information relating to users of the Cardioplace admin
                platform (&quot;Cardioplace&quot;). Cardioplace is a clinical
                monitoring and escalation platform operated by Healplace.com,
                Inc.
              </p>
              <p className="mb-3">
                This policy applies to clinicians, nurses, medical directors,
                care coordinators, administrators, and authorized operations
                personnel who access the Cardioplace admin platform.
              </p>
              <p className="mb-3">
                This policy supplements, and does not replace:
              </p>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>
                  Any participation agreement between Healplace and your
                  organization.
                </li>
                <li>Any applicable Business Associate Agreement (&quot;BAA&quot;).</li>
                <li>Your organization&apos;s HIPAA and privacy policies.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">2. Information we collect</h2>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>
                  <strong>Identity Information</strong> — name, work email
                  address, organization and assigned practice, professional
                  role and permissions.
                </li>
                <li>
                  <strong>Authentication and Security Information</strong> —
                  sign-in method, device identifiers, IP address, browser and
                  user-agent data, session timestamps, timezone and
                  approximate region.
                </li>
                <li>
                  <strong>Operational and Audit Information</strong> — patient
                  records accessed, alerts acknowledged or resolved, threshold
                  modifications, medication verifications, chat and call
                  activity, escalation actions, profile updates,
                  administrative actions.
                </li>
                <li>
                  <strong>System and Support Information</strong> — error
                  logs, system diagnostics, session duration, technical
                  support records.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">3. How we use information</h2>
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
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">4. Audit trails and accountability</h2>
              <p className="mb-3">
                Cardioplace maintains immutable audit records of actions
                performed within the platform. Audit trails are required for:
              </p>
              <ul className="list-disc pl-6 space-y-1.5 mb-3">
                <li>HIPAA compliance.</li>
                <li>Joint Commission review.</li>
                <li>Patient-safety investigation.</li>
                <li>Clinical accountability.</li>
              </ul>
              <p className="mb-3">Audit records may include:</p>
              <ul className="list-disc pl-6 space-y-1.5 mb-3">
                <li>User actions.</li>
                <li>Alert resolutions.</li>
                <li>Escalation timestamps.</li>
                <li>Access events.</li>
                <li>Communication activity.</li>
              </ul>
              <p>Audit logs cannot be edited or deleted by end users.</p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">5. Who may access your information</h2>
              <p className="mb-3">Your activity may be accessible to:</p>
              <ul className="list-disc pl-6 space-y-1.5 mb-3">
                <li>Your organization&apos;s authorized administrators.</li>
                <li>Privacy and compliance personnel.</li>
                <li>
                  Authorized Healplace support and security personnel on a
                  strict need-to-know basis.
                </li>
                <li>
                  Government regulators or legal authorities where required by
                  law.
                </li>
              </ul>
              <p>
                We do not sell personal information and do not use admin
                activity information for advertising or marketing.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">6. Security</h2>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>Encryption in transit using HTTPS/TLS.</li>
                <li>Encryption at rest.</li>
                <li>Role-based access controls.</li>
                <li>Session monitoring.</li>
                <li>Access logging.</li>
                <li>Least-privilege operational access.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">7. Data retention</h2>
              <ul className="list-disc pl-6 space-y-1.5 mb-3">
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
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">8. Personal devices</h2>
              <p>
                Users may access Cardioplace only on devices permitted under
                their organization&apos;s security policies. Shared,
                unmanaged, or public devices should not be used to access
                patient information.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">9. Your rights</h2>
              <p className="mb-3">
                Subject to legal and operational limitations, you may:
              </p>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>Access your profile information.</li>
                <li>Request correction of inaccurate information.</li>
                <li>
                  Request a copy of audit records associated with your
                  account.
                </li>
                <li>Request account deactivation through your organization.</li>
              </ul>
              <p className="mt-3">
                Requests may be submitted to{' '}
                <a href="mailto:privacy@healplace.com" className="font-medium text-[#7B00E0] underline">
                  privacy@healplace.com
                </a>
                .
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">10. Breach notification</h2>
              <p>
                If a security incident affecting your information or
                accessible patient information occurs, Healplace will provide
                notification consistent with HIPAA breach notification
                requirements and applicable law.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">11. Changes to this policy</h2>
              <p>
                We may update this policy periodically. Material changes will
                be communicated through the platform or by email.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">12. Contact</h2>
              <p className="mb-2">Healplace.com, Inc.</p>
              <p>
                <a href="mailto:privacy@healplace.com" className="font-medium text-[#7B00E0] underline">
                  privacy@healplace.com
                </a>
                <br />
                <a href="mailto:security@healplace.com" className="font-medium text-[#7B00E0] underline">
                  security@healplace.com
                </a>
              </p>
            </section>

          </div>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
