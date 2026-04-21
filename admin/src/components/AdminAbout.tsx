'use client';

import Link from 'next/link';
import LandingHeader from './LandingHeader';
import LandingFooter from './LandingFooter';

export default function AdminAbout() {
  return (
    <div className="bg-white flex flex-col min-h-screen">
      <LandingHeader activeLink="About" />

      <main className="flex-1 pt-[64px]">
        <section className="max-w-[900px] mx-auto px-6 md:px-8 py-16 md:py-24">
          <h1
            className="text-4xl md:text-5xl font-bold tracking-tight mb-6"
            style={{ color: 'var(--brand-text-primary)' }}
          >
            About <span style={{ color: 'var(--brand-primary-purple)' }}>Cardioplace Admin</span>
          </h1>

          <p className="text-lg leading-relaxed mb-8" style={{ color: 'var(--brand-text-secondary)' }}>
            Cardioplace is a rule-based blood-pressure alert system built for the
            Elevance Health Foundation Patient Safety Prize cohort — serving Cedar
            Hill, BridgePoint, and AmeriHealth patients across Wards 7 and 8 of
            Washington, DC.
          </p>

          <h2 className="text-xl font-bold mt-10 mb-3" style={{ color: 'var(--brand-text-primary)' }}>
            What this console does
          </h2>
          <ul className="space-y-2 text-base leading-relaxed mb-8" style={{ color: 'var(--brand-text-secondary)' }}>
            <li>&bull; Three-layer alert dashboard: Tier 1 contraindications (red), Tier 2 discrepancies (yellow), Tier 3 informational (green).</li>
            <li>&bull; Patient profile verification within 48&ndash;72 hours of self-report (&ldquo;trust then verify&rdquo;).</li>
            <li>&bull; Per-patient threshold editor for personalized monitoring windows.</li>
            <li>&bull; Follow-up call scheduling tied to open alerts, with 15-field Joint-Commission audit trail.</li>
            <li>&bull; Multi-practice support via `Practice` and `PatientProviderAssignment` models.</li>
          </ul>

          <h2 className="text-xl font-bold mt-10 mb-3" style={{ color: 'var(--brand-text-primary)' }}>
            Clinical authority
          </h2>
          <p className="text-base leading-relaxed mb-8" style={{ color: 'var(--brand-text-secondary)' }}>
            Every alert rule, threshold range, three-tier patient/caregiver/physician
            message, and medication contraindication pathway in this system is signed
            off by Dr. Manisha Singal. See <code className="text-sm">docs/CLINICAL_SPEC.md</code>
            in the repository for the authoritative spec.
          </p>

          <h2 className="text-xl font-bold mt-10 mb-3" style={{ color: 'var(--brand-text-primary)' }}>
            Who can access
          </h2>
          <p className="text-base leading-relaxed mb-8" style={{ color: 'var(--brand-text-secondary)' }}>
            Only users with the <code className="text-sm">SUPER_ADMIN</code> role can
            sign in. Patient-facing features live on the separate patient app.
          </p>

          <div className="flex items-center gap-3 mt-12">
            <Link
              href="/sign-in"
              className="h-12 px-7 rounded-full font-semibold text-white text-sm flex items-center"
              style={{ backgroundColor: 'var(--brand-primary-purple)' }}
            >
              Sign in
            </Link>
            <Link
              href="/"
              className="h-12 px-7 rounded-full font-semibold text-sm border-2 flex items-center"
              style={{
                borderColor: 'var(--brand-border)',
                color: 'var(--brand-text-secondary)',
              }}
            >
              Back to home
            </Link>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
