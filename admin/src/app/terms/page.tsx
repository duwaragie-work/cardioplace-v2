'use client';

// Admin-app-facing Terms of Service for the Cardioplace v2 pilot.
//
// Drafted as a starting point for legal review. The content reflects the
// product as described in CLAUDE.md / docs/CLINICAL_SPEC.md / docs/ARCHITECTURE.md
// and covers provider-side obligations distinct from the patient terms
// (HIPAA training, role-based access, audit-log handling, escalation
// response-time expectations).

import LandingHeader from '@/components/LandingHeader';
import LandingFooter from '@/components/LandingFooter';

export default function TermsPage() {
  const lastUpdated = 'May 4, 2026';

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
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">1. Who these terms cover</h2>
              <p className="mb-3">
                These terms apply to anyone who signs in to the Cardioplace
                admin app — clinicians, nurses, care coordinators, medical
                directors, practice administrators, and Healplace operations
                staff. They are separate from the patient-facing terms.
              </p>
              <p>
                By signing in, you agree to these terms. If you do not agree,
                do not access the admin app.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">2. Eligibility and credentialing</h2>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>You must be employed by, or contracted with, a clinic or organisation that has a current participation agreement with Cardioplace.</li>
                <li>You must hold any clinical licences and credentials required for your role at that organisation.</li>
                <li>You must have completed your organisation&apos;s HIPAA and patient-privacy training.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">3. Your account</h2>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>You sign in with your work email. Cardioplace does not use passwords; you receive a one-time 6-digit code by email.</li>
                <li>Your account is personal. <strong>Do not share your login, your one-time code, or your sign-in link with anyone</strong>, including colleagues or your practice administrator.</li>
                <li>If you suspect someone else has used your account, tell your practice administrator and email <a href="mailto:support@healplace.com" className="font-medium text-[#7B00E0] underline">support@healplace.com</a> the same day.</li>
                <li>Practice administrators are responsible for inviting, suspending, and revoking access for staff at their practice.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">4. Permitted use</h2>
              <p className="mb-3">
                You may use the admin app only for treatment, payment, and
                healthcare operations purposes, in line with HIPAA&apos;s
                Minimum Necessary standard. Specifically:
              </p>
              <ul className="list-disc pl-6 space-y-1.5 mb-3">
                <li>Access patient records only for patients you are caring for, or when otherwise authorised by your role.</li>
                <li>Use the alert and escalation tools to support patient care.</li>
                <li>Edit patient thresholds, verify medications, and update profiles only when clinically appropriate.</li>
              </ul>
              <p className="mb-3">You may not:</p>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>Look up patients out of curiosity, for personal interest, or for non-clinical reasons.</li>
                <li>Copy, screenshot, export, or transmit patient data outside the app, except where the workflow explicitly supports doing so.</li>
                <li>Share your view of the app — or a screen recording of it — with anyone outside the care team.</li>
                <li>Make decisions in the app for patients who are not assigned to you or your practice.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">5. Response-time expectations</h2>
              <p className="mb-3">
                Cardioplace&apos;s escalation ladder relies on the on-call
                provider acknowledging alerts within agreed windows
                (T+0, T+4h, T+8h, T+24h, T+48h). By accepting these terms,
                you and your practice agree:
              </p>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>Practices will keep an on-call provider assigned during configured business and after-hours coverage windows.</li>
                <li>Acknowledgments and clinical actions you take are recorded in the audit log.</li>
                <li>Repeated failure to acknowledge alerts within the configured window may be flagged to your practice administrator and the participating clinic&apos;s compliance officer for follow-up.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">6. Audit trail</h2>
              <p className="mb-3">
                Every action you take in the admin app is logged. The audit
                trail includes:
              </p>
              <ul className="list-disc pl-6 space-y-1.5 mb-3">
                <li>Sign-in events and the device and IP from which you signed in.</li>
                <li>Patient records you opened.</li>
                <li>Alerts you acknowledged or resolved.</li>
                <li>Thresholds you edited and verifications you confirmed.</li>
                <li>Messages you sent through the chat or call tools.</li>
              </ul>
              <p>
                The audit trail is required for Joint Commission compliance
                and patient-safety review. It is retained for the period
                required by HIPAA, the Joint Commission standards, and your
                practice&apos;s record-retention policy. You cannot edit or
                delete audit-trail entries.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">7. Patient information</h2>
              <p className="mb-3">
                All patient information you see in the admin app is Protected
                Health Information (PHI) under HIPAA. You agree to handle it
                in line with HIPAA, your practice&apos;s Business Associate
                Agreement with Cardioplace / Healplace, and your professional
                obligations. In particular:
              </p>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>Treat the admin app as a secured workspace. Do not access it on shared, public, or unmanaged devices.</li>
                <li>Lock your screen when you step away.</li>
                <li>Do not discuss patient information in public spaces.</li>
                <li>Report any suspected breach immediately to your practice administrator and to <a href="mailto:security@healplace.com" className="font-medium text-[#7B00E0] underline">security@healplace.com</a>.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">8. Pilot status</h2>
              <p>
                The admin app is in active development as part of the
                Cardioplace pilot. Features may be added, changed, or
                removed. Cardioplace will give your practice reasonable
                notice before substantive changes. The service is provided
                <em> as is</em> during the pilot; commitments on uptime,
                support response, and feature stability are governed by your
                practice&apos;s participation agreement, not by these in-app
                terms.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">9. Suspension and termination</h2>
              <p className="mb-3">We may suspend or end your access if:</p>
              <ul className="list-disc pl-6 space-y-1.5 mb-3">
                <li>Your practice&apos;s participation agreement with Cardioplace ends.</li>
                <li>Your practice administrator removes your account.</li>
                <li>You leave or change roles at your practice.</li>
                <li>You appear to have breached these terms or your HIPAA obligations.</li>
              </ul>
              <p>
                You may stop using the admin app at any time. Tell your
                practice administrator so they can disable your account and
                reassign your patients.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">10. Limits on responsibility</h2>
              <p className="mb-3">
                Cardioplace and Healplace make no warranty that the service
                will be available without interruption or error during the
                pilot. To the maximum extent allowed by law, neither party is
                responsible for indirect or consequential losses arising from
                use of the admin app, except where the law disallows such
                limits (for example, fraud or gross negligence).
              </p>
              <p>
                The clinical decisions made on each patient remain the
                responsibility of the licensed clinician treating that
                patient. Cardioplace&apos;s rules and alerts are decision
                support, not decisions.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">11. Changes to these terms</h2>
              <p>
                We may update these terms as the pilot evolves. If we make a
                meaningful change we will tell you in the admin app or by
                email before the change takes effect.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">12. Governing law</h2>
              <p>
                These terms are governed by the laws of the District of
                Columbia. Your practice&apos;s participation agreement may
                add or override terms; where there is a conflict, the
                participation agreement controls.
              </p>
            </section>

            <section>
              <h2 className="font-semibold text-[#170c1d] text-xl mb-3">13. Contact</h2>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>Operational questions: <a href="mailto:support@healplace.com" className="font-medium text-[#7B00E0] underline">support@healplace.com</a></li>
                <li>Security or breach reports: <a href="mailto:security@healplace.com" className="font-medium text-[#7B00E0] underline">security@healplace.com</a></li>
                <li>Privacy questions: <a href="mailto:privacy@healplace.com" className="font-medium text-[#7B00E0] underline">privacy@healplace.com</a></li>
              </ul>
            </section>

          </div>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
