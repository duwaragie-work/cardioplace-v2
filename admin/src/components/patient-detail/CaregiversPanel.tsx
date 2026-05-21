'use client';

// Gap 5 — admin caregiver visibility + management. Rendered inside the Care
// team tab. Shows each caregiver's name / relationship / channel / consent
// status; allows add + disable. WRITE is gated to the same roles that can
// assign the care team (SUPER_ADMIN, MEDICAL_DIRECTOR, HEALPLACE_OPS) plus
// the assigned PROVIDER — caregiver config is PHI-sharing. Backend RBAC is
// the source of truth; this just hides editor chrome for read-only roles.

import { useCallback, useEffect, useState } from 'react';
import { Users, Plus, Trash2, ShieldCheck, ShieldOff, Loader2 } from 'lucide-react';
import {
  listCaregivers,
  createCaregiver,
  updateCaregiver,
  disableCaregiver,
} from '@/lib/services/caregiver.service';
import { useAuth } from '@/lib/auth-context';
import { canAssignCareTeam } from '@/lib/roleGates';
import type { CaregiverDto, CaregiverNotifyChannelInput } from '@cardioplace/shared';

interface Props {
  patientId: string;
}

const CHANNEL_LABEL: Record<CaregiverNotifyChannelInput, string> = {
  NONE: 'Not notified',
  EMAIL: 'Email',
  SMS: 'SMS (not yet deliverable)',
  DASHBOARD: 'In-app',
};

export default function CaregiversPanel({ patientId }: Props) {
  const { user } = useAuth();
  const canEdit = canAssignCareTeam(user);

  const [caregivers, setCaregivers] = useState<CaregiverDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [email, setEmail] = useState('');
  const [channel, setChannel] = useState<CaregiverNotifyChannelInput>('EMAIL');
  const [consent, setConsent] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    listCaregivers(patientId)
      .then(setCaregivers)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load caregivers'))
      .finally(() => setLoading(false));
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setName(''); setRelationship(''); setEmail('');
    setChannel('EMAIL'); setConsent(false); setAdding(false);
  }

  async function handleAdd() {
    if (!name.trim()) { setError('Name is required.'); return; }
    if (channel === 'EMAIL' && !email.trim()) { setError('Email is required for the email channel.'); return; }
    setSaving(true); setError(null);
    try {
      const created = await createCaregiver(patientId, {
        name: name.trim(),
        relationship: relationship.trim() || null,
        email: email.trim() || null,
        notifyChannel: channel,
        consentGiven: consent,
      });
      setCaregivers((prev) => [...prev, created]);
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add caregiver.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleConsent(c: CaregiverDto) {
    setError(null);
    try {
      const updated = await updateCaregiver(patientId, c.id, {
        consentGiven: c.consentGivenAt == null,
      });
      setCaregivers((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update consent.');
    }
  }

  async function handleDisable(id: string) {
    setError(null);
    try {
      await disableCaregiver(patientId, id);
      setCaregivers((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove caregiver.');
    }
  }

  return (
    <div
      data-testid="admin-caregivers-panel"
      className="rounded-2xl bg-white mt-4"
      style={{ boxShadow: '0 1px 12px rgba(123,0,224,0.06)', border: '1px solid var(--brand-border)' }}
    >
      <div
        className="flex items-center justify-between gap-3 px-5 pt-4 pb-3"
        style={{ borderBottom: '1px solid var(--brand-border)' }}
      >
        <div className="flex items-center gap-2.5">
          <Users className="w-4 h-4" style={{ color: 'var(--brand-accent-teal)' }} />
          <h3 className="text-[14px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
            Caregivers
          </h3>
        </div>
        {canEdit && !adding && (
          <button
            type="button"
            data-testid="admin-caregiver-add-button"
            onClick={() => { setAdding(true); setError(null); }}
            className="inline-flex items-center gap-1 text-[13px] font-semibold cursor-pointer"
            style={{ color: 'var(--brand-primary-purple)' }}
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        )}
      </div>

      <div className="px-5 py-4 space-y-3">
        {error && (
          <div
            className="rounded-lg px-3 py-2 text-[12.5px]"
            style={{ backgroundColor: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red-text)' }}
          >
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : caregivers.length === 0 && !adding ? (
          <p className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>
            No caregivers on file for this patient.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="admin-caregiver-list">
            {caregivers.map((c) => (
              <li
                key={c.id}
                data-testid={`admin-caregiver-row-${c.id}`}
                className="flex items-start justify-between gap-3 rounded-xl px-3 py-2.5"
                style={{ border: '1px solid var(--brand-border)' }}
              >
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                    {c.name}
                    {c.relationship ? (
                      <span className="font-normal" style={{ color: 'var(--brand-text-muted)' }}> · {c.relationship}</span>
                    ) : null}
                  </p>
                  <p className="text-[12px]" style={{ color: 'var(--brand-text-secondary)' }}>
                    {CHANNEL_LABEL[c.notifyChannel]}{c.email ? ` · ${c.email}` : ''}
                  </p>
                  <span
                    className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold"
                    style={{ color: c.consentGivenAt ? 'var(--brand-accent-teal)' : 'var(--brand-warning-amber-text)' }}
                  >
                    {c.consentGivenAt ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldOff className="w-3.5 h-3.5" />}
                    {c.consentGivenAt ? 'Consent on file' : 'No consent — will not be notified'}
                  </span>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      data-testid={`admin-caregiver-consent-${c.id}`}
                      onClick={() => handleToggleConsent(c)}
                      className="text-[11.5px] font-semibold px-2 py-1 rounded-lg cursor-pointer"
                      style={{ color: 'var(--brand-primary-purple)' }}
                    >
                      {c.consentGivenAt ? 'Revoke' : 'Record consent'}
                    </button>
                    <button
                      type="button"
                      data-testid={`admin-caregiver-remove-${c.id}`}
                      onClick={() => handleDisable(c.id)}
                      className="p-1.5 rounded-lg cursor-pointer"
                      style={{ color: 'var(--brand-alert-red-text)' }}
                      aria-label={`Remove ${c.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {adding && canEdit && (
          <div className="rounded-xl px-3 py-3 space-y-2.5" style={{ border: '1px solid var(--brand-border)', backgroundColor: 'var(--brand-background)' }}>
            <input
              data-testid="admin-caregiver-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Caregiver name"
              className="w-full rounded-lg px-3 py-2 text-[13.5px]"
              style={{ border: '1px solid var(--brand-border)' }}
            />
            <input
              data-testid="admin-caregiver-relationship-input"
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              placeholder="Relationship (optional)"
              className="w-full rounded-lg px-3 py-2 text-[13.5px]"
              style={{ border: '1px solid var(--brand-border)' }}
            />
            <input
              data-testid="admin-caregiver-email-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full rounded-lg px-3 py-2 text-[13.5px]"
              style={{ border: '1px solid var(--brand-border)' }}
            />
            <select
              data-testid="admin-caregiver-channel-select"
              value={channel}
              onChange={(e) => setChannel(e.target.value as CaregiverNotifyChannelInput)}
              className="w-full rounded-lg px-3 py-2 text-[13.5px] bg-white"
              style={{ border: '1px solid var(--brand-border)' }}
            >
              <option value="EMAIL">Email</option>
              <option value="SMS">SMS (not yet deliverable)</option>
              <option value="NONE">Do not notify yet</option>
            </select>
            <label className="flex items-start gap-2 text-[12.5px] cursor-pointer" style={{ color: 'var(--brand-text-secondary)' }}>
              <input
                data-testid="admin-caregiver-consent-checkbox"
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5"
              />
              Patient has consented to sharing health alerts with this caregiver.
            </label>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                data-testid="admin-caregiver-save-button"
                onClick={handleAdd}
                disabled={saving}
                className="rounded-full px-4 py-1.5 text-[13px] font-bold text-white disabled:opacity-60 cursor-pointer"
                style={{ backgroundColor: 'var(--brand-primary-purple)' }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="rounded-full px-4 py-1.5 text-[13px] font-semibold cursor-pointer"
                style={{ color: 'var(--brand-text-secondary)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
