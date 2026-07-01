'use client';

// Coordinator (front-desk) patient roster. Minimum-necessary: identity +
// onboarding + current care team only — NO clinical data. Coordinators can
// assign / reassign the care team for patients in their own practice.

import { useCallback, useEffect, useState } from 'react';
import { Users, Search, Loader2, UserCog, X } from 'lucide-react';
import {
  getCoordinatorPatients,
  getCoordinatorClinicians,
  saveCareTeam,
  type CoordinatorPatient,
  type Clinician,
} from '@/lib/services/coordinator.service';

function onboardingBadge(status: string): { label: string; bg: string; color: string } {
  if (status === 'COMPLETED') {
    return { label: 'Onboarded', bg: 'var(--brand-success-green-light)', color: 'var(--brand-success-green)' };
  }
  return { label: 'Pending', bg: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber-text)' };
}

export default function CoordinatorPatientsView() {
  const [patients, setPatients] = useState<CoordinatorPatient[]>([]);
  const [clinicians, setClinicians] = useState<Clinician[]>([]);
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [assignTarget, setAssignTarget] = useState<CoordinatorPatient | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ patients: p, practiceId: pid }, c] = await Promise.all([
        getCoordinatorPatients(),
        getCoordinatorClinicians(),
      ]);
      setPatients(p);
      setPracticeId(pid);
      setClinicians(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load patients.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = patients.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (p.name ?? '').toLowerCase().includes(q) ||
      (p.email ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="h-full" style={{ backgroundColor: '#FAFBFF' }}>
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
            >
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                Patients
              </h1>
              <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
                {loading ? '…' : `${patients.length} patients in your practice`}
              </p>
            </div>
          </div>
          <div
            className="flex items-center gap-2 px-3 h-9 rounded-full w-full sm:w-64"
            style={{ backgroundColor: 'white', border: '1.5px solid var(--brand-border)' }}
          >
            <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-text-muted)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or email"
              data-testid="coordinator-patient-search"
              className="flex-1 text-[12px] outline-none bg-transparent min-w-0"
              style={{ color: 'var(--brand-text-primary)' }}
            />
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="text-sm font-semibold px-3 py-2 rounded-lg mb-4"
            style={{ color: 'var(--brand-alert-red)', backgroundColor: 'var(--brand-alert-red-light)' }}
          >
            {error}
          </p>
        )}

        {/* Table */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: '0 1px 20px rgba(123,0,224,0.07)' }}>
          <div
            className="hidden md:grid items-center px-5 py-3 text-[10px] font-bold uppercase tracking-wider gap-3"
            style={{
              color: 'var(--brand-text-muted)',
              gridTemplateColumns: '1.6fr 1fr 1.4fr 130px',
              borderBottom: '1px solid var(--brand-border)',
            }}
          >
            <span>Patient</span>
            <span>Onboarding</span>
            <span>Care team</span>
            <span></span>
          </div>

          {loading ? (
            <div className="py-16 text-center">
              <Loader2 className="w-6 h-6 mx-auto animate-spin" style={{ color: 'var(--brand-primary-purple)' }} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center" data-testid="coordinator-patient-empty">
              <Users className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--brand-border)' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--brand-text-muted)' }}>
                No patients yet.
              </p>
            </div>
          ) : (
            filtered.map((p, i) => {
              const ob = onboardingBadge(p.onboardingStatus);
              const primary = p.careTeam?.primaryProvider?.name;
              return (
                <div
                  key={p.id}
                  data-testid={`coordinator-patient-row-${p.id}`}
                  className="px-5 py-3.5 flex items-center gap-3 md:grid md:gap-3"
                  style={{
                    gridTemplateColumns: '1.6fr 1fr 1.4fr 130px',
                    borderTop: i > 0 ? '1px solid var(--brand-border)' : 'none',
                  }}
                >
                  <div className="min-w-0 flex-1 md:flex-none">
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--brand-text-primary)' }}>
                      {p.name ?? 'Unknown'}
                    </p>
                    <p className="text-[11px] truncate" style={{ color: 'var(--brand-text-muted)' }}>
                      {p.email ?? '—'}
                    </p>
                  </div>
                  <div className="hidden md:block">
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                      style={{ backgroundColor: ob.bg, color: ob.color }}
                    >
                      {ob.label}
                    </span>
                  </div>
                  <div className="hidden md:block min-w-0">
                    <p className="text-[12px] truncate" style={{ color: primary ? 'var(--brand-text-secondary)' : 'var(--brand-text-muted)' }}>
                      {primary ? `Dr. ${primary}` : 'Not assigned'}
                    </p>
                  </div>
                  <div className="shrink-0 md:text-right">
                    <button
                      type="button"
                      onClick={() => setAssignTarget(p)}
                      data-testid={`coordinator-assign-${p.id}`}
                      className="h-8 px-3 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                      style={{
                        color: 'var(--brand-primary-purple)',
                        border: '1px solid var(--brand-primary-purple)',
                      }}
                    >
                      <UserCog className="w-3 h-3" />
                      {p.careTeam ? 'Edit team' : 'Assign team'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {assignTarget && practiceId && (
        <AssignCareTeamModal
          patient={assignTarget}
          practiceId={practiceId}
          clinicians={clinicians}
          onClose={() => setAssignTarget(null)}
          onSaved={() => {
            setAssignTarget(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function AssignCareTeamModal({
  patient,
  practiceId,
  clinicians,
  onClose,
  onSaved,
}: {
  patient: CoordinatorPatient;
  practiceId: string;
  clinicians: Clinician[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [primary, setPrimary] = useState(patient.careTeam?.primaryProvider?.id ?? '');
  const [backup, setBackup] = useState(patient.careTeam?.backupProvider?.id ?? '');
  const [md, setMd] = useState(patient.careTeam?.medicalDirector?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mds = clinicians.filter((c) => c.roles.includes('MEDICAL_DIRECTOR'));
  const complete = primary && backup && md;
  const distinct = primary !== backup;

  async function handleSave() {
    if (!complete) {
      setError('Pick a primary provider, a backup, and a medical director.');
      return;
    }
    if (!distinct) {
      setError('Primary and backup providers must be different.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveCareTeam(
        patient.id,
        {
          practiceId,
          primaryProviderId: primary,
          backupProviderId: backup,
          medicalDirectorId: md,
        },
        patient.careTeam !== null,
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save care team.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: 'rgba(15,23,42,0.5)' }}
    >
      <div className="absolute inset-0" onClick={saving ? undefined : onClose} aria-hidden />
      <div
        className="relative w-full sm:max-w-md bg-white sm:rounded-3xl rounded-t-3xl flex flex-col overflow-hidden"
        style={{ maxHeight: '92dvh', boxShadow: 'var(--brand-shadow-card)' }}
        role="dialog"
        aria-modal="true"
        data-testid="coordinator-assign-modal"
      >
        <div
          className="shrink-0 flex items-start justify-between gap-3 px-5 pt-4 pb-3"
          style={{ borderBottom: '1px solid var(--brand-border)' }}
        >
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
              Care team
            </h2>
            <p className="text-[12px] truncate" style={{ color: 'var(--brand-text-muted)' }}>
              {patient.name ?? patient.email ?? 'Patient'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 cursor-pointer disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" style={{ color: 'var(--brand-text-muted)' }} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <Field label="Primary provider" testId="coordinator-select-primary" value={primary} onChange={setPrimary} options={clinicians} />
          <Field label="Backup provider" testId="coordinator-select-backup" value={backup} onChange={setBackup} options={clinicians} />
          <Field label="Medical director" testId="coordinator-select-md" value={md} onChange={setMd} options={mds} />
          {error && (
            <p
              role="alert"
              className="text-[12px] font-semibold px-3 py-2 rounded-lg"
              style={{ color: 'var(--brand-alert-red)', backgroundColor: 'var(--brand-alert-red-light)' }}
            >
              {error}
            </p>
          )}
        </div>

        <div className="shrink-0 px-5 py-3 flex gap-3" style={{ borderTop: '1px solid var(--brand-border)' }}>
          <button type="button" onClick={onClose} disabled={saving} className="btn-admin-secondary flex-1">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !complete}
            data-testid="coordinator-assign-save"
            className="btn-admin-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  testId,
  value,
  onChange,
  options,
}: {
  label: string;
  testId: string;
  value: string;
  onChange: (v: string) => void;
  options: Clinician[];
}) {
  return (
    <div>
      <label className="block text-[12px] font-semibold mb-1" style={{ color: 'var(--brand-text-secondary)' }}>
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        className="w-full h-10 px-3 rounded-lg text-[13px] outline-none cursor-pointer"
        style={{ border: '1.5px solid var(--brand-border)', color: 'var(--brand-text-primary)', backgroundColor: 'white' }}
      >
        <option value="">Select…</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name ?? c.email ?? c.id}
          </option>
        ))}
      </select>
    </div>
  );
}
