'use client';

// Flow H4 — PatientThreshold editor.
//
// • 6 numeric inputs: SBP upper/lower, DBP upper/lower, HR upper/lower (HR optional)
// • Condition-defaulted pre-fills:
//     - hasCAD            → DBP lower target = 70
//     - heartFailureType  = HFREF → SBP lower target = 85
//     - hasHCM            → SBP lower target = 100   (HCM trumps HFrEF if both)
// • Mandatory red banner if patient is HFrEF / HCM / DCM and no threshold row
//   exists yet.
// • Notes textarea for clinical rationale.
// • Version metadata (current row's setAt + setByProviderId).
//
// Only one PatientThreshold row exists per user — there's no separate version
// history table. The "previous targets" UI surfaces the current row's
// timestamp; full audit history lives in the Timeline tab.

import { useEffect, useMemo, useState } from 'react';
import {
  Sliders,
  Loader2,
  Save,
  ShieldAlert,
  AlertTriangle,
  Wand2,
} from 'lucide-react';
import {
  thresholdDefaultsFor,
  thresholdMandatory,
  upsertPatientThreshold,
  type PatientProfile,
  type PatientThreshold,
  type UpsertThresholdPayload,
} from '@/lib/services/patient-detail.service';

interface Props {
  patientId: string;
  profile: PatientProfile | null;
  threshold: PatientThreshold | null;
  loading: boolean;
  onChanged: () => void;
}

interface FormState {
  sbpUpperTarget: string;
  sbpLowerTarget: string;
  dbpUpperTarget: string;
  dbpLowerTarget: string;
  hrUpperTarget: string;
  hrLowerTarget: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  sbpUpperTarget: '',
  sbpLowerTarget: '',
  dbpUpperTarget: '',
  dbpLowerTarget: '',
  hrUpperTarget: '',
  hrLowerTarget: '',
  notes: '',
};

function thresholdToForm(t: PatientThreshold | null): FormState {
  if (!t) return EMPTY_FORM;
  return {
    sbpUpperTarget: t.sbpUpperTarget?.toString() ?? '',
    sbpLowerTarget: t.sbpLowerTarget?.toString() ?? '',
    dbpUpperTarget: t.dbpUpperTarget?.toString() ?? '',
    dbpLowerTarget: t.dbpLowerTarget?.toString() ?? '',
    hrUpperTarget: t.hrUpperTarget?.toString() ?? '',
    hrLowerTarget: t.hrLowerTarget?.toString() ?? '',
    notes: t.notes ?? '',
  };
}

function formToPayload(f: FormState): UpsertThresholdPayload {
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
  return {
    sbpUpperTarget: num(f.sbpUpperTarget),
    sbpLowerTarget: num(f.sbpLowerTarget),
    dbpUpperTarget: num(f.dbpUpperTarget),
    dbpLowerTarget: num(f.dbpLowerTarget),
    hrUpperTarget: num(f.hrUpperTarget),
    hrLowerTarget: num(f.hrLowerTarget),
    notes: f.notes.trim() || undefined,
  };
}

export default function ThresholdsTab({ patientId, profile, threshold, loading, onChanged }: Props) {
  const [form, setForm] = useState<FormState>(() => thresholdToForm(threshold));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Sync the form when the underlying threshold (re)loads. Derived state
  // pattern is intentional here — the parent owns the canonical row and
  // this tab owns the in-flight edits.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(thresholdToForm(threshold));
  }, [threshold]);

  const defaults = useMemo(() => thresholdDefaultsFor(profile), [profile]);
  const mandatory = useMemo(() => thresholdMandatory(profile), [profile]);
  const isMissingMandatory = mandatory && !threshold;

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(thresholdToForm(threshold)), [form, threshold]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSuccess(null);
  }

  function applyDefaults() {
    setForm((prev) => ({
      ...prev,
      sbpLowerTarget: defaults.sbpLowerTarget != null ? String(defaults.sbpLowerTarget) : prev.sbpLowerTarget,
      dbpLowerTarget: defaults.dbpLowerTarget != null ? String(defaults.dbpLowerTarget) : prev.dbpLowerTarget,
    }));
    setSuccess(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await upsertPatientThreshold(
        patientId,
        formToPayload(form),
        threshold ? 'update' : 'create',
      );
      setSuccess(threshold ? 'Threshold updated.' : 'Threshold created.');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save threshold.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl p-6 animate-pulse" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
        <div className="h-4 w-48 rounded-full mb-4" style={{ backgroundColor: '#EDE9F6' }} />
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-10 rounded-lg" style={{ backgroundColor: '#F3EEFB' }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Mandatory red banner */}
      {isMissingMandatory && (
        <div
          className="rounded-2xl p-4 flex items-start gap-3"
          style={{
            backgroundColor: 'var(--brand-alert-red-light)',
            border: '1.5px solid var(--brand-alert-red)',
          }}
        >
          <ShieldAlert className="w-5 h-5 shrink-0" style={{ color: 'var(--brand-alert-red)' }} />
          <div>
            <p className="text-[13px] font-bold" style={{ color: 'var(--brand-alert-red)' }}>
              Mandatory configuration required
            </p>
            <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--brand-text-secondary)' }}>
              This patient has{' '}
              {[
                profile?.heartFailureType === 'HFREF' ? 'HFrEF' : null,
                profile?.hasHCM ? 'HCM' : null,
                profile?.hasDCM ? 'DCM' : null,
              ]
                .filter(Boolean)
                .join(' / ')}
              {' '}— set a personalized SBP / DBP target before any further check-ins.
            </p>
          </div>
        </div>
      )}

      {/* Defaults hint */}
      {(defaults.sbpLowerTarget != null || defaults.dbpLowerTarget != null) && (
        <div
          className="rounded-2xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
          style={{
            backgroundColor: 'var(--brand-primary-purple-light)',
            border: '1px solid var(--brand-primary-purple)',
          }}
        >
          <div className="flex items-start gap-2.5">
            <Wand2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--brand-primary-purple)' }} />
            <div>
              <p className="text-[12.5px] font-bold" style={{ color: 'var(--brand-primary-purple)' }}>
                Suggested defaults from clinical spec
              </p>
              <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--brand-text-secondary)' }}>
                {defaults.sbpLowerTarget != null && (
                  <>SBP lower target {defaults.sbpLowerTarget} </>
                )}
                {defaults.dbpLowerTarget != null && (
                  <>· DBP lower target {defaults.dbpLowerTarget}</>
                )}
              </p>
            </div>
          </div>
          <button type="button" onClick={applyDefaults} className="btn-admin-secondary">
            Apply defaults
          </button>
        </div>
      )}

      {/* Editor card */}
      <div className="bg-white rounded-2xl p-5 md:p-6" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
        <div className="flex items-center gap-2 mb-4">
          <Sliders className="w-4 h-4" style={{ color: 'var(--brand-primary-purple)' }} />
          <h2 className="text-[14px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
            Personalized targets
          </h2>
        </div>

        {/* SBP / DBP / HR rows */}
        <div className="space-y-4">
          <PairRow
            title="Systolic BP (SBP)"
            unit="mmHg"
            upperLabel="Upper target"
            lowerLabel="Lower target"
            upperValue={form.sbpUpperTarget}
            lowerValue={form.sbpLowerTarget}
            onUpper={(v) => set('sbpUpperTarget', v)}
            onLower={(v) => set('sbpLowerTarget', v)}
            color="var(--brand-alert-red)"
          />
          <PairRow
            title="Diastolic BP (DBP)"
            unit="mmHg"
            upperLabel="Upper target"
            lowerLabel="Lower target"
            upperValue={form.dbpUpperTarget}
            lowerValue={form.dbpLowerTarget}
            onUpper={(v) => set('dbpUpperTarget', v)}
            onLower={(v) => set('dbpLowerTarget', v)}
            color="var(--brand-primary-purple)"
          />
          <PairRow
            title="Heart rate (optional)"
            unit="bpm"
            upperLabel="Upper target"
            lowerLabel="Lower target"
            upperValue={form.hrUpperTarget}
            lowerValue={form.hrLowerTarget}
            onUpper={(v) => set('hrUpperTarget', v)}
            onLower={(v) => set('hrLowerTarget', v)}
            color="var(--brand-accent-teal)"
          />
        </div>

        {/* Notes */}
        <div className="mt-5">
          <label className="block text-[11.5px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--brand-text-muted)' }}>
            Clinical rationale
          </label>
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Why these targets? e.g. HFrEF + recent fall — using lower SBP floor of 95 instead of 85."
            rows={3}
            className="w-full px-3 py-2 rounded-lg text-[13px] outline-none resize-y leading-relaxed"
            style={{ border: '1px solid var(--brand-border)' }}
          />
        </div>

        {/* Errors / success */}
        {error && (
          <div
            className="mt-3 rounded-lg px-3 py-2 text-[12px] font-semibold"
            style={{ backgroundColor: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red)' }}
          >
            {error}
          </div>
        )}
        {success && (
          <div
            className="mt-3 rounded-lg px-3 py-2 text-[12px] font-semibold"
            style={{ backgroundColor: 'var(--brand-success-green-light)', color: 'var(--brand-success-green)' }}
          >
            {success}
          </div>
        )}

        {/* Footer */}
        <div className="mt-5 flex items-center justify-between">
          <p className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
            All fields are optional except the mandatory configuration above.
          </p>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="btn-admin-primary"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {threshold ? 'Update targets' : 'Save targets'}
          </button>
        </div>
      </div>

      {/* Current version metadata */}
      {threshold && (
        <div className="bg-white rounded-2xl p-5" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
          <p className="text-[10.5px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--brand-text-muted)' }}>
            Current version
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-[12px]">
            <span style={{ color: 'var(--brand-text-secondary)' }}>
              <span className="font-bold">Set:</span>{' '}
              {new Date(threshold.setAt).toLocaleString()}
            </span>
            <span style={{ color: 'var(--brand-text-secondary)' }}>
              <span className="font-bold">Set by:</span>{' '}
              <span className="font-mono text-[11px]">{threshold.setByProviderId.slice(0, 8)}…</span>
            </span>
            {threshold.replacedAt && (
              <span style={{ color: 'var(--brand-text-muted)' }}>
                Replaced {new Date(threshold.replacedAt).toLocaleString()}
              </span>
            )}
          </div>
          <p className="text-[10.5px] mt-2 inline-flex items-center gap-1" style={{ color: 'var(--brand-text-muted)' }}>
            <AlertTriangle className="w-2.5 h-2.5" />
            Full audit history of edits is in the Timeline tab.
          </p>
        </div>
      )}
    </div>
  );
}

interface PairRowProps {
  title: string;
  unit: string;
  upperLabel: string;
  lowerLabel: string;
  upperValue: string;
  lowerValue: string;
  onUpper: (v: string) => void;
  onLower: (v: string) => void;
  color: string;
}

function PairRow({
  title,
  unit,
  upperLabel,
  lowerLabel,
  upperValue,
  lowerValue,
  onUpper,
  onLower,
  color,
}: PairRowProps) {
  return (
    <div>
      <p className="text-[12.5px] font-bold mb-2" style={{ color }}>
        {title}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <NumberInput label={upperLabel} unit={unit} value={upperValue} onChange={onUpper} />
        <NumberInput label={lowerLabel} unit={unit} value={lowerValue} onChange={onLower} />
      </div>
    </div>
  );
}

function NumberInput({ label, unit, value, onChange }: { label: string; unit: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block text-[10.5px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--brand-text-muted)' }}>
        {label}
      </span>
      <div
        className="flex items-center rounded-lg overflow-hidden"
        style={{ border: '1px solid var(--brand-border)' }}
      >
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="—"
          className="flex-1 px-3 h-9 text-[13px] outline-none bg-transparent"
          style={{ color: 'var(--brand-text-primary)' }}
        />
        <span
          className="px-2.5 h-9 inline-flex items-center text-[11px] font-bold"
          style={{ backgroundColor: 'var(--brand-background)', color: 'var(--brand-text-muted)' }}
        >
          {unit}
        </span>
      </div>
    </label>
  );
}
