'use client';

// Top-bar account menu. Standard admin pattern: an avatar button on the
// right of the header that opens a dropdown with the signed-in user's
// name/email, a link to their profile page, a settings entry, and sign
// out. Mirrors NotificationBell's outside-click / Esc / focus chrome.
//
// (The sidebar footer also exposes a sign-out shortcut — this menu is the
// primary, discoverable affordance most admin apps put in the top-right.)

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { User, Settings, LogOut, ChevronDown } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { roleLabel } from '@/components/user-management/badges';
import type { UserRole } from '@/lib/roleGates';

function initialsFor(name?: string | null, email?: string | null): string {
  const source = (name || email || '').trim();
  if (!source) return 'A';
  return source
    .split(/\s+|@/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function ProfileMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const primaryRole = (user?.roles?.[0] as UserRole | undefined) ?? undefined;

  // Close on outside click — pointerdown so clicking another control isn't
  // swallowed by a closing overlay.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        data-testid="admin-profile-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 h-9 pl-1 pr-2 rounded-full hover:bg-gray-100 cursor-pointer transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <span
          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold"
          style={{
            background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
            boxShadow: '0 2px 8px rgba(123,0,224,0.25)',
          }}
          aria-hidden
        >
          {initialsFor(user?.name, user?.email)}
        </span>
        <ChevronDown
          className="w-3.5 h-3.5 transition-transform"
          style={{
            color: 'var(--brand-text-muted)',
            transform: open ? 'rotate(180deg)' : 'none',
          }}
          aria-hidden
        />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-64 rounded-xl bg-white z-50 overflow-hidden"
          style={{
            boxShadow: '0 10px 40px rgba(0,0,0,0.12)',
            border: '1px solid var(--brand-border)',
          }}
          role="menu"
          aria-label="Account"
        >
          {/* Identity header */}
          <div
            className="px-4 py-3 flex items-center gap-3"
            style={{ borderBottom: '1px solid var(--brand-border)' }}
          >
            <span
              className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-white text-[13px] font-bold"
              style={{
                background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
              }}
              aria-hidden
            >
              {initialsFor(user?.name, user?.email)}
            </span>
            <div className="min-w-0">
              <p
                className="text-[13px] font-bold leading-tight truncate"
                style={{ color: 'var(--brand-text-primary)' }}
              >
                {user?.name || 'Admin user'}
              </p>
              {user?.email && (
                <p
                  className="text-[11px] mt-0.5 leading-tight truncate"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  {user.email}
                </p>
              )}
              {primaryRole && (
                <span
                  className="inline-block mt-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                  style={{
                    backgroundColor: 'var(--brand-primary-purple-light)',
                    color: 'var(--brand-primary-purple)',
                  }}
                >
                  {roleLabel(primaryRole)}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="py-1.5">
            <Link
              href="/profile"
              role="menuitem"
              data-testid="admin-profile-menu-profile"
              onClick={() => setOpen(false)}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] font-semibold transition-colors hover:bg-gray-50"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              <User className="w-4 h-4" style={{ color: 'var(--brand-text-secondary)' }} />
              Profile
            </Link>

            {/* Settings — no dedicated surface yet; shown for discoverability
                with a "Soon" tag, matching the top-bar Search placeholder. */}
            <button
              type="button"
              role="menuitem"
              disabled
              className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] font-semibold cursor-not-allowed"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              <Settings className="w-4 h-4" />
              Settings
              <span
                className="ml-auto px-1.5 py-0.5 rounded text-[10px] font-bold"
                style={{
                  backgroundColor: 'var(--brand-background)',
                  color: 'var(--brand-text-muted)',
                  border: '1px solid var(--brand-border)',
                }}
              >
                Soon
              </span>
            </button>
          </div>

          <div
            className="py-1.5"
            style={{ borderTop: '1px solid var(--brand-border)' }}
          >
            <button
              type="button"
              role="menuitem"
              data-testid="admin-profile-menu-logout"
              onClick={() => {
                setOpen(false);
                logout();
              }}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] font-semibold transition-colors hover:bg-[var(--brand-alert-red-light)]"
              style={{ color: 'var(--brand-alert-red)' }}
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
