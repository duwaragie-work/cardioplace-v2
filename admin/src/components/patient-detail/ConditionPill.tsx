'use client';

// v2 — renders one condition tag from derivePatientConditions as a colored
// pill. The pill color is driven by `severity`, so providers can scan a
// patient's clinical priority without reading every label:
//
//   critical  → red, mandatory provider config / different threshold table
//   elevated  → amber, recommended config / notation flag
//   standard  → neutral, standard adult threshold table applies
//
// Used by the patient detail header; the patient list rows can drop in
// the same component once we switch them off the legacy primaryCondition
// string.

import type { ConditionTag, ConditionSeverity } from './PatientDetailShell';

interface SeverityStyle {
  background: string;
  foreground: string;
  /** Rationale shown on hover — explains why the tag has this severity so
   *  a provider scanning the row knows whether the threshold table is
   *  different (critical), notational (elevated), or standard. */
  tooltip: string;
}

const SEVERITY_STYLES: Record<ConditionSeverity, SeverityStyle> = {
  critical: {
    background: 'var(--brand-alert-red-light)',
    foreground: 'var(--brand-alert-red)',
    tooltip: 'Different threshold table or mandatory provider configuration.',
  },
  elevated: {
    background: 'var(--brand-warning-amber-light)',
    foreground: 'var(--brand-warning-amber)',
    tooltip: 'Recommended provider configuration or enhanced-monitoring notation.',
  },
  standard: {
    background: 'var(--brand-background)',
    foreground: 'var(--brand-text-secondary)',
    tooltip: 'Standard adult threshold table applies.',
  },
};

export default function ConditionPill({ tag }: { tag: ConditionTag }) {
  const style = SEVERITY_STYLES[tag.severity];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ backgroundColor: style.background, color: style.foreground }}
      title={style.tooltip}
    >
      {tag.label}
    </span>
  );
}
