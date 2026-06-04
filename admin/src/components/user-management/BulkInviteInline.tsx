'use client';

// Inline bulk-invite table. Shown inside the panel (NOT a modal) when the
// "+ Add multiple" toggle is on. Validates every row client-side then
// posts to /admin/users/invite/bulk. The backend implements
// validate-all-then-create-all: if any row fails, nothing is created and
// the response carries an `errors: [{ index, message }]` array. We map
// those back onto the rows and tint them red until the user fixes them.

import { useMemo, useState } from 'react';
import { Plus, X, Loader2, Send } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/lib/auth-context';
import {
  invitableRoles,
  inviteRequiresPractice,
  type UserRole,
} from '@/lib/roleGates';
import {
  bulkInviteUsers,
  EMAIL_REGEX,
  type BulkInviteRowError,
} from '@/lib/services/user-management.service';
import { roleLabel } from './badges';
import type { PracticeOption } from './InviteUserModal';

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: (count: number) => void;
  practices: PracticeOption[];
  lockedRole?: UserRole;
  lockedPracticeId?: string;
}

interface Row {
  /** Stable client-side identifier — used as the React key so adding /
   *  removing rows doesn't lose focus on adjacent inputs. */
  key: string;
  name: string;
  email: string;
  role: UserRole | '';
  practiceId: string;
}

let rowCounter = 0;
function nextKey() {
  rowCounter += 1;
  return `bulk-${rowCounter}`;
}

function freshRow(defaults: Partial<Row> = {}): Row {
  return {
    key: nextKey(),
    name: '',
    email: '',
    role: defaults.role ?? '',
    practiceId: defaults.practiceId ?? '',
  };
}

export default function BulkInviteInline({
  open,
  onClose,
  onDone,
  practices,
  lockedRole,
  lockedPracticeId,
}: Props) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>(() => [
    freshRow({ role: lockedRole, practiceId: lockedPracticeId }),
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<BulkInviteRowError[]>([]);

  const availableRoles = useMemo<UserRole[]>(() => {
    if (lockedRole) return [lockedRole];
    return invitableRoles(user);
  }, [user, lockedRole]);

  // Practice column is shown only when at least one row needs it. For
  // COORDINATOR (lockedRole=PATIENT) the practice is implicit — never
  // shown. For OPS / SUPER it appears when one of the picked roles
  // requires it.
  const practiceColumnVisible = useMemo(() => {
    if (lockedRole === 'PATIENT' && !lockedPracticeId) return false;
    if (lockedPracticeId) return false; // implicit
    return rows.some(
      (r) => r.role && inviteRequiresPractice(user, r.role as UserRole),
    );
  }, [rows, user, lockedRole, lockedPracticeId]);

  function patchRow(index: number, patch: Partial<Row>) {
    setRows((rs) =>
      rs.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
    // Wipe stale server-error for this row when the user edits it.
    setServerErrors((errs) => errs.filter((e) => e.index !== index));
  }

  function addRow() {
    setRows((rs) => [
      ...rs,
      freshRow({ role: lockedRole, practiceId: lockedPracticeId }),
    ]);
  }

  function removeRow(index: number) {
    setRows((rs) => (rs.length === 1 ? rs : rs.filter((_, i) => i !== index)));
    setServerErrors((errs) =>
      errs
        .filter((e) => e.index !== index)
        .map((e) => (e.index > index ? { ...e, index: e.index - 1 } : e)),
    );
  }

  function clientValidateRow(row: Row): string | null {
    if (row.name.trim().length === 0)
      return t('userManagement.error.nameRequired');
    if (row.email.trim().length === 0)
      return t('userManagement.error.emailRequired');
    if (!EMAIL_REGEX.test(row.email.trim()))
      return t('userManagement.error.emailInvalid');
    if (!row.role) return t('userManagement.error.roleRequired');
    if (
      !lockedPracticeId &&
      inviteRequiresPractice(user, row.role as UserRole) &&
      !row.practiceId
    ) {
      return t('userManagement.error.practiceRequired');
    }
    return null;
  }

  const clientErrors = rows.map(clientValidateRow);
  const hasClientErrors = clientErrors.some(Boolean);
  const canSubmit = !submitting && !hasClientErrors;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    setServerErrors([]);
    try {
      const result = await bulkInviteUsers(
        rows.map((r) => ({
          name: r.name.trim(),
          email: r.email.trim().toLowerCase(),
          role: r.role as UserRole,
          practiceId: r.practiceId || lockedPracticeId || undefined,
        })),
      );
      if (result.statusCode === 422 && result.errors?.length) {
        setServerErrors(result.errors);
        return;
      }
      const count = result.data?.length ?? rows.length;
      onDone(count);
      // Reset to a single fresh row.
      setRows([freshRow({ role: lockedRole, practiceId: lockedPracticeId })]);
    } catch (e) {
      setSubmitError(
        e instanceof Error ? e.message : 'Could not send bulk invites.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  function rowError(index: number): string | null {
    const serverErr = serverErrors.find((e) => e.index === index);
    if (serverErr) return serverErr.reason;
    return clientErrors[index];
  }

  if (!open) return null;

  return (
    <section
      className="bg-white rounded-2xl overflow-hidden"
      style={{ boxShadow: 'var(--brand-shadow-card)' }}
      aria-labelledby="bulk-invite-title"
      data-testid="admin-bulk-invite-panel"
    >
      <header
        className="px-5 py-3 flex items-center justify-between gap-3"
        style={{ borderBottom: '1px solid var(--brand-border)' }}
      >
        <div>
          <h2
            id="bulk-invite-title"
            className="text-[14px] font-bold"
            style={{ color: 'var(--brand-text-primary)' }}
          >
            {lockedRole === 'PATIENT'
              ? t('userManagement.bulk.titlePatients')
              : t('userManagement.bulk.title')}
          </h2>
          <p
            className="text-[11px] mt-0.5"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            {t('userManagement.bulk.atomicNotice')}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="btn-admin-ghost"
          aria-label={t('userManagement.bulk.collapse')}
        >
          <X className="w-3.5 h-3.5" />
          {t('userManagement.bulk.collapse')}
        </button>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-[var(--brand-background)]">
            <tr>
              <th
                scope="col"
                className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                {t('userManagement.field.name')}
              </th>
              <th
                scope="col"
                className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                {t('userManagement.field.email')}
              </th>
              {!lockedRole && (
                <th
                  scope="col"
                  className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  {t('userManagement.field.role')}
                </th>
              )}
              {practiceColumnVisible && (
                <th
                  scope="col"
                  className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  {t('userManagement.field.practice')}
                </th>
              )}
              <th scope="col" className="w-12 px-2 py-2">
                <span className="sr-only">{t('userManagement.bulk.removeRow')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const err = rowError(idx);
              const rowBorder = err
                ? 'var(--brand-alert-red)'
                : 'transparent';
              return (
                <tr
                  key={row.key}
                  style={{
                    borderTop: '1px solid var(--brand-border)',
                    boxShadow: err
                      ? `inset 3px 0 0 ${rowBorder}`
                      : undefined,
                  }}
                  data-testid={`admin-bulk-row-${idx}`}
                  aria-invalid={!!err}
                >
                  <td className="px-3 py-2 align-top">
                    <label className="sr-only" htmlFor={`bulk-name-${row.key}`}>
                      {t('userManagement.field.name')}
                    </label>
                    <input
                      id={`bulk-name-${row.key}`}
                      value={row.name}
                      onChange={(e) => patchRow(idx, { name: e.target.value })}
                      placeholder={t('userManagement.placeholder.name')}
                      className="w-full h-9 px-3 rounded-lg text-[13px] outline-none"
                      style={{
                        border: `1.5px solid ${
                          err ? 'var(--brand-alert-red)' : 'var(--brand-border)'
                        }`,
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <label className="sr-only" htmlFor={`bulk-email-${row.key}`}>
                      {t('userManagement.field.email')}
                    </label>
                    <input
                      id={`bulk-email-${row.key}`}
                      type="email"
                      value={row.email}
                      onChange={(e) => patchRow(idx, { email: e.target.value })}
                      placeholder={t('userManagement.placeholder.email')}
                      className="w-full h-9 px-3 rounded-lg text-[13px] outline-none"
                      style={{
                        border: `1.5px solid ${
                          err ? 'var(--brand-alert-red)' : 'var(--brand-border)'
                        }`,
                      }}
                    />
                  </td>
                  {!lockedRole && (
                    <td className="px-3 py-2 align-top">
                      <label className="sr-only" htmlFor={`bulk-role-${row.key}`}>
                        {t('userManagement.field.role')}
                      </label>
                      <select
                        id={`bulk-role-${row.key}`}
                        value={row.role}
                        onChange={(e) =>
                          patchRow(idx, {
                            role: e.target.value as UserRole | '',
                          })
                        }
                        className="w-full h-9 px-3 rounded-lg text-[13px] outline-none bg-white cursor-pointer"
                        style={{
                          border: `1.5px solid ${
                            err
                              ? 'var(--brand-alert-red)'
                              : 'var(--brand-border)'
                          }`,
                        }}
                      >
                        <option value="">
                          {t('userManagement.placeholder.role')}
                        </option>
                        {availableRoles.map((r) => (
                          <option key={r} value={r}>
                            {roleLabel(r)}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  {practiceColumnVisible && (
                    <td className="px-3 py-2 align-top">
                      <label
                        className="sr-only"
                        htmlFor={`bulk-practice-${row.key}`}
                      >
                        {t('userManagement.field.practice')}
                      </label>
                      <select
                        id={`bulk-practice-${row.key}`}
                        value={row.practiceId}
                        disabled={
                          !row.role ||
                          !inviteRequiresPractice(user, row.role as UserRole)
                        }
                        onChange={(e) =>
                          patchRow(idx, { practiceId: e.target.value })
                        }
                        className="w-full h-9 px-3 rounded-lg text-[13px] outline-none bg-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          border: `1.5px solid ${
                            err
                              ? 'var(--brand-alert-red)'
                              : 'var(--brand-border)'
                          }`,
                        }}
                      >
                        <option value="">
                          {t('userManagement.placeholder.practice')}
                        </option>
                        {practices.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td className="px-2 py-2 align-top text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      disabled={submitting || rows.length === 1}
                      aria-label={t('userManagement.bulk.removeRow')}
                      className="relative w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-[var(--brand-alert-red-light)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      style={{ color: 'var(--brand-alert-red)' }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Per-row server-error lines below the table so screen readers can
          announce them as a list. */}
      {(serverErrors.length > 0 || clientErrors.some(Boolean)) && (
        <div
          className="px-5 py-3"
          style={{
            backgroundColor: 'var(--brand-alert-red-light)',
            borderTop: '1px solid var(--brand-alert-red)',
          }}
          role="alert"
        >
          <ul className="space-y-1 text-[11px]">
            {rows.map((row, idx) => {
              const err = rowError(idx);
              if (!err) return null;
              return (
                <li
                  key={row.key}
                  style={{ color: 'var(--brand-alert-red)' }}
                  className="font-semibold"
                >
                  {`#${idx + 1} ${row.email || row.name || ''}: ${err}`}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {submitError && (
        <p
          className="px-5 py-3 text-[12px] font-semibold text-center"
          style={{
            color: 'var(--brand-alert-red)',
            backgroundColor: 'var(--brand-alert-red-light)',
          }}
          role="alert"
        >
          {submitError}
        </p>
      )}

      <footer
        className="px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        style={{ borderTop: '1px solid var(--brand-border)' }}
      >
        <button
          type="button"
          onClick={addRow}
          disabled={submitting}
          data-testid="admin-bulk-add-row"
          className="btn-admin-ghost"
        >
          <Plus className="w-3.5 h-3.5" />
          {t('userManagement.bulk.addRow')}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          data-testid="admin-bulk-send-all"
          className="btn-admin-primary"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('userManagement.bulk.sendingAll')}
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              {t('userManagement.bulk.sendAll')}
            </>
          )}
        </button>
      </footer>
    </section>
  );
}
