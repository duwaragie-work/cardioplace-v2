'use client';

// Compact step indicator for the multi-step Clinical Intake wizard. Unlike
// CheckIn's StepBar (which shows circles + labels for 5 steps), Flow A has
// up to 9 visible steps after conditional skipping, so dots scale better.

interface Props {
  current: number; // 1-indexed
  total: number;
}

export default function StepDots({ current, total }: Props) {
  return (
    <div className="flex items-center gap-1.5" role="progressbar" aria-valuenow={current} aria-valuemin={1} aria-valuemax={total}>
      {Array.from({ length: total }).map((_, i) => {
        const stepIdx = i + 1;
        const isDone = stepIdx < current;
        const isActive = stepIdx === current;
        return (
          <span
            key={i}
            className="rounded-full transition-all"
            style={{
              width: isActive ? 22 : 7,
              height: 7,
              backgroundColor: isDone || isActive ? 'var(--brand-primary-purple)' : 'var(--brand-border)',
            }}
          />
        );
      })}
    </div>
  );
}
