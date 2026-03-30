'use client';

import { useState, useEffect } from 'react';

/* Custom scrollbar styles for patient modal */
const modalScrollStyles = `
.modal-scroll::-webkit-scrollbar {
  width: 6px;
}
.modal-scroll::-webkit-scrollbar-track {
  background: transparent;
  margin: 4px 0;
}
.modal-scroll::-webkit-scrollbar-thumb {
  background: #E0D4F5;
  border-radius: 99px;
}
.modal-scroll::-webkit-scrollbar-thumb:hover {
  background: #C4B0E0;
}
.modal-scroll {
  scrollbar-width: thin;
  scrollbar-color: #E0D4F5 transparent;
}
`;
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Search,
  X,
  Activity,
  AlertTriangle,
  Mail,
  Phone,
  Calendar,
  Heart,
  Shield,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { getPatients, getPatientSummary } from '@/lib/services/provider.service';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Patient {
  id: string;
  name: string | null;
  email: string | null;
  riskTier: string;
  communicationPreference: string | null;
  primaryCondition: string | null;
  onboardingStatus: string;
  latestBaseline: { baselineSystolic: number; baselineDiastolic: number } | null;
  activeAlertsCount: number;
  lastEntryDate: string | null;
  latestBP: { systolicBP: number; diastolicBP: number; entryDate: string } | null;
  escalationLevel: string | null;
}

interface PatientSummary {
  patient: Patient;
  recentEntries: {
    id: string;
    entryDate: string;
    systolicBP: number | null;
    diastolicBP: number | null;
    weight: number | null;
    medicationTaken: boolean | null;
    symptoms: string[];
  }[];
  activeAlerts: {
    id: string;
    type: string;
    severity: string;
    magnitude: number;
    status: string;
    createdAt: string;
  }[];
  activeEscalations: {
    id: string;
    escalationLevel: string;
    reason: string | null;
    triggeredAt: string;
  }[];
  baseline: {
    baselineSystolic: number;
    baselineDiastolic: number;
    baselineWeight: number | null;
    sampleSize: number;
  } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '--';
  }
}

function formatAlertType(type: string): string {
  return (type ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDate(dateStr);
  } catch {
    return '--';
  }
}

const RISK_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  HIGH: {
    bg: 'var(--brand-alert-red-light)',
    color: 'var(--brand-alert-red)',
    border: 'var(--brand-alert-red)',
  },
  ELEVATED: {
    bg: 'var(--brand-warning-amber-light)',
    color: 'var(--brand-warning-amber)',
    border: 'var(--brand-warning-amber)',
  },
  STANDARD: {
    bg: 'var(--brand-success-green-light)',
    color: 'var(--brand-success-green)',
    border: 'var(--brand-success-green)',
  },
};

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function TableSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="animate-pulse flex items-center gap-4 px-5 py-4 rounded-xl"
          style={{ backgroundColor: '#FAFBFF' }}
        >
          <div className="w-9 h-9 rounded-full" style={{ backgroundColor: '#EDE9F6' }} />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 rounded-full" style={{ backgroundColor: '#EDE9F6', width: '30%' }} />
            <div className="h-2.5 rounded-full" style={{ backgroundColor: '#F3EEFB', width: '20%' }} />
          </div>
          <div className="h-3 rounded-full" style={{ backgroundColor: '#EDE9F6', width: 60 }} />
          <div className="h-3 rounded-full" style={{ backgroundColor: '#EDE9F6', width: 50 }} />
          <div className="h-3 rounded-full" style={{ backgroundColor: '#EDE9F6', width: 70 }} />
        </div>
      ))}
    </div>
  );
}

function ModalSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-full" style={{ backgroundColor: '#EDE9F6' }} />
        <div className="space-y-2 flex-1">
          <div className="h-4 rounded-full" style={{ backgroundColor: '#EDE9F6', width: '40%' }} />
          <div className="h-3 rounded-full" style={{ backgroundColor: '#F3EEFB', width: '25%' }} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 rounded-xl" style={{ backgroundColor: '#FAFBFF' }} />
        ))}
      </div>
      <div className="h-32 rounded-xl" style={{ backgroundColor: '#FAFBFF' }} />
    </div>
  );
}

// ─── Risk Badge ───────────────────────────────────────────────────────────────
function RiskBadge({ tier }: { tier: string }) {
  const s = RISK_STYLES[tier] ?? RISK_STYLES.STANDARD;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
      style={{ backgroundColor: s.bg, color: s.color }}
    >
      {tier}
    </span>
  );
}

// ─── Patient Detail Modal ─────────────────────────────────────────────────────
function PatientModal({
  patient,
  summary,
  loading,
  onClose,
}: {
  patient: Patient;
  summary: PatientSummary | null;
  loading: boolean;
  onClose: () => void;
}) {
  const initials = patient.name
    ? patient.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'P';

  return (
    <>
    <style>{modalScrollStyles}</style>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
        style={{ boxShadow: '0 24px 48px rgba(123,0,224,0.15)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="shrink-0 px-6 py-4 rounded-t-2xl flex items-center justify-between"
          style={{
            background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold"
              style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'white' }}
            >
              {initials}
            </div>
            <div>
              <h3 className="text-white font-bold text-[16px]">{patient.name ?? 'Unknown'}</h3>
              <p className="text-white/70 text-[12px]">{patient.email ?? '--'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center transition hover:bg-white/20"
          >
            <X className="w-4 h-4 text-white" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 modal-scroll">
          {loading ? (
            <ModalSkeleton />
          ) : (
            <div className="space-y-5">
              {/* Quick Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl" style={{ backgroundColor: '#FAFBFF' }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Heart className="w-3.5 h-3.5" style={{ color: 'var(--brand-primary-purple)' }} />
                    <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--brand-text-muted)' }}>
                      Latest BP
                    </p>
                  </div>
                  <p className="text-[20px] font-bold" style={{ color: 'var(--brand-primary-purple)' }}>
                    {patient.latestBP
                      ? `${patient.latestBP.systolicBP}/${patient.latestBP.diastolicBP}`
                      : '--/--'}
                  </p>
                  <p className="text-[10px]" style={{ color: 'var(--brand-text-muted)' }}>mmHg</p>
                </div>

                <div className="p-3 rounded-xl" style={{ backgroundColor: '#FAFBFF' }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Shield className="w-3.5 h-3.5" style={{ color: 'var(--brand-accent-teal)' }} />
                    <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--brand-text-muted)' }}>
                      Risk Tier
                    </p>
                  </div>
                  <RiskBadge tier={patient.riskTier} />
                </div>

                <div className="p-3 rounded-xl" style={{ backgroundColor: '#FAFBFF' }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Activity className="w-3.5 h-3.5" style={{ color: 'var(--brand-accent-teal)' }} />
                    <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--brand-text-muted)' }}>
                      Baseline
                    </p>
                  </div>
                  <p className="text-[16px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                    {summary?.baseline
                      ? `${summary.baseline.baselineSystolic}/${summary.baseline.baselineDiastolic}`
                      : '--/--'}
                  </p>
                  <p className="text-[10px]" style={{ color: 'var(--brand-text-muted)' }}>
                    {summary?.baseline ? `${summary.baseline.sampleSize} day avg` : 'mmHg'}
                  </p>
                </div>

                <div className="p-3 rounded-xl" style={{ backgroundColor: '#FAFBFF' }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--brand-warning-amber)' }} />
                    <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--brand-text-muted)' }}>
                      Active Alerts
                    </p>
                  </div>
                  <p className="text-[20px] font-bold" style={{ color: patient.activeAlertsCount > 0 ? 'var(--brand-alert-red)' : 'var(--brand-text-primary)' }}>
                    {patient.activeAlertsCount}
                  </p>
                </div>
              </div>

              {/* Patient Info */}
              <div>
                <h4 className="text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
                  Patient Info
                </h4>
                <div className="space-y-2">
                  {[
                    { icon: Mail, label: 'Email', value: patient.email ?? '--' },
                    { icon: Phone, label: 'Preference', value: (patient.communicationPreference ?? 'TEXT_FIRST').replace('_', ' ') },
                    { icon: Calendar, label: 'Last Check-in', value: patient.lastEntryDate ? timeAgo(patient.lastEntryDate) : 'Never' },
                    { icon: Heart, label: 'Condition', value: patient.primaryCondition ?? '--' },
                  ].map(({ icon: Icon, label, value }) => (
                    <div key={label} className="flex items-center gap-2.5 py-1.5">
                      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-text-muted)' }} />
                      <span className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>{label}</span>
                      <span className="text-[12px] font-semibold ml-auto" style={{ color: 'var(--brand-text-primary)' }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Entries */}
              {summary && summary.recentEntries.length > 0 && (
                <div>
                  <h4 className="text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
                    Recent Readings
                  </h4>
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--brand-border)' }}>
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr style={{ backgroundColor: '#FAFBFF' }}>
                          <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--brand-text-muted)' }}>Date</th>
                          <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--brand-text-muted)' }}>BP</th>
                          <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--brand-text-muted)' }}>Meds</th>
                          <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--brand-text-muted)' }}>Symptoms</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.recentEntries.slice(0, 7).map((entry) => (
                          <tr key={entry.id} style={{ borderTop: '1px solid var(--brand-border)' }}>
                            <td className="px-3 py-2" style={{ color: 'var(--brand-text-secondary)' }}>
                              {formatDate(entry.entryDate)}
                            </td>
                            <td className="px-3 py-2 font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                              {entry.systolicBP && entry.diastolicBP ? `${entry.systolicBP}/${entry.diastolicBP}` : '--'}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className="inline-block w-2 h-2 rounded-full"
                                style={{
                                  backgroundColor: entry.medicationTaken
                                    ? 'var(--brand-success-green)'
                                    : entry.medicationTaken === false
                                    ? 'var(--brand-alert-red)'
                                    : 'var(--brand-border)',
                                }}
                              />
                            </td>
                            <td className="px-3 py-2" style={{ color: 'var(--brand-text-muted)' }}>
                              {entry.symptoms.length > 0 ? entry.symptoms.join(', ') : 'None'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Active Alerts */}
              {summary && summary.activeAlerts.length > 0 && (
                <div>
                  <h4 className="text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
                    Active Alerts
                  </h4>
                  <div className="space-y-2">
                    {summary.activeAlerts.map((alert) => (
                      <div
                        key={alert.id}
                        className="p-3 rounded-xl"
                        style={{
                          backgroundColor: alert.severity === 'HIGH' ? 'var(--brand-alert-red-light)' : 'var(--brand-warning-amber-light)',
                          borderLeft: `3px solid ${alert.severity === 'HIGH' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)'}`,
                        }}
                      >
                        <div className="flex items-start justify-between">
                          <p className="text-[11px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                            {formatAlertType(alert.type)}
                          </p>
                          <span
                            className="text-[10px] font-bold uppercase"
                            style={{ color: alert.severity === 'HIGH' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)' }}
                          >
                            {alert.severity}
                          </span>
                        </div>
                        <p className="text-[10px] mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>
                          {formatDate(alert.createdAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Escalations */}
              {summary && summary.activeEscalations.length > 0 && (
                <div>
                  <h4 className="text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
                    Escalations
                  </h4>
                  <div className="space-y-2">
                    {summary.activeEscalations.map((esc) => (
                      <div
                        key={esc.id}
                        className="p-3 rounded-xl"
                        style={{ backgroundColor: '#FAFBFF', borderLeft: '3px solid var(--brand-primary-purple)' }}
                      >
                        <p className="text-[11px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                          {(esc.escalationLevel ?? '').replace('_', ' ')}
                        </p>
                        <p className="text-[10px] mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>
                          {esc.reason ?? 'No reason recorded'} &middot; {formatDate(esc.triggeredAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PatientsPage() {
  const { user, isAuthenticated, isLoading } = useAuth();

  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<string>('ALL');

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [summary, setSummary] = useState<PatientSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Load patients
  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    setLoading(true);
    getPatients()
      .then((data) => setPatients(Array.isArray(data) ? data : []))
      .catch(() => setPatients([]))
      .finally(() => setLoading(false));
  }, [isAuthenticated, isLoading]);

  // Load summary when patient selected
  useEffect(() => {
    if (!selectedPatient) {
      setSummary(null);
      return;
    }
    setSummaryLoading(true);
    getPatientSummary(selectedPatient.id)
      .then((data) => setSummary(data))
      .catch(() => setSummary(null))
      .finally(() => setSummaryLoading(false));
  }, [selectedPatient]);

  // Filter + search
  const filtered = patients.filter((p) => {
    if (riskFilter !== 'ALL' && p.riskTier !== riskFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (p.name ?? '').toLowerCase().includes(q) ||
        (p.email ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  // ─── Auth guard ───────────────────────────────────────────────────────────
  if (isLoading) return null;

  if (!user?.roles?.includes('SUPER_ADMIN')) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--brand-background)' }}>
        <div className="text-center p-8 rounded-2xl bg-white" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: 'var(--brand-alert-red-light)' }}
          >
            <Shield className="w-7 h-7" style={{ color: 'var(--brand-alert-red)' }} />
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
            403 — Access Denied
          </h1>
          <p className="text-sm mb-4" style={{ color: 'var(--brand-text-muted)' }}>
            Super Admin access required
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold text-white transition hover:opacity-90"
            style={{ backgroundColor: 'var(--brand-primary-purple)' }}
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FAFBFF' }}>
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
        {/* Page Header */}
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
                {loading ? '...' : `${patients.length} registered patients`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Search */}
            <div
              className="flex items-center gap-2 px-3 h-9 rounded-full flex-1 sm:flex-none sm:w-56"
              style={{ backgroundColor: 'white', border: '1.5px solid var(--brand-border)' }}
            >
              <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-text-muted)' }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search patients..."
                className="flex-1 text-[12px] outline-none bg-transparent"
                style={{ color: 'var(--brand-text-primary)' }}
              />
              {search && (
                <button onClick={() => setSearch('')} className="shrink-0">
                  <X className="w-3 h-3" style={{ color: 'var(--brand-text-muted)' }} />
                </button>
              )}
            </div>

            {/* Risk filter */}
            <div className="relative">
              <select
                value={riskFilter}
                onChange={(e) => setRiskFilter(e.target.value)}
                className="appearance-none h-9 pl-3 pr-7 rounded-full text-[12px] font-semibold outline-none cursor-pointer"
                style={{
                  backgroundColor: 'white',
                  border: '1.5px solid var(--brand-border)',
                  color: 'var(--brand-text-secondary)',
                }}
              >
                <option value="ALL">All Risk</option>
                <option value="HIGH">High</option>
                <option value="ELEVATED">Elevated</option>
                <option value="STANDARD">Standard</option>
              </select>
              <ChevronDown
                className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
                style={{ color: 'var(--brand-text-muted)' }}
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div
          className="bg-white rounded-2xl overflow-hidden"
          style={{ boxShadow: '0 1px 20px rgba(123,0,224,0.07)' }}
        >
          {/* Table header */}
          <div
            className="hidden md:grid items-center px-5 py-3 text-[10px] font-bold uppercase tracking-wider"
            style={{
              color: 'var(--brand-text-muted)',
              gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 32px',
              borderBottom: '1px solid var(--brand-border)',
            }}
          >
            <span>Patient</span>
            <span>Latest BP</span>
            <span>Risk Tier</span>
            <span>Alerts</span>
            <span>Last Check-in</span>
            <span></span>
          </div>

          {loading ? (
            <div className="p-4">
              <TableSkeleton />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <Users className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--brand-border)' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--brand-text-muted)' }}>
                {search || riskFilter !== 'ALL' ? 'No patients match your filters' : 'No patients yet'}
              </p>
            </div>
          ) : (
            <div>
              {filtered.map((p, idx) => {
                const initials = p.name
                  ? p.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
                  : 'P';

                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPatient(p)}
                    className="w-full text-left px-5 py-3.5 flex items-center gap-4 md:grid transition-colors hover:bg-[#F8F4FF] cursor-pointer group"
                    style={{
                      gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 32px',
                      borderTop: idx > 0 ? '1px solid var(--brand-border)' : 'none',
                    }}
                  >
                    {/* Patient info */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold"
                        style={{
                          backgroundColor: 'var(--brand-primary-purple-light)',
                          color: 'var(--brand-primary-purple)',
                        }}
                      >
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--brand-text-primary)' }}>
                          {p.name ?? 'Unknown'}
                        </p>
                        <p className="text-[11px] truncate" style={{ color: 'var(--brand-text-muted)' }}>
                          {p.email ?? '--'}
                        </p>
                      </div>
                    </div>

                    {/* BP */}
                    <div className="hidden md:block">
                      <p className="text-[13px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                        {p.latestBP ? `${p.latestBP.systolicBP}/${p.latestBP.diastolicBP}` : '--/--'}
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--brand-text-muted)' }}>mmHg</p>
                    </div>

                    {/* Risk */}
                    <div className="hidden md:block">
                      <RiskBadge tier={p.riskTier} />
                    </div>

                    {/* Alerts */}
                    <div className="hidden md:block">
                      {p.activeAlertsCount > 0 ? (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                          style={{ backgroundColor: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red)' }}
                        >
                          <AlertTriangle className="w-3 h-3" />
                          {p.activeAlertsCount}
                        </span>
                      ) : (
                        <span className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>None</span>
                      )}
                    </div>

                    {/* Last check-in */}
                    <div className="hidden md:block">
                      <p className="text-[12px]" style={{ color: 'var(--brand-text-secondary)' }}>
                        {p.lastEntryDate ? timeAgo(p.lastEntryDate) : 'Never'}
                      </p>
                    </div>

                    {/* Arrow indicator */}
                    <div className="hidden md:flex items-center justify-center">
                      <ChevronRight
                        className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
                        style={{ color: 'var(--brand-text-muted)' }}
                      />
                    </div>

                    {/* Mobile: compact info */}
                    <div className="flex items-center gap-2 md:hidden ml-auto shrink-0">
                      <RiskBadge tier={p.riskTier} />
                      {p.activeAlertsCount > 0 && (
                        <span
                          className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
                          style={{ backgroundColor: 'var(--brand-alert-red)' }}
                        >
                          {p.activeAlertsCount}
                        </span>
                      )}
                      <ChevronRight
                        className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
                        style={{ color: 'var(--brand-text-muted)' }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {selectedPatient && (
          <PatientModal
            patient={selectedPatient}
            summary={summary}
            loading={summaryLoading}
            onClose={() => setSelectedPatient(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
