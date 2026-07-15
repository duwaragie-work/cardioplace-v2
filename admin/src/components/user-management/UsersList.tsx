'use client';

// Merged users + invites table with per-row actions. The backend returns
// `data: User[]` (or CoordinatorPatientRow[] for COORDINATOR callers) and
// `invites: UserInvite[]`. We splice them into a single rendered list
// where the invite rows carry the synthetic INVITE_PENDING status and
// "Resend / Revoke" actions instead of "Deactivate".

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Loader2,
  MoreVertical,
  Send,
  ShieldOff,
  Trash2,
  Undo2,
  UserX,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  type CoordinatorPatientRow,
  type UserInviteRow,
  type UserListResponse,
  type UserRow,
} from '@/lib/services/user-management.service';
import {
  canDeactivateUser,
  canPermanentCloseUsers,
  canResetUserMfa,
  type UserRole,
} from '@/lib/roleGates';
import { useAuth } from '@/lib/auth-context';
import type { PracticeOption } from './InviteUserModal';
import { RoleBadge, StatusBadge } from './badges';

interface Props {
  /** Whether the caller is a COORDINATOR (collapsed columns + status text). */
  coordinatorView: boolean;
  /** Whether the caller can perform write actions (invite/deactivate/close/
   *  resend/revoke). False for read-only PROVIDER — the row action menu is
   *  suppressed entirely. Defaults to true for backward compatibility. */
  canManage?: boolean;
  /** Backend payload from `listUsers`. */
  response: UserListResponse | null;
  loading: boolean;
  page: number;
  limit: number;
  practices: PracticeOption[];
  onPageChange: (next: number) => void;
  onDeactivateClick: (row: UserRow | CoordinatorPatientRow) => void;
  /** Open the permanent-close (tombstone) modal for a user row. Omitted when
   *  the caller can't act — the action then never renders. */
  onCloseClick?: (row: UserRow) => void;
  /** Open the MFA-reset modal for a staff row. Omitted when the caller can't
   *  reset MFA — the action then never renders. */
  onResetMfaClick?: (row: { id: string; name: string }) => void;
  /** Open the biometric-reset modal for a patient row. Omitted when the caller
   *  can't reset — the action then never renders. */
  onResetBiometricClick?: (row: { id: string; name: string }) => void;
  onReactivate: (id: string) => Promise<void> | void;
  onResendInvite: (inviteId: string) => Promise<void> | void;
  onRevokeInvite: (inviteId: string) => Promise<void> | void;
  /** Inflight row id — disables the action buttons + shows spinner. */
  pendingRowId: string | null;
}

interface CombinedRow {
  id: string;
  kind: 'user' | 'invite';
  name: string;
  email: string;
  role: string | null;
  /** Full role array of the target, used for the per-row deactivate gate.
   *  Empty for invite rows (they don't have an account yet). */
  targetRoles: string[];
  practiceId: string | null;
  status: 'ACTIVE' | 'BLOCKED' | 'SUSPENDED' | 'DEACTIVATED' | 'CLOSED' | 'INVITE_PENDING';
  invitedAt: string | null;
  /** True only for activated users with an enrolled TOTP authenticator. */
  mfaEnrolled: boolean;
  /** True only for patients with a registered biometric passkey. */
  biometricEnrolled: boolean;
  raw: UserRow | CoordinatorPatientRow | UserInviteRow;
}

function isCoordinatorPatientRow(
  row: UserRow | CoordinatorPatientRow,
): row is CoordinatorPatientRow {
  return (
    typeof (row as CoordinatorPatientRow).status === 'string' &&
    !Array.isArray((row as UserRow).roles)
  );
}

function deriveStatus(
  row: UserRow | CoordinatorPatientRow,
): CombinedRow['status'] {
  if (isCoordinatorPatientRow(row)) {
    if (row.status === 'Deactivated') return 'DEACTIVATED';
    if (row.status === 'Blocked') return 'BLOCKED';
    return 'ACTIVE';
  }
  return row.accountStatus;
}

function formatDate(s: string | null): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

// A single row's action set, collapsed into a 3-dots (kebab) menu so the
// Actions column stays one narrow, consistent width no matter how many
// actions a row qualifies for.
type MenuItem = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  danger?: boolean;
  onClick: () => void;
};

function ActionsMenu({
  items,
  pending,
  testId,
}: {
  items: MenuItem[];
  pending: boolean;
  testId: string;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  // Fixed-viewport coordinates for the portaled menu. The menu is rendered into
  // document.body (not the row) so it can't be clipped by the table's
  // overflow-x-auto / the card's overflow-hidden — which is what cut off the
  // last rows' menus when they were absolutely positioned inside the cell.
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const MENU_WIDTH = 208; // w-52 (13rem)

  // Position relative to the trigger, in viewport coords (for position:fixed).
  // Right-aligned to the button; flips above when there isn't room below; and
  // clamped to the viewport so it never spills off an edge.
  function computeCoords() {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const estimatedHeight = items.length * 44 + 16;
    const openUp = window.innerHeight - rect.bottom < estimatedHeight;
    const top = openUp
      ? Math.max(8, rect.top - estimatedHeight - 4)
      : rect.bottom + 4;
    const left = Math.min(
      Math.max(8, rect.right - MENU_WIDTH),
      window.innerWidth - MENU_WIDTH - 8,
    );
    setCoords({ top, left });
  }

  function toggle() {
    setOpen((v) => {
      const next = !v;
      if (next) computeCoords();
      return next;
    });
  }

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      // The menu lives in a portal, so it is NOT inside btnRef — check both.
      if (
        btnRef.current &&
        !btnRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    // Keep the menu glued to its button while the page/table scrolls or resizes
    // (capture:true catches scrolls on the inner overflow-x-auto container too).
    function reposition() {
      computeCoords();
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (items.length === 0) {
    return (
      <span className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
        —
      </span>
    );
  }

  return (
    <div className="inline-block text-left">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('userManagement.action.menu')}
        data-testid={`admin-user-actions-${testId}`}
        className="w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-gray-100 cursor-pointer disabled:opacity-50"
        style={{ color: 'var(--brand-text-muted)' }}
      >
        {pending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <MoreVertical className="w-4 h-4" />
        )}
      </button>
      {open && coords && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[100] w-52 bg-white rounded-xl overflow-hidden py-1"
            style={{
              top: coords.top,
              left: coords.left,
              boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
              border: '1px solid var(--brand-border)',
            }}
          >
            {items.map((it) => (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                data-testid={`admin-user-action-${it.key}-${testId}`}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
                className="w-full text-left px-4 py-2.5 text-[13px] font-medium inline-flex items-center gap-2.5 hover:bg-gray-50 cursor-pointer"
                style={{ color: it.danger ? 'var(--brand-alert-red)' : 'var(--brand-text-primary)' }}
              >
                <it.icon className="w-3.5 h-3.5" />
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

export default function UsersList({
  coordinatorView,
  canManage = true,
  response,
  loading,
  page,
  limit,
  practices,
  onPageChange,
  onDeactivateClick,
  onCloseClick,
  onResetMfaClick,
  onResetBiometricClick,
  onReactivate,
  onResendInvite,
  onRevokeInvite,
  pendingRowId,
}: Props) {
  const { t } = useLanguage();
  const { user: caller } = useAuth();
  const callerCanResetMfa = canResetUserMfa(caller);
  const practiceById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of practices) m.set(p.id, p.name);
    return m;
  }, [practices]);

  const combined: CombinedRow[] = useMemo(() => {
    if (!response) return [];
    const users: CombinedRow[] = (response.data as Array<UserRow | CoordinatorPatientRow>).map(
      (u) => ({
        id: u.id,
        kind: 'user' as const,
        name: u.name ?? '—',
        email: u.email ?? '—',
        role: isCoordinatorPatientRow(u) ? null : u.roles[0] ?? null,
        // CoordinatorPatientRow is always a PATIENT (backend invariant);
        // UserRow carries the full roles array.
        targetRoles: isCoordinatorPatientRow(u) ? ['PATIENT'] : u.roles,
        // CoordinatorPatientRow doesn't carry practiceId (the column is
        // hidden in the coordinator view anyway); for UserRow take the
        // server-derived value.
        practiceId: isCoordinatorPatientRow(u) ? null : u.practiceId ?? null,
        status: deriveStatus(u),
        invitedAt: isCoordinatorPatientRow(u) ? null : u.createdAt,
        mfaEnrolled: isCoordinatorPatientRow(u) ? false : u.mfaEnrolled === true,
        biometricEnrolled: isCoordinatorPatientRow(u)
          ? false
          : u.biometricEnrolled === true,
        raw: u,
      }),
    );
    const invites: CombinedRow[] = response.invites.map((inv) => ({
      id: inv.id,
      kind: 'invite' as const,
      name: inv.name,
      email: inv.email,
      role: inv.role,
      targetRoles: [],
      practiceId: inv.practiceId,
      status: 'INVITE_PENDING' as const,
      invitedAt: inv.invitedAt,
      mfaEnrolled: false,
      biometricEnrolled: false,
      raw: inv,
    }));
    // Pending invites first so they don't get buried on page 1.
    return [...invites, ...users];
  }, [response]);

  // Live region for action results — single status node, polite.
  const [liveMsg, setLiveMsg] = useState<string>('');

  async function handleResend(inviteId: string) {
    await onResendInvite(inviteId);
    setLiveMsg(t('userManagement.toast.resent'));
  }
  async function handleRevoke(inviteId: string) {
    await onRevokeInvite(inviteId);
    setLiveMsg(t('userManagement.toast.revoked'));
  }
  function handleReactivate(id: string) {
    // Opens the reactivation modal in the parent (the deliberate re-grant flow);
    // the parent announces success after the modal submits.
    onReactivate(id);
  }

  const total = response?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <section
      className="bg-white rounded-2xl overflow-hidden"
      style={{ boxShadow: 'var(--brand-shadow-card)' }}
      aria-label="Users list"
    >
      {/* Polite live region for action announcements. */}
      <output className="sr-only" aria-live="polite">
        {liveMsg}
      </output>

      {/* Desktop table — lg+ only. Cards render below for mobile + tablet. */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full">
          <thead className="bg-[var(--brand-background)]">
            <tr>
              <th
                scope="col"
                className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                {t('userManagement.field.name')}
              </th>
              <th
                scope="col"
                className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                {t('userManagement.field.email')}
              </th>
              {/* Role is shown for everyone now — a coordinator manages their
                  practice's patients, providers, and medical directors, so they
                  need to tell them apart. Practice column stays hidden for
                  coordinators (single, implicit practice). */}
              <th
                scope="col"
                className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                {t('userManagement.field.role')}
              </th>
              {!coordinatorView && (
                <th
                  scope="col"
                  className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  {t('userManagement.field.practice')}
                </th>
              )}
              <th
                scope="col"
                className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                {t('userManagement.field.status')}
              </th>
              <th
                scope="col"
                className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                {t('userManagement.field.invitedAt')}
              </th>
              <th
                scope="col"
                className="text-right px-5 py-3 text-[10px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                {t('userManagement.field.actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td
                  colSpan={coordinatorView ? 6 : 7}
                  className="px-5 py-8 text-center text-[12px]"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  <Loader2 className="w-4 h-4 inline-block animate-spin mr-2" />
                  {t('common.loading')}
                </td>
              </tr>
            )}

            {!loading && combined.length === 0 && (
              <tr>
                <td
                  colSpan={coordinatorView ? 6 : 7}
                  className="px-5 py-12 text-center text-[13px]"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  {coordinatorView
                    ? t('userManagement.list.emptyCoordinator')
                    : t('userManagement.list.empty')}
                </td>
              </tr>
            )}

            {!loading &&
              combined.map((row) => {
                const isPending = pendingRowId === row.id;
                const isSelf = caller?.id === row.id;
                // Coordinators manage people through invites (send / cancel on
                // pending rows), not by deactivating active users — so they get
                // no deactivate/reactivate ("delete") button on active rows.
                // canDeactivateUser already encodes the full matrix (incl.
                // COORDINATOR → own-practice patients), so no extra
                // coordinatorView gate — that was wrongly hiding the action for
                // coordinators on the desktop table (mobile already allowed it).
                const canAct =
                  !isSelf && canManage && canDeactivateUser(caller, row.targetRoles);
                const showDeactivate =
                  row.kind === 'user' && row.status === 'ACTIVE' && canAct;
                const showReactivate =
                  row.kind === 'user' && row.status === 'DEACTIVATED' && canAct;
                // Permanent close — irreversible tombstone, org-level authority
                // (SUPER_ADMIN + HEALPLACE_OPS only per ACCESS_SCOPE §8;
                // COORDINATOR walked back #114, MED_DIR never had it). Also
                // requires a row the caller can act on, a DisplayID for the
                // typed-confirmation gate, and an ACTIVE/DEACTIVATED status.
                // Never on CLOSED / invites.
                const showClose =
                  row.kind === 'user' &&
                  canAct &&
                  canPermanentCloseUsers(caller) &&
                  (row.status === 'ACTIVE' || row.status === 'DEACTIVATED') &&
                  !!(row.raw as UserRow).displayId &&
                  !!onCloseClick;
                // MFA reset — staff (non-patient) rows only, never self, and
                // only when the caller is authorized (SUPER_ADMIN / OPS).
                const isStaffTarget =
                  row.targetRoles.length > 0 &&
                  !row.targetRoles.every((r) => r === 'PATIENT');
                const showResetMfa =
                  row.kind === 'user' &&
                  !isSelf &&
                  isStaffTarget &&
                  row.mfaEnrolled &&
                  callerCanResetMfa &&
                  !!onResetMfaClick;
                // Biometric reset — patient rows with a registered passkey.
                const isPatientTarget =
                  row.targetRoles.length > 0 &&
                  row.targetRoles.every((r) => r === 'PATIENT');
                const showResetBiometric =
                  row.kind === 'user' &&
                  !isSelf &&
                  isPatientTarget &&
                  row.biometricEnrolled &&
                  callerCanResetMfa &&
                  !!onResetBiometricClick;
                return (
                  <tr
                    key={`${row.kind}-${row.id}`}
                    style={{ borderTop: '1px solid var(--brand-border)' }}
                    data-testid={`admin-users-row-${row.email}`}
                  >
                    <td className="px-5 py-3.5">
                      <span
                        className="text-[13px] font-semibold"
                        style={{ color: 'var(--brand-text-primary)' }}
                      >
                        {row.name}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-[12px]">
                      <span style={{ color: 'var(--brand-text-secondary)' }}>
                        {row.email}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      {row.role ? (
                        <RoleBadge role={row.role as UserRole} />
                      ) : (
                        '—'
                      )}
                    </td>
                    {!coordinatorView && (
                      <td className="px-5 py-3.5 text-[12px]">
                        {row.practiceId
                          ? practiceById.get(row.practiceId) ?? '—'
                          : '—'}
                      </td>
                    )}
                    <td className="px-5 py-3.5">
                      <StatusBadge status={row.status} />
                    </td>
                    <td
                      className="px-5 py-3.5 text-[12px]"
                      style={{ color: 'var(--brand-text-muted)' }}
                    >
                      {formatDate(row.invitedAt)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {(() => {
                        const items: MenuItem[] = [];
                        if (canManage && row.kind === 'invite') {
                          items.push({
                            key: 'resend',
                            label: t('userManagement.action.resend'),
                            icon: Send,
                            onClick: () => handleResend(row.id),
                          });
                          items.push({
                            key: 'revoke',
                            label: t('userManagement.action.revoke'),
                            icon: Trash2,
                            danger: true,
                            onClick: () => handleRevoke(row.id),
                          });
                        }
                        if (showDeactivate)
                          items.push({
                            key: 'deactivate',
                            label: t('userManagement.action.deactivate'),
                            icon: ShieldOff,
                            danger: true,
                            onClick: () =>
                              onDeactivateClick(
                                row.raw as UserRow | CoordinatorPatientRow,
                              ),
                          });
                        if (showReactivate)
                          items.push({
                            key: 'reactivate',
                            label: t('userManagement.action.reactivate'),
                            icon: Undo2,
                            onClick: () => handleReactivate(row.id),
                          });
                        if (showClose)
                          items.push({
                            key: 'close',
                            label: t('userManagement.action.closePermanently'),
                            icon: UserX,
                            danger: true,
                            onClick: () => onCloseClick?.(row.raw as UserRow),
                          });
                        if (showResetMfa)
                          items.push({
                            key: 'reset-mfa',
                            label: 'Reset MFA',
                            icon: KeyRound,
                            onClick: () =>
                              onResetMfaClick?.({ id: row.id, name: row.name }),
                          });
                        if (showResetBiometric)
                          items.push({
                            key: 'reset-biometric',
                            label: 'Reset biometric',
                            icon: KeyRound,
                            onClick: () =>
                              onResetBiometricClick?.({
                                id: row.id,
                                name: row.name,
                              }),
                          });
                        return (
                          <ActionsMenu
                            items={items}
                            pending={isPending}
                            testId={row.email ?? row.id}
                          />
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Mobile + tablet cards — hidden on lg+ where the table takes over. */}
      <div className="lg:hidden">
        {loading && (
          <div
            className="px-5 py-8 text-center text-[12px]"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            <Loader2 className="w-4 h-4 inline-block animate-spin mr-2" />
            {t('common.loading')}
          </div>
        )}

        {!loading && combined.length === 0 && (
          <div
            className="px-5 py-12 text-center text-[13px]"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            {coordinatorView
              ? t('userManagement.list.emptyCoordinator')
              : t('userManagement.list.empty')}
          </div>
        )}

        {!loading &&
          combined.map((row, idx) => {
            const isPending = pendingRowId === row.id;
            const isSelf = caller?.id === row.id;
            const canAct =
              !isSelf && canManage && canDeactivateUser(caller, row.targetRoles);
            const showDeactivate =
              row.kind === 'user' && row.status === 'ACTIVE' && canAct;
            const showReactivate =
              row.kind === 'user' && row.status === 'DEACTIVATED' && canAct;
            // Permanent close — org-level only (SUPER + OPS); see desktop block.
            const showClose =
              row.kind === 'user' &&
              canAct &&
              canPermanentCloseUsers(caller) &&
              (row.status === 'ACTIVE' || row.status === 'DEACTIVATED') &&
              !!(row.raw as UserRow).displayId &&
              !!onCloseClick;
            const isStaffTarget =
              row.targetRoles.length > 0 &&
              !row.targetRoles.every((r) => r === 'PATIENT');
            const showResetMfa =
              row.kind === 'user' &&
              !isSelf &&
              isStaffTarget &&
              row.mfaEnrolled &&
              callerCanResetMfa &&
              !!onResetMfaClick;
            const isPatientTarget =
              row.targetRoles.length > 0 &&
              row.targetRoles.every((r) => r === 'PATIENT');
            const showResetBiometric =
              row.kind === 'user' &&
              !isSelf &&
              isPatientTarget &&
              row.biometricEnrolled &&
              callerCanResetMfa &&
              !!onResetBiometricClick;

            // Build the card's action set once, so the kebab can live in the
            // top-right corner beside the status pill.
            const items: MenuItem[] = [];
            if (canManage && row.kind === 'invite') {
              items.push({
                key: 'resend',
                label: t('userManagement.action.resend'),
                icon: Send,
                onClick: () => handleResend(row.id),
              });
              items.push({
                key: 'revoke',
                label: t('userManagement.action.revoke'),
                icon: Trash2,
                danger: true,
                onClick: () => handleRevoke(row.id),
              });
            }
            if (showDeactivate)
              items.push({
                key: 'deactivate',
                label: t('userManagement.action.deactivate'),
                icon: ShieldOff,
                danger: true,
                onClick: () =>
                  onDeactivateClick(row.raw as UserRow | CoordinatorPatientRow),
              });
            if (showReactivate)
              items.push({
                key: 'reactivate',
                label: t('userManagement.action.reactivate'),
                icon: Undo2,
                onClick: () => handleReactivate(row.id),
              });
            if (showClose)
              items.push({
                key: 'close',
                label: t('userManagement.action.closePermanently'),
                icon: UserX,
                danger: true,
                onClick: () => onCloseClick?.(row.raw as UserRow),
              });
            if (showResetMfa)
              items.push({
                key: 'reset-mfa',
                label: 'Reset MFA',
                icon: KeyRound,
                onClick: () =>
                  onResetMfaClick?.({ id: row.id, name: row.name }),
              });
            if (showResetBiometric)
              items.push({
                key: 'reset-biometric',
                label: 'Reset biometric',
                icon: KeyRound,
                onClick: () =>
                  onResetBiometricClick?.({ id: row.id, name: row.name }),
              });

            return (
              <div
                key={`card-${row.kind}-${row.id}`}
                data-testid={`admin-users-card-${row.email}`}
                className="px-5 py-4 flex flex-col gap-3"
                style={{
                  borderTop:
                    idx > 0 ? '1px solid var(--brand-border)' : undefined,
                }}
              >
                {/* Top row: name/email + status pill */}
                <div className="flex items-start justify-between gap-3 min-w-0">
                  <div className="min-w-0">
                    <p
                      className="text-[13px] font-semibold truncate"
                      style={{ color: 'var(--brand-text-primary)' }}
                    >
                      {row.name}
                    </p>
                    <p
                      className="text-[12px] truncate"
                      style={{ color: 'var(--brand-text-secondary)' }}
                    >
                      {row.email}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-1">
                    <StatusBadge status={row.status} />
                    {items.length > 0 && (
                      <ActionsMenu
                        items={items}
                        pending={isPending}
                        testId={`${row.email ?? row.id}-card`}
                      />
                    )}
                  </div>
                </div>

                {/* Meta row: role · practice · invited. Role shows for
                    coordinators too; practice stays hidden for them. */}
                {(row.role || (!coordinatorView && row.practiceId) || row.invitedAt) && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
                    {row.role && (
                      <RoleBadge role={row.role as UserRole} />
                    )}
                    {!coordinatorView && row.practiceId && (
                      <span style={{ color: 'var(--brand-text-secondary)' }}>
                        {practiceById.get(row.practiceId) ?? '—'}
                      </span>
                    )}
                    {row.invitedAt && (
                      <span style={{ color: 'var(--brand-text-muted)' }}>
                        {formatDate(row.invitedAt)}
                      </span>
                    )}
                  </div>
                )}

              </div>
            );
          })}
      </div>

      {/* Pagination */}
      {total > 0 && (
        <nav
          className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap"
          style={{ borderTop: '1px solid var(--brand-border)' }}
          aria-label="Pagination"
        >
          <p
            className="text-[12px]"
            style={{ color: 'var(--brand-text-muted)' }}
            aria-live="polite"
          >
            {t('userManagement.list.pageOf')
              .replace('{page}', String(page))
              .replace('{total}', String(totalPages))}
          </p>
          <div className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1 || loading}
              aria-label={t('userManagement.list.previous')}
              className="h-9 px-3 inline-flex items-center gap-1 rounded-lg text-[12px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--brand-background)] cursor-pointer"
              style={{
                color: 'var(--brand-text-secondary)',
                border: '1px solid var(--brand-border)',
              }}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              {t('userManagement.list.previous')}
            </button>
            <button
              type="button"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages || loading}
              aria-label={t('userManagement.list.next')}
              className="h-9 px-3 inline-flex items-center gap-1 rounded-lg text-[12px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--brand-background)] cursor-pointer"
              style={{
                color: 'var(--brand-text-secondary)',
                border: '1px solid var(--brand-border)',
              }}
            >
              {t('userManagement.list.next')}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </nav>
      )}

    </section>
  );
}
