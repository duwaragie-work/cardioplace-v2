'use client';

// Daily check-in (Flow B). Multi-step:
//   B1 pre-measurement checklist (8 items, captured as measurementConditions JSON)
//   B2 reading: datetime + position + systolic/diastolic/pulse
//   Weight (optional, retained from v1)
//   Medication adherence (retained from v1)
//   B3 structured symptom check (6 booleans + 3 pregnancy-specific + freeform)
//   B5 confirmation + B4 "add another reading in this session" CTA
//
// Session grouping (B4): a client-generated UUID is reused across all readings
// taken within ~30 minutes so the rule engine averages them. AFib patients see
// a banner reminding them ≥3 readings per session are required.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  Coffee,
  Cigarette,
  Activity,
  Droplets,
  Timer,
  ChevronRight as ChevronRightIcon,
  MessageSquareOff,
  Shirt,
  Armchair,
  PersonStanding,
  Bed,
  Heart,
  Eye,
  Brain,
  Wind,
  Zap,
  Stethoscope,
  Baby,
  Pill,
  Scale,
  CalendarClock,
  Plus,
  Home,
  Volume2,
} from 'lucide-react';

import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import { createJournalEntry } from '@/lib/services/journal.service';
import { getMyPatientProfile, type PatientProfileDto } from '@/lib/services/intake.service';
import {
  listMyMedications,
  type PatientMedication,
} from '@/lib/services/patient-medications.service';
import AudioButton from '@/components/intake/AudioButton';
import ChoiceCard from '@/components/intake/ChoiceCard';
import StepDots from '@/components/intake/StepDots';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type StepKey = 'B1' | 'B2' | 'WEIGHT' | 'MEDICATION' | 'B3' | 'B5';

interface FormData {
  // B1 checklist
  noCaffeine: boolean;
  noSmoking: boolean;
  noExercise: boolean;
  bladderEmpty: boolean;
  seatedQuietly: boolean;
  posturalSupport: boolean;
  notTalking: boolean;
  cuffOnBareArm: boolean;
  // B2 — date and time captured as two separate inputs (cleaner UX than
  // datetime-local on small screens). Combined into ISO 8601 at submit.
  measuredDate: string; // YYYY-MM-DD
  measuredTime: string; // HH:mm
  position: 'SITTING' | 'STANDING' | 'LYING' | null;
  systolicBP: string;
  diastolicBP: string;
  pulse: string;
  // Weight
  weight: string;
  weightUnit: 'lbs' | 'kg';
  // Medication
  medicationTaken: 'yes' | 'no' | null;
  /**
   * Per-medication miss detail. Each entry is one medication the patient
   * ticked as missed, with a structured reason + dose count. The array stays
   * empty until `medicationTaken === 'no'` and the patient interacts with the
   * per-med checkbox list.
   */
  missedMedications: Array<{
    medicationId: string;
    drugName: string;
    drugClass: string;
    reason: 'FORGOT' | 'SIDE_EFFECTS' | 'RAN_OUT' | 'COST' | 'INTENTIONAL' | 'OTHER' | null;
    missedDoses: number;
  }>;
  // B3 structured symptoms
  severeHeadache: boolean;
  visualChanges: boolean;
  alteredMentalStatus: boolean;
  chestPainOrDyspnea: boolean;
  focalNeuroDeficit: boolean;
  severeEpigastricPain: boolean;
  newOnsetHeadache: boolean;
  ruqPain: boolean;
  edema: boolean;
  otherSymptomsText: string;
}

interface SessionReading {
  measuredAt: string;
  systolicBP?: number;
  diastolicBP?: number;
  pulse?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function nowDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function emptyForm(): FormData {
  return {
    noCaffeine: false,
    noSmoking: false,
    noExercise: false,
    bladderEmpty: false,
    seatedQuietly: false,
    posturalSupport: false,
    notTalking: false,
    cuffOnBareArm: false,
    measuredDate: nowDate(),
    measuredTime: nowTime(),
    position: null,
    systolicBP: '',
    diastolicBP: '',
    pulse: '',
    weight: '',
    weightUnit: 'lbs',
    medicationTaken: null,
    missedMedications: [],
    severeHeadache: false,
    visualChanges: false,
    alteredMentalStatus: false,
    chestPainOrDyspnea: false,
    focalNeuroDeficit: false,
    severeEpigastricPain: false,
    newOnsetHeadache: false,
    ruqPain: false,
    edema: false,
    otherSymptomsText: '',
  };
}

/** RFC4122 v4 UUID — used for sessionId (client-generated). */
function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Step components
// ─────────────────────────────────────────────────────────────────────────────

interface StepProps {
  form: FormData;
  setField: <K extends keyof FormData>(k: K, v: FormData[K]) => void;
}

function StepHeader({
  title,
  subtitle,
  audio,
  step,
  total,
}: {
  title: string;
  subtitle: string;
  audio: string;
  step: number;
  total: number;
}) {
  return (
    <div>
      <p className="text-[12px] font-semibold mb-1" style={{ color: 'var(--brand-text-muted)' }}>
        Step {step} of {total}
      </p>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2
          className="text-[20px] sm:text-[24px] font-bold tracking-tight min-w-0 flex-1"
          style={{ color: 'var(--brand-text-primary)', wordBreak: 'break-word' }}
        >
          {title}
        </h2>
        <div className="shrink-0">
          <AudioButton text={audio} />
        </div>
      </div>
      <p className="text-[14px]" style={{ color: 'var(--brand-text-muted)' }}>{subtitle}</p>
    </div>
  );
}

function ChecklistRow({
  icon,
  text,
  checked,
  onToggle,
}: {
  icon: React.ReactNode;
  text: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      aria-pressed={checked}
      className="rounded-xl p-3 cursor-pointer transition-all flex items-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary-purple)]"
      style={{
        backgroundColor: checked ? 'var(--brand-success-green-light)' : 'white',
        border: `1.5px solid ${checked ? 'var(--brand-success-green)' : 'var(--brand-border)'}`,
      }}
      whileTap={{ scale: 0.99 }}
    >
      <div
        className="shrink-0 rounded-lg flex items-center justify-center"
        style={{
          width: 36,
          height: 36,
          backgroundColor: checked ? 'var(--brand-success-green)' : 'var(--brand-primary-purple-light)',
          color: checked ? 'white' : 'var(--brand-primary-purple)',
        }}
      >
        {icon}
      </div>
      <p className="flex-1 text-[13.5px]" style={{ color: 'var(--brand-text-primary)' }}>
        {text}
      </p>
      <div
        className="shrink-0 rounded-full flex items-center justify-center transition-all"
        style={{
          width: 24,
          height: 24,
          backgroundColor: checked ? 'var(--brand-success-green)' : 'transparent',
          border: `2px solid ${checked ? 'var(--brand-success-green)' : 'var(--brand-border)'}`,
        }}
      >
        {checked && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
      </div>
    </motion.div>
  );
}

function B1Checklist({ form, setField }: StepProps) {
  const items: { key: keyof FormData; icon: React.ReactNode; text: string }[] = [
    { key: 'noCaffeine', icon: <Coffee className="w-5 h-5" />, text: 'No caffeine in the last 30 minutes' },
    { key: 'noSmoking', icon: <Cigarette className="w-5 h-5" />, text: 'No smoking in the last 30 minutes' },
    { key: 'noExercise', icon: <Activity className="w-5 h-5" />, text: 'No exercise in the last 30 minutes' },
    { key: 'bladderEmpty', icon: <Droplets className="w-5 h-5" />, text: 'Bladder is empty' },
    { key: 'seatedQuietly', icon: <Timer className="w-5 h-5" />, text: 'Seated quietly for at least 5 minutes' },
    { key: 'posturalSupport', icon: <Armchair className="w-5 h-5" />, text: 'Back supported, feet flat, arm at heart level' },
    { key: 'notTalking', icon: <MessageSquareOff className="w-5 h-5" />, text: 'Not talking during the measurement' },
    { key: 'cuffOnBareArm', icon: <Shirt className="w-5 h-5" />, text: 'Cuff is on bare upper arm (not over clothing)' },
  ];

  const checkedCount = items.filter((it) => Boolean(form[it.key])).length;

  return (
    <div className="space-y-5">
      <StepHeader
        title="Before you measure"
        subtitle="A quick checklist for an accurate reading."
        audio="Before you measure. A quick checklist for an accurate reading. Tap each item that is true for you right now."
        step={1}
        total={5}
      />

      <div className="flex items-center justify-between rounded-xl p-3"
        style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}>
        <p className="text-[12.5px]" style={{ color: 'var(--brand-text-secondary)' }}>
          {checkedCount === 8 ? 'All set — your reading will be the most accurate.' : `${checkedCount} of 8 confirmed.`}
        </p>
        <span
          className="text-[11px] font-bold px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: checkedCount === 8 ? 'var(--brand-success-green)' : 'white',
            color: checkedCount === 8 ? 'white' : 'var(--brand-primary-purple)',
          }}
        >
          {checkedCount}/8
        </span>
      </div>

      <div className="space-y-2.5">
        {items.map((it) => (
          <ChecklistRow
            key={it.key}
            icon={it.icon}
            text={it.text}
            checked={Boolean(form[it.key])}
            onToggle={() => setField(it.key, !form[it.key] as FormData[typeof it.key])}
          />
        ))}
      </div>

      <p className="text-[12px] text-center" style={{ color: 'var(--brand-text-muted)' }}>
        These help your care team trust the reading. You can skip items that don&apos;t apply.
      </p>
    </div>
  );
}

function B2Reading({ form, setField }: StepProps) {
  const sys = parseInt(form.systolicBP || '0', 10);
  const dia = parseInt(form.diastolicBP || '0', 10);
  const isElevated = sys >= 140 || dia >= 90;
  const isCritical = sys >= 180 || dia >= 110;

  return (
    <div className="space-y-6">
      <StepHeader
        title="Your reading"
        subtitle="Numbers from the cuff, plus when and how you sat."
        audio="Your reading. Enter the numbers from the cuff, when you took it, and how you were sitting."
        step={2}
        total={5}
      />

      {/* Date + Time — split into two pickers (cleaner than datetime-local on
          small screens where the native picker eats horizontal space). */}
      <div>
        <label className="flex items-center gap-2 text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
          <CalendarClock className="w-4 h-4" />
          When was this taken?
        </label>
        <div className="grid grid-cols-2 gap-2.5">
          <input
            type="date"
            aria-label="Date"
            value={form.measuredDate}
            onChange={(e) => setField('measuredDate', e.target.value)}
            className="h-12 px-3 rounded-xl text-[15px] outline-none transition box-border min-w-0 w-full"
            style={{
              border: '2px solid var(--brand-border)',
              color: 'var(--brand-text-primary)',
              backgroundColor: 'white',
              colorScheme: 'light',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--brand-primary-purple)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--brand-border)'; }}
          />
          <input
            type="time"
            aria-label="Time"
            value={form.measuredTime}
            onChange={(e) => setField('measuredTime', e.target.value)}
            className="h-12 px-3 rounded-xl text-[15px] outline-none transition box-border min-w-0 w-full"
            style={{
              border: '2px solid var(--brand-border)',
              color: 'var(--brand-text-primary)',
              backgroundColor: 'white',
              colorScheme: 'light',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--brand-primary-purple)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--brand-border)'; }}
          />
        </div>
      </div>

      {/* Position */}
      <div>
        <label className="flex items-center justify-between text-[13px] font-semibold mb-3" style={{ color: 'var(--brand-text-primary)' }}>
          <span>How were you positioned?</span>
          <AudioButton text="How were you positioned? Sitting, standing, or lying down." size="sm" />
        </label>
        <div className="grid grid-cols-3 gap-3">
          <ChoiceCard
            icon={<Armchair className="w-7 h-7" />}
            title="Sitting"
            selected={form.position === 'SITTING'}
            onClick={() => setField('position', 'SITTING')}
            audioText="Sitting"
            compact
          />
          <ChoiceCard
            icon={<PersonStanding className="w-7 h-7" />}
            title="Standing"
            selected={form.position === 'STANDING'}
            onClick={() => setField('position', 'STANDING')}
            audioText="Standing"
            compact
          />
          <ChoiceCard
            icon={<Bed className="w-7 h-7" />}
            title="Lying"
            selected={form.position === 'LYING'}
            onClick={() => setField('position', 'LYING')}
            audioText="Lying"
            compact
          />
        </div>
      </div>

      {/* BP */}
      <div>
        <label className="flex items-center justify-between text-[13px] font-semibold mb-3" style={{ color: 'var(--brand-text-primary)' }}>
          <span>Blood pressure (mmHg)</span>
          <AudioButton text="Enter your blood pressure. The top number is systolic, the bottom number is diastolic." size="sm" />
        </label>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <input
              type="number"
              inputMode="numeric"
              min={60}
              max={250}
              value={form.systolicBP}
              onChange={(e) => setField('systolicBP', e.target.value)}
              placeholder="120"
              className="w-full outline-none transition text-center"
              style={{
                height: 76,
                borderRadius: 'var(--brand-radius-input)',
                border: `2px solid ${form.systolicBP && isCritical ? 'var(--brand-alert-red)' : form.systolicBP && isElevated ? 'var(--brand-warning-amber)' : 'var(--brand-border)'}`,
                fontSize: 32,
                color: form.systolicBP
                  ? isCritical ? 'var(--brand-alert-red)' : isElevated ? 'var(--brand-warning-amber)' : 'var(--brand-text-primary)'
                  : 'var(--brand-text-muted)',
                backgroundColor: 'white',
              }}
            />
            <p className="text-[11px] text-center mt-1.5" style={{ color: 'var(--brand-text-muted)' }}>Top (systolic)</p>
          </div>
          <div className="pb-7 text-[32px] font-light" style={{ color: 'var(--brand-text-muted)' }}>/</div>
          <div className="flex-1">
            <input
              type="number"
              inputMode="numeric"
              min={40}
              max={150}
              value={form.diastolicBP}
              onChange={(e) => setField('diastolicBP', e.target.value)}
              placeholder="80"
              className="w-full outline-none transition text-center"
              style={{
                height: 76,
                borderRadius: 'var(--brand-radius-input)',
                border: '2px solid var(--brand-border)',
                fontSize: 32,
                color: form.diastolicBP ? 'var(--brand-text-primary)' : 'var(--brand-text-muted)',
                backgroundColor: 'white',
              }}
            />
            <p className="text-[11px] text-center mt-1.5" style={{ color: 'var(--brand-text-muted)' }}>Bottom (diastolic)</p>
          </div>
        </div>

        <AnimatePresence>
          {form.systolicBP && form.diastolicBP && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="rounded-xl px-4 py-2.5 mt-3 flex items-center gap-3"
              style={{
                backgroundColor: isCritical
                  ? 'var(--brand-alert-red-light)'
                  : isElevated
                    ? 'var(--brand-warning-amber-light)'
                    : 'var(--brand-success-green-light)',
              }}
            >
              <span
                className="w-2 h-2 rounded-full animate-pulse"
                style={{
                  backgroundColor: isCritical
                    ? 'var(--brand-alert-red)'
                    : isElevated
                      ? 'var(--brand-warning-amber)'
                      : 'var(--brand-success-green)',
                }}
              />
              <p
                className="text-[12.5px] font-semibold"
                style={{
                  color: isCritical
                    ? 'var(--brand-alert-red)'
                    : isElevated
                      ? 'var(--brand-warning-amber)'
                      : 'var(--brand-success-green)',
                }}
              >
                {isCritical ? 'Very high — your care team will be notified' : isElevated ? 'Elevated — above target range' : 'Within normal range'}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Pulse */}
      <div>
        <label className="flex items-center justify-between text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
          <span className="flex items-center gap-2"><Heart className="w-4 h-4" /> Pulse (beats per minute)</span>
          <AudioButton text="Pulse. Beats per minute, usually shown on the cuff." size="sm" />
        </label>
        <input
          type="number"
          inputMode="numeric"
          min={30}
          max={220}
          value={form.pulse}
          onChange={(e) => setField('pulse', e.target.value)}
          placeholder="72"
          className="w-full h-12 px-4 rounded-xl text-center outline-none transition box-border"
          style={{
            border: '2px solid var(--brand-border)',
            color: form.pulse ? 'var(--brand-text-primary)' : 'var(--brand-text-muted)',
            backgroundColor: 'white',
            fontSize: 18,
          }}
        />
      </div>
    </div>
  );
}

function StepWeight({ form, setField }: StepProps) {
  return (
    <div className="space-y-6">
      <StepHeader
        title="Weight (optional)"
        subtitle="Skip this if you didn't weigh yourself today."
        audio="Weight, optional. Skip this if you didn't weigh yourself today."
        step={3}
        total={5}
      />

      <div>
        <label className="block text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>Unit</label>
        <div
          className="inline-flex rounded-full p-1 gap-1"
          style={{ backgroundColor: 'var(--brand-background)', border: '1px solid var(--brand-border)' }}
        >
          {(['lbs', 'kg'] as const).map((unit) => (
            <button
              key={unit}
              type="button"
              onClick={() => setField('weightUnit', unit)}
              className="px-5 py-1.5 rounded-full text-sm font-semibold transition-all cursor-pointer"
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
          Weight ({form.weightUnit})
        </label>
        <div className="relative">
          <input
            type="number"
            inputMode="decimal"
            value={form.weight}
            onChange={(e) => setField('weight', e.target.value)}
            placeholder={form.weightUnit === 'lbs' ? '185' : '84'}
            className="w-full outline-none transition text-center"
            style={{
              height: 72,
              borderRadius: 'var(--brand-radius-input)',
              border: '2px solid var(--brand-border)',
              fontSize: 32,
              color: form.weight ? 'var(--brand-text-primary)' : 'var(--brand-text-muted)',
              backgroundColor: 'white',
            }}
          />
          <span className="absolute right-5 top-1/2 -translate-y-1/2 text-[16px]" style={{ color: 'var(--brand-text-muted)' }}>
            {form.weightUnit}
          </span>
        </div>
      </div>

      <div className="rounded-xl p-3.5 flex gap-3" style={{ backgroundColor: 'var(--brand-accent-teal-light)' }}>
        <Scale className="w-5 h-5 mt-0.5 shrink-0" style={{ color: 'var(--brand-accent-teal)' }} />
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
          Sudden gain (3+ lbs in 24 hours) can signal fluid retention — your care team watches for this.
        </p>
      </div>
    </div>
  );
}

interface MedicationStepProps extends StepProps {
  medications: Array<{ id: string; drugName: string; drugClass: string }>;
  medsLoading: boolean;
}

const MISSED_REASONS: Array<{
  value: 'FORGOT' | 'SIDE_EFFECTS' | 'RAN_OUT' | 'COST' | 'INTENTIONAL' | 'OTHER';
  label: string;
}> = [
  { value: 'FORGOT', label: 'Forgot' },
  { value: 'SIDE_EFFECTS', label: 'Side effects' },
  { value: 'RAN_OUT', label: 'Ran out' },
  { value: 'COST', label: 'Cost' },
  { value: 'INTENTIONAL', label: 'Chose to skip' },
  { value: 'OTHER', label: 'Other' },
];

function StepMedication({ form, setField, medications, medsLoading }: MedicationStepProps) {
  const toggleMed = (med: { id: string; drugName: string; drugClass: string }) => {
    const existing = form.missedMedications.find((m) => m.medicationId === med.id);
    if (existing) {
      setField(
        'missedMedications',
        form.missedMedications.filter((m) => m.medicationId !== med.id),
      );
    } else {
      setField('missedMedications', [
        ...form.missedMedications,
        {
          medicationId: med.id,
          drugName: med.drugName,
          drugClass: med.drugClass,
          reason: null,
          missedDoses: 1,
        },
      ]);
    }
  };

  const updateEntry = (
    medicationId: string,
    patch: Partial<FormData['missedMedications'][number]>,
  ) => {
    setField(
      'missedMedications',
      form.missedMedications.map((m) =>
        m.medicationId === medicationId ? { ...m, ...patch } : m,
      ),
    );
  };

  const showMedList = form.medicationTaken === 'no' && medications.length > 0;

  return (
    <div className="space-y-6">
      <StepHeader
        title="Medication today"
        subtitle="Did you take all your prescribed medicines?"
        audio="Medication today. Did you take all your prescribed medicines?"
        step={4}
        total={5}
      />

      <div className="grid grid-cols-2 gap-3">
        {[
          { value: 'yes' as const, label: 'Yes, all taken', accent: 'var(--brand-success-green)' },
          { value: 'no' as const, label: 'Missed one or more', accent: 'var(--brand-warning-amber)' },
        ].map((opt) => {
          const active = form.medicationTaken === opt.value;
          return (
            <motion.button
              key={opt.value}
              type="button"
              onClick={() => {
                setField('medicationTaken', opt.value);
                // Flipping back to "yes" clears any captured miss detail so
                // the user doesn't accidentally submit a stale list.
                if (opt.value === 'yes') setField('missedMedications', []);
              }}
              className="h-14 rounded-2xl text-sm font-semibold border-2 transition-all flex items-center justify-center gap-2 cursor-pointer"
              style={{
                backgroundColor: active ? opt.accent : 'white',
                borderColor: active ? opt.accent : 'var(--brand-border)',
                color: active ? 'white' : 'var(--brand-text-secondary)',
                boxShadow: active ? `0 4px 12px ${opt.accent}40` : 'none',
              }}
              whileTap={{ scale: 0.97 }}
            >
              <Pill className="w-4 h-4" />
              {opt.label}
            </motion.button>
          );
        })}
      </div>

      {form.medicationTaken === 'no' && medsLoading && (
        <p className="text-[13px] text-center" style={{ color: 'var(--brand-text-muted)' }}>
          Loading your medications…
        </p>
      )}

      {form.medicationTaken === 'no' && !medsLoading && medications.length === 0 && (
        <div
          className="rounded-xl p-3 text-[13px] leading-relaxed"
          style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-text-primary)' }}
        >
          We don&apos;t have any medications on file for you yet. You can still submit; add your medications in settings later for better follow-up.
        </div>
      )}

      {showMedList && (
        <div className="space-y-3">
          <div>
            <p className="text-[14px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
              Which medication(s) did you miss?
            </p>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>
              Help us understand so your care team can support you.
            </p>
          </div>

          {medications.map((med) => {
            const entry = form.missedMedications.find((m) => m.medicationId === med.id);
            const selected = !!entry;
            return (
              <div
                key={med.id}
                className="rounded-xl border-2 transition-all"
                style={{
                  borderColor: selected ? 'var(--brand-warning-amber)' : 'var(--brand-border)',
                  backgroundColor: selected ? 'var(--brand-warning-amber-light)' : 'white',
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleMed(med)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer"
                >
                  <span
                    className="w-5 h-5 rounded-[5px] border-2 flex items-center justify-center shrink-0"
                    style={{
                      borderColor: selected
                        ? 'var(--brand-warning-amber)'
                        : 'var(--brand-border)',
                      backgroundColor: selected ? 'var(--brand-warning-amber)' : 'white',
                    }}
                  >
                    {selected && <CheckCircle className="w-3 h-3 text-white" />}
                  </span>
                  <span className="flex-1">
                    <span className="block text-[14px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                      {med.drugName}
                    </span>
                    <span className="block text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
                      {med.drugClass.replace(/_/g, ' ').toLowerCase()}
                    </span>
                  </span>
                </button>

                {selected && entry && (
                  <div className="px-4 pb-3 space-y-3 border-t" style={{ borderColor: 'var(--brand-border)' }}>
                    <div className="pt-3">
                      <label
                        htmlFor={`reason-${med.id}`}
                        className="text-[11px] font-semibold uppercase tracking-wide"
                        style={{ color: 'var(--brand-text-muted)' }}
                      >
                        Why did you miss it?
                      </label>
                      <select
                        id={`reason-${med.id}`}
                        value={entry.reason ?? ''}
                        onChange={(e) =>
                          updateEntry(med.id, {
                            reason: (e.target.value || null) as typeof entry.reason,
                          })
                        }
                        className="mt-1 w-full px-3 py-2 rounded-lg border text-[14px] bg-white"
                        style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-primary)' }}
                      >
                        <option value="">Select a reason…</option>
                        {MISSED_REASONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <fieldset className="border-0 p-0 m-0">
                      <legend
                        className="text-[11px] font-semibold uppercase tracking-wide"
                        style={{ color: 'var(--brand-text-muted)' }}
                      >
                        How many doses?
                      </legend>
                      <div className="mt-1 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            updateEntry(med.id, {
                              missedDoses: Math.max(1, entry.missedDoses - 1),
                            })
                          }
                          className="w-8 h-8 rounded-lg border flex items-center justify-center cursor-pointer"
                          style={{
                            borderColor: 'var(--brand-border)',
                            color: 'var(--brand-text-secondary)',
                          }}
                        >
                          −
                        </button>
                        <span className="text-[16px] font-bold w-6 text-center" style={{ color: 'var(--brand-text-primary)' }}>
                          {entry.missedDoses}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            updateEntry(med.id, {
                              missedDoses: Math.min(10, entry.missedDoses + 1),
                            })
                          }
                          className="w-8 h-8 rounded-lg border flex items-center justify-center cursor-pointer"
                          style={{
                            borderColor: 'var(--brand-border)',
                            color: 'var(--brand-text-secondary)',
                          }}
                        >
                          +
                        </button>
                      </div>
                    </fieldset>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface SymptomsStepProps extends StepProps {
  isPregnant: boolean;
}

function B3Symptoms({ form, setField, isPregnant }: SymptomsStepProps) {
  const core: { key: keyof FormData; icon: React.ReactNode; text: string }[] = [
    { key: 'severeHeadache', icon: <Brain className="w-5 h-5" />, text: 'Severe headache' },
    { key: 'visualChanges', icon: <Eye className="w-5 h-5" />, text: 'Vision changes' },
    { key: 'alteredMentalStatus', icon: <Brain className="w-5 h-5" />, text: 'Confusion / not feeling like yourself' },
    { key: 'chestPainOrDyspnea', icon: <Wind className="w-5 h-5" />, text: 'Chest pain or trouble breathing' },
    { key: 'focalNeuroDeficit', icon: <Zap className="w-5 h-5" />, text: 'Weakness, numbness, or speech problems' },
    { key: 'severeEpigastricPain', icon: <Stethoscope className="w-5 h-5" />, text: 'Severe stomach or upper-right pain' },
  ];
  const pregnancy: { key: keyof FormData; icon: React.ReactNode; text: string }[] = [
    { key: 'newOnsetHeadache', icon: <Brain className="w-5 h-5" />, text: 'New headache (not usual for you)' },
    { key: 'ruqPain', icon: <Stethoscope className="w-5 h-5" />, text: 'Pain in upper-right belly' },
    { key: 'edema', icon: <Droplets className="w-5 h-5" />, text: 'New swelling in face, hands, or feet' },
  ];

  return (
    <div className="space-y-5">
      <StepHeader
        title="How do you feel?"
        subtitle="Tap anything you're feeling right now. Tap nothing if you feel fine."
        audio="How do you feel? Tap anything you're feeling right now. Tap nothing if you feel fine."
        step={5}
        total={5}
      />

      <div className="rounded-xl p-3 flex items-start gap-3"
        style={{ backgroundColor: 'var(--brand-alert-red-light)' }}>
        <Heart className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--brand-alert-red)' }} />
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--brand-text-primary)' }}>
          If you have these now, your care team is notified right away.
        </p>
      </div>

      <div className="space-y-2.5">
        {core.map((s) => (
          <ChecklistRow
            key={s.key}
            icon={s.icon}
            text={s.text}
            checked={Boolean(form[s.key])}
            onToggle={() => setField(s.key, !form[s.key] as FormData[typeof s.key])}
          />
        ))}
      </div>

      <AnimatePresence>
        {isPregnant && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="space-y-2.5"
          >
            <div className="flex items-center gap-2 mt-3">
              <Baby className="w-4 h-4" style={{ color: 'var(--brand-primary-purple)' }} />
              <p className="text-[12.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-primary-purple)' }}>
                Pregnancy-specific
              </p>
            </div>
            {pregnancy.map((s) => (
              <ChecklistRow
                key={s.key}
                icon={s.icon}
                text={s.text}
                checked={Boolean(form[s.key])}
                onToggle={() => setField(s.key, !form[s.key] as FormData[typeof s.key])}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div>
        <label className="block text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
          Anything else? (optional)
        </label>
        <textarea
          rows={3}
          value={form.otherSymptomsText}
          onChange={(e) => setField('otherSymptomsText', e.target.value)}
          placeholder="In your own words…"
          className="w-full rounded-xl px-4 py-3 text-[13px] resize-none outline-none transition"
          style={{
            border: '2px solid var(--brand-border)',
            color: 'var(--brand-text-primary)',
            backgroundColor: 'white',
          }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation (B5) + B4 add-another
// ─────────────────────────────────────────────────────────────────────────────

function ConfirmationScreen({
  lastReading,
  sessionReadings,
  hasAFib,
  missedMedNames,
  onAddAnother,
  onDone,
}: {
  lastReading: SessionReading;
  sessionReadings: SessionReading[];
  hasAFib: boolean;
  missedMedNames: string[];
  onAddAnother: () => void;
  onDone: () => void;
}) {
  const total = sessionReadings.length;
  const aFibSatisfied = !hasAFib || total >= 3;

  return (
    // Compacted to fit a typical phone viewport (~700px) without scrolling.
    // Tighter checkmark, smaller summary card, and the "what happens next"
    // bullets folded into a single line.
    <div className="flex flex-col items-center text-center px-4 w-full max-w-sm">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 18 }}
        className="rounded-full flex items-center justify-center mb-3"
        style={{ width: 64, height: 64, backgroundColor: 'var(--brand-success-green-light)' }}
      >
        <Check className="w-9 h-9" style={{ color: 'var(--brand-success-green)' }} strokeWidth={3} />
      </motion.div>

      <h2 className="text-[20px] font-bold leading-tight" style={{ color: 'var(--brand-text-primary)' }}>
        Reading {total > 1 ? `${total} ` : ''}sent
      </h2>
      <p className="text-[13px] mt-0.5 mb-4" style={{ color: 'var(--brand-text-muted)' }}>
        Your care team gets it right away.
      </p>

      {/* Reading summary card */}
      <div
        className="w-full rounded-2xl p-3 mb-3"
        style={{ backgroundColor: 'white', border: '1.5px solid var(--brand-border)', boxShadow: 'var(--brand-shadow-card)' }}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
            This reading
          </span>
          <AudioButton
            text={`Reading ${lastReading.systolicBP ?? 'unknown'} over ${lastReading.diastolicBP ?? 'unknown'}${lastReading.pulse != null ? `, pulse ${lastReading.pulse}` : ''}`}
            size="sm"
          />
        </div>
        <div className="flex items-baseline gap-2 justify-center">
          <span className="text-[30px] font-bold leading-none" style={{ color: 'var(--brand-primary-purple)' }}>
            {lastReading.systolicBP ?? '--'}/{lastReading.diastolicBP ?? '--'}
          </span>
          <span className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>mmHg</span>
          {lastReading.pulse != null && (
            <span className="text-[12px] font-semibold ml-2 flex items-center gap-1" style={{ color: 'var(--brand-text-secondary)' }}>
              <Heart className="w-3.5 h-3.5" /> {lastReading.pulse}
            </span>
          )}
        </div>
      </div>

      {/* Missed-medication acknowledgement — visible confirmation so the
          patient knows their answer was captured and will reach the care team. */}
      {missedMedNames.length > 0 && (
        <div
          className="w-full rounded-xl px-3 py-2 mb-3 flex items-start gap-2.5 text-left"
          style={{ backgroundColor: 'var(--brand-warning-amber-light)' }}
        >
          <Pill className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--brand-warning-amber)' }} />
          <p className="text-[12px] leading-snug" style={{ color: 'var(--brand-text-primary)' }}>
            We noted you missed{' '}
            <span className="font-bold">{missedMedNames.join(', ')}</span>
            {' '}today — your care team will see this.
          </p>
        </div>
      )}

      {/* AFib reminder + what-happens-next merged into one compact strip */}
      {hasAFib ? (
        <div
          className="w-full rounded-xl px-3 py-2 mb-3 flex items-center gap-2.5 text-left"
          style={{
            backgroundColor: aFibSatisfied ? 'var(--brand-success-green-light)' : 'var(--brand-warning-amber-light)',
          }}
        >
          <Activity
            className="w-4 h-4 shrink-0"
            style={{ color: aFibSatisfied ? 'var(--brand-success-green)' : 'var(--brand-warning-amber)' }}
          />
          <p
            className="text-[12px] leading-snug"
            style={{ color: aFibSatisfied ? 'var(--brand-success-green)' : 'var(--brand-text-primary)' }}
          >
            {aFibSatisfied
              ? `${total} readings — enough to average accurately.`
              : `AFib needs 3 readings · ${total} of 3 done.`}
          </p>
        </div>
      ) : (
        <p className="text-[12px] mb-3 leading-snug" style={{ color: 'var(--brand-text-muted)' }}>
          Your care team will review and reach out only if something looks off.
        </p>
      )}

      {/* Actions */}
      <div className="w-full space-y-2">
        <motion.button
          type="button"
          onClick={onAddAnother}
          className="w-full h-11 rounded-full font-bold text-white text-[13.5px] flex items-center justify-center gap-2 cursor-pointer"
          style={{
            backgroundColor: hasAFib && !aFibSatisfied ? 'var(--brand-warning-amber)' : 'var(--brand-primary-purple)',
            boxShadow: 'var(--brand-shadow-button)',
          }}
          whileTap={{ scale: 0.97 }}
        >
          <Plus className="w-4 h-4" />
          Add another reading
        </motion.button>
        <motion.button
          type="button"
          onClick={onDone}
          className="w-full h-11 rounded-full font-bold text-[13.5px] flex items-center justify-center gap-2 cursor-pointer"
          style={{
            backgroundColor: 'white',
            border: '1.5px solid var(--brand-border)',
            color: 'var(--brand-text-secondary)',
          }}
          whileTap={{ scale: 0.97 }}
        >
          <Home className="w-4 h-4" />
          Back to dashboard
        </motion.button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main wizard
// ─────────────────────────────────────────────────────────────────────────────

const STEP_FLOW: StepKey[] = ['B1', 'B2', 'WEIGHT', 'MEDICATION', 'B3'];
// First-reading flow includes B1; second+ readings in the same session skip B1.
const SECOND_READING_FLOW: StepKey[] = ['B2', 'WEIGHT', 'MEDICATION', 'B3'];

export default function CheckIn() {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useAuth();
  const { } = useLanguage(); // reserved for future i18n wiring

  const [profile, setProfile] = useState<PatientProfileDto | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [medications, setMedications] = useState<PatientMedication[]>([]);
  const [medsLoading, setMedsLoading] = useState(true);

  const [form, setForm] = useState<FormData>(emptyForm);
  const [step, setStep] = useState<StepKey>('B1');
  const [direction, setDirection] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Session state — sessionId is generated once via lazy init so we don't
  // need a setState-in-effect to bootstrap it (Next 16 lint).
  const [sessionId] = useState<string>(() => uuid());
  const [sessionReadings, setSessionReadings] = useState<SessionReading[]>([]);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [readingNumber, setReadingNumber] = useState(0); // count of submitted readings in session

  // Fetch patient profile to know isPregnant + hasAFib.
  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    let cancelled = false;
    (async () => {
      const p = await getMyPatientProfile().catch(() => null);
      if (!cancelled) {
        setProfile(p);
        setProfileLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, isLoading]);

  // Fetch active medications — rendered as checkbox list in MEDICATION step.
  // Cheap call; fire on mount so the list is ready before the user reaches
  // step 4.
  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    let cancelled = false;
    (async () => {
      const meds = await listMyMedications().catch(() => [] as PatientMedication[]);
      if (!cancelled) {
        setMedications(meds);
        setMedsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, isLoading]);

  // Snap the page to the top whenever the wizard advances (or goes back) to
  // a different step — otherwise the user lands wherever the previous step's
  // scroll position left them, which is disorienting.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [step, showConfirmation]);

  const isPregnant = profile?.isPregnant === true;
  const hasAFib = profile?.hasAFib === true;

  const flow = readingNumber === 0 ? STEP_FLOW : SECOND_READING_FLOW;
  const stepIndex = flow.indexOf(step);
  const visibleTotal = flow.length;
  const visibleIndex = stepIndex + 1;

  function setField<K extends keyof FormData>(k: K, v: FormData[K]) {
    if (error) setError('');
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  function validateStep(s: StepKey): string | null {
    if (s === 'B2') {
      if (!form.measuredDate || !form.measuredTime) return 'Please pick the date and time.';
      const measuredDate = new Date(`${form.measuredDate}T${form.measuredTime}`);
      if (isNaN(measuredDate.getTime())) return 'That date doesn\'t look right.';
      const now = Date.now();
      if (measuredDate.getTime() > now + 5 * 60 * 1000) return 'The time is in the future.';
      if (measuredDate.getTime() < now - 30 * 24 * 60 * 60 * 1000) return 'That\'s more than 30 days ago.';
      if (!form.position) return 'Pick a position.';
      if (!form.systolicBP || !form.diastolicBP) return 'Enter both blood pressure numbers.';
      const sys = parseInt(form.systolicBP, 10);
      const dia = parseInt(form.diastolicBP, 10);
      if (sys < 60 || sys > 250) return 'Top number should be between 60 and 250.';
      if (dia < 40 || dia > 150) return 'Bottom number should be between 40 and 150.';
      if (form.pulse) {
        const p = parseInt(form.pulse, 10);
        if (p < 30 || p > 220) return 'Pulse should be between 30 and 220.';
      }
    }
    if (s === 'MEDICATION') {
      // Require "why" when patient checks off a medication. If the medication
      // list is empty (e.g. new user), we allow submitting without details.
      if (form.medicationTaken === 'no' && medications.length > 0) {
        if (form.missedMedications.length === 0) {
          return 'Please tell us which medication you missed, or choose "Yes, all taken" if you took them.';
        }
        const missingReason = form.missedMedications.find((m) => !m.reason);
        if (missingReason) {
          return `Please pick a reason for ${missingReason.drugName}.`;
        }
      }
    }
    return null;
  }

  async function handleSubmit() {
    if (submitting) return;
    setError('');

    // Build payload
    const measurementConditions = {
      noCaffeine: form.noCaffeine,
      noSmoking: form.noSmoking,
      noExercise: form.noExercise,
      bladderEmpty: form.bladderEmpty,
      seatedQuietly: form.seatedQuietly,
      posturalSupport: form.posturalSupport,
      notTalking: form.notTalking,
      cuffOnBareArm: form.cuffOnBareArm,
    };

    const measuredAtIso = new Date(`${form.measuredDate}T${form.measuredTime}`).toISOString();
    const sys = form.systolicBP ? parseInt(form.systolicBP, 10) : undefined;
    const dia = form.diastolicBP ? parseInt(form.diastolicBP, 10) : undefined;
    const pul = form.pulse ? parseInt(form.pulse, 10) : undefined;

    const weightLbsOrKg = form.weight ? parseFloat(form.weight) : undefined;
    const weightKg = weightLbsOrKg && form.weightUnit === 'lbs' ? weightLbsOrKg * 0.45359237 : weightLbsOrKg;

    setSubmitting(true);
    try {
      await createJournalEntry({
        measuredAt: measuredAtIso,
        systolicBP: sys,
        diastolicBP: dia,
        pulse: pul,
        weight: weightKg ? Number(weightKg.toFixed(2)) : undefined,
        position: form.position ?? undefined,
        sessionId,
        measurementConditions,
        medicationTaken: form.medicationTaken === 'yes' ? true : form.medicationTaken === 'no' ? false : undefined,
        missedMedications:
          form.missedMedications.length > 0
            ? form.missedMedications
                .filter((m) => m.reason !== null)
                .map((m) => ({
                  medicationId: m.medicationId,
                  drugName: m.drugName,
                  drugClass: m.drugClass,
                  reason: m.reason!,
                  missedDoses: m.missedDoses,
                }))
            : undefined,
        severeHeadache: form.severeHeadache,
        visualChanges: form.visualChanges,
        alteredMentalStatus: form.alteredMentalStatus,
        chestPainOrDyspnea: form.chestPainOrDyspnea,
        focalNeuroDeficit: form.focalNeuroDeficit,
        severeEpigastricPain: form.severeEpigastricPain,
        newOnsetHeadache: isPregnant ? form.newOnsetHeadache : false,
        ruqPain: isPregnant ? form.ruqPain : false,
        edema: isPregnant ? form.edema : false,
        otherSymptoms: form.otherSymptomsText.trim() ? [form.otherSymptomsText.trim()] : undefined,
      });

      const reading: SessionReading = {
        measuredAt: measuredAtIso,
        systolicBP: sys,
        diastolicBP: dia,
        pulse: pul,
      };
      setSessionReadings((prev) => [...prev, reading]);
      setReadingNumber((n) => n + 1);
      setShowConfirmation(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send reading. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function goNext() {
    const v = validateStep(step);
    if (v) { setError(v); return; }
    setError('');
    if (stepIndex === flow.length - 1) {
      void handleSubmit();
      return;
    }
    setDirection(1);
    setStep(flow[stepIndex + 1]);
  }

  function goBack() {
    setError('');
    if (stepIndex === 0) {
      router.push('/dashboard');
      return;
    }
    setDirection(-1);
    setStep(flow[stepIndex - 1]);
  }

  function startAnotherReading() {
    // Keep sessionId; reset reading-specific fields; skip B1 next round.
    setForm((prev) => ({
      ...emptyForm(),
      measuredDate: nowDate(),
      measuredTime: nowTime(),
      // Carry forward the user's checklist answers — they're still valid for
      // the same session so we don't make them re-tap 8 things.
      noCaffeine: prev.noCaffeine,
      noSmoking: prev.noSmoking,
      noExercise: prev.noExercise,
      bladderEmpty: prev.bladderEmpty,
      seatedQuietly: prev.seatedQuietly,
      posturalSupport: prev.posturalSupport,
      notTalking: prev.notTalking,
      cuffOnBareArm: prev.cuffOnBareArm,
      weightUnit: prev.weightUnit,
    }));
    setShowConfirmation(false);
    setStep('B2');
    setDirection(1);
  }

  // Authed loading state — skeleton mirroring the wizard chrome (top bar +
  // step header + a few content rows + sticky CTA placeholder) so the page
  // doesn't flash a generic spinner before the first step renders.
  if (isLoading || !isAuthenticated || profileLoading) {
    return <CheckInSkeleton />;
  }

  // Confirmation overlays the whole flow
  if (showConfirmation) {
    const last = sessionReadings[sessionReadings.length - 1];
    return (
      <div
        className="min-h-screen flex flex-col"
        style={{ backgroundColor: 'var(--brand-background)' }}
      >
        <main className="flex-1 flex items-center justify-center w-full max-w-3xl mx-auto px-4 sm:px-6 py-4">
          <ConfirmationScreen
            lastReading={last}
            sessionReadings={sessionReadings}
            hasAFib={hasAFib}
            missedMedNames={form.missedMedications.map((m) => m.drugName)}
            onAddAnother={startAnotherReading}
            onDone={() => router.push('/dashboard')}
          />
        </main>
      </div>
    );
  }

  const stepProps: StepProps = { form, setField };

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--brand-background)' }}>
      {/* Top bar */}
      <header className="sticky top-0 z-20 bg-white" style={{ borderBottom: '1px solid var(--brand-border)' }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={goBack}
            className="flex items-center gap-1.5 h-9 px-3 rounded-full text-[13px] font-semibold cursor-pointer"
            style={{ color: 'var(--brand-text-secondary)' }}
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <StepDots current={visibleIndex} total={visibleTotal} />
          <div className="w-[60px]" aria-hidden /> {/* spacer to keep dots centered */}
        </div>
        {readingNumber > 0 && (
          <div
            className="px-4 sm:px-6 py-2 flex items-center justify-center gap-2 text-[12px] font-semibold"
            style={{ backgroundColor: 'var(--brand-primary-purple-light)', color: 'var(--brand-primary-purple)' }}
          >
            <Volume2 className="w-3.5 h-3.5" />
            Reading {readingNumber + 1} in this session{hasAFib ? ' · AFib needs 3 in a row' : ''}
          </div>
        )}
      </header>

      {/* Main content with safe-area bottom padding sized just enough to clear
          the sticky CTA (~72px tall) plus the iOS home indicator. */}
      <main
        className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-5 sm:py-8"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 7rem)' }}
      >
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            initial={{ x: direction > 0 ? 60 : -60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: direction > 0 ? -60 : 60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
          >
            {step === 'B1' && <B1Checklist {...stepProps} />}
            {step === 'B2' && <B2Reading {...stepProps} />}
            {step === 'WEIGHT' && <StepWeight {...stepProps} />}
            {step === 'MEDICATION' && (
              <StepMedication
                {...stepProps}
                medications={medications}
                medsLoading={medsLoading}
              />
            )}
            {step === 'B3' && <B3Symptoms {...stepProps} isPregnant={isPregnant} />}
          </motion.div>
        </AnimatePresence>

        {error && (
          <p
            className="mt-5 text-[13px] text-center font-semibold px-4 py-2 rounded-lg"
            style={{ color: 'var(--brand-alert-red)', backgroundColor: 'var(--brand-alert-red-light)' }}
          >
            {error}
          </p>
        )}
      </main>

      {/* Sticky bottom CTA */}
      <div
        className="fixed bottom-0 left-0 right-0 bg-white px-4 pt-3 z-30"
        style={{
          borderTop: '1px solid var(--brand-border)',
          boxShadow: '0 -4px 16px rgba(0,0,0,0.05)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)',
        }}
      >
        <div className="max-w-3xl mx-auto">
          <motion.button
            type="button"
            onClick={goNext}
            disabled={submitting}
            className="w-full h-12 rounded-full text-white font-bold text-[14px] flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--brand-primary-purple)', boxShadow: 'var(--brand-shadow-button)' }}
            whileTap={{ scale: 0.98 }}
          >
            {submitting
              ? 'Sending…'
              : step === 'B3'
                ? 'Submit reading'
                : 'Continue'}
            {!submitting && step !== 'B3' && <ArrowRight className="w-4 h-4" />}
            {!submitting && step === 'B3' && <Check className="w-4 h-4" />}
          </motion.button>
        </div>
      </div>

    </div>
  );
}

// Reserved for a future symptom-row chevron — kept in the import block so
// the icon set reads top-to-bottom in source review.
void ChevronRightIcon;

// ─── Skeleton ────────────────────────────────────────────────────────────────
// Mirrors the wizard layout (top bar with dots, step header, a few content
// rows, sticky bottom CTA placeholder) so the page doesn't pop in.

function SkelBone({ w, h, rounded = 'rounded-lg' }: { w: number | string; h: number; rounded?: string }) {
  return (
    <div
      className={`animate-pulse ${rounded} shrink-0`}
      style={{ width: w, height: h, backgroundColor: '#EDE9F6' }}
    />
  );
}

function SkelDots() {
  return (
    <div className="flex items-center gap-1.5">
      {[22, 7, 7, 7, 7].map((w, i) => (
        <SkelBone key={i} w={w} h={7} rounded="rounded-full" />
      ))}
    </div>
  );
}

function CheckInSkeleton() {
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--brand-background)' }}>
      {/* Top bar */}
      <header className="sticky top-0 z-20 bg-white" style={{ borderBottom: '1px solid var(--brand-border)' }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <SkelBone w={56} h={20} rounded="rounded-full" />
          <SkelDots />
          <SkelBone w={56} h={20} rounded="rounded-full" />
        </div>
      </header>

      {/* Body */}
      <main
        className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-5 sm:py-8"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 7rem)' }}
      >
        {/* Step header */}
        <div className="space-y-2 mb-6">
          <SkelBone w={70} h={11} rounded="rounded-md" />
          <SkelBone w={'70%'} h={26} rounded="rounded-lg" />
          <SkelBone w={'85%'} h={14} rounded="rounded-md" />
        </div>

        {/* Content rows — match B1 checklist look */}
        <div className="space-y-2.5">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div
              key={i}
              className="rounded-xl p-3 flex items-center gap-3"
              style={{ backgroundColor: 'white', border: '1.5px solid var(--brand-border)' }}
            >
              <SkelBone w={36} h={36} rounded="rounded-lg" />
              <div className="flex-1 min-w-0">
                <SkelBone w={`${60 + ((i * 7) % 30)}%`} h={12} rounded="rounded-md" />
              </div>
              <SkelBone w={24} h={24} rounded="rounded-full" />
            </div>
          ))}
        </div>
      </main>

      {/* Sticky bottom CTA */}
      <div
        className="fixed bottom-0 left-0 right-0 bg-white px-4 pt-3 z-30"
        style={{
          borderTop: '1px solid var(--brand-border)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)',
        }}
      >
        <div className="max-w-3xl mx-auto">
          <SkelBone w={'100%'} h={48} rounded="rounded-full" />
        </div>
      </div>
    </div>
  );
}
