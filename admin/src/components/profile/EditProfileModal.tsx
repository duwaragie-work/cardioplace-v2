'use client';

// Edit-profile modal. Mirrors InviteUserModal chrome (bottom-sheet on
// mobile, centered card on desktop, Esc closes, focus moves to the first
// field on open). Edits only the display name — email + roles are identity
// (changed through user management) and the other ProfileDto fields aren't
// exposed here by product decision.

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, UserCog, Loader2 } from 'lucide-react';
import {
  updateMyProfile,
  type MyProfile,
} from '@/lib/services/profile.service';

interface Props {
  open: boolean;
  profile: MyProfile;
  onClose: () => void;
  /** Called after a successful save with the patched fields so the parent
   *  can update its view (and the auth context) without a refetch. */
  onSaved: (patch: { name: string }) => void;
}

export default function EditProfileModal({
  open,
  profile,
  onClose,
  onSaved,
}: Props) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameTouched, setNameTouched] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  // Seed the form from the current profile whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(profile.name ?? '');
    setNameTouched(false);
    setSubmitting(false);
    setError(null);
    window.setTimeout(() => firstFieldRef.current?.focus(), 60);
  }, [open, profile]);

  // Esc to close (only when idle).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);

  const nameError = name.trim().length === 0 ? 'Name is required' : null;
  const canSubmit = !submitting && !nameError;

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!canSubmit) {
      setNameTouched(true);
      return;
    }
    setSubmitting(true);
    setError(null);
    const trimmedName = name.trim();
    try {
      await updateMyProfile({ name: trimmedName });
      onSaved({ name: trimmedName });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile.');
    } finally {
      setSubmitting(false);
    }
  }

  const fieldStyle = (invalid: boolean) => ({
    border: `1.5px solid ${invalid ? 'var(--brand-alert-red)' : 'var(--brand-border)'}`,
    color: 'var(--brand-text-primary)',
  });

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
            className="relative w-full sm:max-w-md bg-white sm:rounded-3xl rounded-t-3xl flex flex-col overflow-hidden"
            style={{
              maxHeight: '92dvh',
              boxShadow: '0 8px 48px rgba(123,0,224,0.18)',
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-profile-title"
            data-testid="admin-edit-profile-modal"
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
                  <UserCog className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="edit-profile-title"
                    className="text-[14px] font-bold leading-tight"
                    style={{ color: 'var(--brand-text-primary)' }}
                  >
                    Edit profile
                  </h2>
                  <p
                    className="text-[11px] mt-0.5 leading-snug"
                    style={{ color: 'var(--brand-text-muted)' }}
                  >
                    Update your display name.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 cursor-pointer disabled:opacity-50"
                aria-label="Close"
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
                  htmlFor="profile-name"
                  className="block text-[12px] font-semibold mb-1.5"
                  style={{ color: 'var(--brand-text-secondary)' }}
                >
                  Full name
                </label>
                <input
                  id="profile-name"
                  ref={firstFieldRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setNameTouched(true)}
                  placeholder="e.g. Dr. Manisha Singal"
                  maxLength={100}
                  aria-invalid={!!(nameTouched && nameError)}
                  aria-describedby={nameTouched && nameError ? 'profile-name-err' : undefined}
                  data-testid="admin-edit-profile-name"
                  className="w-full h-9 px-3 rounded-lg text-[13px] outline-none"
                  style={fieldStyle(!!(nameTouched && nameError))}
                />
                {nameTouched && nameError && (
                  <p
                    id="profile-name-err"
                    className="mt-1 text-[11px] font-semibold"
                    style={{ color: 'var(--brand-alert-red)' }}
                  >
                    {nameError}
                  </p>
                )}
              </div>

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
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleSubmit()}
                disabled={!canSubmit}
                data-testid="admin-edit-profile-submit"
                className="btn-admin-primary flex-1"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>Save changes</>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
