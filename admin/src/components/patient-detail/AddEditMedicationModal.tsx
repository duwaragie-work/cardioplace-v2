'use client';

// #92 — admin add / edit medication modal. Clinical roles record a medication
// on a patient's behalf (admin is authoritative → VERIFIED on add, EXCEPT the
// backend ACE/ARB-on-angioedema gate which auto-holds with PROVIDER_DIRECTED_HOLD
// and returns requiresAcknowledgement=true, which we surface here).

import { useState } from 'react';
import {
  adminAddMedication,
  adminEditMedication,
  type AdminMedicationInput,
  type PatientMedication,
} from '@/lib/services/patient-detail.service';

const DRUG_CLASSES: { value: string; label: string }[] = [
  { value: 'ACE_INHIBITOR', label: 'ACE inhibitor' },
  { value: 'ARB', label: 'ARB' },
  { value: 'BETA_BLOCKER', label: 'Beta-blocker' },
  { value: 'DHP_CCB', label: 'Calcium channel blocker (DHP)' },
  { value: 'NDHP_CCB', label: 'Calcium channel blocker (non-DHP)' },
  { value: 'LOOP_DIURETIC', label: 'Loop diuretic' },
  { value: 'THIAZIDE', label: 'Thiazide diuretic' },
  { value: 'MRA', label: 'MRA' },
  { value: 'SGLT2', label: 'SGLT2 inhibitor' },
  { value: 'ANTICOAGULANT', label: 'Anticoagulant' },
  { value: 'STATIN', label: 'Statin' },
  { value: 'ANTIARRHYTHMIC', label: 'Antiarrhythmic' },
  { value: 'VASODILATOR_NITRATE', label: 'Vasodilator / nitrate' },
  { value: 'ARNI', label: 'ARNI' },
  { value: 'NSAID', label: 'NSAID' },
  { value: 'OTHER_UNVERIFIED', label: 'Other' },
];

const FREQUENCIES: { value: string; label: string }[] = [
  { value: 'ONCE_DAILY', label: 'Once daily' },
  { value: 'TWICE_DAILY', label: 'Twice daily' },
  { value: 'THREE_TIMES_DAILY', label: 'Three times daily' },
  { value: 'AS_NEEDED', label: 'As needed (PRN)' },
  { value: 'UNSURE', label: 'Other / unsure' },
];

interface Props {
  patientUserId: string;
  /** When present → edit mode; otherwise add mode. */
  medication?: PatientMedication | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function AddEditMedicationModal({ patientUserId, medication, onClose, onSaved }: Props) {
  const isEdit = !!medication;
  const [drugName, setDrugName] = useState<string>(medication?.drugName ?? '');
  const [drugClass, setDrugClass] = useState<string>(medication?.drugClass ?? 'OTHER_UNVERIFIED');
  const [frequency, setFrequency] = useState<string>(medication?.frequency ?? 'ONCE_DAILY');
  const [dose, setDose] = useState('');
  const [notes, setNotes] = useState<string>(medication?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!drugName.trim()) {
      setError('Drug name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input: AdminMedicationInput = {
        drugName: drugName.trim(),
        drugClass,
        frequency,
        dose: dose.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      const res = isEdit
        ? await adminEditMedication(medication!.id, input)
        : await adminAddMedication(patientUserId, input);
      if (res.requiresAcknowledgement) {
        // ACE/ARB on an angioedema-flagged patient — the backend placed it on
        // Provider Directed Hold. Surface that explicitly before closing.
        window.alert(
          'This patient has a documented angioedema contraindication. The medication was saved on Provider Directed Hold (not active) for safety review.',
        );
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save medication.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      role="dialog"
      aria-modal="true"
      data-testid="admin-add-edit-medication-modal"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-5" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
        <h3 className="text-[17px] font-bold mb-3" style={{ color: 'var(--brand-text-primary)' }}>
          {isEdit ? `Edit ${medication!.drugName}` : 'Add medication'}
        </h3>

        {error && (
          <p className="text-[12px] mb-2" style={{ color: 'var(--brand-alert-red-text)' }} data-testid="admin-med-modal-error">
            {error}
          </p>
        )}

        <label className="block text-[12px] font-semibold mb-1">Drug name</label>
        <input
          data-testid="admin-med-drugname"
          value={drugName}
          onChange={(e) => setDrugName(e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-[13.5px] mb-3"
          style={{ border: '1px solid var(--brand-border)' }}
        />

        <label className="block text-[12px] font-semibold mb-1">Drug class</label>
        <select
          data-testid="admin-med-drugclass"
          value={drugClass}
          onChange={(e) => setDrugClass(e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-[13.5px] mb-3 bg-white"
          style={{ border: '1px solid var(--brand-border)' }}
        >
          {DRUG_CLASSES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>

        <label className="block text-[12px] font-semibold mb-1">Frequency</label>
        <select
          data-testid="admin-med-frequency"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-[13.5px] mb-3 bg-white"
          style={{ border: '1px solid var(--brand-border)' }}
        >
          {FREQUENCIES.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>

        <label className="block text-[12px] font-semibold mb-1">Dose (optional)</label>
        <input
          data-testid="admin-med-dose"
          value={dose}
          onChange={(e) => setDose(e.target.value)}
          placeholder="e.g. 25 mg"
          className="w-full rounded-lg px-3 py-2 text-[13.5px] mb-3"
          style={{ border: '1px solid var(--brand-border)' }}
        />

        <label className="block text-[12px] font-semibold mb-1">Notes (optional)</label>
        <textarea
          data-testid="admin-med-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          rows={3}
          className="w-full rounded-lg px-3 py-2 text-[13.5px] mb-4"
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
            Cancel
          </button>
          <button
            type="button"
            data-testid="admin-med-save"
            onClick={handleSave}
            disabled={saving}
            className="px-4 h-10 rounded-full text-[13px] font-bold text-white cursor-pointer"
            style={{ backgroundColor: 'var(--brand-primary-purple)' }}
          >
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add medication'}
          </button>
        </div>
      </div>
    </div>
  );
}
