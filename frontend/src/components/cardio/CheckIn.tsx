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

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  Square,
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
  Save,
  CalendarClock,
  Plus,
  Home,
  Volume2,
  ClipboardCheck,
} from 'lucide-react';

import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n';
import { ClinicalIntakeRequiredError, createJournalEntry, finalizeSingleReadingSession } from '@/lib/services/journal.service';
import { getMyPatientProfile, type PatientProfileDto } from '@/lib/services/intake.service';
import { hasDraft, loadDraft } from '@/lib/intake/draft';
import {
  loadCheckInDraft,
  saveCheckInDraft,
  clearCheckInDraft,
  type CheckInDraft,
} from '@/lib/checkin/draft';
import {
  listMyMedications,
  type PatientMedication,
} from '@/lib/services/patient-medications.service';
import { getBMI, JOURNAL_NOTE_MAX_LENGTH } from '@cardioplace/shared';
import AudioButton from '@/components/intake/AudioButton';
import MicButton from '@/components/intake/MicButton';
import BpPhotoButton from '@/components/intake/BpPhotoButton';
import ChoiceCard from '@/components/intake/ChoiceCard';
import StepDots from '@/components/intake/StepDots';
import SymptomTagInput from '@/components/intake/SymptomTagInput';

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
  // Medication — per-medication status, keyed by medicationId. Answered
  // lazily as the patient taps toggles; unanswered meds simply stay absent
  // from the map. The combined `medicationTaken` bool + `missedMedications`
  // array the backend expects are derived at submit time from this map.
  // Phase/26 — `scheduledLater` lets the patient flag "not due yet" so the
  // adherence rule doesn't fire and the gap-alert cron knows it's intentional.
  medicationStatus: Record<
    string, // medicationId
    {
      taken: 'yes' | 'no' | 'scheduledLater' | null;
      reason:
        | 'FORGOT'
        | 'SIDE_EFFECTS'
        | 'RAN_OUT'
        | 'COST'
        | 'INTENTIONAL'
        | 'OTHER'
        | null;
      missedDoses: number; // 1 unless the patient adjusts the counter
    }
  >;
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
  // Cluster 6 (Manisha 5/10/26) — patient-driven signals for brady-symptomatic,
  // HF decomp, palpitations, and orthostatic rules.
  dizziness: boolean;
  syncope: boolean;
  palpitations: boolean;
  legSwelling: boolean;
  // Cluster 7 (Manisha 5/11/26) — Appendix A side-effect inputs. Engine +
  // DTO shipped in Cluster 7; the patient check-in surface was deferred
  // (Lakshitha coordination) and is added here so β-blocker fatigue/SOB and
  // ACE dry-cough rules are patient-reachable. (nsaidUse intentionally NOT a
  // symptom button — it's a medication-use question for the intake form.)
  fatigue: boolean;
  shortnessOfBreath: boolean;
  dryCough: boolean;
  // Cluster 8 (Manisha 5/18/26, P0) — ACE-angioedema airway emergency.
  faceSwelling: boolean;
  throatTightness: boolean;
  // Patient-typed custom symptoms (chips) → JournalEntry.otherSymptoms.
  otherSymptomsList: string[];
  // Free-text note → JournalEntry.notes.
  notes: string;
}

interface SessionReading {
  measuredAt: string;
  systolicBP?: number;
  diastolicBP?: number;
  pulse?: number;
  /** Always stored in kg (frontend converts from lbs before submit). Used
   *  to compute BMI for the confirmation screen — patients never enter BMI
   *  themselves per Niva's spec sign-off. */
  weightKg?: number;
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
    medicationStatus: {},
    severeHeadache: false,
    visualChanges: false,
    alteredMentalStatus: false,
    chestPainOrDyspnea: false,
    focalNeuroDeficit: false,
    severeEpigastricPain: false,
    newOnsetHeadache: false,
    ruqPain: false,
    edema: false,
    dizziness: false,
    syncope: false,
    palpitations: false,
    legSwelling: false,
    fatigue: false,
    shortnessOfBreath: false,
    dryCough: false,
    faceSwelling: false,
    throatTightness: false,
    otherSymptomsList: [],
    notes: '',
  };
}

// Weight bounds. Weight is stored in kg on the backend (@Min(20) @Max(300)
// in create-journal-entry.dto.ts), so the lbs bounds are simply the kg
// bounds converted. KG_PER_LB matches the lbs→kg factor used at submit.
const KG_PER_LB = 0.45359237;
const WEIGHT_MIN_KG = 20;
const WEIGHT_MAX_KG = 300;
// Round the lbs window inward (min up, max down) so any value that passes the
// lbs check still converts to a kg value inside the backend's 20–300 window.
const WEIGHT_MIN_LBS = Math.ceil(WEIGHT_MIN_KG / KG_PER_LB); // 45
const WEIGHT_MAX_LBS = Math.floor(WEIGHT_MAX_KG / KG_PER_LB); // 661

/** Min/max for the weight input in the currently-selected unit. */
function weightBounds(unit: 'lbs' | 'kg'): { min: number; max: number } {
  return unit === 'lbs'
    ? { min: WEIGHT_MIN_LBS, max: WEIGHT_MAX_LBS }
    : { min: WEIGHT_MIN_KG, max: WEIGHT_MAX_KG };
}

// Max length for the free-text "Notes" field (B3). Mirrors the backend
// @MaxLength(JOURNAL_NOTE_MAX_LENGTH) guard via the shared constant so the
// client clamp/counter and the server validation can never drift apart. Both
// input paths (typing + voice dictation) clamp to it.
const NOTE_MAX = JOURNAL_NOTE_MAX_LENGTH;

/** True when the patient has entered anything worth keeping as a draft, so a
 *  pristine first-paint form never creates a resume prompt. */
function hasCheckinProgress(form: FormData, step: StepKey): boolean {
  if (step !== 'B1') return true;
  const checklist =
    form.noCaffeine || form.noSmoking || form.noExercise || form.bladderEmpty ||
    form.seatedQuietly || form.posturalSupport || form.notTalking || form.cuffOnBareArm;
  const reading =
    form.position !== null || form.systolicBP !== '' || form.diastolicBP !== '' || form.pulse !== '';
  const weight = form.weight !== '';
  const meds = Object.keys(form.medicationStatus).length > 0;
  const symptoms =
    form.severeHeadache || form.visualChanges || form.alteredMentalStatus ||
    form.chestPainOrDyspnea || form.focalNeuroDeficit || form.severeEpigastricPain ||
    form.newOnsetHeadache || form.ruqPain || form.edema || form.dizziness ||
    form.syncope || form.palpitations || form.legSwelling || form.fatigue ||
    form.shortnessOfBreath || form.dryCough || form.faceSwelling || form.throatTightness ||
    form.otherSymptomsList.length > 0 || form.notes.trim() !== '';
  return Boolean(checklist || reading || weight || meds || symptoms);
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
  const { t } = useLanguage();
  return (
    <div>
      <p className="text-[12px] font-semibold mb-1" style={{ color: 'var(--brand-text-muted)' }}>
        {t('checkin.nav.stepOf').replace('{current}', String(step)).replace('{total}', String(total))}
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
  audioText,
  testId,
}: {
  icon: React.ReactNode;
  text: string;
  checked: boolean;
  onToggle: () => void;
  /** Phase/26 TTS pass 2 — optional spoken label. When set, renders a small
   *  AudioButton next to the row so a non-reader can hear the option before
   *  toggling. Defaults to undefined (no audio button) for backwards compat. */
  audioText?: string;
  testId?: string;
}) {
  return (
    <motion.div
      data-testid={testId}
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        // Only toggle when the keypress targeted the row itself — not when
        // the user keyboard-activated the nested AudioButton (whose Enter
        // event still bubbles up because button.click() doesn't stop the
        // keydown event itself).
        if (e.target !== e.currentTarget) return;
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
      {audioText && (
        // AudioButton already calls e.stopPropagation() on its onClick so
        // tapping it doesn't also fire the row's onClick toggle. No
        // additional wrapper handlers needed.
        <span className="shrink-0">
          <AudioButton size="sm" text={audioText} />
        </span>
      )}
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
  const { t } = useLanguage();
  const items: { key: keyof FormData; icon: React.ReactNode; text: string }[] = [
    { key: 'noCaffeine', icon: <Coffee className="w-5 h-5" />, text: t('checkin.b1.itemNoCaffeine') },
    { key: 'noSmoking', icon: <Cigarette className="w-5 h-5" />, text: t('checkin.b1.itemNoSmoking') },
    { key: 'noExercise', icon: <Activity className="w-5 h-5" />, text: t('checkin.b1.itemNoExercise') },
    { key: 'bladderEmpty', icon: <Droplets className="w-5 h-5" />, text: t('checkin.b1.itemBladder') },
    { key: 'seatedQuietly', icon: <Timer className="w-5 h-5" />, text: t('checkin.b1.itemSeated') },
    { key: 'posturalSupport', icon: <Armchair className="w-5 h-5" />, text: t('checkin.b1.itemPosture') },
    { key: 'notTalking', icon: <MessageSquareOff className="w-5 h-5" />, text: t('checkin.b1.itemNotTalking') },
    { key: 'cuffOnBareArm', icon: <Shirt className="w-5 h-5" />, text: t('checkin.b1.itemCuff') },
  ];

  const checkedCount = items.filter((it) => Boolean(form[it.key])).length;
  const allChecked = checkedCount === items.length;

  // Select-all / unselect-all toggle. Setting each field in a loop is safe:
  // React batches the functional setForm updates inside this handler into a
  // single re-render, so all 8 items flip at once.
  const toggleAll = () => {
    const next = !allChecked;
    items.forEach((it) => setField(it.key, next as FormData[typeof it.key]));
  };

  return (
    <div data-testid="checkin-step-1" className="space-y-5">
      <StepHeader
        title={t('checkin.b1.title')}
        subtitle={t('checkin.b1.subtitle')}
        audio={t('checkin.b1.audio')}
        step={1}
        total={5}
      />

      {/* Progress line + select-all toggle share one row. The status text
          shrinks/ellipsizes first so the toggle + count stay intact on narrow
          phones; on very small screens the whole row wraps cleanly. */}
      <div className="flex items-center justify-between gap-2 flex-wrap rounded-xl p-3"
        style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}>
        <p className="text-[12.5px] min-w-0 flex-1 truncate" style={{ color: 'var(--brand-text-secondary)' }}>
          {allChecked
            ? t('checkin.b1.allSet')
            : t('checkin.b1.progress').replace('{n}', String(checkedCount))}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            data-testid="checkin-b1-toggle-all"
            onClick={toggleAll}
            aria-pressed={allChecked}
            className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2.5 py-1 rounded-full transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary-purple)]"
            style={{
              backgroundColor: 'white',
              color: 'var(--brand-primary-purple)',
              border: '1.5px solid var(--brand-border)',
            }}
          >
            {allChecked ? <Square className="w-3.5 h-3.5" /> : <CheckCheck className="w-3.5 h-3.5" />}
            {allChecked ? t('checkin.b1.unselectAll') : t('checkin.b1.selectAll')}
          </button>
          <span
            className="text-[11px] font-bold px-2 py-0.5 rounded-full"
            style={{
              backgroundColor: allChecked ? 'var(--brand-success-green)' : 'white',
              color: allChecked ? 'white' : 'var(--brand-primary-purple)',
            }}
          >
            {checkedCount}/{items.length}
          </span>
        </div>
      </div>

      <div className="space-y-2.5">
        {items.map((it) => (
          <ChecklistRow
            key={it.key}
            icon={it.icon}
            text={it.text}
            audioText={it.text}
            checked={Boolean(form[it.key])}
            onToggle={() => setField(it.key, !form[it.key] as FormData[typeof it.key])}
            testId={`checkin-checklist-${it.key}`}
          />
        ))}
      </div>

      <p className="text-[12px] text-center" style={{ color: 'var(--brand-text-muted)' }}>
        {t('checkin.b1.footer')}
      </p>
    </div>
  );
}

function B2Reading({ form, setField }: StepProps) {
  const { t } = useLanguage();
  // BP photo OCR error is lifted out of the icon button so it can render
  // full-width below the button (above the reading inputs) instead of being
  // squeezed in beside the camera icon inside the label row.
  const [bpPhotoError, setBpPhotoError] = useState<string | null>(null);

  return (
    <div data-testid="checkin-step-2" className="space-y-6">
      <StepHeader
        title={t('checkin.b2.title')}
        subtitle={t('checkin.b2.subtitle')}
        audio={t('checkin.b2.audio')}
        step={2}
        total={5}
      />

      {/* Date + Time — split into two pickers (cleaner than datetime-local on
          small screens where the native picker eats horizontal space). */}
      <div>
        <label className="flex items-center gap-2 text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
          <CalendarClock className="w-4 h-4" />
          {t('checkin.b2.whenLabel')}
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <input
            type="date"
            aria-label={t('checkin.b2.dateAria')}
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
            aria-label={t('checkin.b2.timeAria')}
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
          <span>{t('checkin.b2.positionLabel')}</span>
          <AudioButton text={t('checkin.b2.positionAudio')} size="sm" />
        </label>
        <div className="grid grid-cols-3 gap-3">
          <ChoiceCard
            icon={<Armchair className="w-7 h-7" />}
            title={t('checkin.b2.positionSitting')}
            selected={form.position === 'SITTING'}
            onClick={() => setField('position', 'SITTING')}
            audioText={t('checkin.b2.positionSitting')}
            testId="check-in-position-sitting"
            compact
          />
          <ChoiceCard
            icon={<PersonStanding className="w-7 h-7" />}
            title={t('checkin.b2.positionStanding')}
            selected={form.position === 'STANDING'}
            onClick={() => setField('position', 'STANDING')}
            audioText={t('checkin.b2.positionStanding')}
            testId="check-in-position-standing"
            compact
          />
          <ChoiceCard
            icon={<Bed className="w-7 h-7" />}
            title={t('checkin.b2.positionLying')}
            selected={form.position === 'LYING'}
            onClick={() => setField('position', 'LYING')}
            audioText={t('checkin.b2.positionLying')}
            testId="check-in-position-lying"
            compact
          />
        </div>
      </div>

      {/* BP */}
      <div>
        <label htmlFor="checkin-systolic" className="flex items-center justify-between gap-2 text-[13px] font-semibold mb-3" style={{ color: 'var(--brand-text-primary)' }}>
          <span className="min-w-0">{t('checkin.b2.bpLabel')}</span>
          <span className="flex items-center gap-2 shrink-0">
            {/* Phase/27 BP photo OCR — patient snaps cuff display, confirms numbers
                in modal, then values flow into systolicBP/diastolicBP/pulse like a
                manual entry. Hidden when NEXT_PUBLIC_BP_OCR_ENABLED !== 'true'. */}
            <BpPhotoButton
              onError={setBpPhotoError}
              onConfirm={(r) => {
                setField('systolicBP', String(r.sbp));
                setField('diastolicBP', String(r.dbp));
                if (r.pulse != null) setField('pulse', String(r.pulse));
              }}
            />
            <AudioButton text={t('checkin.b2.bpAudio')} size="sm" />
          </span>
        </label>
        {bpPhotoError && (
          <p
            role="alert"
            className="-mt-1 mb-3 text-[12px] leading-snug font-medium"
            style={{ color: 'var(--brand-alert-red)' }}
          >
            {bpPhotoError}
          </p>
        )}
        <div className="flex items-end gap-2 sm:gap-3">
          <div data-testid="check-in-systolic" className="flex-1 min-w-0">
            <input
              data-testid="checkin-systolic"
              id="checkin-systolic"
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
                border: '2px solid var(--brand-border)',
                fontSize: 32,
                color: form.systolicBP ? 'var(--brand-text-primary)' : 'var(--brand-text-muted)',
                backgroundColor: 'white',
              }}
            />
            <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
              <p className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>{t('checkin.b2.bpTopLabel')}</p>
              <MicButton
                inputId="checkin-systolic"
                numeric
                onTranscript={(text) => setField('systolicBP', text)}
              />
            </div>
          </div>
          <div className="pb-7 text-[28px] sm:text-[32px] font-light shrink-0" style={{ color: 'var(--brand-text-muted)' }}>/</div>
          <div data-testid="check-in-diastolic" className="flex-1 min-w-0">
            <input
              data-testid="checkin-diastolic"
              id="checkin-diastolic"
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
            <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
              <p className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>{t('checkin.b2.bpBottomLabel')}</p>
              <MicButton
                inputId="checkin-diastolic"
                numeric
                onTranscript={(text) => setField('diastolicBP', text)}
              />
            </div>
          </div>
        </div>

      </div>

      {/* Pulse */}
      <div>
        <label htmlFor="checkin-pulse" className="flex items-center justify-between text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
          <span className="flex items-center gap-2"><Heart className="w-4 h-4" /> {t('checkin.b2.pulseLabel')}</span>
          <AudioButton text={t('checkin.b2.pulseAudio')} size="sm" />
        </label>
        <div data-testid="check-in-heart-rate" className="flex items-center gap-2">
          <input
            data-testid="checkin-pulse"
            id="checkin-pulse"
            type="number"
            inputMode="numeric"
            min={30}
            max={220}
            value={form.pulse}
            onChange={(e) => setField('pulse', e.target.value)}
            placeholder="72"
            className="flex-1 min-w-0 h-12 px-4 rounded-xl text-center outline-none transition box-border"
            style={{
              border: '2px solid var(--brand-border)',
              color: form.pulse ? 'var(--brand-text-primary)' : 'var(--brand-text-muted)',
              backgroundColor: 'white',
              fontSize: 18,
            }}
          />
          <MicButton
            inputId="checkin-pulse"
            numeric
            onTranscript={(text) => setField('pulse', text)}
          />
        </div>
      </div>
    </div>
  );
}

function StepWeight({ form, setField }: StepProps) {
  const { t } = useLanguage();

  // Anchor for unit conversion: the value + unit the patient last *typed*.
  // Toggles always convert from this single anchor (one hop) and restore it
  // verbatim when switching back to the unit it was entered in, so repeated
  // lbs↔kg taps never drift (10 lb → 4.5 kg → 10 lb, not 9.9). Re-converting
  // the already-rounded display each time is what caused the drift.
  const anchorRef = useRef<{ value: string; unit: 'lbs' | 'kg' }>({
    value: form.weight,
    unit: form.weightUnit,
  });

  // Any direct edit (typing or voice) re-anchors to that exact value + unit.
  const setWeight = (raw: string) => {
    anchorRef.current = { value: raw, unit: form.weightUnit };
    setField('weight', raw);
  };

  // Switching units converts the anchor so the patient doesn't have to re-key
  // it. setField runs twice but React batches both updates into one re-render.
  // An empty / non-numeric field just flips the unit. The anchor is left
  // untouched here so a later toggle-back can restore the original entry.
  const changeUnit = (unit: 'lbs' | 'kg') => {
    if (unit === form.weightUnit) return;
    const anchor = anchorRef.current;
    if (anchor.value.trim() !== '' && !Number.isNaN(parseFloat(anchor.value))) {
      if (anchor.unit === unit) {
        setField('weight', anchor.value); // exact restore — no drift
      } else {
        const n = parseFloat(anchor.value);
        const converted = unit === 'kg' ? n * KG_PER_LB : n / KG_PER_LB;
        setField('weight', String(Math.round(converted * 10) / 10));
      }
    }
    setField('weightUnit', unit);
  };

  const bounds = weightBounds(form.weightUnit);

  return (
    <div data-testid="checkin-step-3" className="space-y-6">
      <StepHeader
        title={t('checkin.weight.title')}
        subtitle={t('checkin.weight.subtitle')}
        audio={t('checkin.weight.audio')}
        step={3}
        total={5}
      />

      <div>
        <label className="block text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>{t('checkin.weight.unitLabel')}</label>
        <div
          className="inline-flex rounded-full p-1 gap-1"
          style={{ backgroundColor: 'var(--brand-background)', border: '1px solid var(--brand-border)' }}
        >
          {(['lbs', 'kg'] as const).map((unit) => (
            <button
              key={unit}
              type="button"
              onClick={() => changeUnit(unit)}
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
        <label htmlFor="checkin-weight" className="block text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
          {t('checkin.weight.weightLabel').replace('{unit}', form.weightUnit)}
        </label>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <input
              id="checkin-weight"
              type="number"
              inputMode="decimal"
              min={bounds.min}
              max={bounds.max}
              value={form.weight}
              onChange={(e) => setWeight(e.target.value)}
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
          <MicButton
            inputId="checkin-weight"
            numeric
            onTranscript={(text) => setWeight(text)}
          />
        </div>
      </div>

      <div className="rounded-xl p-3.5 flex gap-3" style={{ backgroundColor: 'var(--brand-accent-teal-light)' }}>
        <Scale className="w-5 h-5 mt-0.5 shrink-0" style={{ color: 'var(--brand-accent-teal)' }} />
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
          {t('checkin.weight.fluidHint')}
        </p>
      </div>
    </div>
  );
}

interface MedicationStepProps extends StepProps {
  medications: Array<{ id: string; drugName: string; drugClass: string }>;
  medsLoading: boolean;
}

type MedicationEntry = FormData['medicationStatus'][string];

const DEFAULT_MED_ENTRY: MedicationEntry = {
  taken: null,
  reason: null,
  missedDoses: 1,
};

// Maps the DrugClass prisma enum to a translation key. Patient-facing labels
// (e.g. "beta blocker") for clinical descriptors; abbreviations (ARB, MRA,
// SGLT2, ARNI) stay as-is across locales because that's how they appear on
// patient handouts internationally.
const DRUG_CLASS_LABEL_KEYS: Record<string, TranslationKey> = {
  ACE_INHIBITOR: 'checkin.b4.classAceInhibitor',
  ARB: 'checkin.b4.classArb',
  BETA_BLOCKER: 'checkin.b4.classBetaBlocker',
  DHP_CCB: 'checkin.b4.classDhpCcb',
  NDHP_CCB: 'checkin.b4.classNdhpCcb',
  LOOP_DIURETIC: 'checkin.b4.classLoopDiuretic',
  THIAZIDE: 'checkin.b4.classThiazide',
  MRA: 'checkin.b4.classMra',
  SGLT2: 'checkin.b4.classSglt2',
  ANTICOAGULANT: 'checkin.b4.classAnticoagulant',
  STATIN: 'checkin.b4.classStatin',
  ANTIARRHYTHMIC: 'checkin.b4.classAntiarrhythmic',
  VASODILATOR_NITRATE: 'checkin.b4.classVasodilatorNitrate',
  ARNI: 'checkin.b4.classArni',
  OTHER_UNVERIFIED: 'checkin.b4.classOtherUnverified',
};

function StepMedication({ form, setField, medications, medsLoading }: MedicationStepProps) {
  const { t } = useLanguage();
  // Resolve a drug-class label, falling back to the prisma value humanised
  // (e.g. UNKNOWN_NEW_CLASS → "unknown new class") so a freshly-added enum
  // value still renders something legible until translations catch up.
  const drugClassLabel = (cls: string): string => {
    const key = DRUG_CLASS_LABEL_KEYS[cls];
    return key ? t(key) : cls.replace(/_/g, ' ').toLowerCase();
  };

  const getEntry = (medId: string): MedicationEntry =>
    form.medicationStatus[medId] ?? DEFAULT_MED_ENTRY;

  const patchEntry = (medId: string, patch: Partial<MedicationEntry>) => {
    const current = getEntry(medId);
    setField('medicationStatus', {
      ...form.medicationStatus,
      [medId]: { ...current, ...patch },
    });
  };

  const setTaken = (medId: string, value: 'yes' | 'no' | 'scheduledLater') => {
    const current = getEntry(medId);
    // Flipping back to "yes" / "scheduledLater" clears any captured miss
    // detail so a stale reason doesn't leak into the submit payload.
    const next: MedicationEntry =
      value === 'no'
        ? { ...current, taken: 'no' }
        : { taken: value, reason: null, missedDoses: 1 };
    setField('medicationStatus', {
      ...form.medicationStatus,
      [medId]: next,
    });
  };

  return (
    <div data-testid="checkin-step-4" className="space-y-6">
      <StepHeader
        title={t('checkin.b4.title')}
        subtitle={t('checkin.b4.subtitle')}
        audio={t('checkin.b4.audio')}
        step={4}
        total={5}
      />

      {medsLoading && (
        <div className="space-y-3 animate-pulse">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="rounded-xl p-4"
              style={{ backgroundColor: 'white', border: '1.5px solid var(--brand-border)' }}
            >
              <div className="h-3 rounded-full mb-2" style={{ backgroundColor: '#EDE9F6', width: '40%' }} />
              <div className="h-2 rounded-full" style={{ backgroundColor: '#EDE9F6', width: '25%' }} />
            </div>
          ))}
        </div>
      )}

      {!medsLoading && medications.length === 0 && (
        // Defensive fallback — parent flow should have skipped this step when
        // the patient has no meds on file. Kept so a stale render doesn't
        // crash the wizard.
        <div
          className="rounded-xl p-3 text-[13px] leading-relaxed"
          style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-text-primary)' }}
        >
          {t('checkin.b4.noMeds')}
        </div>
      )}

      {!medsLoading &&
        medications.map((med) => {
          const entry = getEntry(med.id);
          const missed = entry.taken === 'no';
          const took = entry.taken === 'yes';
          return (
            <div
              key={med.id}
              className="rounded-xl border-2 transition-all"
              style={{
                borderColor: missed
                  ? 'var(--brand-warning-amber)'
                  : took
                    ? 'var(--brand-success-green)'
                    : 'var(--brand-border)',
                backgroundColor: missed
                  ? 'var(--brand-warning-amber-light)'
                  : took
                    ? 'var(--brand-success-green-light)'
                    : 'white',
              }}
            >
              <div className="px-4 py-3">
                <div className="flex items-center gap-3 mb-3">
                  <Pill className="w-4 h-4 shrink-0" style={{ color: 'var(--brand-primary-purple)' }} />
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-[14px] font-semibold truncate"
                      style={{ color: 'var(--brand-text-primary)' }}
                    >
                      {med.drugName}
                    </p>
                    <p
                      className="text-[11px]"
                      style={{ color: 'var(--brand-text-muted)' }}
                    >
                      {drugClassLabel(med.drugClass)}
                    </p>
                  </div>
                  {/* Phase/26 TTS pass 2 — per-medication audio so a non-reader
                      hears "Lisinopril, ace inhibitor" before choosing yes / no
                      / not due yet. */}
                  <AudioButton
                    size="sm"
                    text={`${med.drugName}, ${drugClassLabel(med.drugClass)}`}
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {[
                    {
                      value: 'yes' as const,
                      label: t('common.yes'),
                      accent: 'var(--brand-success-green)',
                    },
                    {
                      value: 'no' as const,
                      label: t('common.no'),
                      accent: 'var(--brand-warning-amber)',
                    },
                    {
                      value: 'scheduledLater' as const,
                      label: t('readings.notDueYet'),
                      accent: 'var(--brand-primary-purple)',
                    },
                  ].map((opt) => {
                    const active = entry.taken === opt.value;
                    return (
                      <motion.button
                        key={opt.value}
                        type="button"
                        data-testid={
                          opt.value === 'yes'
                            ? 'check-in-medication-yes'
                            : opt.value === 'no'
                              ? 'check-in-medication-no'
                              : undefined
                        }
                        onClick={() => setTaken(med.id, opt.value)}
                        className="h-11 rounded-xl text-[12px] font-semibold border-2 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        style={{
                          backgroundColor: active ? opt.accent : 'white',
                          borderColor: active ? opt.accent : 'var(--brand-border)',
                          color: active ? 'white' : 'var(--brand-text-secondary)',
                          boxShadow: active ? `0 4px 12px ${opt.accent}40` : 'none',
                        }}
                        whileTap={{ scale: 0.97 }}
                      >
                        {active && <CheckCircle className="w-3.5 h-3.5" />}
                        {opt.label}
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {missed && (
                <div className="px-4 pb-3 space-y-3 border-t" style={{ borderColor: 'var(--brand-border)' }}>
                  <div className="pt-3">
                    <label
                      htmlFor={`reason-${med.id}`}
                      className="text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color: 'var(--brand-text-muted)' }}
                    >
                      {t('readings.whyMissed')}
                    </label>
                    <select
                      id={`reason-${med.id}`}
                      value={entry.reason ?? ''}
                      onChange={(e) =>
                        patchEntry(med.id, {
                          reason: (e.target.value || null) as MedicationEntry['reason'],
                        })
                      }
                      className="mt-1 w-full px-3 py-2 rounded-lg border text-[14px] bg-white"
                      style={{
                        borderColor: 'var(--brand-border)',
                        color: 'var(--brand-text-primary)',
                      }}
                    >
                      <option value="">{t('readings.selectReason')}</option>
                      <option value="FORGOT">{t('readings.reasonForgot')}</option>
                      <option value="SIDE_EFFECTS">{t('readings.reasonSideEffects')}</option>
                      <option value="RAN_OUT">{t('readings.reasonRanOut')}</option>
                      <option value="COST">{t('readings.reasonCost')}</option>
                      <option value="INTENTIONAL">{t('readings.reasonIntentional')}</option>
                      <option value="OTHER">{t('readings.reasonOther')}</option>
                    </select>
                  </div>

                  <fieldset className="border-0 p-0 m-0">
                    <legend
                      className="text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color: 'var(--brand-text-muted)' }}
                    >
                      {t('readings.howManyDoses')}
                    </legend>
                    <div className="mt-1 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          patchEntry(med.id, {
                            missedDoses: Math.max(1, entry.missedDoses - 1),
                          })
                        }
                        aria-label={t('readings.decreaseDoses')}
                        className="w-8 h-8 rounded-lg border flex items-center justify-center cursor-pointer"
                        style={{
                          borderColor: 'var(--brand-border)',
                          color: 'var(--brand-text-secondary)',
                        }}
                      >
                        −
                      </button>
                      <span
                        className="text-[16px] font-bold w-6 text-center"
                        style={{ color: 'var(--brand-text-primary)' }}
                      >
                        {entry.missedDoses}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          patchEntry(med.id, {
                            missedDoses: Math.min(10, entry.missedDoses + 1),
                          })
                        }
                        aria-label={t('readings.increaseDoses')}
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
  );
}

// Cluster 8 Q2 (Manisha 5/18/26, P0) — bespoke angioedema symptom icons.
// The sign-off specifies a "face silhouette with swelling indicators at
// lips/cheeks" + a "neck/throat silhouette with constriction indicator";
// no lucide glyph conveys either, so two small inline SVGs (currentColor,
// stroke-based so they inherit the checklist-row color like lucide).
function FaceSwellingIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* face outline */}
      <path d="M12 3a7 7 0 0 1 7 7c0 4-2.5 7.5-7 11-4.5-3.5-7-7-7-11a7 7 0 0 1 7-7Z" />
      {/* swollen cheeks */}
      <path d="M6.5 11.5c1 1.4 1 2.6 0 4M17.5 11.5c-1 1.4-1 2.6 0 4" />
      {/* swollen lips */}
      <path d="M9.5 14.5c1.6 1.2 3.4 1.2 5 0" />
      <circle cx="9.3" cy="9.5" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="14.7" cy="9.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ThroatTightnessIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* head + neck */}
      <circle cx="12" cy="5.5" r="3" />
      <path d="M9 9c0 2 0 3 0 4M15 9c0 2 0 3 0 4" />
      {/* throat constriction (inward pinch) */}
      <path d="M9 14.5c1.2-1.4 4.8-1.4 6 0" />
      <path d="M9 18c1.2 1.4 4.8 1.4 6 0" />
      <path d="M7.5 16.25h2M14.5 16.25h2" />
    </svg>
  );
}

interface SymptomsStepProps extends StepProps {
  isPregnant: boolean;
}

function B3Symptoms({ form, setField, isPregnant }: SymptomsStepProps) {
  const { t } = useLanguage();
  const core: { key: keyof FormData; icon: React.ReactNode; text: string; testId?: string }[] = [
    { key: 'severeHeadache', icon: <Brain className="w-5 h-5" />, text: t('checkin.b3.symptomSevereHeadache') },
    { key: 'visualChanges', icon: <Eye className="w-5 h-5" />, text: t('checkin.b3.symptomVision') },
    { key: 'alteredMentalStatus', icon: <Brain className="w-5 h-5" />, text: t('checkin.b3.symptomConfusion') },
    { key: 'chestPainOrDyspnea', icon: <Wind className="w-5 h-5" />, text: t('checkin.b3.symptomChestPain'), testId: 'check-in-symptom-CHEST_PAIN' },
    { key: 'focalNeuroDeficit', icon: <Zap className="w-5 h-5" />, text: t('checkin.b3.symptomNeuro') },
    { key: 'severeEpigastricPain', icon: <Stethoscope className="w-5 h-5" />, text: t('checkin.b3.symptomStomach') },
    // Cluster 6 (Manisha 5/10/26) — feed brady-symptomatic, palpitations,
    // orthostatic, and HF-decomp engine rules.
    { key: 'dizziness', icon: <Activity className="w-5 h-5" />, text: t('checkin.b3.symptomDizziness'), testId: 'check-in-symptom-DIZZINESS' },
    { key: 'syncope', icon: <Activity className="w-5 h-5" />, text: t('checkin.b3.symptomSyncope'), testId: 'check-in-symptom-SYNCOPE' },
    { key: 'palpitations', icon: <Heart className="w-5 h-5" />, text: t('checkin.b3.symptomPalpitations'), testId: 'check-in-symptom-PALPITATIONS' },
    { key: 'legSwelling', icon: <Droplets className="w-5 h-5" />, text: t('checkin.b3.symptomLegSwelling'), testId: 'check-in-symptom-LEG_SWELLING' },
    // Cluster 7 (Manisha 5/11/26) — Appendix A side-effect inputs feeding
    // β-blocker fatigue/SOB (HF + non-HF) and ACE dry-cough rules.
    { key: 'fatigue', icon: <Bed className="w-5 h-5" />, text: t('checkin.b3.symptomFatigue'), testId: 'check-in-symptom-FATIGUE' },
    { key: 'shortnessOfBreath', icon: <Wind className="w-5 h-5" />, text: t('checkin.b3.symptomShortnessOfBreath'), testId: 'check-in-symptom-SHORTNESS_OF_BREATH' },
    { key: 'dryCough', icon: <Stethoscope className="w-5 h-5" />, text: t('checkin.b3.symptomDryCough'), testId: 'check-in-symptom-DRY_COUGH' },
    // Cluster 8 (Manisha 5/18/26, P0) — Button 12 + 13. ACE-angioedema
    // airway emergency. Either fires RULE_(ACE|GENERIC)_ANGIOEDEMA Tier 1
    // for ALL patients regardless of medication profile.
    { key: 'faceSwelling', icon: <FaceSwellingIcon className="w-5 h-5" />, text: t('checkin.b3.symptomFaceSwelling'), testId: 'check-in-symptom-FACE_SWELLING' },
    { key: 'throatTightness', icon: <ThroatTightnessIcon className="w-5 h-5" />, text: t('checkin.b3.symptomThroatTightness'), testId: 'check-in-symptom-THROAT_TIGHTNESS' },
  ];
  const pregnancy: { key: keyof FormData; icon: React.ReactNode; text: string }[] = [
    { key: 'newOnsetHeadache', icon: <Brain className="w-5 h-5" />, text: t('checkin.b3.symptomNewHeadache') },
    { key: 'ruqPain', icon: <Stethoscope className="w-5 h-5" />, text: t('checkin.b3.symptomRuq') },
    { key: 'edema', icon: <Droplets className="w-5 h-5" />, text: t('checkin.b3.symptomEdema') },
  ];

  return (
    <div data-testid="checkin-step-5" className="space-y-5">
      <StepHeader
        title={t('checkin.b3.title')}
        subtitle={t('checkin.b3.subtitle')}
        audio={t('checkin.b3.audio')}
        step={5}
        total={5}
      />

      <div className="rounded-xl p-3 flex items-start gap-3"
        style={{ backgroundColor: 'var(--brand-alert-red-light)' }}>
        <Heart className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--brand-alert-red-text)' }} />
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--brand-text-primary)' }}>
          {t('checkin.b3.alertBanner')}
        </p>
      </div>

      <div className="space-y-2.5">
        {core.map((s) => (
          <ChecklistRow
            key={s.key}
            icon={s.icon}
            text={s.text}
            audioText={s.text}
            checked={Boolean(form[s.key])}
            onToggle={() => setField(s.key, !form[s.key] as FormData[typeof s.key])}
            testId={s.testId}
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
                {t('checkin.b3.pregnancyHeader')}
              </p>
            </div>
            {pregnancy.map((s) => (
              <ChecklistRow
                key={s.key}
                icon={s.icon}
                text={s.text}
                audioText={s.text}
                checked={Boolean(form[s.key])}
                onToggle={() => setField(s.key, !form[s.key] as FormData[typeof s.key])}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom symptoms — patient types anything not covered by the buttons
          above; Enter / Add makes a chip they can edit or remove. Stored in
          JournalEntry.otherSymptoms. */}
      <SymptomTagInput
        value={form.otherSymptomsList}
        onChange={(next) => setField('otherSymptomsList', next)}
        inputId="checkin-other-symptoms-input"
        label={t('checkin.b3.otherSymptomsLabel')}
        placeholder={t('checkin.b3.otherPlaceholder')}
        addLabel={t('checkin.b3.addSymptom')}
        removeLabel={t('checkin.b3.removeSymptom')}
        editLabel={t('common.edit')}
        testIdPrefix="checkin-other-symptoms"
      />

      {/* Notes — free-text note → JournalEntry.notes. Optional, bounded, with
          voice dictation + a live character counter. */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <label htmlFor="checkin-other-symptoms" className="block text-[13px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
            {t('checkin.b3.notesLabel')}
          </label>
          <MicButton
            inputId="checkin-other-symptoms"
            onTranscript={(text) =>
              setField(
                'notes',
                (form.notes ? `${form.notes} ${text}`.trim() : text).slice(0, NOTE_MAX),
              )
            }
          />
        </div>
        <textarea
          id="checkin-other-symptoms"
          data-testid="checkin-other-symptoms"
          rows={3}
          maxLength={NOTE_MAX}
          value={form.notes}
          onChange={(e) => setField('notes', e.target.value.slice(0, NOTE_MAX))}
          placeholder={t('readings.notesPlaceholder')}
          aria-describedby="checkin-notes-count"
          className="w-full rounded-xl px-4 py-3 text-[13px] resize-none outline-none transition"
          style={{
            border: '2px solid var(--brand-border)',
            color: 'var(--brand-text-primary)',
            backgroundColor: 'white',
          }}
        />
        <p
          id="checkin-notes-count"
          className="mt-1 text-[11px] text-right tabular-nums"
          style={{
            color:
              form.notes.length >= NOTE_MAX
                ? 'var(--brand-alert-red-text)'
                : 'var(--brand-text-muted)',
          }}
        >
          {form.notes.length}/{NOTE_MAX}
        </p>
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
  heightCm,
  missedMedNames,
  onAddAnother,
  onDone,
  pendingFinalizeEntryId,
  onFinalized,
}: {
  lastReading: SessionReading;
  sessionReadings: SessionReading[];
  hasAFib: boolean;
  /** From PatientProfile.heightCm — fixed at intake. Used to compute BMI
   *  when the patient logged a weight. */
  heightCm: number | null;
  missedMedNames: string[];
  onAddAnother: () => void;
  onDone: () => void;
  /** Cluster 6 Q2 — set when the just-saved entry is single-reading
   *  non-emergency. Triggers the "Take a second reading" prompt and arms
   *  a 5-min timer that POSTs the finalize endpoint. Null when the entry
   *  doesn't need the prompt. */
  pendingFinalizeEntryId: string | null;
  /** Called when the timer fires + the finalize POST succeeds, OR when
   *  the patient navigates away. Clears the timer in the parent. */
  onFinalized: () => void;
}) {
  const { t } = useLanguage();
  const total = sessionReadings.length;
  const aFibSatisfied = !hasAFib || total >= 3;

  // Cluster 6 Q2 (Manisha 5/9/26) — 5-min finalize timer. Arms when the
  // backend hint says this is a first-in-session non-AFib non-preDay3
  // reading. If the patient logs a second reading (onAddAnother), the
  // parent clears `pendingFinalizeEntryId` and our effect dependency
  // change tears down the timer. If the 5 min elapses, we POST the
  // finalize endpoint so the engine fires the held alert with a
  // "single-reading session" annotation.
  useEffect(() => {
    if (!pendingFinalizeEntryId) return;
    const entryId = pendingFinalizeEntryId;
    const FIVE_MIN_MS = 5 * 60 * 1000;
    const handle = setTimeout(() => {
      finalizeSingleReadingSession(entryId)
        .catch(() => {
          // Network/server failure here is non-fatal — the engine will
          // simply hold the alert until a second reading lands. The
          // patient sees no error; ops sees a logged failure.
        })
        .finally(() => {
          onFinalized();
        });
    }, FIVE_MIN_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [pendingFinalizeEntryId, onFinalized]);
  // BMI is read-only and only shown when both weight (this reading) and
  // height (intake) are on file. Pulse pressure is intentionally NOT
  // shown on the patient app per Niva — clinically too easy to misread.
  const bmi = getBMI(heightCm, lastReading.weightKg);

  // Phase/26 TTS pass 2 — humanised overview reading the whole confirmation
  // screen, not just the BP. Built from the existing variables; conditional
  // pieces drop out cleanly when not applicable.
  const overviewAudio = (() => {
    const parts: string[] = [];
    parts.push(
      total > 1
        ? `All set. You logged ${total} readings this session.`
        : 'All set. Your reading was saved.',
    );
    if (lastReading.systolicBP != null && lastReading.diastolicBP != null) {
      const bpSentence =
        `Your blood pressure was ${lastReading.systolicBP} over ${lastReading.diastolicBP} mmHg` +
        (lastReading.pulse != null ? `, with a pulse of ${lastReading.pulse} beats per minute.` : '.');
      parts.push(bpSentence);
    }
    if (lastReading.weightKg != null) {
      const lbs = Math.round(lastReading.weightKg * 2.20462 * 10) / 10;
      parts.push(
        bmi != null
          ? `You weighed ${lbs} pounds today, with a BMI of ${bmi.toFixed(1)}.`
          : `You weighed ${lbs} pounds today.`,
      );
    }
    if (missedMedNames.length > 0) {
      parts.push(
        `We noted you missed ${missedMedNames.join(' and ')} today — your care team will see this.`,
      );
    }
    if (hasAFib) {
      parts.push(
        aFibSatisfied
          ? `That's enough readings for your atrial fibrillation monitoring.`
          : `For atrial fibrillation monitoring, please log at least three readings in this session — you have ${total} so far.`,
      );
    }
    parts.push('Tap Add another to log more, or Back to dashboard when you are done.');
    return parts.join(' ');
  })();

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

      <div className="flex items-center gap-2">
        <h2 className="text-[20px] font-bold leading-tight" style={{ color: 'var(--brand-text-primary)' }}>
          {total > 1 ? t('checkin.confirm.titleMulti').replace('{n}', String(total)) : t('checkin.confirm.title')}
        </h2>
        <AudioButton text={overviewAudio} size="sm" />
      </div>
      <p className="text-[13px] mt-0.5 mb-4" style={{ color: 'var(--brand-text-muted)' }}>
        {t('checkin.confirm.subtitle')}
      </p>

      {/* Reading summary card */}
      <div
        className="w-full rounded-2xl p-3 mb-3"
        style={{ backgroundColor: 'white', border: '1.5px solid var(--brand-border)', boxShadow: 'var(--brand-shadow-card)' }}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
            {t('checkin.confirm.thisReading')}
          </span>
        </div>
        <div className="flex items-baseline gap-2 justify-center">
          <span className="text-[30px] font-bold leading-none" style={{ color: 'var(--brand-primary-purple)' }}>
            {lastReading.systolicBP ?? '--'}/{lastReading.diastolicBP ?? '--'}
          </span>
          <span className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>{t('checkin.confirm.unit')}</span>
          {lastReading.pulse != null && (
            <span className="text-[12px] font-semibold ml-2 flex items-center gap-1" style={{ color: 'var(--brand-text-secondary)' }}>
              <Heart className="w-3.5 h-3.5" /> {lastReading.pulse}
            </span>
          )}
        </div>
        {/* BMI — read-only, computed from this reading's weight + the
            patient's intake-time height. Only rendered when both are
            available; never asks the patient to enter BMI directly. */}
        {bmi != null && (
          <div
            className="mt-2 pt-2 flex items-center justify-center gap-2"
            style={{ borderTop: '1px solid var(--brand-border)' }}
          >
            <Scale className="w-3.5 h-3.5" style={{ color: 'var(--brand-text-muted)' }} />
            <span className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
              Weight {Math.round((lastReading.weightKg ?? 0) * 10) / 10} kg
            </span>
            <span className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>·</span>
            <span className="text-[11px] font-semibold" style={{ color: 'var(--brand-text-secondary)' }}>
              BMI {bmi.toFixed(1)}
            </span>
          </div>
        )}
      </div>

      {/* Missed-medication acknowledgement — visible confirmation so the
          patient knows their answer was captured and will reach the care team. */}
      {missedMedNames.length > 0 && (
        <div
          className="w-full rounded-xl px-3 py-2 mb-3 flex items-start gap-2.5 text-left"
          style={{ backgroundColor: 'var(--brand-warning-amber-light)' }}
        >
          <Pill className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--brand-warning-amber-text)' }} />
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
            style={{ color: aFibSatisfied ? 'var(--brand-success-green)' : 'var(--brand-warning-amber-text)' }}
          />
          <p
            className="text-[12px] leading-snug"
            style={{ color: aFibSatisfied ? 'var(--brand-success-green)' : 'var(--brand-text-primary)' }}
          >
            {aFibSatisfied
              ? t('checkin.confirm.afibSatisfied').replace('{n}', String(total))
              : t('checkin.confirm.afibNeeded').replace('{n}', String(total))}
          </p>
        </div>
      ) : (
        <p className="text-[12px] mb-3 leading-snug" style={{ color: 'var(--brand-text-muted)' }}>
          {t('checkin.confirm.nonAfib')}
        </p>
      )}

      {/* Cluster 6 Q2 (Manisha 5/9/26) — when this is the only reading
         in the session and the patient isn't AFib<3 / preDay3, prompt
         them to take a second one. Helps the engine fire on an averaged
         BP instead of a one-off. 5-min timer (above) finalizes the
         session as single-reading if they don't. */}
      {pendingFinalizeEntryId && (
        <div
          data-testid="pending-second-reading"
          className="w-full mb-3 rounded-2xl border-2 px-4 py-3 text-[13px] leading-snug"
          style={{
            backgroundColor: 'var(--brand-info-bg, #EEF2FF)',
            borderColor: 'var(--brand-primary-purple)',
            color: 'var(--brand-text-primary)',
          }}
        >
          <div className="font-semibold mb-1">
            {t('checkin.confirm.takeSecondReading')}
          </div>
          <div style={{ color: 'var(--brand-text-muted)' }}>
            {t('checkin.confirm.takeSecondReadingHint')}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="w-full space-y-2">
        <motion.button
          type="button"
          data-testid="add-second-reading"
          onClick={onAddAnother}
          className="w-full h-11 rounded-full font-bold text-white text-[13.5px] flex items-center justify-center gap-2 cursor-pointer"
          style={{
            backgroundColor: hasAFib && !aFibSatisfied ? 'var(--brand-warning-amber)' : 'var(--brand-primary-purple)',
            boxShadow: 'var(--brand-shadow-button)',
          }}
          whileTap={{ scale: 0.97 }}
        >
          <Plus className="w-4 h-4" />
          {t('checkin.confirm.addAnother')}
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
          {t('checkin.confirm.backToDashboard')}
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
  const { user, isLoading, isAuthenticated } = useAuth();
  const { t } = useLanguage();

  const [profile, setProfile] = useState<PatientProfileDto | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  // Intake-still-in-progress sentinel — mirrors Dashboard.tsx logic. The
  // localStorage draft persists across partial saves (handleExitSave does
  // not clear it) and is only wiped by handleSubmit on the final A10→A11
  // submit. So a draft with currentStep ≠ 'A11' means the patient hasn't
  // finished clinical intake, regardless of whether a partial profile is
  // already on the server. Block check-ins in that case so the rule
  // engine doesn't evaluate readings against an incomplete profile.
  const [intakeIncomplete, setIntakeIncomplete] = useState(false);
  useEffect(() => {
    if (!user?.id) return;
    if (!hasDraft(user.id)) { setIntakeIncomplete(false); return; }
    const draft = loadDraft(user.id);
    setIntakeIncomplete(!!draft?.currentStep && draft.currentStep !== 'A11');
  }, [user?.id]);
  const [medications, setMedications] = useState<PatientMedication[]>([]);
  const [medsLoading, setMedsLoading] = useState(true);

  const [form, setForm] = useState<FormData>(emptyForm);
  const [step, setStep] = useState<StepKey>('B1');
  const [direction, setDirection] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // A saved, unfinished check-in found in localStorage on mount. While set, the
  // resume prompt is shown (Resume vs Start new) before the wizard renders.
  const [resumeDraft, setResumeDraft] = useState<CheckInDraft<FormData> | null>(null);
  // Save-and-exit confirmation (header Save button) — mirrors the intake form.
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);

  // Session state — sessionId is generated once via lazy init so we don't
  // need a setState-in-effect to bootstrap it (Next 16 lint).
  const [sessionId] = useState<string>(() => uuid());
  const [sessionReadings, setSessionReadings] = useState<SessionReading[]>([]);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [readingNumber, setReadingNumber] = useState(0); // count of submitted readings in session
  // Cluster 6 Q2 — set to the entry id of a first-in-session non-AFib
  // non-preDay3 reading. Drives the "Take a second reading" prompt + 5-min
  // finalize timer in <ConfirmationScreen>. Null otherwise.
  const [pendingFinalizeEntryId, setPendingFinalizeEntryId] = useState<string | null>(null);

  // Resume: on mount, surface any saved unfinished check-in so the patient can
  // pick up where they left off (refresh / navigated away). Read in an effect
  // — not a lazy initializer — so the localStorage access happens after
  // hydration and can't cause an SSR mismatch.
  useEffect(() => {
    if (!user?.id) return;
    const draft = loadCheckInDraft<FormData>(user.id);
    if (draft?.form && hasCheckinProgress(draft.form, (draft.step as StepKey) || 'B1')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResumeDraft(draft);
    }
  }, [user?.id]);

  // Auto-save: persist the in-progress reading whenever it changes so a refresh
  // or navigation never loses it. Skipped while the resume prompt is up (no
  // decision made yet) and after submit (confirmation screen) so we don't
  // re-create a draft of an already-saved reading.
  useEffect(() => {
    if (!user?.id || resumeDraft || showConfirmation) return;
    if (hasCheckinProgress(form, step)) {
      saveCheckInDraft(user.id, { form, step, savedAt: Date.now() });
    }
  }, [form, step, user?.id, resumeDraft, showConfirmation]);

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
  // step 4. AS_NEEDED (PRN) meds are excluded from the adherence checklist:
  // they're not on a fixed schedule so "missed today" isn't meaningful, and
  // letting them through would let the medicationMissedRule fire false alerts.
  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    let cancelled = false;
    (async () => {
      const meds = await listMyMedications().catch(() => [] as PatientMedication[]);
      if (!cancelled) {
        setMedications(meds.filter((m) => m.frequency !== 'AS_NEEDED'));
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

  // When the patient has no active medications on file, skip the MEDICATION
  // step entirely — asking "did you take your meds?" for zero meds makes no
  // sense. Still keep the step while meds are loading so a slow API call
  // doesn't accidentally shortcut the flow.
  const flow = useMemo(() => {
    const base = readingNumber === 0 ? STEP_FLOW : SECOND_READING_FLOW;
    if (medsLoading || medications.length > 0) return base;
    return base.filter((s) => s !== 'MEDICATION');
  }, [readingNumber, medications.length, medsLoading]);
  const stepIndex = flow.indexOf(step);
  const visibleTotal = flow.length;
  const visibleIndex = stepIndex + 1;

  function setField<K extends keyof FormData>(k: K, v: FormData[K]) {
    if (error) setError('');
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  function validateStep(s: StepKey): string | null {
    if (s === 'B2') {
      if (!form.measuredDate || !form.measuredTime) return t('checkin.err.dateTime');
      const measuredDate = new Date(`${form.measuredDate}T${form.measuredTime}`);
      if (isNaN(measuredDate.getTime())) return t('checkin.err.dateInvalid');
      const now = Date.now();
      // A future *day* gets a date-specific message; a same-day time past now
      // (beyond the 5-min clock-skew grace) keeps the time-specific message.
      if (form.measuredDate > nowDate()) return t('checkin.err.dateFuture');
      if (measuredDate.getTime() > now + 5 * 60 * 1000) return t('checkin.err.timeFuture');
      if (measuredDate.getTime() < now - 30 * 24 * 60 * 60 * 1000) return t('checkin.err.timeOld');
      if (!form.position) return t('checkin.err.position');
      if (!form.systolicBP || !form.diastolicBP) return t('checkin.err.bpMissing');
      const sys = parseInt(form.systolicBP, 10);
      const dia = parseInt(form.diastolicBP, 10);
      if (sys < 60 || sys > 250) return t('checkin.err.systolic');
      if (dia < 40 || dia > 150) return t('checkin.err.diastolic');
      if (form.pulse) {
        const p = parseInt(form.pulse, 10);
        if (p < 30 || p > 220) return t('checkin.err.pulse');
      }
    }
    if (s === 'WEIGHT') {
      // Weight is optional — an empty field is fine. But once entered it must
      // be in range for the active unit, caught here (step 3) instead of
      // bouncing off the backend at submit (the final step). Bounds mirror
      // the backend kg limits converted to the selected unit.
      if (form.weight.trim() !== '') {
        const w = parseFloat(form.weight);
        const { min, max } = weightBounds(form.weightUnit);
        if (Number.isNaN(w) || w < min || w > max) {
          return t('checkin.err.weight')
            .replace('{min}', String(min))
            .replace('{max}', String(max))
            .replace('{unit}', form.weightUnit);
        }
      }
    }
    if (s === 'MEDICATION') {
      // Per-medication: every med needs a Took/Missed answer; every Missed
      // needs a reason. Validation points to the first offending med by name
      // so the patient knows exactly what row to fix.
      for (const med of medications) {
        const entry = form.medicationStatus[med.id];
        if (!entry || entry.taken === null) {
          return `Please tell us if you took ${med.drugName} today.`;
        }
        if (entry.taken === 'no' && entry.reason === null) {
          return `Please pick a reason for ${med.drugName}.`;
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

    // Derive rollup from the per-medication map. The backend wants a single
    // `medicationTaken` bool + an optional `missedMedications` array; we
    // compute them here instead of tracking both in FormData.
    // Phase/26 — `scheduledLater` answers count as "answered" for the
    // wizard but are excluded from the took/missed rollup. The new
    // `medicationScheduledLater` boolean tells the backend whether ANY med
    // was flagged not-due-yet so the gap-alert cron knows it's intentional.
    const medEntries = medications.map((m) => ({
      med: m,
      state: form.medicationStatus[m.id] ?? { taken: null, reason: null, missedDoses: 1 },
    }));
    const allAnswered = medEntries.every((e) => e.state.taken !== null);
    const anyMissed = medEntries.some((e) => e.state.taken === 'no');
    const anyExplicitYesNo = medEntries.some(
      (e) => e.state.taken === 'yes' || e.state.taken === 'no',
    );
    const medicationScheduledLater = medEntries.some(
      (e) => e.state.taken === 'scheduledLater',
    );
    const medicationTaken =
      medications.length === 0 || !allAnswered
        ? undefined
        : !anyExplicitYesNo
          ? undefined // every answer was scheduledLater — no signal either way
          : !anyMissed;
    const missedMedications = medEntries
      .filter((e) => e.state.taken === 'no' && e.state.reason !== null)
      .map((e) => ({
        medicationId: e.med.id,
        drugName: e.med.drugName,
        drugClass: e.med.drugClass,
        reason: e.state.reason as NonNullable<MedicationEntry['reason']>,
        missedDoses: e.state.missedDoses,
      }));
    // Per-med status snapshot for EVERY answered med so the edit/detail views
    // can reconstruct each med's exact answer (yes / no / not due yet) — the
    // aggregate flags alone can't disambiguate a mixed answer set.
    const medicationStatuses = medEntries
      .filter((e) => e.state.taken !== null)
      .map((e) => ({
        medicationId: e.med.id,
        drugName: e.med.drugName,
        drugClass: e.med.drugClass,
        taken: e.state.taken as 'yes' | 'no' | 'scheduledLater',
        ...(e.state.taken === 'no' && e.state.reason
          ? { reason: e.state.reason }
          : {}),
        ...(e.state.taken === 'no' ? { missedDoses: e.state.missedDoses } : {}),
      }));

    setSubmitting(true);
    try {
      const created = await createJournalEntry({
        measuredAt: measuredAtIso,
        systolicBP: sys,
        diastolicBP: dia,
        pulse: pul,
        weight: weightKg ? Number(weightKg.toFixed(2)) : undefined,
        position: form.position ?? undefined,
        sessionId,
        measurementConditions,
        medicationTaken,
        medicationScheduledLater: medicationScheduledLater ? true : undefined,
        missedMedications: missedMedications.length > 0 ? missedMedications : undefined,
        medicationStatuses: medicationStatuses.length > 0 ? medicationStatuses : undefined,
        severeHeadache: form.severeHeadache,
        visualChanges: form.visualChanges,
        alteredMentalStatus: form.alteredMentalStatus,
        chestPainOrDyspnea: form.chestPainOrDyspnea,
        focalNeuroDeficit: form.focalNeuroDeficit,
        severeEpigastricPain: form.severeEpigastricPain,
        newOnsetHeadache: isPregnant ? form.newOnsetHeadache : false,
        ruqPain: isPregnant ? form.ruqPain : false,
        edema: isPregnant ? form.edema : false,
        // Cluster 6 — universal (non-pregnancy) symptom signals.
        dizziness: form.dizziness,
        syncope: form.syncope,
        palpitations: form.palpitations,
        legSwelling: form.legSwelling,
        // Cluster 7 — Appendix A side-effect flags.
        fatigue: form.fatigue,
        shortnessOfBreath: form.shortnessOfBreath,
        dryCough: form.dryCough,
        // Cluster 8 — ACE-angioedema airway-emergency flags.
        faceSwelling: form.faceSwelling,
        throatTightness: form.throatTightness,
        // Patient-typed custom symptom chips → otherSymptoms; free-text → notes.
        otherSymptoms: form.otherSymptomsList.length ? form.otherSymptomsList : undefined,
        notes: form.notes.trim() ? form.notes.trim() : undefined,
      });

      // Reading saved — drop the draft so the patient isn't prompted to resume
      // a check-in they already submitted.
      if (user?.id) clearCheckInDraft(user.id);

      const reading: SessionReading = {
        measuredAt: measuredAtIso,
        systolicBP: sys,
        diastolicBP: dia,
        pulse: pul,
        weightKg,
      };
      setSessionReadings((prev) => [...prev, reading]);
      setReadingNumber((n) => n + 1);
      setShowConfirmation(true);
      // Cluster 6 Q2 (Manisha 5/9/26) — backend tells us this is a first-
      // in-session non-AFib non-preDay3 reading. Frontend shows "Take a
      // second reading in about 1 minute" prompt + arms a 5-min timer
      // that POSTs the finalize endpoint when it elapses without a 2nd
      // reading. The actual UI lives in <ConfirmationScreen>; pass the
      // entryId + flag down so it can manage the timer.
      if (created.pendingSecondReading) {
        setPendingFinalizeEntryId(created.entry.id);
      } else {
        setPendingFinalizeEntryId(null);
      }
    } catch (e) {
      // Layer A journaling gate: patient hasn't completed clinical intake yet.
      // Route them into the intake flow instead of surfacing the raw 403.
      if (e instanceof ClinicalIntakeRequiredError) {
        router.push('/clinical-intake?reason=check-in');
        return;
      }
      setError(e instanceof Error ? e.message : t('checkin.err.submit'));
    } finally {
      setSubmitting(false);
    }
  }

  // Resume prompt — load the saved draft into the wizard. Merge over a fresh
  // emptyForm() so a draft saved before a schema change still has every field.
  // Clamp the saved step to the current flow (meds may have changed since).
  function resumeCheckin() {
    if (!resumeDraft) return;
    const s = (resumeDraft.step as StepKey) || 'B1';
    setForm({ ...emptyForm(), ...resumeDraft.form });
    setStep(flow.includes(s) ? s : (flow[0] ?? 'B1'));
    setResumeDraft(null);
  }

  // Resume prompt — discard the saved draft and begin a clean check-in. The
  // form is still pristine here (the draft was never loaded), so we only need
  // to clear storage and dismiss the prompt.
  function startNewCheckin() {
    if (user?.id) clearCheckInDraft(user.id);
    setResumeDraft(null);
  }

  // Header "Save" — persist the in-progress reading to localStorage and leave
  // for the dashboard (mirrors the intake form's save-and-exit). Auto-save
  // already keeps the draft current; we write once more explicitly so a save
  // tapped right after a keystroke can't race the effect, then navigate. With
  // nothing entered there's nothing to save — just go.
  function handleSaveExit() {
    if (user?.id && hasCheckinProgress(form, step)) {
      saveCheckInDraft(user.id, { form, step, savedAt: Date.now() });
    }
    router.push('/dashboard');
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
    // Cluster 6 Q2 — second reading is being logged in the same session.
    // Clear the finalize timer so it doesn't fire when the new reading
    // averages with the first.
    setPendingFinalizeEntryId(null);
    setStep('B2');
    setDirection(1);
  }

  // Authed loading state — skeleton mirroring the wizard chrome (top bar +
  // step header + a few content rows + sticky CTA placeholder) so the page
  // doesn't flash a generic spinner before the first step renders.
  if (isLoading || !isAuthenticated || profileLoading) {
    return <CheckInSkeleton />;
  }

  // Layer A journaling gate (matches backend daily_journal.service.ts). Without
  // a PatientProfile, the rule engine has no clinical context, so the backend
  // silently drops any reading. Block the wizard entirely + send the user to
  // /clinical-intake instead of letting them fill out a form that won't save.
  // Also block when intake is partially saved but not yet submitted —
  // a partial profile (gender + height only, no conditions/meds) gives
  // the rule engine an incomplete picture and is unsafe to evaluate.
  if (!profile || intakeIncomplete) {
    return (
      <div
        className="h-[calc(100dvh-4rem)] flex flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--brand-background)' }}
      >
        <main id="main" className="flex-1 flex items-center justify-center w-full max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <div
            className="w-full max-w-md bg-white rounded-3xl p-6 sm:p-8 text-center"
            style={{ boxShadow: '0 4px 24px rgba(123,0,224,0.08)' }}
          >
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
              style={{
                background: 'linear-gradient(135deg, #7B00E0, #9333EA)',
              }}
              aria-hidden
            >
              <ClipboardCheck className="w-8 h-8 text-white" strokeWidth={2.25} />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#170c1d] mb-3">
              Let&apos;s get to know you first
            </h1>
            <p className="text-[#4b5563] text-sm sm:text-base leading-relaxed mb-6">
              Before you log a reading, please answer a few quick questions
              about your health. Your care team needs this to interpret your
              numbers safely — readings logged without it won&apos;t be saved.
            </p>
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => router.push('/clinical-intake')}
                className="w-full h-12 sm:h-14 bg-[#7B00E0] rounded-full shadow-[0px_10px_15px_rgba(123,0,224,0.25)] font-semibold text-white text-sm sm:text-base hover:bg-[#6600BC] transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
              >
                Complete clinical intake
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => router.push('/dashboard')}
                className="w-full h-11 sm:h-12 rounded-full font-semibold text-[#7B00E0] text-sm sm:text-base hover:bg-[#f5f3ff] transition-colors cursor-pointer"
              >
                Back to dashboard
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Resume prompt — a saved, unfinished check-in was found. Ask before we
  // either restore it or start fresh, so the patient never silently loses work
  // and never accidentally overwrites a draft by starting new.
  if (resumeDraft) {
    // Progress of the saved draft, measured against the canonical 5-step order
    // (not the live flow, which may still be settling as meds load).
    const resumeStepNum = Math.max(0, STEP_FLOW.indexOf((resumeDraft.step as StepKey) || 'B1')) + 1;
    const resumeTotal = STEP_FLOW.length;
    return (
      <div
        className="h-[calc(100dvh-4rem)] flex flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--brand-background)' }}
      >
        <main id="main" className="flex-1 flex items-center justify-center w-full max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <div
            data-testid="checkin-resume-prompt"
            className="w-full max-w-md bg-white rounded-3xl p-6 sm:p-8 text-center"
            style={{ boxShadow: '0 4px 24px rgba(123,0,224,0.08)' }}
          >
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
              style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
              aria-hidden
            >
              <ClipboardCheck className="w-8 h-8 text-white" strokeWidth={2.25} />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#170c1d] mb-3">
              {t('checkin.resume.title')}
            </h1>
            <p className="text-[#4b5563] text-sm sm:text-base leading-relaxed mb-5">
              {t('checkin.resume.body')}
            </p>

            {/* Progress of the unfinished check-in */}
            <div className="flex flex-col items-center gap-2 mb-6">
              <StepDots current={resumeStepNum} total={resumeTotal} />
              <p className="text-[12px] font-semibold" style={{ color: 'var(--brand-text-muted)' }}>
                {t('checkin.nav.stepOf')
                  .replace('{current}', String(resumeStepNum))
                  .replace('{total}', String(resumeTotal))}
              </p>
            </div>

            <div className="space-y-2.5">
              <button
                type="button"
                data-testid="checkin-resume-btn"
                onClick={resumeCheckin}
                className="w-full h-12 sm:h-14 bg-[#7B00E0] rounded-full shadow-[0px_10px_15px_rgba(123,0,224,0.25)] font-semibold text-white text-sm sm:text-base hover:bg-[#6600BC] transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
              >
                {t('checkin.resume.resume')}
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                data-testid="checkin-startnew-btn"
                onClick={startNewCheckin}
                className="w-full h-11 sm:h-12 rounded-full font-semibold text-[#7B00E0] text-sm sm:text-base hover:bg-[#f5f3ff] transition-colors cursor-pointer"
              >
                {t('checkin.resume.startNew')}
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Confirmation overlays the whole flow
  if (showConfirmation) {
    const last = sessionReadings[sessionReadings.length - 1];
    return (
      <div
        className="min-h-[calc(100dvh-4rem)] flex flex-col"
        style={{ backgroundColor: 'var(--brand-background)' }}
      >
        <main id="main" className="flex-1 flex items-center justify-center w-full max-w-3xl mx-auto px-4 sm:px-6 py-4">
          <ConfirmationScreen
            lastReading={last}
            sessionReadings={sessionReadings}
            hasAFib={hasAFib}
            heightCm={profile?.heightCm ?? null}
            missedMedNames={medications
              .filter((m) => form.medicationStatus[m.id]?.taken === 'no')
              .map((m) => m.drugName)}
            onAddAnother={startAnotherReading}
            onDone={() => router.push('/dashboard')}
            pendingFinalizeEntryId={pendingFinalizeEntryId}
            onFinalized={() => setPendingFinalizeEntryId(null)}
          />
        </main>
      </div>
    );
  }

  const stepProps: StepProps = { form, setField };

  return (
    <div className="min-h-[calc(100dvh-4rem)] flex flex-col" style={{ backgroundColor: 'var(--brand-background)' }}>
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
            {t('checkin.nav.back')}
          </button>
          <StepDots current={visibleIndex} total={visibleTotal} />
          <button
            type="button"
            data-testid="checkin-save-exit-btn"
            onClick={() => setShowSaveConfirm(true)}
            className="flex items-center gap-1.5 h-9 px-3 rounded-full text-[13px] font-semibold cursor-pointer"
            style={{ color: 'var(--brand-text-muted)' }}
            aria-label={t('checkin.nav.saveAria')}
          >
            <Save className="w-4 h-4" />
            <span className="hidden sm:inline">{t('checkin.nav.save')}</span>
          </button>
        </div>
        {readingNumber > 0 && (
          <div
            className="px-4 sm:px-6 py-2 flex items-center justify-center gap-2 text-[12px] font-semibold"
            style={{ backgroundColor: 'var(--brand-primary-purple-light)', color: 'var(--brand-primary-purple)' }}
          >
            <Volume2 className="w-3.5 h-3.5" />
            {(hasAFib ? t('checkin.nav.sessionBannerAfib') : t('checkin.nav.sessionBanner')).replace('{n}', String(readingNumber + 1))}
          </div>
        )}
      </header>

      {/* Main content with safe-area bottom padding sized just enough to clear
          the sticky CTA (~72px tall) plus the iOS home indicator. */}
      <main
        id="main"
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
            style={{ color: 'var(--brand-alert-red-text)', backgroundColor: 'var(--brand-alert-red-light)' }}
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
        <div data-testid="check-in-submit" className="max-w-3xl mx-auto">
          <motion.button
            type="button"
            data-testid={step === 'B3' ? 'checkin-submit-btn' : 'checkin-next-btn'}
            onClick={goNext}
            disabled={submitting}
            className="w-full h-12 rounded-full text-white font-bold text-[14px] flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--brand-primary-purple)', boxShadow: 'var(--brand-shadow-button)' }}
            whileTap={{ scale: 0.98 }}
          >
            {submitting
              ? t('checkin.nav.sending')
              : step === 'B3'
                ? t('checkin.nav.submitReading')
                : t('checkin.nav.continue')}
            {!submitting && step !== 'B3' && <ArrowRight className="w-4 h-4" />}
            {!submitting && step === 'B3' && <Check className="w-4 h-4" />}
          </motion.button>
        </div>
      </div>

      {/* Save-and-exit confirmation — mirrors the intake form's exit-save
          modal. The reading is already auto-saved to this device; this just
          confirms leaving for the dashboard. */}
      <AnimatePresence>
        {showSaveConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(15,23,42,0.5)' }}
          >
            <div
              className="absolute inset-0"
              onClick={() => setShowSaveConfirm(false)}
              aria-hidden
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              data-testid="checkin-save-confirm"
              initial={{ scale: 0.92, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.92, y: 12 }}
              transition={{ type: 'spring', stiffness: 340, damping: 26 }}
              className="relative bg-white rounded-3xl p-6 max-w-sm w-full text-center"
              style={{ boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}
            >
              <div
                className="rounded-full mx-auto mb-4 flex items-center justify-center"
                style={{ width: 64, height: 64, backgroundColor: 'var(--brand-primary-purple-light)' }}
              >
                <Save className="w-7 h-7" style={{ color: 'var(--brand-primary-purple)' }} />
              </div>
              <h3 className="text-[18px] font-bold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
                {t('checkin.saveExit.title')}
              </h3>
              <p className="text-[13px] mb-5 leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
                {t('checkin.saveExit.body')}
              </p>
              <button
                type="button"
                data-testid="checkin-save-confirm-btn"
                onClick={handleSaveExit}
                className="w-full h-11 rounded-full text-white font-bold text-[14px] cursor-pointer"
                style={{ backgroundColor: 'var(--brand-primary-purple)', boxShadow: 'var(--brand-shadow-button)' }}
              >
                {t('checkin.saveExit.confirm')}
              </button>
              <button
                type="button"
                onClick={() => setShowSaveConfirm(false)}
                className="w-full mt-2 text-[12px] font-semibold cursor-pointer"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                {t('checkin.saveExit.keepGoing')}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
    <div className="min-h-[calc(100dvh-4rem)] flex flex-col" style={{ backgroundColor: 'var(--brand-background)' }}>
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
        id="main"
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
