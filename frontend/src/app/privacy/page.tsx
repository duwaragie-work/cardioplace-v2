'use client';

// Patient-facing Privacy Policy for the Cardioplace v2 pilot.
//
// Drafted as a starting point for legal / compliance review. Wording is
// plain-language because the target audience skews older. Treat as DRAFT
// until reviewed by counsel and the participating clinics' privacy officers.

import LandingHeader from '@/components/cardio/LandingHeader';
import LandingFooter from '@/components/cardio/LandingFooter';

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
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">1. Who this applies to</h2>
              <p>
                This policy describes how Cardioplace and the participating
                pilot clinics handle your personal and health information when
                you use the Cardioplace app. By signing in, you agree to the
                practices described here.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">2. What we collect</h2>
              <p className="mb-3">
                The information we hold about you falls into a few groups:
              </p>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>
                  <strong>Identity and contact</strong> — your name, date of
                  birth, email address, and (optionally) a phone number.
                </li>
                <li>
                  <strong>Health profile</strong> — conditions, medications,
                  allergies, pregnancy status if applicable, and the clinic /
                  provider assigned to you.
                </li>
                <li>
                  <strong>Readings and check-ins</strong> — blood-pressure
                  values, pulse, symptoms, and short notes you write in the
                  daily check-in.
                </li>
                <li>
                  <strong>Chat and voice transcripts</strong> — the messages
                  and voice transcripts of conversations you have with the
                  Cardioplace assistant.
                </li>
                <li>
                  <strong>Audit metadata</strong> — sign-in events, alert
                  decisions, escalation steps, and care-team responses. This
                  is required for clinical record-keeping.
                </li>
                <li>
                  <strong>Device and technical</strong> — a device identifier
                  generated in your browser, your timezone, and basic
                  request logs (IP address, user-agent) used to keep the
                  service secure.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">3. How we use it</h2>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>To run the alert engine and decide whether a reading or symptom needs attention.</li>
                <li>To produce the patient, caregiver, and physician messages tied to each alert.</li>
                <li>To let your assigned care team review readings, verify your medication list, and follow up on alerts.</li>
                <li>To send you notifications by email or push when the clinical rules trigger an escalation.</li>
                <li>To keep an audit trail of every alert and every clinician action, as required for patient-safety review.</li>
                <li>To improve the rules and the user experience — using de-identified, aggregated data only, with clinical sign-off.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">4. Who sees it</h2>
              <p className="mb-3">
                Your information is shared with a small, defined group:
              </p>
              <ul className="list-disc pl-6 space-y-1.5 mb-3">
                <li>
                  <strong>Your assigned care team</strong> at the participating
                  clinic — the clinicians, nurses, and care coordinators whose
                  role is to review your readings.
                </li>
                <li>
                  <strong>The Cardioplace operations team</strong> — a limited
                  number of staff who keep the service running, on a strict
                  need-to-know basis.
                </li>
                <li>
                  <strong>Service providers under contract</strong> — for
                  example our hosting provider and our email/SMS provider.
                  These providers are bound by HIPAA-compliant Business
                  Associate Agreements where applicable.
                </li>
              </ul>
              <p>
                We do <strong>not</strong> sell your information. We do
                <strong> not</strong> use it for advertising. We do
                <strong> not</strong> share it with employers, insurers, or
                third parties for marketing.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">5. Where it lives and how it&apos;s protected</h2>
              <p className="mb-3">
                Your information is stored in encrypted databases hosted in
                the United States. Connections between your device and our
                servers are encrypted in transit (HTTPS / TLS).
              </p>
              <p>
                Access to your record is logged. We use role-based access
                control so that, for example, content moderators cannot read
                your clinical readings, and clinicians at one practice
                cannot read patients assigned to a different practice.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">6. How long we keep it</h2>
              <p>
                Clinical records are kept for the period required by the
                participating clinic&apos;s record-retention policy and by
                applicable medical-record law (typically several years after
                your last interaction). Audit logs are kept for at least the
                duration required by Joint Commission and HIPAA standards.
                When you ask us to delete your account, we remove
                identifiable profile data and de-identify any information
                that must be retained for clinical or audit reasons.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">7. Your rights</h2>
              <p className="mb-3">
                You have the right to:
              </p>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>See what personal and health information we hold about you.</li>
                <li>Ask us to correct anything that is wrong.</li>
                <li>Request a copy of your information in a portable format.</li>
                <li>Ask us to delete your account and your data, subject to the medical-record retention rules described in §6.</li>
                <li>Withdraw your participation in the pilot at any time, without affecting the care you receive at your clinic.</li>
              </ul>
              <p className="mt-3">
                To exercise any of these rights, email{' '}
                <a href="mailto:privacy@healplace.com" className="font-medium text-[#7B00E0] underline">
                  privacy@healplace.com
                </a>
                . We will respond within 30 days.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">8. Cookies and tracking</h2>
              <p>
                Cardioplace uses a small number of essential cookies and a
                device identifier stored in your browser to keep you signed in
                and to recognise your device for security. We do not use
                advertising or analytics trackers from third parties.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">9. Children</h2>
              <p>
                Cardioplace is for adults aged 18 and older. We do not
                knowingly collect data from children. If you believe a child
                has signed up, please email{' '}
                <a href="mailto:privacy@healplace.com" className="font-medium text-[#7B00E0] underline">
                  privacy@healplace.com
                </a>{' '}
                and we will delete the account.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">10. Breach notification</h2>
              <p>
                If a security incident affects your protected health
                information, we will notify you and the participating clinic
                in line with HIPAA breach-notification rules and applicable
                state law.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">11. Changes to this policy</h2>
              <p>
                We may update this policy as the pilot evolves. If we make a
                meaningful change we will tell you in the app or by email
                before the change takes effect.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">12. Contact</h2>
              <p>
                Privacy questions, requests, and complaints can be sent to{' '}
                <a href="mailto:privacy@healplace.com" className="font-medium text-[#7B00E0] underline">
                  privacy@healplace.com
                </a>
                . You may also raise a privacy complaint with the U.S.
                Department of Health and Human Services Office for Civil
                Rights.
              </p>
            </section>

          </div>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
