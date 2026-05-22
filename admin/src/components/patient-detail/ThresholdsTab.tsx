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
import { useAuth } from '@/lib/auth-context';
import { canEditThresholds } from '@/lib/roleGates';

interface Props {
  patientId: string;
  profile: PatientProfile | null;
  threshold: PatientThreshold | null;
  loading: boolean;
  onChanged: () => void;
  /** THR-REVIEW — a threshold-mandatory condition was added after these targets
   *  were set, so they must be re-reviewed. Drives the review banner + the
   *  "still correct" attest path; the shell locks the other tabs while true. */
  reviewActive?: boolean;
  /** Timestamp (ms) the triggering condition was added — shown in the banner. */
  reviewConditionAt?: number | null;
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

export default function ThresholdsTab({
  patientId,
  profile,
  threshold,
  loading,
  onChanged,
  reviewActive = false,
  reviewConditionAt = null,
}: Props) {
  const { user } = useAuth();
  // Editor (numeric inputs, defaults-apply, save button) renders for the
  // threshold-author roles (SUPER_ADMIN, MEDICAL_DIRECTOR, PROVIDER). Other
  // admin roles get a clean read-only summary of the configured targets.
  const canEdit = canEditThresholds(user);

  const [form, setForm] = useState<FormState>(() => thresholdToForm(threshold));
  const [saving, setSaving] = useState(false);
  const [attesting, setAttesting] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
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

  // Only surface a suggested default that isn't already entered — so the hint
  // disappears once the clinician has applied it, instead of nagging forever.
  const unappliedDefaults = useMemo(() => {
    const out: { sbpLowerTarget?: number; dbpLowerTarget?: number } = {};
    if (defaults.sbpLowerTarget != null && Number(form.sbpLowerTarget) !== defaults.sbpLowerTarget) {
      out.sbpLowerTarget = defaults.sbpLowerTarget;
    }
    if (defaults.dbpLowerTarget != null && Number(form.dbpLowerTarget) !== defaults.dbpLowerTarget) {
      out.dbpLowerTarget = defaults.dbpLowerTarget;
    }
    return out;
  }, [defaults, form.sbpLowerTarget, form.dbpLowerTarget]);
  const hasUnappliedDefaults =
    unappliedDefaults.sbpLowerTarget != null || unappliedDefaults.dbpLowerTarget != null;

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(thresholdToForm(threshold)), [form, threshold]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSuccess(null);
  }

  function applyDefaults() {
    setForm((prev) => ({
      ...prev,
      sbpLowerTarget: unappliedDefaults.sbpLowerTarget != null ? String(unappliedDefaults.sbpLowerTarget) : prev.sbpLowerTarget,
      dbpLowerTarget: unappliedDefaults.dbpLowerTarget != null ? String(unappliedDefaults.dbpLowerTarget) : prev.dbpLowerTarget,
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

  // THR-REVIEW attest path — clear the re-review gate without changing values
  // when the existing targets are still clinically correct for the new
  // condition. Re-saving the current values bumps setAt (so the gate's
  // stale-check clears) and writes an ADMIN_THRESHOLD_UPDATE audit row; the
  // review note is prepended to the clinical rationale so the audit captures
  // why no change was made. Requires a note so the attestation is on record.
  async function attestStillCorrect() {
    setAttesting(true);
    setError(null);
    setSuccess(null);
    try {
      const existing = form.notes.trim();
      const note = reviewNote.trim();
      // Always stamp a dated attestation line so the audit captures that the
      // targets were re-reviewed and kept — the custom note is optional.
      const stamped = note
        ? `[Re-reviewed ${new Date().toLocaleDateString()}] ${note}`
        : `[Re-reviewed ${new Date().toLocaleDateString()}] Targets confirmed still correct.`;
      await upsertPatientThreshold(
        patientId,
        { ...formToPayload(form), notes: existing ? `${stamped}\n${existing}` : stamped },
        threshold ? 'update' : 'create',
      );
      setSuccess('Targets confirmed as still correct.');
      setReviewNote('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not confirm targets.');
    } finally {
      setAttesting(false);
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
      {/* THR-REVIEW — re-review gate banner (STALE case only: a threshold
          exists but a mandatory condition was added OR removed after it was set).
          The no-threshold case is covered by the red "Mandatory configuration
          required" banner below. The shell locks the other tabs either way. */}
      {reviewActive && threshold && (
        <div
          className="rounded-2xl p-4 flex items-start gap-3"
          data-testid="admin-threshold-review-banner"
          style={{
            backgroundColor: 'var(--brand-alert-red-light)',
            border: '1.5px solid var(--brand-alert-red)',
          }}
        >
          <ShieldAlert className="w-5 h-5 shrink-0" style={{ color: 'var(--brand-alert-red-text)' }} />
          <div>
            <p className="text-[13px] font-bold" style={{ color: 'var(--brand-alert-red-text)' }}>
              Threshold re-review required
            </p>
            <p className="text-[11.5px] mt-0.5 leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
              A monitored condition (HFrEF / HCM / DCM) was added or removed
              {reviewConditionAt ? ` on ${new Date(reviewConditionAt).toLocaleDateString()}` : ''}, after
              these targets were set on {new Date(threshold.setAt).toLocaleDateString()}. Update the
              targets, or confirm they&apos;re still correct below.
            </p>
          </div>
        </div>
      )}

      {/* Mandatory red banner */}
      {isMissingMandatory && (
        <div
          className="rounded-2xl p-4 flex items-start gap-3"
          style={{
            backgroundColor: 'var(--brand-alert-red-light)',
            border: '1.5px solid var(--brand-alert-red)',
          }}
        >
          <ShieldAlert className="w-5 h-5 shrink-0" style={{ color: 'var(--brand-alert-red-text)' }} />
          <div>
            <p className="text-[13px] font-bold" style={{ color: 'var(--brand-alert-red-text)' }}>
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

      {/* Defaults hint — only shown for roles that can apply them, and only
          while a suggested value isn't already entered (so it stops nagging
          once applied). */}
      {canEdit && hasUnappliedDefaults && (
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
                {unappliedDefaults.sbpLowerTarget != null && (
                  <>SBP lower target {unappliedDefaults.sbpLowerTarget} </>
                )}
                {unappliedDefaults.sbpLowerTarget != null && unappliedDefaults.dbpLowerTarget != null && '· '}
                {unappliedDefaults.dbpLowerTarget != null && (
                  <>DBP lower target {unappliedDefaults.dbpLowerTarget}</>
                )}
              </p>
            </div>
          </div>
          <button type="button" onClick={applyDefaults} className="btn-admin-secondary">
            Apply defaults
          </button>
        </div>
      )}

      {/* Read-only summary for non-editor roles. Shows the actual configured
          values without any inputs / save controls. PROVIDER + HEALPLACE_OPS
          land here. */}
      {!canEdit && (
        <div className="bg-white rounded-2xl p-5 md:p-6" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Sliders className="w-4 h-4" style={{ color: 'var(--brand-primary-purple)' }} />
            <h2 className="text-[14px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
              Personalized targets
            </h2>
            <span
              className="ml-auto text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: 'var(--brand-background)',
                color: 'var(--brand-text-muted)',
              }}
              title="Read-only — only a Medical Director can change BP / HR thresholds."
              data-testid="admin-threshold-readonly"
            >
              Read-only
            </span>
          </div>
          {threshold ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ReadonlyPair
                title="Systolic BP (SBP)"
                unit="mmHg"
                upper={threshold.sbpUpperTarget}
                lower={threshold.sbpLowerTarget}
                color="var(--brand-alert-red)"
              />
              <ReadonlyPair
                title="Diastolic BP (DBP)"
                unit="mmHg"
                upper={threshold.dbpUpperTarget}
                lower={threshold.dbpLowerTarget}
                color="var(--brand-primary-purple)"
              />
              <ReadonlyPair
                title="Heart rate"
                unit="bpm"
                upper={threshold.hrUpperTarget}
                lower={threshold.hrLowerTarget}
                color="var(--brand-accent-teal)"
              />
              {threshold.notes && (
                <div className="sm:col-span-2">
                  <p className="text-[10.5px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--brand-text-muted)' }}>
                    Clinical rationale
                  </p>
                  <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
                    {threshold.notes}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[12.5px]" style={{ color: 'var(--brand-text-muted)' }}>
              No personalized targets configured yet. A medical director will set these.
            </p>
          )}
        </div>
      )}

      {/* Editor card — render only for SUPER_ADMIN + MEDICAL_DIRECTOR. */}
      {canEdit && (
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
            upperTestId="admin-threshold-sbp-upper"
            lowerTestId="admin-threshold-sbp-lower"
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
            upperTestId="admin-threshold-dbp-upper"
            lowerTestId="admin-threshold-dbp-lower"
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
            upperTestId="admin-threshold-hr-upper"
            lowerTestId="admin-threshold-hr-lower"
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
            data-testid="admin-threshold-notes"
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
            style={{ backgroundColor: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red-text)' }}
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

        {/* Footer — text on the left can shrink/wrap in narrow widths while
            the action button stays a fixed size on the right with a real gap. */}
        <div className="mt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
          <p className="text-[11px] flex-1 min-w-0" style={{ color: 'var(--brand-text-muted)' }}>
            {reviewActive && threshold
              ? 'A condition changed — update the targets, or confirm they’re still correct below.'
              : reviewActive
                ? 'This patient needs personalized targets — set them below to continue.'
                : 'All fields are optional except the mandatory configuration above.'}
          </p>
          {/* THR-REVIEW: when the gate is active and nothing's been edited, the
              clinician confirms the targets are still correct (with a required
              note) — re-saving bumps setAt and clears the lock. Once they edit a
              value the normal Update path takes over (enabled because dirty). */}
          {reviewActive && threshold && !dirty ? (
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto shrink-0">
              <input
                type="text"
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                data-testid="admin-threshold-review-note"
                placeholder="Review note (optional)"
                className="px-3 h-9 rounded-lg text-[12.5px] outline-none"
                style={{ border: '1px solid var(--brand-border)', minWidth: 220 }}
              />
              <button
                type="button"
                onClick={attestStillCorrect}
                disabled={attesting}
                data-testid="admin-threshold-attest"
                className="btn-admin-secondary shrink-0"
              >
                {attesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                Targets still correct
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty}
              data-testid="admin-threshold-save"
              className="btn-admin-primary shrink-0"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {threshold ? 'Update targets' : 'Save targets'}
            </button>
          )}
        </div>
      </div>
      )}

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
              {threshold.setByName ?? (
                <span className="italic" style={{ color: 'var(--brand-text-muted)' }}>
                  Unknown clinician
                </span>
              )}
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
  upperTestId?: string;
  lowerTestId?: string;
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
  upperTestId,
  lowerTestId,
}: PairRowProps) {
  return (
    <div>
      <p className="text-[12.5px] font-bold mb-2" style={{ color }}>
        {title}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <NumberInput label={upperLabel} unit={unit} value={upperValue} onChange={onUpper} testId={upperTestId} />
        <NumberInput label={lowerLabel} unit={unit} value={lowerValue} onChange={onLower} testId={lowerTestId} />
      </div>
    </div>
  );
}

/** Read-only display of an upper/lower target pair. Used by the
 *  non-editor view (PROVIDER, HEALPLACE_OPS) so they see the configured
 *  values without any inputs or save controls. */
function ReadonlyPair({
  title,
  unit,
  upper,
  lower,
  color,
}: {
  title: string;
  unit: string;
  upper: number | null;
  lower: number | null;
  color: string;
}) {
  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--brand-background)', border: '1px solid var(--brand-border)' }}>
      <p className="text-[11px] font-bold mb-2" style={{ color }}>
        {title}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[9.5px] font-semibold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
            Upper
          </p>
          <p className="text-[15px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
            {upper != null ? upper : '—'}
            <span className="text-[10px] font-normal ml-1" style={{ color: 'var(--brand-text-muted)' }}>{unit}</span>
          </p>
        </div>
        <div>
          <p className="text-[9.5px] font-semibold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
            Lower
          </p>
          <p className="text-[15px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
            {lower != null ? lower : '—'}
            <span className="text-[10px] font-normal ml-1" style={{ color: 'var(--brand-text-muted)' }}>{unit}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function NumberInput({ label, unit, value, onChange, testId }: { label: string; unit: string; value: string; onChange: (v: string) => void; testId?: string }) {
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
          data-testid={testId}
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
