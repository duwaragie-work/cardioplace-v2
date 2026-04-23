'use client';

// Flow J3 — reusable provider-assignment panel.
//
// Inside the patient-detail screen this is mounted as the "Care team" tab.
// Three dropdowns (Primary provider / Backup provider / Medical director)
// plus a Practice selector. Sources:
//   • Practice list ........ /admin/practices
//   • Clinician pool ....... /admin/clinicians (filtered by required role)
//   • Existing assignment .. /admin/patients/:id/assignment
//
// Per the backend assignment.service validators:
//   • Primary / Backup slots accept PROVIDER or MEDICAL_DIRECTOR
//   • Medical director slot is MEDICAL_DIRECTOR-only

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Users,
  Save,
  Loader2,
  Stethoscope,
  ShieldCheck,
  UserCheck,
  Building2,
  Mail,
  AlertTriangle,
} from 'lucide-react';
import {
  getPatientAssignment,
  createPatientAssignment,
  updatePatientAssignment,
  listPractices,
  listClinicians,
  type Practice,
  type Clinician,
  type PatientAssignment,
  type UpsertAssignmentPayload,
} from '@/lib/services/practice.service';

interface Props {
  patientId: string;
}

interface FormState {
  practiceId: string;
  primaryProviderId: string;
  backupProviderId: string;
  medicalDirectorId: string;
}

const EMPTY: FormState = {
  practiceId: '',
  primaryProviderId: '',
  backupProviderId: '',
  medicalDirectorId: '',
};

function toForm(a: PatientAssignment | null): FormState {
  if (!a) return EMPTY;
  return {
    practiceId: a.practiceId,
    primaryProviderId: a.primaryProviderId,
    backupProviderId: a.backupProviderId,
    medicalDirectorId: a.medicalDirectorId,
  };
}

export default function CareTeamTab({ patientId }: Props) {
  const [practices, setPractices] = useState<Practice[]>([]);
  const [providers, setProviders] = useState<Clinician[]>([]);
  const [medicalDirectors, setMedicalDirectors] = useState<Clinician[]>([]);

  const [assignment, setAssignment] = useState<PatientAssignment | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Pull everything in parallel — these endpoints don't depend on each
      // other and the dropdowns need the full pool regardless of whether an
      // assignment exists yet.
      const [pList, providerPool, mdPool, existing] = await Promise.all([
        listPractices(),
        listClinicians('PROVIDER'),
        listClinicians('MEDICAL_DIRECTOR'),
        getPatientAssignment(patientId),
      ]);
      setPractices(pList);
      setProviders(providerPool);
      setMedicalDirectors(mdPool);
      setAssignment(existing);
      setForm(toForm(existing));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load care team data.');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    // Initial fetch — state updates inside refresh() are exactly what this
    // effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSuccess(null);
  }

  // For Primary + Backup we accept PROVIDER OR MEDICAL_DIRECTOR. Build a
  // unioned, dedup'd pool so the dropdowns include both.
  const providerOrMdPool = useMemo(() => {
    const seen = new Set<string>();
    const out: Clinician[] = [];
    for (const c of [...providers, ...medicalDirectors]) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    return out;
  }, [providers, medicalDirectors]);

  const isComplete =
    form.practiceId.length > 0 &&
    form.primaryProviderId.length > 0 &&
    form.backupProviderId.length > 0 &&
    form.medicalDirectorId.length > 0;

  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(assignment));
  const canSubmit = isComplete && dirty && !saving;

  async function save() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload: UpsertAssignmentPayload = {
        practiceId: form.practiceId,
        primaryProviderId: form.primaryProviderId,
        backupProviderId: form.backupProviderId,
        medicalDirectorId: form.medicalDirectorId,
      };
      const updated = assignment
        ? await updatePatientAssignment(patientId, payload)
        : await createPatientAssignment(patientId, payload);
      setAssignment(updated);
      setForm(toForm(updated));
      setSuccess(assignment ? 'Care team updated.' : 'Care team assigned.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save assignment.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl p-6 animate-pulse" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
        <div className="h-4 w-48 rounded-full mb-4" style={{ backgroundColor: '#EDE9F6' }} />
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-10 rounded-lg" style={{ backgroundColor: '#F3EEFB' }} />
          ))}
        </div>
      </div>
    );
  }

  // Special-case: no practices on file at all — guide the admin to create one
  // first instead of showing an empty dropdown they can't fix.
  if (practices.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
        <Building2 className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--brand-warning-amber)' }} />
        <p className="text-[14px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
          No practices configured
        </p>
        <p className="text-[12px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
          Add a practice from the Practices page before assigning a care team.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status banner */}
      <div
        className="rounded-2xl p-4 flex items-start gap-3"
        style={{
          backgroundColor: assignment ? 'var(--brand-success-green-light)' : 'var(--brand-warning-amber-light)',
          borderLeft: `4px solid ${assignment ? 'var(--brand-success-green)' : 'var(--brand-warning-amber)'}`,
        }}
      >
        {assignment ? (
          <ShieldCheck className="w-5 h-5 shrink-0" style={{ color: 'var(--brand-success-green)' }} />
        ) : (
          <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: 'var(--brand-warning-amber)' }} />
        )}
        <div>
          <p className="text-[13px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
            {assignment ? 'Care team assigned' : 'No care team yet'}
          </p>
          <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--brand-text-secondary)' }}>
            {assignment
              ? `Last updated ${new Date(assignment.assignedAt).toLocaleString()}`
              : 'Pick a practice and assign primary, backup, and medical-director coverage.'}
          </p>
        </div>
      </div>

      {/* Editor card */}
      <div className="bg-white rounded-2xl p-5 md:p-6 space-y-4" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4" style={{ color: 'var(--brand-primary-purple)' }} />
          <h2 className="text-[14px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
            Provider assignment
          </h2>
        </div>

        {/* Practice picker — always shown first since it scopes the others */}
        <Field
          label={
            <span className="inline-flex items-center gap-1">
              <Building2 className="w-2.5 h-2.5" />
              Practice
            </span>
          }
          required
        >
          <select
            value={form.practiceId}
            onChange={(e) => set('practiceId', e.target.value)}
            className="w-full px-3 h-9 rounded-lg text-[13px] outline-none bg-white"
            style={{ border: '1px solid var(--brand-border)' }}
          >
            <option value="">— Select practice —</option>
            {practices.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>

        {/* Three provider slots */}
        <ProviderSlot
          label="Primary provider"
          icon={<Stethoscope className="w-2.5 h-2.5" />}
          accent="var(--brand-primary-purple)"
          options={providerOrMdPool}
          value={form.primaryProviderId}
          onChange={(v) => set('primaryProviderId', v)}
          disabledHint={
            providerOrMdPool.length === 0
              ? 'No providers in the system yet.'
              : null
          }
        />
        <ProviderSlot
          label="Backup provider"
          icon={<UserCheck className="w-2.5 h-2.5" />}
          accent="var(--brand-accent-teal)"
          options={providerOrMdPool}
          value={form.backupProviderId}
          onChange={(v) => set('backupProviderId', v)}
          disabledHint={
            providerOrMdPool.length === 0
              ? 'No providers in the system yet.'
              : null
          }
        />
        <ProviderSlot
          label="Medical director"
          icon={<ShieldCheck className="w-2.5 h-2.5" />}
          accent="var(--brand-warning-amber)"
          options={medicalDirectors}
          value={form.medicalDirectorId}
          onChange={(v) => set('medicalDirectorId', v)}
          disabledHint={
            medicalDirectors.length === 0
              ? 'No users with the MEDICAL_DIRECTOR role yet.'
              : null
          }
          requiredRoleHint="Must be a MEDICAL_DIRECTOR per clinical policy."
        />

        {/* Errors / success */}
        {error && (
          <div
            className="rounded-lg px-3 py-2 text-[12px] font-semibold"
            style={{ backgroundColor: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red)' }}
          >
            {error}
          </div>
        )}
        {success && (
          <div
            className="rounded-lg px-3 py-2 text-[12px] font-semibold"
            style={{ backgroundColor: 'var(--brand-success-green-light)', color: 'var(--brand-success-green)' }}
          >
            {success}
          </div>
        )}

        <div className="flex justify-end">
          <button type="button" onClick={save} disabled={!canSubmit} className="btn-admin-primary">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {assignment ? 'Update assignment' : 'Assign care team'}
          </button>
        </div>
      </div>

      {/* Current assignment summary */}
      {assignment && (
        <div className="bg-white rounded-2xl p-5" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
          <p className="text-[10.5px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--brand-text-muted)' }}>
            Current care team
          </p>
          <div className="space-y-2">
            <ResolvedRow
              label="Primary"
              accent="var(--brand-primary-purple)"
              clinician={providerOrMdPool.find((c) => c.id === assignment.primaryProviderId) ?? null}
            />
            <ResolvedRow
              label="Backup"
              accent="var(--brand-accent-teal)"
              clinician={providerOrMdPool.find((c) => c.id === assignment.backupProviderId) ?? null}
            />
            <ResolvedRow
              label="Medical director"
              accent="var(--brand-warning-amber)"
              clinician={medicalDirectors.find((c) => c.id === assignment.medicalDirectorId) ?? null}
            />
            <ResolvedRow
              label="Practice"
              accent="var(--brand-text-secondary)"
              clinician={null}
              practiceName={practices.find((p) => p.id === assignment.practiceId)?.name ?? null}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers / sub-components ───────────────────────────────────────────────

interface ProviderSlotProps {
  label: string;
  icon: React.ReactNode;
  accent: string;
  options: Clinician[];
  value: string;
  onChange: (v: string) => void;
  /** Inline note shown when the dropdown is empty / unavailable. */
  disabledHint?: string | null;
  /** Optional sub-line under the label, e.g. role restriction. */
  requiredRoleHint?: string;
}

function ProviderSlot({
  label,
  icon,
  accent,
  options,
  value,
  onChange,
  disabledHint,
  requiredRoleHint,
}: ProviderSlotProps) {
  const selected = options.find((o) => o.id === value) ?? null;
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10.5px] font-bold uppercase tracking-wider inline-flex items-center gap-1" style={{ color: accent }}>
          {icon}
          {label}
          <span style={{ color: 'var(--brand-alert-red)' }}> *</span>
        </span>
        {requiredRoleHint && (
          <span className="text-[10px] italic" style={{ color: 'var(--brand-text-muted)' }}>
            {requiredRoleHint}
          </span>
        )}
      </div>
      <div
        className="rounded-lg overflow-hidden"
        style={{ border: `1px solid ${value ? accent : 'var(--brand-border)'}` }}
      >
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={options.length === 0}
          className="w-full px-3 h-9 text-[13px] outline-none bg-white disabled:opacity-60"
          style={{ color: 'var(--brand-text-primary)' }}
        >
          <option value="">{disabledHint ?? '— Select clinician —'}</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name ?? c.email}
            </option>
          ))}
        </select>
        {selected && (
          <div
            className="px-3 py-1.5 text-[11px] inline-flex items-center gap-1.5 w-full"
            style={{ backgroundColor: 'var(--brand-background)', color: 'var(--brand-text-muted)' }}
          >
            <Mail className="w-2.5 h-2.5 shrink-0" />
            <span className="truncate">{selected.email}</span>
            <span className="ml-auto inline-flex gap-1 shrink-0">
              {selected.roles.map((r) => (
                <span
                  key={r}
                  className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded"
                  style={{ backgroundColor: 'white', color: accent, border: `1px solid ${accent}` }}
                >
                  {prettifyRole(r)}
                </span>
              ))}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ResolvedRow({
  label,
  accent,
  clinician,
  practiceName,
}: {
  label: string;
  accent: string;
  clinician: Clinician | null;
  practiceName?: string | null;
}) {
  return (
    <div
      className="rounded-lg p-2.5 flex items-center gap-3"
      style={{ backgroundColor: 'var(--brand-background)', border: '1px solid var(--brand-border)' }}
    >
      <span
        className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
        style={{ backgroundColor: 'white', color: accent, border: `1px solid ${accent}` }}
      >
        {label}
      </span>
      <div className="flex-1 min-w-0">
        {practiceName ? (
          <p className="text-[12.5px] font-bold truncate" style={{ color: 'var(--brand-text-primary)' }}>
            {practiceName}
          </p>
        ) : clinician ? (
          <>
            <p className="text-[12.5px] font-bold truncate" style={{ color: 'var(--brand-text-primary)' }}>
              {clinician.name ?? 'Unnamed'}
            </p>
            <p className="text-[10.5px] truncate" style={{ color: 'var(--brand-text-muted)' }}>
              {clinician.email}
            </p>
          </>
        ) : (
          <p className="text-[12px] italic" style={{ color: 'var(--brand-text-muted)' }}>
            Not resolved (clinician removed?)
          </p>
        )}
      </div>
    </div>
  );
}

function prettifyRole(r: string): string {
  return r.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function Field({
  label,
  required,
  children,
}: {
  label: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[10.5px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--brand-text-muted)' }}>
        {label}
        {required && <span style={{ color: 'var(--brand-alert-red)' }}> *</span>}
      </span>
      {children}
    </label>
  );
}
