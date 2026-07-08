'use client';

// Reactivation = a DELIBERATE, scoped re-authorization (HIPAA §164.308(a)(4)),
// NOT a one-click auto-restore. The admin explicitly chooses the role(s) to
// grant, prefilled with the account's prior role, limited to what THIS admin may
// grant (assignableRoles) into a practice they're allowed to use. The backend
// re-checks every grant against the same matrix and 403s a stale/deep-linked
// attempt — this modal is UI narrowing, not the authority.
//
// Chrome mirrors InviteUserModal (white card, framer-motion, Esc-to-close).
// Admin app is English-only, so reactivation-specific copy is inline; standard
// labels reuse the existing t() keys.

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, RotateCcw, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/lib/auth-context';
import { assignableRoles, inviteRequiresPractice, type UserRole } from '@/lib/roleGates';
import {
  reactivateUser,
  type UserRow,
} from '@/lib/services/user-management.service';
import type { PracticeOption } from './InviteUserModal';
import { roleLabel } from './badges';

// Roles that own a practice-membership join row — reactivating INTO any of these
// always needs a practice (mirrors backend PRACTICE_BOUND_ROLES). Combined with
// inviteRequiresPractice this matches exactly when the backend demands one.
const PRACTICE_BOUND_ROLES: UserRole[] = ['PROVIDER', 'MEDICAL_DIRECTOR', 'COORDINATOR'];

interface Props {
  open: boolean;
  onClose: () => void;
  onReactivated: (user: UserRow) => void;
  /** The deactivated row being reactivated. Its retained `roles` + `practiceId`
   *  are the "prior role · practice" (deactivate strips neither). */
  target: UserRow | null;
  /** Practices the picker may offer (already scoped for the caller upstream). */
  practices: PracticeOption[];
  /** COORDINATOR caller — practice locked to their own. */
  lockedPracticeId?: string;
}

export default function ReactivateModal({
  open,
  onClose,
  onReactivated,
  target,
  practices,
  lockedPracticeId,
}: Props) {
  const { t } = useLanguage();
  const { user } = useAuth();

  // Prior role set from the retained roles. The "primary" prior role drives the
  // "same role" option label; a row with no staff/known role (older, pre-role
  // deactivations) has no prefill → straight to "assign a role".
  const priorRoles = useMemo<UserRole[]>(() => target?.roles ?? [], [target]);
  const hasPrior = priorRoles.length > 0;

  const grantable = useMemo<UserRole[]>(() => assignableRoles(user), [user]);

  const [mode, setMode] = useState<'same' | 'different'>('same');
  const [role, setRole] = useState<UserRole | ''>('');
  const [practiceId, setPracticeId] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(hasPrior ? 'same' : 'different');
    setRole('');
    setPracticeId(lockedPracticeId ?? target?.practiceId ?? '');
    setReason('');
    setSubmitting(false);
    setError(null);
    window.setTimeout(() => firstRef.current?.focus(), 60);
  }, [open, hasPrior, lockedPracticeId, target]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);

  // The roles that will actually be granted, and whether a practice is required.
  const effectiveRoles: UserRole[] =
    mode === 'same' ? priorRoles : role ? [role] : [];
  const needsPractice = effectiveRoles.some(
    (r) => PRACTICE_BOUND_ROLES.includes(r) || inviteRequiresPractice(user, r),
  );

  const priorPracticeName =
    practices.find((p) => p.id === target?.practiceId)?.name ?? null;

  const roleError = effectiveRoles.length === 0 ? 'Choose a role to grant.' : null;
  const practiceError =
    needsPractice && !practiceId ? t('userManagement.error.practiceRequired') : null;
  const canSubmit = !submitting && !roleError && !practiceError;

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!canSubmit || !target) return;
    setSubmitting(true);
    setError(null);
    try {
      // Always send the practice when it's locked (COORDINATOR caller — their
      // own practice is implicit but the backend still requires it for the
      // PATIENT grant), or when the chosen role needs one.
      const effectivePractice = lockedPracticeId || practiceId;
      const updated = await reactivateUser(target.id, {
        roles: effectiveRoles,
        practiceId:
          needsPractice || lockedPracticeId ? effectivePractice : undefined,
        reason: reason.trim() || undefined,
      });
      onReactivated(updated);
      onClose();
    } catch (err) {
      // 403 → the admin's scope changed / deep-linked attempt. Friendly copy,
      // mirroring the invite panel's error handling.
      const msg = err instanceof Error ? err.message : 'Could not reactivate user.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const priorLabel = hasPrior
    ? `Last role: ${priorRoles.map(roleLabel).join(', ')}${
        priorPracticeName ? ` · ${priorPracticeName}` : ''
      }`
    : 'No prior role on record — assign one.';

  return (
    <AnimatePresence>
      {open && target && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ backgroundColor: 'rgba(15,23,42,0.5)' }}
        >
          <div
            className="absolute inset-0"
            onClick={submitting ? undefined : onClose}
            style={{ cursor: submitting ? 'not-allowed' : 'pointer' }}
            aria-hidden
          />
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
            className="relative w-full sm:max-w-lg bg-white sm:rounded-3xl rounded-t-3xl flex flex-col overflow-hidden"
            style={{ maxHeight: '92dvh', boxShadow: '0 8px 48px rgba(123,0,224,0.18)' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reactivate-modal-title"
            data-testid="admin-reactivate-modal"
          >
            <div
              className="shrink-0 flex items-start justify-between gap-3 px-5 pt-4 pb-3"
              style={{ borderBottom: '1px solid var(--brand-border)' }}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <div
                  className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white"
                  style={{ backgroundColor: 'var(--brand-primary-purple)' }}
                  aria-hidden
                >
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="reactivate-modal-title"
                    className="text-[14px] font-bold leading-tight"
                    style={{ color: 'var(--brand-text-primary)' }}
                  >
                    {t('userManagement.action.reactivate')}
                    {target.name ? ` — ${target.name}` : ''}
                  </h2>
                  <p
                    className="text-[11px] mt-0.5 leading-snug"
                    style={{ color: 'var(--brand-text-muted)' }}
                    data-testid="admin-reactivate-prior"
                  >
                    {priorLabel}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 cursor-pointer disabled:opacity-50"
                aria-label={t('common.close')}
              >
                <X className="w-3.5 h-3.5" style={{ color: 'var(--brand-text-muted)' }} />
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              className="flex-1 overflow-y-auto thin-scrollbar p-5 space-y-4"
            >
              {/* Choice: same role vs assign a different one. */}
              <fieldset className="space-y-2">
                <legend
                  className="text-[12px] font-semibold mb-1"
                  style={{ color: 'var(--brand-text-secondary)' }}
                >
                  Role to grant on reactivation
                </legend>

                {hasPrior && (
                  <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                    <input
                      type="radio"
                      name="reactivate-mode"
                      checked={mode === 'same'}
                      onChange={() => setMode('same')}
                      data-testid="admin-reactivate-same"
                    />
                    <span style={{ color: 'var(--brand-text-primary)' }}>
                      Reactivate with the same role ({priorRoles.map(roleLabel).join(', ')})
                    </span>
                  </label>
                )}

                <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                  <input
                    type="radio"
                    name="reactivate-mode"
                    checked={mode === 'different'}
                    onChange={() => setMode('different')}
                    data-testid="admin-reactivate-different"
                  />
                  <span style={{ color: 'var(--brand-text-primary)' }}>
                    Assign a different role
                  </span>
                </label>
              </fieldset>

              {/* Role dropdown — only for the "different role" branch. */}
              {mode === 'different' && (
                <div>
                  <label
                    htmlFor="reactivate-role"
                    className="block text-[12px] font-semibold mb-1.5"
                    style={{ color: 'var(--brand-text-secondary)' }}
                  >
                    {t('userManagement.field.role')}
                  </label>
                  <select
                    id="reactivate-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole | '')}
                    data-testid="admin-reactivate-role"
                    className="w-full h-9 px-3 rounded-lg text-[13px] outline-none bg-white cursor-pointer"
                    style={{
                      border: '1.5px solid var(--brand-border)',
                      color: 'var(--brand-text-primary)',
                    }}
                  >
                    <option value="">{t('userManagement.placeholder.role')}</option>
                    {grantable.map((r) => (
                      <option key={r} value={r}>
                        {roleLabel(r)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Practice — when the granted role(s) require one. Locked for a
                  COORDINATOR caller (their own practice). */}
              {needsPractice && (
                <div>
                  <label
                    htmlFor="reactivate-practice"
                    className="block text-[12px] font-semibold mb-1.5"
                    style={{ color: 'var(--brand-text-secondary)' }}
                  >
                    {t('userManagement.field.practice')}
                  </label>
                  <select
                    id="reactivate-practice"
                    value={practiceId}
                    disabled={!!lockedPracticeId}
                    onChange={(e) => setPracticeId(e.target.value)}
                    data-testid="admin-reactivate-practice"
                    className="w-full h-9 px-3 rounded-lg text-[13px] outline-none bg-white cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
                    style={{
                      border: `1.5px solid ${
                        practiceError ? 'var(--brand-alert-red)' : 'var(--brand-border)'
                      }`,
                      color: 'var(--brand-text-primary)',
                    }}
                  >
                    <option value="">{t('userManagement.field.practice')}</option>
                    {practices.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {practiceError && (
                    <p
                      className="mt-1 text-[11px] font-semibold"
                      style={{ color: 'var(--brand-alert-red)' }}
                    >
                      {practiceError}
                    </p>
                  )}
                </div>
              )}

              {/* Reason — optional, recorded in the reactivation audit row. */}
              <div>
                <label
                  htmlFor="reactivate-reason"
                  className="block text-[12px] font-semibold mb-1.5"
                  style={{ color: 'var(--brand-text-secondary)' }}
                >
                  Reason (optional)
                </label>
                <input
                  id="reactivate-reason"
                  type="text"
                  value={reason}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                  data-testid="admin-reactivate-reason"
                  className="w-full h-9 px-3 rounded-lg text-[13px] outline-none"
                  style={{
                    border: '1.5px solid var(--brand-border)',
                    color: 'var(--brand-text-primary)',
                  }}
                />
              </div>

              {error && (
                <p
                  className="text-[12px] font-semibold"
                  style={{ color: 'var(--brand-alert-red)' }}
                  data-testid="admin-reactivate-error"
                  role="alert"
                >
                  {error}
                </p>
              )}
            </form>

            <div
              className="shrink-0 flex items-center justify-end gap-2 px-5 py-3"
              style={{ borderTop: '1px solid var(--brand-border)' }}
            >
              <button
                ref={firstRef}
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="h-9 px-4 rounded-lg text-[13px] font-semibold cursor-pointer disabled:opacity-50"
                style={{ color: 'var(--brand-text-secondary)' }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                data-testid="admin-reactivate-submit"
                className="h-9 px-4 rounded-lg text-[13px] font-bold text-white inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--brand-primary-purple)' }}
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {t('userManagement.action.reactivate')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
