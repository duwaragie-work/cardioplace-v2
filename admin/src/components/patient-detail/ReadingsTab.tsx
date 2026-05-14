'use client';

// Flow H — patient detail "Readings" subtab.
//
// Provider-side longitudinal view of every BP journal entry the patient
// has logged, with the same fields the patient sees on their /readings
// page (per V2 feature request). Read-only: this surface is for
// review/triage; edits are patient-side only.
//
// Layout:
//   • Filter row — date range (7d / 30d / 90d / custom) and tier filter.
//   • One card per entry, newest first. Card surfaces date/time +
//     vitals + position/weight up top; symptoms, missed-med detail,
//     measurement-flags, notes, and any linked-alert tier badges below.
//   • Empty / loading skeletons match the rest of the patient-detail
//     tabs so the shell doesn't flash a different style on load.
//
// Reuses the existing GET /provider/patients/:userId/journal endpoint
// (no new endpoint). Authorized for the same four clinical roles as the
// rest of the provider controller (SUPER_ADMIN, MEDICAL_DIRECTOR,
// PROVIDER, HEALPLACE_OPS).

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Pill,
  ShieldAlert,
  Smartphone,
  Stethoscope,
  Weight as WeightIcon,
  XCircle,
} from 'lucide-react';
import {
  getPatientJournalEntries,
  type PatientJournalEntry,
} from '@/lib/services/provider.service';

interface Props {
  patientId: string;
}

type DateFilter = 'ALL' | '7D' | '30D' | '90D';
type TierFilter = 'ALL' | 'BP_L2' | 'TIER_1' | 'TIER_2' | 'BP_L1' | 'TIER_3';

const SYMPTOM_LABELS: Record<keyof Pick<PatientJournalEntry,
  'severeHeadache' | 'visualChanges' | 'alteredMentalStatus' |
  'chestPainOrDyspnea' | 'focalNeuroDeficit' | 'severeEpigastricPain' |
  'newOnsetHeadache' | 'ruqPain' | 'edema'>, string> = {
  severeHeadache: 'Severe headache',
  visualChanges: 'Vision changes',
  alteredMentalStatus: 'Confusion / altered mental status',
  chestPainOrDyspnea: 'Chest pain / shortness of breath',
  focalNeuroDeficit: 'Focal neuro deficit',
  severeEpigastricPain: 'Severe stomach pain',
  newOnsetHeadache: 'New-onset headache',
  ruqPain: 'RUQ pain',
  edema: 'Edema',
};

// Friendlier labels for the measurement-conditions checklist used in
// CheckIn flow B1. Falls through to the raw key for any unknown items
// (forward-compatible if new checklist items are added).
const CONDITION_LABELS: Record<string, string> = {
  noCaffeine: 'No caffeine',
  noSmoking: 'No smoking',
  noExercise: 'No exercise',
  bladderEmpty: 'Bladder empty',
  seatedQuietly: 'Seated quietly',
  posturalSupport: 'Postural support',
  notTalking: 'Not talking',
  cuffOnBareArm: 'Cuff on bare arm',
};

function tierBucket(t: string | null): TierFilter | 'OTHER' {
  if (t === 'BP_LEVEL_2' || t === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') return 'BP_L2';
  if (t === 'TIER_1_CONTRAINDICATION') return 'TIER_1';
  if (t === 'TIER_2_DISCREPANCY') return 'TIER_2';
  if (t === 'BP_LEVEL_1_HIGH' || t === 'BP_LEVEL_1_LOW') return 'BP_L1';
  if (t === 'TIER_3_INFO') return 'TIER_3';
  return 'OTHER';
}

function tierChrome(b: TierFilter | 'OTHER'): { label: string; color: string; bg: string } {
  switch (b) {
    case 'BP_L2': return { label: 'BP L2', color: 'var(--brand-alert-red-text)', bg: 'var(--brand-alert-red-light)' };
    case 'TIER_1': return { label: 'Tier 1', color: 'var(--brand-alert-red-text)', bg: 'var(--brand-alert-red-light)' };
    case 'TIER_2': return { label: 'Tier 2', color: 'var(--brand-warning-amber-text)', bg: 'var(--brand-warning-amber-light)' };
    case 'BP_L1': return { label: 'BP L1', color: 'var(--brand-warning-amber-text)', bg: 'var(--brand-warning-amber-light)' };
    case 'TIER_3': return { label: 'Tier 3', color: 'var(--brand-accent-teal)', bg: 'var(--brand-accent-teal-light)' };
    default: return { label: 'Other', color: 'var(--brand-text-muted)', bg: 'var(--brand-background)' };
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function dateFilterCutoff(filter: DateFilter): Date | null {
  if (filter === 'ALL') return null;
  const days = filter === '7D' ? 7 : filter === '30D' ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function ReadingsTab({ patientId }: Props) {
  const [entries, setEntries] = useState<PatientJournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>('30D');
  const [tierFilter, setTierFilter] = useState<TierFilter>('ALL');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPatientJournalEntries(patientId, { limit: 200 })
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load readings.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [patientId]);

  const filtered = useMemo(() => {
    const cutoff = dateFilterCutoff(dateFilter);
    return entries.filter((e) => {
      if (cutoff && new Date(e.measuredAt) < cutoff) return false;
      if (tierFilter !== 'ALL') {
        const hit = e.deviations.some((d) => tierBucket(d.tier) === tierFilter);
        if (!hit) return false;
      }
      return true;
    });
  }, [entries, dateFilter, tierFilter]);

  const counts = useMemo(() => ({ ALL: entries.length }), [entries]);

  return (
    <div className="space-y-4">
      {/* Filter card */}
      <div
        className="bg-white rounded-2xl p-4 md:p-5 space-y-3"
        style={{ boxShadow: 'var(--brand-shadow-card)' }}
      >
        <div className="flex flex-wrap items-center gap-3">
          {/* Date range chips */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
              Date range
            </span>
            <div className="flex flex-wrap gap-1.5">
              {([
                ['7D', 'Last 7 days'],
                ['30D', 'Last 30 days'],
                ['90D', 'Last 90 days'],
                ['ALL', 'All time'],
              ] as [DateFilter, string][]).map(([key, label]) => {
                const active = dateFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setDateFilter(key)}
                    className="px-2.5 h-7 rounded-full text-[11px] font-semibold transition-all cursor-pointer"
                    style={{
                      backgroundColor: active ? 'var(--brand-primary-purple)' : 'var(--brand-primary-purple-light)',
                      color: active ? 'white' : 'var(--brand-primary-purple)',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tier filter chips */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
              Linked alert tier
            </span>
            <div className="flex flex-wrap gap-1.5">
              {([
                ['ALL', 'All'],
                ['BP_L2', 'BP L2'],
                ['TIER_1', 'Tier 1'],
                ['TIER_2', 'Tier 2'],
                ['BP_L1', 'BP L1'],
                ['TIER_3', 'Tier 3'],
              ] as [TierFilter, string][]).map(([key, label]) => {
                const active = tierFilter === key;
                const chrome = key === 'ALL'
                  ? { color: 'var(--brand-primary-purple)', bg: 'var(--brand-primary-purple-light)' }
                  : tierChrome(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTierFilter(key)}
                    className="px-2.5 h-7 rounded-full text-[11px] font-semibold transition-all cursor-pointer"
                    style={{
                      backgroundColor: active ? chrome.color : chrome.bg,
                      color: active ? 'white' : chrome.color,
                      border: `1.5px solid ${active ? chrome.color : 'transparent'}`,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

        </div>

        <p className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
          Showing {filtered.length} of {counts.ALL} {counts.ALL === 1 ? 'reading' : 'readings'}
          {dateFilter !== 'ALL' && <> · {dateFilter === '7D' ? 'last 7 days' : dateFilter === '30D' ? 'last 30 days' : 'last 90 days'}</>}
          {tierFilter !== 'ALL' && <> · {tierChrome(tierFilter).label} alerts only</>}
        </p>
      </div>

      {/* List */}
      {loading ? (
        <ReadingsSkeleton />
      ) : error ? (
        <ErrorBanner message={error} />
      ) : filtered.length === 0 ? (
        <EmptyCard hasReadings={entries.length > 0} />
      ) : (
        <div className="space-y-2">
          {filtered.map((entry) => (
            <ReadingCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Reading card ──────────────────────────────────────────────────────────

function ReadingCard({ entry }: { entry: PatientJournalEntry }) {
  const trueSymptoms = (
    Object.keys(SYMPTOM_LABELS) as Array<keyof typeof SYMPTOM_LABELS>
  ).filter((k) => entry[k] === true);

  const missedRows: Array<{
    drugName: string; reason?: string | null; missedDoses?: number | null;
  }> = Array.isArray(entry.missedMedications)
    ? (entry.missedMedications as Array<{
        drugName: string; reason?: string | null; missedDoses?: number | null;
      }>)
    : [];

  return (
    <div
      className="bg-white rounded-2xl p-4 md:p-5"
      style={{ boxShadow: 'var(--brand-shadow-card)' }}
    >
      {/* Header — date + time + source + suboptimal flag */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[12.5px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
            <Calendar className="w-3.5 h-3.5" style={{ color: 'var(--brand-text-muted)' }} />
            {formatDate(entry.measuredAt)}
          </span>
          <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--brand-text-secondary)' }}>
            <Clock className="w-3 h-3" />
            {formatTime(entry.measuredAt)}
          </span>
          <SourcePill source={entry.source} />
          {entry.suboptimalMeasurement && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
              style={{
                backgroundColor: 'var(--brand-warning-amber-light)',
                color: 'var(--brand-warning-amber-text)',
              }}
              title="Patient missed at least one pre-measurement checklist item"
            >
              <AlertTriangle className="w-3 h-3" />
              Suboptimal
            </span>
          )}
        </div>
        {/* Linked alert tier badges */}
        {entry.deviations.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {entry.deviations.map((d) => {
              const chrome = tierChrome(tierBucket(d.tier));
              return (
                <span
                  key={d.id}
                  className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: chrome.bg, color: chrome.color }}
                  title={d.tier ?? d.type ?? 'Alert'}
                >
                  <ShieldAlert className="w-3 h-3" />
                  {chrome.label}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Vitals row */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-3">
        <Stat
          label="BP"
          value={
            entry.systolicBP != null && entry.diastolicBP != null
              ? `${entry.systolicBP}/${entry.diastolicBP}`
              : '—'
          }
          unit="mmHg"
          accent="var(--brand-text-primary)"
        />
        <Stat
          label="Pulse"
          value={entry.pulse != null ? String(entry.pulse) : '—'}
          unit="bpm"
        />
        <Stat
          label="Pulse pressure"
          value={entry.pulsePressure != null ? String(entry.pulsePressure) : '—'}
          unit="mmHg"
          accent={
            entry.pulsePressure != null && entry.pulsePressure > 60
              ? 'var(--brand-warning-amber)'
              : undefined
          }
        />
        {entry.position && (
          <Stat label="Position" value={entry.position[0] + entry.position.slice(1).toLowerCase()} />
        )}
        {entry.weight != null && (
          <Stat
            label="Weight"
            value={entry.weight.toFixed(1)}
            unit="kg"
            icon={<WeightIcon className="w-3 h-3" />}
          />
        )}
        {entry.singleReadingFinalized && (
          // Cluster 6 Q2 (Manisha 5/9/26) — flag readings where the engine
          // had to fire on a single-reading session (5-min timeout finalized
          // before a second reading landed). Provider should treat the
          // threshold cross as provisional until next session.
          <span
            className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{
              // Chip pattern: amber-light bg + amber-800 chip text + vibrant
              // amber-500 border. Author previously used the non-existent
              // `--brand-warning-amber-bg` token (fell back to hex) and put
              // the BG-role `--brand-warning-amber` token as the text color;
              // after §B's revert to vibrant orange-500, that paired the chip
              // bg with vibrant-orange text → 3.31:1, failing AA Normal.
              backgroundColor: 'var(--brand-warning-amber-light)',
              color: 'var(--brand-warning-amber-text)',
              border: '1px solid var(--brand-warning-amber)',
            }}
            title="Threshold crossed on an unaveraged reading. Confirm with next session."
          >
            <Clock className="w-3 h-3" />
            Single-reading session
          </span>
        )}
      </div>

      {/* Medication row */}
      {(entry.medicationTaken != null || missedRows.length > 0) && (
        <div className="mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
              Medication
            </span>
            {entry.medicationTaken === true && (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'var(--brand-success-green-light)',
                  color: 'var(--brand-success-green)',
                }}
              >
                <CheckCircle2 className="w-3 h-3" />
                Taken
              </span>
            )}
            {entry.medicationTaken === false && (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'var(--brand-alert-red-light)',
                  color: 'var(--brand-alert-red-text)',
                }}
              >
                <XCircle className="w-3 h-3" />
                Not taken
              </span>
            )}
            {entry.medicationTaken == null && (
              <span className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
                Not asked
              </span>
            )}
          </div>
          {missedRows.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {missedRows.map((m, i) => (
                <li
                  key={i}
                  className="text-[12px] inline-flex items-center gap-1.5"
                  style={{ color: 'var(--brand-text-secondary)' }}
                >
                  <Pill className="w-3 h-3 shrink-0" style={{ color: 'var(--brand-alert-red)' }} />
                  <span className="font-semibold">{m.drugName}</span>
                  {m.missedDoses != null && (
                    <span style={{ color: 'var(--brand-text-muted)' }}>
                      · {m.missedDoses} {m.missedDoses === 1 ? 'dose' : 'doses'} missed
                    </span>
                  )}
                  {m.reason && (
                    <span style={{ color: 'var(--brand-text-muted)' }}>
                      · {m.reason}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Symptom flags */}
      {(trueSymptoms.length > 0 || entry.otherSymptoms.length > 0) && (
        <div className="mb-3">
          <span className="text-[10px] font-bold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--brand-text-muted)' }}>
            Symptoms
          </span>
          <div className="flex flex-wrap gap-1.5">
            {trueSymptoms.map((k) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'var(--brand-alert-red-light)',
                  color: 'var(--brand-alert-red-text)',
                }}
              >
                <Activity className="w-3 h-3" />
                {SYMPTOM_LABELS[k]}
              </span>
            ))}
            {entry.otherSymptoms.map((s, i) => (
              <span
                key={`other-${i}`}
                className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'var(--brand-background)',
                  color: 'var(--brand-text-secondary)',
                  border: '1px solid var(--brand-border)',
                }}
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Suboptimal — failed checklist items */}
      {entry.suboptimalMeasurement && entry.failedConditions.length > 0 && (
        <div className="mb-3">
          <span className="text-[10px] font-bold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--brand-warning-amber-text)' }}>
            Failed checklist items
          </span>
          <div className="flex flex-wrap gap-1.5">
            {entry.failedConditions.map((c) => (
              <span
                key={c}
                className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'var(--brand-warning-amber-light)',
                  color: 'var(--brand-warning-amber-text)',
                }}
              >
                {CONDITION_LABELS[c] ?? c}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {entry.notes && (
        <div
          className="text-[12px] leading-relaxed pt-2"
          style={{
            color: 'var(--brand-text-secondary)',
            borderTop: '1px solid var(--brand-border)',
          }}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: 'var(--brand-text-muted)' }}>
            Patient notes
          </span>
          {entry.notes}
        </div>
      )}
    </div>
  );
}

// ─── Atoms ─────────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  unit,
  accent,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <span
        className="text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1"
        style={{ color: 'var(--brand-text-muted)' }}
      >
        {icon}
        {label}
      </span>
      <span
        className="text-[14px] font-bold leading-tight"
        style={{ color: accent ?? 'var(--brand-text-primary)' }}
      >
        {value}
        {unit && (
          <span className="text-[11px] font-normal ml-1" style={{ color: 'var(--brand-text-muted)' }}>
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}

function SourcePill({ source }: { source: string }) {
  const isHealthkit = source === 'healthkit';
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
      style={{
        backgroundColor: isHealthkit ? 'var(--brand-accent-teal-light)' : 'var(--brand-background)',
        color: isHealthkit ? 'var(--brand-accent-teal)' : 'var(--brand-text-secondary)',
        border: `1px solid ${isHealthkit ? 'var(--brand-accent-teal-light)' : 'var(--brand-border)'}`,
      }}
    >
      {isHealthkit ? <Smartphone className="w-3 h-3" /> : null}
      {isHealthkit ? 'HealthKit' : 'Manual'}
    </span>
  );
}

function ReadingsSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="bg-white rounded-2xl p-5 animate-pulse"
          style={{ boxShadow: 'var(--brand-shadow-card)' }}
        >
          <div className="h-3 w-40 rounded-full mb-3" style={{ backgroundColor: '#EDE9F6' }} />
          <div className="h-5 w-64 rounded-full mb-2" style={{ backgroundColor: '#EDE9F6' }} />
          <div className="h-3 w-72 rounded-full" style={{ backgroundColor: '#F3EEFB' }} />
        </div>
      ))}
    </div>
  );
}

function EmptyCard({ hasReadings }: { hasReadings: boolean }) {
  return (
    <div
      className="bg-white rounded-2xl p-8 text-center"
      style={{ boxShadow: 'var(--brand-shadow-card)' }}
    >
      <div
        className="mx-auto w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
        style={{ backgroundColor: 'var(--brand-background)' }}
      >
        <Activity className="w-7 h-7" style={{ color: 'var(--brand-text-muted)' }} />
      </div>
      <p className="text-[14px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
        {hasReadings ? 'No readings match your filters' : 'No readings yet'}
      </p>
      <p className="text-[12px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
        {hasReadings
          ? 'Widen the date range or clear the tier filter.'
          : "This patient hasn't logged any blood-pressure readings."}
      </p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="bg-white rounded-2xl p-4 flex items-start gap-3"
      style={{
        boxShadow: 'var(--brand-shadow-card)',
        borderLeft: '4px solid var(--brand-alert-red)',
      }}
      role="alert"
    >
      <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--brand-alert-red)' }} />
      <div className="flex-1">
        <p className="text-[13px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
          Couldn&apos;t load readings
        </p>
        <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--brand-text-secondary)' }}>{message}</p>
      </div>
    </div>
  );
}
