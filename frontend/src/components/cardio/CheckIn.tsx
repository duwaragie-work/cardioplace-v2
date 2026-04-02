'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
  Check,
  ArrowLeft,
  ArrowRight,
  Heart,
  Scale,
  Pill,
  Stethoscope,
  CalendarDays,
  ChevronRight,
} from 'lucide-react';
import { createJournalEntry, getJournalEntries, getLatestBaseline } from '@/lib/services/journal.service';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Types ────────────────────────────────────────────────────────────────────
interface FormData {
  date: string;
  systolic: string;
  diastolic: string;
  medication: 'yes' | 'no' | null;
  symptoms: string[];
  weight: string;
  weightUnit: 'lbs' | 'kg';
  notes: string;
}

interface RecentReading {
  date: string;
  sys: number;
  dia: number;
  status: string;
  color: 'amber' | 'green';
}

interface Baseline {
  baselineSystolic?: number | string;
  baselineDiastolic?: number | string;
}

// ─── Static data ─────────────────────────────────────────────────────────────
const STEPS = [
  { label: 'Date', icon: CalendarDays },
  { label: 'Blood Pressure', icon: Heart },
  { label: 'Weight', icon: Scale },
  { label: 'Medication', icon: Pill },
  { label: 'Symptoms', icon: Stethoscope },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatReadingDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function getBpStatus(sys: number, dia: number): { label: string; color: 'amber' | 'green' } {
  if (sys >= 140 || dia >= 90) return { label: 'Elevated', color: 'amber' };
  return { label: 'Normal', color: 'green' };
}

// ─── Step Progress Bar (desktop) ─────────────────────────────────────────────
function StepBar({ current }: { current: number }) {
  const { t } = useLanguage();
  const stepLabels = [
    t('checkin.stepDate'), t('checkin.stepBP'), t('checkin.stepWeight'),
    t('checkin.stepMedication'), t('checkin.stepSymptoms'),
  ];
  return (
    <div className="flex items-center w-full mb-8">
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 shrink-0"
                style={{
                  backgroundColor: done ? 'var(--brand-primary-purple)' : 'transparent',
                  border: done
                    ? 'none'
                    : active
                    ? '2px solid var(--brand-primary-purple)'
                    : '2px solid var(--brand-border)',
                }}
              >
                {done ? (
                  <Check className="w-4 h-4 text-white" />
                ) : (
                  <div
                    className="w-2.5 h-2.5 rounded-full transition-all duration-300"
                    style={{
                      backgroundColor: active
                        ? 'var(--brand-primary-purple)'
                        : 'var(--brand-border)',
                    }}
                  />
                )}
              </div>
              <span
                className="text-[11px] whitespace-nowrap font-semibold transition-colors duration-300"
                style={{
                  color: active
                    ? 'var(--brand-primary-purple)'
                    : done
                    ? 'var(--brand-text-secondary)'
                    : 'var(--brand-text-muted)',
                }}
              >
                {stepLabels[i]}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className="flex-1 h-0.5 mx-2 mb-5 transition-all duration-500"
                style={{
                  backgroundColor:
                    i < current
                      ? 'var(--brand-primary-purple)'
                      : 'var(--brand-border)',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Dot progress (mobile) ────────────────────────────────────────────────────
// ─── Slide variants ───────────────────────────────────────────────────────────
const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -60 : 60, opacity: 0 }),
};
const slideTransition = { type: 'spring' as const, stiffness: 340, damping: 30 };

// ─── Reading skeleton row ─────────────────────────────────────────────────────
function ReadingSkeletonRow({ last }: { last?: boolean }) {
  return (
    <div
      className="grid items-center py-2.5"
      style={{
        gridTemplateColumns: '1fr 1fr 1fr 1fr',
        borderBottom: last ? 'none' : '1px solid var(--brand-border)',
      }}
    >
      {[60, 36, 36, 52].map((w, i) => (
        <div key={i} className={i > 0 ? 'flex justify-center' : ''}>
          <div
            className="animate-pulse rounded-md"
            style={{ width: w, height: 12, backgroundColor: '#EDE9F6' }}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Context Panel (Right side, desktop) ──────────────────────────────────────
function ContextPanel({
  recentReadings,
  baseline,
  readingsLoading,
}: {
  recentReadings: RecentReading[];
  baseline: Baseline | null;
  readingsLoading: boolean;
}) {
  const baselineStr =
    baseline?.baselineSystolic && baseline?.baselineDiastolic
      ? `${Math.round(Number(baseline.baselineSystolic))} / ${Math.round(Number(baseline.baselineDiastolic))}`
      : '-- / --';

  const { t } = useLanguage();
  const displayReadings = recentReadings.slice(0, 3);

  return (
    <div className="bg-white rounded-2xl p-6" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[15px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
          {t('checkin.recentReadings')}
        </h3>
        <Link
          href="/readings"
          className="flex items-center gap-0.5 text-[12px] font-semibold transition hover:opacity-75"
          style={{ color: 'var(--brand-primary-purple)' }}
        >
          {t('checkin.viewAll')}
          <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      <div className="w-full">
        <div
          className="grid text-[11px] font-semibold pb-2 mb-1"
          style={{
            gridTemplateColumns: '1fr 1fr 1fr 1fr',
            color: 'var(--brand-text-muted)',
            borderBottom: '1px solid var(--brand-border)',
          }}
        >
          <span>{t('checkin.date')}</span>
          <span className="text-center">{t('checkin.systolic')}</span>
          <span className="text-center">{t('checkin.diastolic')}</span>
          <span className="text-right">{t('checkin.status')}</span>
        </div>
        {readingsLoading ? (
          <>
            <ReadingSkeletonRow />
            <ReadingSkeletonRow />
            <ReadingSkeletonRow last />
          </>
        ) : displayReadings.length === 0 ? (
          <p className="text-[12px] py-3" style={{ color: 'var(--brand-text-muted)' }}>
            {t('checkin.noReadingsYet')}
          </p>
        ) : (
          displayReadings.map((r, i) => (
            <div
              key={i}
              className="grid items-center py-2.5 text-[13px]"
              style={{
                gridTemplateColumns: '1fr 1fr 1fr 1fr',
                borderBottom:
                  i < displayReadings.length - 1
                    ? '1px solid var(--brand-border)'
                    : 'none',
              }}
            >
              <span style={{ color: 'var(--brand-text-secondary)' }}>{r.date}</span>
              <span
                className="text-center font-semibold"
                style={{
                  color:
                    r.color === 'amber'
                      ? 'var(--brand-warning-amber)'
                      : 'var(--brand-success-green)',
                }}
              >
                {r.sys}
              </span>
              <span
                className="text-center font-semibold"
                style={{
                  color:
                    r.color === 'amber'
                      ? 'var(--brand-warning-amber)'
                      : 'var(--brand-success-green)',
                }}
              >
                {r.dia}
              </span>
              <div className="flex justify-end">
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
                  style={{
                    backgroundColor:
                      r.color === 'amber'
                        ? 'var(--brand-warning-amber-light)'
                        : 'var(--brand-success-green-light)',
                    color:
                      r.color === 'amber'
                        ? 'var(--brand-warning-amber)'
                        : 'var(--brand-success-green)',
                  }}
                >
                  {r.status}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="h-px my-5" style={{ backgroundColor: 'var(--brand-border)' }} />

      {/* Baseline card */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}>
        <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--brand-primary-purple)' }}>
          {t('checkin.baselineBP')}
        </p>
        <p className="text-[26px] font-bold mb-1" style={{ color: 'var(--brand-text-primary)' }}>
          {baselineStr}{' '}
          <span className="text-[14px] font-semibold" style={{ color: 'var(--brand-text-muted)' }}>
            mmHg
          </span>
        </p>
        <p className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
          {t('checkin.rollingAvg')}
        </p>
      </div>

      {/* Tip */}
      <div
        className="mt-4 rounded-xl p-4 flex gap-3"
        style={{ backgroundColor: 'var(--brand-accent-teal-light)' }}
      >
        <div>
          <p className="text-[12px] font-semibold mb-0.5" style={{ color: 'var(--brand-accent-teal)' }}>
            {t('checkin.bestTime')}
          </p>
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
            {t('checkin.bestTimeDesc')}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: Date ─────────────────────────────────────────────────────────────
function Step1Date({
  form,
  onChange,
}: {
  form: FormData;
  onChange: (k: keyof FormData, v: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="space-y-6">
      <div>
        <p className="text-[13px] mb-1" style={{ color: 'var(--brand-text-muted)' }}>
          {t('checkin.stepOf').replace('{x}', '1')}
        </p>
        <h2 className="text-[22px] font-bold mb-1" style={{ color: 'var(--brand-text-primary)' }}>
          {t('checkin.confirmDate')}
        </h2>
        <p className="text-[14px]" style={{ color: 'var(--brand-text-muted)' }}>
          {t('checkin.confirmDateHint')}
        </p>
      </div>
      <div>
        <label className="block text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
          {t('checkin.date')}
        </label>
        <input
          type="date"
          value={form.date}
          onChange={(e) => onChange('date', e.target.value)}
          className="w-full h-14 px-4 rounded-xl text-[15px] outline-none transition"
          style={{
            border: '2px solid var(--brand-border)',
            color: 'var(--brand-text-primary)',
            backgroundColor: 'white',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--brand-primary-purple)'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--brand-border)'; }}
        />
      </div>
      <div
        className="rounded-xl p-4 flex items-start gap-3"
        style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}
      >
        <CalendarDays className="w-5 h-5 mt-0.5 shrink-0" style={{ color: 'var(--brand-primary-purple)' }} />
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--brand-text-primary)' }}>
          {t('checkin.dateReason')}
        </p>
      </div>
    </div>
  );
}

// ─── Step 2: Blood Pressure ───────────────────────────────────────────────────
function Step2BP({
  form,
  onChange,
}: {
  form: FormData;
  onChange: (k: keyof FormData, v: string) => void;
}) {
  const { t } = useLanguage();
  const sys = parseInt(form.systolic || '0');
  const dia = parseInt(form.diastolic || '0');
  const isElevated = sys >= 140 || dia >= 90;
  const isCritical = sys >= 180 || dia >= 110;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[13px] mb-1" style={{ color: 'var(--brand-text-muted)' }}>{t('checkin.stepOf').replace('{x}', '2')}</p>
        <h2 className="text-[22px] font-bold mb-1" style={{ color: 'var(--brand-text-primary)' }}>
          {t('checkin.bpTitle')}
        </h2>
        <p className="text-[14px]" style={{ color: 'var(--brand-text-muted)' }}>
          {t('checkin.bpSeatHint')}
        </p>
      </div>

      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>{t('checkin.systolic')}</label>
          <input
            type="number"
            inputMode="numeric"
            min={60}
            max={220}
            value={form.systolic}
            onChange={(e) => onChange('systolic', e.target.value)}
            placeholder="120"
            className="w-full outline-none transition text-center"
            style={{
              height: 80,
              borderRadius: 'var(--brand-radius-input)',
              border: `2px solid ${form.systolic && isCritical ? 'var(--brand-alert-red)' : form.systolic && isElevated ? 'var(--brand-warning-amber)' : 'var(--brand-border)'}`,
              fontSize: 36,
              color: form.systolic
                ? isCritical ? 'var(--brand-alert-red)' : isElevated ? 'var(--brand-warning-amber)' : 'var(--brand-text-primary)'
                : 'var(--brand-text-muted)',
              backgroundColor: 'white',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--brand-primary-purple)'; }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor =
                form.systolic && isCritical ? 'var(--brand-alert-red)'
                : form.systolic && isElevated ? 'var(--brand-warning-amber)'
                : 'var(--brand-border)';
            }}
          />
          <p className="text-[11px] text-center mt-1.5" style={{ color: 'var(--brand-text-muted)' }}>{t('checkin.topNumber')}</p>
        </div>

        <div className="pb-7 text-[36px] font-light" style={{ color: 'var(--brand-text-muted)' }}>/</div>

        <div className="flex-1">
          <label className="block text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>{t('checkin.diastolic')}</label>
          <input
            type="number"
            inputMode="numeric"
            min={40}
            max={150}
            value={form.diastolic}
            onChange={(e) => onChange('diastolic', e.target.value)}
            placeholder="80"
            className="w-full outline-none transition text-center"
            style={{
              height: 80,
              borderRadius: 'var(--brand-radius-input)',
              border: '2px solid var(--brand-border)',
              fontSize: 36,
              color: form.diastolic ? 'var(--brand-text-primary)' : 'var(--brand-text-muted)',
              backgroundColor: 'white',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--brand-primary-purple)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--brand-border)'; }}
          />
          <p className="text-[11px] text-center mt-1.5" style={{ color: 'var(--brand-text-muted)' }}>{t('checkin.bottomNumber')}</p>
        </div>
      </div>

      <p className="text-[14px] text-center -mt-4" style={{ color: 'var(--brand-text-muted)' }}>mmHg</p>

      <AnimatePresence>
        {form.systolic && form.diastolic && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-xl px-4 py-3 flex items-center gap-3"
            style={{
              backgroundColor: isCritical
                ? 'var(--brand-alert-red-light)'
                : isElevated
                ? 'var(--brand-warning-amber-light)'
                : 'var(--brand-success-green-light)',
            }}
          >
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0 animate-pulse"
              style={{
                backgroundColor: isCritical
                  ? 'var(--brand-alert-red)'
                  : isElevated
                  ? 'var(--brand-warning-amber)'
                  : 'var(--brand-success-green)',
              }}
            />
            <p
              className="text-[13px] font-semibold"
              style={{
                color: isCritical
                  ? 'var(--brand-alert-red)'
                  : isElevated
                  ? 'var(--brand-warning-amber)'
                  : 'var(--brand-success-green)',
              }}
            >
              {isCritical
                ? t('checkin.criticalRange')
                : isElevated
                ? t('checkin.elevatedRange')
                : t('checkin.normalRange')}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="h-px" style={{ backgroundColor: 'var(--brand-border)' }} />

      {/* Medication toggle */}
      <div>
        <p className="text-[15px] font-semibold mb-3" style={{ color: 'var(--brand-text-primary)' }}>
          {t('checkin.medicationQuestion')}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { value: 'yes', label: t('checkin.medicationTaken'), activeColor: 'var(--brand-success-green)' },
            { value: 'no', label: t('checkin.medicationMissed'), activeColor: 'var(--brand-alert-red)' },
          ].map((opt) => {
            const isActive = form.medication === opt.value;
            return (
              <motion.button
                key={opt.value}
                onClick={() => onChange('medication', opt.value)}
                className="h-12 rounded-full text-sm font-semibold transition-all border-2"
                style={{
                  backgroundColor: isActive ? opt.activeColor : 'white',
                  borderColor: isActive ? opt.activeColor : 'var(--brand-border)',
                  color: isActive ? 'white' : 'var(--brand-text-secondary)',
                  boxShadow: isActive ? `0 4px 12px ${opt.activeColor}40` : 'none',
                }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
              >
                {opt.label}
              </motion.button>
            );
          })}
        </div>
      </div>

    </div>
  );
}

// ─── Step 3: Weight ───────────────────────────────────────────────────────────
function Step3Weight({
  form,
  onChange,
}: {
  form: FormData;
  onChange: (k: keyof FormData, v: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="space-y-6">
      <div>
        <p className="text-[13px] mb-1" style={{ color: 'var(--brand-text-muted)' }}>{t('checkin.stepOf').replace('{x}', '3')}</p>
        <h2 className="text-[22px] font-bold mb-1" style={{ color: 'var(--brand-text-primary)' }}>
          {t('checkin.weightTitle')}
        </h2>
        <p className="text-[14px]" style={{ color: 'var(--brand-text-muted)' }}>
          {t('checkin.weightMorning')}
        </p>
      </div>

      <div>
        <label className="block text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>{t('checkin.unit')}</label>
        <div
          className="inline-flex rounded-full p-1 gap-1"
          style={{ backgroundColor: 'var(--brand-background)', border: '1px solid var(--brand-border)' }}
        >
          {(['lbs', 'kg'] as const).map((unit) => (
            <button
              key={unit}
              onClick={() => onChange('weightUnit', unit)}
              className="px-5 py-1.5 rounded-full text-sm font-semibold transition-all"
              style={{
                backgroundColor: form.weightUnit === unit ? 'var(--brand-primary-purple)' : 'transparent',
                color: form.weightUnit === unit ? 'white' : 'var(--brand-text-secondary)',
              }}
            >
              {unit}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
          {t('checkin.stepWeight')} ({form.weightUnit})
        </label>
        <div className="relative">
          <input
            type="number"
            inputMode="decimal"
            value={form.weight}
            onChange={(e) => onChange('weight', e.target.value)}
            placeholder={form.weightUnit === 'lbs' ? '185' : '84'}
            className="w-full outline-none transition text-center"
            style={{
              height: 80,
              borderRadius: 'var(--brand-radius-input)',
              border: '2px solid var(--brand-border)',
              fontSize: 36,
              color: form.weight ? 'var(--brand-text-primary)' : 'var(--brand-text-muted)',
              backgroundColor: 'white',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--brand-primary-purple)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--brand-border)'; }}
          />
          <span
            className="absolute right-5 top-1/2 -translate-y-1/2 text-[18px]"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            {form.weightUnit}
          </span>
        </div>
      </div>

      <div className="rounded-xl p-4 flex gap-3" style={{ backgroundColor: 'var(--brand-accent-teal-light)' }}>
        <Scale className="w-5 h-5 mt-0.5 shrink-0" style={{ color: 'var(--brand-accent-teal)' }} />
        <div>
          <p className="text-[13px] font-semibold mb-0.5" style={{ color: 'var(--brand-accent-teal)' }}>
            {t('checkin.whyWeight')}
          </p>
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
            {t('checkin.weightInfo')}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Step 4: Medication ───────────────────────────────────────────────────────
function Step4Medication({
  form,
  onChange,
}: {
  form: FormData;
  onChange: (k: keyof FormData, v: string) => void;
}) {
  const { t } = useLanguage();
  const meds = [
    { name: 'Lisinopril', dose: '10mg', time: 'Morning' },
    { name: 'Amlodipine', dose: '5mg', time: 'Morning' },
    { name: 'Metformin', dose: '500mg', time: 'With dinner' },
  ];
  const [checkedMeds, setCheckedMeds] = useState<boolean[]>([false, false, false]);

  const toggleMed = (index: number) => {
    setCheckedMeds((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[13px] mb-1" style={{ color: 'var(--brand-text-muted)' }}>{t('checkin.stepOf').replace('{x}', '4')}</p>
        <h2 className="text-[22px] font-bold mb-1" style={{ color: 'var(--brand-text-primary)' }}>
          {t('checkin.medAdherence')}
        </h2>
        <p className="text-[14px]" style={{ color: 'var(--brand-text-muted)' }}>
          {t('checkin.medAllQuestion')}
        </p>
      </div>

      <div className="space-y-3">
        {meds.map((med, i) => {
          const checked = checkedMeds[i];
          return (
            <motion.button
              key={i}
              type="button"
              onClick={() => { if (form.medication !== 'no') toggleMed(i); }}
              className="w-full flex items-center justify-between p-4 rounded-xl transition-all"
              style={{
                border: checked ? '1.5px solid var(--brand-success-green)' : '1.5px solid var(--brand-border)',
                backgroundColor: checked ? 'var(--brand-success-green-light)' : 'white',
                opacity: form.medication === 'no' ? 0.45 : 1,
                pointerEvents: form.medication === 'no' ? 'none' : 'auto',
              }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: checked ? 'var(--brand-success-green)' : 'var(--brand-primary-purple-light)' }}
                >
                  <Pill className="w-4 h-4" style={{ color: checked ? 'white' : 'var(--brand-primary-purple)' }} />
                </div>
                <div className="text-left">
                  <p className="text-[14px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                    {med.name} {med.dose}
                  </p>
                  <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>{med.time}</p>
                </div>
              </div>
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all"
                style={{
                  borderColor: checked ? 'var(--brand-success-green)' : 'var(--brand-border)',
                  backgroundColor: checked ? 'var(--brand-success-green)' : 'transparent',
                }}
              >
                {checked && <Check className="w-3.5 h-3.5 text-white" />}
              </div>
            </motion.button>
          );
        })}
      </div>

      <div>
        <p className="text-[15px] font-semibold mb-3" style={{ color: 'var(--brand-text-primary)' }}>
          {t('checkin.medicationQuestion')}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { value: 'yes', label: t('checkin.medicationTaken'), activeColor: 'var(--brand-success-green)' },
            { value: 'no', label: t('checkin.medicationMissed'), activeColor: 'var(--brand-alert-red)' },
          ].map((opt) => {
            const isActive = form.medication === opt.value;
            return (
              <motion.button
                key={opt.value}
                onClick={() => { onChange('medication', opt.value); if (opt.value === 'no') setCheckedMeds([false, false, false]); }}
                className="h-12 rounded-full text-sm font-semibold transition-all border-2"
                style={{
                  backgroundColor: isActive ? opt.activeColor : 'white',
                  borderColor: isActive ? opt.activeColor : 'var(--brand-border)',
                  color: isActive ? 'white' : 'var(--brand-text-secondary)',
                  boxShadow: isActive ? `0 4px 12px ${opt.activeColor}40` : 'none',
                }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
              >
                {opt.label}
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Step 5: Symptoms ─────────────────────────────────────────────────────────
function Step5Symptoms({
  form,
  onChange,
}: {
  form: FormData;
  onChange: (k: keyof FormData, v: string) => void;
}) {
  const { t } = useLanguage();
  const allSymptoms = [
    'Chest Pain', 'Severe Headache', 'Shortness of Breath',
    'Dizziness', 'Blurred Vision', 'Swollen Ankles',
    'Fatigue', 'Nausea', 'None of these',
  ];
  const toggle = (s: string) => {
    const updated = form.symptoms.includes(s)
      ? form.symptoms.filter((x) => x !== s)
      : s === 'None of these'
      ? ['None of these']
      : [...form.symptoms.filter((x) => x !== 'None of these'), s];
    onChange('symptoms', JSON.stringify(updated));
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[13px] mb-1" style={{ color: 'var(--brand-text-muted)' }}>{t('checkin.stepOf').replace('{x}', '5')}</p>
        <h2 className="text-[22px] font-bold mb-1" style={{ color: 'var(--brand-text-primary)' }}>
          {t('checkin.symptomsToday')}
        </h2>
        <p className="text-[14px]" style={{ color: 'var(--brand-text-muted)' }}>
          {t('checkin.selectAllApply')}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {allSymptoms.map((s) => {
          const selected = form.symptoms.includes(s);
          return (
            <motion.button
              key={s}
              onClick={() => toggle(s)}
              className="h-11 rounded-full text-[13px] font-semibold border-2 px-3 transition-all"
              style={{
                backgroundColor: selected ? 'var(--brand-primary-purple)' : 'white',
                borderColor: selected ? 'var(--brand-primary-purple)' : 'var(--brand-border)',
                color: selected ? 'white' : 'var(--brand-text-secondary)',
                boxShadow: selected ? 'var(--brand-shadow-button)' : 'none',
              }}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
            >
              {s}
            </motion.button>
          );
        })}
      </div>

      <div>
        <label className="block text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
          {t('checkin.additionalNotes')}
        </label>
        <textarea
          rows={3}
          value={form.notes}
          onChange={(e) => onChange('notes', e.target.value)}
          placeholder={t('checkin.anythingElse')}
          className="w-full rounded-xl px-4 py-3 text-[13px] resize-none outline-none transition"
          style={{
            border: '2px solid var(--brand-border)',
            color: 'var(--brand-text-primary)',
            backgroundColor: 'white',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--brand-primary-purple)'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--brand-border)'; }}
        />
      </div>
    </div>
  );
}

// ─── Success screen ───────────────────────────────────────────────────────────
function SuccessScreen({ onDone }: { onDone: () => void }) {
  const { t } = useLanguage();
  const today = new Date();
  const dateLabel = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return (
    <motion.div
      className="flex flex-col items-center justify-center min-h-screen px-6 text-center"
      style={{ backgroundColor: 'var(--brand-background)' }}
      initial={{ opacity: 0, scale: 0.93 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 280, damping: 24 }}
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.15 }}
        className="w-24 h-24 rounded-full flex items-center justify-center mb-6"
        style={{ backgroundColor: 'var(--brand-success-green-light)' }}
      >
        <Check className="w-12 h-12" style={{ color: 'var(--brand-success-green)' }} />
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <h2 className="text-[28px] font-bold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
          {t('checkin.success')}
        </h2>
        <p className="text-[15px] mb-2" style={{ color: 'var(--brand-text-muted)' }}>
          {t('checkin.successMsg')}
        </p>
        <p className="text-[13px] mb-8" style={{ color: 'var(--brand-text-muted)' }}>
          {t('checkin.reviewedByCedar')} &middot; {dateLabel}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <motion.button
            onClick={onDone}
            className="h-12 px-8 rounded-full text-white font-bold text-sm"
            style={{ backgroundColor: 'var(--brand-primary-purple)', boxShadow: 'var(--brand-shadow-button)' }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
          >
            {t('checkin.goToDashboard')}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function CheckIn() {
  const { t } = useLanguage();
  const router = useRouter();
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');

  const [step, setStep] = useState(0);
  const [direction, setDir] = useState(1);
  const [submitted, setSubmit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [recentReadings, setRecentReadings] = useState<RecentReading[]>([]);
  const [readingsLoading, setReadingsLoading] = useState(true);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [form, setForm] = useState<FormData>({
    date: `${yyyy}-${mm}-${dd}`,
    systolic: '',
    diastolic: '',
    medication: null,
    symptoms: [],
    weight: '',
    weightUnit: 'lbs',
    notes: '',
  });

  // Load recent readings and baseline for context panel
  useEffect(() => {
    setReadingsLoading(true);
    getJournalEntries({ limit: 3 })
      .then((entries) => {
        const arr = Array.isArray(entries) ? entries : [];
        const sorted = [...arr].sort(
          (a: { entryDate: string }, b: { entryDate: string }) =>
            new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime(),
        );
        const readings: RecentReading[] = sorted
          .filter((e: { systolicBP?: number; diastolicBP?: number }) => e.systolicBP && e.diastolicBP)
          .map((e: { entryDate: string; systolicBP: number; diastolicBP: number }) => {
            const { label, color } = getBpStatus(e.systolicBP, e.diastolicBP);
            return {
              date: formatReadingDate(e.entryDate),
              sys: e.systolicBP,
              dia: e.diastolicBP,
              status: label,
              color,
            };
          });
        setRecentReadings(readings);
      })
      .catch(() => {})
      .finally(() => setReadingsLoading(false));

    getLatestBaseline().then((b) => setBaseline(b ?? null)).catch(() => {});
  }, []);

  const onChange = (key: keyof FormData, value: string) => {
    setForm((prev) => {
      if (key === 'symptoms') {
        try { return { ...prev, symptoms: JSON.parse(value) }; } catch { return prev; }
      }
      if (key === 'medication') {
        return { ...prev, medication: value as 'yes' | 'no' };
      }
      return { ...prev, [key]: value };
    });
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError('');
    try {
      const payload: Parameters<typeof createJournalEntry>[0] = {
        entryDate: form.date,
      };
      if (form.systolic) payload.systolicBP = parseInt(form.systolic, 10);
      if (form.diastolic) payload.diastolicBP = parseInt(form.diastolic, 10);
      if (form.weight) payload.weight = parseFloat(form.weight);
      if (form.medication !== null) payload.medicationTaken = form.medication === 'yes';
      const cleanedSymptoms = form.symptoms.filter((s) => s !== 'None of these');
      if (cleanedSymptoms.length > 0) payload.symptoms = cleanedSymptoms;
      if (form.notes.trim()) payload.notes = form.notes.trim();

      await createJournalEntry(payload);
      setSubmit(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const goNext = () => {
    if (step < 4) {
      setDir(1);
      setStep((s) => s + 1);
    } else {
      void handleSubmit();
    }
  };

  const goBack = () => {
    if (step > 0) {
      setDir(-1);
      setStep((s) => s - 1);
    } else {
      router.push('/dashboard');
    }
  };

  const stepComponents = [
    <Step1Date key={0} form={form} onChange={onChange} />,
    <Step2BP key={1} form={form} onChange={onChange} />,
    <Step3Weight key={2} form={form} onChange={onChange} />,
    <Step4Medication key={3} form={form} onChange={onChange} />,
    <Step5Symptoms key={4} form={form} onChange={onChange} />,
  ];

  const nextLabels = [
    `${t('common.next')}: ${t('checkin.stepBP')}`,
    `${t('common.next')}: ${t('checkin.stepWeight')}`,
    `${t('common.next')}: ${t('checkin.stepMedication')}`,
    `${t('common.next')}: ${t('checkin.stepSymptoms')}`,
    isSubmitting ? t('checkin.submitting') : t('checkin.submitCheckin'),
  ];

  if (submitted) {
    return <SuccessScreen onDone={() => router.push('/dashboard')} />;
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--brand-background)' }}>
      {/* Body */}
      <div className="flex-1 w-full max-w-300 mx-auto px-4 md:px-8 pt-5 md:pt-8 pb-24 lg:pb-10">
        <div className="flex flex-col lg:flex-row gap-5 lg:gap-6 items-start">
          {/* Left: Form column */}
          <div className="w-full lg:flex-1 flex flex-col min-w-0">
            <div className="hidden lg:block">
              <StepBar current={step} />
            </div>

            {/* Step 0 mobile stats */}
            {step === 0 && (
              <div className="lg:hidden mb-4 space-y-3">
                <div className="bg-white rounded-2xl p-4" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[13px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                      {t('checkin.recentReadings')}
                    </h3>
                    <Link
                      href="/readings"
                      className="flex items-center gap-0.5 text-[11px] font-semibold transition hover:opacity-75"
                      style={{ color: 'var(--brand-primary-purple)' }}
                    >
                      {t('checkin.viewAll')}
                      <ChevronRight className="w-3 h-3" />
                    </Link>
                  </div>
                  <div className="w-full">
                    <div
                      className="grid text-[10px] font-semibold pb-2 mb-1"
                      style={{
                        gridTemplateColumns: '1fr 1fr 1fr 1fr',
                        color: 'var(--brand-text-muted)',
                        borderBottom: '1px solid var(--brand-border)',
                      }}
                    >
                      <span>{t('checkin.date')}</span>
                      <span className="text-center">{t('checkin.systolic')}</span>
                      <span className="text-center">{t('checkin.diastolic')}</span>
                      <span className="text-right">{t('checkin.status')}</span>
                    </div>
                    {readingsLoading ? (
                      <>
                        <ReadingSkeletonRow />
                        <ReadingSkeletonRow />
                        <ReadingSkeletonRow last />
                      </>
                    ) : recentReadings.length === 0 ? (
                      <p className="text-[12px] py-2" style={{ color: 'var(--brand-text-muted)' }}>{t('checkin.noReadingsYet')}</p>
                    ) : (
                      recentReadings.slice(0, 3).map((r, i) => (
                        <div
                          key={i}
                          className="grid items-center py-1.5 text-[12px]"
                          style={{
                            gridTemplateColumns: '1fr 1fr 1fr 1fr',
                            borderBottom: i < recentReadings.slice(0, 3).length - 1 ? '1px solid var(--brand-border)' : 'none',
                          }}
                        >
                          <span style={{ color: 'var(--brand-text-secondary)' }}>{r.date}</span>
                          <span className="text-center font-semibold" style={{ color: r.color === 'amber' ? 'var(--brand-warning-amber)' : 'var(--brand-success-green)' }}>
                            {r.sys}
                          </span>
                          <span className="text-center font-semibold" style={{ color: r.color === 'amber' ? 'var(--brand-warning-amber)' : 'var(--brand-success-green)' }}>
                            {r.dia}
                          </span>
                          <div className="flex justify-end">
                            <span
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
                              style={{
                                backgroundColor: r.color === 'amber' ? 'var(--brand-warning-amber-light)' : 'var(--brand-success-green-light)',
                                color: r.color === 'amber' ? 'var(--brand-warning-amber)' : 'var(--brand-success-green)',
                              }}
                            >
                              {r.status}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div
                  className="rounded-2xl p-4 flex items-center justify-between"
                  style={{ backgroundColor: 'var(--brand-primary-purple-light)', boxShadow: 'var(--brand-shadow-card)' }}
                >
                  <div>
                    <p className="text-[12px] font-semibold mb-0.5" style={{ color: 'var(--brand-primary-purple)' }}>
                      {t('checkin.baselineBP')}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
                      {t('checkin.rollingAvg')}
                    </p>
                  </div>
                  <p className="text-[26px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                    {baseline?.baselineSystolic
                      ? Math.round(Number(baseline.baselineSystolic))
                      : '--'}
                    <span className="text-[16px] font-semibold mx-1" style={{ color: 'var(--brand-text-muted)' }}>/</span>
                    {baseline?.baselineDiastolic
                      ? Math.round(Number(baseline.baselineDiastolic))
                      : '--'}
                    <span className="text-[12px] font-medium ml-1" style={{ color: 'var(--brand-text-muted)' }}>mmHg</span>
                  </p>
                </div>
              </div>
            )}

            {/* Form card */}
            <div
              className="bg-white rounded-2xl overflow-hidden flex flex-col"
              style={{
                boxShadow: 'var(--brand-shadow-card)',
                minHeight: step > 0 ? 'calc(100dvh - 200px)' : 'auto',
              }}
            >
              <div className="flex-1 p-6 md:p-8">
                <AnimatePresence mode="wait" custom={direction}>
                  <motion.div
                    key={step}
                    custom={direction}
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={slideTransition}
                  >
                    {stepComponents[step]}
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Submit error */}
              {submitError && (
                <div className="px-6 pb-2">
                  <p className="text-[13px] text-center" style={{ color: 'var(--brand-alert-red)' }}>
                    {submitError}
                  </p>
                </div>
              )}

              {/* Desktop nav buttons */}
              <div
                className="hidden lg:flex shrink-0 items-center justify-between px-8 py-5"
                style={{ borderTop: '1px solid var(--brand-border)' }}
              >
                <motion.button
                  onClick={goBack}
                  className="h-11 px-6 rounded-full border-2 text-sm font-semibold flex items-center gap-2 transition cursor-pointer"
                  style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-secondary)' }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <ArrowLeft className="w-4 h-4" />
                  {step === 0 ? t('common.cancel') : t('common.back')}
                </motion.button>

                <motion.button
                  onClick={goNext}
                  disabled={isSubmitting}
                  className="h-11 px-8 rounded-full text-white font-bold text-sm flex items-center gap-2 disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed transition"
                  style={{
                    backgroundColor: 'var(--brand-primary-purple)',
                    boxShadow: 'var(--brand-shadow-button)',
                    minWidth: 200,
                    justifyContent: 'center',
                  }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                >
                  {nextLabels[step]}
                  {step < 4 && <ArrowRight className="w-4 h-4" />}
                </motion.button>
              </div>
            </div>

            <p className="text-center text-[11px] mt-3" style={{ color: 'var(--brand-text-muted)' }}>
              {t('checkin.reviewedBy')}
            </p>
          </div>

          {/* Right: Context panel — desktop only */}
          <div className="hidden lg:block w-90 shrink-0">
            <ContextPanel recentReadings={recentReadings} baseline={baseline} readingsLoading={readingsLoading} />
          </div>
        </div>
      </div>

      {/* Mobile sticky bottom nav buttons */}
      <div
        className="lg:hidden fixed bottom-0 left-0 right-0 bg-white px-4 py-3 flex gap-3 z-30"
        style={{ borderTop: '1px solid var(--brand-border)', boxShadow: '0 -4px 16px rgba(0,0,0,0.07)' }}
      >
        <button
          onClick={goBack}
          className="h-12 px-5 rounded-full border-2 text-sm font-semibold flex items-center gap-1.5 shrink-0"
          style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-secondary)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          {step === 0 ? t('common.close') : t('common.back')}
        </button>
        <motion.button
          onClick={goNext}
          disabled={isSubmitting}
          className="flex-1 h-12 rounded-full text-white font-bold text-sm disabled:opacity-60"
          style={{ backgroundColor: 'var(--brand-primary-purple)', boxShadow: 'var(--brand-shadow-button)' }}
          whileTap={{ scale: 0.97 }}
        >
          {step === 4 ? (isSubmitting ? t('checkin.submitting') : t('common.submit')) : t('common.next')}
        </motion.button>
      </div>
    </div>
  );
}
