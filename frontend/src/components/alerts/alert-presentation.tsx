// Shared alert presentation helper. Both TierAlertView (full-screen alert
// detail) and the dashboard ACTIVE-ALERT banner consume this so the chrome /
// title / icon for any (tier, ruleId) pair stays in lockstep across both
// surfaces. Adding an override for a new rule is a single entry in
// RULE_OVERRIDES — no code fork.
//
// Manual-test round 2 Group A1 (Manisha sign-off pending): the prior
// `variantFor(tier)` keyed solely on tier, so RULE_HF_DECOMPENSATION (which the
// engine emits with tier BP_LEVEL_1_LOW because it claims the sbp-low axis)
// inherited the full low-BP template — blue chrome, ArrowDown icon, title
// "Your blood pressure is low.", hypotension footer ("stand up slowly / salty
// snack"). Clinically wrong: HF-decompensation at 151/86 is not low BP. This
// helper layers a ruleId override on top of the tier branch so the alert
// renders as a fluid/attention alert (amber + Heart + neutral title) without
// breaking literal low-BP readings.

import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Heart,
  Pill,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { AlertTier } from '@/lib/services/journal.service';

export type AlertVariantKey =
  | 'emergency'
  | 'tier1'
  | 'high'
  | 'low'
  | 'info'
  | 'attention';

export interface AlertPresentation {
  key: AlertVariantKey;
  accent: string;          // border + accent color (CSS var or hex)
  accentLight: string;     // tinted background
  accentText: string;      // readable text-on-tint
  Icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  defaultBody: string;
  footer: string;
  followUp: string;
}

interface Input {
  tier: AlertTier | null | undefined;
  ruleId?: string | null;
}

// Per-rule overrides applied on top of the tier-derived base.
const RULE_OVERRIDES: Record<string, Partial<AlertPresentation>> = {
  // Manisha 5/24 round 2 A1 (sign-off pending) — provisional amber + Heart +
  // neutral title. The body comes from the rule's own patientMessage when
  // present (TierAlertView passes it in); defaultBody is the safe fallback.
  // Color/icon/title are the three knobs Dr. Singal can veto — swap them here
  // and both surfaces follow.
  RULE_HF_DECOMPENSATION: {
    key: 'attention',
    accent: 'var(--brand-warning-amber)',
    accentLight: 'var(--brand-warning-amber-light)',
    accentText: 'var(--brand-warning-amber-text)',
    Icon: Heart,
    title: 'Your care team needs to know about this.',
    defaultBody:
      'You reported swelling or weight gain. Your care team is watching for signs that fluid is building up. Please contact your care team today.',
    footer: 'Your care team will reach out to discuss next steps.',
    followUp:
      'Weigh yourself daily and watch for new or worsening swelling. Call your care team if you feel short of breath or your weight jumps.',
  },
};

export function getAlertPresentation({ tier, ruleId }: Input): AlertPresentation {
  const base = variantForTier(tier);
  const override = ruleId ? RULE_OVERRIDES[ruleId] : undefined;
  return override ? { ...base, ...override } : base;
}

function variantForTier(tier: AlertTier | null | undefined): AlertPresentation {
  switch (tier) {
    // Cluster 8 — ACE-angioedema airway emergency. Most urgent red treatment;
    // the registry patientMessage carries the exact approved 911 wording —
    // these are the fallback strings.
    case 'TIER_1_ANGIOEDEMA':
      return {
        key: 'emergency',
        accent: 'var(--brand-alert-red)',
        accentLight: 'var(--brand-alert-red-light)',
        accentText: 'var(--brand-alert-red-text)',
        Icon: AlertTriangle,
        title: 'Urgent — get medical help now.',
        defaultBody:
          'You reported swelling of your face, lips, or tongue, or throat tightness. If you have trouble breathing or your throat feels tight, call 911 now. Otherwise go to the nearest emergency room now.',
        footer:
          'This can be a dangerous reaction. Your care team has been notified. Do not take any more of your blood pressure medicine until your doctor tells you it is safe.',
        followUp:
          'Do not wait. Call 911 or go to the emergency room now if you have any trouble breathing or throat tightness.',
      };
    case 'BP_LEVEL_2':
    case 'BP_LEVEL_2_SYMPTOM_OVERRIDE':
      return {
        key: 'emergency',
        accent: 'var(--brand-alert-red)',
        accentLight: 'var(--brand-alert-red-light)',
        accentText: 'var(--brand-alert-red-text)',
        Icon: AlertTriangle,
        title: 'Critical blood pressure reading.',
        defaultBody:
          'This reading was in the emergency range. If you have chest pain, severe headache, difficulty breathing, or vision changes right now, call 911.',
        footer:
          "Your care team has been notified. Please don't change any medicine without talking to your doctor.",
        followUp:
          'Recheck your blood pressure in 15 minutes while sitting quietly. If it stays this high or you develop symptoms, call 911.',
      };
    case 'TIER_1_CONTRAINDICATION':
      return {
        key: 'tier1',
        accent: 'var(--brand-alert-red)',
        accentLight: 'var(--brand-alert-red-light)',
        accentText: 'var(--brand-alert-red-text)',
        Icon: Pill,
        title: 'Important medication alert.',
        defaultBody:
          "Your reported medications and conditions look like they need a closer look. Please don't stop or change any medicine without talking to your doctor.",
        footer:
          "Your care team has been notified and will contact you within the day. Please don't stop any medicine without talking to your doctor.",
        followUp:
          'A care-team member will reach out today. Keep taking your medicines as prescribed until you hear from them.',
      };
    case 'BP_LEVEL_1_HIGH':
      return {
        key: 'high',
        accent: 'var(--brand-warning-amber)',
        accentLight: 'var(--brand-warning-amber-light)',
        accentText: 'var(--brand-warning-amber-text)',
        Icon: ArrowUp,
        title: 'Your blood pressure is elevated.',
        defaultBody:
          'Your latest reading is higher than your usual range. Sit quietly for 5 minutes and take it again.',
        footer: 'Your care team will review within 24 hours.',
        followUp:
          'Stay hydrated, avoid caffeine for the next few hours, and recheck before bed.',
      };
    case 'BP_LEVEL_1_LOW':
      return {
        key: 'low',
        accent: '#3B82F6',
        accentLight: '#DBEAFE',
        accentText: '#1D4ED8',
        Icon: ArrowDown,
        title: 'Your blood pressure is low.',
        defaultBody:
          'Your latest reading is lower than your usual range. If you feel dizzy or lightheaded, sit down or lie down right away.',
        footer:
          'Your care team will review this. Stand up slowly and stay hydrated.',
        followUp:
          'If you feel faint, get to a safe seated position. Eat a small salty snack and drink water.',
      };
    case 'TIER_3_INFO':
      return {
        key: 'info',
        accent: 'var(--brand-success-green)',
        accentLight: 'var(--brand-success-green-light)',
        accentText: 'var(--brand-success-green)',
        Icon: Heart,
        title: 'For your information.',
        defaultBody:
          'A small note from your care team about your most recent reading.',
        footer: 'No action needed right now.',
        followUp:
          'Keep up your regular check-ins. Your care team is watching.',
      };
    // F32 — patient-visible Tier 2 medication-discrepancy (e.g. the A5-3
    // beta-blocker carve-out). The real patientMessage from the rule registry
    // carries the approved wording; these strings are only the chrome + safe
    // fallback. Pill icon + neutral info treatment ranks it below BP alerts.
    case 'TIER_2_DISCREPANCY':
      return {
        key: 'info',
        accent: 'var(--brand-primary-purple)',
        accentLight: 'var(--brand-primary-purple-light)',
        accentText: 'var(--brand-primary-purple)',
        Icon: Pill,
        title: 'Medication check-in.',
        defaultBody:
          'Your care team noticed something about your medications worth a quick check-in.',
        footer: 'Please follow the guidance above and keep taking your medicines as prescribed.',
        followUp:
          'Keep up your regular check-ins. Your care team is watching.',
      };
    default:
      return {
        key: 'info',
        accent: 'var(--brand-text-muted)',
        accentLight: 'var(--brand-background)',
        accentText: 'var(--brand-text-secondary)',
        Icon: AlertCircle,
        title: 'Care-team notice.',
        defaultBody: 'Your care team has noted this reading.',
        footer: 'They will follow up if anything needs attention.',
        followUp: 'Continue your regular check-ins.',
      };
  }
}
