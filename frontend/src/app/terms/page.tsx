'use client';

// Patient-facing Terms of Service for the Cardioplace v2 pilot.
//
// Counsel-reviewed content (v2026-05-08), reflecting
// Cardioplace_Patient_Terms_of_Service.docx. Do not edit wording without
// legal/compliance sign-off.

import LandingHeader from '@/components/cardio/LandingHeader';
import LandingFooter from '@/components/cardio/LandingFooter';

export default function TermsPage() {
  const lastUpdated = 'May 8, 2026';

  return (
    <div className="bg-white flex flex-col min-h-screen">
      <LandingHeader activeLink="" />

      <main id="main" className="flex-1 pt-[80px] pb-12 px-4 sm:px-6 lg:px-12">
        <div className="max-w-[820px] mx-auto">
          <header className="mb-8 md:mb-10">
            <h1 className="font-bold text-[#170c1d] text-3xl sm:text-4xl lg:text-[44px] tracking-[-0.5px] mb-3">
              Terms of Service
            </h1>
            <p className="text-[#6b7280] text-sm">
              Last updated: {lastUpdated}
            </p>
          </header>

          <div className="space-y-8 text-[#1f2937] text-[15px] leading-relaxed">

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">1. Introduction</h2>
              <p className="mb-3">
                Cardioplace is a remote monitoring and communication platform
                operated by Healplace.com, Inc. in partnership with
                participating healthcare organizations.
              </p>
              <p>
                By creating an account and acknowledging these Terms during
                onboarding, you agree to these Terms.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">2. What Cardioplace does</h2>
              <p className="mb-3">Cardioplace helps patients:</p>
              <ul className="list-disc pl-6 space-y-1.5 mb-3">
                <li>Track blood pressure and symptoms.</li>
                <li>Share information with care teams.</li>
                <li>Receive alerts and follow-up communication.</li>
                <li>Support longitudinal monitoring between visits.</li>
              </ul>
              <p>
                Cardioplace uses physician-authored rules and automated
                workflows to identify readings or symptoms that may require
                review.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">3. Important medical disclaimer</h2>
              <div className="bg-red-50 border-l-4 border-red-500 px-5 py-4 rounded-r space-y-3">
                <p>
                  Cardioplace is not an emergency service and is not
                  continuously monitored in real time.
                </p>
                <p>
                  Cardioplace does not diagnose, treat, or cure medical
                  conditions. The platform supports monitoring and
                  communication only.
                </p>
                <p className="font-semibold text-[#170c1d]">
                  If you experience chest pain, difficulty breathing, severe
                  headache, stroke symptoms, suicidal thoughts, or any medical
                  emergency, call 911 or seek emergency medical care
                  immediately. Do not wait for a message from Cardioplace.
                </p>
              </div>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">4. Eligibility</h2>
              <p className="mb-3">You must:</p>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>Be at least 18 years old.</li>
                <li>Reside in the United States.</li>
                <li>Be associated with a participating clinic or care organization.</li>
                <li>
                  Be capable of providing informed consent or have a legally
                  authorized representative.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">5. Account access</h2>
              <p className="mb-3">
                You access Cardioplace using secure email-based
                authentication.
              </p>
              <p className="mb-3">You are responsible for:</p>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>Maintaining access to your email account.</li>
                <li>Protecting your sign-in credentials.</li>
                <li>Informing us if unauthorized access occurs.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">6. Information you provide</h2>
              <p className="mb-3">You may provide:</p>
              <ul className="list-disc pl-6 space-y-1.5 mb-3">
                <li>Health conditions.</li>
                <li>Medications.</li>
                <li>Symptoms.</li>
                <li>Blood pressure readings.</li>
                <li>Pregnancy status.</li>
                <li>Messages and voice interactions.</li>
              </ul>
              <p>
                Voice interactions may be transcribed and stored as part of
                your clinical communication record for patient-safety review
                and care coordination.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">7. Care team review</h2>
              <p>
                Your care team may review and verify information you provide.
                Until verification occurs, the platform may apply conservative
                default safety rules.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">8. Pilot status</h2>
              <p className="mb-3">
                Some deployments of Cardioplace operate as pilot-stage
                services undergoing active clinical evaluation. Features may
                change over time.
              </p>
              <p>
                While we work to maintain reliability, delays or interruptions
                may occur.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">9. Acceptable use</h2>
              <p className="mb-3">You agree:</p>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>To provide accurate information.</li>
                <li>Not to enter another person&apos;s readings under your account.</li>
                <li>Not to interfere with or misuse the platform.</li>
                <li>To follow measurement instructions where applicable.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">10. Termination</h2>
              <p className="mb-3">
                You may stop using Cardioplace at any time by contacting your
                care team or{' '}
                <a href="mailto:support@healplace.com" className="font-medium text-[#7B00E0] underline">
                  support@healplace.com
                </a>
                .
              </p>
              <p>
                We may suspend access where necessary for safety, compliance,
                or operational reasons.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">11. Limitation of liability</h2>
              <p>
                To the maximum extent permitted by law, Healplace.com, Inc. is
                not liable for indirect or consequential damages arising from
                use of the platform, except where prohibited by law.
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
              </p>
            </section>

          </div>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
