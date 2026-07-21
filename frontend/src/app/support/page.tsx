'use client';

/**
 * The single adaptive `/support` surface — the consolidation Lakshitha asked
 * for. One route, two audiences: a signed-out visitor sees the public subset
 * ("I can't sign in", non-PHI contact, legal); on login the authenticated
 * options unhide on the SAME page (raise/track requests, account actions, the
 * care-team redirect). This replaces support being scattered across Settings,
 * the sign-in page and a separate footer form.
 *
 * Route wiring this page depends on:
 *  - proxy.ts        — `/support` is allow-listed public, with an explicit
 *                      PRIVATE_ROUTE_EXCEPTION keeping `/support/my-tickets` gated
 *                      (PUBLIC_ROUTES is prefix-matched).
 *  - NavbarWrapper   — `/support` is on HIDE_NAV_PATHS so this page renders its
 *                      OWN chrome, since the correct chrome depends on auth.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ChevronRight,
  KeyRound,
  LifeBuoy,
  Loader2,
  Lock,
  MessageSquare,
  PhoneCall,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import Navbar from '@/components/cardio/Navbar';
import LandingHeader from '@/components/cardio/LandingHeader';
import LandingFooter from '@/components/cardio/LandingFooter';
import SupportContactForm from '@/components/SupportContactForm';
import PublicContactForm from '@/components/PublicContactForm';
import ClinicalRedirectPanel from '@/components/support/ClinicalRedirectPanel';

/** A tappable card that navigates somewhere. */
function LinkCard({
  href,
  icon,
  title,
  body,
  testId,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  testId: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300"
    >
      <span className="mt-0.5 shrink-0 text-[#7B00E0]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-slate-800">{title}</span>
        <span className="mt-0.5 block text-[13px] text-slate-500">{body}</span>
      </span>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300" />
    </Link>
  );
}

/** A section wrapper with a heading. */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function SupportHubPage() {
  const { t } = useLanguage();
  const { isLoading, isAuthenticated } = useAuth();
  // SSR-safe auth branching: auth state only resolves on the client, so render
  // the neutral shell until mounted or the hydration output won't match.
  // Mirrors LandingFooter's mounted + isLoading + isAuthenticated gate.
  const [mounted, setMounted] = useState(false);
  // Deep-link target from the entry points: the sign-in page sends
  // `?flow=signin[&email=]`, in-app help sends `?flow=account`. Read from
  // window.location rather than useSearchParams so this page needs no Suspense
  // boundary — same approach as support/locked-out/page.tsx.
  const [flow, setFlow] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const params = new URLSearchParams(window.location.search);
    setFlow(params.get('flow'));
    setEmail(params.get('email'));
  }, []);

  // Carry the typed email through to the locked-out form so a user arriving
  // from the sign-in page doesn't retype it.
  const lockedOutHref = email
    ? `/support/locked-out?email=${encodeURIComponent(email)}`
    : '/support/locked-out';

  const resolving = !mounted || isLoading;
  const authed = mounted && !isLoading && isAuthenticated;

  return (
    <>
      {/* Chrome depends on auth, which is why the global navbar is suppressed
          for this route (NavbarWrapper HIDE_NAV_PATHS). */}
      {authed ? <Navbar /> : !resolving && <LandingHeader activeLink="" />}

      <main
        id="main"
        className={`min-h-[100dvh] px-4 py-8 ${authed ? 'pt-24' : ''}`}
        style={{ backgroundColor: '#FAFBFF' }}
      >
        <div className="mx-auto w-full max-w-2xl">
          <div className="mb-6 flex items-start gap-3">
            <LifeBuoy className="mt-1 h-6 w-6 shrink-0 text-[#7B00E0]" />
            <div>
              <h1 className="text-2xl font-bold text-slate-800">
                {t('support.hub.title')}
              </h1>
              <p className="text-[13px] text-slate-500">{t('support.hub.subtitle')}</p>
            </div>
          </div>

          {/* Emergency carve-out — always visible, both audiences, above
              everything else. Never gated behind auth or a category choice. */}
          <div
            data-testid="support-emergency-banner"
            className="mb-6 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3"
          >
            <PhoneCall className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
            <p className="text-[13px] text-red-800">
              <span className="font-semibold">{t('support.hub.emergencyTitle')}</span>
              {' — '}
              {t('support.hub.emergencyBody')}
            </p>
          </div>

          {resolving ? (
            <div
              data-testid="support-hub-loading"
              className="flex items-center gap-2 text-[13px] text-slate-400"
            >
              <Loader2 className="h-4 w-4 animate-spin" /> {t('support.hub.loading')}
            </div>
          ) : authed ? (
            /* ── Signed in — everything unhidden ─────────────────────────── */
            <div data-testid="support-hub-authed" className="space-y-8">
              <Section title={t('support.hub.raiseTitle')}>
                <p className="text-[13px] text-slate-500">{t('support.hub.raiseBody')}</p>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <SupportContactForm defaultOpenAccountFlow={flow === 'account'} />
                </div>
              </Section>

              <Section title={t('support.hub.myRequests')}>
                <LinkCard
                  href="/support/my-tickets"
                  icon={<MessageSquare className="h-5 w-5" />}
                  title={t('support.hub.myRequests')}
                  body={t('support.hub.myRequestsBody')}
                  testId="support-hub-my-tickets"
                />
                <LinkCard
                  href="/settings"
                  icon={<ShieldCheck className="h-5 w-5" />}
                  title={t('support.hub.accountSecurity')}
                  body={t('support.hub.accountSecurityBody')}
                  testId="support-hub-account"
                />
              </Section>

              {/* Clinical questions never become support tickets. */}
              <ClinicalRedirectPanel isAuthenticated />
            </div>
          ) : (
            /* ── Signed out — the public subset only ─────────────────────── */
            <div data-testid="support-hub-public" className="space-y-8">
              {/* Arriving from the sign-in page's "Need help?" — lead with this
                  and carry the typed email through so nothing is retyped. */}
              <Section title={t('support.hub.cantSignIn')}>
                <div
                  className={
                    flow === 'signin'
                      ? 'rounded-2xl ring-2 ring-[#7B00E0]/30'
                      : undefined
                  }
                >
                  <LinkCard
                    href={lockedOutHref}
                    icon={<KeyRound className="h-5 w-5" />}
                    title={t('support.hub.cantSignIn')}
                    body={t('support.hub.cantSignInBody')}
                    testId="support-hub-locked-out"
                  />
                </div>
              </Section>

              <Section title={t('support.hub.generalContact')}>
                <p className="text-[13px] text-slate-500">
                  {t('support.hub.generalContactBody')}
                </p>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <PublicContactForm />
                </div>
              </Section>

              {/* A signed-out visitor has no care-team channel — the panel
                  routes them to sign in, and still surfaces 911. */}
              <ClinicalRedirectPanel isAuthenticated={false} />

              <Section title={t('support.hub.legal')}>
                <div className="flex flex-wrap gap-x-4 gap-y-2 text-[13px]">
                  <Link href="/privacy" className="text-[#7B00E0] hover:underline">
                    {t('landing.privacy')}
                  </Link>
                  <Link href="/terms" className="text-[#7B00E0] hover:underline">
                    {t('landing.terms')}
                  </Link>
                </div>
              </Section>

              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[13px]">
                <Lock className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="text-slate-500">{t('support.hub.signInPrompt')}</span>
                <Link
                  href="/sign-in"
                  data-testid="support-hub-signin"
                  className="ml-auto inline-flex items-center gap-1 font-semibold text-[#7B00E0] hover:underline"
                >
                  <Send className="h-3.5 w-3.5" />
                  {t('support.hub.signInCta')}
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>

      {!authed && !resolving && <LandingFooter />}
    </>
  );
}
