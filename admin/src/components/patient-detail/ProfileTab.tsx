'use client';

// Flow H1 — Profile reconciliation tab.
//
// Layout: two columns side-by-side.
//   Left  — patient-reported (read-only snapshot of what the patient submitted)
//   Right — admin-editable column, default pre-filled from the left
//
// Per-field actions (right column):
//   ✅ Confirm  — value is correct, mark verified individually
//   ✏️ Correct  — open inline edit, then submit a correction
//   ❌ Reject   — explicitly mark as wrong (forces a correction step)
//
// Footer "Verification complete" button calls verify-profile and flips
// profileVerificationStatus → VERIFIED.

import { useMemo, useState } from 'react';
import {
  Check,
  Edit3,
  X as XIcon,
  ShieldCheck,
  Loader2,
  AlertTriangle,
  Info,
  History,
  CheckCheck,
} from 'lucide-react';
import {
  verifyPatientProfile,
  correctPatientProfile,
  rejectProfileField,
  confirmProfileField,
  confirmProfileFields,
  deriveFieldStatuses,
  fieldsChangedSinceVerification,
  type FieldVerificationStatus,
  type PatientProfile,
  type ProfileVerificationLog,
} from '@/lib/services/patient-detail.service';
import { useAuth } from '@/lib/auth-context';
import { canVerifyProfile } from '@/lib/roleGates';

interface Props {
  patientId: string;
  profile: PatientProfile | null;
  /** Verification logs (from the shell) — drives per-field confirmed/corrected/
   *  rejected/pending status (IVR-08) and the "changed since verification"
   *  banner (IVR-23). */
  logs: ProfileVerificationLog[];
  loading: boolean;
  onChanged: () => void;
}

type FieldType = 'boolean' | 'enum' | 'number' | 'date';

interface FieldDef {
  key: keyof PatientProfile;
  label: string;
  type: FieldType;
  options?: string[];
  unit?: string;
  group: 'demographics' | 'pregnancy' | 'cardiac';
}

const FIELDS: FieldDef[] = [
  // Demographics
  { key: 'gender', label: 'Sex', type: 'enum', options: ['MALE', 'FEMALE', 'OTHER'], group: 'demographics' },
  { key: 'heightCm', label: 'Height', type: 'number', unit: 'cm', group: 'demographics' },
  // Pregnancy
  { key: 'isPregnant', label: 'Currently pregnant', type: 'boolean', group: 'pregnancy' },
  { key: 'pregnancyDueDate', label: 'Pregnancy due date', type: 'date', group: 'pregnancy' },
  { key: 'historyPreeclampsia', label: 'History of preeclampsia', type: 'boolean', group: 'pregnancy' },
  // Cardiac
  { key: 'diagnosedHypertension', label: 'Diagnosed hypertension', type: 'boolean', group: 'cardiac' },
  { key: 'hasHeartFailure', label: 'Heart failure', type: 'boolean', group: 'cardiac' },
  { key: 'heartFailureType', label: 'Heart failure type', type: 'enum', options: ['HFREF', 'HFPEF', 'UNKNOWN', 'NOT_APPLICABLE'], group: 'cardiac' },
  { key: 'hasCAD', label: 'Coronary artery disease (CAD)', type: 'boolean', group: 'cardiac' },
  { key: 'hasAFib', label: 'Atrial fibrillation', type: 'boolean', group: 'cardiac' },
  { key: 'hasHCM', label: 'Hypertrophic cardiomyopathy (HCM)', type: 'boolean', group: 'cardiac' },
  { key: 'hasDCM', label: 'Dilated cardiomyopathy (DCM)', type: 'boolean', group: 'cardiac' },
  { key: 'hasTachycardia', label: 'Tachycardia', type: 'boolean', group: 'cardiac' },
  { key: 'hasBradycardia', label: 'Bradycardia', type: 'boolean', group: 'cardiac' },
];

const GROUP_LABEL: Record<FieldDef['group'], string> = {
  demographics: 'Demographics',
  pregnancy: 'Pregnancy',
  cardiac: 'Cardiac history',
};

function fmtValue(v: unknown, type: FieldType): string {
  if (v == null || v === '') return '—';
  if (type === 'boolean') return v ? 'Yes' : 'No';
  if (type === 'date') return new Date(String(v)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (type === 'enum') return String(v).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return String(v);
}

// Age from DOB (YYYY-MM-DD). Calendar-year accurate — accounts for whether
// the birthday has passed this year. Null on invalid/missing input.
function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const beforeBirthday =
    today.getMonth() < d.getMonth() ||
    (today.getMonth() === d.getMonth() && today.getDate() < d.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
}

// True when a "correction" wouldn't actually change the stored value — the
// admin opened the editor and saved the same value (or didn't change it).
// Dates compare by calendar day; everything else by value (null/undefined alike).
function isNoopCorrection(field: FieldDef, value: unknown, current: unknown): boolean {
  if (field.type === 'date') {
    const a = value ? String(value).slice(0, 10) : '';
    const b = current ? String(current).slice(0, 10) : '';
    return a === b;
  }
  return (value ?? null) === (current ?? null);
}

// Map raw backend / class-validator messages to plain language for the admin.
// e.g. "corrections.heightCm must be an integer number" → "Height must be a
// whole number." Range bounds are pulled from the validator text when present.
function friendlyCorrectionError(raw: string, field: FieldDef): string {
  const r = raw.toLowerCase();
  if (r.includes('no corrections')) {
    return `No change to ${field.label}. Use the ✓ Confirm button to mark it reviewed.`;
  }
  if (field.type === 'number') {
    const max = raw.match(/greater than (\d+)/)?.[1];
    const min = raw.match(/less than (\d+)/)?.[1];
    const unit = field.unit ? ` ${field.unit}` : '';
    if (min && max) {
      return `${field.label} must be a whole number between ${min} and ${max}${unit}.`;
    }
    if (r.includes('integer') || r.includes('number')) {
      return `${field.label} must be a whole number${unit}.`;
    }
  }
  return `Couldn't save ${field.label}. Please check the value and try again.`;
}

// Display status for a row's right cell. The verified/confirmed/corrected/
// rejected/pending states are DERIVED from the verification logs (IVR-08);
// `editing` is the only purely-local UI state (inline edit open).
type FieldStatus = FieldVerificationStatus | 'editing';

export default function ProfileTab({ patientId, profile, logs, loading, onChanged }: Props) {
  const { user } = useAuth();
  // Verify / correct / reject + "Verification complete" only for the
  // clinical roles (SUPER_ADMIN, PROVIDER, MEDICAL_DIRECTOR). HEALPLACE_OPS
  // sees the same data but no action buttons.
  const canVerify = canVerifyProfile(user);
  // Local UI state. `edits` holds in-flight inline-edit values; `editingFields`
  // tracks which rows are open for edit. The confirmed/corrected/rejected
  // status itself is derived from `logs`, not held locally — an action calls
  // the backend then onChanged() reloads the logs so the badge reflects truth.
  const [edits, setEdits] = useState<Partial<Record<keyof PatientProfile, unknown>>>({});
  const [editingFields, setEditingFields] = useState<Set<string>>(new Set());
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<keyof PatientProfile | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [showCompleteRationale, setShowCompleteRationale] = useState(false);
  const [completeRationale, setCompleteRationale] = useState('');
  // Per-field inline note (friendly): 'info' for a no-op "correction" (value
  // unchanged → use Confirm), 'error' for a mapped validation failure. Keyed by
  // field so it shows right under the row the admin acted on.
  const [fieldNotes, setFieldNotes] = useState<
    Partial<Record<keyof PatientProfile, { text: string; tone: 'info' | 'error' }>>
  >({});

  // IVR-08 — per-field status from the latest log at profile.{field}.
  const fieldStatuses = useMemo(() => deriveFieldStatuses(logs), [logs]);
  // IVR-23 — fields the patient changed since the last admin review.
  const changedSinceVerification = useMemo(
    () => fieldsChangedSinceVerification(logs),
    [logs],
  );

  const grouped = useMemo(() => {
    const m: Record<FieldDef['group'], FieldDef[]> = { demographics: [], pregnancy: [], cardiac: [] };
    for (const f of FIELDS) m[f.group].push(f);
    return m;
  }, []);

  const fieldLabel = useMemo(() => {
    const m: Record<string, string> = {};
    for (const f of FIELDS) m[f.key as string] = f.label;
    return m;
  }, []);

  // IVR-25 — keys eligible for "Confirm all": pending (no admin action yet),
  // not mid-edit, and visible (pregnancy rows hidden for non-FEMALE patients).
  const pendingFieldKeys = useMemo(
    () =>
      FIELDS.filter((f) => {
        if (f.group === 'pregnancy' && profile?.gender !== 'FEMALE') return false;
        if (editingFields.has(f.key as string)) return false;
        return (fieldStatuses.get(f.key as string) ?? 'pending') === 'pending';
      }).map((f) => f.key),
    [fieldStatuses, editingFields, profile],
  );

  // Reject hard-gate — visible fields whose latest log is ADMIN_REJECT. A
  // rejected field is an open "needs correction" item, so "Verification
  // complete" must stay blocked until each is resolved (corrected, re-confirmed,
  // or re-reported by the patient). Mirrors the backend guard in verifyProfile.
  const rejectedFieldKeys = useMemo(
    () =>
      FIELDS.filter((f) => {
        if (f.group === 'pregnancy' && profile?.gender !== 'FEMALE') return false;
        return (fieldStatuses.get(f.key as string) ?? 'pending') === 'rejected';
      }).map((f) => f.key),
    [fieldStatuses, profile],
  );
  const hasRejectedFields = rejectedFieldKeys.length > 0;

  if (loading) {
    return (
      <div className="bg-white rounded-2xl p-6 animate-pulse" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
        <div className="h-4 w-48 rounded-full mb-4" style={{ backgroundColor: '#EDE9F6' }} />
        <div className="space-y-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="grid grid-cols-2 gap-4">
              <div className="h-10 rounded-lg" style={{ backgroundColor: '#F3EEFB' }} />
              <div className="h-10 rounded-lg" style={{ backgroundColor: '#F3EEFB' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
        <AlertTriangle className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--brand-warning-amber-text)' }} />
        <p className="text-[14px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
          No profile submitted yet
        </p>
        <p className="text-[12px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
          The patient hasn&apos;t completed their intake. Verification is unavailable until they do.
        </p>
      </div>
    );
  }

  const isFullyVerified = profile.profileVerificationStatus === 'VERIFIED';

  // Effective display status: an open inline edit wins; otherwise the
  // log-derived status (defaulting to 'pending').
  function statusOf(key: keyof PatientProfile): FieldStatus {
    if (editingFields.has(key as string)) return 'editing';
    return fieldStatuses.get(key as string) ?? 'pending';
  }
  function setFieldNote(
    key: keyof PatientProfile,
    text: string,
    tone: 'info' | 'error',
  ) {
    setFieldNotes((prev) => ({ ...prev, [key]: { text, tone } }));
  }
  function clearFieldNote(key: keyof PatientProfile) {
    setFieldNotes((prev) => {
      const { [key]: _drop, ...rest } = prev;
      void _drop;
      return rest;
    });
  }
  function startEditing(key: keyof PatientProfile) {
    clearFieldNote(key); // a fresh edit clears any prior note on this row
    setEditingFields((prev) => new Set(prev).add(key as string));
  }
  function stopEditing(key: keyof PatientProfile) {
    setEditingFields((prev) => {
      const next = new Set(prev);
      next.delete(key as string);
      return next;
    });
  }
  function setEdit(key: keyof PatientProfile, value: unknown) {
    setEdits((prev) => ({ ...prev, [key]: value }));
  }

  // ✅ Confirm a single field (IVR-08) — writes an ADMIN_VERIFY log; the badge
  // updates once onChanged() reloads the logs.
  async function confirmField(field: FieldDef) {
    if (!profile) return;
    setSavingField(field.key);
    setCompleteError(null);
    clearFieldNote(field.key);
    try {
      await confirmProfileField(patientId, field.key, `Admin confirmed: ${field.label}`);
      onChanged();
    } catch (e) {
      setCompleteError(e instanceof Error ? e.message : 'Could not confirm field.');
    } finally {
      setSavingField(null);
    }
  }

  // ✅ Confirm all currently-pending fields (IVR-25).
  async function confirmAllPending() {
    if (!profile || !pendingFieldKeys.length) return;
    setConfirmingAll(true);
    setCompleteError(null);
    try {
      await confirmProfileFields(patientId, pendingFieldKeys, 'Admin confirmed all pending fields');
      onChanged();
    } catch (e) {
      setCompleteError(e instanceof Error ? e.message : 'Could not confirm fields.');
    } finally {
      setConfirmingAll(false);
    }
  }

  async function saveCorrection(field: FieldDef) {
    if (!profile) return;
    const value = edits[field.key] ?? profile[field.key];

    // No-op guard: "correcting" a field to the value it already holds is not a
    // change. The backend rejects it ("No corrections supplied"), which read as
    // a confusing error to the admin. Catch it here and nudge them toward the
    // ✓ Confirm button instead — Correct is for changing a value, Confirm is
    // for affirming an unchanged one.
    if (isNoopCorrection(field, value, profile[field.key])) {
      // Only point at ✓ Confirm when it's actually on screen — it's hidden once
      // the whole profile is verified, so there'd be nothing to click.
      setFieldNote(
        field.key,
        isFullyVerified
          ? `No change to ${field.label}.`
          : `No change to ${field.label}. Use the ✓ Confirm button to mark it reviewed.`,
        'info',
      );
      stopEditing(field.key);
      setEdits((prev) => {
        const { [field.key]: _drop, ...rest } = prev;
        void _drop;
        return rest;
      });
      return;
    }

    setSavingField(field.key);
    try {
      // Send ONLY the edited field. correctProfile diffs against the stored
      // profile and logs/updates just what changed, so a partial is correct —
      // and crucially it avoids re-submitting unrelated fields. Previously this
      // shallow-merged the whole profile snapshot, which re-sent dateOfBirth
      // every time and tripped a UTC round-trip off-by-one that silently
      // shifted the DOB on unrelated corrections.
      const corrections: Partial<PatientProfile> = {
        [field.key]: value as never,
      };
      await correctPatientProfile(
        patientId,
        corrections,
        `Admin correction: ${field.label}`,
      );
      stopEditing(field.key);
      setEdits((prev) => {
        const { [field.key]: _drop, ...rest } = prev;
        void _drop;
        return rest;
      });
      clearFieldNote(field.key);
      onChanged();
    } catch (e) {
      // Map the raw backend / class-validator text to plain language inline on
      // the row, instead of surfacing "corrections.heightCm must be an integer
      // number" near the footer.
      setFieldNote(
        field.key,
        friendlyCorrectionError(e instanceof Error ? e.message : '', field),
        'error',
      );
    } finally {
      setSavingField(null);
    }
  }

  /**
   * Reject a single field. Hits the backend so:
   *   • An ADMIN_REJECT audit row is written for the field.
   *   • profileVerificationStatus flips back to UNVERIFIED.
   *   • The whole profile lights up the "awaiting verification" banner again.
   * IVR-16: the button is disabled once a field is already rejected, so a
   * second call (and its duplicate audit row) can't be triggered from the UI.
   */
  async function rejectField(field: FieldDef) {
    if (!profile) return;
    setSavingField(field.key);
    clearFieldNote(field.key);
    try {
      await rejectProfileField(
        patientId,
        field.key,
        `Field rejected by admin: ${field.label}`,
      );
      onChanged();
    } catch (e) {
      setCompleteError(e instanceof Error ? e.message : 'Could not reject field.');
    } finally {
      setSavingField(null);
    }
  }

  async function completeVerification() {
    if (!profile) return;
    if (hasRejectedFields) {
      setCompleteError(
        `Resolve rejected field${rejectedFieldKeys.length === 1 ? '' : 's'} first: ${rejectedFieldKeys
          .map((k) => fieldLabel[k as string] ?? k)
          .join(', ')}.`,
      );
      return;
    }
    setCompleting(true);
    setCompleteError(null);
    try {
      await verifyPatientProfile(patientId, completeRationale.trim() || undefined);
      onChanged();
      setShowCompleteRationale(false);
      setCompleteRationale('');
    } catch (e) {
      setCompleteError(e instanceof Error ? e.message : 'Could not complete verification.');
    } finally {
      setCompleting(false);
    }
  }

  function renderRightCell(field: FieldDef) {
    const status: FieldStatus = statusOf(field.key);
    const fromPatient = profile?.[field.key];
    const editing = status === 'editing';
    const confirmed = status === 'confirmed';
    const corrected = status === 'corrected';
    const rejected = status === 'rejected';
    const editValue = edits[field.key] ?? fromPatient;
    const saving = savingField === field.key;
    const note = fieldNotes[field.key];
    // Rendered in BOTH the editing and display blocks: a validation error keeps
    // the editor open (so the value can be fixed), while a no-op note shows on
    // the closed row. Same testid either way — only one block renders at a time.
    const noteEl = note ? (
      <p
        data-testid={`admin-profile-field-note-${field.key}`}
        className="text-[11px] leading-snug"
        style={{
          color:
            note.tone === 'error'
              ? 'var(--brand-alert-red-text)'
              : 'var(--brand-warning-amber-text)',
        }}
      >
        {note.text}
      </p>
    ) : null;

    if (editing) {
      return (
        <div className="flex flex-col gap-2">
          {renderEditor(field, editValue, (v) => setEdit(field.key, v))}
          <div className="flex gap-1.5">
            <button
              type="button"
              data-testid={`admin-profile-edit-save-${field.key}`}
              onClick={() => saveCorrection(field)}
              disabled={saving}
              className="h-7 px-2.5 rounded-lg text-[11px] font-semibold text-white transition-all hover:brightness-95 cursor-pointer inline-flex items-center gap-1 disabled:opacity-60"
              style={{ backgroundColor: 'var(--brand-primary-purple)' }}
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                stopEditing(field.key);
                setEdits((prev) => {
                  const { [field.key]: _drop, ...rest } = prev;
                  void _drop;
                  return rest;
                });
              }}
              disabled={saving}
              className="h-7 px-2.5 rounded-lg text-[11px] font-semibold cursor-pointer transition-all hover:bg-gray-50"
              style={{ border: '1px solid var(--brand-border)', color: 'var(--brand-text-secondary)' }}
            >
              Cancel
            </button>
          </div>
          {noteEl}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
        <span
          className="text-[12.5px] truncate"
          data-testid={`admin-profile-field-${field.key}`}
          // A rejected field is an open item even on an otherwise-verified
          // profile — its status must win over the whole-profile "verified"
          // flag so the badge never contradicts the highlighted Reject button.
          data-status={rejected ? 'rejected' : isFullyVerified ? 'verified' : status}
          style={{
            color: rejected
              ? 'var(--brand-alert-red)'
              : isFullyVerified || confirmed || corrected
                ? 'var(--brand-success-green)'
                : 'var(--brand-text-primary)',
            fontWeight: isFullyVerified || status !== 'pending' ? 600 : 500,
          }}
        >
          {fmtValue(fromPatient, field.type)}
          {rejected ? (
            <span className="ml-1.5 text-[10px] uppercase tracking-wider">Rejected — needs correction</span>
          ) : isFullyVerified ? (
            <span className="ml-1.5 text-[10px] uppercase tracking-wider inline-flex items-center gap-0.5">
              <Check className="w-2.5 h-2.5" />
              Verified
            </span>
          ) : confirmed ? (
            <span className="ml-1.5 text-[10px] uppercase tracking-wider">Confirmed</span>
          ) : corrected ? (
            <span className="ml-1.5 text-[10px] uppercase tracking-wider">Corrected</span>
          ) : null}
        </span>
        {/* Edit + Reject are always available so a clinician can revisit
            a previously-verified profile. Confirm is only meaningful
            before the profile is locked in, so we hide it once
            isFullyVerified. Whole row hidden for HEALPLACE_OPS — they
            can read but not write per spec. */}
        {canVerify && (
          <div className="flex gap-1 shrink-0">
            {/* Confirm shows while unverified, and also on a rejected row of an
                otherwise-verified profile so a legacy reject can be cleared
                without forcing an Edit. Hidden on a clean verified row. */}
            {(!isFullyVerified || rejected) && (
              <button
                type="button"
                // IVR-08: disabled once confirmed so a repeat click can't write
                // a duplicate ADMIN_VERIFY audit row.
                title={confirmed ? 'Already confirmed' : 'Confirm'}
                data-testid={`admin-profile-confirm-${field.key}`}
                onClick={() => confirmField(field)}
                disabled={saving || confirmed}
                className="w-6 h-6 rounded-md flex items-center justify-center transition-all hover:bg-green-50 cursor-pointer disabled:cursor-default"
                style={{
                  border: `1px solid ${confirmed ? 'var(--brand-success-green)' : 'var(--brand-border)'}`,
                  backgroundColor: confirmed ? 'var(--brand-success-green-light)' : 'white',
                  color: 'var(--brand-success-green)',
                  opacity: confirmed ? 0.85 : 1,
                }}
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              </button>
            )}
            <button
              type="button"
              title={isFullyVerified ? 'Edit (re-opens verification)' : 'Correct'}
              data-testid={`admin-profile-correct-${field.key}`}
              onClick={() => startEditing(field.key)}
              disabled={saving}
              className="w-6 h-6 rounded-md flex items-center justify-center transition-all hover:bg-purple-50 cursor-pointer disabled:opacity-60"
              style={{
                border: '1px solid var(--brand-border)',
                backgroundColor: 'white',
                color: 'var(--brand-primary-purple)',
              }}
            >
              <Edit3 className="w-3 h-3" />
            </button>
            <button
              type="button"
              // IVR-16: disabled once already rejected so a second click can't
              // write a duplicate ADMIN_REJECT audit row.
              title={
                rejected
                  ? 'Already rejected'
                  : isFullyVerified
                    ? 'Reject (returns profile to unverified)'
                    : 'Reject'
              }
              data-testid={`admin-profile-reject-${field.key}`}
              onClick={() => rejectField(field)}
              disabled={saving || rejected}
              className="w-6 h-6 rounded-md flex items-center justify-center transition-all hover:bg-[var(--brand-alert-red-light)] cursor-pointer disabled:cursor-default"
              style={{
                border: `1px solid ${rejected ? 'var(--brand-alert-red)' : 'var(--brand-border)'}`,
                backgroundColor: rejected ? 'var(--brand-alert-red-light)' : 'white',
                color: 'var(--brand-alert-red-text)',
                opacity: rejected ? 0.85 : 1,
              }}
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <XIcon className="w-3 h-3" />}
            </button>
          </div>
        )}
        </div>
        {noteEl}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Status banner */}
      <div
        className="rounded-2xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
        data-testid="admin-profile-status-banner"
        style={{
          backgroundColor: isFullyVerified ? 'var(--brand-success-green-light)' : 'var(--brand-warning-amber-light)',
          borderLeft: `4px solid ${isFullyVerified ? 'var(--brand-success-green)' : 'var(--brand-warning-amber)'}`,
        }}
      >
        <div className="flex items-start gap-2.5">
          {isFullyVerified ? (
            <ShieldCheck className="w-5 h-5 shrink-0" style={{ color: 'var(--brand-success-green)' }} />
          ) : (
            <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: 'var(--brand-warning-amber-text)' }} />
          )}
          <div>
            <p className="text-[13px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
              {isFullyVerified
                ? 'Profile is verified by admin'
                : 'Profile awaiting verification'}
            </p>
            <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--brand-text-secondary)' }}>
              {isFullyVerified
                ? `Verified ${profile.profileVerifiedAt ? new Date(profile.profileVerifiedAt).toLocaleDateString() : ''}`
                : canVerify
                  ? 'Confirm or correct each field below, then click "Verification complete".'
                  : 'A clinician will review this profile shortly.'}
            </p>
          </div>
        </div>
      </div>

      {/* IVR-23 — fields the patient changed since the last admin review.
          Surfaces a "re-check these" prompt so a post-verification edit doesn't
          slip past unnoticed. Hidden once the profile is fully verified again. */}
      {!isFullyVerified && changedSinceVerification.length > 0 && (
        <div
          className="rounded-2xl p-4 flex items-start gap-2.5"
          data-testid="admin-profile-changed-banner"
          style={{
            backgroundColor: 'var(--brand-warning-amber-light)',
            borderLeft: '4px solid var(--brand-warning-amber)',
          }}
        >
          <History className="w-5 h-5 shrink-0" style={{ color: 'var(--brand-warning-amber-text)' }} />
          <div>
            <p className="text-[13px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
              {changedSinceVerification.length} field
              {changedSinceVerification.length === 1 ? '' : 's'} changed since last verification
            </p>
            <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--brand-text-secondary)' }}>
              The patient updated:{' '}
              {changedSinceVerification.map((f) => fieldLabel[f] ?? f).join(', ')}. Re-confirm or
              correct {changedSinceVerification.length === 1 ? 'it' : 'them'} below.
            </p>
          </div>
        </div>
      )}

      {/* Reject hard-gate banner — verification is blocked while any field is
          rejected. Lists the fields so the admin knows exactly what to resolve
          (correct it, re-confirm it, or have the patient re-report). */}
      {canVerify && !isFullyVerified && hasRejectedFields && (
        <div
          className="rounded-2xl p-4 flex items-start gap-2.5"
          data-testid="admin-profile-rejected-banner"
          style={{
            backgroundColor: 'var(--brand-alert-red-light)',
            borderLeft: '4px solid var(--brand-alert-red)',
          }}
        >
          <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: 'var(--brand-alert-red-text)' }} />
          <div>
            <p className="text-[13px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
              {rejectedFieldKeys.length} field
              {rejectedFieldKeys.length === 1 ? '' : 's'} rejected — resolve before completing verification
            </p>
            <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--brand-text-secondary)' }}>
              {rejectedFieldKeys.map((k) => fieldLabel[k as string] ?? k).join(', ')}. Correct{' '}
              {rejectedFieldKeys.length === 1 ? 'it' : 'each'}, re-confirm, or have the patient
              re-report — then you can lock in the verification.
            </p>
          </div>
        </div>
      )}

      {/* Two-column reconciliation grid. The pregnancy group is irrelevant
          for non-FEMALE patients and is hidden — the patient frontend
          gates the same group on gender, and the intake submit clears
          pregnancy fields whenever gender isn't FEMALE so there's no
          orphaned data to verify. */}
      {(['demographics', 'pregnancy', 'cardiac'] as const)
        .filter((g) => g !== 'pregnancy' || profile.gender === 'FEMALE')
        .map((group) => (
        <div key={group} className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
          <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--brand-border)' }}>
            <h3 className="text-[13px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
              {GROUP_LABEL[group]}
            </h3>
          </div>
          {/* Cluster 8 Q2 (Manisha 5/18/26) — persistent CAD treatment-target
              note. Shown for every CAD patient regardless of alert state so
              the provider always sees the AHA/ACC target + the default alert
              thresholds that now fire (SBP ≥140 via the Q2 ramp, DBP ≥80,
              DBP <70 J-curve low). Per-patient overrides live in Thresholds. */}
          {group === 'cardiac' && profile.hasCAD && (
            <div
              data-testid="admin-profile-cad-treatment-note"
              className="mx-5 my-3 rounded-xl px-4 py-3 flex items-start gap-2.5"
              style={{
                backgroundColor: 'var(--brand-accent-teal-light)',
                color: 'var(--brand-accent-teal)',
              }}
            >
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <p className="text-[12px] leading-relaxed">
                <span className="font-bold">CAD patient — AHA/ACC treatment target 130/80.</span>{' '}
                Default alert thresholds: SBP ≥140 (Q2 ramp) / DBP ≥80 / DBP &lt;70 (J-curve low).
                Customize per patient in Thresholds.
              </p>
            </div>
          )}
          {/* Column headers */}
          <div className="hidden md:grid grid-cols-[180px_1fr_1fr] px-5 py-2.5" style={{ backgroundColor: 'var(--brand-background)' }}>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
              Field
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
              Patient-reported
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
              Admin verification
            </span>
          </div>
          <div>
            {/* Age row — derived from User.dateOfBirth (collected at clinical
                intake A1, editable by patient via profile edit). Read-only
                here; no admin verify/correct flow because patients self-report
                DOB and any correction goes back through the patient. */}
            {group === 'demographics' && (
              <div
                className="grid grid-cols-1 md:grid-cols-[180px_1fr_1fr] gap-2 md:gap-3 px-5 py-3 items-center"
                style={{ borderTop: '1px solid var(--brand-border)' }}
              >
                <span className="text-[12.5px] font-semibold" style={{ color: 'var(--brand-text-secondary)' }}>
                  Age
                </span>
                <span className="text-[12.5px]" style={{ color: 'var(--brand-text-primary)' }}>
                  {(() => {
                    const age = ageFromDob(profile.dateOfBirth);
                    if (age == null) return '—';
                    const dobLabel = fmtValue(profile.dateOfBirth, 'date');
                    return `${age} yrs (DOB ${dobLabel})`;
                  })()}
                </span>
                <span className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
                  Self-reported
                </span>
              </div>
            )}
            {grouped[group].map((field) => (
              <div
                key={field.key as string}
                className="grid grid-cols-1 md:grid-cols-[180px_1fr_1fr] gap-2 md:gap-3 px-5 py-3 items-center"
                style={{ borderTop: '1px solid var(--brand-border)' }}
              >
                <span className="text-[12.5px] font-semibold" style={{ color: 'var(--brand-text-secondary)' }}>
                  {field.label}
                </span>
                <span className="text-[12.5px]" style={{ color: 'var(--brand-text-primary)' }}>
                  {fmtValue(profile[field.key], field.type)}
                </span>
                <div>{renderRightCell(field)}</div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {completeError && (
        <div
          className="rounded-lg px-4 py-2.5 text-[12.5px] font-semibold"
          style={{ backgroundColor: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red-text)' }}
        >
          {completeError}
        </div>
      )}

      {/* Footer — only for the clinical-verifier roles. */}
      {canVerify && !isFullyVerified && (
        <div
          className="bg-white rounded-2xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
          style={{ boxShadow: 'var(--brand-shadow-card)' }}
        >
          <p className="text-[12.5px]" style={{ color: 'var(--brand-text-secondary)' }}>
            When all fields look right, lock in this verification.
          </p>
          {showCompleteRationale ? (
            <div className="flex flex-col md:flex-row gap-2 md:items-center w-full md:w-auto">
              <input
                type="text"
                value={completeRationale}
                onChange={(e) => setCompleteRationale(e.target.value)}
                data-testid="admin-profile-verify-rationale"
                placeholder="Optional rationale for the audit log"
                className="px-3 h-9 rounded-lg text-[12.5px] outline-none"
                style={{ border: '1px solid var(--brand-border)', minWidth: 240 }}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setShowCompleteRationale(false); setCompleteRationale(''); }}
                  className="btn-admin-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={completeVerification}
                  disabled={completing}
                  data-testid="admin-profile-verify-confirm"
                  className="btn-admin-primary"
                >
                  {completing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                  Confirm
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              {/* IVR-25 — one-click confirm of every still-pending field. */}
              {pendingFieldKeys.length > 0 && (
                <button
                  type="button"
                  onClick={confirmAllPending}
                  disabled={confirmingAll}
                  data-testid="admin-profile-confirm-all"
                  className="btn-admin-secondary"
                >
                  {confirmingAll ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCheck className="w-3.5 h-3.5" />
                  )}
                  Confirm all ({pendingFieldKeys.length})
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowCompleteRationale(true)}
                disabled={hasRejectedFields}
                title={
                  hasRejectedFields
                    ? `Resolve rejected field${rejectedFieldKeys.length === 1 ? '' : 's'} first`
                    : undefined
                }
                data-testid="admin-profile-verify-complete"
                className="btn-admin-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Verification complete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function renderEditor(field: FieldDef, value: unknown, onChange: (v: unknown) => void) {
  if (field.type === 'boolean') {
    return (
      <select
        value={value ? 'true' : 'false'}
        onChange={(e) => onChange(e.target.value === 'true')}
        data-testid={`admin-profile-edit-input-${field.key}`}
        className="px-2.5 h-8 rounded-lg text-[12px] outline-none w-full"
        style={{ border: '1px solid var(--brand-border)' }}
      >
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  if (field.type === 'enum') {
    return (
      <select
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`admin-profile-edit-input-${field.key}`}
        className="px-2.5 h-8 rounded-lg text-[12px] outline-none w-full"
        style={{ border: '1px solid var(--brand-border)' }}
      >
        {(field.options ?? []).map((opt) => (
          <option key={opt} value={opt}>
            {opt.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === 'date') {
    return (
      <input
        type="date"
        value={value ? String(value).slice(0, 10) : ''}
        onChange={(e) => onChange(e.target.value || null)}
        data-testid={`admin-profile-edit-input-${field.key}`}
        className="px-2.5 h-8 rounded-lg text-[12px] outline-none w-full"
        style={{ border: '1px solid var(--brand-border)' }}
      />
    );
  }
  // number
  return (
    <input
      type="number"
      value={(value as number | null) ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      data-testid={`admin-profile-edit-input-${field.key}`}
      className="px-2.5 h-8 rounded-lg text-[12px] outline-none w-full"
      style={{ border: '1px solid var(--brand-border)' }}
    />
  );
}
