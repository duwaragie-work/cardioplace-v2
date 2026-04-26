'use client';

// Hand-drawn SVG pill icons used on medication cards. Color + shape vary by
// drug class so non-readers can distinguish meds visually. Pure SVG so we
// don't need image assets or licensing.
//
// Shapes:
//   capsule  — ACE inhibitors, ARBs, ARNI (oblong, two-tone)
//   tablet   — beta-blockers, statins, water pills (round, single-tone)
//   round-2t — calcium channel blockers + combos (round, two-tone)
//   diamond  — antiarrhythmics + anticoagulants (rounded square)

import type { DrugClassInput } from '@cardioplace/shared';

interface Props {
  drugClass: DrugClassInput;
  /** Use the combo two-tone variant regardless of drug class. */
  combo?: boolean;
  size?: number;
  className?: string;
}

interface Style {
  shape: 'capsule' | 'tablet' | 'round2' | 'diamond';
  primary: string;
  secondary?: string;
}

function styleFor(drugClass: DrugClassInput, combo: boolean): Style {
  if (combo) {
    return { shape: 'round2', primary: '#7B00E0', secondary: '#0D9488' };
  }
  switch (drugClass) {
    case 'ACE_INHIBITOR':
      return { shape: 'capsule', primary: '#7B00E0', secondary: '#F3E8FF' };
    case 'ARB':
      return { shape: 'capsule', primary: '#0D9488', secondary: '#CCFBF1' };
    case 'ARNI':
      return { shape: 'capsule', primary: '#DB2777', secondary: '#FCE7F3' };
    case 'BETA_BLOCKER':
      return { shape: 'tablet', primary: '#2563EB' };
    case 'DHP_CCB':
      return { shape: 'round2', primary: '#EA580C', secondary: '#FED7AA' };
    case 'NDHP_CCB':
      return { shape: 'round2', primary: '#9333EA', secondary: '#E9D5FF' };
    case 'LOOP_DIURETIC':
    case 'THIAZIDE':
    case 'MRA':
      return { shape: 'tablet', primary: '#0EA5E9' };
    case 'ANTICOAGULANT':
      return { shape: 'diamond', primary: '#DC2626' };
    case 'STATIN':
      return { shape: 'tablet', primary: '#16A34A' };
    case 'ANTIARRHYTHMIC':
      return { shape: 'diamond', primary: '#7C3AED' };
    case 'SGLT2':
      return { shape: 'capsule', primary: '#0891B2', secondary: '#CFFAFE' };
    case 'VASODILATOR_NITRATE':
      return { shape: 'tablet', primary: '#F59E0B' };
    case 'OTHER_UNVERIFIED':
    default:
      return { shape: 'tablet', primary: '#94A3B8' };
  }
}

export default function PillIcon({ drugClass, combo = false, size = 56, className }: Props) {
  const s = styleFor(drugClass, combo);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden
    >
      {s.shape === 'capsule' && (
        <g transform="rotate(-30 32 32)">
          <rect x="8" y="24" width="48" height="16" rx="8" fill={s.secondary ?? '#fff'} />
          <rect x="8" y="24" width="24" height="16" rx="8" fill={s.primary} />
          <rect
            x="8"
            y="24"
            width="48"
            height="16"
            rx="8"
            fill="none"
            stroke={s.primary}
            strokeOpacity={0.18}
            strokeWidth={1}
          />
        </g>
      )}
      {s.shape === 'tablet' && (
        <g>
          <circle cx="32" cy="32" r="22" fill={s.primary} fillOpacity={0.12} />
          <circle cx="32" cy="32" r="16" fill={s.primary} />
          <line
            x1="18"
            y1="32"
            x2="46"
            y2="32"
            stroke="white"
            strokeOpacity={0.45}
            strokeWidth={1.5}
          />
        </g>
      )}
      {s.shape === 'round2' && (
        <g>
          <circle cx="32" cy="32" r="20" fill={s.secondary ?? '#fff'} />
          <path d="M 32 12 A 20 20 0 0 1 32 52 Z" fill={s.primary} />
          <circle cx="32" cy="32" r="20" fill="none" stroke={s.primary} strokeOpacity={0.3} strokeWidth={1.25} />
        </g>
      )}
      {s.shape === 'diamond' && (
        <g transform="rotate(45 32 32)">
          <rect x="14" y="14" width="36" height="36" rx="8" fill={s.primary} fillOpacity={0.15} />
          <rect x="18" y="18" width="28" height="28" rx="6" fill={s.primary} />
        </g>
      )}
    </svg>
  );
}
