'use client';

// Main user-management panel. Renders different headers + filter chrome
// based on the caller's role:
//
//   COORDINATOR      → Patients-only view. Role + practice locked. No
//                      role filter (everyone they see is a patient).
//                      Search + status chips. Practice header shown when
//                      we can resolve a name from the practice options.
//
//   HEALPLACE_OPS    → Full user list + role/status filters. Cannot
//                      invite PATIENT or SUPER_ADMIN — those filters
//                      are hidden too.
//
//   SUPER_ADMIN      → Full user list + all role filters incl. Patient.
//
// All three sub-features (single invite, inline bulk, CSV) live inside
// this panel and only one is visible at a time. The list refetches
// whenever filters / pagination change, or after any mutation.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, ChevronDown, Search, Users, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  invitableRoles,
  isCoordinatorOnly,
  type UserRole,
} from '@/lib/roleGates';
import {
  type AccountStatus,
  type CoordinatorPatientRow,
  deactivateUser,
  INVITE_PENDING,
  listUsers,
  reactivateUser,
  resendInvite,
  revokeInvite,
  type UserListResponse,
  type UserListStatus,
  type UserRow,
} from '@/lib/services/user-management.service';
import { listPractices, type Practice } from '@/lib/services/practice.service';
import { toast } from 'sonner';
import { resetUserMfa, resetPatientBiometric } from '@/lib/services/mfa.service';
import { canResetUserMfa } from '@/lib/roleGates';
import BulkInviteInline from './BulkInviteInline';
import CSVUploadCard from './CSVUploadCard';
import DeactivateConfirmModal from './DeactivateConfirmModal';
import InviteUserModal, { type PracticeOption } from './InviteUserModal';
import ResetMfaModal from './ResetMfaModal';
import UsersList from './UsersList';

const PAGE_LIMIT = 50;

interface PendingDeactivate {
  id: string;
  name: string;
}

interface PendingResetMfa {
  id: string;
  name: string;
}

interface PendingResetBiometric {
  id: string;
  name: string;
}

type AffordanceMode = 'none' | 'bulk' | 'csv';

export default function UserInvitePanel() {
  const { t } = useLanguage();
  const { user, isLoading } = useAuth();

  const coordinatorView = isCoordinatorOnly(user);
  const callerInvitable = useMemo(() => invitableRoles(user), [user]);

  // ─── Filters ─────────────────────────────────────────────────────────────
  const [roleFilter, setRoleFilter] = useState<'ALL' | UserRole>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | UserListStatus>(
    'ALL',
  );
  // Practice filter — OPS/SUPER only (coordinators are locked server-side
  // to their own practice). 'ALL' = no filter; any other value = practiceId.
  const [practiceFilter, setPracticeFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);

  // Debounce the search so the backend isn't hit on every keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  // ─── Server state ────────────────────────────────────────────────────────
  const [response, setResponse] = useState<UserListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);

  // Practice picker source. COORDINATOR is not authorized to list practices,
  // so we silently swallow the 403 — they don't need a picker anyway.
  const [practices, setPractices] = useState<PracticeOption[]>([]);
  useEffect(() => {
    if (isLoading || !user || coordinatorView) return;
    let cancelled = false;
    listPractices()
      .then((list: Practice[]) => {
        if (cancelled) return;
        setPractices(list.map((p) => ({ id: p.id, name: p.name })));
      })
      .catch(() => {
        if (!cancelled) setPractices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoading, user, coordinatorView]);

  const refresh = useCallback(async () => {
    if (isLoading || !user) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await listUsers({
        role: roleFilter === 'ALL' ? undefined : roleFilter,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        // Practice filter ignored for coordinators (backend force-scopes
        // them to their own practice anyway).
        practiceId:
          coordinatorView || practiceFilter === 'ALL'
            ? undefined
            : practiceFilter,
        search: debouncedSearch || undefined,
        page,
        limit: PAGE_LIMIT,
      });
      setResponse(res);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load users.');
      setResponse(null);
    } finally {
      setLoading(false);
    }
  }, [
    isLoading,
    user,
    roleFilter,
    statusFilter,
    practiceFilter,
    coordinatorView,
    debouncedSearch,
    page,
  ]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  // Reset to page 1 whenever a filter changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [roleFilter, statusFilter, practiceFilter, debouncedSearch]);

  // ─── Mutations / toasts ─────────────────────────────────────────────────
  function showToast(message: string, variant: 'success' | 'error' = 'success') {
    if (variant === 'error') toast.error(message);
    else toast.success(message);
  }

  // Three-way mode selector for the bulk/CSV affordances. Only one is
  // visible at a time so the panel doesn't bloat vertically.
  const [mode, setMode] = useState<AffordanceMode>('none');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [pendingDeactivate, setPendingDeactivate] =
    useState<PendingDeactivate | null>(null);
  const [pendingResetMfa, setPendingResetMfa] =
    useState<PendingResetMfa | null>(null);
  const [pendingResetBiometric, setPendingResetBiometric] =
    useState<PendingResetBiometric | null>(null);
  const callerCanResetMfa = canResetUserMfa(user);

  async function handleResend(inviteId: string) {
    setPendingRowId(inviteId);
    try {
      await resendInvite(inviteId);
      showToast(t('userManagement.toast.resent'));
      await refresh();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : 'Could not resend invite.',
        'error',
      );
    } finally {
      setPendingRowId(null);
    }
  }

  async function handleRevoke(inviteId: string) {
    setPendingRowId(inviteId);
    try {
      await revokeInvite(inviteId);
      // Optimistic update — drop the invite from the in-memory list right
      // away so the row disappears before the (cache-busted) refresh
      // round-trip completes.
      setResponse((prev) =>
        prev
          ? { ...prev, invites: prev.invites.filter((i) => i.id !== inviteId) }
          : prev,
      );
      showToast(t('userManagement.toast.revoked'));
      await refresh();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : 'Could not revoke invite.',
        'error',
      );
    } finally {
      setPendingRowId(null);
    }
  }

  async function handleReactivate(id: string) {
    setPendingRowId(id);
    try {
      await reactivateUser(id);
      showToast(t('userManagement.toast.reactivated'));
      await refresh();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : 'Could not reactivate user.',
        'error',
      );
    } finally {
      setPendingRowId(null);
    }
  }

  async function handleResetMfa(reason: string) {
    if (!pendingResetMfa) return;
    setPendingRowId(pendingResetMfa.id);
    try {
      const { message } = await resetUserMfa(pendingResetMfa.id, reason);
      showToast(message || 'MFA reset.');
      // Refetch so the now-unenrolled user loses the "Reset MFA" action.
      await refresh();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : 'Could not reset MFA.',
        'error',
      );
      throw e; // keep the modal open so the error shows
    } finally {
      setPendingRowId(null);
    }
  }

  async function handleResetBiometric(reason: string) {
    if (!pendingResetBiometric) return;
    setPendingRowId(pendingResetBiometric.id);
    try {
      const { message } = await resetPatientBiometric(
        pendingResetBiometric.id,
        reason,
      );
      showToast(message || 'Biometric reset.');
      await refresh();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : 'Could not reset biometric.',
        'error',
      );
      throw e; // keep the modal open so the error shows
    } finally {
      setPendingRowId(null);
    }
  }

  async function handleDeactivate(reason: string | undefined) {
    if (!pendingDeactivate) return;
    setPendingRowId(pendingDeactivate.id);
    try {
      await deactivateUser(pendingDeactivate.id, reason);
      showToast(t('userManagement.toast.deactivated'));
      await refresh();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : 'Could not deactivate user.',
        'error',
      );
      throw e; // re-throw so the modal stays open + shows the error
    } finally {
      setPendingRowId(null);
    }
  }

  // ─── Header copy ─────────────────────────────────────────────────────────
  const titleText = coordinatorView
    ? t('userManagement.headerPatients')
    : t('userManagement.headerAll');
  const subtitleText = coordinatorView
    ? t('userManagement.subtitleCoordinator')
    : t('userManagement.subtitle');

  // ─── Filter chip list ────────────────────────────────────────────────────
  const roleFilterOptions = useMemo<Array<{ value: 'ALL' | UserRole; label: string }>>(
    () => {
      if (coordinatorView) {
        return [];
      }
      const opts: Array<{ value: 'ALL' | UserRole; label: string }> = [
        { value: 'ALL', label: t('userManagement.filter.all') },
        { value: 'PROVIDER', label: t('userManagement.filter.provider') },
        {
          value: 'MEDICAL_DIRECTOR',
          label: t('userManagement.filter.medicalDirector'),
        },
        { value: 'HEALPLACE_OPS', label: t('userManagement.filter.ops') },
        {
          value: 'COORDINATOR',
          label: t('userManagement.filter.coordinator'),
        },
      ];
      // SUPER_ADMIN sees the PATIENT filter too (they can manage patients
      // cross-practice). OPS does NOT — they can't invite patients.
      if (callerInvitable.includes('PATIENT')) {
        opts.splice(1, 0, {
          value: 'PATIENT',
          label: t('userManagement.filter.patient'),
        });
      }
      if (callerInvitable.includes('SUPER_ADMIN')) {
        opts.push({
          value: 'SUPER_ADMIN',
          label: t('userManagement.filter.superAdmin'),
        });
      }
      return opts;
    },
    [coordinatorView, callerInvitable, t],
  );

  const statusFilterOptions: Array<{
    value: 'ALL' | UserListStatus;
    label: string;
  }> = useMemo(
    () => [
      { value: 'ALL', label: t('userManagement.filter.all') },
      {
        value: 'ACTIVE' as AccountStatus,
        label: t('userManagement.filter.statusActive'),
      },
      {
        value: INVITE_PENDING,
        label: t('userManagement.filter.statusPending'),
      },
      {
        value: 'DEACTIVATED' as AccountStatus,
        label: t('userManagement.filter.statusDeactivated'),
      },
    ],
    [t],
  );

  // Locked role/practice for COORDINATOR — backend resolves practiceId
  // server-side so we don't need to send one. Bulk + CSV components
  // still receive a `lockedRole='PATIENT'` so the role column collapses.
  const lockedRole = coordinatorView ? ('PATIENT' as UserRole) : undefined;
  // For COORDINATOR, the practiceId is implicit (server-side) — no
  // value passed; UI just doesn't surface the field.
  const lockedPracticeId = undefined;

  return (
    <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-6 space-y-5">
      {/* Header — title left, CTAs right on lg+; stacks below the title on
          smaller screens so the title + subtitle still get full width. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
            style={{
              background: 'linear-gradient(135deg, #7B00E0, #9333EA)',
            }}
            aria-hidden
          >
            <Users className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1
              className="text-xl font-bold truncate"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              {titleText}
            </h1>
            <p
              className="text-[12px] truncate"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              {subtitleText}
            </p>
            {/* Coordinator-only practice badge — the coordinator can't see
                the practice column on their patient list (it's stripped
                in the server response), so this is the only place they're
                told which practice they're managing. */}
            {coordinatorView && response?.scopePractice && (
              <div
                className="inline-flex items-center gap-1.5 mt-1.5 px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'var(--brand-primary-purple-light)',
                  color: 'var(--brand-primary-purple)',
                }}
                data-testid="admin-users-coordinator-practice"
                title={response.scopePractice.name}
              >
                <Building2 className="w-3 h-3 shrink-0" aria-hidden />
                <span className="text-[11px] font-semibold truncate max-w-[240px]">
                  {response.scopePractice.name}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Primary CTAs — under the title on small, right of title on lg+. */}
        <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap lg:shrink-0 lg:justify-end">
          <button
            type="button"
            data-testid="admin-users-invite-single"
            onClick={() => setInviteOpen(true)}
            className="btn-admin-primary"
          >
            {coordinatorView
              ? t('userManagement.invitePatientCta')
              : t('userManagement.inviteSingleCta')}
          </button>
          <button
            type="button"
            data-testid="admin-users-bulk-toggle"
            onClick={() => setMode((m) => (m === 'bulk' ? 'none' : 'bulk'))}
            aria-pressed={mode === 'bulk'}
            className="btn-admin-secondary"
          >
            {t('userManagement.addMultipleCta')}
          </button>
          <button
            type="button"
            data-testid="admin-users-csv-toggle"
            onClick={() => setMode((m) => (m === 'csv' ? 'none' : 'csv'))}
            aria-pressed={mode === 'csv'}
            className="btn-admin-secondary"
          >
            {t('userManagement.uploadCsvCta')}
          </button>
        </div>
      </div>

      {/* Filters */}
      {(() => {
        const hasActiveFilters =
          roleFilter !== 'ALL' ||
          statusFilter !== 'ALL' ||
          practiceFilter !== 'ALL' ||
          search.trim().length > 0;
        const clearAllFilters = () => {
          setRoleFilter('ALL');
          setStatusFilter('ALL');
          setPracticeFilter('ALL');
          setSearch('');
        };
        // Practice filter is only meaningful for OPS / SUPER — coordinator
        // is locked to their own practice server-side, so showing them a
        // picker would be misleading.
        const showPracticeFilter =
          !coordinatorView && practices.length > 0;

        return (
          <div
            className="bg-white rounded-2xl p-3 sm:p-4 space-y-3"
            style={{ boxShadow: 'var(--brand-shadow-card)' }}
          >
            {/* Row 1: Search + Clear all */}
            <div className="flex items-center gap-2">
              <div
                className="flex items-center gap-2 px-3 h-9 rounded-full flex-1 min-w-0 sm:max-w-md"
                style={{ border: '1.5px solid var(--brand-border)' }}
              >
                <Search
                  className="w-3.5 h-3.5 shrink-0"
                  style={{ color: 'var(--brand-text-muted)' }}
                  aria-hidden
                />
                <label className="sr-only" htmlFor="admin-users-search">
                  {t('userManagement.search.placeholder')}
                </label>
                <input
                  id="admin-users-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('userManagement.search.placeholder')}
                  data-testid="admin-users-search-input"
                  className="flex-1 text-[12px] outline-none bg-transparent min-w-0"
                  style={{ color: 'var(--brand-text-primary)' }}
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="shrink-0 inline-flex items-center justify-center cursor-pointer"
                    aria-label={t('common.close')}
                  >
                    <X
                      className="w-3 h-3"
                      style={{ color: 'var(--brand-text-muted)' }}
                    />
                  </button>
                )}
              </div>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  data-testid="admin-users-clear-filters"
                  className="shrink-0 inline-flex items-center gap-1 h-9 px-3 rounded-full text-[12px] font-semibold whitespace-nowrap transition-colors cursor-pointer hover:bg-gray-100"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  <X className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Clear filters</span>
                  <span className="sm:hidden">Clear</span>
                </button>
              )}
            </div>

            {/* Row 2 — same dropdown layout at every screen size. Each
                cell is `[label · select]`; they wrap on smaller widths and
                fit on one line at lg+. Practice select only renders for
                OPS / SUPER. */}
            <div className="flex flex-row flex-wrap items-center gap-x-3 gap-y-2">
              {!coordinatorView && (
                <FilterSelect
                  id="admin-users-role-select"
                  testId="admin-users-role-filter-select"
                  label={t('userManagement.field.role')}
                  value={roleFilter}
                  onChange={(v) => setRoleFilter(v as 'ALL' | UserRole)}
                  options={roleFilterOptions}
                  activePalette="primary"
                />
              )}

              <FilterSelect
                id="admin-users-status-select"
                testId="admin-users-status-filter-select"
                label={t('userManagement.field.status')}
                value={statusFilter}
                onChange={(v) =>
                  setStatusFilter(v as 'ALL' | UserListStatus)
                }
                options={statusFilterOptions}
                activePalette="primary-light"
              />

              {showPracticeFilter && (
                <FilterSelect
                  id="admin-users-practice-select"
                  testId="admin-users-practice-filter-select"
                  label={t('userManagement.field.practice')}
                  value={practiceFilter}
                  onChange={(v) => setPracticeFilter(v)}
                  options={[
                    { value: 'ALL', label: t('userManagement.filter.all') },
                    ...practices.map((p) => ({
                      value: p.id,
                      label: p.name,
                    })),
                  ]}
                  activePalette="primary-light"
                />
              )}
            </div>
          </div>
        );
      })()}

      {/* Bulk + CSV affordances. Only one is rendered at a time. */}
      <BulkInviteInline
        open={mode === 'bulk'}
        onClose={() => setMode('none')}
        onDone={(count) => {
          showToast(
            t('userManagement.toast.bulkSent').replace('{count}', String(count)),
          );
          setMode('none');
          refresh();
        }}
        practices={practices}
        lockedRole={lockedRole}
        lockedPracticeId={lockedPracticeId}
      />
      <CSVUploadCard
        open={mode === 'csv'}
        onClose={() => setMode('none')}
        onDone={(count) => {
          showToast(
            t('userManagement.toast.bulkSent').replace('{count}', String(count)),
          );
          setMode('none');
          refresh();
        }}
        practices={practices}
        lockedRole={lockedRole}
        lockedPracticeId={lockedPracticeId}
      />

      {loadError && (
        <p
          className="text-sm font-semibold px-3 py-2 rounded-lg"
          style={{
            color: 'var(--brand-alert-red)',
            backgroundColor: 'var(--brand-alert-red-light)',
          }}
          role="alert"
        >
          {loadError}
        </p>
      )}

      {/* Users + invites table */}
      <UsersList
        coordinatorView={coordinatorView}
        response={response}
        loading={loading}
        page={page}
        limit={PAGE_LIMIT}
        practices={practices}
        onPageChange={(n) => setPage(Math.max(1, n))}
        onDeactivateClick={(row) =>
          setPendingDeactivate({
            id: row.id,
            name: row.name ?? row.email ?? 'this user',
          })
        }
        onResetMfaClick={
          callerCanResetMfa
            ? (row) => setPendingResetMfa({ id: row.id, name: row.name })
            : undefined
        }
        onResetBiometricClick={
          callerCanResetMfa
            ? (row) => setPendingResetBiometric({ id: row.id, name: row.name })
            : undefined
        }
        onReactivate={handleReactivate}
        onResendInvite={handleResend}
        onRevokeInvite={handleRevoke}
        pendingRowId={pendingRowId}
      />

      {/* Modals */}
      <InviteUserModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={(invite) => {
          showToast(
            t('userManagement.toast.inviteSent').replace(
              '{email}',
              invite.email,
            ),
          );
          refresh();
        }}
        practices={practices}
        lockedRole={lockedRole}
        lockedPracticeId={lockedPracticeId}
      />
      <DeactivateConfirmModal
        open={!!pendingDeactivate}
        name={pendingDeactivate?.name ?? ''}
        onClose={() => setPendingDeactivate(null)}
        onConfirm={handleDeactivate}
      />
      <ResetMfaModal
        open={!!pendingResetMfa}
        name={pendingResetMfa?.name ?? ''}
        onClose={() => setPendingResetMfa(null)}
        onConfirm={handleResetMfa}
      />
      <ResetMfaModal
        open={!!pendingResetBiometric}
        name={pendingResetBiometric?.name ?? ''}
        title={`Reset biometric for ${pendingResetBiometric?.name ?? 'this patient'}?`}
        body="Their Face ID / fingerprint passkeys and recovery codes will be removed. They’ll set up biometric again on their next sign-in. This is recorded in the audit log."
        confirmLabel="Reset biometric"
        onClose={() => setPendingResetBiometric(null)}
        onConfirm={handleResetBiometric}
      />
    </div>
  );
}

// Re-export the row type so the panel's consumers can type their state.
export type { UserRow, CoordinatorPatientRow };

// ─── FilterSelect ─────────────────────────────────────────────────────────
// Inline label + native <select> with the panel's signature styling. Used
// by the Role / Status / Practice filters so they share one source of truth
// for sizing + active-state colors. `activePalette` switches between solid-
// purple (primary) and tinted-purple (primary-light) chrome to match the
// rest of the admin filter visual language.

type FilterSelectPalette = 'primary' | 'primary-light';

interface FilterSelectProps {
  id: string;
  testId: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  activePalette: FilterSelectPalette;
}

function FilterSelect({
  id,
  testId,
  label,
  value,
  onChange,
  options,
  activePalette,
}: FilterSelectProps) {
  const isActive = value !== 'ALL';
  const activeBg =
    activePalette === 'primary'
      ? 'var(--brand-primary-purple)'
      : 'var(--brand-primary-purple-light)';
  const activeText =
    activePalette === 'primary' ? 'white' : 'var(--brand-primary-purple)';

  // Layout:
  //   • Mobile (< sm): label stacks above the select so each cell is
  //     narrow enough that two fit per row inside the wrapping parent.
  //   • sm+: inline label-left, select grows to its content (max 200px),
  //     all cells sit on one line at lg+.
  return (
    <div className="flex flex-col gap-1 min-w-0 flex-1 basis-[140px] sm:basis-auto sm:flex-none sm:flex-row sm:items-center sm:gap-2">
      <label
        htmlFor={id}
        className="shrink-0 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--brand-text-muted)' }}
      >
        {label}
      </label>
      <div className="relative w-full sm:w-auto">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid={testId}
          className="appearance-none w-full sm:w-auto h-9 pl-3 pr-8 rounded-full text-[12px] font-semibold outline-none cursor-pointer sm:max-w-[200px]"
          style={{
            backgroundColor: isActive ? activeBg : 'white',
            color: isActive ? activeText : 'var(--brand-text-secondary)',
            border: `1.5px solid ${
              isActive
                ? 'var(--brand-primary-purple)'
                : 'var(--brand-border)'
            }`,
          }}
        >
          {options.map((opt) => (
            <option
              key={`${id}-opt-${opt.value}`}
              value={opt.value}
              style={{
                color: 'var(--brand-text-primary)',
                backgroundColor: 'white',
              }}
            >
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
          style={{
            color: isActive ? activeText : 'var(--brand-text-muted)',
          }}
        />
      </div>
    </div>
  );
}
