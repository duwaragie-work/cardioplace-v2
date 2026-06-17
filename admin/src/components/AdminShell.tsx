'use client';

// Authenticated admin shell — sidebar + top bar + content area. Wraps
// every authed page (dashboard, patients, calls, settings, …). Public
// landing pages (/, /home, /about, /sign-in) bypass the shell entirely
// and keep their own LandingHeader / LandingFooter.
//
// Mobile (< md): sidebar hides; a hamburger in the top bar opens it as
// a slide-in drawer with a backdrop. Desktop (md+): sidebar is fixed
// and always visible.

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import AdminSidebar from './AdminSidebar';
import AdminTopBar from './AdminTopBar';
import ZeroPracticeModal from './ZeroPracticeModal';

const PUBLIC_PATHS = new Set<string>(['/', '/home', '/about', '/sign-in', '/terms', '/privacy']);

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Bypass on landing / auth / invite-activation routes — they keep
  // their own chrome (and the invitee has no session yet, so the admin
  // sidebar/top bar would just bounce them back to /sign-in).
  if (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/activate/')
  ) {
    return <>{children}</>;
  }

  return (
    // Body handles the scroll — this keeps the browser's native main
    // scrollbar when pages have long content (e.g. patient list), and
    // nothing when they fit. Sidebar + top bar are sticky so they stay
    // anchored while the rest of the page scrolls.
    <div
      className="min-h-screen flex"
      style={{ backgroundColor: '#FAFBFF' }}
    >
      {/* Desktop sidebar — sticky so it stays visible while the body scrolls. */}
      <div className="hidden md:block sticky top-0 h-screen shrink-0">
        <AdminSidebar />
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 md:hidden"
          >
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setDrawerOpen(false)}
            />
            <motion.div
              initial={{ x: -240 }}
              animate={{ x: 0 }}
              exit={{ x: -240 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="absolute left-0 top-0 h-full"
            >
              <AdminSidebar withCloseButton onClose={() => setDrawerOpen(false)} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main column — top bar is sticky so it pins to the viewport during
          scroll; main is flex-1 so when the page content is shorter than
          the available column height, main absorbs the extra space (filled
          with the AdminShell background, which matches the page bg so the
          gap is invisible). When content is long, the body scrolls with
          the native scrollbar. */}
      <div className="flex-1 flex flex-col min-w-0">
        <AdminTopBar onOpenMobileNav={() => setDrawerOpen(true)} />
        {/* Single page landmark + skip-link target. tabIndex=-1 lets the
            "Skip to main content" link move focus here (not just scroll). */}
        <main id="main" tabIndex={-1} className="flex-1 min-h-0">{children}</main>
      </div>
      {/* Phase/practice-identity — defensive zero-state block when a
          practice-bound user lands without an active practice (e.g. their
          last membership was revoked while signed in). */}
      <ZeroPracticeModal />
    </div>
  );
}
