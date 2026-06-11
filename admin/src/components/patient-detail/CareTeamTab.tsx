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
  listPracticeStaff,
  type Practice,
  type Clinician,
  type PatientAssignment,
  type PracticeStaff,
  type UpsertAssignmentPayload,
} from '@/lib/services/practice.service';
import { useAuth } from '@/lib/auth-context';
import { canAssignCareTeam } from '@/lib/roleGates';
// CaregiversPanel moved to its own dedicated tab in PatientDetailShell
// (Round 2 D2) — Care Team no longer mounts it.

interface Props {
  patientId: string;
  /** Fired after a successful create/update of the patient assignment.
   *  The shell uses this to re-run the enrollment-gate check — adding the
   *  care team often unblocks the Enroll button, and the user shouldn't
   *  have to refresh the page to see that. */
  onChanged?: () => void;
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

export default function CareTeamTab({ patientId, onChanged }: Props) {
  const { user } = useAuth();
  // Editor surfaces (form, dropdowns, save button) only render for roles
  // that can actually write — SUPER_ADMIN, MEDICAL_DIRECTOR, HEALPLACE_OPS.
  // PROVIDER gets a clean read-only view of the existing assignment.
  const canEdit = canAssignCareTeam(user);

  const [practices, setPractices] = useState<Practice[]>([]);
  const [providers, setProviders] = useState<Clinician[]>([]);
  const [medicalDirectors, setMedicalDirectors] = useState<Clinician[]>([]);
  // Practice-scoped staff list — populated on practice-dropdown change so the
  // Primary / Backup / MD selects only show clinicians actually attached to
  // the selected practice. Null = "no practice picked yet, show full pool".
  const [practiceStaff, setPracticeStaff] = useState<PracticeStaff[] | null>(null);
  const [staffLoading, setStaffLoading] = useState(false);

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

  // Cascading dropdown: whenever practice changes, refetch staff for that
  // specific practice. The Primary / Backup / MD dropdowns then filter to
  // clinicians explicitly attached to the practice (via PracticeProvider /
  // PracticeMedicalDirector joins or existing assignments). Empty practice
  // ID = clear scoped pool and fall back to the global clinician list.
  useEffect(() => {
    if (!form.practiceId) {
      setPracticeStaff(null);
      return;
    }
    let cancelled = false;
    setStaffLoading(true);
    listPracticeStaff(form.practiceId)
      .then((s) => {
        if (!cancelled) setPracticeStaff(s);
      })
      .catch(() => {
        // Soft-fail — fall back to global pool so the dropdowns still work.
        if (!cancelled) setPracticeStaff(null);
      })
      .finally(() => {
        if (!cancelled) setStaffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [form.practiceId]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSuccess(null);
  }

  // Primary + Backup accept PROVIDER OR MEDICAL_DIRECTOR. When the practice
  // dropdown has a value AND staff loaded, intersect the global clinician
  // pool with that practice's staff so we only show in-practice clinicians.
  // Falls back to the full pool when no practice is picked yet (initial
  // state) so the dropdown isn't empty on first open.
  const providerOrMdPool = useMemo(() => {
    const seen = new Set<string>();
    const out: Clinician[] = [];
    const practiceIds = practiceStaff
      ? new Set(practiceStaff.map((s) => s.id))
      : null;
    for (const c of [...providers, ...medicalDirectors]) {
      if (seen.has(c.id)) continue;
      if (practiceIds && !practiceIds.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    return out;
  }, [providers, medicalDirectors, practiceStaff]);

  // MD dropdown: same intersection rule against the global MD pool.
  const scopedMedicalDirectors = useMemo(() => {
    if (!practiceStaff) return medicalDirectors;
    const practiceIds = new Set(practiceStaff.map((s) => s.id));
    return medicalDirectors.filter((m) => practiceIds.has(m.id));
  }, [medicalDirectors, practiceStaff]);

  // Validation: primary and backup must differ — backend rejects with 400
  // when they match, but we surface it inline so the user doesn't lose
  // their save click. Empty values pass (form isn't complete yet anyway).
  const primaryBackupCollision =
    form.primaryProviderId.length > 0 &&
    form.backupProviderId.length > 0 &&
    form.primaryProviderId === form.backupProviderId;

  // Soft warning when MED_DIR is also primary or backup. Doesn't block save
  // (small practices may legitimately have one clinician with both roles),
  // just flags the escalation-coverage implication — every escalation rung
  // routes to the same inbox.
  const mdProviderCollision =
    form.medicalDirectorId.length > 0 &&
    (form.medicalDirectorId === form.primaryProviderId ||
      form.medicalDirectorId === form.backupProviderId);

  const isComplete =
    form.practiceId.length > 0 &&
    form.primaryProviderId.length > 0 &&
    form.backupProviderId.length > 0 &&
    form.medicalDirectorId.length > 0;

  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(assignment));
  const canSubmit = isComplete && dirty && !saving && !primaryBackupCollision;

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
      // Notify the shell so the enrollment-gate check re-runs — adding
      // the care team typically clears the "no-assignment" reason and
      // un-blocks the Enroll button without a page refresh.
      onChanged?.();
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
        <Building2 className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--brand-warning-amber-text)' }} />
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
        data-testid="admin-careteam-status"
        className="rounded-2xl p-4 flex items-start gap-3"
        style={{
          backgroundColor: assignment ? 'var(--brand-success-green-light)' : 'var(--brand-warning-amber-light)',
          borderLeft: `4px solid ${assignment ? 'var(--brand-success-green)' : 'var(--brand-warning-amber)'}`,
        }}
      >
        {assignment ? (
          <ShieldCheck className="w-5 h-5 shrink-0" style={{ color: 'var(--brand-success-green)' }} />
        ) : (
          <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: 'var(--brand-warning-amber-text)' }} />
        )}
        <div>
          <p className="text-[13px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
            {assignment ? 'Care team assigned' : 'No care team yet'}
          </p>
          <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--brand-text-secondary)' }}>
            {assignment
              ? `Last updated ${new Date(assignment.assignedAt).toLocaleString()}`
              : canEdit
                ? 'Pick a practice and assign primary, backup, and medical-director coverage.'
                : 'A medical director or operations admin will assign the care team.'}
          </p>
        </div>
      </div>

      {/* Editor card — render only for roles that can write. PROVIDER skips
          this entirely and sees just the read-only "Current care team"
          summary below. */}
      {canEdit && (
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
            data-testid="admin-careteam-practice-select"
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
          testId="admin-careteam-primary-select"
          icon={<Stethoscope className="w-2.5 h-2.5" />}
          accent="var(--brand-primary-purple)"
          options={providerOrMdPool}
          value={form.primaryProviderId}
          onChange={(v) => set('primaryProviderId', v)}
          disabledHint={
            providerOrMdPool.length === 0
              ? form.practiceId
                ? 'No clinicians attached to this practice yet. Add staff from the practice page.'
                : 'Pick a practice first to see its clinicians.'
              : null
          }
        />
        <ProviderSlot
          label="Backup provider"
          testId="admin-careteam-backup-select"
          icon={<UserCheck className="w-2.5 h-2.5" />}
          accent="var(--brand-accent-teal)"
          options={providerOrMdPool}
          value={form.backupProviderId}
          onChange={(v) => set('backupProviderId', v)}
          disabledHint={
            providerOrMdPool.length === 0
              ? form.practiceId
                ? 'No clinicians attached to this practice yet. Add staff from the practice page.'
                : 'Pick a practice first to see its clinicians.'
              : null
          }
        />
        <ProviderSlot
          label="Medical director"
          testId="admin-careteam-md-select"
          icon={<ShieldCheck className="w-2.5 h-2.5" />}
          accent="var(--brand-warning-amber)"
          options={scopedMedicalDirectors}
          value={form.medicalDirectorId}
          onChange={(v) => set('medicalDirectorId', v)}
          disabledHint={
            scopedMedicalDirectors.length === 0
              ? form.practiceId
                ? 'No medical directors attached to this practice yet. Add one from the practice page.'
                : 'No users with the MEDICAL_DIRECTOR role yet.'
              : null
          }
          requiredRoleHint="Must be a MEDICAL_DIRECTOR per clinical policy."
        />

        {/* Primary == Backup inline validation banner. Mirror of the
            backend BadRequestException so the user sees the problem
            before clicking Save. */}
        {primaryBackupCollision && (
          <div
            data-testid="admin-careteam-primary-backup-collision"
            className="rounded-lg px-3 py-2 text-[12px] font-semibold"
            style={{
              backgroundColor: 'var(--brand-alert-red-light)',
              color: 'var(--brand-alert-red-text)',
            }}
          >
            Primary and backup providers must be different — pick a different
            backup so escalation has a real fallback.
          </div>
        )}

        {/* MED_DIR == primary/backup soft warning. Allowed (multi-role
            clinicians exist; small practices often have one person
            covering both roles) — flagged so the user understands the
            escalation-coverage implication: every escalation rung routes
            to the same inbox. Save stays enabled. */}
        {mdProviderCollision && !primaryBackupCollision && (
          <div
            data-testid="admin-careteam-md-provider-collision"
            className="rounded-lg px-3 py-2 text-[12px] font-semibold"
            style={{
              backgroundColor: 'var(--brand-warning-amber-light)',
              color: 'var(--brand-warning-amber-text)',
            }}
          >
            Medical director is the same clinician as the
            {form.medicalDirectorId === form.primaryProviderId
              ? ' primary'
              : ' backup'}
            {' '}provider — escalation will route to one inbox at every
            rung. Save anyway if that matches your practice's coverage.
          </div>
        )}

        {/* Errors / success */}
        {error && (
          <div
            className="rounded-lg px-3 py-2 text-[12px] font-semibold"
            style={{ backgroundColor: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red-text)' }}
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
          <button type="button" onClick={save} disabled={!canSubmit} className="btn-admin-primary" data-testid="admin-careteam-save">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {assignment ? 'Update assignment' : 'Assign care team'}
          </button>
        </div>
      </div>
      )}

      {/* Current assignment summary */}
      {assignment && (
        <div className="bg-white rounded-2xl p-5" style={{ boxShadow: 'var(--brand-shadow-card)' }} data-testid="admin-careteam-readonly">
          <p className="text-[10.5px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--brand-text-muted)' }}>
            Current care team
          </p>
          <div className="space-y-2">
            <ResolvedRow
              label="Primary"
              accent="var(--brand-primary-purple)"
              clinician={providerOrMdPool.find((c) => c.id === assignment.primaryProviderId) ?? null}
              testId="admin-careteam-current-primary"
            />
            <ResolvedRow
              label="Backup"
              accent="var(--brand-accent-teal)"
              clinician={providerOrMdPool.find((c) => c.id === assignment.backupProviderId) ?? null}
              testId="admin-careteam-current-backup"
            />
            <ResolvedRow
              label="Medical director"
              accent="var(--brand-warning-amber)"
              clinician={medicalDirectors.find((c) => c.id === assignment.medicalDirectorId) ?? null}
              testId="admin-careteam-current-md"
            />
            <ResolvedRow
              label="Practice"
              accent="var(--brand-text-secondary)"
              clinician={null}
              practiceName={practices.find((p) => p.id === assignment.practiceId)?.name ?? null}
              testId="admin-careteam-current-practice"
            />
          </div>
        </div>
      )}

      {/* Round 2 D2 — CaregiversPanel promoted out of Care Team into its own
          first-class tab (mounted by PatientDetailShell). Care Team now scopes
          to the provider-assignment editor + the current-assignment summary. */}
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
  testId?: string;
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
  testId,
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
          aria-label={label}
          aria-required="true"
          data-testid={testId}
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
  testId,
}: {
  label: string;
  accent: string;
  clinician: Clinician | null;
  practiceName?: string | null;
  testId?: string;
}) {
  return (
    <div
      className="rounded-lg p-2.5 flex items-center gap-3"
      data-testid={testId}
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
