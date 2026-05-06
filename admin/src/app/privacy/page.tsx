'use client';

// Admin-app-facing Privacy Policy for the Cardioplace v2 pilot.
//
// Drafted as a starting point for legal / compliance review. Covers the
// data Cardioplace collects from providers and care-team members using
// the admin app — distinct from the patient-facing privacy policy.

import LandingHeader from '@/components/LandingHeader';
import LandingFooter from '@/components/LandingFooter';

export default function PrivacyPage() {
  const lastUpdated = 'May 4, 2026';

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
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">1. What this covers</h2>
              <p className="mb-3">
                This policy describes the personal data Cardioplace collects
                from you when you sign in to the Cardioplace admin app as a
                provider, care-team member, practice administrator, or
                Healplace operations staffer. It is separate from the
                patient-facing privacy policy.
              </p>
              <p>
                This policy is in addition to (and does not replace) the
                data-handling commitments in your practice&apos;s
                participation agreement and any Business Associate Agreement.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">2. What we collect about you</h2>
              <ul className="list-disc pl-6 space-y-1.5">
                <li><strong>Identity</strong> — your name, work email, and assigned practice.</li>
                <li><strong>Role</strong> — your role in the system (PROVIDER, MEDICAL_DIRECTOR, HEALPLACE_OPS, SUPER_ADMIN) and the patient assignments tied to your account.</li>
                <li><strong>Authentication</strong> — the device identifier in your browser, your timezone, the IP and user-agent of each sign-in, and the sign-in method (one-time code).</li>
                <li><strong>Activity audit</strong> — every action you take that touches patient data: patient records opened, alerts acknowledged, thresholds edited, medication verifications, message and call activity, profile updates.</li>
                <li><strong>Operational metadata</strong> — the timestamps of your actions, the duration of sessions, and any errors logged against your account for support purposes.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">3. Why we collect it</h2>
              <ul className="list-disc pl-6 space-y-1.5">
                <li><strong>To authenticate and authorise you</strong> — to confirm who you are and what you are allowed to see.</li>
                <li><strong>To provide the alert and escalation features</strong> — so the system knows who is on call and who has acknowledged each alert.</li>
                <li><strong>To produce the audit trail</strong> required for Joint Commission compliance, patient-safety review, and the participating clinic&apos;s record-retention policy.</li>
                <li><strong>To support you</strong> — to investigate problems you report and to keep the service running.</li>
                <li><strong>To improve the service</strong> — using de-identified, aggregated activity statistics only.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">4. Who can see your activity</h2>
              <p className="mb-3">
                Your sign-in events and activity are visible to:
              </p>
              <ul className="list-disc pl-6 space-y-1.5 mb-3">
                <li><strong>Your practice administrator</strong> at the participating clinic.</li>
                <li><strong>The participating clinic&apos;s compliance and privacy officer</strong> when investigating an audit, complaint, or suspected breach.</li>
                <li><strong>The Cardioplace operations team</strong> on a need-to-know basis (for support, security, and system reliability).</li>
                <li><strong>Regulators</strong> (for example, the HHS Office for Civil Rights or the Joint Commission) when legally required.</li>
              </ul>
              <p>
                We do not share your work email, role, or activity for
                marketing purposes. We do not sell it.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">5. Where it lives and how it&apos;s protected</h2>
              <p>
                Activity logs and your account record are stored in encrypted
                databases hosted in the United States. Connections are
                encrypted in transit (HTTPS / TLS). Access is role-based: for
                example, ops staff cannot read free-text chat unless their
                role explicitly grants it, and providers at one practice
                cannot read providers at a different practice.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">6. How long we keep it</h2>
              <ul className="list-disc pl-6 space-y-1.5">
                <li><strong>Account record</strong> — kept while you have an active account, then archived in line with your practice&apos;s record-retention policy.</li>
                <li><strong>Audit logs</strong> — retained for at least the duration required by HIPAA, Joint Commission, and the participating clinic&apos;s policies (typically several years). Audit logs cannot be edited or deleted.</li>
                <li><strong>Sign-in / device logs</strong> — retained for security review for at least 90 days, longer where required for an active investigation.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">7. Your rights</h2>
              <p className="mb-3">You can:</p>
              <ul className="list-disc pl-6 space-y-1.5 mb-3">
                <li>See your own profile and ask us to correct any errors in it.</li>
                <li>Request a copy of your audit log entries (subject to redaction of patient identifiers when required).</li>
                <li>Withdraw your access from the pilot, by asking your practice administrator to disable your account.</li>
              </ul>
              <p className="mb-3">
                To exercise any of these rights, email{' '}
                <a href="mailto:privacy@healplace.com" className="font-medium text-[#7B00E0] underline">
                  privacy@healplace.com
                </a>
                . We will respond within 30 days.
              </p>
              <p>
                You cannot delete your audit log entries; they must be
                retained for clinical record-keeping and patient-safety
                review.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">8. Cookies and tracking</h2>
              <p>
                The admin app uses essential cookies to keep you signed in
                and a device identifier in your browser to recognise the
                device for security. We do not use advertising or
                third-party analytics trackers in the admin app.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">9. Breach notification</h2>
              <p>
                If a security incident affects your data or any patient data
                accessible from your account, we will notify you, your
                practice administrator, and the participating clinic&apos;s
                privacy officer in line with HIPAA breach-notification rules
                and applicable state law.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">10. Changes to this policy</h2>
              <p>
                We may update this policy as the pilot evolves. If we make a
                meaningful change we will tell you in the admin app or by
                email before the change takes effect.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">11. Contact</h2>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>Privacy questions, requests, and complaints: <a href="mailto:privacy@healplace.com" className="font-medium text-[#7B00E0] underline">privacy@healplace.com</a></li>
                <li>Security or breach reports: <a href="mailto:security@healplace.com" className="font-medium text-[#7B00E0] underline">security@healplace.com</a></li>
              </ul>
            </section>

          </div>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
