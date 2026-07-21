'use client';

// Help Center / FAQ — the public self-serve layer and the main ticket-deflector.
// Reads the existing @Public `GET /v2/content?type=FAQ`; no new backend.
//
// Public route (allow-listed in proxy.ts) so a signed-out visitor arriving from
// the /support hub can read it. Renders its own chrome for the same reason the
// hub does — the correct header depends on auth state.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronDown, HelpCircle, Loader2, Search } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import Navbar from '@/components/cardio/Navbar';
import LandingHeader from '@/components/cardio/LandingHeader';
import LandingFooter from '@/components/cardio/LandingFooter';
import AudioButton from '@/components/intake/AudioButton';
import { listFaqArticles, type FaqArticle } from '@/lib/services/content.service';

export default function HelpCenterPage() {
  const { t } = useLanguage();
  const { isLoading, isAuthenticated } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [articles, setArticles] = useState<FaqArticle[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setMounted(true);
    listFaqArticles().then(setArticles);
  }, []);

  // Client-side filter: the whole (small) FAQ set is already fetched, so
  // searching in the browser is instant and needs no endpoint. Matches title,
  // summary AND body — someone searching "recovery codes" is far more likely to
  // be quoting words from inside an answer than from its title.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !articles) return articles ?? [];
    return articles.filter((a) =>
      `${a.title} ${a.summary} ${a.body}`.toLowerCase().includes(q),
    );
  }, [articles, query]);

  const resolving = !mounted || isLoading;
  const authed = mounted && !isLoading && isAuthenticated;

  return (
    <>
      {authed ? <Navbar /> : !resolving && <LandingHeader activeLink="" />}

      <main
        id="main"
        className={`min-h-[100dvh] px-4 py-8 ${authed ? 'pt-24' : ''}`}
        style={{ backgroundColor: '#FAFBFF' }}
      >
        <div className="mx-auto w-full max-w-2xl">
          <Link
            href="/support"
            className="mb-4 inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {t('support.mytickets.back')}
          </Link>

          <div className="mb-6 flex items-start gap-3">
            <HelpCircle className="mt-1 h-6 w-6 shrink-0 text-[#7B00E0]" />
            <div>
              <h1 className="text-2xl font-bold text-slate-800">
                {t('support.help.title')}
              </h1>
              <p className="text-[13px] text-slate-500">{t('support.help.subtitle')}</p>
            </div>
          </div>

          {/* Search — the proposal asks for a *searchable* FAQ, and it is the
              main ticket-deflector, so it has to stay usable as content grows. */}
          {articles && articles.length > 0 && (
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('support.help.searchPlaceholder')}
                aria-label={t('support.help.searchPlaceholder')}
                data-testid="help-search"
                className="w-full rounded-xl border border-slate-200 py-3 pl-9 pr-3 text-[14px] outline-none"
              />
            </div>
          )}

          {!articles && (
            <div className="flex items-center gap-2 text-[13px] text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('support.help.loading')}
            </div>
          )}

          {articles && articles.length === 0 && (
            <div
              data-testid="help-empty"
              className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-[13px] text-slate-500"
            >
              {t('support.help.empty')}
            </div>
          )}

          {articles && articles.length > 0 && visible.length === 0 && (
            <div
              data-testid="help-no-results"
              className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-[13px] text-slate-500"
            >
              {t('support.help.noResults')}
            </div>
          )}

          <div className="space-y-3">
            {visible.map((a) => {
              const open = openId === a.id;
              return (
                <div
                  key={a.id}
                  data-testid="help-article"
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
                >
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : a.id)}
                    aria-expanded={open}
                    className="flex w-full items-start justify-between gap-3 p-4 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block text-[14px] font-semibold text-slate-800">
                        {a.title}
                      </span>
                      <span className="mt-0.5 block text-[13px] text-slate-500">
                        {a.summary}
                      </span>
                    </span>
                    <ChevronDown
                      className={`mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform ${
                        open ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {open && (
                    <div className="border-t border-slate-100 bg-slate-50/50 p-4">
                      {/* Silent-literacy architecture (V2-E): the FAQ is the
                          self-serve surface for the Ward 7/8 cohort, so each
                          answer carries a listen affordance like the rest of the
                          patient-facing app. Reads the answer, not the heading —
                          the heading is already on screen. */}
                      <div className="mb-2 flex justify-end">
                        <AudioButton text={a.body} size="sm" />
                      </div>
                      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">
                        {a.body}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Deflection has limits — always leave a route to a human. */}
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 text-[13px]">
            <span className="text-slate-500">{t('support.help.stillNeedHelp')}</span>{' '}
            <Link href="/support" className="font-semibold text-[#7B00E0] hover:underline">
              {t('landing.goToSupport')}
            </Link>
          </div>
        </div>
      </main>

      {!authed && !resolving && <LandingFooter />}
    </>
  );
}
