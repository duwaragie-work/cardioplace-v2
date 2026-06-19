'use client';

// Merged users + invites table with per-row actions. The backend returns
// `data: User[]` (or CoordinatorPatientRow[] for COORDINATOR callers) and
// `invites: UserInvite[]`. We splice them into a single rendered list
// where the invite rows carry the synthetic INVITE_PENDING status and
// "Resend / Revoke" actions instead of "Deactivate".

import { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Loader2,
  Send,
  ShieldOff,
  Trash2,
  Undo2,
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
  canResetUserMfa,
  type UserRole,
} from '@/lib/roleGates';
import { useAuth } from '@/lib/auth-context';
import type { PracticeOption } from './InviteUserModal';
import { RoleBadge, StatusBadge } from './badges';

interface Props {
  /** Whether the caller is a COORDINATOR (collapsed columns + status text). */
  coordinatorView: boolean;
  /** Backend payload from `listUsers`. */
  response: UserListResponse | null;
  loading: boolean;
  page: number;
  limit: number;
  practices: PracticeOption[];
  onPageChange: (next: number) => void;
  onDeactivateClick: (row: UserRow | CoordinatorPatientRow) => void;
  /** Open the MFA-reset modal for a staff row. Omitted when the caller can't
   *  reset MFA — the action then never renders. */
  onResetMfaClick?: (row: { id: string; name: string }) => void;
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
  status: 'ACTIVE' | 'BLOCKED' | 'SUSPENDED' | 'DEACTIVATED' | 'INVITE_PENDING';
  invitedAt: string | null;
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

export default function UsersList({
  coordinatorView,
  response,
  loading,
  page,
  limit,
  practices,
  onPageChange,
  onDeactivateClick,
  onResetMfaClick,
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
  async function handleReactivate(id: string) {
    await onReactivate(id);
    setLiveMsg(t('userManagement.toast.reactivated'));
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
              {!coordinatorView && (
                <>
                  <th
                    scope="col"
                    className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--brand-text-muted)' }}
                  >
                    {t('userManagement.field.role')}
                  </th>
                  <th
                    scope="col"
                    className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--brand-text-muted)' }}
                  >
                    {t('userManagement.field.practice')}
                  </th>
                </>
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
                  colSpan={coordinatorView ? 5 : 7}
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
                  colSpan={coordinatorView ? 5 : 7}
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
                const canAct =
                  !isSelf && canDeactivateUser(caller, row.targetRoles);
                const showDeactivate =
                  row.kind === 'user' && row.status === 'ACTIVE' && canAct;
                const showReactivate =
                  row.kind === 'user' && row.status === 'DEACTIVATED' && canAct;
                // MFA reset — staff (non-patient) rows only, never self, and
                // only when the caller is authorized (SUPER_ADMIN / OPS).
                const isStaffTarget =
                  row.targetRoles.length > 0 &&
                  !row.targetRoles.every((r) => r === 'PATIENT');
                const showResetMfa =
                  row.kind === 'user' &&
                  !isSelf &&
                  isStaffTarget &&
                  callerCanResetMfa &&
                  !!onResetMfaClick;
                const showUserDash =
                  row.kind === 'user' &&
                  !showDeactivate &&
                  !showReactivate &&
                  !showResetMfa;
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
                    {!coordinatorView && (
                      <>
                        <td className="px-5 py-3.5">
                          {row.role ? (
                            <RoleBadge role={row.role as UserRole} />
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-[12px]">
                          {row.practiceId
                            ? practiceById.get(row.practiceId) ?? '—'
                            : '—'}
                        </td>
                      </>
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
                      <div className="inline-flex items-center gap-1.5">
                        {row.kind === 'invite' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleResend(row.id)}
                              disabled={isPending}
                              aria-label={t('userManagement.action.resend')}
                              title={t('userManagement.action.resend')}
                              data-testid={`admin-user-resend-${row.email}`}
                              className="w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-[var(--brand-primary-purple-light)] cursor-pointer disabled:opacity-50"
                              style={{ color: 'var(--brand-primary-purple)' }}
                            >
                              {isPending ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Send className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRevoke(row.id)}
                              disabled={isPending}
                              aria-label={t('userManagement.action.revoke')}
                              title={t('userManagement.action.revoke')}
                              data-testid={`admin-user-revoke-${row.email}`}
                              className="w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-[var(--brand-alert-red-light)] cursor-pointer disabled:opacity-50"
                              style={{ color: 'var(--brand-alert-red)' }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        {showDeactivate && (
                          <button
                            type="button"
                            onClick={() =>
                              onDeactivateClick(
                                row.raw as UserRow | CoordinatorPatientRow,
                              )
                            }
                            disabled={isPending}
                            aria-label={t('userManagement.action.deactivate')}
                            data-testid={`admin-user-deactivate-${row.email}`}
                            className="shrink-0 whitespace-nowrap h-8 px-2 inline-flex items-center gap-1 rounded-lg text-[11px] font-semibold hover:bg-[var(--brand-alert-red-light)] cursor-pointer disabled:opacity-50"
                            style={{
                              color: 'var(--brand-alert-red)',
                              border: '1px solid var(--brand-alert-red)',
                            }}
                          >
                            <ShieldOff className="w-3 h-3" />
                            {t('userManagement.action.deactivate')}
                          </button>
                        )}
                        {showReactivate && (
                          <button
                            type="button"
                            onClick={() => handleReactivate(row.id)}
                            disabled={isPending}
                            aria-label={t('userManagement.action.reactivate')}
                            data-testid={`admin-user-reactivate-${row.email}`}
                            className="shrink-0 whitespace-nowrap h-8 px-2 inline-flex items-center gap-1 rounded-lg text-[11px] font-semibold hover:bg-[var(--brand-primary-purple-light)] cursor-pointer disabled:opacity-50"
                            style={{
                              color: 'var(--brand-primary-purple)',
                              border: '1px solid var(--brand-primary-purple)',
                            }}
                          >
                            {isPending ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <>
                                <Undo2 className="w-3 h-3" />
                                {t('userManagement.action.reactivate')}
                              </>
                            )}
                          </button>
                        )}
                        {showResetMfa && (
                          <button
                            type="button"
                            onClick={() =>
                              onResetMfaClick?.({ id: row.id, name: row.name })
                            }
                            disabled={isPending}
                            aria-label="Reset two-factor authentication"
                            title="Reset two-factor authentication"
                            data-testid={`admin-user-reset-mfa-${row.email}`}
                            className="shrink-0 whitespace-nowrap h-8 px-2 inline-flex items-center gap-1 rounded-lg text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                            style={{
                              color: 'var(--brand-warning-amber, #B45309)',
                              border:
                                '1px solid var(--brand-warning-amber, #B45309)',
                            }}
                          >
                            <KeyRound className="w-3 h-3" />
                            Reset MFA
                          </button>
                        )}
                        {showUserDash && (
                          <span
                            className="text-[11px]"
                            style={{ color: 'var(--brand-text-muted)' }}
                          >
                            —
                          </span>
                        )}
                      </div>
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
              !isSelf && canDeactivateUser(caller, row.targetRoles);
            const showDeactivate =
              row.kind === 'user' && row.status === 'ACTIVE' && canAct;
            const showReactivate =
              row.kind === 'user' && row.status === 'DEACTIVATED' && canAct;
            const isStaffTarget =
              row.targetRoles.length > 0 &&
              !row.targetRoles.every((r) => r === 'PATIENT');
            const showResetMfa =
              row.kind === 'user' &&
              !isSelf &&
              isStaffTarget &&
              callerCanResetMfa &&
              !!onResetMfaClick;
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
                  <div className="shrink-0">
                    <StatusBadge status={row.status} />
                  </div>
                </div>

                {/* Meta row: role · practice · invited */}
                {(!coordinatorView || row.invitedAt) && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
                    {!coordinatorView && row.role && (
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

                {/* Action row — only when there's an action available */}
                {(row.kind === 'invite' ||
                  showDeactivate ||
                  showReactivate ||
                  showResetMfa) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {row.kind === 'invite' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleResend(row.id)}
                          disabled={isPending}
                          data-testid={`admin-user-resend-card-${row.email}`}
                          className="shrink-0 whitespace-nowrap h-8 px-2 inline-flex items-center gap-1 rounded-lg text-[11px] font-semibold hover:bg-[var(--brand-primary-purple-light)] cursor-pointer disabled:opacity-50"
                          style={{
                            color: 'var(--brand-primary-purple)',
                            border: '1px solid var(--brand-primary-purple)',
                          }}
                        >
                          {isPending ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Send className="w-3 h-3" />
                          )}
                          {t('userManagement.action.resend')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRevoke(row.id)}
                          disabled={isPending}
                          data-testid={`admin-user-revoke-card-${row.email}`}
                          className="shrink-0 whitespace-nowrap h-8 px-2 inline-flex items-center gap-1 rounded-lg text-[11px] font-semibold hover:bg-[var(--brand-alert-red-light)] cursor-pointer disabled:opacity-50"
                          style={{
                            color: 'var(--brand-alert-red)',
                            border: '1px solid var(--brand-alert-red)',
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                          {t('userManagement.action.revoke')}
                        </button>
                      </>
                    )}
                    {showDeactivate && (
                      <button
                        type="button"
                        onClick={() =>
                          onDeactivateClick(
                            row.raw as UserRow | CoordinatorPatientRow,
                          )
                        }
                        disabled={isPending}
                        data-testid={`admin-user-deactivate-card-${row.email}`}
                        className="shrink-0 whitespace-nowrap h-8 px-2 inline-flex items-center gap-1 rounded-lg text-[11px] font-semibold hover:bg-[var(--brand-alert-red-light)] cursor-pointer disabled:opacity-50"
                        style={{
                          color: 'var(--brand-alert-red)',
                          border: '1px solid var(--brand-alert-red)',
                        }}
                      >
                        <ShieldOff className="w-3 h-3" />
                        {t('userManagement.action.deactivate')}
                      </button>
                    )}
                    {showReactivate && (
                      <button
                        type="button"
                        onClick={() => handleReactivate(row.id)}
                        disabled={isPending}
                        data-testid={`admin-user-reactivate-card-${row.email}`}
                        className="shrink-0 whitespace-nowrap h-8 px-2 inline-flex items-center gap-1 rounded-lg text-[11px] font-semibold hover:bg-[var(--brand-primary-purple-light)] cursor-pointer disabled:opacity-50"
                        style={{
                          color: 'var(--brand-primary-purple)',
                          border: '1px solid var(--brand-primary-purple)',
                        }}
                      >
                        {isPending ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Undo2 className="w-3 h-3" />
                        )}
                        {t('userManagement.action.reactivate')}
                      </button>
                    )}
                    {showResetMfa && (
                      <button
                        type="button"
                        onClick={() =>
                          onResetMfaClick?.({ id: row.id, name: row.name })
                        }
                        disabled={isPending}
                        data-testid={`admin-user-reset-mfa-card-${row.email}`}
                        className="shrink-0 whitespace-nowrap h-8 px-2 inline-flex items-center gap-1 rounded-lg text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                        style={{
                          color: 'var(--brand-warning-amber, #B45309)',
                          border:
                            '1px solid var(--brand-warning-amber, #B45309)',
                        }}
                      >
                        <KeyRound className="w-3 h-3" />
                        Reset MFA
                      </button>
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
