'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone,
  Calendar,
  Clock,
  Search,
  X,
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import { getScheduledCalls, updateCallStatus, deleteScheduledCall } from '@/lib/services/provider.service';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ScheduledCall {
  id: string;
  callDate: string | null;
  callTime: string | null;
  callType: string;
  notes: string | null;
  status: 'upcoming' | 'completed' | 'missed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  patient: {
    id: string;
    name: string | null;
    email: string | null;
    riskTier: string;
  } | null;
  alert: {
    id: string;
    type: string;
    severity: string;
    alertStatus: string;
    createdAt: string;
    journalEntry: {
      systolicBP: number | null;
      diastolicBP: number | null;
      entryDate: string;
    } | null;
  } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '--';
  }
}

function formatTime(timeStr: string | null): string {
  if (!timeStr) return '--';
  // Already formatted (e.g. "10:00 AM") — return as-is
  if (/[APap][Mm]/.test(timeStr)) return timeStr;
  // Raw 24h format (e.g. "14:30") — convert
  try {
    const [h, m] = timeStr.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
  } catch {
    return timeStr;
  }
}

function formatAlertType(type: string): string {
  return (type ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getInitials(name: string | null): string {
  if (!name) return 'P';
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

const STATUS_META: Record<string, { label: string; bg: string; color: string; icon: typeof CheckCircle2 }> = {
  upcoming: {
    label: 'Upcoming',
    bg: 'var(--brand-primary-purple-light)',
    color: 'var(--brand-primary-purple)',
    icon: Clock,
  },
  completed: {
    label: 'Completed',
    bg: 'var(--brand-success-green-light)',
    color: 'var(--brand-success-green)',
    icon: CheckCircle2,
  },
  missed: {
    label: 'Missed',
    bg: 'var(--brand-alert-red-light)',
    color: 'var(--brand-alert-red)',
    icon: XCircle,
  },
  cancelled: {
    label: 'Cancelled',
    bg: '#F1F5F9',
    color: 'var(--brand-text-muted)',
    icon: XCircle,
  },
};

const RISK_STYLES: Record<string, { bg: string; color: string }> = {
  HIGH: { bg: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red)' },
  ELEVATED: { bg: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber)' },
  STANDARD: { bg: 'var(--brand-success-green-light)', color: 'var(--brand-success-green)' },
};

// ─── Skeletons ────────────────────────────────────────────────────────────────
function CardSkeleton() {
  return (
    <div className="bg-white rounded-2xl p-5 animate-pulse" style={{ boxShadow: '0 1px 20px rgba(123,0,224,0.07)' }}>
      <div className="flex items-start gap-3 mb-4">
        <div className="w-11 h-11 rounded-full shrink-0" style={{ backgroundColor: '#EDE9F6' }} />
        <div className="flex-1 space-y-2">
          <div className="h-4 rounded-full" style={{ backgroundColor: '#EDE9F6', width: '50%' }} />
          <div className="h-3 rounded-full" style={{ backgroundColor: '#F3EEFB', width: '35%' }} />
        </div>
        <div className="h-6 rounded-full" style={{ backgroundColor: '#EDE9F6', width: 72 }} />
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 rounded-xl" style={{ backgroundColor: '#FAFBFF' }} />
        ))}
      </div>
      <div className="h-3 rounded-full" style={{ backgroundColor: '#F3EEFB', width: '60%' }} />
    </div>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────
const modalScrollStyles = `
.call-modal-scroll::-webkit-scrollbar { width: 6px; }
.call-modal-scroll::-webkit-scrollbar-track { background: transparent; }
.call-modal-scroll::-webkit-scrollbar-thumb { background: #E0D4F5; border-radius: 99px; }
.call-modal-scroll::-webkit-scrollbar-thumb:hover { background: #C4B0E0; }
.call-modal-scroll { scrollbar-width: thin; scrollbar-color: #E0D4F5 transparent; }
`;

function CallDetailModal({
  call,
  onClose,
  onStatusChange,
  onDelete,
}: {
  call: ScheduledCall;
  onClose: () => void;
  onStatusChange: (id: string, status: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [acting, setActing] = useState(false);
  const meta = STATUS_META[call.status] ?? STATUS_META.upcoming;
  const StatusIcon = meta.icon;
  const initials = getInitials(call.patient?.name ?? null);
  const risk = RISK_STYLES[call.patient?.riskTier ?? 'STANDARD'] ?? RISK_STYLES.STANDARD;
  const statusLabel: Record<string, string> = {
    upcoming: t('provider.upcoming'),
    completed: t('provider.completed'),
    missed: t('provider.missed'),
    cancelled: t('provider.cancelled'),
  };

  const handleAction = async (action: 'completed' | 'missed' | 'cancelled' | 'delete') => {
    setActing(true);
    try {
      if (action === 'delete') {
        await onDelete(call.id);
      } else {
        await onStatusChange(call.id, action);
      }
      onClose();
    } finally {
      setActing(false);
    }
  };

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
          className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden"
          style={{ boxShadow: '0 24px 48px rgba(123,0,224,0.15)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className="shrink-0 px-6 py-4 rounded-t-2xl flex items-center justify-between"
            style={{ background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)' }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'white' }}
              >
                <Phone className="w-4.5 h-4.5" />
              </div>
              <div>
                <h3 className="text-white font-bold text-[15px]">{t('provider.callDetails')}</h3>
                <p className="text-white/70 text-[11px]">{call.callType} call</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center transition hover:bg-white/20"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 call-modal-scroll space-y-5">
            {/* Status */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusIcon className="w-4 h-4" style={{ color: meta.color }} />
                <span className="text-[13px] font-bold" style={{ color: meta.color }}>{statusLabel[call.status] ?? meta.label}</span>
              </div>
              <span
                className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase"
                style={{ backgroundColor: meta.bg, color: meta.color }}
              >
                {call.status}
              </span>
            </div>

            {/* Schedule Info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl" style={{ backgroundColor: '#FAFBFF' }}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Calendar className="w-3.5 h-3.5" style={{ color: 'var(--brand-primary-purple)' }} />
                  <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--brand-text-muted)' }}>{t('provider.date')}</p>
                </div>
                <p className="text-[14px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                  {formatDate(call.callDate)}
                </p>
              </div>
              <div className="p-3 rounded-xl" style={{ backgroundColor: '#FAFBFF' }}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Clock className="w-3.5 h-3.5" style={{ color: 'var(--brand-accent-teal)' }} />
                  <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--brand-text-muted)' }}>{t('provider.time')}</p>
                </div>
                <p className="text-[14px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                  {formatTime(call.callTime)}
                </p>
              </div>
            </div>

            {/* Patient */}
            {call.patient && (
              <div>
                <h4 className="text-[12px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--brand-text-muted)' }}>
                  {t('provider.patient')}
                </h4>
                <div className="flex items-center gap-3 p-3 rounded-xl" style={{ backgroundColor: '#FAFBFF' }}>
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                    style={{ backgroundColor: 'var(--brand-primary-purple-light)', color: 'var(--brand-primary-purple)' }}
                  >
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--brand-text-primary)' }}>
                      {call.patient.name ?? 'Unknown'}
                    </p>
                    <p className="text-[11px] truncate" style={{ color: 'var(--brand-text-muted)' }}>
                      {call.patient.email ?? '--'}
                    </p>
                  </div>
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase shrink-0"
                    style={{ backgroundColor: risk.bg, color: risk.color }}
                  >
                    {call.patient.riskTier}
                  </span>
                </div>
              </div>
            )}

            {/* Alert Context */}
            {call.alert && (
              <div>
                <h4 className="text-[12px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--brand-text-muted)' }}>
                  {t('provider.alertContext')}
                </h4>
                <div
                  className="p-3 rounded-xl"
                  style={{
                    backgroundColor: call.alert.severity === 'HIGH' ? 'var(--brand-alert-red-light)' : 'var(--brand-warning-amber-light)',
                    borderLeft: `3px solid ${call.alert.severity === 'HIGH' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)'}`,
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[12px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                      {formatAlertType(call.alert.type)}
                    </p>
                    <span
                      className="text-[10px] font-bold uppercase"
                      style={{ color: call.alert.severity === 'HIGH' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)' }}
                    >
                      {call.alert.severity}
                    </span>
                  </div>
                  {call.alert.journalEntry && (
                    <p className="text-[11px]" style={{ color: 'var(--brand-text-secondary)' }}>
                      Reading: {call.alert.journalEntry.systolicBP}/{call.alert.journalEntry.diastolicBP} mmHg
                    </p>
                  )}
                  <p className="text-[10px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
                    {t('provider.alert')}: {call.alert.alertStatus} &middot; {formatDate(call.alert.createdAt)}
                  </p>
                </div>
              </div>
            )}

            {/* Notes */}
            {call.notes && (
              <div>
                <h4 className="text-[12px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--brand-text-muted)' }}>
                  Notes
                </h4>
                <p className="text-[13px] leading-relaxed p-3 rounded-xl" style={{ backgroundColor: '#FAFBFF', color: 'var(--brand-text-secondary)' }}>
                  {call.notes}
                </p>
              </div>
            )}

            {/* Actions */}
            <div>
              <h4 className="text-[12px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--brand-text-muted)' }}>
                {t('provider.actions')}
              </h4>
              <div className="space-y-2">
                {call.status === 'upcoming' && (
                  <>
                    <button
                      disabled={acting}
                      onClick={() => handleAction('completed')}
                      className="w-full h-10 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
                      style={{ backgroundColor: 'var(--brand-success-green-light)', color: 'var(--brand-success-green)', border: '1px solid var(--brand-success-green)' }}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {t('provider.markCompleted')}
                    </button>
                    <button
                      disabled={acting}
                      onClick={() => handleAction('missed')}
                      className="w-full h-10 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
                      style={{ backgroundColor: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red)', border: '1px solid var(--brand-alert-red)' }}
                    >
                      <XCircle className="w-4 h-4" />
                      {t('provider.markMissed')}
                    </button>
                    <button
                      disabled={acting}
                      onClick={() => handleAction('cancelled')}
                      className="w-full h-10 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
                      style={{ backgroundColor: '#F1F5F9', color: 'var(--brand-text-muted)', border: '1px solid var(--brand-border)' }}
                    >
                      <X className="w-4 h-4" />
                      {t('provider.cancelCall')}
                    </button>
                  </>
                )}
                {(call.status === 'missed' || call.status === 'cancelled') && (
                  <button
                    disabled={acting}
                    onClick={() => handleAction('completed')}
                    className="w-full h-10 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
                    style={{ backgroundColor: 'var(--brand-success-green-light)', color: 'var(--brand-success-green)', border: '1px solid var(--brand-success-green)' }}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Mark as Completed
                  </button>
                )}
                <button
                  disabled={acting}
                  onClick={() => handleAction('delete')}
                  className="w-full h-9 rounded-xl text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
                  style={{ color: 'var(--brand-alert-red)' }}
                >
                  {t('provider.deleteCall')}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ScheduledCallsPage() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { t } = useLanguage();

  const [calls, setCalls] = useState<ScheduledCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selectedCall, setSelectedCall] = useState<ScheduledCall | null>(null);

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    setLoading(true);
    getScheduledCalls()
      .then((data) => setCalls(Array.isArray(data) ? data : []))
      .catch(() => setCalls([]))
      .finally(() => setLoading(false));
  }, [isAuthenticated, isLoading]);

  // Filter + search
  const filtered = calls.filter((c) => {
    if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (c.patient?.name ?? '').toLowerCase().includes(q) ||
        (c.patient?.email ?? '').toLowerCase().includes(q) ||
        (c.callType ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Group by status
  const upcoming = filtered.filter((c) => c.status === 'upcoming');
  const completed = filtered.filter((c) => c.status === 'completed');
  const missed = filtered.filter((c) => c.status === 'missed');
  const cancelled = filtered.filter((c) => c.status === 'cancelled');

  // Counts for filters
  const counts = {
    ALL: calls.length,
    upcoming: calls.filter((c) => c.status === 'upcoming').length,
    completed: calls.filter((c) => c.status === 'completed').length,
    missed: calls.filter((c) => c.status === 'missed').length,
    cancelled: calls.filter((c) => c.status === 'cancelled').length,
  };

  // ─── Auth guard ─────────────────────────────────────────────────────────────
  if (isLoading) return null;

  if (user?.email !== 'support@healplace.com') {
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

  // ─── Call Card ───────────────────────────────────────────────────────────────
  function CallCard({ call }: { call: ScheduledCall }) {
    const meta = STATUS_META[call.status] ?? STATUS_META.upcoming;
    const StatusIcon = meta.icon;
    const initials = getInitials(call.patient?.name ?? null);
    const statusLabelMap: Record<string, string> = {
      upcoming: t('provider.upcoming'),
      completed: t('provider.completed'),
      missed: t('provider.missed'),
      cancelled: t('provider.cancelled'),
    };

    return (
      <motion.button
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        onClick={() => setSelectedCall(call)}
        className="w-full text-left bg-white rounded-2xl p-5 transition-colors hover:bg-[#FDFBFF] cursor-pointer group"
        style={{ boxShadow: '0 1px 20px rgba(123,0,224,0.07)' }}
      >
        {/* Top row: patient + status */}
        <div className="flex items-start gap-3 mb-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
            style={{ backgroundColor: 'var(--brand-primary-purple-light)', color: 'var(--brand-primary-purple)' }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--brand-text-primary)' }}>
              {call.patient?.name ?? 'Unknown Patient'}
            </p>
            <p className="text-[11px] truncate" style={{ color: 'var(--brand-text-muted)' }}>
              {call.callType} call &middot; {call.patient?.email ?? '--'}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold"
              style={{ backgroundColor: meta.bg, color: meta.color }}
            >
              <StatusIcon className="w-3 h-3" />
              {statusLabelMap[call.status] ?? meta.label}
            </span>
          </div>
        </div>

        {/* Schedule info row */}
        <div className="flex items-center gap-4 mb-3">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" style={{ color: 'var(--brand-text-muted)' }} />
            <span className="text-[12px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
              {formatDate(call.callDate)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" style={{ color: 'var(--brand-text-muted)' }} />
            <span className="text-[12px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
              {formatTime(call.callTime)}
            </span>
          </div>
        </div>

        {/* Alert context */}
        {call.alert && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg mb-2"
            style={{
              backgroundColor: call.alert.severity === 'HIGH' ? 'var(--brand-alert-red-light)' : 'var(--brand-warning-amber-light)',
            }}
          >
            <AlertTriangle
              className="w-3 h-3 shrink-0"
              style={{ color: call.alert.severity === 'HIGH' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)' }}
            />
            <span className="text-[11px] font-semibold truncate" style={{ color: 'var(--brand-text-primary)' }}>
              {formatAlertType(call.alert.type)}
              {call.alert.journalEntry
                ? ` — ${call.alert.journalEntry.systolicBP}/${call.alert.journalEntry.diastolicBP} mmHg`
                : ''}
            </span>
          </div>
        )}

        {/* Notes preview + arrow */}
        <div className="flex items-center justify-between">
          <p className="text-[11px] truncate flex-1 mr-2" style={{ color: 'var(--brand-text-muted)' }}>
            {call.notes ? `Note: ${call.notes}` : 'No notes'}
          </p>
          <ChevronRight
            className="w-4 h-4 shrink-0 transition-transform group-hover:translate-x-0.5"
            style={{ color: 'var(--brand-text-muted)' }}
          />
        </div>
      </motion.button>
    );
  }

  // ─── Section renderer ───────────────────────────────────────────────────────
  function Section({ title, items, icon: Icon, color }: { title: string; items: ScheduledCall[]; icon: typeof Clock; color: string }) {
    if (items.length === 0) return null;
    return (
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Icon className="w-4 h-4" style={{ color }} />
          <h3 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: 'var(--brand-text-muted)' }}>
            {title} ({items.length})
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <AnimatePresence>
            {items.map((c) => (
              <CallCard key={c.id} call={c} />
            ))}
          </AnimatePresence>
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
              <Phone className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                {t('provider.scheduledCalls')}
              </h1>
              <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
                {loading ? '...' : `${calls.length} total calls`}
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
                placeholder={t('provider.searchCalls')}
                className="flex-1 text-[12px] outline-none bg-transparent"
                style={{ color: 'var(--brand-text-primary)' }}
              />
              {search && (
                <button onClick={() => setSearch('')} className="shrink-0">
                  <X className="w-3 h-3" style={{ color: 'var(--brand-text-muted)' }} />
                </button>
              )}
            </div>

            {/* Status filter */}
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="appearance-none h-9 pl-3 pr-7 rounded-full text-[12px] font-semibold outline-none cursor-pointer"
                style={{
                  backgroundColor: 'white',
                  border: '1.5px solid var(--brand-border)',
                  color: 'var(--brand-text-secondary)',
                }}
              >
                <option value="ALL">{t('provider.allStatuses')} ({counts.ALL})</option>
                <option value="upcoming">{t('provider.upcoming')} ({counts.upcoming})</option>
                <option value="completed">{t('provider.completed')} ({counts.completed})</option>
                <option value="missed">{t('provider.missed')} ({counts.missed})</option>
                <option value="cancelled">{t('provider.cancelled')} ({counts.cancelled})</option>
              </select>
              <ChevronDown
                className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
                style={{ color: 'var(--brand-text-muted)' }}
              />
            </div>
          </div>
        </div>

        {/* Summary Stats */}
        {!loading && (
          <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-6">
            {[
              { ...STATUS_META.upcoming, count: counts.upcoming },
              { ...STATUS_META.completed, count: counts.completed },
              { ...STATUS_META.missed, count: counts.missed },
            ].map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.label}
                  onClick={() => setStatusFilter(s.label === statusFilter ? 'ALL' : s.label.toLowerCase())}
                  className="bg-white p-2.5 sm:p-4 rounded-xl sm:rounded-2xl text-left transition-all hover:scale-[1.01]"
                  style={{
                    boxShadow: '0 1px 20px rgba(123,0,224,0.07)',
                    border: statusFilter === s.label.toLowerCase() ? `2px solid ${s.color}` : '2px solid transparent',
                  }}
                >
                  <div className="flex items-center gap-1.5 sm:gap-2 mb-1 sm:mb-2">
                    <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" style={{ color: s.color }} />
                    <span className="text-[9px] sm:text-[11px] font-semibold uppercase tracking-wide truncate" style={{ color: 'var(--brand-text-muted)' }}>
                      {{ Upcoming: t('provider.upcoming'), Completed: t('provider.completed'), Missed: t('provider.missed'), Cancelled: t('provider.cancelled') }[s.label] ?? s.label}
                    </span>
                  </div>
                  <p className="text-xl sm:text-2xl font-bold" style={{ color: s.color }}>
                    {s.count}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}
            >
              <Phone className="w-7 h-7" style={{ color: 'var(--brand-primary-purple)' }} />
            </div>
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--brand-text-primary)' }}>
              {t('provider.noCalls')}
            </p>
            <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
              Schedule follow-up calls from the Provider Dashboard alert queue
            </p>
          </div>
        ) : statusFilter === 'ALL' ? (
          <>
            <Section title={t('provider.upcoming')} items={upcoming} icon={Clock} color="var(--brand-primary-purple)" />
            <Section title={t('provider.missed')} items={missed} icon={XCircle} color="var(--brand-alert-red)" />
            <Section title={t('provider.completed')} items={completed} icon={CheckCircle2} color="var(--brand-success-green)" />
            <Section title={t('provider.cancelled')} items={cancelled} icon={XCircle} color="var(--brand-text-muted)" />
          </>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <AnimatePresence>
              {filtered.map((c) => (
                <CallCard key={c.id} call={c} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Modal */}
      <AnimatePresence>
        {selectedCall && (
          <CallDetailModal
            call={selectedCall}
            onClose={() => setSelectedCall(null)}
            onStatusChange={async (id, status) => {
              await updateCallStatus(id, status);
              setCalls((prev) => prev.map((c) => c.id === id ? { ...c, status: status as ScheduledCall['status'] } : c));
            }}
            onDelete={async (id) => {
              await deleteScheduledCall(id);
              setCalls((prev) => prev.filter((c) => c.id !== id));
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
