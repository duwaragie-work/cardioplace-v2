'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, Users, Phone, ShieldCheck, Activity, Stethoscope } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import LandingHeader from './LandingHeader';
import LandingFooter from './LandingFooter';

export default function AdminHomepage() {
  const { isAuthenticated, user } = useAuth();
  const router = useRouter();
  const isSuperAdmin = user?.roles?.includes('SUPER_ADMIN') ?? false;

  const ctaLabel = isAuthenticated && isSuperAdmin ? 'Go to dashboard' : 'Sign in to admin';
  const handleCta = () => {
    router.push(isAuthenticated && isSuperAdmin ? '/dashboard' : '/sign-in');
  };

  return (
    <div className="bg-white flex flex-col min-h-screen">
      <LandingHeader activeLink="Home" />

      <main className="flex-1 pt-[64px] flex flex-col">
        {/* Hero */}
        <section className="w-full max-w-[1280px] mx-auto px-6 md:px-8 py-16 md:py-24 flex flex-col lg:flex-row items-center gap-12">
          <div className="flex-1">
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5"
              style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}
            >
              <ShieldCheck className="w-3.5 h-3.5" style={{ color: 'var(--brand-primary-purple)' }} />
              <span className="text-xs font-semibold" style={{ color: 'var(--brand-primary-purple)' }}>
                Provider & care team console
              </span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-5" style={{ color: 'var(--brand-text-primary)' }}>
              Cardioplace <span style={{ color: 'var(--brand-primary-purple)' }}>Admin</span>
            </h1>
            <p className="text-lg mb-8 leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
              A rule-based blood pressure alert console for Cedar Hill, BridgePoint, and AmeriHealth
              providers — triage unresolved alerts, verify patient-reported profiles, and coordinate
              follow-up calls across Wards 7 and 8.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleCta}
                className="h-12 px-7 rounded-full font-semibold text-white text-sm md:text-base transition-colors"
                style={{ backgroundColor: 'var(--brand-primary-purple)' }}
              >
                {ctaLabel}
              </button>
              <Link
                href="/about"
                className="h-12 px-7 rounded-full font-semibold text-sm md:text-base border-2 flex items-center"
                style={{
                  borderColor: 'var(--brand-border)',
                  color: 'var(--brand-text-secondary)',
                }}
              >
                Learn more
              </Link>
            </div>
          </div>

          <div className="flex-1 grid grid-cols-2 gap-4 w-full">
            {[
              { icon: LayoutDashboard, title: 'Alert queue', body: 'Red, yellow, and green tiers with single-click resolution actions.' },
              { icon: Users, title: 'Patient list', body: 'Verification status, open alerts, and latest BP at a glance.' },
              { icon: Phone, title: 'Scheduled calls', body: 'Follow-up tracking with missed/completed status.' },
              { icon: Activity, title: 'BP trends', body: '7, 30, 60, 90-day views with clinical reference lines.' },
            ].map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="rounded-2xl p-5 border"
                style={{
                  backgroundColor: 'var(--brand-surface)',
                  borderColor: 'var(--brand-border)',
                  boxShadow: 'var(--brand-shadow-card)',
                }}
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                  style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}
                >
                  <Icon className="w-5 h-5" style={{ color: 'var(--brand-primary-purple)' }} />
                </div>
                <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--brand-text-primary)' }}>
                  {title}
                </h3>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Clinical authority strip */}
        <section
          className="w-full"
          style={{ backgroundColor: 'var(--brand-primary-purple-ultra-light, #FAF5FF)' }}
        >
          <div className="max-w-[1280px] mx-auto px-6 md:px-8 py-10 flex flex-col md:flex-row items-center gap-4 justify-between">
            <div className="flex items-center gap-3">
              <Stethoscope className="w-5 h-5" style={{ color: 'var(--brand-primary-purple)' }} />
              <p className="text-sm" style={{ color: 'var(--brand-text-secondary)' }}>
                Every alert rule, threshold, and three-tier message is signed off by Dr. Manisha Singal.
              </p>
            </div>
            <Link
              href="/about"
              className="text-sm font-semibold"
              style={{ color: 'var(--brand-primary-purple)' }}
            >
              About the program &rarr;
            </Link>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
