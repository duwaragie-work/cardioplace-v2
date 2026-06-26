'use client';

/**
 * Phase/practice-identity (Manisha 2026-06-12 Access Control §1).
 *
 * Header chip showing the active practice the session is acting as. For
 * users with only one membership (or org-wide roles), the chip is a
 * non-interactive label. For multi-practice members, clicking opens a
 * dropdown of practices the user may switch to — selecting one calls
 * useAuth().switchPractice() which POSTs /auth/switch-practice + mints a
 * fresh access token carrying the new activePracticeId JWT claim.
 *
 * NULL active practice (SUPER_ADMIN / HEALPLACE_OPS / no membership) →
 * nothing renders. Audit-trail attribution captures NULL in those rows,
 * which is the signed Manisha allowance.
 */

import { useEffect, useRef, useState } from 'react';
import { Building2, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';

export default function PracticeContextChip() {
  const { activePractice, availablePractices, switchPractice } = useAuth();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Click-outside to close. Avoid Radix for a single-purpose chip — the
  // admin app uses plain Tailwind elsewhere and Radix Popover would pull
  // in a sibling dependency for one menu.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!activePractice) return null;

  const multi = availablePractices.length >= 2;
  // PR #90 Bug A — the backend now resolves the practice name on
  // select/switch/profile, so activePractice.name is populated. Defensive:
  // if it's somehow still empty (a stale id-only response), render nothing
  // rather than the misleading "Acting as practice" literal that smoke
  // surfaced as "Acting as: Acting as practice".
  const label = activePractice.name;
  if (!label) return null;

  if (!multi) {
    return (
      <div
        className="hidden md:inline-flex items-center gap-2 h-9 px-3 rounded-lg text-[12.5px]"
        style={{
          backgroundColor: 'var(--brand-background)',
          color: 'var(--brand-text-secondary)',
          border: '1px solid var(--brand-border)',
        }}
        title={`${t('topBar.actingAs.label')}: ${label}`}
      >
        <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="truncate max-w-[12rem]">
          {t('topBar.actingAs.label')}: {label}
        </span>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hidden md:inline-flex items-center gap-2 h-9 px-3 rounded-lg text-[12.5px] hover:bg-purple-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
        style={{
          backgroundColor: 'var(--brand-background)',
          color: 'var(--brand-text-primary)',
          border: '1px solid var(--brand-border)',
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('topBar.actingAs.label')}: ${label}`}
      >
        <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="truncate max-w-[10rem]">{label}</span>
        <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 rounded-lg bg-white shadow-lg ring-1 ring-black/5 py-1 z-50"
        >
          <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-gray-500">
            {t('topBar.actingAs.switchTo')}
          </div>
          {availablePractices.map((p) => {
            const isCurrent = p.id === activePractice.id;
            const isSwitching = switching === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="menuitem"
                disabled={isCurrent || switching !== null}
                onClick={async () => {
                  setSwitching(p.id);
                  try {
                    await switchPractice(p.id);
                    setOpen(false);
                    // Phase/practice-identity — confirmation toast so the
                    // provider knows their audit context flipped. The chip
                    // label updates from auth-context state on next render.
                    toast.success(
                      `${t('topBar.actingAs.switched') ?? 'Now acting as'}: ${p.name}`,
                    );
                  } catch (err) {
                    console.error('[practice-switch] failed', err);
                    toast.error(
                      err instanceof Error ? err.message : 'Could not switch practice',
                    );
                  } finally {
                    setSwitching(null);
                  }
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60 disabled:hover:bg-transparent flex items-center justify-between"
              >
                <span className="truncate">{p.name}</span>
                <span className="text-xs text-gray-500">
                  {isCurrent
                    ? t('topBar.actingAs.current')
                    : isSwitching
                      ? t('topBar.actingAs.switching')
                      : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
