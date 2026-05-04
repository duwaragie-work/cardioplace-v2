'use client';

// Patient-facing Terms of Service for the Cardioplace v2 pilot.
//
// Drafted as a starting point for legal review. The content reflects the
// product as described in CLAUDE.md / docs/CLINICAL_SPEC.md / docs/ARCHITECTURE.md
// (rule-based BP alert system, patient self-report + provider verification,
// pilot deployment via Cedar Hill / BridgePoint / AmeriHealth in Ward 7&8 DC).
// Wording is intentionally plain-language because the target audience skews
// older. Treat as DRAFT until reviewed by counsel.

import LandingHeader from '@/components/cardio/LandingHeader';
import LandingFooter from '@/components/cardio/LandingFooter';

export default function TermsPage() {
  const lastUpdated = 'May 4, 2026';

  return (
    <div className="bg-white flex flex-col min-h-screen">
      <LandingHeader activeLink="" />

      <main id="main" className="flex-1 pt-[80px] pb-12 px-4 sm:px-6 lg:px-12">
        <div className="max-w-[820px] mx-auto">
          {/* Header */}
          <header className="mb-8 md:mb-10">
            <h1 className="font-bold text-[#170c1d] text-3xl sm:text-4xl lg:text-[44px] tracking-[-0.5px] mb-3">
              Terms of Service
            </h1>
            <p className="text-[#6b7280] text-sm">
              Last updated: {lastUpdated}
            </p>
          </header>

          <div className="space-y-8 text-[#1f2937] text-[15px] leading-relaxed">

            {/* 1. Acceptance */}
            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">1. Agreement</h2>
              <p>
                By creating an account or signing in with your email, you agree
                to these Terms of Service. If you do not agree, please do not
                use the service.
              </p>
            </section>

            {/* 2. About Cardioplace */}
            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">2. What Cardioplace is</h2>
              <p className="mb-3">
                Cardioplace is a digital tool that helps you track your blood
                pressure at home and helps your care team see patterns over
                time. It is operated as a pilot in partnership with
                participating clinics in the Washington, D.C. area
                (including primary care and cardiology practices serving
                Wards 7 and 8). The pilot is supported in part by the Elevance
                Health Foundation Patient Safety Prize.
              </p>
              <p>
                The service uses a set of rules — written and signed off by a
                physician — to flag readings or symptoms that may need a
                check-in. It also gives short summary messages that your
                care team can review.
              </p>
            </section>

            {/* 3. Important: not medical advice */}
            <section className="p-4 bg-[#fee2e2] border border-[#fca5a5] rounded-lg">
              <h2 className="font-semibold text-[#7f1d1d] text-xl mb-3">3. Cardioplace is not medical advice</h2>
              <p className="mb-3 text-[#7f1d1d]">
                Cardioplace does <strong>not</strong> diagnose, treat, or cure any
                condition. The information you see in the app is for monitoring
                and communication only. It is not a substitute for the judgement
                of a licensed clinician.
              </p>
              <p className="text-[#7f1d1d]">
                <strong>If you think you are having an emergency — chest pain,
                trouble breathing, sudden weakness, severe headache, or any
                symptom that frightens you — call 911 or go to the nearest
                emergency room. Do not wait for a message from Cardioplace.</strong>
              </p>
            </section>

            {/* 4. Eligibility */}
            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">4. Who can use it</h2>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>You must be at least 18 years old.</li>
                <li>You must live in the United States and be a patient of a clinic that is part of the Cardioplace pilot.</li>
                <li>You must be able to provide your own informed consent, or have a legal representative who can provide it for you.</li>
              </ul>
            </section>

            {/* 5. Sign-in */}
            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">5. Signing in</h2>
              <p className="mb-3">
                Cardioplace does not use passwords. You sign in by entering
                your email address. We then send you either:
              </p>
              <ul className="list-disc pl-6 space-y-1.5 mb-3">
                <li>a one-time 6-digit code to type in, or</li>
                <li>a magic link you tap from your email.</li>
              </ul>
              <p>
                You are responsible for keeping access to your email account
                secure. If you suspect someone else has used your email to
                sign in, contact us right away.
              </p>
            </section>

            {/* 6. Self-report and verification */}
            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">6. Self-reported information</h2>
              <p className="mb-3">
                When you set up your profile, you tell Cardioplace about your
                health conditions, medications, and other information. The
                service uses this to personalise the alerts.
              </p>
              <p className="mb-3">
                Your assigned care team will review and verify what you
                entered, usually within 48 to 72 hours of your first sign-in.
                Until they do, the service treats your readings using
                conservative default rules.
              </p>
              <p>
                Please keep your medication list and condition list up to date.
                Outdated information can cause Cardioplace to flag the wrong
                things — or to miss things it should flag.
              </p>
            </section>

            {/* 7. Health information */}
            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">7. Your health information</h2>
              <p className="mb-3">
                Your blood pressure readings, symptom check-ins, chat
                conversations, and profile information are protected health
                information. We handle them in line with the requirements of
                the Health Insurance Portability and Accountability Act (HIPAA)
                and the policies of the participating clinics.
              </p>
              <p className="mb-3">
                We share your information with the clinicians, nurses, and
                care-team members at the practice that has been assigned to
                you. We also keep an audit trail of every alert, escalation,
                and access — this is required for Joint Commission compliance
                and for patient-safety review.
              </p>
              <p>
                We do not sell your information. We do not use it to advertise
                to you. A separate Privacy Policy will describe in detail how
                your data is stored, who can see it, and how long we keep it.
              </p>
            </section>

            {/* 8. Your responsibilities */}
            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">8. What we ask of you</h2>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>Use a working blood-pressure cuff and follow the measurement instructions in the app.</li>
                <li>Enter readings honestly. Do not enter someone else&apos;s readings under your own account.</li>
                <li>Tell us about new medications, stopped medications, and new diagnoses as soon as you can.</li>
                <li>Respond to escalation messages from your care team when you can. If you cannot, call 911 or your clinic.</li>
                <li>Do not try to break, copy, or interfere with the service.</li>
              </ul>
            </section>

            {/* 9. Pilot status */}
            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">9. This is a pilot</h2>
              <p className="mb-3">
                Cardioplace is in active development. Features may be added,
                changed, or removed. The pilot may end on a schedule we
                announce in advance. If the pilot ends in your area, your care
                team will tell you and your data will be returned or deleted in
                line with the participating clinic&apos;s record-retention policy.
              </p>
              <p>
                Because Cardioplace is a pilot, it is provided <em>as is</em>.
                We do everything we reasonably can to keep it accurate and
                available, but we cannot guarantee that every reading is
                processed instantly or that every alert reaches every member
                of the care team in every circumstance.
              </p>
            </section>

            {/* 10. Limits */}
            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">10. Limits on responsibility</h2>
              <p>
                To the maximum extent allowed by law, Cardioplace and its
                operators are not responsible for indirect or consequential
                losses arising from use of the service. Nothing in these
                terms limits any responsibility we have under the law for
                death or personal injury caused by negligence, or for fraud.
                These limits do not affect your statutory rights as a patient.
              </p>
            </section>

            {/* 11. Stopping use */}
            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">11. Stopping use</h2>
              <p>
                You can stop using Cardioplace at any time by telling your
                care team or by emailing{' '}
                <a href="mailto:support@healplace.com" className="font-medium text-[#7B00E0] underline">
                  support@healplace.com
                </a>
                . We may also suspend or end your access if we believe the
                account is being used in a way that could harm you, another
                patient, or the service.
              </p>
            </section>

            {/* 12. Changes */}
            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">12. Changes to these terms</h2>
              <p>
                We may update these terms as the pilot evolves. If we make a
                meaningful change we will tell you in the app or by email
                before the change takes effect. Continuing to use the service
                after that means you accept the updated terms.
              </p>
            </section>

            {/* 13. Governing law */}
            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">13. Governing law</h2>
              <p>
                These terms are governed by the laws of the District of
                Columbia, without regard to its conflict-of-law rules. Any
                disputes will be handled in the state or federal courts
                located in the District of Columbia.
              </p>
            </section>

            {/* 14. Contact */}
            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">14. Contact us</h2>
              <p>
                Questions, concerns, or requests about these terms or about
                your data can be sent to{' '}
                <a href="mailto:support@healplace.com" className="font-medium text-[#7B00E0] underline">
                  support@healplace.com
                </a>
                .
              </p>
            </section>

          </div>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
