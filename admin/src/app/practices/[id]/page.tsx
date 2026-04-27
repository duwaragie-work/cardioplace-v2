'use client';

// Flow J2 — /practices/:id detail. Form for name + business hours +
// timezone + after-hours protocol, plus the practice's deduplicated staff
// list (sourced from existing PatientProviderAssignment rows).

import { use, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  ChevronLeft,
  Save,
  Loader2,
  Users,
  UserPlus,
  Clock,
  Globe,
  ShieldCheck,
  Mail,
} from 'lucide-react';
import {
  getPractice,
  updatePractice,
  listPracticeStaff,
  COMMON_TIMEZONES,
  type Practice,
  type PracticeStaff,
  type StaffSlot,
} from '@/lib/services/practice.service';
import { useAuth } from '@/lib/auth-context';
import { canManagePractices } from '@/lib/roleGates';

interface FormState {
  name: string;
  businessHoursStart: string;
  businessHoursEnd: string;
  businessHoursTimezone: string;
  afterHoursProtocol: string;
}

function toForm(p: Practice): FormState {
  return {
    name: p.name,
    businessHoursStart: p.businessHoursStart,
    businessHoursEnd: p.businessHoursEnd,
    businessHoursTimezone: p.businessHoursTimezone,
    afterHoursProtocol: p.afterHoursProtocol ?? '',
  };
}

export default function PracticeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  // Editable form (inputs + Save button) only for SUPER_ADMIN, MED_DIR,
  // OPS. PROVIDER sees a clean read-only summary of the same fields.
  const canManage = canManagePractices(user);

  const [practice, setPractice] = useState<Practice | null>(null);
  const [staff, setStaff] = useState<PracticeStaff[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, s] = await Promise.all([getPractice(id), listPracticeStaff(id)]);
      setPractice(p);
      setStaff(s);
      setForm(toForm(p));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load practice.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (authLoading || !user) return;
    // Initial fetch on mount / auth resolution.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [authLoading, user, refresh]);

  const dirty = practice && form
    ? JSON.stringify(form) !== JSON.stringify(toForm(practice))
    : false;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSuccess(null);
  }

  async function save() {
    if (!form || !dirty) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await updatePractice(id, {
        name: form.name,
        businessHoursStart: form.businessHoursStart,
        businessHoursEnd: form.businessHoursEnd,
        businessHoursTimezone: form.businessHoursTimezone,
        afterHoursProtocol: form.afterHoursProtocol.trim() || null,
      });
      setPractice(updated);
      setForm(toForm(updated));
      setSuccess('Practice updated.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-full" style={{ backgroundColor: 'var(--brand-background)' }}>
      <main className="p-4 md:p-8 max-w-[1200px] mx-auto space-y-5">
        {/* Back link */}
        <button
          type="button"
          onClick={() => router.push('/practices')}
          className="inline-flex items-center gap-1 text-[12px] font-semibold cursor-pointer hover:underline"
          style={{ color: 'var(--brand-text-secondary)' }}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Back to practices
        </button>

        {loading || !practice || !form ? (
          <div className="bg-white rounded-2xl p-8 text-center" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
            {error ? (
              <p className="text-[13px]" style={{ color: 'var(--brand-alert-red)' }}>{error}</p>
            ) : (
              <Loader2 className="w-5 h-5 mx-auto animate-spin" style={{ color: 'var(--brand-text-muted)' }} />
            )}
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="bg-white rounded-2xl p-5 md:p-6 flex items-center gap-4" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-white"
                style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
              >
                <Building2 className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold truncate" style={{ color: 'var(--brand-text-primary)' }}>
                  {practice.name}
                </h1>
                <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-[12px] mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>
                  <span className="inline-flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {practice.patientCount ?? 0} patients
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <UserPlus className="w-3 h-3" />
                    {practice.staffCount ?? 0} staff
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {practice.businessHoursStart}–{practice.businessHoursEnd}
                  </span>
                </div>
              </div>
            </div>

            {/* Configuration — editor for managers, read-only summary for
                PROVIDER. Same data either way; just no inputs / Save button
                when the role can't write. */}
            {canManage ? (
            <div className="bg-white rounded-2xl p-5 md:p-6 space-y-4" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
              <h2 className="text-[14px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                Practice configuration
              </h2>

              <Field label="Practice name" required>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  className="w-full px-3 h-9 rounded-lg text-[13px] outline-none"
                  style={{ border: '1px solid var(--brand-border)' }}
                />
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Hours start">
                  <input
                    type="time"
                    value={form.businessHoursStart}
                    onChange={(e) => set('businessHoursStart', e.target.value)}
                    className="w-full px-3 h-9 rounded-lg text-[13px] outline-none"
                    style={{ border: '1px solid var(--brand-border)' }}
                  />
                </Field>
                <Field label="Hours end">
                  <input
                    type="time"
                    value={form.businessHoursEnd}
                    onChange={(e) => set('businessHoursEnd', e.target.value)}
                    className="w-full px-3 h-9 rounded-lg text-[13px] outline-none"
                    style={{ border: '1px solid var(--brand-border)' }}
                  />
                </Field>
                <Field
                  label={
                    <span className="inline-flex items-center gap-1">
                      <Globe className="w-2.5 h-2.5" />
                      Timezone (IANA)
                    </span>
                  }
                >
                  {/* Combobox-ish: free-text input with a quick-pick datalist
                      so the admin can paste any IANA tz the backend accepts. */}
                  <input
                    type="text"
                    list="iana-tz-list"
                    value={form.businessHoursTimezone}
                    onChange={(e) => set('businessHoursTimezone', e.target.value)}
                    className="w-full px-3 h-9 rounded-lg text-[13px] outline-none"
                    style={{ border: '1px solid var(--brand-border)' }}
                  />
                  <datalist id="iana-tz-list">
                    {COMMON_TIMEZONES.map((tz) => (
                      <option key={tz} value={tz} />
                    ))}
                  </datalist>
                </Field>
              </div>

              <Field label="After-hours protocol">
                <textarea
                  value={form.afterHoursProtocol}
                  onChange={(e) => set('afterHoursProtocol', e.target.value)}
                  rows={4}
                  placeholder="Document the on-call rotation, escalation contacts, and any after-hours dispatch rules."
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
              {success && (
                <div
                  className="rounded-lg px-3 py-2 text-[12px] font-semibold"
                  style={{ backgroundColor: 'var(--brand-success-green-light)', color: 'var(--brand-success-green)' }}
                >
                  {success}
                </div>
              )}

              <div className="flex justify-end">
                <button type="button" onClick={save} disabled={!dirty || saving} className="btn-admin-primary">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save changes
                </button>
              </div>
            </div>
            ) : (
              <div className="bg-white rounded-2xl p-5 md:p-6 space-y-3" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
                <div className="flex items-center gap-2">
                  <h2 className="text-[14px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                    Practice configuration
                  </h2>
                  <span
                    className="ml-auto text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: 'var(--brand-background)', color: 'var(--brand-text-muted)' }}
                    title="Read-only — only an administrator can change practice settings."
                  >
                    Read-only
                  </span>
                </div>
                <ReadonlyRow label="Practice name" value={practice.name} />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <ReadonlyRow label="Hours start" value={practice.businessHoursStart} />
                  <ReadonlyRow label="Hours end" value={practice.businessHoursEnd} />
                  <ReadonlyRow
                    label={
                      <span className="inline-flex items-center gap-1">
                        <Globe className="w-2.5 h-2.5" />
                        Timezone
                      </span>
                    }
                    value={practice.businessHoursTimezone}
                  />
                </div>
                <ReadonlyRow
                  label="After-hours protocol"
                  value={practice.afterHoursProtocol?.trim() || 'Not documented.'}
                  multiline
                />
              </div>
            )}

            {/* Staff list */}
            <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
              <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--brand-border)' }}>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" style={{ color: 'var(--brand-primary-purple)' }} />
                  <h2 className="text-[14px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                    Staff
                  </h2>
                  <span
                    className="inline-flex items-center px-1.5 rounded-full text-[10px] font-bold"
                    style={{ backgroundColor: 'var(--brand-primary-purple-light)', color: 'var(--brand-primary-purple)' }}
                  >
                    {staff.length}
                  </span>
                </div>
                <p className="text-[10.5px]" style={{ color: 'var(--brand-text-muted)' }}>
                  Derived from active patient assignments at this practice.
                </p>
              </div>
              {staff.length === 0 ? (
                <div className="p-8 text-center">
                  <UserPlus className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--brand-text-muted)' }} />
                  <p className="text-[13px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                    No staff yet
                  </p>
                  <p className="text-[12px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
                    Staff appear here when they&apos;re assigned to a patient at this practice (Care team tab on a patient detail).
                  </p>
                </div>
              ) : (
                <ul>
                  {staff.map((s, i) => (
                    <li
                      key={s.id}
                      className="px-5 py-3 flex items-center gap-3"
                      style={{ borderTop: i > 0 ? '1px solid var(--brand-border)' : 'none' }}
                    >
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                        style={{ backgroundColor: 'var(--brand-primary-purple-light)', color: 'var(--brand-primary-purple)' }}
                      >
                        {initialsOf(s.name ?? s.email)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold truncate" style={{ color: 'var(--brand-text-primary)' }}>
                          {s.name ?? 'Unnamed clinician'}
                        </p>
                        <p className="text-[11px] inline-flex items-center gap-1 truncate" style={{ color: 'var(--brand-text-muted)' }}>
                          <Mail className="w-2.5 h-2.5 shrink-0" />
                          {s.email}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1 justify-end shrink-0">
                        {s.slots.map((slot) => (
                          <SlotBadge key={slot} slot={slot} />
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function SlotBadge({ slot }: { slot: StaffSlot }) {
  const chrome = slotChrome(slot);
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ backgroundColor: chrome.bg, color: chrome.color }}
    >
      {chrome.label}
    </span>
  );
}

function slotChrome(slot: StaffSlot): { label: string; color: string; bg: string } {
  switch (slot) {
    case 'PRIMARY':
      return { label: 'Primary', color: 'var(--brand-primary-purple)', bg: 'var(--brand-primary-purple-light)' };
    case 'BACKUP':
      return { label: 'Backup', color: 'var(--brand-accent-teal)', bg: 'var(--brand-accent-teal-light)' };
    case 'MEDICAL_DIRECTOR':
      return { label: 'Med director', color: 'var(--brand-warning-amber)', bg: 'var(--brand-warning-amber-light)' };
  }
}

function Field({ label, required, children }: { label: React.ReactNode; required?: boolean; children: React.ReactNode }) {
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

/** Read-only display of a labelled field. Used by the non-manager view —
 *  same visual rhythm as Field but renders the value as styled text
 *  instead of an editable input. */
function ReadonlyRow({
  label,
  value,
  multiline = false,
}: {
  label: React.ReactNode;
  value: string | null;
  multiline?: boolean;
}) {
  return (
    <div>
      <p className="text-[10.5px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--brand-text-muted)' }}>
        {label}
      </p>
      <p
        className={`text-[13px] ${multiline ? 'leading-relaxed whitespace-pre-wrap' : ''}`}
        style={{ color: 'var(--brand-text-primary)' }}
      >
        {value && value.length > 0 ? value : '—'}
      </p>
    </div>
  );
}
