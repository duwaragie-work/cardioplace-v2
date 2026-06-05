'use client';

// Single-invite modal. Mirrors MedicationHoldModal chrome (white card,
// rounded-2xl, Esc closes, focus trap via tabIndex, focus returns to the
// invoker via the caller's React state). Role + practice fields are
// gated per the auth matrix (see lib/roleGates.ts).

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, UserPlus, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/lib/auth-context';
import {
  invitableRoles,
  inviteRequiresPractice,
  type UserRole,
} from '@/lib/roleGates';
import {
  inviteUser,
  EMAIL_REGEX,
  type UserInviteRow,
} from '@/lib/services/user-management.service';
import { roleLabel } from './badges';

export interface PracticeOption {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onInvited: (invite: UserInviteRow) => void;
  /** Available practices for the picker. Coordinator passes their own;
   *  OPS / SUPER pass the full set. */
  practices: PracticeOption[];
  /** Set when the caller is a COORDINATOR (role + practice both locked). */
  lockedRole?: UserRole;
  lockedPracticeId?: string;
}

interface FormState {
  name: string;
  email: string;
  role: UserRole | '';
  practiceId: string;
}

const INITIAL_FORM: FormState = {
  name: '',
  email: '',
  role: '',
  practiceId: '',
};

export default function InviteUserModal({
  open,
  onClose,
  onInvited,
  practices,
  lockedRole,
  lockedPracticeId,
}: Props) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState({
    name: false,
    email: false,
    role: false,
    practice: false,
  });
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const availableRoles = useMemo<UserRole[]>(() => {
    if (lockedRole) return [lockedRole];
    return invitableRoles(user);
  }, [user, lockedRole]);

  // Reset whenever the modal opens, with locked-field defaults pre-filled.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm({
      name: '',
      email: '',
      role: lockedRole ?? '',
      practiceId: lockedPracticeId ?? '',
    });
    setTouched({ name: false, email: false, role: false, practice: false });
    setSubmitting(false);
    setError(null);
    // Focus moves to the first focusable element on open.
    window.setTimeout(() => firstFieldRef.current?.focus(), 60);
  }, [open, lockedRole, lockedPracticeId]);

  // Esc to close (only when idle).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);

  const selectedRole = (form.role || lockedRole || '') as UserRole | '';
  const practiceRequired = selectedRole
    ? lockedPracticeId
      ? true
      : inviteRequiresPractice(user, selectedRole as UserRole)
    : false;

  const errors = {
    name: form.name.trim().length === 0 ? t('userManagement.error.nameRequired') : null,
    email:
      form.email.trim().length === 0
        ? t('userManagement.error.emailRequired')
        : !EMAIL_REGEX.test(form.email.trim())
          ? t('userManagement.error.emailInvalid')
          : null,
    role: !selectedRole ? t('userManagement.error.roleRequired') : null,
    practice:
      practiceRequired && !form.practiceId
        ? t('userManagement.error.practiceRequired')
        : null,
  };

  const canSubmit =
    !submitting &&
    !errors.name &&
    !errors.email &&
    !errors.role &&
    !errors.practice;

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!canSubmit || !selectedRole) {
      setTouched({ name: true, email: true, role: true, practice: true });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const invite = await inviteUser({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        role: selectedRole,
        practiceId: form.practiceId || lockedPracticeId || undefined,
      });
      onInvited(invite);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send invite.');
    } finally {
      setSubmitting(false);
    }
  }

  const title = lockedRole === 'PATIENT'
    ? t('userManagement.modal.invitePatientTitle')
    : t('userManagement.modal.inviteTitle');

  return (
    <AnimatePresence>
      {open && (
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
            style={{
              maxHeight: '92dvh',
              boxShadow: '0 8px 48px rgba(123,0,224,0.18)',
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-modal-title"
            data-testid="admin-invite-user-modal"
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
                  <UserPlus className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="invite-modal-title"
                    className="text-[14px] font-bold leading-tight"
                    style={{ color: 'var(--brand-text-primary)' }}
                  >
                    {title}
                  </h2>
                  <p
                    className="text-[11px] mt-0.5 leading-snug"
                    style={{ color: 'var(--brand-text-muted)' }}
                  >
                    {t('userManagement.modal.inviteDescription')}
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
              {/* Name */}
              <div>
                <label
                  htmlFor="invite-name"
                  className="block text-[12px] font-semibold mb-1.5"
                  style={{ color: 'var(--brand-text-secondary)' }}
                >
                  {t('userManagement.field.name')}
                </label>
                <input
                  id="invite-name"
                  ref={firstFieldRef}
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  onBlur={() => setTouched((tt) => ({ ...tt, name: true }))}
                  placeholder={t('userManagement.placeholder.name')}
                  aria-invalid={!!(touched.name && errors.name)}
                  aria-describedby={touched.name && errors.name ? 'invite-name-err' : undefined}
                  data-testid="admin-invite-name"
                  className="w-full h-9 px-3 rounded-lg text-[13px] outline-none"
                  style={{
                    border: `1.5px solid ${
                      touched.name && errors.name
                        ? 'var(--brand-alert-red)'
                        : 'var(--brand-border)'
                    }`,
                    color: 'var(--brand-text-primary)',
                  }}
                />
                {touched.name && errors.name && (
                  <p
                    id="invite-name-err"
                    className="mt-1 text-[11px] font-semibold"
                    style={{ color: 'var(--brand-alert-red)' }}
                  >
                    {errors.name}
                  </p>
                )}
              </div>

              {/* Email */}
              <div>
                <label
                  htmlFor="invite-email"
                  className="block text-[12px] font-semibold mb-1.5"
                  style={{ color: 'var(--brand-text-secondary)' }}
                >
                  {t('userManagement.field.email')}
                </label>
                <input
                  id="invite-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  onBlur={() => setTouched((tt) => ({ ...tt, email: true }))}
                  placeholder={t('userManagement.placeholder.email')}
                  autoComplete="email"
                  aria-invalid={!!(touched.email && errors.email)}
                  aria-describedby={touched.email && errors.email ? 'invite-email-err' : undefined}
                  data-testid="admin-invite-email"
                  className="w-full h-9 px-3 rounded-lg text-[13px] outline-none"
                  style={{
                    border: `1.5px solid ${
                      touched.email && errors.email
                        ? 'var(--brand-alert-red)'
                        : 'var(--brand-border)'
                    }`,
                    color: 'var(--brand-text-primary)',
                  }}
                />
                {touched.email && errors.email && (
                  <p
                    id="invite-email-err"
                    className="mt-1 text-[11px] font-semibold"
                    style={{ color: 'var(--brand-alert-red)' }}
                  >
                    {errors.email}
                  </p>
                )}
              </div>

              {/* Role */}
              <div>
                <label
                  htmlFor="invite-role"
                  className="block text-[12px] font-semibold mb-1.5"
                  style={{ color: 'var(--brand-text-secondary)' }}
                >
                  {t('userManagement.field.role')}
                </label>
                <select
                  id="invite-role"
                  value={form.role}
                  disabled={!!lockedRole}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, role: e.target.value as UserRole | '' }))
                  }
                  onBlur={() => setTouched((tt) => ({ ...tt, role: true }))}
                  aria-invalid={!!(touched.role && errors.role)}
                  aria-describedby={touched.role && errors.role ? 'invite-role-err' : undefined}
                  data-testid="admin-invite-role"
                  className="w-full h-9 px-3 rounded-lg text-[13px] outline-none bg-white cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
                  style={{
                    border: `1.5px solid ${
                      touched.role && errors.role
                        ? 'var(--brand-alert-red)'
                        : 'var(--brand-border)'
                    }`,
                    color: 'var(--brand-text-primary)',
                  }}
                >
                  <option value="">{t('userManagement.placeholder.role')}</option>
                  {availableRoles.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
                {touched.role && errors.role && (
                  <p
                    id="invite-role-err"
                    className="mt-1 text-[11px] font-semibold"
                    style={{ color: 'var(--brand-alert-red)' }}
                  >
                    {errors.role}
                  </p>
                )}
              </div>

              {/* Practice — only when required for the chosen role.
                  For COORDINATOR callers the practice is locked (auto-filled
                  to their PracticeCoordinator.practiceId) and disabled. */}
              {(practiceRequired || lockedPracticeId) && (
                <div>
                  <label
                    htmlFor="invite-practice"
                    className="block text-[12px] font-semibold mb-1.5"
                    style={{ color: 'var(--brand-text-secondary)' }}
                  >
                    {t('userManagement.field.practice')}
                  </label>
                  <select
                    id="invite-practice"
                    value={form.practiceId}
                    disabled={!!lockedPracticeId}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, practiceId: e.target.value }))
                    }
                    onBlur={() => setTouched((tt) => ({ ...tt, practice: true }))}
                    aria-invalid={!!(touched.practice && errors.practice)}
                    aria-describedby={
                      touched.practice && errors.practice
                        ? 'invite-practice-err'
                        : undefined
                    }
                    data-testid="admin-invite-practice"
                    className="w-full h-9 px-3 rounded-lg text-[13px] outline-none bg-white cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
                    style={{
                      border: `1.5px solid ${
                        touched.practice && errors.practice
                          ? 'var(--brand-alert-red)'
                          : 'var(--brand-border)'
                      }`,
                      color: 'var(--brand-text-primary)',
                    }}
                  >
                    <option value="">{t('userManagement.placeholder.practice')}</option>
                    {practices.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {touched.practice && errors.practice && (
                    <p
                      id="invite-practice-err"
                      className="mt-1 text-[11px] font-semibold"
                      style={{ color: 'var(--brand-alert-red)' }}
                    >
                      {errors.practice}
                    </p>
                  )}
                </div>
              )}

              {error && (
                <p
                  className="text-[12px] font-semibold text-center px-3 py-2 rounded-lg"
                  style={{
                    color: 'var(--brand-alert-red)',
                    backgroundColor: 'var(--brand-alert-red-light)',
                  }}
                  role="alert"
                >
                  {error}
                </p>
              )}
            </form>

            <div
              className="shrink-0 px-5 py-3 flex gap-3"
              style={{ borderTop: '1px solid var(--brand-border)' }}
            >
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="btn-admin-secondary flex-1"
              >
                {t('userManagement.modal.cancel')}
              </button>
              <button
                type="button"
                onClick={() => handleSubmit()}
                disabled={!canSubmit}
                data-testid="admin-invite-submit"
                className="btn-admin-primary flex-1"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('userManagement.modal.sending')}
                  </>
                ) : (
                  <>{t('userManagement.modal.send')}</>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
