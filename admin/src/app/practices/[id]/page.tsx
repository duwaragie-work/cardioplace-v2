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
  listClinicians,
  addPracticeProvider,
  removePracticeProvider,
  addPracticeMedicalDirector,
  removePracticeMedicalDirector,
  COMMON_TIMEZONES,
  type Practice,
  type PracticeStaff,
  type StaffSlot,
  type Clinician,
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
  // ── Staff management (May 2026 — PracticeProvider/MD join) ───────────────
  // Inline picker for adding a clinician to this practice. Loaded lazily
  // the first time the user opens the picker so the page-mount fetch stays
  // small. Includes both PROVIDER + MEDICAL_DIRECTOR pools — the role
  // selector below tells the backend which join table to write.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerRole, setPickerRole] = useState<'PROVIDER' | 'MEDICAL_DIRECTOR'>('PROVIDER');
  const [pickerUserId, setPickerUserId] = useState('');
  const [pickerPool, setPickerPool] = useState<Clinician[] | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [staffMutating, setStaffMutating] = useState<string | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);

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

  async function openPicker(role: 'PROVIDER' | 'MEDICAL_DIRECTOR') {
    setPickerRole(role);
    setPickerUserId('');
    setPickerOpen(true);
    setStaffError(null);
    // Lazy-load the global clinician pool on first open. Refetch on role
    // change so we always show only PROVIDERs OR MEDICAL_DIRECTORs (not
    // both — picker role drives both the visible list and the endpoint).
    setPickerLoading(true);
    try {
      const pool = await listClinicians(role);
      setPickerPool(pool);
    } catch (e) {
      setStaffError(e instanceof Error ? e.message : 'Could not load clinicians.');
    } finally {
      setPickerLoading(false);
    }
  }

  async function confirmAddStaff() {
    if (!pickerUserId) return;
    setStaffMutating(pickerUserId);
    setStaffError(null);
    try {
      if (pickerRole === 'PROVIDER') {
        await addPracticeProvider(id, pickerUserId);
      } else {
        await addPracticeMedicalDirector(id, pickerUserId);
      }
      setPickerOpen(false);
      setPickerUserId('');
      // Refresh staff list so the new member appears immediately.
      const refreshed = await listPracticeStaff(id);
      setStaff(refreshed);
    } catch (e) {
      setStaffError(e instanceof Error ? e.message : 'Could not add staff member.');
    } finally {
      setStaffMutating(null);
    }
  }

  async function removeStaff(userId: string, slot: 'PROVIDER' | 'MEDICAL_DIRECTOR') {
    setStaffMutating(userId);
    setStaffError(null);
    try {
      if (slot === 'PROVIDER') {
        await removePracticeProvider(id, userId);
      } else {
        await removePracticeMedicalDirector(id, userId);
      }
      const refreshed = await listPracticeStaff(id);
      setStaff(refreshed);
    } catch (e) {
      setStaffError(e instanceof Error ? e.message : 'Could not remove staff member.');
    } finally {
      setStaffMutating(null);
    }
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
      <div className="p-4 md:p-8 max-w-[1200px] mx-auto space-y-5">
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
                  data-testid="admin-practice-name-input"
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
                    data-testid="admin-practice-hours-start"
                    value={form.businessHoursStart}
                    onChange={(e) => set('businessHoursStart', e.target.value)}
                    className="w-full px-3 h-9 rounded-lg text-[13px] outline-none"
                    style={{ border: '1px solid var(--brand-border)' }}
                  />
                </Field>
                <Field label="Hours end">
                  <input
                    type="time"
                    data-testid="admin-practice-hours-end"
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
                    data-testid="admin-practice-tz-input"
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
                  data-testid="admin-practice-protocol-input"
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
                  style={{ backgroundColor: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red-text)' }}
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
                <button type="button" data-testid="admin-practice-save" onClick={save} disabled={!dirty || saving} className="btn-admin-primary">
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
                    data-testid="admin-practice-readonly"
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
            <div data-testid="admin-practice-staff-list" className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
              <div className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: '1px solid var(--brand-border)' }}>
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
                {canManage && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid="admin-practice-add-provider"
                      onClick={() => openPicker('PROVIDER')}
                      className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg text-[11.5px] font-semibold cursor-pointer"
                      style={{ backgroundColor: 'var(--brand-primary-purple-light)', color: 'var(--brand-primary-purple)' }}
                    >
                      <UserPlus className="w-3 h-3" />
                      Add provider
                    </button>
                    <button
                      type="button"
                      data-testid="admin-practice-add-md"
                      onClick={() => openPicker('MEDICAL_DIRECTOR')}
                      className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg text-[11.5px] font-semibold cursor-pointer"
                      style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber-text)' }}
                    >
                      <ShieldCheck className="w-3 h-3" />
                      Add medical director
                    </button>
                  </div>
                )}
              </div>

              {/* Inline picker — minimal modal-less form. Renders as a
                  panel above the staff list when open. Closes on cancel or
                  successful add. */}
              {pickerOpen && canManage && (
                <div className="px-5 py-4 bg-[#F8F4FF]" style={{ borderBottom: '1px solid var(--brand-border)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[12px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-text-primary)' }}>
                      Add {pickerRole === 'PROVIDER' ? 'provider' : 'medical director'}
                    </p>
                    <button
                      type="button"
                      onClick={() => { setPickerOpen(false); setPickerUserId(''); }}
                      className="text-[11px] font-semibold cursor-pointer"
                      style={{ color: 'var(--brand-text-muted)' }}
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      data-testid="admin-practice-staff-picker"
                      aria-label={pickerRole === 'PROVIDER' ? 'Select provider' : 'Select medical director'}
                      value={pickerUserId}
                      onChange={(e) => setPickerUserId(e.target.value)}
                      disabled={pickerLoading}
                      className="flex-1 min-w-[200px] px-3 h-9 rounded-lg text-[13px] outline-none bg-white"
                      style={{ border: '1px solid var(--brand-border)' }}
                    >
                      <option value="">
                        {pickerLoading
                          ? 'Loading clinicians…'
                          : `— Select ${pickerRole === 'PROVIDER' ? 'provider' : 'medical director'} —`}
                      </option>
                      {pickerPool?.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name ?? c.email}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      data-testid="admin-practice-staff-confirm"
                      onClick={confirmAddStaff}
                      disabled={!pickerUserId || staffMutating !== null}
                      className="btn-admin-primary disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {staffMutating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                      Add
                    </button>
                  </div>
                </div>
              )}

              {staffError && (
                <div
                  className="mx-5 mt-3 rounded-lg px-3 py-2 text-[12px] font-semibold"
                  style={{ backgroundColor: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red-text)' }}
                >
                  {staffError}
                </div>
              )}

              {staff.length === 0 ? (
                <div className="p-8 text-center">
                  <UserPlus className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--brand-text-muted)' }} />
                  <p className="text-[13px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                    No staff yet
                  </p>
                  <p className="text-[12px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
                    {canManage
                      ? 'Add a provider or medical director above to staff this practice.'
                      : 'Staff appear here when an operations admin adds them.'}
                  </p>
                </div>
              ) : (
                <ul>
                  {staff.map((s, i) => {
                    // The remove button only works for join-table memberships
                    // (PracticeProvider / PracticeMedicalDirector). When the
                    // user is only on the list via patient assignments, we
                    // can't unilaterally drop them — they have to be removed
                    // from the patient's Care Team first.
                    const hasMd = s.slots.includes('MEDICAL_DIRECTOR');
                    const hasAssignmentSlot = s.slots.includes('PRIMARY') || s.slots.includes('BACKUP');
                    const hasProviderRole = s.roles.includes('PROVIDER');
                    return (
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
                        {canManage && !hasAssignmentSlot && (
                          <button
                            type="button"
                            data-testid={`admin-practice-staff-remove-${s.id}`}
                            disabled={staffMutating === s.id}
                            onClick={() => removeStaff(s.id, hasMd ? 'MEDICAL_DIRECTOR' : 'PROVIDER')}
                            className="text-[11px] font-semibold px-2 py-1 rounded-md cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                            style={{ color: 'var(--brand-alert-red)' }}
                            title={hasProviderRole && hasMd ? 'Remove both memberships' : 'Remove from practice'}
                          >
                            Remove
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
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
      return { label: 'Med director', color: 'var(--brand-warning-amber-text)', bg: 'var(--brand-warning-amber-light)' };
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
