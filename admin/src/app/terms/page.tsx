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

import LandingHeader from '@/components/LandingHeader';
import LandingFooter from '@/components/LandingFooter';

export default function TermsPage() {
  const lastUpdated = 'May 20, 2026';

  return (
    <div className="bg-white flex flex-col min-h-screen">
      <LandingHeader activeLink="" />

      <main id="main" className="flex-1 pt-[80px] pb-12 px-4 sm:px-6 lg:px-12">
        <div className="max-w-[820px] mx-auto">
          <header className="mb-8 md:mb-10">
            <h1 className="font-bold text-[#170c1d] text-3xl sm:text-4xl lg:text-[44px] tracking-[-0.5px] mb-3">
              Admin Terms of Service
            </h1>
            <p className="text-[#6b7280] text-sm">
              Last updated: {lastUpdated}
            </p>
          </header>

          <div className="space-y-8 text-[#1f2937] text-[15px] leading-relaxed">

            <p>
              These Terms govern access to the Cardioplace admin platform
              operated by Healplace.com, Inc.
            </p>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">1. Eligibility</h2>
              <p className="mb-3">You may access the platform only if:</p>
              <ul className="list-disc pl-6 space-y-1.5 mb-3">
                <li>You are authorized by a participating organization.</li>
                <li>
                  You hold any required licenses or credentials. Clinical
                  users practicing in the District of Columbia must hold an
                  active license issued by the DC Department of Health Board
                  of Medicine (or equivalent licensing body for your role).
                </li>
                <li>
                  You have completed required HIPAA and privacy training.
                  Training must be renewed annually.
                </li>
              </ul>
              <p>
                Your organization&apos;s use of Cardioplace is governed by a
                separate Business Associate Agreement (BAA) executed between
                Healplace.com, Inc. and the organization. Nothing in these
                Terms supersedes the BAA.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">2. Accounts and security</h2>
              <p className="mb-3">
                Accounts are individual and may not be shared.
              </p>
              <p className="mb-3">
                Authentication occurs using one-time codes or secure sign-in
                links delivered to your work email.
              </p>
              <p className="mb-3">You are responsible for:</p>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>Maintaining the security of your email account.</li>
                <li>Preventing unauthorized access.</li>
                <li>Reporting suspected compromise immediately.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">3. Permitted use</h2>
              <p className="mb-3">
                You may use Cardioplace solely for authorized healthcare
                operations, treatment, payment, and care coordination
                purposes.
              </p>
              <p className="mb-3">
                You must access only the minimum patient information
                necessary to perform your authorized function, consistent
                with the HIPAA Minimum Necessary standard (45 CFR
                § 164.502(b)).
              </p>
              <p className="mb-3">You may not:</p>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>Access records without authorization.</li>
                <li>Share patient information outside approved workflows.</li>
                <li>Record or distribute protected information.</li>
                <li>Attempt to bypass security controls.</li>
                <li>Use the platform for non-clinical purposes.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">4. Clinical responsibility</h2>
              <p className="mb-3">
                Cardioplace provides clinical workflow support and escalation
                tools. Clinical decisions remain the responsibility of the
                treating licensed clinician.
              </p>
              <p>
                Cardioplace does not independently diagnose or treat patients.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">5. Alert response expectations</h2>
              <p className="mb-3">
                Organizations using Cardioplace are responsible for
                maintaining appropriate on-call coverage and escalation
                workflows.
              </p>
              <p>
                Alert acknowledgments, resolutions, and escalation activity
                are logged for compliance and patient-safety review.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">6. Audit trails</h2>
              <p className="mb-3">
                All platform activity may be logged, including:
              </p>
              <ul className="list-disc pl-6 space-y-1.5 mb-3">
                <li>Sign-ins.</li>
                <li>Record access.</li>
                <li>Alert actions.</li>
                <li>Communication activity.</li>
                <li>Threshold changes.</li>
              </ul>
              <p>
                Audit records are retained in accordance with legal and
                compliance requirements.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">7. Pilot status</h2>
              <p className="mb-3">
                Certain Cardioplace deployments may operate as pilot-stage
                services undergoing active clinical evaluation. Features may
                evolve over time.
              </p>
              <p>
                Service commitments may be governed separately by enterprise
                agreements or participation agreements.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">8. Security requirements</h2>
              <p className="mb-3">Users must:</p>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>Protect patient information.</li>
                <li>Lock unattended devices.</li>
                <li>Use organization-approved devices.</li>
                <li>
                  Report suspected incidents immediately, and in any event
                  no later than 24 hours after discovery.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">9. Suspension and termination</h2>
              <p className="mb-3">Access may be suspended or terminated if:</p>
              <ul className="list-disc pl-6 space-y-1.5 mb-3">
                <li>Organizational authorization ends.</li>
                <li>Security or compliance concerns arise.</li>
                <li>These Terms are violated.</li>
              </ul>
              <p>
                Upon termination of employment or removal of authorization,
                the participating organization is responsible for promptly
                disabling user access to Cardioplace.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">10. Changes to these Terms</h2>
              <p>
                We may update these Terms periodically. Material changes will
                be communicated to participating organizations and, where
                appropriate, individual users in advance of the effective
                date. Continued use after the effective date constitutes
                acceptance of the updated Terms.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">11. Limitation of liability</h2>
              <p>
                To the maximum extent permitted by law, Healplace.com, Inc.
                shall not be liable for indirect, incidental, or consequential
                damages arising from use of the platform, except where
                prohibited by law.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">12. Governing law</h2>
              <p>
                These Terms are governed by the laws of the District of
                Columbia.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">13. Contact</h2>
              <p>
                <a href="mailto:support@healplace.com" className="font-medium text-[#7B00E0] underline">
                  support@healplace.com
                </a>
                <br />
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
