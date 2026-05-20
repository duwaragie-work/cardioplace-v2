'use client';

// Patient-facing Privacy Policy for the Cardioplace v2 pilot.
//
// Counsel-reviewed content (v2026-05-08), reflecting
// Cardioplace_Patient_Privacy_Policy.docx. Do not edit wording without
// legal/compliance sign-off.

import LandingHeader from '@/components/cardio/LandingHeader';
import LandingFooter from '@/components/cardio/LandingFooter';

export default function PrivacyPage() {
  const lastUpdated = 'May 8, 2026';

  return (
    <div className="bg-white flex flex-col min-h-screen">
      <LandingHeader activeLink="" />

      <main id="main" className="flex-1 pt-[80px] pb-12 px-4 sm:px-6 lg:px-12">
        <div className="max-w-[820px] mx-auto">
          <header className="mb-8 md:mb-10">
            <h1 className="font-bold text-[#170c1d] text-3xl sm:text-4xl lg:text-[44px] tracking-[-0.5px] mb-3">
              Privacy Policy
            </h1>
            <p className="text-[#6b7280] text-sm">
              Last updated: {lastUpdated}
            </p>
          </header>

          <div className="space-y-8 text-[#1f2937] text-[15px] leading-relaxed">

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">1. Introduction</h2>
              <p>
                This Privacy Policy explains how Healplace.com, Inc.
                (&quot;Healplace&quot;) collects, uses, stores, and protects
                personal and health information when you use Cardioplace.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">2. Information we collect</h2>
              <p className="mb-3">
                The information we hold about you falls into the following
                groups:
              </p>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>
                  <strong>Identity Information</strong> — name, date of birth,
                  email address, phone number.
                </li>
                <li>
                  <strong>Health Information</strong> — blood pressure
                  readings, symptoms, medications, diagnoses, pregnancy
                  status, care team assignments.
                </li>
                <li>
                  <strong>Communication Information</strong> — chat messages,
                  voice interactions and transcripts, escalation
                  communications.
                </li>
                <li>
                  <strong>Technical and Security Information</strong> — device
                  identifiers, IP addresses, browser information, session
                  activity, audit logs.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">3. How we use information</h2>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>Operate the Cardioplace platform.</li>
                <li>Run escalation and alert workflows.</li>
                <li>Support care coordination.</li>
                <li>Communicate with you.</li>
                <li>Maintain compliance and audit records.</li>
                <li>Improve the platform using de-identified and aggregated data.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">4. Who may access information</h2>
              <p className="mb-3">
                Information may be shared with:
              </p>
              <ul className="list-disc pl-6 space-y-1.5 mb-3">
                <li>Your authorized care team.</li>
                <li>Authorized Healplace personnel.</li>
                <li>HIPAA-compliant service providers.</li>
                <li>Regulators or legal authorities where required by law.</li>
              </ul>
              <p>
                We do not sell personal information and do not use your
                information for advertising.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">5. Security</h2>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>Encryption in transit and at rest.</li>
                <li>Role-based access controls.</li>
                <li>Audit logging.</li>
                <li>Access monitoring.</li>
                <li>Secure infrastructure hosted in the United States.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">6. Retention</h2>
              <p className="mb-3">
                Clinical and audit records may be retained as required by:
              </p>
              <ul className="list-disc pl-6 space-y-1.5 mb-3">
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
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">7. Your rights</h2>
              <p className="mb-3">
                Subject to applicable law, you may:
              </p>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>Access your information.</li>
                <li>Request corrections.</li>
                <li>Request a portable copy of your information.</li>
                <li>Withdraw participation.</li>
                <li>Request deletion or de-identification where permitted.</li>
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
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">8. Cookies and device identifiers</h2>
              <p>
                Cardioplace uses essential cookies and device identifiers for
                authentication, security, and platform functionality. We do
                not use third-party advertising trackers.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">9. Children</h2>
              <p>
                Cardioplace is intended for adults 18 years and older.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">10. Breach notification</h2>
              <p>
                If a security incident affecting your protected health
                information occurs, we will provide notification consistent
                with HIPAA and applicable law.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">11. Changes to this policy</h2>
              <p>
                We may update this policy periodically. Material changes will
                be communicated through the app or by email.
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
