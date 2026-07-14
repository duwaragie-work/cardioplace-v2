'use client';

// Shared layout for the admin app's Terms of Service + Privacy Policy
// pages. Encapsulates the brand-aligned visual style — purple-accented
// hero card, numbered section cards, contact callout — so the page
// files contain only their counsel-applied copy (no styling drift
// across legal documents).
//
// Wording inside each <PolicySection> remains verbatim from counsel;
// only the visual chrome around it changes.

import type { ReactNode } from 'react';
import { Shield } from 'lucide-react';
import LandingHeader from '../LandingHeader';
import LandingFooter from '../LandingFooter';

const KIND_LABEL: Record<'terms' | 'privacy', string> = {
  terms: 'Legal · Terms',
  privacy: 'Legal · Privacy',
};

interface PolicyShellProps {
  kind: 'terms' | 'privacy';
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
        tabIndex={-1}
        className="flex-1 pt-[100px] sm:pt-[120px] lg:pt-[140px] pb-16 px-4 sm:px-6 lg:px-12"
      >
        <div className="max-w-[860px] mx-auto">
          {/* Hero — quiet document header. Plain white background, small
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
              <span className="text-[10px] font-bold uppercase tracking-wider">
                {KIND_LABEL[kind]}
              </span>
            </div>
            <h1
              className="font-bold tracking-tight text-3xl sm:text-4xl lg:text-[44px] mb-3"
              style={{ color: 'var(--brand-text-primary, #170c1d)' }}
            >
              {title}
            </h1>
            {intro && (
              <p
                className="text-[15px] sm:text-base leading-relaxed max-w-[640px] mb-3"
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
  /** Display number shown in the leading chip (e.g. "1", "2"). The
   *  counsel-applied wording originally read "1. Eligibility" in the
   *  h2 itself; the number is moved into the chip and the title stays
   *  clean. Same content, better hierarchy. */
  number: string;
  title: string;
  /** Optional anchor id — wired to `id={anchor}` so we can deep-link
   *  ("/terms#audit-trails"). If omitted we use the section's title. */
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
          className="shrink-0 inline-flex items-center justify-center min-w-[34px] h-8 px-2 rounded-lg text-[12px] font-bold tabular-nums"
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
        className="space-y-3 text-[15px] leading-relaxed"
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
  /** List of contact email addresses. Each becomes a mailto: link. */
  emails: string[];
  /** Optional org name to print above the email list (e.g. "Healplace.com, Inc."). */
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
          className="text-[14px] mb-3"
          style={{ color: 'var(--brand-text-secondary, #374151)' }}
        >
          {intro}
        </p>
      )}
      {organization && (
        <p
          className="text-[14px] font-semibold mb-2"
          style={{ color: 'var(--brand-text-primary, #170c1d)' }}
        >
          {organization}
        </p>
      )}
      <ul className="space-y-1.5 text-[14px]">
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
