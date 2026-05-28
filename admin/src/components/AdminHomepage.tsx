'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, Users, ShieldCheck, Activity, Stethoscope, Building2, Play, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import LandingHeader from './LandingHeader';
import LandingFooter from './LandingFooter';

// Demo walkthrough — YouTube unlisted upload.
// Source: https://www.youtube.com/watch?v=IcFdT3Kz-40
// To swap providers (e.g. back to the Drive preview at
// https://drive.google.com/file/d/155WXpSh3daRqoKoIlGgR7lO61mkzVCxI/preview),
// change this constant AND the iframe src in the modal below.
const YOUTUBE_VIDEO_ID = 'IcFdT3Kz-40';

export default function AdminHomepage() {
  const { isAuthenticated, user } = useAuth();
  const router = useRouter();
  const isSuperAdmin = user?.roles?.includes('SUPER_ADMIN') ?? false;

  const ctaLabel = isAuthenticated && isSuperAdmin ? 'Go to dashboard' : 'Sign in to admin';
  const handleCta = () => {
    router.push(isAuthenticated && isSuperAdmin ? '/dashboard' : '/sign-in');
  };

  // Demo video modal — same pattern as the patient homepage. iframe is
  // unmounted on close so playback stops; body scroll locked; Esc + backdrop
  // dismiss; focus returns to the play button after close.
  const [showDemo, setShowDemo] = useState(false);
  const playButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showDemo) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowDemo(false);
    };
    window.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
      // The play button lives in the page, not the modal — it is always
      // mounted while this effect can fire, so .current is stable across
      // the effect lifecycle.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      playButtonRef.current?.focus();
    };
  }, [showDemo]);

  return (
    <div className="bg-white flex flex-col min-h-screen">
      <LandingHeader activeLink="Home" />

      <main className="flex-1 pt-[64px] flex flex-col">
        {/* Hero */}
        <section className="w-full max-w-[1280px] mx-auto px-6 md:px-8 py-12 md:py-16 flex flex-col lg:flex-row items-center gap-12 min-h-[calc(100vh-168px)]">
          <div className="flex-1">
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5"
              style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}
            >
              <ShieldCheck className="w-3.5 h-3.5" style={{ color: 'var(--brand-primary-purple)' }} />
              <span className="text-xs font-semibold" style={{ color: 'var(--brand-primary-purple)' }}>
                Provider and care team console
              </span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-5" style={{ color: 'var(--brand-text-primary)' }}>
              Cardioplace <span style={{ color: 'var(--brand-primary-purple)' }}>Admin</span>
            </h1>
            <p className="text-lg mb-8 leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
              A rule-based blood pressure alert console for primary care and cardiology
              providers in Wards 7 and 8. Triage unresolved alerts, verify patient-reported
              profiles, and coordinate follow-up calls in one place.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleCta}
                className="h-12 px-7 rounded-full font-semibold text-white text-sm md:text-base transition-colors"
                style={{ backgroundColor: 'var(--brand-primary-purple)' }}
              >
                {ctaLabel}
              </button>
              <Link
                href="#demo"
                className="h-12 px-7 rounded-full font-semibold text-sm md:text-base border-2 flex items-center"
                style={{
                  borderColor: 'var(--brand-border)',
                  color: 'var(--brand-text-secondary)',
                }}
              >
                Watch demo
              </Link>
            </div>
          </div>

          <div className="flex-1 grid grid-cols-2 gap-5 w-full auto-rows-fr">
            {[
              { icon: LayoutDashboard, title: 'Alert queue', body: 'Red, yellow, and green tiers with single-click resolution actions.' },
              { icon: Users, title: 'Patient list', body: 'Verification status, open alerts, and latest BP at a glance.' },
              { icon: Activity, title: 'BP trends', body: '7, 30, 60, 90-day views with clinical reference lines.' },
              { icon: Building2, title: 'Care teams', body: 'Assign patients to provider teams across multiple practices.' },
            ].map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="rounded-2xl p-6 border border-[#E2E8F0] shadow-sm min-h-[180px] flex flex-col transition-all duration-300 hover:shadow-lg hover:-translate-y-1 hover:border-[#7B00E0]/30"
                style={{ backgroundColor: 'var(--brand-surface)' }}
              >
                <div
                  className="w-11 h-11 rounded-lg flex items-center justify-center mb-4"
                  style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}
                >
                  <Icon className="w-6 h-6" style={{ color: 'var(--brand-primary-purple)' }} />
                </div>
                <h3 className="text-base font-semibold mb-1.5" style={{ color: 'var(--brand-text-primary)' }}>
                  {title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ============ DEMO VIDEO SECTION ============ */}
        {/* scroll-mt-20 keeps the heading clear of the fixed 64px top nav
            when the hero "Watch demo" CTA scrolls here. */}
        <section id="demo" className="w-full bg-white py-16 md:py-24 scroll-mt-20 border-t border-[#E2E8F0]">
          <div className="max-w-[1200px] mx-auto px-4 sm:px-6 md:px-8">
            <div className="flex flex-col md:flex-row items-center gap-8 md:gap-12 lg:gap-16">
              {/* LEFT — title + description */}
              <div className="flex-1 flex flex-col gap-4 md:gap-5 text-center md:text-left">
                <span
                  className="text-xs sm:text-sm font-semibold tracking-widest uppercase"
                  style={{ color: 'var(--brand-primary-purple)' }}
                >
                  See it in action
                </span>
                <h2
                  className="font-semibold text-2xl sm:text-3xl md:text-4xl lg:text-[42px] leading-tight"
                  style={{ color: 'var(--brand-text-primary)' }}
                >
                  A five-minute walkthrough
                </h2>
                <p
                  className="text-sm sm:text-base md:text-lg leading-relaxed max-w-[520px] mx-auto md:mx-0"
                  style={{ color: 'var(--brand-text-secondary)' }}
                >
                  The patient experience and the care-team closed loop — end to end, in real time.
                  Watch how an alert is generated, escalated, and resolved with full clinical accountability.
                </p>
              </div>

              {/* RIGHT — clickable thumbnail */}
              <button
                ref={playButtonRef}
                onClick={() => setShowDemo(true)}
                aria-label="Play the Cardioplace 5-minute demo"
                className="flex-1 relative aspect-video w-full max-w-[560px] rounded-2xl overflow-hidden shadow-xl group cursor-pointer focus:outline-none focus:ring-4 focus:ring-[#7B00E0]/40"
                style={{ border: '1px solid var(--brand-border)' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://img.youtube.com/vi/${YOUTUBE_VIDEO_ID}/maxresdefault.jpg`}
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (!img.src.endsWith('/hqdefault.jpg')) {
                      img.src = `https://img.youtube.com/vi/${YOUTUBE_VIDEO_ID}/hqdefault.jpg`;
                    }
                  }}
                  alt=""
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-black/30 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                  <div
                    className="rounded-full w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform"
                    style={{ backgroundColor: 'var(--brand-primary-purple)' }}
                  >
                    <Play className="w-7 h-7 sm:w-8 sm:h-8 text-white fill-white ml-1" />
                  </div>
                </div>
              </button>
            </div>
          </div>
        </section>

        {/* Clinical authority strip */}
        <section
          className="w-full"
          style={{ backgroundColor: 'var(--brand-primary-purple-ultra-light, #FAF5FF)' }}
        >
          <div className="max-w-[1280px] mx-auto px-6 md:px-8 py-10 flex flex-col md:flex-row items-center gap-4 justify-center md:justify-start">
            <div className="flex items-center gap-3">
              <Stethoscope className="w-5 h-5" style={{ color: 'var(--brand-primary-purple)' }} />
              <p className="text-sm" style={{ color: 'var(--brand-text-secondary)' }}>
                Every alert rule, threshold, and three-tier message is signed off by Dr. Manisha Singal.
              </p>
            </div>
          </div>
        </section>
      </main>

      <LandingFooter />

      {/* ============ DEMO VIDEO MODAL ============ */}
      {/* Conditionally mounted so the iframe is destroyed on close — that's
          how playback is stopped (no postMessage handshake needed). */}
      {showDemo && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="A five-minute walkthrough"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
          onClick={(e) => { if (e.target === e.currentTarget) setShowDemo(false); }}
        >
          <div className="relative w-full max-w-5xl aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl">
            <button
              onClick={() => setShowDemo(false)}
              aria-label="Close demo"
              autoFocus
              className="absolute -top-12 right-0 sm:top-3 sm:right-3 z-10 bg-white/10 hover:bg-white/20 backdrop-blur-md text-white rounded-full p-2 flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-white/60"
            >
              <X className="w-5 h-5" />
            </button>
            <iframe
              src={`https://www.youtube.com/embed/${YOUTUBE_VIDEO_ID}?autoplay=1&rel=0&modestbranding=1`}
              title="Cardioplace — 5-minute platform walkthrough"
              width="100%"
              height="100%"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="w-full h-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}
