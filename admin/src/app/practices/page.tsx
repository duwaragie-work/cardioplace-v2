'use client';

// Flow J1 — /practices index. Lists all practices with their staff +
// patient counts and an "Add practice" button that opens a create modal.

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Plus,
  Users,
  UserPlus,
  Clock,
  Globe,
  Loader2,
  X,
  ChevronRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  listPractices,
  createPractice,
  COMMON_TIMEZONES,
  type Practice,
  type UpsertPracticePayload,
} from '@/lib/services/practice.service';
import { useAuth } from '@/lib/auth-context';
import { canManagePractices } from '@/lib/roleGates';

export default function PracticesPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  // Create practice is a write — SUPER_ADMIN, MED_DIR, OPS only.
  // PROVIDER sees the list but no "Add practice" CTA anywhere on the page.
  const canManage = canManagePractices(user);

  const [practices, setPractices] = useState<Practice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listPractices();
      setPractices(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load practices.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    // Initial fetch on mount / auth resolution.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [authLoading, user, refresh]);

  return (
    <div className="h-full" style={{ backgroundColor: 'var(--brand-background)' }}>
      <main className="p-4 md:p-8 max-w-[1200px] mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-white"
              style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
            >
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                Practices
              </h1>
              <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
                Manage clinical sites, business hours, and after-hours protocols.
              </p>
            </div>
          </div>
          {canManage && (
            <button type="button" onClick={() => setShowCreate(true)} className="btn-admin-primary">
              <Plus className="w-3.5 h-3.5" />
              Add practice
            </button>
          )}
        </div>

        {/* List card */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
          {loading ? (
            <div className="p-6 space-y-2 animate-pulse">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 rounded-xl" style={{ backgroundColor: '#F3EEFB' }} />
              ))}
            </div>
          ) : error ? (
            <div className="p-8 text-center text-[13px]" style={{ color: 'var(--brand-alert-red)' }}>
              {error}
            </div>
          ) : practices.length === 0 ? (
            <div className="p-10 text-center">
              <Building2 className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--brand-text-muted)' }} />
              <p className="text-[14px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                No practices yet
              </p>
              <p className="text-[12px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
                {canManage
                  ? 'Add your first practice to start onboarding clinicians and patients.'
                  : 'Practices will appear here once an administrator adds them.'}
              </p>
              {canManage && (
                <button type="button" onClick={() => setShowCreate(true)} className="btn-admin-primary mt-4">
                  <Plus className="w-3.5 h-3.5" />
                  Add practice
                </button>
              )}
            </div>
          ) : (
            <ul>
              {practices.map((p, idx) => (
                <li
                  key={p.id}
                  style={{
                    borderTop: idx > 0 ? '1px solid var(--brand-border)' : 'none',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => router.push(`/practices/${p.id}`)}
                    className="w-full text-left px-5 py-4 flex items-center gap-4 transition-colors hover:bg-[#F8F4FF] cursor-pointer"
                  >
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-white"
                      style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
                    >
                      <Building2 className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-bold truncate" style={{ color: 'var(--brand-text-primary)' }}>
                        {p.name}
                      </p>
                      <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 text-[11px] mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {p.businessHoursStart}–{p.businessHoursEnd}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Globe className="w-2.5 h-2.5" />
                          {p.businessHoursTimezone}
                        </span>
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center gap-4 shrink-0">
                      <Stat
                        icon={<Users className="w-3 h-3" />}
                        label="Patients"
                        value={p.patientCount ?? 0}
                        accent="var(--brand-primary-purple)"
                      />
                      <Stat
                        icon={<UserPlus className="w-3 h-3" />}
                        label="Staff"
                        value={p.staffCount ?? 0}
                        accent="var(--brand-accent-teal)"
                      />
                    </div>
                    <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--brand-text-muted)' }} />
                  </button>
                  {/* Mobile-only stats row */}
                  <div className="sm:hidden flex gap-4 px-5 pb-3">
                    <Stat
                      icon={<Users className="w-3 h-3" />}
                      label="Patients"
                      value={p.patientCount ?? 0}
                      accent="var(--brand-primary-purple)"
                    />
                    <Stat
                      icon={<UserPlus className="w-3 h-3" />}
                      label="Staff"
                      value={p.staffCount ?? 0}
                      accent="var(--brand-accent-teal)"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      {/* Create modal */}
      <AnimatePresence>
        {showCreate && (
          <CreatePracticeModal
            onClose={() => setShowCreate(false)}
            onCreated={(p) => {
              setShowCreate(false);
              setPractices((prev) => [p, ...prev]);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="w-6 h-6 rounded-md flex items-center justify-center text-white shrink-0"
        style={{ backgroundColor: accent }}
        aria-hidden
      >
        {icon}
      </span>
      <div className="leading-tight">
        <p className="text-[14px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
          {value}
        </p>
        <p className="text-[9.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
          {label}
        </p>
      </div>
    </div>
  );
}

// ─── Create modal ───────────────────────────────────────────────────────────

function CreatePracticeModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: Practice) => void;
}) {
  const [form, setForm] = useState<UpsertPracticePayload>({
    name: '',
    businessHoursStart: '08:00',
    businessHoursEnd: '18:00',
    businessHoursTimezone: 'America/New_York',
    afterHoursProtocol: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = form.name.trim().length > 0 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createPractice({
        ...form,
        afterHoursProtocol: form.afterHoursProtocol?.trim() || null,
      });
      onCreated(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create practice.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: 'rgba(15,23,42,0.5)' }}
    >
      <div className="absolute inset-0" onClick={onClose} />
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
        className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl rounded-t-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '92dvh', boxShadow: '0 8px 48px rgba(0,0,0,0.18)' }}
      >
        {/* Header */}
        <div className="shrink-0 px-5 pt-4 pb-3 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--brand-border)' }}>
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center text-white"
              style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
            >
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold leading-tight" style={{ color: 'var(--brand-text-primary)' }}>
                Add practice
              </h2>
              <p className="text-[11.5px]" style={{ color: 'var(--brand-text-muted)' }}>
                You can edit business hours and protocol later.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto thin-scrollbar p-5 space-y-4">
          <Field label="Practice name" required>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Cedar Hill Family Medicine"
              className="w-full px-3 h-9 rounded-lg text-[13px] outline-none"
              style={{ border: '1px solid var(--brand-border)' }}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Business hours start">
              <input
                type="time"
                value={form.businessHoursStart}
                onChange={(e) => setForm((p) => ({ ...p, businessHoursStart: e.target.value }))}
                className="w-full px-3 h-9 rounded-lg text-[13px] outline-none"
                style={{ border: '1px solid var(--brand-border)' }}
              />
            </Field>
            <Field label="Business hours end">
              <input
                type="time"
                value={form.businessHoursEnd}
                onChange={(e) => setForm((p) => ({ ...p, businessHoursEnd: e.target.value }))}
                className="w-full px-3 h-9 rounded-lg text-[13px] outline-none"
                style={{ border: '1px solid var(--brand-border)' }}
              />
            </Field>
          </div>

          <Field label="Timezone">
            <select
              value={form.businessHoursTimezone}
              onChange={(e) => setForm((p) => ({ ...p, businessHoursTimezone: e.target.value }))}
              className="w-full px-3 h-9 rounded-lg text-[13px] outline-none bg-white"
              style={{ border: '1px solid var(--brand-border)' }}
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </Field>

          <Field label="After-hours protocol">
            <textarea
              value={form.afterHoursProtocol ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, afterHoursProtocol: e.target.value }))}
              rows={3}
              placeholder="Who covers after hours? Any special routing? (Optional)"
              className="w-full px-3 py-2 rounded-lg text-[13px] outline-none resize-y leading-relaxed"
              style={{ border: '1px solid var(--brand-border)' }}
            />
          </Field>

          {error && (
            <div
              className="rounded-lg px-3 py-2 text-[12px] font-semibold"
              style={{ backgroundColor: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red)' }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-3 flex gap-3" style={{ borderTop: '1px solid var(--brand-border)' }}>
          <button type="button" onClick={onClose} className="btn-admin-secondary flex-1">
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={!canSubmit} className="btn-admin-primary flex-1">
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Create practice
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10.5px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--brand-text-muted)' }}>
        {label}
        {required && <span style={{ color: 'var(--brand-alert-red)' }}> *</span>}
      </span>
      {children}
    </label>
  );
}
