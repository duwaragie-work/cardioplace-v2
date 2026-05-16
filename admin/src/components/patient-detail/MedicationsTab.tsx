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
  Info,
} from 'lucide-react';
import {
  verifyMedication,
  type PatientAlert,
  type PatientMedication,
  type MedicationVerificationStatus,
} from '@/lib/services/patient-detail.service';
import { useAuth } from '@/lib/auth-context';
import { canVerifyMedications } from '@/lib/roleGates';
import MedicationRejectModal from './MedicationRejectModal';

interface Props {
  medications: PatientMedication[];
  loading: boolean;
  onChanged: () => void;
  /** Open alerts for this patient — the tab uses these to surface Tier 3
   *  informational alerts inline on the relevant drug-class row instead
   *  of cluttering the Alerts tab queue (CLINICAL_SPEC V2-C Layer 1). */
  alerts?: PatientAlert[];
}

/**
 * Map a Tier 3 (informational) ruleId to the drugClass it relates to.
 * Used to attach a green inline badge on the matching drug-class row
 * in the medication reconciliation view.
 *
 * RULE_PULSE_PRESSURE_WIDE is intentionally absent — it isn't bound to
 * a specific medication, so it surfaces in the "Physician notes"
 * section of AlertsTab instead.
 */
function tier3DrugClassFor(ruleId: string | null | undefined): string | null {
  switch (ruleId) {
    case 'RULE_HCM_VASODILATOR':
      return 'VASODILATOR_NITRATE';
    case 'RULE_LOOP_DIURETIC_HYPOTENSION':
      return 'LOOP_DIURETIC';
    default:
      return null;
  }
}

// PENDING_PROVIDER_ENTRY = patient self-reported a med but no provider
// prescription record exists yet. Per CLINICAL_SPEC V2-F Priority 3 #25
// the provider-side prescription entry workflow is deferred to post-MVP,
// so during MVP this state is unactionable from the admin UI. We surface
// it as informational instead of as an amber DISCREPANCY warning to
// avoid showing "Action required" prompts the admin can't fulfill.
//
// DISCREPANCY = a true mismatch the admin CAN act on today (prescribed
// but not patient-reported, or frequency mismatch between sides).
type ReconStatus =
  | 'MATCHED'
  | 'DISCREPANCY'
  | 'PENDING_PROVIDER_ENTRY'
  | 'UNVERIFIED'
  | 'DISCONTINUED'
  | 'REJECTED';

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
  ONCE_DAILY: 'One time daily',
  TWICE_DAILY: 'Two times daily',
  THREE_TIMES_DAILY: 'Three times daily',
  AS_NEEDED: 'As needed (PRN)',
  UNSURE: 'Unsure',
};

function isPatientSourced(m: PatientMedication): boolean {
  return m.source !== 'PROVIDER_ENTERED';
}

export default function MedicationsTab({ medications, loading, onChanged, alerts }: Props) {
  const { user } = useAuth();
  // Verify / reject / hold buttons render only for the clinical-verifier
  // roles (SUPER_ADMIN, PROVIDER, MEDICAL_DIRECTOR). HEALPLACE_OPS sees
  // the same medication cards but no action buttons.
  const canVerify = canVerifyMedications(user);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PatientMedication | null>(null);

  // Open Tier 3 alerts grouped by the drug class they relate to. Lets
  // each row pick up its informational notes in O(1).
  const tier3ByDrugClass = useMemo(() => {
    const map = new Map<string, PatientAlert[]>();
    if (!alerts) return map;
    for (const a of alerts) {
      if (a.tier !== 'TIER_3_INFO') continue;
      if (a.status !== 'OPEN') continue;
      const cls = tier3DrugClassFor(a.ruleId);
      if (!cls) continue;
      const arr = map.get(cls) ?? [];
      arr.push(a);
      map.set(cls, arr);
    }
    return map;
  }, [alerts]);

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
      // Prescribed but no patient self-report → real discrepancy (potential
      // non-adherence). Admin can verify or reject the existing prescription.
      else if (providerEntered.length > 0 && patientReported.length === 0) status = 'DISCREPANCY';
      // Patient-reported but no prescription on file → unactionable until
      // the provider-entry workflow ships (CLINICAL_SPEC V2-C Layer 2 /
      // V2-F #25). Surface as informational, not as a warning.
      else if (patientReported.length > 0 && providerEntered.length === 0) status = 'PENDING_PROVIDER_ENTRY';
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
    // Reject requires a rationale (backend mandates it). Collect it via
    // the modal first; the modal calls verifyMedication itself on submit.
    if (status === 'REJECTED') {
      setError(null);
      setRejecting(med);
      return;
    }
    // Cluster 7 A.7 — HOLD also requires a rationale; admin enters it via a
    // prompt so the patient notification can carry context-free wording while
    // the audit log captures the why.
    let rationale: string | undefined;
    if (status === 'HOLD') {
      const reason = typeof window !== 'undefined'
        ? window.prompt(`Why is ${med.drugName} being placed on hold?`)
        : null;
      if (reason == null) return;
      const trimmed = reason.trim();
      if (trimmed.length === 0) {
        setError('A reason is required to place a medication on hold.');
        return;
      }
      rationale = trimmed;
    }
    setSavingId(med.id);
    setError(null);
    try {
      await verifyMedication(
        med.id,
        status as 'VERIFIED' | 'AWAITING_PROVIDER' | 'HOLD',
        rationale,
      );
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
          style={{ backgroundColor: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red-text)' }}
        >
          {error}
        </div>
      )}

      {rows.map((row) => {
        const chrome = statusChrome(row.status);
        const tier3Notes = tier3ByDrugClass.get(row.drugClassKey) ?? [];
        return (
          <div key={row.drugClassKey} className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
            {/* Row header */}
            <div className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: '1px solid var(--brand-border)' }}>
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
              <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                {/* Tier 3 informational notes for this drug class. Quiet
                    teal palette + Info icon — physician-only context, not
                    a safety-critical warning. Tooltip carries the full
                    physicianMessage. */}
                {tier3Notes.map((note) => (
                  <span
                    key={note.id}
                    className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: 'var(--brand-accent-teal-light)',
                      color: 'var(--brand-accent-teal)',
                    }}
                    title={note.physicianMessage ?? note.patientMessage ?? note.ruleId ?? 'Physician note'}
                  >
                    <Info className="w-3 h-3" />
                    Note
                  </span>
                ))}
                <span
                  className="inline-flex items-center gap-1 text-[10.5px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: chrome.bg, color: chrome.color }}
                >
                  {chrome.icon}
                  {chrome.label}
                </span>
              </div>
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

            {/* True discrepancy — admin can act on this from the existing UI
                (verify or reject the prescription / patient row). Keep the
                amber warning + "Action required" prompt. */}
            {row.status === 'DISCREPANCY' && (
              <div
                className="px-5 py-2.5 flex items-center gap-2"
                style={{
                  backgroundColor: 'var(--brand-warning-amber-light)',
                  borderTop: '1px solid var(--brand-border)',
                }}
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-warning-amber-text)' }} />
                <p className="text-[11.5px] font-semibold" style={{ color: 'var(--brand-warning-amber-text)' }}>
                  Action required — confirm or reject the entry to reconcile this medication.
                </p>
              </div>
            )}

            {/* Pending provider entry — the patient self-report side is
                fully verifiable today, but the right-hand prescription
                column needs the provider-entry workflow (CLINICAL_SPEC
                V2-C Layer 2 / V2-F #25 — deferred to post-MVP). Shown as
                a quiet info note so the admin knows the system knows; no
                "Action required" because there's nothing the admin can
                do about it from MVP UI. */}
            {row.status === 'PENDING_PROVIDER_ENTRY' && (
              <div
                className="px-5 py-2.5 flex items-center gap-2"
                style={{
                  backgroundColor: 'var(--brand-background)',
                  borderTop: '1px solid var(--brand-border)',
                }}
              >
                <ClockIcon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-text-muted)' }} />
                <p className="text-[11.5px]" style={{ color: 'var(--brand-text-muted)' }}>
                  Pending provider entry — the prescription record will be added once provider entry is enabled.
                </p>
              </div>
            )}
          </div>
        );
      })}

      <MedicationRejectModal
        med={rejecting}
        open={rejecting != null}
        onClose={() => setRejecting(null)}
        onConfirmed={() => onChanged()}
      />
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
        color: 'var(--brand-warning-amber-text)',
        icon: <AlertTriangle className="w-3 h-3" />,
      };
    case 'PENDING_PROVIDER_ENTRY':
      // Neutral / informational — provider-entry workflow ships post-MVP,
      // so this is "waiting on a feature" rather than "waiting on the
      // admin". Tinted in the brand-neutral palette so the row doesn't
      // compete visually with rows that DO need attention.
      return {
        label: 'Patient-reported',
        bg: 'var(--brand-background)',
        color: 'var(--brand-text-secondary)',
        icon: <ClockIcon className="w-3 h-3" />,
      };
    case 'REJECTED':
      return {
        label: 'Rejected',
        bg: 'var(--brand-alert-red-light)',
        color: 'var(--brand-alert-red-text)',
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
      return { label: 'Rejected', color: 'var(--brand-alert-red-text)', bg: 'var(--brand-alert-red-light)' };
    case 'AWAITING_PROVIDER':
      return { label: 'Awaiting provider', color: 'var(--brand-warning-amber-text)', bg: 'var(--brand-warning-amber-light)' };
    case 'HOLD':
      return { label: 'On hold', color: 'var(--brand-warning-amber-text)', bg: 'var(--brand-warning-amber-light)' };
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
            target="HOLD"
            actionLabel="Hold"
            activeLabel="On hold"
            color="var(--brand-warning-amber)"
            icon={<ClockIcon className="w-2.5 h-2.5" />}
            saving={saving}
            onClick={() => onSetStatus(med, 'HOLD')}
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
