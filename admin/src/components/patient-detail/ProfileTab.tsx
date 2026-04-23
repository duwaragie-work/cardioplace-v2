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
} from 'lucide-react';
import {
  verifyPatientProfile,
  correctPatientProfile,
  rejectProfileField,
  type PatientProfile,
} from '@/lib/services/patient-detail.service';

interface Props {
  patientId: string;
  profile: PatientProfile | null;
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

type FieldStatus = 'pending' | 'confirmed' | 'editing' | 'rejected';

export default function ProfileTab({ patientId, profile, loading, onChanged }: Props) {
  // Local row state — per-field action state. Reset whenever the underlying
  // profile changes (new fetch).
  const [edits, setEdits] = useState<Partial<Record<keyof PatientProfile, unknown>>>({});
  const [statuses, setStatuses] = useState<Partial<Record<keyof PatientProfile, FieldStatus>>>({});
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<keyof PatientProfile | null>(null);
  const [showCompleteRationale, setShowCompleteRationale] = useState(false);
  const [completeRationale, setCompleteRationale] = useState('');

  const grouped = useMemo(() => {
    const m: Record<FieldDef['group'], FieldDef[]> = { demographics: [], pregnancy: [], cardiac: [] };
    for (const f of FIELDS) m[f.group].push(f);
    return m;
  }, []);

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
        <AlertTriangle className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--brand-warning-amber)' }} />
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

  function setStatus(key: keyof PatientProfile, status: FieldStatus) {
    setStatuses((prev) => ({ ...prev, [key]: status }));
  }
  function setEdit(key: keyof PatientProfile, value: unknown) {
    setEdits((prev) => ({ ...prev, [key]: value }));
  }

  async function saveCorrection(field: FieldDef) {
    if (!profile) return;
    setSavingField(field.key);
    try {
      const value = edits[field.key];
      // Send the single-field correction with a server-mandated rationale.
      // The backend's correctProfile path expects a full IntakeProfileDto, so
      // we shallow-merge the change onto a snapshot of the current profile.
      const corrections: Partial<PatientProfile> = {
        ...stripServerOnlyFields(profile),
        [field.key]: value as never,
      };
      await correctPatientProfile(
        patientId,
        corrections,
        `Admin correction: ${field.label}`,
      );
      setStatus(field.key, 'confirmed');
      setEdits((prev) => {
        const { [field.key]: _drop, ...rest } = prev;
        void _drop;
        return rest;
      });
      onChanged();
    } catch (e) {
      setCompleteError(e instanceof Error ? e.message : 'Could not save correction.');
    } finally {
      setSavingField(null);
    }
  }

  /**
   * Reject a single field. Hits the backend so:
   *   • An ADMIN_REJECT audit row is written for the field.
   *   • profileVerificationStatus flips back to UNVERIFIED.
   *   • The whole profile lights up the "awaiting verification" banner again.
   */
  async function rejectField(field: FieldDef) {
    if (!profile) return;
    setSavingField(field.key);
    try {
      await rejectProfileField(
        patientId,
        field.key,
        `Field rejected by admin: ${field.label}`,
      );
      setStatus(field.key, 'rejected');
      onChanged();
    } catch (e) {
      setCompleteError(e instanceof Error ? e.message : 'Could not reject field.');
    } finally {
      setSavingField(null);
    }
  }

  async function completeVerification() {
    if (!profile) return;
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
    const status: FieldStatus = statuses[field.key] ?? 'pending';
    const fromPatient = profile?.[field.key];
    const editing = status === 'editing';
    const editValue = edits[field.key] ?? fromPatient;
    const saving = savingField === field.key;

    if (editing) {
      return (
        <div className="flex flex-col gap-2">
          {renderEditor(field, editValue, (v) => setEdit(field.key, v))}
          <div className="flex gap-1.5">
            <button
              type="button"
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
                setStatus(field.key, 'pending');
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
        </div>
      );
    }

    return (
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-[12.5px] truncate"
          style={{
            color:
              isFullyVerified
                ? 'var(--brand-success-green)'
                : status === 'confirmed'
                  ? 'var(--brand-success-green)'
                  : status === 'rejected'
                    ? 'var(--brand-alert-red)'
                    : 'var(--brand-text-primary)',
            fontWeight: isFullyVerified || status !== 'pending' ? 600 : 500,
          }}
        >
          {fmtValue(fromPatient, field.type)}
          {isFullyVerified ? (
            <span className="ml-1.5 text-[10px] uppercase tracking-wider inline-flex items-center gap-0.5">
              <Check className="w-2.5 h-2.5" />
              Verified
            </span>
          ) : status === 'confirmed' ? (
            <span className="ml-1.5 text-[10px] uppercase tracking-wider">Confirmed</span>
          ) : status === 'rejected' ? (
            <span className="ml-1.5 text-[10px] uppercase tracking-wider">Rejected — needs correction</span>
          ) : null}
        </span>
        {/* Edit + Reject are always available so an admin can revisit a
            previously-verified profile. Confirm is only meaningful before the
            profile is locked in, so we hide it once isFullyVerified. */}
        <div className="flex gap-1 shrink-0">
          {!isFullyVerified && (
            <button
              type="button"
              title="Confirm"
              onClick={() => setStatus(field.key, 'confirmed')}
              className="w-6 h-6 rounded-md flex items-center justify-center transition-all hover:bg-green-50 cursor-pointer"
              style={{
                border: `1px solid ${status === 'confirmed' ? 'var(--brand-success-green)' : 'var(--brand-border)'}`,
                backgroundColor: status === 'confirmed' ? 'var(--brand-success-green-light)' : 'white',
                color: 'var(--brand-success-green)',
              }}
            >
              <Check className="w-3 h-3" />
            </button>
          )}
          <button
            type="button"
            title={isFullyVerified ? 'Edit (re-opens verification)' : 'Correct'}
            onClick={() => setStatus(field.key, 'editing')}
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
            title={isFullyVerified ? 'Reject (returns profile to unverified)' : 'Reject'}
            onClick={() => rejectField(field)}
            disabled={saving}
            className="w-6 h-6 rounded-md flex items-center justify-center transition-all hover:bg-red-50 cursor-pointer disabled:opacity-60"
            style={{
              border: `1px solid ${status === 'rejected' ? 'var(--brand-alert-red)' : 'var(--brand-border)'}`,
              backgroundColor: status === 'rejected' ? 'var(--brand-alert-red-light)' : 'white',
              color: 'var(--brand-alert-red)',
            }}
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <XIcon className="w-3 h-3" />}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Status banner */}
      <div
        className="rounded-2xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
        style={{
          backgroundColor: isFullyVerified ? 'var(--brand-success-green-light)' : 'var(--brand-warning-amber-light)',
          borderLeft: `4px solid ${isFullyVerified ? 'var(--brand-success-green)' : 'var(--brand-warning-amber)'}`,
        }}
      >
        <div className="flex items-start gap-2.5">
          {isFullyVerified ? (
            <ShieldCheck className="w-5 h-5 shrink-0" style={{ color: 'var(--brand-success-green)' }} />
          ) : (
            <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: 'var(--brand-warning-amber)' }} />
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
                : 'Confirm or correct each field below, then click "Verification complete".'}
            </p>
          </div>
        </div>
      </div>

      {/* Two-column reconciliation grid */}
      {(['demographics', 'pregnancy', 'cardiac'] as const).map((group) => (
        <div key={group} className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
          <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--brand-border)' }}>
            <h3 className="text-[13px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
              {GROUP_LABEL[group]}
            </h3>
          </div>
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
          style={{ backgroundColor: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red)' }}
        >
          {completeError}
        </div>
      )}

      {/* Footer */}
      {!isFullyVerified && (
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
                  className="btn-admin-primary"
                >
                  {completing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                  Confirm
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowCompleteRationale(true)}
              className="btn-admin-primary"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Verification complete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function stripServerOnlyFields(profile: PatientProfile): Partial<PatientProfile> {
  // The correctProfile DTO expects an intake-profile-shaped object; we strip
  // the server-only fields (id, audit timestamps, status) before submitting.
  const {
    id: _id,
    userId: _userId,
    profileVerificationStatus: _ps,
    profileVerifiedAt: _pa,
    profileVerifiedBy: _pb,
    profileLastEditedAt: _ple,
    createdAt: _ca,
    updatedAt: _ua,
    ...rest
  } = profile;
  void _id; void _userId; void _ps; void _pa; void _pb; void _ple; void _ca; void _ua;
  return rest;
}

function renderEditor(field: FieldDef, value: unknown, onChange: (v: unknown) => void) {
  if (field.type === 'boolean') {
    return (
      <select
        value={value ? 'true' : 'false'}
        onChange={(e) => onChange(e.target.value === 'true')}
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
      className="px-2.5 h-8 rounded-lg text-[12px] outline-none w-full"
      style={{ border: '1px solid var(--brand-border)' }}
    />
  );
}
