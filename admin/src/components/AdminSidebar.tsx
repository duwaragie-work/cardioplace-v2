'use client';

// Fixed left sidebar for the authenticated admin shell. Standard admin-app
// layout: brand mark at top, primary nav with icon + label, user/role
// footer pinned to the bottom. Active nav item gets a subtle purple tint
// + left accent border. Designed to read as "tool" not "patient app".

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  LogOut,
  Bell,
  X,
  Building2,
  UserPlus,
  ClipboardList,
  Settings,
  LifeBuoy,
  FileSearch,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  canManageSupport,
  canManageAudit,
  canViewUsers,
  canViewReports,
  isCoordinatorOnly,
} from '@/lib/roleGates';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Match path prefix as well as exact (e.g. /patients/123). */
  matchPrefix?: boolean;
  /** Predicate; when present and false, item is hidden from the nav. */
  show?: (roles: string[] | null | undefined) => boolean;
}

// /practices is visible to all four clinical admin roles. PROVIDER +
// MED_DIR see only their scoped practices (backend filter via
// PatientAccessService); OPS + SUPER see all. CRUD buttons are hidden on
// the page itself for non-OPS/SUPER. See docs/ACCESS_SCOPE.md (May 2026
// — scope-not-hide).
//
// COORDINATOR is a non-clinical role — they only manage their practice's
// patient roster via /users. Dashboard / Patients / Practices / Alerts
// are all clinical surfaces they don't have access to, so they're hidden
// from the sidebar (and the page-level guards 403 them if they navigate
// by URL).
const PRIMARY_NAV: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    show: (roles) => !isCoordinatorOnly(roles),
  },
  {
    href: '/patients',
    label: 'Patients',
    icon: Users,
    matchPrefix: true,
    // Visible to everyone incl. COORDINATOR — coordinators get a restricted,
    // no-clinical roster + care-team assignment view (page-level branch).
  },
  {
    href: '/practices',
    label: 'Practices',
    icon: Building2,
    matchPrefix: true,
    // COORDINATOR sees Practices too — read-only view of their own practice +
    // staff (backend scopes it; CRUD buttons are OPS/SUPER-only). Dashboard /
    // Patients stay hidden for them (clinical surfaces).
    show: () => true,
  },
  // phase/23 — user management. Visible to COORDINATOR, HEALPLACE_OPS,
  // SUPER_ADMIN, MEDICAL_DIRECTOR, and PROVIDER (2026-07-01). PROVIDER is
  // read-only (sees their active practice's roster, no invite / actions);
  // everyone else manages. All scoped server-side to the active practice.
  {
    href: '/users',
    label: 'Users',
    icon: UserPlus,
    matchPrefix: true,
    show: (roles) => canViewUsers(roles),
  },
  // phase/24 — monthly practice analytics. Oversight surface — visible
  // to MEDICAL_DIRECTOR (scoped to own practice), HEALPLACE_OPS, and
  // SUPER_ADMIN. PROVIDER + COORDINATOR don't see it.
  // phase/24 + phase/25 — practice analytics. The Reports page hosts both
  // the Monthly report and the 90-day Adherence report as tabs.
  {
    href: '/reports',
    label: 'Reports',
    icon: ClipboardList,
    matchPrefix: true,
    show: (roles) => canViewReports(roles),
  },
];

const SECONDARY_NAV: NavItem[] = [
  {
    href: '/notifications',
    label: 'Alerts',
    icon: Bell,
    show: (roles) => !isCoordinatorOnly(roles),
  },
  // Support ticket queue — HEALPLACE_OPS + SUPER_ADMIN only.
  {
    href: '/support',
    label: 'Support',
    icon: LifeBuoy,
    matchPrefix: true,
    show: (roles) => canManageSupport(roles),
  },
  // HIPAA audit-review console (§164.312(b) L2) — HEALPLACE_OPS + SUPER_ADMIN
  // only. Opening it also requires a Rules-of-Behavior ack (L1 AuditAccessGate).
  {
    href: '/audit',
    label: 'Audit',
    icon: FileSearch,
    matchPrefix: true,
    show: (roles) => canManageAudit(roles),
  },
  // Account-level settings (security / 2FA today). Available to every
  // signed-in staff role, including COORDINATOR.
  {
    href: '/settings',
    label: 'Settings',
    icon: Settings,
    matchPrefix: true,
  },
];

interface Props {
  /** When true (mobile drawer), renders an X button in the header. */
  withCloseButton?: boolean;
  onClose?: () => void;
}

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

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;
  const active = item.matchPrefix
    ? pathname === item.href || pathname.startsWith(item.href + '/')
    : pathname === item.href;
  return (
    <Link
      href={item.href}
      className={
        'group relative flex items-center gap-3 px-3 h-10 rounded-lg text-[13.5px] font-semibold transition-all duration-150 ' +
        (active ? '' : 'hover:bg-gray-50 hover:text-[var(--brand-text-primary)]')
      }
      style={{
        backgroundColor: active ? 'var(--brand-primary-purple-light)' : 'transparent',
        color: active ? 'var(--brand-primary-purple)' : 'var(--brand-text-secondary)',
      }}
    >
      {/* Animated left accent — slides in on active. Sits on the left edge
          of the rounded pill so it reads as "you are here". */}
      <span
        aria-hidden
        className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full transition-all duration-200"
        style={{
          backgroundColor: 'var(--brand-primary-purple)',
          opacity: active ? 1 : 0,
          transform: active ? 'scaleY(1)' : 'scaleY(0.4)',
        }}
      />
      <Icon
        className="w-4 h-4 shrink-0 transition-transform duration-150 group-hover:scale-110"
      />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

// Skeleton pill shown in place of a real nav item while the auth context
// is still rehydrating after a refresh. Avoids the flash where everyone
// (incl. COORDINATOR) sees all sidebar items for a tick before the role
// filter collapses them to the actual allowed set.
function NavSkeleton() {
  return (
    <div
      className="flex items-center gap-3 px-3 h-10 rounded-lg"
      aria-hidden
    >
      <span
        className="w-4 h-4 rounded shrink-0 animate-pulse"
        style={{ backgroundColor: 'var(--brand-border)' }}
      />
      <span
        className="h-3 rounded animate-pulse"
        style={{ backgroundColor: 'var(--brand-border)', width: '60%' }}
      />
    </div>
  );
}

export default function AdminSidebar({ withCloseButton, onClose }: Props) {
  const pathname = usePathname() ?? '';
  const { user, isLoading, logout } = useAuth();
  const role = user?.roles?.[0] ?? 'ADMIN';
  // Filter nav items through their `show` predicate. Items without a
  // predicate stay visible to all admin roles (default behaviour).
  const visibleRoles = user?.roles ?? [];
  const visiblePrimary = PRIMARY_NAV.filter((item) =>
    item.show ? item.show(visibleRoles) : true,
  );
  const visibleSecondary = SECONDARY_NAV.filter((item) =>
    item.show ? item.show(visibleRoles) : true,
  );
  // While auth is rehydrating we don't yet know the caller's roles. Render
  // a skeleton instead of the (incorrect) default nav so COORDINATOR
  // doesn't briefly see Dashboard/Patients/Practices flash in.
  const showSkeleton = isLoading || !user;

  return (
    <aside
      className="h-full w-[240px] shrink-0 flex flex-col bg-white relative"
      style={{
        borderRight: '1px solid var(--brand-border)',
        // Subtle right shadow — keeps the sidebar visually separated from
        // the main content without the harsh hard border alone.
        boxShadow: '1px 0 0 rgba(15, 23, 42, 0.02), 4px 0 16px -8px rgba(15, 23, 42, 0.04)',
      }}
    >
      {/* Brand mark */}
      <div
        className="shrink-0 flex items-center justify-between gap-2 px-4 h-14"
        style={{ borderBottom: '1px solid var(--brand-border)' }}
      >
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 min-w-0 group"
        >
          {/* Cardioplace icon stands on its own — the SVG already includes
              the purple disk + heart, so no wrapper background or shadow
              is needed. Sized at 28px so it visually balances the 13px
              + 10px two-line text and leaves the "Cardioplace" wordmark
              full breathing room (icon's square frame has transparent
              corners that would otherwise crowd the text). */}
          <Image
            src="/cardioplace-icon.svg"
            alt=""
            width={28}
            height={28}
            className="shrink-0 w-7 h-7 transition-transform duration-200 group-hover:scale-105"
          />
          <div className="min-w-0">
            <p
              className="text-[13px] font-bold leading-none truncate"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              Cardioplace
            </p>
            <p
              className="text-[10px] mt-0.5 font-semibold uppercase tracking-wider truncate"
              style={{ color: 'var(--brand-primary-purple)' }}
            >
              Admin
            </p>
          </div>
        </Link>
        {withCloseButton && (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 cursor-pointer"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
          </button>
        )}
      </div>

      {/* Primary nav */}
      <nav className="flex-1 overflow-y-auto thin-scrollbar px-2 py-3 space-y-0.5">
        <p
          className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          Workspace
        </p>
        {showSkeleton ? (
          <>
            <NavSkeleton />
            <NavSkeleton />
            <NavSkeleton />
          </>
        ) : (
          visiblePrimary.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))
        )}

        {/* "More" section — hidden entirely (incl. its header) when the
            section has no items, e.g. for COORDINATOR. */}
        {!showSkeleton && visibleSecondary.length > 0 && (
          <>
            <p
              className="px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              More
            </p>
            {visibleSecondary.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </>
        )}
      </nav>

      {/* User footer */}
      <div
        className="shrink-0 p-3"
        style={{ borderTop: '1px solid var(--brand-border)' }}
      >
        <div
          className="flex items-center gap-2.5 p-2 rounded-lg transition-colors hover:bg-white"
          style={{ backgroundColor: 'var(--brand-background)' }}
        >
          {showSkeleton ? (
            <>
              <div
                className="shrink-0 w-9 h-9 rounded-lg animate-pulse"
                style={{ backgroundColor: 'var(--brand-border)' }}
                aria-hidden
              />
              <div className="flex-1 min-w-0 space-y-1.5">
                <span
                  className="block h-3 rounded animate-pulse"
                  style={{
                    backgroundColor: 'var(--brand-border)',
                    width: '70%',
                  }}
                />
                <span
                  className="block h-2 rounded animate-pulse"
                  style={{
                    backgroundColor: 'var(--brand-border)',
                    width: '40%',
                  }}
                />
              </div>
            </>
          ) : (
            <>
              <div
                className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-white text-[12px] font-bold"
                style={{
                  background:
                    'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
                  boxShadow: '0 2px 8px rgba(123,0,224,0.25)',
                }}
              >
                {initialsFor(user?.name, user?.email)}
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className="text-[12.5px] font-bold leading-tight truncate"
                  style={{ color: 'var(--brand-text-primary)' }}
                >
                  {user?.name || 'Admin user'}
                </p>
                <p
                  className="text-[10px] mt-0.5 font-semibold uppercase tracking-wider truncate"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  {role.replace(/_/g, ' ')}
                </p>
              </div>
              <button
                type="button"
                onClick={logout}
                className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 hover:bg-[var(--brand-alert-red-light)] hover:text-[var(--brand-alert-red)] cursor-pointer"
                style={{ color: 'var(--brand-text-muted)' }}
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
