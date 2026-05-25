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
import { matchToCatalog } from '@cardioplace/shared';
import MedicationRejectModal from './MedicationRejectModal';
import MedicationHoldModal from './MedicationHoldModal';

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

// MVP single-column reconciliation (MEDREC-COL decision b). The provider-entry
// workflow (CLINICAL_SPEC V2-C Layer 2 / V2-F #25) is deferred post-MVP, so the
// side-by-side "provider-verified" column was dropped — every med shown here is
// patient-sourced. Each group lists ACTIVE meds prominently and collapses
// rejected/discontinued rows into a "view history" disclosure (IVR-20). A drug
// that was rejected and then re-reported by the patient is flagged on its
// active card (IVR-19).
interface MedGroupRow {
  drugClassKey: string;
  drugClassLabel: string;
  active: PatientMedication[];
  history: PatientMedication[];
  /** Canonical catalog keys that are active now AND were previously rejected.
   *  Keyed by catalog id (brand+generic resolved) so "Coreg" matches a
   *  rejected "Carvedilol" — see canonicalMedKey. */
  reAddedKeys: Set<string>;
}

// Canonical identity for a med name — resolves brand↔generic to one catalog id
// so the re-added indicator (IVR-19/20) recognizes "Coreg" and "Carvedilol" as
// the same drug. Falls back to the normalized name for freeform meds.
function canonicalMedKey(drugName: string): string {
  return matchToCatalog(drugName)?.catalogId ?? drugName.trim().toLowerCase();
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

export default function MedicationsTab({ medications, loading, onChanged, alerts }: Props) {
  const { user } = useAuth();
  // Verify / reject / hold buttons render only for the clinical-verifier
  // roles (SUPER_ADMIN, PROVIDER, MEDICAL_DIRECTOR). HEALPLACE_OPS sees
  // the same medication cards but no action buttons.
  const canVerify = canVerifyMedications(user);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PatientMedication | null>(null);
  const [holding, setHolding] = useState<PatientMedication | null>(null);

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

  // Group by drugClass; within each group separate active meds from
  // rejected/discontinued history, and flag re-added (previously rejected)
  // drugs for the IVR-19 indicator.
  const rows: MedGroupRow[] = useMemo(() => {
    const groups = new Map<string, PatientMedication[]>();
    for (const m of medications) {
      const arr = groups.get(m.drugClass) ?? [];
      arr.push(m);
      groups.set(m.drugClass, arr);
    }
    return Array.from(groups.entries()).map(([drugClass, meds]) => {
      const rejected = meds.filter((m) => m.verificationStatus === 'REJECTED');
      const active = meds.filter(
        (m) => m.verificationStatus !== 'REJECTED' && m.discontinuedAt == null,
      );
      const discontinued = meds.filter(
        (m) => m.verificationStatus !== 'REJECTED' && m.discontinuedAt != null,
      );
      const rejectedKeys = new Set(rejected.map((m) => canonicalMedKey(m.drugName)));
      const reAddedKeys = new Set(
        active
          .map((m) => canonicalMedKey(m.drugName))
          .filter((key) => rejectedKeys.has(key)),
      );
      return {
        drugClassKey: drugClass,
        drugClassLabel: DRUG_CLASS_LABELS[drugClass] ?? drugClass,
        active,
        // Rejected first (the IVR-20 "previously rejected" case), then plain
        // discontinued history.
        history: [...rejected, ...discontinued],
        reAddedKeys,
      };
    });
  }, [medications]);

  async function setMedicationStatus(med: PatientMedication, status: MedicationVerificationStatus) {
    // No-op when the chosen status already matches — prevents accidental
    // duplicate timeline entries from a second click on the active button.
    if (med.verificationStatus === status) return;
    // Reject + Hold both require a rationale (backend mandates it). Collect it
    // via a modal first; the modal calls verifyMedication itself on submit.
    // Hold additionally triggers the systemMsgMedicationHold patient
    // notification server-side (CLINICAL_SPEC §14.2).
    if (status === 'REJECTED') {
      setError(null);
      setRejecting(med);
      return;
    }
    if (status === 'HOLD') {
      setError(null);
      setHolding(med);
      return;
    }
    setSavingId(med.id);
    setError(null);
    try {
      await verifyMedication(
        med.id,
        status as 'VERIFIED' | 'AWAITING_PROVIDER' | 'HOLD',
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
      <div className="bg-white rounded-2xl p-8 text-center" style={{ boxShadow: 'var(--brand-shadow-card)' }} data-testid="admin-med-empty">
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
        const tier3Notes = tier3ByDrugClass.get(row.drugClassKey) ?? [];
        return (
          <div key={row.drugClassKey} className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--brand-shadow-card)' }} data-testid={`admin-med-group-${row.drugClassKey}`}>
            {/* Group header */}
            <div className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: '1px solid var(--brand-border)' }}>
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-white"
                  style={{ backgroundColor: 'var(--brand-primary-purple)' }}
                  aria-hidden
                >
                  <Pill className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-bold truncate" style={{ color: 'var(--brand-text-primary)' }}>
                    {row.drugClassLabel}
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
                    {row.active.length} active{row.history.length > 0 ? ` · ${row.history.length} in history` : ''}
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
              </div>
            </div>

            {/* Active meds — single column (MEDREC-COL b) */}
            <div className="p-4 md:p-5 space-y-2">
              {row.active.length === 0 ? (
                <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
                  No active medications in this class.
                </p>
              ) : (
                row.active.map((m) => {
                  const reAdded = row.reAddedKeys.has(canonicalMedKey(m.drugName));
                  return (
                    <div key={m.id} className="space-y-1.5">
                      <MedCard
                        med={m}
                        savingId={savingId}
                        onSetStatus={setMedicationStatus}
                        side="patient"
                        canVerify={canVerify}
                      />
                      {/* IVR-19 — this drug was previously rejected, then the
                          patient re-reported it. Flag it for re-review. */}
                      {reAdded && (
                        <div
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                          style={{ backgroundColor: 'var(--brand-warning-amber-light)' }}
                          data-testid={`admin-med-readded-${m.id}`}
                        >
                          <AlertTriangle className="w-3 h-3 shrink-0" style={{ color: 'var(--brand-warning-amber-text)' }} />
                          <p className="text-[11px] font-semibold" style={{ color: 'var(--brand-warning-amber-text)' }}>
                            Rejected by provider · patient re-added — please re-review.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Rejected / discontinued history, collapsed (IVR-20) */}
            {row.history.length > 0 && (
              <details style={{ borderTop: '1px solid var(--brand-border)' }}>
                <summary
                  className="px-5 py-2.5 text-[11.5px] font-semibold cursor-pointer select-none"
                  style={{ color: 'var(--brand-text-muted)' }}
                  data-testid={`admin-med-history-${row.drugClassKey}`}
                >
                  Previously rejected / discontinued — view history ({row.history.length})
                </summary>
                <div className="px-4 md:px-5 pb-4 space-y-2">
                  {row.history.map((m) => (
                    <MedCard
                      key={m.id}
                      med={m}
                      savingId={savingId}
                      onSetStatus={setMedicationStatus}
                      side="patient"
                      canVerify={false}
                    />
                  ))}
                </div>
              </details>
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
      <MedicationHoldModal
        med={holding}
        open={holding != null}
        onClose={() => setHolding(null)}
        onConfirmed={() => onChanged()}
      />
    </div>
  );
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
      data-testid={`admin-med-card-${med.id}`}
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
          data-testid={`admin-med-status-${med.id}`}
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
            testId={`admin-med-verify-${med.id}`}
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
            testId={`admin-med-reject-${med.id}`}
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
            testId={`admin-med-hold-${med.id}`}
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
  testId?: string;
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
  testId,
}: StatusButtonProps) {
  const active = current === target;
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
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
