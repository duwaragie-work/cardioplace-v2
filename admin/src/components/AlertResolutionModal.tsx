'use client';

// Alert resolution modal (Flow G — Tier 1 / Tier 2 / BP Level 2 variants).
// One component, three behavioral modes keyed off the alert's tier:
//   • TIER_1                  — 5 actions, rationale REQUIRED for all
//   • TIER_2                  — 5 actions, rationale required only for
//                                "reviewed — no action needed"
//   • BP_LEVEL_2 / SYMPTOM    — 6 actions, rationale required for all;
//                                #6 "unable to reach" leaves alert OPEN
//                                and schedules a fresh T+4h escalation
//
// Posts to POST /api/admin/alerts/:id/resolve via resolveAlert().

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, Pill, ArrowUp, Loader2, CheckCircle2, Lock } from 'lucide-react';
import {
  RESOLUTION_CATALOG,
  actionsForTier,
  resolveAlert,
  resolutionTierFor,
  type AlertTier,
  type ResolutionAction,
} from '@/lib/services/provider.service';

export interface ResolvableAlert {
  id: string;
  tier: AlertTier | string | null;
  patient: { name: string | null } | null;
  patientMessage?: string | null;
  journalEntry?: {
    systolicBP?: number | null;
    diastolicBP?: number | null;
    entryDate?: string | Date | null;
  } | null;
  createdAt: string | Date;
}

interface Props {
  alert: ResolvableAlert | null;
  open: boolean;
  onClose: () => void;
  onResolved: (id: string, result: { status: 'RESOLVED' | 'OPEN'; retryScheduledFor?: string }) => void;
}

function variantChromeFor(tier: AlertTier | string | null): {
  accent: string;
  accentText: string;
  accentLight: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
} {
  const group = resolutionTierFor(tier);
  if (group === 'TIER_1_ANGIOEDEMA') {
    return {
      accent: 'var(--brand-alert-red)',
      accentText: 'var(--brand-alert-red-text)',
      accentLight: 'var(--brand-alert-red-light)',
      icon: <AlertTriangle className="w-4 h-4" />,
      title: 'Resolve angioedema alert',
      subtitle: 'Airway emergency — non-dismissable.',
    };
  }
  if (group === 'BP_LEVEL_2') {
    return {
      accent: 'var(--brand-alert-red)',
      accentText: 'var(--brand-alert-red-text)',
      accentLight: 'var(--brand-alert-red-light)',
      icon: <AlertTriangle className="w-4 h-4" />,
      title: 'Resolve BP Level 2 alert',
      subtitle: 'Patient is in the emergency BP range.',
    };
  }
  if (group === 'TIER_1') {
    return {
      accent: 'var(--brand-alert-red)',
      accentText: 'var(--brand-alert-red-text)',
      accentLight: 'var(--brand-alert-red-light)',
      icon: <Pill className="w-4 h-4" />,
      title: 'Resolve Tier 1 contraindication',
      subtitle: 'Medication safety alert — non-dismissable.',
    };
  }
  if (group === 'TIER_2') {
    return {
      accent: 'var(--brand-warning-amber)',
      accentText: 'var(--brand-warning-amber-text)',
      accentLight: 'var(--brand-warning-amber-light)',
      icon: <ArrowUp className="w-4 h-4" />,
      title: 'Resolve Tier 2 discrepancy',
      subtitle: 'Medication reconciliation note.',
    };
  }
  return {
    accent: 'var(--brand-text-muted)',
    accentText: 'var(--brand-text-muted)',
    accentLight: 'var(--brand-background)',
    icon: <AlertTriangle className="w-4 h-4" />,
    title: 'Resolve alert',
    subtitle: '',
  };
}

export default function AlertResolutionModal({ alert, open, onClose, onResolved }: Props) {
  const [action, setAction] = useState<ResolutionAction | ''>('');
  const [rationale, setRationale] = useState('');
  // Manisha 5/24 Q4 — angioedema sub-field answers (willGo, facility, etc.).
  const [details, setDetails] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reset form when modal opens for a different alert.
  useEffect(() => {
    if (open && alert) {
      setAction('');
      setRationale('');
      setDetails({});
      setError('');
      setSubmitting(false);
    }
  }, [open, alert?.id, alert]);

  const availableActions = useMemo(() => actionsForTier(alert?.tier ?? null), [alert?.tier]);
  const variant = variantChromeFor(alert?.tier ?? null);
  const actionDef = action ? RESOLUTION_CATALOG[action] : null;
  const rationaleRequired = actionDef?.requiresRationale ?? false;
  const willTriggerRetry = actionDef?.triggersBpL2Retry ?? false;
  const subFields = actionDef?.subFields ?? [];

  // Required sub-fields must be answered before submit (mirrors backend
  // missingRequiredSubFields). yesno = boolean answer; text = non-empty string.
  const subFieldsComplete = subFields
    .filter((f) => f.required)
    .every((f) => {
      const v = details[f.key];
      return f.kind === 'yesno'
        ? v === true || v === false
        : typeof v === 'string' && v.trim().length > 0;
    });

  // Reset sub-field answers whenever the chosen action changes.
  function chooseAction(key: ResolutionAction) {
    setAction(key);
    setDetails({});
  }

  // Tier 1 + angioedema are non-dismissable per Flow G spec: backdrop click,
  // Escape key, and X button are all disabled. The provider must explicitly
  // choose Cancel or submit a resolution. (Cancel is still allowed so providers
  // don't get locked out if they opened the wrong alert by mistake.)
  const tierGroup = resolutionTierFor(alert?.tier ?? null);
  const isNonDismissable = tierGroup === 'TIER_1' || tierGroup === 'TIER_1_ANGIOEDEMA';

  const canSubmit =
    !!action &&
    !submitting &&
    (!rationaleRequired || rationale.trim().length > 0) &&
    subFieldsComplete;

  // Escape key closes the modal — except for Tier 1 (non-dismissable).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isNonDismissable && !submitting) {
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isNonDismissable, submitting, onClose]);

  async function handleSubmit() {
    if (!alert || !action || !canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await resolveAlert(
        alert.id,
        action,
        rationale.trim() || undefined,
        subFields.length > 0 ? details : undefined,
      );
      onResolved(alert.id, result);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save resolution.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AnimatePresence>
      {open && alert && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ backgroundColor: 'rgba(15,23,42,0.5)' }}
        >
          <div
            className="absolute inset-0"
            onClick={isNonDismissable ? undefined : onClose}
            style={{ cursor: isNonDismissable ? 'not-allowed' : 'pointer' }}
            aria-hidden
          />
          <motion.div
            data-testid="admin-resolve-modal"
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
            className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl rounded-t-2xl flex flex-col overflow-hidden"
            style={{
              maxHeight: '92dvh',
              boxShadow: '0 8px 48px rgba(0,0,0,0.18)',
            }}
          >
            {/* Header */}
            <div
              className="shrink-0 flex items-start justify-between gap-3 px-5 pt-4 pb-3"
              style={{ borderBottom: '1px solid var(--brand-border)' }}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <div
                  className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-white"
                  style={{ backgroundColor: variant.accent }}
                  aria-hidden
                >
                  {variant.icon}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h2 className="text-[15px] font-bold leading-tight" style={{ color: 'var(--brand-text-primary)' }}>
                      {variant.title}
                    </h2>
                    {isNonDismissable && (
                      <span
                        className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: variant.accent,
                          color: 'white',
                        }}
                      >
                        <Lock className="w-2.5 h-2.5" />
                        Action required
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--brand-text-muted)' }}>
                    {alert.patient?.name ?? 'Unknown patient'}
                    {alert.journalEntry?.systolicBP != null && alert.journalEntry?.diastolicBP != null && (
                      <span className="ml-2 font-semibold" style={{ color: variant.accentText }}>
                        {alert.journalEntry.systolicBP}/{alert.journalEntry.diastolicBP} mmHg
                      </span>
                    )}
                  </p>
                </div>
              </div>
              {!isNonDismissable && (
                <button
                  type="button"
                  onClick={onClose}
                  className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
                </button>
              )}
            </div>

            {/* Body — scroll inside */}
            <div className="flex-1 overflow-y-auto thin-scrollbar p-5 space-y-4">
              {alert.patientMessage && (
                <div
                  data-testid="admin-resolve-patient-message"
                  className="rounded-lg p-3 text-[12.5px] leading-relaxed"
                  style={{
                    backgroundColor: variant.accentLight,
                    color: 'var(--brand-text-primary)',
                  }}
                >
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: variant.accentText }}>
                    Patient-facing message
                  </p>
                  {alert.patientMessage}
                </div>
              )}

              <div>
                <p className="text-[12px] font-semibold mb-2" style={{ color: 'var(--brand-text-secondary)' }}>
                  Resolution action
                </p>
                {availableActions.length === 0 ? (
                  <p className="text-[12.5px]" style={{ color: 'var(--brand-text-muted)' }}>
                    No resolution catalog for this alert tier yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {availableActions.map((key) => {
                      const def = RESOLUTION_CATALOG[key];
                      const selected = action === key;
                      return (
                        <button
                          key={key}
                          data-testid={`admin-resolve-action-${key}`}
                          type="button"
                          onClick={() => chooseAction(key)}
                          className="w-full text-left rounded-lg p-3 transition-colors cursor-pointer"
                          style={{
                            backgroundColor: selected ? variant.accentLight : 'white',
                            border: `1.5px solid ${selected ? variant.accent : 'var(--brand-border)'}`,
                          }}
                        >
                          <div className="flex items-start gap-2.5">
                            <div
                              className="shrink-0 mt-0.5 w-4 h-4 rounded-full flex items-center justify-center transition-colors"
                              style={{
                                backgroundColor: selected ? variant.accent : 'transparent',
                                border: `2px solid ${selected ? variant.accent : 'var(--brand-border)'}`,
                              }}
                            >
                              {selected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p
                                className="text-[13px] font-semibold leading-snug"
                                style={{
                                  color: selected ? variant.accentText : 'var(--brand-text-primary)',
                                  wordBreak: 'break-word',
                                }}
                              >
                                {def.label}
                              </p>
                              {def.description && (
                                <p
                                  className="text-[11.5px] mt-0.5 leading-snug"
                                  style={{ color: 'var(--brand-text-muted)', wordBreak: 'break-word' }}
                                >
                                  {def.description}
                                </p>
                              )}
                              <div className="mt-1 flex items-center gap-2">
                                {def.requiresRationale && (
                                  <span
                                    className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                                    style={{
                                      backgroundColor: 'var(--brand-warning-amber-light)',
                                      color: 'var(--brand-warning-amber-text)',
                                    }}
                                  >
                                    Rationale required
                                  </span>
                                )}
                                {def.triggersBpL2Retry && (
                                  <span
                                    className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                                    style={{
                                      backgroundColor: 'var(--brand-primary-purple-light)',
                                      color: 'var(--brand-primary-purple)',
                                    }}
                                  >
                                    Schedules T+4h retry
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {actionDef?.warnSideEffect && (
                <div
                  data-testid="admin-resolve-side-effect-warning"
                  className="rounded-lg p-3 text-[12px] leading-relaxed flex items-start gap-2"
                  style={{
                    backgroundColor: 'var(--brand-alert-red-light)',
                    color: 'var(--brand-alert-red-text)',
                  }}
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{actionDef.warnSideEffect}</span>
                </div>
              )}

              {action && subFields.length > 0 && (
                <div className="space-y-3" data-testid="admin-resolve-subfields">
                  {subFields.map((f) => (
                    <div key={f.key}>
                      <label
                        className="block text-[12px] font-semibold mb-1.5"
                        style={{ color: 'var(--brand-text-secondary)' }}
                      >
                        {f.label}
                        {f.required ? (
                          <span style={{ color: 'var(--brand-alert-red)' }}> · required</span>
                        ) : (
                          <span className="font-normal" style={{ color: 'var(--brand-text-muted)' }}> · optional</span>
                        )}
                      </label>
                      {f.kind === 'yesno' ? (
                        <div className="flex gap-2">
                          {([['YES', true], ['NO', false]] as [string, boolean][]).map(([lbl, val]) => {
                            const selected = details[f.key] === val;
                            return (
                              <button
                                key={lbl}
                                type="button"
                                data-testid={`admin-resolve-subfield-${f.key}-${lbl.toLowerCase()}`}
                                onClick={() => setDetails((d) => ({ ...d, [f.key]: val }))}
                                className="flex-1 rounded-lg py-2 text-[13px] font-semibold cursor-pointer transition-colors"
                                style={{
                                  backgroundColor: selected ? variant.accentLight : 'white',
                                  border: `1.5px solid ${selected ? variant.accent : 'var(--brand-border)'}`,
                                  color: selected ? variant.accentText : 'var(--brand-text-primary)',
                                }}
                              >
                                {lbl}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <input
                          type="text"
                          data-testid={`admin-resolve-subfield-${f.key}`}
                          value={typeof details[f.key] === 'string' ? (details[f.key] as string) : ''}
                          onChange={(e) => setDetails((d) => ({ ...d, [f.key]: e.target.value }))}
                          placeholder={f.label}
                          className="w-full px-3 py-2 rounded-lg text-[13px] outline-none"
                          style={{
                            border: '1.5px solid var(--brand-border)',
                            color: 'var(--brand-text-primary)',
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {action && (
                <div>
                  <label
                    className="block text-[12px] font-semibold mb-1.5"
                    style={{ color: 'var(--brand-text-secondary)' }}
                  >
                    Clinical rationale
                    {rationaleRequired ? (
                      <span style={{ color: 'var(--brand-alert-red)' }}> · required</span>
                    ) : (
                      <span className="font-normal" style={{ color: 'var(--brand-text-muted)' }}> · optional</span>
                    )}
                  </label>
                  <textarea
                    data-testid="admin-resolve-rationale"
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    placeholder={
                      willTriggerRetry
                        ? 'e.g. Called twice — voicemail full. Will retry at T+4h with backup provider.'
                        : 'Brief clinical note for the audit trail.'
                    }
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg text-[13px] outline-none resize-y leading-relaxed"
                    style={{
                      border: '1.5px solid var(--brand-border)',
                      color: 'var(--brand-text-primary)',
                    }}
                  />
                </div>
              )}
            </div>

            {/* Footer */}
            <div
              className="shrink-0 px-5 py-3"
              style={{ borderTop: '1px solid var(--brand-border)' }}
            >
              {error && (
                <p
                  className="text-[12.5px] font-semibold text-center mb-2 px-3 py-1.5 rounded-lg"
                  style={{ color: 'var(--brand-alert-red-text)', backgroundColor: 'var(--brand-alert-red-light)' }}
                >
                  {error}
                </p>
              )}
              <div className="flex gap-3">
                <button
                  data-testid="admin-resolve-cancel"
                  type="button"
                  onClick={onClose}
                  className="btn-admin-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  data-testid="admin-resolve-confirm"
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="btn-admin-primary flex-1"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Saving…
                    </>
                  ) : willTriggerRetry ? (
                    <>Schedule retry</>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Resolve alert
                    </>
                  )}
                </button>
              </div>
              {!canSubmit && action && rationaleRequired && rationale.trim().length === 0 && (
                <p
                  className="text-[11px] mt-2 text-center"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  Rationale is required for this action.
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Subtitle is exported for callers that want to show the same blurb. */
export { variantChromeFor };
