'use client';

// Shared layout for the patient app's Terms of Service + Privacy Policy
// pages. Mirror of admin/src/components/policy/PolicyShell.tsx — same
// visual chrome (purple-accented hero card, numbered section cards,
// contact callout) so legal pages read consistently across both apps.
//
// Wording inside each <PolicySection> stays verbatim from counsel; only
// the visual chrome around it changes.

import type { ReactNode } from 'react';
import { Shield } from 'lucide-react';
import LandingHeader from '../LandingHeader';
import LandingFooter from '../LandingFooter';

/**
 * The healthcare legal set. `terms` + `privacy` shipped first; the remaining
 * five are the HIPAA/ACA/accessibility documents a clinical app in a
 * federally-funded pilot needs. Engineering owns the routes and this chrome —
 * the WORDING inside each page is legal/compliance's, and until they deliver it
 * those pages carry a visible placeholder and are noindex + unlinked.
 */
export type PolicyKind =
  | 'terms'
  | 'privacy'
  | 'hipaa'
  | 'cookies'
  | 'accessibility'
  | 'nondiscrimination'
  | 'telehealth';

const KIND_LABEL: Record<PolicyKind, string> = {
  terms: 'Legal · Terms',
  privacy: 'Legal · Privacy',
  hipaa: 'Legal · HIPAA Notice',
  cookies: 'Legal · Cookies',
  accessibility: 'Legal · Accessibility',
  nondiscrimination: 'Legal · Nondiscrimination',
  telehealth: 'Legal · Telehealth Consent',
};

interface PolicyShellProps {
  kind: PolicyKind;
  title: string;
  /** Optional one-line summary line under the hero title. Non-binding —
   *  the actual legal content lives in the sections below. */
  intro?: string;
  lastUpdated: string;
  children: ReactNode;
}

export function PolicyShell({
  kind,
  title,
  intro,
  lastUpdated,
  children,
}: PolicyShellProps) {
  return (
    <div
      className="flex flex-col min-h-screen"
      style={{ backgroundColor: 'var(--brand-background, #FAFBFF)' }}
    >
      <LandingHeader activeLink="" />

      <main
        id="main"
        className="flex-1 pt-[100px] sm:pt-[120px] lg:pt-[140px] pb-16 px-4 sm:px-6 lg:px-12"
      >
        <div className="max-w-[860px] mx-auto">
          {/* Hero — quiet document header. Plain background, small
              category chip + shield, big dark title, intro line, last-
              updated as muted text. No gradient, no shadow — lets the
              section cards below carry the visual weight. */}
          <header className="mb-8 sm:mb-10">
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full mb-4"
              style={{
                backgroundColor: 'var(--brand-primary-purple-light, #F3F0FF)',
                color: 'var(--brand-primary-purple, #7B00E0)',
              }}
            >
              <Shield className="w-3 h-3" aria-hidden />
              <span className="text-[0.625rem] font-bold uppercase tracking-wider">
                {KIND_LABEL[kind]}
              </span>
            </div>
            <h1
              className="font-bold tracking-tight text-3xl sm:text-4xl lg:text-[2.75rem] mb-3"
              style={{ color: 'var(--brand-text-primary, #170c1d)' }}
            >
              {title}
            </h1>
            {intro && (
              <p
                className="text-[0.9375rem] sm:text-base leading-relaxed max-w-[640px] mb-3"
                style={{ color: 'var(--brand-text-secondary, #374151)' }}
              >
                {intro}
              </p>
            )}
            <p
              className="text-xs sm:text-sm"
              style={{ color: 'var(--brand-text-muted, #6b7280)' }}
            >
              Last updated: {lastUpdated}
            </p>
          </header>

          {/* Section cards */}
          <div className="space-y-4">{children}</div>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}

interface PolicySectionProps {
  number: string;
  title: string;
  anchor?: string;
  children: ReactNode;
}

export function PolicySection({
  number,
  title,
  anchor,
  children,
}: PolicySectionProps) {
  const id =
    anchor ??
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  return (
    <section
      id={id}
      className="bg-white rounded-2xl p-5 sm:p-7 scroll-mt-24"
      style={{ boxShadow: 'var(--brand-shadow-card, 0 1px 20px rgba(123,0,224,0.07))' }}
    >
      <div className="flex items-center gap-3 mb-4">
        <span
          className="shrink-0 inline-flex items-center justify-center min-w-[34px] h-8 px-2 rounded-lg text-[0.75rem] font-bold tabular-nums"
          style={{
            backgroundColor: 'var(--brand-primary-purple-light, #F3F0FF)',
            color: 'var(--brand-primary-purple, #7B00E0)',
          }}
          aria-hidden
        >
          {number}
        </span>
        <h2
          className="font-semibold text-lg sm:text-xl tracking-tight"
          style={{ color: 'var(--brand-text-primary, #170c1d)' }}
        >
          {title}
        </h2>
      </div>
      <div
        className="space-y-3 text-[0.9375rem] leading-relaxed"
        style={{ color: 'var(--brand-text-primary, #1F2937)' }}
      >
        {children}
      </div>
    </section>
  );
}

interface PolicyContactProps {
  heading?: string;
  intro?: string;
  emails: string[];
  organization?: string;
}

export function PolicyContact({
  heading = 'Questions or feedback',
  intro,
  emails,
  organization,
}: PolicyContactProps) {
  return (
    <div
      className="mt-6 rounded-2xl p-5 sm:p-7"
      style={{
        backgroundColor: 'var(--brand-primary-purple-light, #F3F0FF)',
        border: '1.5px solid var(--brand-primary-purple, #7B00E0)',
      }}
    >
      <h3
        className="font-semibold text-lg mb-2"
        style={{ color: 'var(--brand-primary-purple, #7B00E0)' }}
      >
        {heading}
      </h3>
      {intro && (
        <p
          className="text-[0.875rem] mb-3"
          style={{ color: 'var(--brand-text-secondary, #374151)' }}
        >
          {intro}
        </p>
      )}
      {organization && (
        <p
          className="text-[0.875rem] font-semibold mb-2"
          style={{ color: 'var(--brand-text-primary, #170c1d)' }}
        >
          {organization}
        </p>
      )}
      <ul className="space-y-1.5 text-[0.875rem]">
        {emails.map((email) => (
          <li key={email}>
            <a
              href={`mailto:${email}`}
              className="font-semibold underline underline-offset-2"
              style={{ color: 'var(--brand-primary-purple, #7B00E0)' }}
            >
              {email}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
