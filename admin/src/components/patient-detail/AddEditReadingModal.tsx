'use client';

// Admin reading modal (view / add / edit) + delete confirmation. Care-team
// staff key in a reading on the patient's behalf (clinic-floor visits) or
// correct a transcription error; pressing a reading card opens the same
// modal read-only with an Edit switch. Modeled on AddEditMedicationModal.
//
// Multi-reading session flow (add mode only): after each successful save a
// follow-up screen offers "Add another reading to this session?" — the next
// submit carries the sessionId the backend assigned to reading 1, so the
// engine averages them as one sitting. Caps at 3 readings, then auto-closes.
// Edits do NOT re-trigger the engine (CTO Option C) — the backend only
// updates the row + writes the ADMIN_READING_EDITED audit pair.
//
// Symptom layout mirrors the patient check-in B3 step: core symptom grid,
// a "Pregnancy-specific" group shown only for pregnant patients (or when
// the entry already carries a pregnancy symptom), a chip-style freeform
// other-symptoms input, and NSAID as a medication-use question.

import { useEffect, useState } from 'react';
import { X as XIcon } from 'lucide-react';
import {
  addReading,
  deleteReading,
  editReading,
  type AdminReadingInput,
  type PatientJournalEntry,
  type ReadingSymptoms,
} from '@/lib/services/provider.service';

const MAX_SESSION_READINGS = 3;

const POSITIONS: { value: '' | 'SITTING' | 'STANDING' | 'LYING'; label: string }[] = [
  { value: '', label: 'Not recorded' },
  { value: 'SITTING', label: 'Sitting' },
  { value: 'STANDING', label: 'Standing' },
  { value: 'LYING', label: 'Lying down' },
];

// Mirrors the patient check-in's B3 symptom step: core symptoms, a separate
// "Pregnancy-specific" group, freeform other-symptoms, and NSAID kept OUT of
// the symptom list (it's a medication-use question, same as patient side).
const CORE_SYMPTOMS: { key: keyof ReadingSymptoms; label: string }[] = [
  { key: 'severeHeadache', label: 'Severe headache' },
  { key: 'visualChanges', label: 'Vision changes' },
  { key: 'alteredMentalStatus', label: 'Confusion / altered mental status' },
  { key: 'chestPainOrDyspnea', label: 'Chest pain / trouble breathing' },
  { key: 'focalNeuroDeficit', label: 'Focal neuro deficit' },
  { key: 'severeEpigastricPain', label: 'Severe stomach pain' },
  { key: 'dizziness', label: 'Dizziness' },
  { key: 'syncope', label: 'Fainting (syncope)' },
  { key: 'palpitations', label: 'Palpitations' },
  { key: 'legSwelling', label: 'Leg swelling' },
  { key: 'fatigue', label: 'Fatigue' },
  { key: 'shortnessOfBreath', label: 'Shortness of breath' },
  { key: 'dryCough', label: 'Dry cough' },
  { key: 'faceSwelling', label: 'Face / lip swelling' },
  { key: 'throatTightness', label: 'Throat tightness' },
];

// Preeclampsia signals — own header like the patient check-in, and gated the
// same way: shown only when the patient profile says isPregnant (or the
// entry being viewed/edited already carries one of these as true, so
// historical data stays visible and editable).
const PREGNANCY_SYMPTOMS: { key: keyof ReadingSymptoms; label: string }[] = [
  { key: 'newOnsetHeadache', label: 'New-onset headache' },
  { key: 'ruqPain', label: 'Right-upper-quadrant pain' },
  { key: 'edema', label: 'Edema (swelling)' },
];

const SYMPTOM_OPTIONS = [...CORE_SYMPTOMS, ...PREGNANCY_SYMPTOMS];

// Weight is stored in kg but displayed/entered in lbs (US standard) — same as
// the patient readings edit modal (which is lbs-only; CheckIn Bug 39). These
// mirror frontend src/lib/units.ts EXACTLY (kg→lbs 1 dp, lbs→kg 2 dp) so an
// edited reading round-trips through the identical conversion the patient app
// uses, and the no-op guard sees no spurious drift.
const KG_PER_LB = 0.45359237;
export function kgToLbs(kg: number): number {
  if (!Number.isFinite(kg) || kg <= 0) return 0;
  return Math.round((kg / KG_PER_LB) * 10) / 10;
}
function lbsToKg(lbs: number): number {
  if (!Number.isFinite(lbs) || lbs <= 0) return 0;
  return Math.round(lbs * KG_PER_LB * 100) / 100;
}

// Missed-dose reasons — same enum values the patient check-in submits.
const MISSED_REASONS: { value: string; label: string }[] = [
  { value: 'FORGOT', label: 'Forgot' },
  { value: 'SIDE_EFFECTS', label: 'Side effects' },
  { value: 'RAN_OUT', label: 'Ran out' },
  { value: 'COST', label: 'Cost' },
  { value: 'INTENTIONAL', label: 'Chose not to take it' },
  { value: 'OTHER', label: 'Other' },
];

/** Eligible meds for the adherence question — ReadingsTab pre-filters to the
 *  patient check-in's set (scheduled, not AS_NEEDED, not HOLD/REJECTED/
 *  discontinued). */
export interface ReadingMedication {
  id: string;
  drugName: string;
  drugClass: string;
}

type MedTaken = 'yes' | 'no' | 'scheduledLater' | null;
interface MedAnswer {
  taken: MedTaken;
  reason: string | null;
  missedDoses: number;
}

function drugClassLabel(cls: string): string {
  return cls.replace(/_/g, ' ').toLowerCase();
}

/** ISO → value usable by <input type="datetime-local"> in the viewer's TZ. */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nowLocalInputValue(): string {
  return toLocalInputValue(new Date().toISOString());
}

interface Props {
  patientUserId: string;
  /** When present → edit/view mode; otherwise add mode (with session follow-up). */
  entry?: PatientJournalEntry | null;
  /** Open read-only (card press). The Edit button (when canEdit) switches to
   *  the editable form. */
  viewOnly?: boolean;
  /** Whether the viewer holds a canManageReadings role — gates the Edit
   *  switch in view mode. */
  canEdit?: boolean;
  /** PatientProfile.isPregnant — gates the Pregnancy-specific section, same
   *  rule as the patient check-in. */
  isPregnant?: boolean;
  /** Eligible scheduled medications — drives the per-med "Yes / No / Not due
   *  yet" adherence question, same as the patient check-in step 4. */
  medications?: ReadingMedication[];
  onClose: () => void;
  /** Called after EVERY successful save so the list behind stays fresh. */
  onSaved: () => void;
}

export default function AddEditReadingModal({
  patientUserId,
  entry,
  viewOnly,
  canEdit,
  isPregnant,
  medications = [],
  onClose,
  onSaved,
}: Props) {
  const isEdit = !!entry;
  // View mode is a state, not a prop-only concept — the Edit button flips
  // the same mounted modal into the editable form.
  const [viewing, setViewing] = useState<boolean>(!!viewOnly);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [systolic, setSystolic] = useState<string>(entry?.systolicBP != null ? String(entry.systolicBP) : '');
  const [diastolic, setDiastolic] = useState<string>(entry?.diastolicBP != null ? String(entry.diastolicBP) : '');
  const [pulse, setPulse] = useState<string>(entry?.pulse != null ? String(entry.pulse) : '');
  // Weight is entered/shown in lbs (US standard); stored kg is converted to
  // lbs on load, back to kg on save — matching the patient readings edit modal.
  const [weight, setWeight] = useState<string>(
    entry?.weight != null ? String(kgToLbs(entry.weight)) : '',
  );
  const [position, setPosition] = useState<string>(entry?.position ?? '');
  const [nsaidUse, setNsaidUse] = useState<boolean>(
    (entry as unknown as Record<string, unknown> | null | undefined)?.nsaidUse === true,
  );
  // Chip-style freeform symptoms, one per chip — mirrors the patient
  // check-in's SymptomTagInput rather than a comma-separated field.
  const [otherSymptoms, setOtherSymptoms] = useState<string[]>(entry?.otherSymptoms ?? []);
  const [symptomDraft, setSymptomDraft] = useState('');
  const [measuredAt, setMeasuredAt] = useState<string>(
    entry ? toLocalInputValue(entry.measuredAt) : nowLocalInputValue(),
  );
  const [notes, setNotes] = useState<string>(entry?.notes ?? '');
  const [symptoms, setSymptoms] = useState<Set<keyof ReadingSymptoms>>(() => {
    const s = new Set<keyof ReadingSymptoms>();
    if (entry) {
      for (const { key } of SYMPTOM_OPTIONS) {
        if ((entry as unknown as Record<string, unknown>)[key] === true) s.add(key);
      }
    }
    return s;
  });

  // Per-med adherence answers (Yes / No / Not due yet). Edit/view mode
  // rebuilds each med's exact answer from entry.medicationStatuses — the
  // snapshot the patient app writes for the same purpose. Unmatched or
  // legacy entries start unanswered.
  const [medStatus, setMedStatus] = useState<Record<string, MedAnswer>>(() => {
    const out: Record<string, MedAnswer> = {};
    const statuses = (entry as unknown as { medicationStatuses?: unknown } | null | undefined)
      ?.medicationStatuses;
    if (Array.isArray(statuses)) {
      for (const raw of statuses) {
        if (!raw || typeof raw !== 'object') continue;
        const s = raw as Record<string, unknown>;
        if (typeof s.medicationId !== 'string') continue;
        out[s.medicationId] = {
          taken:
            s.taken === 'yes' || s.taken === 'no' || s.taken === 'scheduledLater'
              ? s.taken
              : null,
          reason: typeof s.reason === 'string' ? s.reason : null,
          missedDoses: typeof s.missedDoses === 'number' ? s.missedDoses : 1,
        };
      }
    }
    return out;
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Session follow-up state (add mode only).
  const [savedCount, setSavedCount] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [screen, setScreen] = useState<'form' | 'followup'>('form');

  // Pregnancy section gating — patient-check-in parity: profile.isPregnant
  // drives it; an entry that already carries a pregnancy symptom keeps the
  // section visible so the stored values aren't hidden or uneditable.
  const showPregnancy =
    isPregnant === true ||
    (entry != null &&
      PREGNANCY_SYMPTOMS.some(
        ({ key }) => (entry as unknown as Record<string, unknown>)[key] === true,
      ));

  // No-op edit guard — snapshot of the form at first render (initial values
  // derive from `entry`); "Save changes" without an actual change is
  // rejected client-side before any API call.
  function formSnapshot(): string {
    return JSON.stringify({
      systolic,
      diastolic,
      pulse,
      weight,
      position,
      measuredAt,
      notes,
      nsaidUse,
      symptoms: [...symptoms].sort(),
      otherSymptoms: [...otherSymptoms],
      medStatus,
    });
  }
  const [initialSnapshot] = useState(formSnapshot);

  const getMedAnswer = (medId: string): MedAnswer =>
    medStatus[medId] ?? { taken: null, reason: null, missedDoses: 1 };

  function setMedTaken(medId: string, value: Exclude<MedTaken, null>) {
    setMedStatus((prev) => {
      const current = prev[medId] ?? { taken: null, reason: null, missedDoses: 1 };
      // Flipping back to "yes" / "not due yet" clears any captured miss
      // detail so a stale reason doesn't leak into the payload (patient-app
      // parity, CheckIn.tsx setTaken).
      const next: MedAnswer =
        value === 'no'
          ? { ...current, taken: 'no' }
          : { taken: value, reason: null, missedDoses: 1 };
      return { ...prev, [medId]: next };
    });
  }

  function patchMedAnswer(medId: string, patch: Partial<MedAnswer>) {
    setMedStatus((prev) => ({
      ...prev,
      [medId]: { ...(prev[medId] ?? { taken: null, reason: null, missedDoses: 1 }), ...patch },
    }));
  }

  function toggleSymptom(key: keyof ReadingSymptoms) {
    setSymptoms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function addOtherSymptom() {
    const v = symptomDraft.trim();
    if (!v) return;
    setOtherSymptoms((prev) =>
      prev.some((s) => s.toLowerCase() === v.toLowerCase()) ? prev : [...prev, v],
    );
    setSymptomDraft('');
  }

  function removeOtherSymptom(idx: number) {
    setOtherSymptoms((prev) => prev.filter((_, i) => i !== idx));
  }

  function buildPayload(): AdminReadingInput | null {
    const sbp = parseInt(systolic, 10);
    const dbp = parseInt(diastolic, 10);
    if (!Number.isFinite(sbp) || !Number.isFinite(dbp)) {
      setError('Systolic and diastolic blood pressure are required.');
      return null;
    }
    if (dbp >= sbp) {
      // Mirror of the backend implausible-reading gate so the staff member
      // gets instant feedback instead of a 422 round-trip.
      setError('The bottom number must be lower than the top number — check for a transposed reading.');
      return null;
    }
    if (!measuredAt) {
      setError('Measurement date and time are required.');
      return null;
    }
    let weightKg: number | null = null;
    if (weight.trim() !== '') {
      const w = parseFloat(weight);
      if (!Number.isFinite(w) || w <= 0) {
        setError('Weight must be a number in pounds (or leave it blank).');
        return null;
      }
      weightKg = lbsToKg(w);
    }
    const payload: AdminReadingInput = {
      measuredAt: new Date(measuredAt).toISOString(),
      systolicBP: sbp,
      diastolicBP: dbp,
      pulse: pulse.trim() !== '' ? parseInt(pulse, 10) : null,
      weight: weightKg,
      position: (position || null) as AdminReadingInput['position'],
      otherSymptoms: [...otherSymptoms],
      notes: notes.trim() || null,
    };
    for (const { key } of SYMPTOM_OPTIONS) payload[key] = symptoms.has(key);
    payload.nsaidUse = nsaidUse;
    if (!isEdit && sessionId) payload.sessionId = sessionId;

    // Medication adherence rollup — same derivation as the patient check-in
    // (CheckIn.tsx handleSubmit): scheduledLater answers count as "answered"
    // but are excluded from the took/missed signal.
    if (medications.length > 0) {
      const medEntries = medications.map((m) => ({ med: m, state: getMedAnswer(m.id) }));
      const answered = medEntries.filter((e) => e.state.taken !== null);
      if (answered.length > 0) {
        const allAnswered = answered.length === medEntries.length;
        const anyMissed = medEntries.some((e) => e.state.taken === 'no');
        const anyExplicitYesNo = medEntries.some(
          (e) => e.state.taken === 'yes' || e.state.taken === 'no',
        );
        // On edit, a signal-less answer set must CLEAR a previously stored
        // rollup (null), not silently keep it (undefined would skip the
        // field in the PATCH-style backend update).
        payload.medicationTaken =
          !allAnswered || !anyExplicitYesNo ? (isEdit ? null : undefined) : !anyMissed;
        payload.medicationScheduledLater = medEntries.some(
          (e) => e.state.taken === 'scheduledLater',
        );
        const missed = medEntries
          .filter((e) => e.state.taken === 'no' && e.state.reason !== null)
          .map((e) => ({
            medicationId: e.med.id,
            drugName: e.med.drugName,
            drugClass: e.med.drugClass,
            reason: e.state.reason as string,
            missedDoses: e.state.missedDoses,
          }));
        payload.missedMedications = isEdit || missed.length > 0 ? missed : undefined;
        payload.medicationStatuses = answered.map((e) => ({
          medicationId: e.med.id,
          drugName: e.med.drugName,
          drugClass: e.med.drugClass,
          taken: e.state.taken as 'yes' | 'no' | 'scheduledLater',
          ...(e.state.taken === 'no' && e.state.reason ? { reason: e.state.reason } : {}),
          ...(e.state.taken === 'no' ? { missedDoses: e.state.missedDoses } : {}),
        }));
      }
    }
    return payload;
  }

  async function handleSave() {
    if (isEdit && formSnapshot() === initialSnapshot) {
      setError('No changes to save — update a field first, or Cancel.');
      return;
    }
    const payload = buildPayload();
    if (!payload) return;
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await editReading(patientUserId, entry!.id, payload);
        onSaved();
        onClose();
        return;
      }
      const saved = await addReading(patientUserId, payload);
      const count = savedCount + 1;
      setSavedCount(count);
      onSaved();
      if (count >= MAX_SESSION_READINGS) {
        onClose();
        return;
      }
      setSessionId(saved.sessionId ?? null);
      setScreen('followup');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save reading.');
    } finally {
      setSaving(false);
    }
  }

  function handleAddAnother() {
    // Fresh vitals for the next cuff reading; the carried sessionId groups it
    // into the same averaged session. Position tends to stay the same within
    // one sitting, so it's kept.
    setSystolic('');
    setDiastolic('');
    setPulse('');
    setWeight('');
    setSymptoms(new Set());
    setNsaidUse(false);
    setOtherSymptoms([]);
    setSymptomDraft('');
    setMedStatus({});
    setNotes('');
    setMeasuredAt(nowLocalInputValue());
    setError(null);
    setScreen('form');
  }

  const disabled = viewing;
  const title = viewing
    ? 'Reading details'
    : isEdit
      ? 'Edit reading'
      : savedCount > 0
        ? `Add reading ${savedCount + 1} to this session`
        : 'Add reading';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-reading-modal-title"
      data-testid="admin-add-edit-reading-modal"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 max-h-[90vh] overflow-y-auto"
        style={{ boxShadow: 'var(--brand-shadow-card)' }}
      >
        {screen === 'followup' ? (
          <div data-testid="admin-reading-followup">
            <h3 id="admin-reading-modal-title" className="text-[17px] font-bold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
              Reading {savedCount} saved
            </h3>
            <p className="text-[13px] mb-4" style={{ color: 'var(--brand-text-secondary)' }}>
              Add another reading to this session? Readings entered together are
              averaged as one sitting ({savedCount} of {MAX_SESSION_READINGS} so far).
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                data-testid="admin-reading-done"
                onClick={onClose}
                className="px-4 h-10 rounded-full text-[13px] font-semibold cursor-pointer"
                style={{ border: '1px solid var(--brand-border)', color: 'var(--brand-text-secondary)' }}
              >
                Done
              </button>
              <button
                type="button"
                data-testid="admin-reading-add-another"
                onClick={handleAddAnother}
                className="px-4 h-10 rounded-full text-[13px] font-bold text-white cursor-pointer"
                style={{ backgroundColor: 'var(--brand-primary-purple)' }}
              >
                Add another
              </button>
            </div>
          </div>
        ) : (
          <>
            <h3 id="admin-reading-modal-title" className="text-[17px] font-bold mb-3" style={{ color: 'var(--brand-text-primary)' }}>
              {title}
            </h3>

            {error && (
              <p className="text-[12px] mb-2" style={{ color: 'var(--brand-alert-red-text)' }} data-testid="admin-reading-modal-error">
                {error}
              </p>
            )}

            <div className="flex gap-3 mb-3">
              <div className="flex-1">
                <label htmlFor="admin-reading-systolic" className="block text-[12px] font-semibold mb-1">Systolic (top)</label>
                <input
                  id="admin-reading-systolic"
                  data-testid="admin-reading-systolic"
                  type="number"
                  inputMode="numeric"
                  value={systolic}
                  onChange={(e) => setSystolic(e.target.value)}
                  placeholder="e.g. 140"
                  disabled={disabled}
                  className="w-full rounded-lg px-3 py-2 text-[13.5px] disabled:bg-gray-50"
                  style={{ border: '1px solid var(--brand-border)' }}
                />
              </div>
              <div className="flex-1">
                <label htmlFor="admin-reading-diastolic" className="block text-[12px] font-semibold mb-1">Diastolic (bottom)</label>
                <input
                  id="admin-reading-diastolic"
                  data-testid="admin-reading-diastolic"
                  type="number"
                  inputMode="numeric"
                  value={diastolic}
                  onChange={(e) => setDiastolic(e.target.value)}
                  placeholder="e.g. 90"
                  disabled={disabled}
                  className="w-full rounded-lg px-3 py-2 text-[13.5px] disabled:bg-gray-50"
                  style={{ border: '1px solid var(--brand-border)' }}
                />
              </div>
              <div className="flex-1">
                <label htmlFor="admin-reading-pulse" className="block text-[12px] font-semibold mb-1">Pulse (optional)</label>
                <input
                  id="admin-reading-pulse"
                  data-testid="admin-reading-pulse"
                  type="number"
                  inputMode="numeric"
                  value={pulse}
                  onChange={(e) => setPulse(e.target.value)}
                  placeholder="bpm"
                  disabled={disabled}
                  className="w-full rounded-lg px-3 py-2 text-[13.5px] disabled:bg-gray-50"
                  style={{ border: '1px solid var(--brand-border)' }}
                />
              </div>
            </div>

            <label htmlFor="admin-reading-weight" className="block text-[12px] font-semibold mb-1">Weight in lbs (optional)</label>
            <input
              id="admin-reading-weight"
              data-testid="admin-reading-weight"
              type="number"
              inputMode="decimal"
              step="0.1"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="e.g. 150"
              disabled={disabled}
              className="w-full rounded-lg px-3 py-2 text-[13.5px] mb-3 disabled:bg-gray-50"
              style={{ border: '1px solid var(--brand-border)' }}
            />

            <label htmlFor="admin-reading-measured-at" className="block text-[12px] font-semibold mb-1">Measured at</label>
            <input
              id="admin-reading-measured-at"
              data-testid="admin-reading-measured-at"
              type="datetime-local"
              value={measuredAt}
              onChange={(e) => setMeasuredAt(e.target.value)}
              disabled={disabled}
              className="w-full rounded-lg px-3 py-2 text-[13.5px] mb-3 disabled:bg-gray-50"
              style={{ border: '1px solid var(--brand-border)' }}
            />

            <label htmlFor="admin-reading-position" className="block text-[12px] font-semibold mb-1">Position</label>
            <select
              id="admin-reading-position"
              data-testid="admin-reading-position"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              disabled={disabled}
              className="w-full rounded-lg px-3 py-2 text-[13.5px] mb-3 bg-white disabled:bg-gray-50"
              style={{ border: '1px solid var(--brand-border)' }}
            >
              {POSITIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>

            {medications.length > 0 && (
              <>
                <span className="block text-[12px] font-semibold mb-1">
                  Medications — taken today?
                </span>
                <div className="space-y-2 mb-3">
                  {medications.map((med) => {
                    const answer = getMedAnswer(med.id);
                    const missed = answer.taken === 'no';
                    return (
                      <div
                        key={med.id}
                        data-testid={`admin-reading-med-${med.id}`}
                        className="rounded-xl px-3 py-2.5"
                        style={{
                          border: `1.5px solid ${
                            missed
                              ? 'var(--brand-warning-amber)'
                              : answer.taken === 'yes'
                                ? 'var(--brand-success-green)'
                                : 'var(--brand-border)'
                          }`,
                          backgroundColor: missed
                            ? 'var(--brand-warning-amber-light)'
                            : answer.taken === 'yes'
                              ? 'var(--brand-success-green-light)'
                              : 'white',
                        }}
                      >
                        <p className="text-[13px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                          {med.drugName}
                        </p>
                        <p className="text-[11px] mb-2" style={{ color: 'var(--brand-text-muted)' }}>
                          {drugClassLabel(med.drugClass)}
                        </p>
                        <div className="grid grid-cols-3 gap-1.5">
                          {([
                            ['yes', 'Yes', 'var(--brand-success-green)'],
                            ['no', 'No', 'var(--brand-warning-amber)'],
                            ['scheduledLater', 'Not due yet', 'var(--brand-primary-purple)'],
                          ] as [Exclude<MedTaken, null>, string, string][]).map(([value, label, accent]) => {
                            const active = answer.taken === value;
                            return (
                              <button
                                key={value}
                                type="button"
                                data-testid={`admin-reading-med-${med.id}-${value}`}
                                onClick={() => setMedTaken(med.id, value)}
                                disabled={disabled}
                                className="h-8 rounded-lg text-[11.5px] font-semibold border transition-all cursor-pointer"
                                style={{
                                  backgroundColor: active ? accent : 'white',
                                  borderColor: active ? accent : 'var(--brand-border)',
                                  color: active ? 'white' : 'var(--brand-text-secondary)',
                                }}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                        {missed && (
                          <div className="mt-2 flex gap-2">
                            <select
                              aria-label={`Why was ${med.drugName} missed?`}
                              data-testid={`admin-reading-med-${med.id}-reason`}
                              value={answer.reason ?? ''}
                              onChange={(e) =>
                                patchMedAnswer(med.id, { reason: e.target.value || null })
                              }
                              disabled={disabled}
                              className="flex-1 rounded-lg px-2 py-1.5 text-[12px] bg-white disabled:bg-gray-50"
                              style={{ border: '1px solid var(--brand-border)' }}
                            >
                              <option value="">Why missed?</option>
                              {MISSED_REASONS.map((r) => (
                                <option key={r.value} value={r.value}>{r.label}</option>
                              ))}
                            </select>
                            <input
                              aria-label={`Missed doses of ${med.drugName}`}
                              data-testid={`admin-reading-med-${med.id}-doses`}
                              type="number"
                              min={1}
                              max={10}
                              value={answer.missedDoses}
                              onChange={(e) =>
                                patchMedAnswer(med.id, {
                                  missedDoses: Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1)),
                                })
                              }
                              disabled={disabled}
                              className="w-20 rounded-lg px-2 py-1.5 text-[12px] disabled:bg-gray-50"
                              style={{ border: '1px solid var(--brand-border)' }}
                              title="Missed doses"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <span className="block text-[12px] font-semibold mb-1">Symptoms reported</span>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mb-3">
              {CORE_SYMPTOMS.map(({ key, label }) => (
                <label key={key} className="inline-flex items-start gap-1.5 text-[12px] cursor-pointer" style={{ color: 'var(--brand-text-secondary)' }}>
                  <input
                    type="checkbox"
                    data-testid={`admin-reading-symptom-${key}`}
                    checked={symptoms.has(key)}
                    onChange={() => toggleSymptom(key)}
                    disabled={disabled}
                    className="mt-0.5 cursor-pointer"
                  />
                  {label}
                </label>
              ))}
            </div>

            {showPregnancy && (
              <>
                <span
                  className="block text-[11px] font-bold uppercase tracking-wider mb-1"
                  data-testid="admin-reading-pregnancy-header"
                  style={{ color: 'var(--brand-primary-purple)' }}
                >
                  Pregnancy-specific
                </span>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mb-3">
                  {PREGNANCY_SYMPTOMS.map(({ key, label }) => (
                    <label key={key} className="inline-flex items-start gap-1.5 text-[12px] cursor-pointer" style={{ color: 'var(--brand-text-secondary)' }}>
                      <input
                        type="checkbox"
                        data-testid={`admin-reading-symptom-${key}`}
                        checked={symptoms.has(key)}
                        onChange={() => toggleSymptom(key)}
                        disabled={disabled}
                        className="mt-0.5 cursor-pointer"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </>
            )}

            <label htmlFor="admin-reading-other-symptoms" className="block text-[12px] font-semibold mb-1">
              Any other symptoms? (optional)
            </label>
            {!viewing && (
              <div className="flex gap-2 mb-2">
                <input
                  id="admin-reading-other-symptoms"
                  data-testid="admin-reading-other-symptoms"
                  value={symptomDraft}
                  onChange={(e) => setSymptomDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addOtherSymptom();
                    }
                  }}
                  placeholder="In your own words…"
                  className="flex-1 rounded-lg px-3 py-2 text-[13.5px]"
                  style={{ border: '1px solid var(--brand-border)' }}
                />
                <button
                  type="button"
                  data-testid="admin-reading-other-symptoms-add"
                  onClick={addOtherSymptom}
                  className="px-3 h-9 self-center rounded-full text-[12px] font-semibold cursor-pointer"
                  style={{ border: '1px solid var(--brand-border)', color: 'var(--brand-text-secondary)' }}
                >
                  Add
                </button>
              </div>
            )}
            {otherSymptoms.length > 0 && (
              <div className="flex flex-col gap-1.5 mb-3" data-testid="admin-reading-other-symptoms-list">
                {otherSymptoms.map((s, idx) => (
                  <span
                    key={`${s}-${idx}`}
                    className="inline-flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-[12.5px]"
                    style={{ backgroundColor: 'var(--brand-background)', color: 'var(--brand-text-primary)' }}
                  >
                    {s}
                    {!viewing && (
                      <button
                        type="button"
                        aria-label={`Remove ${s}`}
                        data-testid={`admin-reading-other-symptom-remove-${idx}`}
                        onClick={() => removeOtherSymptom(idx)}
                        className="cursor-pointer"
                        style={{ color: 'var(--brand-text-muted)' }}
                      >
                        <XIcon className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}

            {/* NSAID is a medication-use question, not a symptom — kept out of
                the symptom grids to mirror the patient check-in (A.3 NSAID +
                antihypertensive interaction input). */}
            <label className="inline-flex items-start gap-1.5 text-[12px] cursor-pointer mb-3" style={{ color: 'var(--brand-text-secondary)' }}>
              <input
                type="checkbox"
                data-testid="admin-reading-nsaid"
                checked={nsaidUse}
                onChange={() => setNsaidUse((v) => !v)}
                disabled={disabled}
                className="mt-0.5 cursor-pointer"
              />
              Took an NSAID recently (e.g. ibuprofen, naproxen)
            </label>

            <label htmlFor="admin-reading-notes" className="block text-[12px] font-semibold mb-1">Notes (optional)</label>
            <textarea
              id="admin-reading-notes"
              data-testid="admin-reading-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              rows={2}
              disabled={disabled}
              className="w-full rounded-lg px-3 py-2 text-[13.5px] mb-4 disabled:bg-gray-50"
              style={{ border: '1px solid var(--brand-border)' }}
            />

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="px-4 h-10 rounded-full text-[13px] font-semibold cursor-pointer"
                style={{ border: '1px solid var(--brand-border)', color: 'var(--brand-text-secondary)' }}
              >
                {viewing ? 'Close' : 'Cancel'}
              </button>
              {viewing ? (
                canEdit && (
                  <button
                    type="button"
                    data-testid="admin-reading-edit-switch"
                    onClick={() => setViewing(false)}
                    className="px-4 h-10 rounded-full text-[13px] font-bold text-white cursor-pointer"
                    style={{ backgroundColor: 'var(--brand-primary-purple)' }}
                  >
                    Edit reading
                  </button>
                )
              ) : (
                <button
                  type="button"
                  data-testid="admin-reading-save"
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 h-10 rounded-full text-[13px] font-bold text-white cursor-pointer"
                  style={{ backgroundColor: 'var(--brand-primary-purple)' }}
                >
                  {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save reading'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Delete confirmation ──────────────────────────────────────────────────────

interface DeleteProps {
  patientUserId: string;
  entry: PatientJournalEntry;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteReadingDialog({ patientUserId, entry, onClose, onDeleted }: DeleteProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const when = new Date(entry.measuredAt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deleteReading(patientUserId, entry.id);
      onDeleted();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete reading.');
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-reading-delete-title"
      data-testid="admin-delete-reading-dialog"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-5" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
        <h3 id="admin-reading-delete-title" className="text-[16px] font-bold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
          Delete reading from {when}?
        </h3>
        <p className="text-[13px] mb-4" style={{ color: 'var(--brand-text-secondary)' }}>
          {entry.systolicBP != null && entry.diastolicBP != null
            ? `${entry.systolicBP}/${entry.diastolicBP} mmHg — this cannot be undone. `
            : 'This cannot be undone. '}
          The deletion is recorded in the audit trail.
        </p>

        {error && (
          <p className="text-[12px] mb-2" style={{ color: 'var(--brand-alert-red-text)' }} data-testid="admin-reading-delete-error">
            {error}
          </p>
        )}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="px-4 h-10 rounded-full text-[13px] font-semibold cursor-pointer"
            style={{ border: '1px solid var(--brand-border)', color: 'var(--brand-text-secondary)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="admin-reading-delete-confirm"
            onClick={handleDelete}
            disabled={deleting}
            className="px-4 h-10 rounded-full text-[13px] font-bold text-white cursor-pointer"
            style={{ backgroundColor: 'var(--brand-alert-red)' }}
          >
            {deleting ? 'Deleting…' : 'Delete reading'}
          </button>
        </div>
      </div>
    </div>
  );
}
