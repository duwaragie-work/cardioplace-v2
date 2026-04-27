'use client';

// Flow H2 — Medication reconciliation tab.
//
// Layout: side-by-side cards.
//   Left  — patient-reported (PATIENT_SELF_REPORT / PATIENT_VOICE / PATIENT_PHOTO)
//   Right — provider-verified / prescribed (PROVIDER_ENTERED + admin-verified)
//   Status pill in the middle: ✅ Matched / ⚠️ Discrepancy / 🔵 Unverified
//
// Per-row "Action required" dropdown lets the admin verify, reject, or mark
// awaiting-provider — same backend endpoint as the patient intake flow.

import { useMemo, useState } from 'react';
import {
  Check,
  X as XIcon,
  Clock as ClockIcon,
  Loader2,
  Pill,
  AlertTriangle,
} from 'lucide-react';
import {
  verifyMedication,
  type PatientMedication,
  type MedicationVerificationStatus,
} from '@/lib/services/patient-detail.service';
import { useAuth } from '@/lib/auth-context';
import { canVerifyMedications } from '@/lib/roleGates';

interface Props {
  medications: PatientMedication[];
  loading: boolean;
  onChanged: () => void;
}

type ReconStatus = 'MATCHED' | 'DISCREPANCY' | 'UNVERIFIED' | 'DISCONTINUED' | 'REJECTED';

interface ReconRow {
  drugClassKey: string;
  drugClassLabel: string;
  patientReported: PatientMedication[];
  providerEntered: PatientMedication[];
  status: ReconStatus;
}

const DRUG_CLASS_LABELS: Record<string, string> = {
  ACE_INHIBITOR: 'ACE inhibitor',
  ARB: 'ARB',
  BETA_BLOCKER: 'Beta-blocker',
  DHP_CCB: 'DHP calcium channel blocker',
  NDHP_CCB: 'Non-DHP calcium channel blocker',
  LOOP_DIURETIC: 'Loop diuretic',
  THIAZIDE: 'Thiazide',
  MRA: 'MRA',
  SGLT2: 'SGLT2 inhibitor',
  ANTICOAGULANT: 'Anticoagulant',
  STATIN: 'Statin',
  ANTIARRHYTHMIC: 'Antiarrhythmic',
  VASODILATOR_NITRATE: 'Vasodilator / Nitrate',
  ARNI: 'ARNI',
  OTHER_UNVERIFIED: 'Other / unverified',
};

const FREQ_LABELS: Record<string, string> = {
  ONCE_DAILY: 'Once daily',
  TWICE_DAILY: 'Twice daily',
  THREE_TIMES_DAILY: '3× daily',
  UNSURE: 'Unsure',
};

function isPatientSourced(m: PatientMedication): boolean {
  return m.source !== 'PROVIDER_ENTERED';
}

export default function MedicationsTab({ medications, loading, onChanged }: Props) {
  const { user } = useAuth();
  // Verify / reject / hold buttons render only for the clinical-verifier
  // roles (SUPER_ADMIN, PROVIDER, MEDICAL_DIRECTOR). HEALPLACE_OPS sees
  // the same medication cards but no action buttons.
  const canVerify = canVerifyMedications(user);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Group by drugClass and split patient-reported vs provider-entered.
  const rows: ReconRow[] = useMemo(() => {
    const groups = new Map<string, PatientMedication[]>();
    for (const m of medications) {
      const arr = groups.get(m.drugClass) ?? [];
      arr.push(m);
      groups.set(m.drugClass, arr);
    }
    return Array.from(groups.entries()).map(([drugClass, meds]) => {
      const patientReported = meds.filter(isPatientSourced);
      const providerEntered = meds.filter((m) => !isPatientSourced(m));
      const allDiscontinued = meds.every((m) => m.discontinuedAt != null);
      const anyRejected = meds.some((m) => m.verificationStatus === 'REJECTED');
      let status: ReconStatus;
      if (allDiscontinued) status = 'DISCONTINUED';
      else if (anyRejected) status = 'REJECTED';
      else if (providerEntered.length > 0 && patientReported.length > 0) status = 'MATCHED';
      else if (providerEntered.length > 0 && patientReported.length === 0) status = 'DISCREPANCY';
      else if (patientReported.length > 0 && providerEntered.length === 0) status = 'DISCREPANCY';
      else status = 'UNVERIFIED';
      // Within MATCHED, downgrade to DISCREPANCY if frequencies don't align.
      if (status === 'MATCHED') {
        const freqs = new Set(meds.map((m) => m.frequency));
        if (freqs.size > 1) status = 'DISCREPANCY';
      }
      return {
        drugClassKey: drugClass,
        drugClassLabel: DRUG_CLASS_LABELS[drugClass] ?? drugClass,
        patientReported,
        providerEntered,
        status,
      };
    });
  }, [medications]);

  async function setMedicationStatus(med: PatientMedication, status: MedicationVerificationStatus) {
    // No-op when the chosen status already matches — prevents accidental
    // duplicate timeline entries from a second click on the active button.
    if (med.verificationStatus === status) return;
    setSavingId(med.id);
    setError(null);
    try {
      await verifyMedication(med.id, status as 'VERIFIED' | 'REJECTED' | 'AWAITING_PROVIDER');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update medication.');
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl p-6 animate-pulse" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
        <div className="h-4 w-48 rounded-full mb-4" style={{ backgroundColor: '#EDE9F6' }} />
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 rounded-xl" style={{ backgroundColor: '#F3EEFB' }} />
          ))}
        </div>
      </div>
    );
  }

  if (medications.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
        <Pill className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--brand-text-muted)' }} />
        <p className="text-[14px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
          No medications on file
        </p>
        <p className="text-[12px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
          The patient hasn&apos;t reported any medications yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div
          className="rounded-lg px-4 py-2.5 text-[12.5px] font-semibold"
          style={{ backgroundColor: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red)' }}
        >
          {error}
        </div>
      )}

      {rows.map((row) => {
        const chrome = statusChrome(row.status);
        return (
          <div key={row.drugClassKey} className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
            {/* Row header */}
            <div className="px-5 py-3 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--brand-border)' }}>
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-white"
                  style={{ backgroundColor: chrome.color }}
                  aria-hidden
                >
                  {chrome.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-bold truncate" style={{ color: 'var(--brand-text-primary)' }}>
                    {row.drugClassLabel}
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
                    {row.patientReported.length} patient-reported · {row.providerEntered.length} provider-verified
                  </p>
                </div>
              </div>
              <span
                className="inline-flex items-center gap-1 text-[10.5px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0"
                style={{ backgroundColor: chrome.bg, color: chrome.color }}
              >
                {chrome.icon}
                {chrome.label}
              </span>
            </div>

            {/* Side-by-side body */}
            <div className="grid grid-cols-1 md:grid-cols-2">
              {/* Left: patient-reported */}
              <div
                className="p-4 md:p-5"
                style={{
                  borderRight: '1px solid var(--brand-border)',
                }}
              >
                <p className="text-[10px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--brand-text-muted)' }}>
                  Patient-reported
                </p>
                {row.patientReported.length === 0 ? (
                  <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
                    Patient did not report this medication.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {row.patientReported.map((m) => (
                      <MedCard
                        key={m.id}
                        med={m}
                        savingId={savingId}
                        onSetStatus={setMedicationStatus}
                        side="patient"
                        canVerify={canVerify}
                      />
                    ))}
                  </div>
                )}
              </div>
              {/* Right: provider-verified */}
              <div className="p-4 md:p-5">
                <p className="text-[10px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--brand-text-muted)' }}>
                  Provider-verified
                </p>
                {row.providerEntered.length === 0 ? (
                  <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
                    No provider-entered prescription on file.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {row.providerEntered.map((m) => (
                      <MedCard
                        key={m.id}
                        med={m}
                        savingId={savingId}
                        onSetStatus={setMedicationStatus}
                        side="provider"
                        canVerify={canVerify}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Action required strip */}
            {row.status === 'DISCREPANCY' && (
              <div
                className="px-5 py-2.5 flex items-center gap-2"
                style={{
                  backgroundColor: 'var(--brand-warning-amber-light)',
                  borderTop: '1px solid var(--brand-border)',
                }}
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-warning-amber)' }} />
                <p className="text-[11.5px] font-semibold" style={{ color: 'var(--brand-warning-amber)' }}>
                  Action required — confirm or reject the patient&apos;s entry, then add the matching prescription.
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function statusChrome(status: ReconStatus): {
  label: string;
  bg: string;
  color: string;
  icon: React.ReactNode;
} {
  switch (status) {
    case 'MATCHED':
      return {
        label: 'Matched',
        bg: 'var(--brand-success-green-light)',
        color: 'var(--brand-success-green)',
        icon: <Check className="w-3 h-3" />,
      };
    case 'DISCREPANCY':
      return {
        label: 'Discrepancy',
        bg: 'var(--brand-warning-amber-light)',
        color: 'var(--brand-warning-amber)',
        icon: <AlertTriangle className="w-3 h-3" />,
      };
    case 'REJECTED':
      return {
        label: 'Rejected',
        bg: 'var(--brand-alert-red-light)',
        color: 'var(--brand-alert-red)',
        icon: <XIcon className="w-3 h-3" />,
      };
    case 'DISCONTINUED':
      return {
        label: 'Discontinued',
        bg: 'var(--brand-background)',
        color: 'var(--brand-text-muted)',
        icon: <ClockIcon className="w-3 h-3" />,
      };
    case 'UNVERIFIED':
    default:
      return {
        label: 'Unverified',
        bg: 'var(--brand-primary-purple-light)',
        color: 'var(--brand-primary-purple)',
        icon: <ClockIcon className="w-3 h-3" />,
      };
  }
}

function verificationChrome(status: MedicationVerificationStatus): { label: string; color: string; bg: string } {
  switch (status) {
    case 'VERIFIED':
      return { label: 'Verified', color: 'var(--brand-success-green)', bg: 'var(--brand-success-green-light)' };
    case 'REJECTED':
      return { label: 'Rejected', color: 'var(--brand-alert-red)', bg: 'var(--brand-alert-red-light)' };
    case 'AWAITING_PROVIDER':
      return { label: 'Awaiting provider', color: 'var(--brand-warning-amber)', bg: 'var(--brand-warning-amber-light)' };
    case 'UNVERIFIED':
    default:
      return { label: 'Unverified', color: 'var(--brand-text-muted)', bg: 'var(--brand-background)' };
  }
}

interface MedCardProps {
  med: PatientMedication;
  savingId: string | null;
  side: 'patient' | 'provider';
  onSetStatus: (med: PatientMedication, status: MedicationVerificationStatus) => void;
  /** Whether the current admin role can verify medications. When false,
   *  the card shows the data + status pill but no action buttons. */
  canVerify: boolean;
}

function MedCard({ med, savingId, side, onSetStatus, canVerify }: MedCardProps) {
  const v = verificationChrome(med.verificationStatus);
  const isDiscontinued = med.discontinuedAt != null;
  const saving = savingId === med.id;

  return (
    <div
      className="rounded-lg p-3"
      style={{
        backgroundColor: isDiscontinued ? 'var(--brand-background)' : 'white',
        border: '1px solid var(--brand-border)',
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <p
            className="text-[13px] font-bold truncate"
            style={{
              color: 'var(--brand-text-primary)',
              textDecoration: isDiscontinued ? 'line-through' : 'none',
            }}
          >
            {med.drugName}
          </p>
          <p className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
            {FREQ_LABELS[med.frequency] ?? med.frequency}
            {med.isCombination && med.combinationComponents.length > 0 && (
              <span> · combo: {med.combinationComponents.join(' + ')}</span>
            )}
          </p>
        </div>
        <span
          className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
          style={{ backgroundColor: v.bg, color: v.color }}
        >
          {v.label}
        </span>
      </div>

      {side === 'patient' && (
        <p className="text-[10.5px] italic mt-1" style={{ color: 'var(--brand-text-muted)' }}>
          &ldquo;I take this&rdquo; · reported {new Date(med.reportedAt).toLocaleDateString()}
        </p>
      )}
      {side === 'provider' && med.notes && (
        <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
          {med.notes}
        </p>
      )}

      {!isDiscontinued && canVerify && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          <StatusButton
            current={med.verificationStatus}
            target="VERIFIED"
            actionLabel="Verify"
            activeLabel="Verified"
            color="var(--brand-success-green)"
            icon={saving && med.verificationStatus !== 'VERIFIED'
              ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
              : <Check className="w-2.5 h-2.5" />}
            saving={saving}
            onClick={() => onSetStatus(med, 'VERIFIED')}
          />
          <StatusButton
            current={med.verificationStatus}
            target="REJECTED"
            actionLabel="Reject"
            activeLabel="Rejected"
            color="var(--brand-alert-red)"
            icon={<XIcon className="w-2.5 h-2.5" />}
            saving={saving}
            onClick={() => onSetStatus(med, 'REJECTED')}
          />
          <StatusButton
            current={med.verificationStatus}
            target="AWAITING_PROVIDER"
            actionLabel="Hold"
            activeLabel="On hold"
            color="var(--brand-warning-amber)"
            icon={<ClockIcon className="w-2.5 h-2.5" />}
            saving={saving}
            onClick={() => onSetStatus(med, 'AWAITING_PROVIDER')}
          />
        </div>
      )}
    </div>
  );
}

interface StatusButtonProps {
  current: MedicationVerificationStatus;
  target: MedicationVerificationStatus;
  /** What the button reads when it's a call-to-action (e.g. "Verify"). */
  actionLabel: string;
  /** What the button reads once that's the active status (e.g. "Verified"). */
  activeLabel: string;
  color: string;
  icon: React.ReactNode;
  saving: boolean;
  onClick: () => void;
}

/**
 * Status pill that doubles as a button. When the button's target status
 * matches the medication's current status, it shows as a locked-in pill
 * (no hover, default cursor, disabled) — visually communicating that the
 * click is a no-op and avoiding accidental duplicate audit log entries.
 */
function StatusButton({
  current,
  target,
  actionLabel,
  activeLabel,
  color,
  icon,
  saving,
  onClick,
}: StatusButtonProps) {
  const active = current === target;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving || active}
      aria-pressed={active}
      title={active ? activeLabel : actionLabel}
      className={`h-6 px-2 rounded-md text-[10.5px] font-semibold transition-all inline-flex items-center gap-1 disabled:opacity-100 ${
        active ? 'cursor-default' : 'cursor-pointer hover:brightness-95'
      }`}
      style={{
        backgroundColor: active ? color : 'white',
        color: active ? 'white' : color,
        border: `1px solid ${color}`,
      }}
    >
      {icon}
      {active ? activeLabel : actionLabel}
    </button>
  );
}
