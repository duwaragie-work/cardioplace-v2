'use client';

// Gap 5 — patient-managed caregiver contacts + consent. Rendered in the
// profile page. A caregiver receives the signed-off caregiver-tier alert
// message (HF edema, angioedema) via their chosen channel ONLY after the
// patient checks the consent box. SMS is captured but labelled "coming soon"
// (no provider wired yet); EMAIL is the live pilot channel.

import { useEffect, useState } from 'react';
import { Users, Plus, Trash2, ShieldCheck, AlertCircle } from 'lucide-react';
import {
  getCaregivers,
  addCaregiver,
  updateCaregiver,
  removeCaregiver,
} from '@/lib/services/caregiver.service';
import type { CaregiverDto, CaregiverNotifyChannelInput } from '@cardioplace/shared';

const CHANNEL_LABELS: Record<CaregiverNotifyChannelInput, string> = {
  NONE: 'Do not notify',
  EMAIL: 'Email',
  SMS: 'Text message (coming soon)',
  DASHBOARD: 'In-app',
};

export default function CaregiversCard() {
  const [caregivers, setCaregivers] = useState<CaregiverDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Add-form state
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [email, setEmail] = useState('');
  const [channel, setChannel] = useState<CaregiverNotifyChannelInput>('EMAIL');
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getCaregivers()
      .then(setCaregivers)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load caregivers'))
      .finally(() => setLoading(false));
  }, []);

  function resetForm() {
    setName('');
    setRelationship('');
    setEmail('');
    setChannel('EMAIL');
    setConsent(false);
    setAdding(false);
  }

  async function handleAdd() {
    if (!name.trim()) {
      setError('Please enter the caregiver’s name.');
      return;
    }
    if (channel === 'EMAIL' && !email.trim()) {
      setError('Email is required to notify by email.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await addCaregiver({
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
      const updated = await updateCaregiver(c.id, { consentGiven: c.consentGivenAt == null });
      setCaregivers((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update consent.');
    }
  }

  async function handleRemove(id: string) {
    setError(null);
    try {
      await removeCaregiver(id);
      setCaregivers((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove caregiver.');
    }
  }

  return (
    <div
      data-testid="profile-caregivers-card"
      className="rounded-2xl bg-white"
      style={{ boxShadow: '0 1px 12px rgba(123,0,224,0.06)', border: '1px solid var(--brand-border)' }}
    >
      <div
        className="flex items-center justify-between gap-3 px-5 pt-4 pb-3"
        style={{ borderBottom: '1px solid var(--brand-border)' }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="shrink-0 rounded-xl flex items-center justify-center"
            style={{ width: 32, height: 32, backgroundColor: 'var(--brand-accent-teal-light)', color: 'var(--brand-accent-teal)' }}
          >
            <Users className="w-4 h-4" />
          </div>
          <h2 className="text-[15px] font-bold truncate" style={{ color: 'var(--brand-text-primary)' }}>
            Caregivers
          </h2>
        </div>
        {!adding && (
          <button
            type="button"
            data-testid="profile-caregiver-add-button"
            onClick={() => { setAdding(true); setError(null); }}
            className="inline-flex items-center gap-1 text-[13px] font-semibold cursor-pointer"
            style={{ color: 'var(--brand-primary-purple)' }}
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        )}
      </div>

      <div className="px-5 py-4 space-y-3">
        <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
          A caregiver is someone you trust — a family member or friend — who can be notified if a
          serious health alert comes up. They’re only contacted for the alerts your care team has
          approved, and only after you give consent.
        </p>

        {error && (
          <div
            className="flex items-start gap-2 rounded-xl px-3 py-2 text-[12.5px]"
            style={{ backgroundColor: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red-text)' }}
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {loading ? (
          <p className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>Loading…</p>
        ) : caregivers.length === 0 && !adding ? (
          <p className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>
            No caregivers added yet.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="profile-caregiver-list">
            {caregivers.map((c) => (
              <li
                key={c.id}
                data-testid={`profile-caregiver-row-${c.id}`}
                className="flex items-start justify-between gap-3 rounded-xl px-3 py-2.5"
                style={{ border: '1px solid var(--brand-border)' }}
              >
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold truncate" style={{ color: 'var(--brand-text-primary)' }}>
                    {c.name}
                    {c.relationship ? (
                      <span className="font-normal" style={{ color: 'var(--brand-text-muted)' }}> · {c.relationship}</span>
                    ) : null}
                  </p>
                  <p className="text-[12px]" style={{ color: 'var(--brand-text-secondary)' }}>
                    {CHANNEL_LABELS[c.notifyChannel]}{c.email ? ` · ${c.email}` : ''}
                  </p>
                  <button
                    type="button"
                    data-testid={`profile-caregiver-consent-${c.id}`}
                    onClick={() => handleToggleConsent(c)}
                    className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold cursor-pointer"
                    style={{ color: c.consentGivenAt ? 'var(--brand-accent-teal)' : 'var(--brand-text-muted)' }}
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {c.consentGivenAt ? 'Consent given — tap to revoke' : 'Consent not given — tap to allow alerts'}
                  </button>
                </div>
                <button
                  type="button"
                  data-testid={`profile-caregiver-remove-${c.id}`}
                  onClick={() => handleRemove(c.id)}
                  className="shrink-0 p-1.5 rounded-lg cursor-pointer"
                  style={{ color: 'var(--brand-alert-red-text)' }}
                  aria-label={`Remove ${c.name}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {adding && (
          <div className="rounded-xl px-3 py-3 space-y-2.5" style={{ border: '1px solid var(--brand-border)', backgroundColor: 'var(--brand-background)' }}>
            <input
              data-testid="profile-caregiver-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Caregiver’s name"
              className="w-full rounded-lg px-3 py-2 text-[13.5px]"
              style={{ border: '1px solid var(--brand-border)' }}
            />
            <input
              data-testid="profile-caregiver-relationship-input"
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              placeholder="Relationship (e.g. daughter) — optional"
              className="w-full rounded-lg px-3 py-2 text-[13.5px]"
              style={{ border: '1px solid var(--brand-border)' }}
            />
            <input
              data-testid="profile-caregiver-email-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              className="w-full rounded-lg px-3 py-2 text-[13.5px]"
              style={{ border: '1px solid var(--brand-border)' }}
            />
            <select
              data-testid="profile-caregiver-channel-select"
              value={channel}
              onChange={(e) => setChannel(e.target.value as CaregiverNotifyChannelInput)}
              className="w-full rounded-lg px-3 py-2 text-[13.5px] bg-white"
              style={{ border: '1px solid var(--brand-border)' }}
            >
              <option value="EMAIL">Notify by email</option>
              <option value="SMS">Notify by text (coming soon)</option>
              <option value="NONE">Don’t notify yet</option>
            </select>
            <label className="flex items-start gap-2 text-[12.5px] cursor-pointer" style={{ color: 'var(--brand-text-secondary)' }}>
              <input
                data-testid="profile-caregiver-consent-checkbox"
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5"
              />
              I agree Cardioplace may share my health alerts with this person.
            </label>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                data-testid="profile-caregiver-save-button"
                onClick={handleAdd}
                disabled={saving}
                className="rounded-full px-4 py-1.5 text-[13px] font-bold text-white disabled:opacity-60 cursor-pointer"
                style={{ backgroundColor: 'var(--brand-primary-purple)' }}
              >
                {saving ? 'Saving…' : 'Save caregiver'}
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
