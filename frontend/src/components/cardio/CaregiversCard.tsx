'use client';

// Gap 5 — patient-managed caregiver contacts + consent. Rendered in the
// profile page. A caregiver receives the signed-off caregiver-tier alert
// message (HF edema, angioedema) by EMAIL ONLY after the patient checks the
// consent box. Per CROSS_HANDOFF_ADDENDUM_2026_06_03 Decision 2, caregivers
// are email-only for MVP — no SMS, no caregiver app access. All copy is i18n'd
// via the caregiver.* namespace.

import { useEffect, useState } from 'react';
import { Users, Plus, Trash2, ShieldCheck, ShieldOff, AlertCircle, Loader2 } from 'lucide-react';
import {
  getCaregivers,
  addCaregiver,
  updateCaregiver,
  removeCaregiver,
} from '@/lib/services/caregiver.service';
import type { CaregiverDto, CaregiverNotifyChannelInput } from '@cardioplace/shared';
import { useLanguage } from '@/contexts/LanguageContext';

export default function CaregiversCard() {
  const { t } = useLanguage();
  // Addendum Decision 2 — caregivers are EMAIL-ONLY for MVP. The add-form only
  // offers EMAIL/NONE; any legacy channel falls back to the email label.
  const channelLabel = (ch: CaregiverNotifyChannelInput): string =>
    ch === 'NONE' ? t('caregiver.channelNone') : t('caregiver.channelEmail');
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
      .catch((e) => setError(e instanceof Error ? e.message : t('caregiver.errLoad')))
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
      setError(t('caregiver.errNameRequired'));
      return;
    }
    if (channel === 'EMAIL' && !email.trim()) {
      setError(t('caregiver.errEmailRequired'));
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
      setError(e instanceof Error ? e.message : t('caregiver.errAdd'));
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
      setError(e instanceof Error ? e.message : t('caregiver.errConsent'));
    }
  }

  async function handleRemove(id: string) {
    setError(null);
    try {
      await removeCaregiver(id);
      setCaregivers((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('caregiver.errRemove'));
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
            {t('caregiver.title')}
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
            <Plus className="w-4 h-4" /> {t('caregiver.add')}
          </button>
        )}
      </div>

      <div className="px-5 py-4 space-y-3">
        <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
          {t('caregiver.description')}
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
          // Round 2 D1 — mirror admin CaregiversPanel's spinner loading state
          // (was plain "Loading…" text) for visual parity across surfaces.
          <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>
            <Loader2 className="w-4 h-4 animate-spin" /> {t('caregiver.loading')}
          </div>
        ) : caregivers.length === 0 && !adding ? (
          <p className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>
            {t('caregiver.empty')}
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
                {/* F14 — mirror admin CaregiversPanel's row layout: consent shows
                    as a compact STATUS line on the left (no longer an oversized
                    full-width toggle button) and the actions group on the right.
                    Patient-friendly wording is kept (per Duwaragie) — short
                    "Allow"/"Revoke" CTAs instead of admin's "Record consent". */}
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold truncate" style={{ color: 'var(--brand-text-primary)' }}>
                    {c.name}
                    {c.relationship ? (
                      <span className="font-normal" style={{ color: 'var(--brand-text-muted)' }}> · {c.relationship}</span>
                    ) : null}
                  </p>
                  <p className="text-[12px]" style={{ color: 'var(--brand-text-secondary)' }}>
                    {channelLabel(c.notifyChannel)}{c.email ? ` · ${c.email}` : ''}
                  </p>
                  <span
                    data-testid={`profile-caregiver-consent-status-${c.id}`}
                    className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold"
                    style={{ color: c.consentGivenAt ? 'var(--brand-accent-teal)' : 'var(--brand-warning-amber-text)' }}
                  >
                    {c.consentGivenAt ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldOff className="w-3.5 h-3.5" />}
                    {c.consentGivenAt ? t('caregiver.consentGiven') : t('caregiver.consentNone')}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    data-testid={`profile-caregiver-consent-${c.id}`}
                    onClick={() => handleToggleConsent(c)}
                    className="text-[11.5px] font-semibold px-2 py-1 rounded-lg cursor-pointer"
                    style={{ color: 'var(--brand-primary-purple)' }}
                  >
                    {c.consentGivenAt ? t('caregiver.revoke') : t('caregiver.allow')}
                  </button>
                  <button
                    type="button"
                    data-testid={`profile-caregiver-remove-${c.id}`}
                    onClick={() => handleRemove(c.id)}
                    className="p-1.5 rounded-lg cursor-pointer"
                    style={{ color: 'var(--brand-alert-red-text)' }}
                    aria-label={t('caregiver.removeAria').replace('{name}', c.name)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
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
              placeholder={t('caregiver.namePlaceholder')}
              className="w-full rounded-lg px-3 py-2 text-[13.5px]"
              style={{ border: '1px solid var(--brand-border)' }}
            />
            <input
              data-testid="profile-caregiver-relationship-input"
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              placeholder={t('caregiver.relationshipPlaceholder')}
              className="w-full rounded-lg px-3 py-2 text-[13.5px]"
              style={{ border: '1px solid var(--brand-border)' }}
            />
            <input
              data-testid="profile-caregiver-email-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('caregiver.emailPlaceholder')}
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
              {/* Cross-Handoff Addendum Decision 2 — caregivers are EMAIL-ONLY
                  for MVP (no SMS dispatch). The "Notify by text (coming soon)"
                  option over-promised a channel that isn't implemented, so it's
                  removed rather than left as a dead/teaser choice. */}
              <option value="EMAIL">{t('caregiver.optionEmail')}</option>
              <option value="NONE">{t('caregiver.optionNone')}</option>
            </select>
            <label className="flex items-start gap-2 text-[12.5px] cursor-pointer" style={{ color: 'var(--brand-text-secondary)' }}>
              <input
                data-testid="profile-caregiver-consent-checkbox"
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                // #79 — was an unstyled browser default (oversized + bright
                // accent, ate horizontal space so the label wrapped oddly on
                // mobile). Constrain to a 16px square that doesn't shrink, with
                // the brand purple accent to match the rest of the form.
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand-primary-purple)] cursor-pointer"
              />
              {t('caregiver.consentLabel')}
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
                {saving ? t('caregiver.saving') : t('caregiver.save')}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="rounded-full px-4 py-1.5 text-[13px] font-semibold cursor-pointer"
                style={{ color: 'var(--brand-text-secondary)' }}
              >
                {t('caregiver.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
