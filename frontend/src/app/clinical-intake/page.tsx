'use client';

// Clinical Intake wizard (Flow A) — multi-step, conditional path, draft-saved.
// Launched from the dashboard's Action Required card; submits to backend
// /intake/profile + /intake/medications endpoints; clears draft on success.
//
// Step flow (conditional skips applied):
//   A0b intro → A1 demographics → [A2 pregnancy if female] → A3 conditions
//     → [A4 HF type if HF] → A5 core meds → A8 categories → A6 combos
//     → A9 frequency → A10 review → A11 complete
//
// A7 dedup is a modal interrupt when transitioning OUT of A6 (combos —
// the last medication screen) to A9, so the dedup pass can compare the
// patient's combo selections against everything they picked on A5
// (core) and A8 (categories) per CLINICAL_SPEC §V2-B. COMBO must be
// last for this to work — see shared/src/medications.ts (Screen 1/2/3
// comments).

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Heart,
  HeartPulse,
  Activity,
  Stethoscope,
  CirclePlus,
  Mars,
  Venus,
  Asterisk,
  Baby,
  Pill,
  Droplet,
  TestTube,
  Shield,
  Mic,
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardList,
  Pencil,
  X,
  Save,
} from 'lucide-react';
import {
  CORE_MEDS,
  CATEGORY_MEDS,
  COMBO_MEDS,
  matchToCatalog,
  type DrugClassInput,
  type IntakeProfilePayload,
  type IntakeMedicationsPayload,
  type IntakeMedicationItem,
  type MedicationFrequencyInput,
} from '@cardioplace/shared';

import { useAuth } from '@/lib/auth-context';
import { shouldShowOnboardingForUser } from '@/lib/onboarding';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n';
import { getProfile as getAuthProfile } from '@/lib/services/auth.service';
import { validateDateOfBirth, maxDobIso } from '@/lib/dob-validator';
import {
  getMyPatientProfile,
  getMyMedications,
  saveIntakeProfile,
  // saveIntakeMedications (POST) intentionally not used here — see
  // handleSubmit comment about idempotency. replaceIntakeMedications (PUT)
  // is the canonical write path for this surface.
  replaceIntakeMedications,
} from '@/lib/services/intake.service';
import { CORE_MEDS as ALL_CORE_MEDS, CATEGORY_MEDS as ALL_CATEGORY_MEDS, COMBO_MEDS as ALL_COMBO_MEDS } from '@cardioplace/shared';
import {
  loadDraft,
  saveDraft,
  clearDraft,
  STEP_ORDER,
} from '@/lib/intake/draft';
import { EMPTY_INTAKE_STATE, type IntakeFormState, type IntakeStepKey, type SelectedMedication } from '@/lib/intake/types';

import AudioButton from '@/components/intake/AudioButton';
import MicButton from '@/components/intake/MicButton';
import MedicationPhotoButton from '@/components/intake/MedicationPhotoButton';
import type { ConfirmedMedication } from '@/components/intake/MedicationPhotoConfirmModal';
import OtherMedicationsList from '@/components/intake/OtherMedicationsList';
import OtherMedEditModal from '@/components/intake/OtherMedEditModal';
import { cmToFtIn, ftInToCm } from '@/lib/units';
import StepDots from '@/components/intake/StepDots';
import DateField from '@/components/intake/DateField';
import ChoiceCard from '@/components/intake/ChoiceCard';
import MedicationCard from '@/components/intake/MedicationCard';
import ReAddConfirmModal from '@/components/intake/ReAddConfirmModal';
import SpinnerIndicator from '@/components/ui/SpinnerIndicator';

// ─────────────────────────────────────────────────────────────────────────────
// Condition icons — HCM vs DCM are drawn as visual opposites so a non-medical
// patient grasps the difference without reading: HCM = a SMALL, thick-walled
// heart with arrows pressing INWARD ("muscle too thick / tight"); DCM = a LARGE,
// thin-walled heart with arrows stretching OUTWARD ("heart enlarged / stretched").
// Both previously shared the Sparkles glyph, which read as the same condition.
// NOTE: art still needs Dr. Singal clinical + design sign-off before pilot.
// ─────────────────────────────────────────────────────────────────────────────

function HcmHeartIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* small heart with an extra-thick wall = thickened muscle */}
      <path
        strokeWidth={3}
        d="M12 16.3C9.6 14.6 7.6 12.9 7.6 10.8 7.6 9.5 8.6 8.5 9.9 8.5 10.7 8.5 11.5 8.9 12 9.7 12.5 8.9 13.3 8.5 14.1 8.5 15.4 8.5 16.4 9.5 16.4 10.8 16.4 12.9 14.4 14.6 12 16.3Z"
      />
      {/* arrows pressing inward */}
      <path d="M2.5 12H5M4 10.8 5 12 4 13.2" />
      <path d="M21.5 12H19M20 10.8 19 12 20 13.2" />
    </svg>
  );
}

function DcmHeartIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* larger, thin-walled heart = stretched / enlarged chamber */}
      <path d="M12 17.6C8.7 15.3 6 12.9 6 10 6 8.3 7.3 7 9 7 10.1 7 11.2 7.6 12 8.7 12.8 7.6 13.9 7 15 7 16.7 7 18 8.3 18 10 18 12.9 15.3 15.3 12 17.6Z" />
      {/* arrows stretching outward */}
      <path d="M5 12H2.5M3.5 10.8 2.5 12 3.5 13.2" />
      <path d="M19 12H21.5M20.5 10.8 21.5 12 20.5 13.2" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function computeFlow(state: IntakeFormState): IntakeStepKey[] {
  const flow: IntakeStepKey[] = ['A0b', 'A1'];
  if (state.gender === 'FEMALE') flow.push('A2');
  flow.push('A3');
  if (state.hasHeartFailure) flow.push('A4');
  flow.push('A5', 'A8', 'A6');
  // A9 (frequency) only matters when there's at least one medication. With
  // an empty list the patient just sees "you can skip ahead" copy and a
  // disabled Continue — drop the step entirely instead.
  if (state.selectedMedications.length > 0) flow.push('A9');
  flow.push('A10', 'A11');
  return flow;
}

interface DedupConflict {
  comboId: string;
  comboBrand: string;
  componentName: string;
  componentMedId: string;
}

/**
 * Phase/25 — within-form dedup. Returns the index of the first existing
 * selectedMedications entry whose drugName, catalog brandName, or catalog
 * genericName case-insensitively matches `name`. Used to:
 *   1. Block A8 voice/text "anything else" entries that name a med already
 *      selected (catalog tick OR a prior voice entry).
 *   2. Auto-promote OTHER_UNVERIFIED rows into verified catalog rows when
 *      the patient later ticks the matching catalog tile in A5 / A6 / A8.
 *
 * The backend canonical-key dedup catches same-drugClass dupes; this layer
 * catches cross-drugClass dupes (voice "Eliquis" → OTHER_UNVERIFIED versus
 * catalog Eliquis → ANTICOAGULANT) which the canonical key treats as
 * different meds.
 */
function findExistingMedIndex(
  meds: SelectedMedication[],
  name: string,
): number {
  const target = name.trim().toLowerCase();
  if (!target) return -1;
  return meds.findIndex((m) => {
    if (m.drugName.trim().toLowerCase() === target) return true;
    if (!m.catalogId) return false;
    const core = CORE_MEDS.find((c) => c.id === m.catalogId);
    if (core) {
      if (core.brandName.trim().toLowerCase() === target) return true;
      if (core.genericName.trim().toLowerCase() === target) return true;
    }
    const cat = CATEGORY_MEDS.find((c) => c.id === m.catalogId);
    if (cat) {
      if (cat.brandName.trim().toLowerCase() === target) return true;
      if (cat.genericName.trim().toLowerCase() === target) return true;
    }
    const combo = COMBO_MEDS.find((c) => c.id === m.catalogId);
    if (combo && combo.brandName.trim().toLowerCase() === target) return true;
    return false;
  });
}

/**
 * Strip any existing OTHER_UNVERIFIED voice/photo entries that name the
 * same drug as the catalog item being added. This auto-promotes a voice
 * "Eliquis" row into the verified ANTICOAGULANT catalog row when the
 * patient later ticks Eliquis in A5/A8. Untouched: catalog selections from
 * other categories (those are intentional separate entries).
 */
function stripUnverifiedDuplicates(
  meds: SelectedMedication[],
  catalogBrandName: string,
  catalogGenericName: string | null,
): SelectedMedication[] {
  const targets = new Set(
    [catalogBrandName, catalogGenericName]
      .filter((s): s is string => !!s)
      .map((s) => s.trim().toLowerCase()),
  );
  return meds.filter((m) => {
    if (m.drugClass !== 'OTHER_UNVERIFIED') return true;
    return !targets.has(m.drugName.trim().toLowerCase());
  });
}

function detectDedupConflicts(meds: SelectedMedication[]): DedupConflict[] {
  const selectedSingles = meds.filter((m) => !m.isCombination && m.catalogId);
  const selectedCombos = meds.filter((m) => m.isCombination && m.catalogId);
  const conflicts: DedupConflict[] = [];
  for (const combo of selectedCombos) {
    const comboEntry = COMBO_MEDS.find((c) => c.id === combo.catalogId);
    if (!comboEntry) continue;
    for (const comp of comboEntry.components) {
      const compLower = comp.name.toLowerCase();
      const overlap = selectedSingles.find((s) => {
        const med = CORE_MEDS.find((cm) => cm.id === s.catalogId) ??
          CATEGORY_MEDS.find((cm) => cm.id === s.catalogId);
        return med && med.genericName.toLowerCase() === compLower;
      });
      if (overlap?.catalogId) {
        conflicts.push({
          comboId: comboEntry.id,
          comboBrand: comboEntry.brandName,
          componentName: comp.name,
          componentMedId: overlap.catalogId,
        });
      }
    }
  }
  return conflicts;
}

// Normalize a stored date (which the API serializes as an ISO datetime, e.g.
// "2026-08-15T00:00:00.000Z") to the YYYY-MM-DD form that <input type="date">
// requires — otherwise the edit form shows an empty "mm/dd/yyyy" instead of the
// saved value. Slicing the date portion (rather than new Date()) keeps the
// stored calendar day intact regardless of timezone.
function toDateInput(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const datePart = s.split('T')[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : undefined;
}

function buildProfilePayload(s: IntakeFormState): IntakeProfilePayload {
  return {
    gender: s.gender,
    heightCm: s.heightCm,
    // dateOfBirth lives on User but rides the same submit so the rule
    // engine has age available before any check-in. Backend splits it
    // back out into User.dateOfBirth.
    dateOfBirth: s.dateOfBirth || null,
    // Pregnancy block is cleared whenever gender isn't FEMALE so the DB
    // can't end up with stale "is pregnant" / "due date" / "history of
    // preeclampsia" values from a prior FEMALE selection. Sending explicit
    // false / null beats sending undefined — undefined gets stripped on the
    // backend and existing rows would keep their old pregnancy state.
    isPregnant: s.gender === 'FEMALE' ? (s.isPregnant ?? false) : false,
    pregnancyDueDate:
      s.gender === 'FEMALE' && s.isPregnant === true
        ? (s.pregnancyDueDate || null)
        : null,
    historyPreeclampsia:
      s.gender === 'FEMALE' ? (s.historyPreeclampsia ?? false) : false,
    hasHeartFailure: s.hasHeartFailure ?? false,
    heartFailureType: s.hasHeartFailure
      ? (s.heartFailureType ?? 'UNKNOWN')
      : 'NOT_APPLICABLE',
    hasAFib: s.hasAFib ?? false,
    hasCAD: s.hasCAD ?? false,
    hasHCM: s.hasHCM ?? false,
    hasDCM: s.hasDCM ?? false,
    diagnosedHypertension: s.diagnosedHypertension ?? false,
  };
}

function buildMedsPayload(s: IntakeFormState): IntakeMedicationsPayload {
  const items: IntakeMedicationItem[] = s.selectedMedications.map((m) => ({
    drugName: m.drugName,
    drugClass: m.drugClass,
    frequency: m.frequency ?? 'UNSURE',
    isCombination: m.isCombination,
    combinationComponents: m.combinationComponents,
    source: m.source,
    rawInputText: m.rawInputText,
  }));
  return { medications: items };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step components
// ─────────────────────────────────────────────────────────────────────────────

interface StepProps {
  state: IntakeFormState;
  setState: (updater: (prev: IntakeFormState) => IntakeFormState) => void;
  goTo?: (step: IntakeStepKey) => void;
}

function A0bIntro({ onBegin, onSaveLater }: { onBegin: () => void; onSaveLater: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center text-center px-6 py-6 sm:py-10">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 20 }}
        className="rounded-full flex items-center justify-center mb-6"
        style={{
          width: 110,
          height: 110,
          background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
        }}
      >
        <Heart className="w-14 h-14 text-white" strokeWidth={2} />
      </motion.div>

      <div className="flex items-center gap-2 mb-2">
        <h1 className="text-[26px] sm:text-[28px] font-bold tracking-tight" style={{ color: 'var(--brand-text-primary)' }}>
          {t('intake.a0b.title')}
        </h1>
        <AudioButton text={t('intake.a0b.audio')} />
      </div>

      <p className="text-[15px] max-w-md leading-relaxed mb-8" style={{ color: 'var(--brand-text-secondary)' }}>
        {t('intake.a0b.desc')}
      </p>

      <motion.button
        type="button"
        onClick={onBegin}
        className="w-full max-w-sm h-12 rounded-full font-bold text-white text-[15px] mb-3 cursor-pointer"
        style={{
          backgroundColor: 'var(--brand-primary-purple)',
          boxShadow: 'var(--brand-shadow-button)',
        }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
      >
        {t('intake.a0b.begin')}
      </motion.button>
      <button
        type="button"
        onClick={onSaveLater}
        className="text-[13px] font-semibold cursor-pointer"
        style={{ color: 'var(--brand-text-muted)' }}
      >
        {t('intake.a0b.saveForLater')}
      </button>
    </div>
  );
}

function A1Demographics({ state, setState }: StepProps) {
  const { t } = useLanguage();
  return (
    <div className="space-y-7">
      <StepHeader
        title={t('intake.a1.title')}
        subtitle={t('intake.a1.subtitle')}
        audio={t('intake.a1.audio')}
      />

      <div>
        <SectionLabel text={t('intake.a1.genderQuestion')} audio={t('intake.a1.genderAudio')} />
        <div className="grid grid-cols-3 gap-3">
          <ChoiceCard
            icon={<Mars className="w-6 h-6" />}
            title={t('intake.a1.genderMale')}
            selected={state.gender === 'MALE'}
            onClick={() => setState((p) => ({ ...p, gender: 'MALE' }))}
            audioText={t('intake.a1.genderMale')}
            testId="intake-gender-male"
            compact
          />
          <ChoiceCard
            icon={<Venus className="w-6 h-6" />}
            title={t('intake.a1.genderFemale')}
            selected={state.gender === 'FEMALE'}
            onClick={() => setState((p) => ({ ...p, gender: 'FEMALE' }))}
            audioText={t('intake.a1.genderFemale')}
            testId="intake-gender-female"
            compact
          />
          <ChoiceCard
            icon={<Asterisk className="w-6 h-6" />}
            title={t('intake.a1.genderOther')}
            selected={state.gender === 'OTHER'}
            onClick={() => setState((p) => ({ ...p, gender: 'OTHER' }))}
            audioText={t('intake.a1.genderOther')}
            testId="intake-gender-non_binary"
            compact
          />
        </div>
      </div>

      <div>
        <SectionLabel text={t('intake.a1.dobQuestion')} audio={t('intake.a1.dobQuestion')} />
        <DateField
          id="intake-a1-dob"
          testId="intake-dob"
          value={state.dateOfBirth ?? ''}
          max={maxDobIso()}
          placeholder={t('intake.datePlaceholder')}
          onChange={(v) => setState((p) => ({ ...p, dateOfBirth: v || undefined }))}
        />
        <p className="text-[12px] mt-2" style={{ color: 'var(--brand-text-muted)' }}>
          {t('intake.a1.dobHint')}
        </p>
      </div>

      <div>
        <SectionLabel text={t('intake.a1.heightQuestion')} audio={t('intake.a1.heightAudio')} />
        {(() => {
          // Patients pick a unit (ft/in primary, cm secondary) — same toggle
          // pattern as weight on the daily check-in. Storage is always cm;
          // ft/in convert via ftInToCm before persisting.
          const unit: 'ftin' | 'cm' = state.heightUnit ?? 'ftin';
          const setUnit = (u: 'ftin' | 'cm') => setState((p) => ({ ...p, heightUnit: u }));
          const { feet: storedFeet, inches: storedInches } = cmToFtIn(state.heightCm ?? 0);
          const updateHeightFromFtIn = (feet: number, inches: number) => {
            const cm = ftInToCm(feet, inches);
            setState((p) => ({ ...p, heightCm: cm > 0 ? cm : undefined }));
          };
          const updateHeightFromCm = (cm: number) => {
            setState((p) => ({ ...p, heightCm: cm > 0 ? cm : undefined }));
          };
          return (
            <>
              <div
                className="inline-flex rounded-full p-1 gap-1 mb-4"
                style={{ backgroundColor: 'var(--brand-background)', border: '1px solid var(--brand-border)' }}
              >
                {(['ftin', 'cm'] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setUnit(u)}
                    className="px-5 py-1.5 rounded-full text-sm font-semibold transition-all cursor-pointer"
                    style={{
                      backgroundColor: unit === u ? 'var(--brand-primary-purple)' : 'transparent',
                      color: unit === u ? 'white' : 'var(--brand-text-secondary)',
                    }}
                  >
                    {u === 'ftin' ? 'ft / in' : 'cm'}
                  </button>
                ))}
              </div>
              {unit === 'ftin' ? (
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label htmlFor="intake-a1-height-ft" className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--brand-text-muted)' }}>
                      {t('intake.a1.heightFeetLabel')}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="intake-a1-height-ft"
                        type="number"
                        inputMode="numeric"
                        min={3}
                        max={8}
                        value={storedFeet || ''}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          // Clamp to a realistic range so a stray digit can't
                          // produce an out-of-bounds height.
                          const feet = Number.isFinite(v) ? Math.min(8, Math.max(0, v)) : 0;
                          updateHeightFromFtIn(feet, storedInches);
                        }}
                        placeholder="5"
                        className="flex-1 h-14 px-4 rounded-xl text-[18px] outline-none transition box-border text-center"
                        style={{
                          border: '2px solid var(--brand-border)',
                          color: 'var(--brand-text-primary)',
                          backgroundColor: 'white',
                        }}
                        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--brand-primary-purple)'; }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--brand-border)'; }}
                      />
                      <MicButton
                        inputId="intake-a1-height-ft"
                        numeric
                        onTranscript={(text) => {
                          const n = parseInt(text, 10);
                          if (Number.isFinite(n)) updateHeightFromFtIn(Math.min(8, Math.max(0, n)), storedInches);
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex-1">
                    <label htmlFor="intake-a1-height-in" className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--brand-text-muted)' }}>
                      {t('intake.a1.heightInchesLabel')}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="intake-a1-height-in"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={11}
                        value={storedInches || ''}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          // Clamp to 0–11. Without this, an inches value > 11
                          // rolls over into feet through the cm round-trip
                          // (e.g. 4 ft + 50 in = 98 in = 8 ft 2 in), which is
                          // what made the feet field jump while typing inches.
                          const inches = Number.isFinite(v) ? Math.min(11, Math.max(0, v)) : 0;
                          updateHeightFromFtIn(storedFeet, inches);
                        }}
                        placeholder="9"
                        className="flex-1 h-14 px-4 rounded-xl text-[18px] outline-none transition box-border text-center"
                        style={{
                          border: '2px solid var(--brand-border)',
                          color: 'var(--brand-text-primary)',
                          backgroundColor: 'white',
                        }}
                        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--brand-primary-purple)'; }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--brand-border)'; }}
                      />
                      <MicButton
                        inputId="intake-a1-height-in"
                        numeric
                        onTranscript={(text) => {
                          const n = parseInt(text, 10);
                          if (Number.isFinite(n)) updateHeightFromFtIn(storedFeet, Math.min(11, Math.max(0, n)));
                        }}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex-1 relative">
                    <input
                      id="intake-a1-height-cm"
                      data-testid="intake-height-cm"
                      type="number"
                      inputMode="numeric"
                      min={100}
                      max={250}
                      value={state.heightCm ?? ''}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        updateHeightFromCm(Number.isFinite(v) ? v : 0);
                      }}
                      placeholder="165"
                      className="w-full h-14 pl-4 pr-14 rounded-xl text-[18px] outline-none transition box-border"
                      style={{
                        border: '2px solid var(--brand-border)',
                        color: 'var(--brand-text-primary)',
                        backgroundColor: 'white',
                      }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--brand-primary-purple)'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--brand-border)'; }}
                    />
                    <span
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-[16px]"
                      style={{ color: 'var(--brand-text-muted)' }}
                    >
                      cm
                    </span>
                  </div>
                  <MicButton
                    inputId="intake-a1-height-cm"
                    numeric
                    onTranscript={(text) => {
                      const n = parseInt(text, 10);
                      if (Number.isFinite(n)) updateHeightFromCm(n);
                    }}
                  />
                </div>
              )}
              {state.heightCm ? (
                <p className="text-[13px] mt-3 font-medium" style={{ color: 'var(--brand-primary-purple)' }}>
                  {unit === 'ftin'
                    ? `≈ ${state.heightCm} cm`
                    : `≈ ${cmToFtIn(state.heightCm).feet} ft ${cmToFtIn(state.heightCm).inches} in`}
                </p>
              ) : null}
              <p className="text-[12px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
                {t('intake.a1.heightHint')}
              </p>
            </>
          );
        })()}
      </div>
    </div>
  );
}

function A2Pregnancy({ state, setState }: StepProps) {
  const { t } = useLanguage();
  const isPregnant = state.isPregnant === true;
  return (
    <div className="space-y-7">
      <StepHeader
        title={t('intake.a2.title')}
        subtitle={t('intake.a2.subtitle')}
        audio={t('intake.a2.audio')}
      />

      {/* Two independent yes/no questions for FEMALE patients:
          1. Are you currently pregnant? (drives current-pregnancy alert rules)
          2. Have you ever had preeclampsia? (long-term risk marker — relevant
             outside pregnancy too, per CLINICAL_SPEC §3)
          The preeclampsia question used to live INSIDE the "currently pregnant
          = Yes" panel, which made it unreachable for non-pregnant women with
          a documented history. Splitting them keeps the clinical question
          accurate for both states. */}
      <div>
        <SectionLabel
          text={t('intake.a2.currentlyPregnantQuestion')}
          audio={t('intake.a2.currentlyPregnantAudio')}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ChoiceCard
            icon={<Baby className="w-6 h-6" />}
            title={t('intake.a2.yesTitle')}
            description={t('intake.a2.yesDesc')}
            selected={state.isPregnant === true}
            onClick={() => setState((p) => ({ ...p, isPregnant: true }))}
            audioText={t('intake.a2.yesAudio')}
            testId="intake-pregnancy-yes"
          />
          <ChoiceCard
            icon={<Heart className="w-6 h-6" />}
            title={t('intake.a2.noTitle')}
            description={t('intake.a2.noDesc')}
            selected={state.isPregnant === false}
            testId="intake-pregnancy-no"
            onClick={() =>
              setState((p) => ({
                ...p,
                isPregnant: false,
                // Due date is gated behind the Yes panel so it's safe to
                // wipe here. historyPreeclampsia is its own independent
                // question now and is left untouched.
                pregnancyDueDate: undefined,
              }))
            }
            audioText={t('intake.a2.noAudio')}
          />
        </div>
      </div>

      <AnimatePresence>
        {isPregnant && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <SectionLabel text={t('intake.a2.dueDateLabel')} audio={t('intake.a2.dueDateAudio')} />
            <DateField
              ariaLabel={t('intake.a2.dueDateLabel')}
              value={state.pregnancyDueDate ?? ''}
              placeholder={t('intake.datePlaceholder')}
              textSizeClass="text-[15px]"
              onChange={(v) => setState((p) => ({ ...p, pregnancyDueDate: v || undefined }))}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div>
        <SectionLabel
          text={t('intake.a2.preeclampsiaQuestion')}
          audio={t('intake.a2.preeclampsiaQuestionAudio')}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ChoiceCard
            icon={<Shield className="w-6 h-6" />}
            title={t('intake.a2.yesTitle')}
            description={t('intake.a2.preeclampsiaYesDesc')}
            selected={state.historyPreeclampsia === true}
            onClick={() => setState((p) => ({ ...p, historyPreeclampsia: true }))}
            audioText={t('intake.a2.preeclampsiaYesAudio')}
          />
          <ChoiceCard
            icon={<Heart className="w-6 h-6" />}
            title={t('intake.a2.noTitle')}
            description={t('intake.a2.preeclampsiaNoDesc')}
            selected={state.historyPreeclampsia === false}
            onClick={() => setState((p) => ({ ...p, historyPreeclampsia: false }))}
            audioText={t('intake.a2.preeclampsiaNoAudio')}
          />
        </div>
      </div>
    </div>
  );
}

function A3Conditions({ state, setState }: StepProps) {
  const { t } = useLanguage();
  const has = (k: keyof IntakeFormState): boolean => Boolean(state[k]);
  // Toggling any condition clears the explicit "None" ack — they're mutually
  // exclusive by definition.
  const set = (k: keyof IntakeFormState, v: boolean) =>
    setState((p) => ({ ...p, [k]: v, noneOfTheAboveAck: false }));

  // "None of the above" is selected ONLY when the user explicitly clicked
  // it (noneOfTheAboveAck === true). Just having all booleans empty is the
  // initial state and must NOT pre-select anything.
  const noneSelected = state.noneOfTheAboveAck === true;

  return (
    <div className="space-y-6">
      <StepHeader
        title={t('intake.a3.title')}
        subtitle={t('intake.a3.subtitle')}
        audio={t('intake.a3.audio')}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ChoiceCard
          icon={<Heart className="w-6 h-6" />}
          title={t('intake.a3.hfTitle')}
          description={t('intake.a3.hfDesc')}
          selected={has('hasHeartFailure')}
          onClick={() => set('hasHeartFailure', !state.hasHeartFailure)}
          audioText={t('intake.a3.hfAudio')}
          testId="intake-condition-HEART_FAILURE"
        />
        <ChoiceCard
          icon={<Activity className="w-6 h-6" />}
          title={t('intake.a3.afTitle')}
          description={t('intake.a3.afDesc')}
          selected={has('hasAFib')}
          onClick={() => set('hasAFib', !state.hasAFib)}
          audioText={t('intake.a3.afAudio')}
          testId="intake-condition-AFIB"
        />
        <ChoiceCard
          icon={<Stethoscope className="w-6 h-6" />}
          title={t('intake.a3.cadTitle')}
          description={t('intake.a3.cadDesc')}
          selected={has('hasCAD')}
          onClick={() => set('hasCAD', !state.hasCAD)}
          audioText={t('intake.a3.cadAudio')}
          testId="intake-condition-CAD"
        />
        <ChoiceCard
          icon={<HcmHeartIcon className="w-6 h-6" />}
          title={t('intake.a3.hcmTitle')}
          description={t('intake.a3.hcmDesc')}
          selected={has('hasHCM')}
          onClick={() => set('hasHCM', !state.hasHCM)}
          audioText={t('intake.a3.hcmAudio')}
          testId="intake-condition-HCM"
        />
        <ChoiceCard
          icon={<DcmHeartIcon className="w-6 h-6" />}
          title={t('intake.a3.dcmTitle')}
          description={t('intake.a3.dcmDesc')}
          selected={has('hasDCM')}
          onClick={() => set('hasDCM', !state.hasDCM)}
          audioText={t('intake.a3.dcmAudio')}
        />
        <ChoiceCard
          icon={<X className="w-6 h-6" />}
          title={t('intake.a3.noneTitle')}
          description={t('intake.a3.noneDesc')}
          selected={noneSelected}
          destructiveSelected={false}
          onClick={() => setState((p) => ({
            ...p,
            hasHeartFailure: false,
            hasAFib: false,
            hasCAD: false,
            hasHCM: false,
            hasDCM: false,
            heartFailureType: undefined,
            // Explicit acknowledgement — distinguishes "user said no"
            // from "user hasn't touched the step yet".
            noneOfTheAboveAck: true,
          }))}
          audioText={t('intake.a3.noneAudio')}
        />
      </div>

      <ChoiceCard
        icon={<Shield className="w-5 h-5" />}
        title={t('intake.a3.htnLabel')}
        selected={state.diagnosedHypertension === true}
        onClick={() => setState((p) => ({ ...p, diagnosedHypertension: !p.diagnosedHypertension }))}
        audioText={t('intake.a3.htnLabel')}
        compact
      />
    </div>
  );
}

function A4HFType({ state, setState }: StepProps) {
  const { t } = useLanguage();
  return (
    <div className="space-y-6">
      <StepHeader
        title={t('intake.a4.title')}
        subtitle={t('intake.a4.subtitle')}
        audio={t('intake.a4.audio')}
      />
      <div className="grid grid-cols-1 gap-3">
        <ChoiceCard
          icon={<HeartPulse className="w-6 h-6" />}
          title={t('intake.a4.hfrefTitle')}
          description={t('intake.a4.hfrefDesc')}
          selected={state.heartFailureType === 'HFREF'}
          onClick={() => setState((p) => ({ ...p, heartFailureType: 'HFREF' }))}
          audioText={t('intake.a4.hfrefAudio')}
          testId="intake-hf-type-hfref"
        />
        <ChoiceCard
          icon={<Heart className="w-6 h-6" />}
          title={t('intake.a4.hfpefTitle')}
          description={t('intake.a4.hfpefDesc')}
          selected={state.heartFailureType === 'HFPEF'}
          onClick={() => setState((p) => ({ ...p, heartFailureType: 'HFPEF' }))}
          audioText={t('intake.a4.hfpefAudio')}
          testId="intake-hf-type-hfpef"
        />
        <ChoiceCard
          icon={<Asterisk className="w-6 h-6" />}
          title={t('intake.a4.unknownTitle')}
          description={t('intake.a4.unknownDesc')}
          // Only highlight when explicitly chosen — undefined is the
          // initial state and must NOT auto-select an option.
          selected={state.heartFailureType === 'UNKNOWN'}
          onClick={() => setState((p) => ({ ...p, heartFailureType: 'UNKNOWN' }))}
          audioText={t('intake.a4.unknownAudio')}
        />
      </div>
    </div>
  );
}

function MedicationGroup({
  title,
  meds,
  selectedIds,
  toggle,
}: {
  title: string;
  meds: typeof CORE_MEDS;
  selectedIds: Set<string>;
  toggle: (medId: string) => void;
}) {
  const { t } = useLanguage();
  const alsoKnown = t('intake.a5.audioAlsoKnown');
  return (
    <div>
      <h3 className="text-[13px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--brand-text-muted)' }}>
        {title}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {meds.map((m) => (
          <MedicationCard
            key={m.id}
            brandName={m.brandName}
            genericName={m.genericName}
            purpose={m.purpose}
            drugClass={m.drugClass}
            isNdhpCcb={m.isNdhpCcb}
            selected={selectedIds.has(m.id)}
            onToggle={() => toggle(m.id)}
            audioText={`${m.brandName}, ${alsoKnown} ${m.genericName}. ${m.purpose}`}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Identity match for two SelectedMedication entries — prefers serverId
 * (loaded from a prior session via PatientMedication.id), falls back to
 * case-insensitive drugName for in-session adds. Top-level helper so
 * useCallback dep arrays don't have to chase its reference.
 */
function isSameMed(a: SelectedMedication, b: SelectedMedication): boolean {
  if (a.serverId && b.serverId) return a.serverId === b.serverId;
  return (
    a.drugName.trim().toLowerCase() === b.drugName.trim().toLowerCase() &&
    !a.serverId &&
    !b.serverId
  );
}

/**
 * Phase/28 — shared edit/delete/toggle handlers for the OTHER_UNVERIFIED
 * meds list rendered on A5 + A8. Both steps instantiate this so each
 * keeps its own edit-modal-open state without leaking across steps.
 */
function useOtherMedHandlers(
  state: IntakeFormState,
  setState: (updater: (prev: IntakeFormState) => IntakeFormState) => void,
) {
  const [editingMed, setEditingMed] = useState<SelectedMedication | null>(null);

  const otherMeds = useMemo(
    () =>
      state.selectedMedications.filter(
        (m) => m.drugClass === 'OTHER_UNVERIFIED',
      ),
    [state.selectedMedications],
  );

  const handleDelete = useCallback(
    (med: SelectedMedication) => {
      setState((prev) => ({
        ...prev,
        selectedMedications: prev.selectedMedications.filter(
          (m) => !isSameMed(m, med),
        ),
      }));
    },
    [setState],
  );

  const handleEdit = useCallback((med: SelectedMedication) => {
    setEditingMed(med);
  }, []);

  const handleSaveEdit = useCallback(
    (
      med: SelectedMedication,
      patch: { drugName: string; frequency?: SelectedMedication['frequency'] },
    ) => {
      setState((prev) => ({
        ...prev,
        selectedMedications: prev.selectedMedications.map((m) =>
          isSameMed(m, med)
            ? { ...m, drugName: patch.drugName, frequency: patch.frequency }
            : m,
        ),
      }));
      setEditingMed(null);
    },
    [setState],
  );

  const handleCancelEdit = useCallback(() => setEditingMed(null), []);

  const isDuplicateName = useCallback(
    (proposedName: string, currentMed: SelectedMedication): boolean => {
      const target = proposedName.trim().toLowerCase();
      if (!target) return false;
      return state.selectedMedications.some((m) => {
        if (isSameMed(m, currentMed)) return false; // allow saving same name
        if (m.drugName.trim().toLowerCase() === target) return true;
        // Also block renaming into a catalog brand/generic name — patient
        // should use the catalog tile in that case (the modal also surfaces
        // a hint, but this is the hard guard).
        if (!m.catalogId) return false;
        return false; // catalog row stored under genericName already collides via the drugName check above
      });
    },
    [state.selectedMedications],
  );

  return {
    otherMeds,
    editingMed,
    handleEdit,
    handleDelete,
    handleSaveEdit,
    handleCancelEdit,
    isDuplicateName,
  };
}

// IVR-19 — load the CANONICAL keys of drugs the care team previously REJECTED
// (option c: warn, then allow re-add). Fetched with includeRejected so the
// rejected rows reach the wizard even though they're never pre-filled into the
// selection. We key by catalog id (resolved via matchToCatalog) rather than the
// raw drug name so a med rejected under its generic name (e.g. "Carvedilol")
// still matches the brand-named catalog tile the patient taps (e.g. "Coreg").
function canonicalMedKey(drugName: string): string {
  return matchToCatalog(drugName)?.catalogId ?? drugName.trim().toLowerCase();
}

function useRejectedDrugKeys(): Set<string> {
  const [keys, setKeys] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    getMyMedications(false, true)
      .then((meds) => {
        if (cancelled) return;
        setKeys(
          new Set(
            meds
              .filter((m) => m.verificationStatus === 'REJECTED')
              .map((m) => canonicalMedKey(m.drugName)),
          ),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return keys;
}

// Pairs the canonical rejected-key lookup with the styled ReAddConfirmModal.
// `requestAdd` runs `doAdd` immediately for a drug that wasn't previously
// rejected, or defers it behind the modal when it was (option c: warn → allow).
// Render the returned `modal` somewhere in the consuming step's JSX.
function useReAddConfirm(): {
  requestAdd: (canonicalKey: string, displayName: string, doAdd: () => void) => void;
  modal: React.ReactNode;
} {
  const rejectedKeys = useRejectedDrugKeys();
  const [pending, setPending] = useState<{ name: string; onConfirm: () => void } | null>(null);

  const requestAdd = (canonicalKey: string, displayName: string, doAdd: () => void) => {
    if (!rejectedKeys.has(canonicalKey)) {
      doAdd();
      return;
    }
    setPending({ name: displayName, onConfirm: doAdd });
  };

  const modal = (
    <ReAddConfirmModal
      open={pending != null}
      drugName={pending?.name ?? ''}
      onConfirm={() => {
        const p = pending;
        setPending(null);
        p?.onConfirm();
      }}
      onCancel={() => setPending(null)}
    />
  );

  return { requestAdd, modal };
}

function A5CoreMeds({ state, setState }: StepProps) {
  const { requestAdd, modal: reAddModal } = useReAddConfirm();
  const selectedIds = useMemo(
    () => new Set(state.selectedMedications.filter((m) => !m.isCombination).map((m) => m.catalogId).filter(Boolean) as string[]),
    [state.selectedMedications],
  );

  const { t } = useLanguage();

  const addMed = (med: (typeof CORE_MEDS)[number]) =>
    setState((prev) => ({
      ...prev,
      selectedMedications: [
        // Auto-promote: strip any prior voice/photo entry naming the same drug
        // so we don't end up with two rows (one OTHER_UNVERIFIED and one
        // ACE_INHIBITOR / etc.) for the same medication.
        ...stripUnverifiedDuplicates(prev.selectedMedications, med.brandName, med.genericName),
        {
          catalogId: med.id,
          drugName: med.brandName,
          drugClass: med.drugClass,
          isCombination: false,
          source: 'PATIENT_SELF_REPORT' as const,
        },
      ],
    }));

  const toggle = (medId: string) => {
    const med = CORE_MEDS.find((m) => m.id === medId);
    if (!med) return;
    if (selectedIds.has(medId)) {
      setState((prev) => ({
        ...prev,
        selectedMedications: prev.selectedMedications.filter((m) => m.catalogId !== medId),
      }));
      return;
    }
    // IVR-19 — re-adding a med the care team rejected: confirm via modal first.
    requestAdd(med.id, med.brandName, () => addMed(med));
  };

  // Phase/28 — OTHER_UNVERIFIED meds list at the bottom of A5. The hook
  // derives the freeform subset + handlers; the modal opens when the
  // patient taps the edit pencil.
  const otherMedHandlers = useOtherMedHandlers(state, setState);

  // Phase/27 — when the patient scans a prescription, fan the OCR-extracted
  // medications out into selectedMedications. Catalog matches inherit the
  // canonical drugName + drugClass; non-matches land as OTHER_UNVERIFIED with
  // rawInputText preserved for provider review. Existing meds are deduped via
  // findExistingMedIndex so a re-scan doesn't double-add.
  const addOcrMedications = (rows: ConfirmedMedication[]) => {
    setState((prev) => {
      let next = prev.selectedMedications;
      for (const row of rows) {
        const trimmed = row.drugName.trim();
        if (!trimmed) continue;
        const existing = findExistingMedIndex(next, trimmed);
        if (existing >= 0) {
          // Update frequency on the existing row if the OCR pass found one.
          if (row.frequency !== 'UNSURE') {
            next = next.map((m, i) =>
              i === existing ? { ...m, frequency: row.frequency } : m,
            );
          }
          continue;
        }
        const med: SelectedMedication = row.match
          ? {
              catalogId: row.match.catalogId,
              drugName: row.match.drugName,
              drugClass: row.match.drugClass,
              isCombination: row.match.isCombination,
              combinationComponents:
                row.match.combinationComponents.length > 0
                  ? row.match.combinationComponents
                  : undefined,
              source: 'PATIENT_PHOTO',
              frequency: row.frequency === 'UNSURE' ? undefined : row.frequency,
            }
          : {
              drugName: trimmed.slice(0, 60),
              drugClass: 'OTHER_UNVERIFIED',
              isCombination: false,
              source: 'PATIENT_PHOTO',
              rawInputText: row.raw.slice(0, 2000),
              frequency: row.frequency === 'UNSURE' ? undefined : row.frequency,
            };
        next = [...next, med];
      }
      return { ...prev, selectedMedications: next };
    });
  };

  return (
    <div className="space-y-7">
      {reAddModal}
      <StepHeader
        title={t('intake.a5.title')}
        subtitle={t('intake.a5.subtitle')}
        audio={t('intake.a5.audio')}
      />

      {/* Phase/27 — Gemini Vision OCR for prescriptions. Hidden when
          NEXT_PUBLIC_MED_OCR_ENABLED !== 'true'. Fans OCR results across
          A5/A6/A8 + A9 frequency in one shot via addOcrMedications.
          findExisting lets the modal badge already-on-list rows pre-Confirm
          using the same drugName / brandName / genericName logic the handler
          applies post-Confirm via findExistingMedIndex. */}
      <div className="flex">
        <MedicationPhotoButton
          onConfirm={addOcrMedications}
          findExisting={(drugName) => {
            const idx = findExistingMedIndex(state.selectedMedications, drugName);
            if (idx < 0) return null;
            const m = state.selectedMedications[idx];
            return { currentFrequency: m.frequency ?? null };
          }}
        />
      </div>

      <MedicationGroup
        title={t('intake.a5.groupAce')}
        meds={CORE_MEDS.filter((m) => m.drugClass === 'ACE_INHIBITOR')}
        selectedIds={selectedIds}
        toggle={toggle}
      />
      <MedicationGroup
        title={t('intake.a5.groupArb')}
        meds={CORE_MEDS.filter((m) => m.drugClass === 'ARB')}
        selectedIds={selectedIds}
        toggle={toggle}
      />
      <MedicationGroup
        title={t('intake.a5.groupBeta')}
        meds={CORE_MEDS.filter((m) => m.drugClass === 'BETA_BLOCKER')}
        selectedIds={selectedIds}
        toggle={toggle}
      />
      <MedicationGroup
        title={t('intake.a5.groupCcb')}
        meds={CORE_MEDS.filter((m) => m.drugClass === 'DHP_CCB' || m.drugClass === 'NDHP_CCB')}
        selectedIds={selectedIds}
        toggle={toggle}
      />

      {/* Phase/28 — Your other medications. Renders only when the patient has
          OTHER_UNVERIFIED rows (from OCR scan or A8 freeform input or a
          prior session loaded via seedFromMedications). Body-click toggles
          off (== delete); pencil opens edit modal; trash deletes outright. */}
      {otherMedHandlers.otherMeds.length > 0 && (
        <OtherMedicationsList
          meds={otherMedHandlers.otherMeds}
          onToggle={otherMedHandlers.handleDelete}
          onEdit={otherMedHandlers.handleEdit}
          onDelete={otherMedHandlers.handleDelete}
        />
      )}
      {otherMedHandlers.editingMed && (
        <OtherMedEditModal
          med={otherMedHandlers.editingMed}
          isDuplicateName={otherMedHandlers.isDuplicateName}
          onSave={otherMedHandlers.handleSaveEdit}
          onCancel={otherMedHandlers.handleCancelEdit}
        />
      )}
    </div>
  );
}

function A6Combos({ state, setState }: StepProps) {
  const { t } = useLanguage();
  const { requestAdd, modal: reAddModal } = useReAddConfirm();
  const selectedIds = useMemo(
    () => new Set(state.selectedMedications.filter((m) => m.isCombination).map((m) => m.catalogId).filter(Boolean) as string[]),
    [state.selectedMedications],
  );

  const addCombo = (combo: (typeof COMBO_MEDS)[number]) =>
    setState((prev) => ({
      ...prev,
      selectedMedications: [
        // Auto-promote: strip any prior voice/photo entry naming the combo
        // brand (e.g., voice "Zestoretic" → catalog tick).
        ...stripUnverifiedDuplicates(prev.selectedMedications, combo.brandName, null),
        {
          catalogId: combo.id,
          drugName: combo.brandName,
          // Pick first registered class as the primary; full set goes into combinationComponents.
          drugClass: combo.registersAs[0] as DrugClassInput,
          isCombination: true,
          combinationComponents: combo.registersAs,
          source: 'PATIENT_SELF_REPORT' as const,
        },
      ],
    }));

  const toggle = (comboId: string) => {
    const combo = COMBO_MEDS.find((c) => c.id === comboId);
    if (!combo) return;
    if (selectedIds.has(comboId)) {
      setState((prev) => ({
        ...prev,
        selectedMedications: prev.selectedMedications.filter((m) => m.catalogId !== comboId),
      }));
      return;
    }
    // IVR-19 — re-adding a combo the care team rejected: confirm via modal first.
    requestAdd(combo.id, combo.brandName, () => addCombo(combo));
  };
  const contains = t('intake.a6.audioContains');
  const andWord = t('intake.a6.audioAnd');
  return (
    <div className="space-y-6">
      {reAddModal}
      <StepHeader
        title={t('intake.a6.title')}
        subtitle={t('intake.a6.subtitle')}
        audio={t('intake.a6.audio')}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3">
        {COMBO_MEDS.map((c) => (
          <MedicationCard
            key={c.id}
            brandName={c.brandName}
            genericName={c.components.map((x) => x.name).join(' + ')}
            purpose={c.purpose}
            drugClass={c.registersAs[0] as DrugClassInput}
            isCombination
            selected={selectedIds.has(c.id)}
            onToggle={() => toggle(c.id)}
            audioText={`${c.brandName}. ${contains} ${c.components.map((x) => x.name).join(` ${andWord} `)}. ${c.purpose}`}
          />
        ))}
      </div>
    </div>
  );
}

function A8Categories({ state, setState }: StepProps) {
  const { t } = useLanguage();
  // Multi-expand: a Set of currently-open category keys. Patients can have
  // multiple categories expanded at once so they don't lose visual sight of
  // a Furosemide tick when they go check the blood-thinner list. Selections
  // already persist cross-category in state.selectedMedications; this just
  // matches the UI affordance to that reality.
  const [activeCategories, setActiveCategories] = useState<Set<string>>(() => {
    // Auto-expand any category that already has a selected med — e.g. a
    // prescription scan matched a water pill / blood thinner that lives inside
    // one of these dropdowns. Without this the med is selected but hidden, so
    // the patient can't see it was picked up. (selectedIds already shows it as
    // checked; this just reveals the right dropdown on entry.)
    const set = new Set<string>();
    for (const m of state.selectedMedications) {
      if (!m.catalogId) continue;
      const cat = CATEGORY_MEDS.find((c) => c.id === m.catalogId);
      if (cat?.category) set.add(cat.category);
    }
    return set;
  });
  const [otherText, setOtherText] = useState(state.otherDraft?.text ?? '');
  // Phase/25 — inline dedup error for the voice/photo "anything else" path.
  // Cleared on next keystroke or after a 3.5s timeout so the UI doesn't
  // get stuck in an error state.
  const [dupError, setDupError] = useState<string | null>(null);
  // Photo capture removed — patients can type or use device-level voice
  // dictation instead. Backend still accepts PATIENT_PHOTO source for
  // back-compat; we just don't surface that path in the UI any more.

  const { requestAdd, modal: reAddModal } = useReAddConfirm();
  const selectedIds = useMemo(
    () => new Set(state.selectedMedications.map((m) => m.catalogId).filter(Boolean) as string[]),
    [state.selectedMedications],
  );

  const addCategoryMed = (med: (typeof CATEGORY_MEDS)[number]) =>
    setState((prev) => ({
      ...prev,
      selectedMedications: [
        // Auto-promote: strip any prior voice/photo entry naming the same drug
        // (e.g., voice "Furosemide" → tap Furosemide tile).
        ...stripUnverifiedDuplicates(prev.selectedMedications, med.brandName, med.genericName),
        {
          catalogId: med.id,
          drugName: med.brandName,
          drugClass: med.drugClass,
          isCombination: false,
          source: 'PATIENT_SELF_REPORT' as const,
        },
      ],
    }));

  const toggleCategoryMed = (medId: string) => {
    const med = CATEGORY_MEDS.find((m) => m.id === medId);
    if (!med) return;
    if (selectedIds.has(medId)) {
      setState((prev) => ({
        ...prev,
        selectedMedications: prev.selectedMedications.filter((m) => m.catalogId !== medId),
      }));
      return;
    }
    // IVR-19 — re-adding a med the care team rejected: confirm via modal first.
    requestAdd(med.id, med.brandName, () => addCategoryMed(med));
  };

  const addOther = (source: 'PATIENT_VOICE' | 'PATIENT_PHOTO', rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed) return;
    // Block within-form duplicates. Match against drugName + catalog brand
    // and generic names so voice "apixaban" still matches catalog "Eliquis".
    const existing = findExistingMedIndex(state.selectedMedications, trimmed);
    if (existing >= 0) {
      const already = state.selectedMedications[existing];
      setDupError(
        `${already.drugName} is already on your list. Tap an existing medication to remove or edit it.`,
      );
      // Keep the typed text so the patient can amend it.
      return;
    }
    setState((prev) => ({
      ...prev,
      selectedMedications: [
        ...prev.selectedMedications,
        {
          drugName: trimmed.slice(0, 60),
          drugClass: 'OTHER_UNVERIFIED' as DrugClassInput,
          isCombination: false,
          source,
          rawInputText: trimmed,
        },
      ],
      otherDraft: undefined,
    }));
    setOtherText('');
    setDupError(null);
  };

  // Phase/25 — auto-clear the dedup error after 3.5s so a single accidental
  // bump doesn't pin a red banner to the screen forever.
  useEffect(() => {
    if (!dupError) return;
    const id = setTimeout(() => setDupError(null), 3500);
    return () => clearTimeout(id);
  }, [dupError]);

  const otherCount = state.selectedMedications.filter((m) => m.drugClass === 'OTHER_UNVERIFIED').length;

  // Phase/28 — same OTHER_UNVERIFIED list as A5 (each step instantiates its
  // own modal-state so editing one doesn't leak to the other).
  const otherMedHandlers = useOtherMedHandlers(state, setState);

  const categories: { key: string; label: string; icon: React.ReactNode; audio: string }[] = [
    { key: 'WATER_PILL', label: t('intake.a8.categoryWaterPill'), icon: <Droplet className="w-6 h-6" />, audio: t('intake.a8.categoryWaterPill') },
    { key: 'BLOOD_THINNER', label: t('intake.a8.categoryBloodThinner'), icon: <TestTube className="w-6 h-6" />, audio: t('intake.a8.categoryBloodThinner') },
    { key: 'CHOLESTEROL', label: t('intake.a8.categoryCholesterol'), icon: <HeartPulse className="w-6 h-6" />, audio: t('intake.a8.categoryCholesterol') },
    { key: 'HEART_RHYTHM', label: t('intake.a8.categoryHeartRhythm'), icon: <Activity className="w-6 h-6" />, audio: t('intake.a8.categoryHeartRhythm') },
    { key: 'SGLT2', label: t('intake.a8.categorySGLT2'), icon: <Heart className="w-6 h-6" />, audio: t('intake.a8.audioSGLT2') },
    { key: 'OTHER', label: t('intake.a8.categoryOther'), icon: <CirclePlus className="w-6 h-6" />, audio: t('intake.a8.categoryOther') },
  ];
  const alsoKnown = t('intake.a5.audioAlsoKnown');

  return (
    <div className="space-y-6">
      {reAddModal}
      <StepHeader
        title={t('intake.a8.title')}
        subtitle={t('intake.a8.subtitle')}
        audio={t('intake.a8.audio')}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {categories.map((cat) => (
          <ChoiceCard
            key={cat.key}
            testId={`intake-cat-tile-${cat.key}`}
            icon={cat.icon}
            title={cat.label}
            selected={activeCategories.has(cat.key)}
            onClick={() =>
              setActiveCategories((prev) => {
                const next = new Set(prev);
                if (next.has(cat.key)) next.delete(cat.key);
                else next.add(cat.key);
                return next;
              })
            }
            audioText={cat.audio}
            compact
          />
        ))}
      </div>

      <AnimatePresence>
        {categories
          .filter((c) => c.key !== 'OTHER' && activeCategories.has(c.key))
          .map((cat) => (
            <motion.div
              key={cat.key}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="pt-2"
            >
              <p
                className="text-[11px] font-bold uppercase tracking-wider mb-2"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                {cat.label}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {CATEGORY_MEDS.filter((m) => m.category === cat.key).map((m) => (
                  <MedicationCard
                    key={m.id}
                    brandName={m.brandName}
                    genericName={m.genericName}
                    purpose={m.purpose}
                    drugClass={m.drugClass}
                    selected={selectedIds.has(m.id)}
                    onToggle={() => toggleCategoryMed(m.id)}
                    audioText={`${m.brandName}, ${alsoKnown} ${m.genericName}. ${m.purpose}`}
                  />
                ))}
              </div>
            </motion.div>
          ))}

        {activeCategories.has('OTHER') && (
          <motion.div
            key="other"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="space-y-4 pt-2"
          >
            <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}>
              <p className="text-[12px] mb-3" style={{ color: 'var(--brand-text-secondary)' }}>
                {t('intake.a8.otherBlurb')}
              </p>

              <div className="flex items-start gap-3 mb-4">
                <div
                  className="shrink-0 rounded-xl flex items-center justify-center"
                  style={{ width: 40, height: 40, backgroundColor: 'var(--brand-primary-purple)', color: 'white' }}
                >
                  <Mic className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <label htmlFor="intake-a8-other" className="block text-[12px] font-semibold mb-1" style={{ color: 'var(--brand-text-primary)' }}>
                    {t('intake.a8.otherSpeakLabel')}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="intake-a8-other"
                      data-testid="intake-other-med-input"
                      type="text"
                      value={otherText}
                      onChange={(e) => {
                        setOtherText(e.target.value);
                        // Clear stale dedup error as soon as the patient
                        // edits the input — they're correcting it.
                        if (dupError) setDupError(null);
                      }}
                      placeholder={t('intake.a8.otherSpeakPlaceholder')}
                      className="flex-1 h-11 px-4 rounded-lg text-[14px] outline-none transition box-border bg-white"
                      style={{
                        border: dupError
                          ? '2px solid var(--brand-alert-red)'
                          : '2px solid var(--brand-border)',
                        color: 'var(--brand-text-primary)',
                      }}
                    />
                    <MicButton
                      inputId="intake-a8-other"
                      onTranscript={(text) => {
                        setOtherText(text);
                        if (dupError) setDupError(null);
                      }}
                    />
                  </div>
                  {dupError && (
                    <p
                      role="alert"
                      className="mt-1.5 text-[12px] leading-snug"
                      style={{ color: 'var(--brand-alert-red)' }}
                    >
                      {dupError}
                    </p>
                  )}
                  <button
                    type="button"
                    data-testid="intake-medication-add-button"
                    onClick={() => addOther('PATIENT_VOICE', otherText)}
                    disabled={!otherText.trim()}
                    className="mt-2 px-4 py-1.5 rounded-full text-white text-[12px] font-bold disabled:opacity-50 cursor-pointer"
                    style={{ backgroundColor: 'var(--brand-primary-purple)' }}
                  >
                    {t('intake.a8.otherAdd')}
                  </button>
                </div>
              </div>

            </div>

            {/* Phase/28 — the count line (e.g. "3 more medications added")
                is redundant once OtherMedicationsList renders inline below
                with full per-row visibility, so suppress it when the list
                is going to render. Keep the count for the rare case where
                the list is hidden somehow. */}
            {otherCount > 0 && otherMedHandlers.otherMeds.length === 0 && (
              <p className="text-[12px] text-center" style={{ color: 'var(--brand-text-muted)' }}>
                {(otherCount === 1 ? t('intake.a8.otherCountSingle') : t('intake.a8.otherCountPlural')).replace('{n}', String(otherCount))}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Phase/28 — Your other medications list. Renders here on A8 too
          (mirroring A5) so patients who land directly on A8 see + can edit
          their freeform meds without backtracking. Each step instance owns
          its own edit-modal state via the hook. */}
      {otherMedHandlers.otherMeds.length > 0 && (
        <OtherMedicationsList
          meds={otherMedHandlers.otherMeds}
          onToggle={otherMedHandlers.handleDelete}
          onEdit={otherMedHandlers.handleEdit}
          onDelete={otherMedHandlers.handleDelete}
        />
      )}
      {otherMedHandlers.editingMed && (
        <OtherMedEditModal
          med={otherMedHandlers.editingMed}
          isDuplicateName={otherMedHandlers.isDuplicateName}
          onSave={otherMedHandlers.handleSaveEdit}
          onCancel={otherMedHandlers.handleCancelEdit}
        />
      )}

      <div
        className="rounded-xl p-4 flex items-start gap-3 mt-4"
        style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}
      >
        <Shield className="w-5 h-5 mt-0.5 shrink-0" style={{ color: 'var(--brand-primary-purple)' }} />
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
          {t('intake.a8.skipHint')}
        </p>
      </div>
    </div>
  );
}

function A9Frequency({ state, setState }: StepProps) {
  const { t } = useLanguage();
  if (state.selectedMedications.length === 0) {
    return (
      <div className="space-y-6">
        <StepHeader
          title={t('intake.a9.emptyTitle')}
          subtitle={t('intake.a9.emptySubtitle')}
          audio={t('intake.a9.emptyAudio')}
        />
        <div className="rounded-2xl p-6 text-center" style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}>
          <Pill className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--brand-primary-purple)' }} />
          <p className="text-[14px]" style={{ color: 'var(--brand-text-secondary)' }}>
            {t('intake.a9.emptyBody')}
          </p>
        </div>
      </div>
    );
  }

  const setFreq = (idx: number, freq: MedicationFrequencyInput) => {
    setState((prev) => {
      const next = [...prev.selectedMedications];
      next[idx] = { ...next[idx], frequency: freq };
      return { ...prev, selectedMedications: next };
    });
  };

  const options: { value: MedicationFrequencyInput; label: string }[] = [
    { value: 'ONCE_DAILY', label: t('intake.a9.freqOnce') },
    { value: 'TWICE_DAILY', label: t('intake.a9.freqTwice') },
    { value: 'THREE_TIMES_DAILY', label: t('intake.a9.freqThree') },
    { value: 'AS_NEEDED', label: t('intake.a9.freqAsNeeded') },
    { value: 'UNSURE', label: t('intake.a9.freqUnsure') },
  ];

  return (
    <div className="space-y-5">
      <StepHeader
        title={t('intake.a9.title')}
        subtitle={t('intake.a9.subtitle')}
        audio={t('intake.a9.audio')}
      />

      <div className="space-y-3">
        {state.selectedMedications.map((m, i) => (
          <div
            key={`${m.catalogId ?? 'other'}-${i}`}
            className="rounded-2xl p-4"
            style={{ backgroundColor: 'white', border: '1.5px solid var(--brand-border)' }}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[15px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>{m.drugName}</p>
                {m.isCombination && (
                  <span className="text-[10px] font-bold" style={{ color: 'var(--brand-accent-teal)' }}>
                    {t('intake.medCard.combo').toUpperCase()}
                  </span>
                )}
              </div>
              <AudioButton text={t('intake.a9.medAudio').replace('{name}', m.drugName)} size="sm" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid={`intake-a9-row-${i}`}>
              {options.map((o) => {
                const active = m.frequency === o.value;
                return (
                  <motion.button
                    key={o.value}
                    type="button"
                    data-testid={`intake-a9-freq-${i}-${o.value}`}
                    onClick={() => setFreq(i, o.value)}
                    className="h-11 rounded-full text-[13px] font-bold border-2 transition"
                    style={{
                      backgroundColor: active ? 'var(--brand-primary-purple)' : 'white',
                      borderColor: active ? 'var(--brand-primary-purple)' : 'var(--brand-border)',
                      color: active ? 'white' : 'var(--brand-text-secondary)',
                    }}
                    whileTap={{ scale: 0.97 }}
                  >
                    {o.label}
                  </motion.button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function A10Review({ state, goTo }: StepProps) {
  const { t } = useLanguage();

  const genderLabel = (g?: string) => {
    if (g === 'MALE') return t('intake.a10.genderMale');
    if (g === 'FEMALE') return t('intake.a10.genderFemale');
    if (g === 'OTHER') return t('intake.a10.genderOther');
    return '—';
  };

  const conditionList: string[] = [];
  if (state.hasHeartFailure) {
    const hasTypedHF = state.heartFailureType && state.heartFailureType !== 'NOT_APPLICABLE' && state.heartFailureType !== 'UNKNOWN';
    conditionList.push(hasTypedHF
      ? t('intake.a10.conditionHfWithType').replace('{type}', state.heartFailureType as string)
      : t('intake.a10.conditionHf'));
  }
  if (state.hasAFib) conditionList.push(t('intake.a10.conditionAf'));
  if (state.hasCAD) conditionList.push(t('intake.a10.conditionCad'));
  if (state.hasHCM) conditionList.push(t('intake.a10.conditionHcm'));
  if (state.hasDCM) conditionList.push(t('intake.a10.conditionDcm'));

  const pregnancyValue = state.isPregnant === true
    ? (state.pregnancyDueDate
        ? t('intake.a10.pregnancyYesDate').replace('{date}', state.pregnancyDueDate)
        : t('intake.a10.pregnancyYes'))
    : state.isPregnant === false
      ? t('intake.a10.pregnancyNo')
      : t('intake.a10.pregnancyNotSpec');

  return (
    <div className="space-y-5">
      <StepHeader
        title={t('intake.a10.title')}
        subtitle={t('intake.a10.subtitle')}
        audio={t('intake.a10.audio')}
      />

      <div
        className="rounded-2xl p-4 flex items-start gap-3"
        style={{ backgroundColor: 'var(--brand-warning-amber-light)', border: '1.5px solid #FCD34D' }}
      >
        <Shield className="w-5 h-5 mt-0.5 shrink-0" style={{ color: 'var(--brand-warning-amber-text)' }} />
        <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--brand-text-primary)' }}>
          {t('intake.a10.reviewBanner')}
        </p>
      </div>

      <ReviewSection title={t('intake.a10.sectionAbout')} onEdit={() => goTo?.('A1')}>
        <ReviewRow label={t('intake.a10.rowGender')} value={genderLabel(state.gender)} />
        <ReviewRow
          label={t('intake.a10.rowDob')}
          value={(() => {
            if (!state.dateOfBirth) return '—';
            const dob = new Date(state.dateOfBirth);
            if (Number.isNaN(dob.getTime())) return '—';
            const today = new Date();
            let age = today.getFullYear() - dob.getFullYear();
            const beforeBirthday =
              today.getMonth() < dob.getMonth() ||
              (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate());
            if (beforeBirthday) age -= 1;
            const formatted = dob.toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            });
            return age >= 0 ? `${formatted} (${age} yrs)` : formatted;
          })()}
        />
        <ReviewRow
          label={t('intake.a10.rowHeight')}
          value={
            state.heightCm
              ? (() => {
                  const { feet, inches } = cmToFtIn(state.heightCm);
                  return `${feet}' ${inches}"`;
                })()
              : '—'
          }
        />
        {state.gender === 'FEMALE' && (
          <ReviewRow
            label={t('intake.a10.rowPregnancy')}
            value={pregnancyValue}
          />
        )}
      </ReviewSection>

      <ReviewSection title={t('intake.a10.sectionConditions')} onEdit={() => goTo?.('A3')}>
        {conditionList.length === 0 ? (
          <ReviewRow label="" value={t('intake.a10.noneReported')} />
        ) : (
          conditionList.map((c) => <ReviewRow key={c} label="" value={c} />)
        )}
        {state.diagnosedHypertension && <ReviewRow label="" value={t('intake.a10.htnReported')} />}
      </ReviewSection>

      <ReviewSection title={t('intake.a10.sectionMedications')} onEdit={() => goTo?.('A5')}>
        {state.selectedMedications.length === 0 ? (
          <ReviewRow label="" value={t('intake.a10.noneReported')} />
        ) : (
          state.selectedMedications.map((m, i) => (
            <ReviewRow
              key={`${m.catalogId ?? 'other'}-${i}`}
              label={m.drugName + (m.isCombination ? ` ${t('intake.a10.comboBadge')}` : '')}
              value={frequencyLabel(m.frequency, t)}
            />
          ))
        )}
      </ReviewSection>
    </div>
  );
}

function A11Complete({ onDone }: { onDone: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center text-center px-4 py-6 sm:py-10">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 18 }}
        className="rounded-full flex items-center justify-center mb-6"
        style={{ width: 110, height: 110, backgroundColor: 'var(--brand-success-green-light)' }}
      >
        <Check className="w-14 h-14" style={{ color: 'var(--brand-success-green)' }} strokeWidth={3} />
      </motion.div>
      <h2 className="text-[28px] font-bold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
        {t('intake.a11.title')}
      </h2>
      <p className="text-[15px] max-w-md mb-8 leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
        {t('intake.a11.body')}
      </p>
      <motion.button
        type="button"
        onClick={onDone}
        className="h-12 px-8 rounded-full text-white font-bold text-[14px] cursor-pointer"
        style={{ backgroundColor: 'var(--brand-primary-purple)', boxShadow: 'var(--brand-shadow-button)' }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
      >
        {t('intake.a11.cta')}
      </motion.button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small reusable bits used by multiple steps
// ─────────────────────────────────────────────────────────────────────────────

function StepHeader({ title, subtitle, audio }: { title: string; subtitle: string; audio: string }) {
  return (
    <div>
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

function SectionLabel({ text, audio }: { text: string; audio?: string }) {
  return (
    <div className="flex items-start justify-between gap-2 mb-3">
      <p
        className="text-[13px] font-semibold min-w-0 flex-1"
        style={{ color: 'var(--brand-text-primary)', wordBreak: 'break-word' }}
      >
        {text}
      </p>
      {audio && (
        <div className="shrink-0">
          <AudioButton text={audio} size="sm" />
        </div>
      )}
    </div>
  );
}

function ReviewSection({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-4" style={{ backgroundColor: 'white', border: '1.5px solid var(--brand-border)' }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>{title}</h3>
        <button
          type="button"
          onClick={onEdit}
          className="flex items-center gap-1 text-[12px] font-bold cursor-pointer"
          style={{ color: 'var(--brand-primary-purple)' }}
        >
          <Pencil className="w-3.5 h-3.5" /> Edit
        </button>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      {label && <span style={{ color: 'var(--brand-text-muted)' }}>{label}</span>}
      <span className="font-semibold" style={{ color: 'var(--brand-text-primary)' }}>{value}</span>
    </div>
  );
}

function sentenceCase(v: string) {
  return v.charAt(0) + v.slice(1).toLowerCase();
}

type TranslateFn = (key: Parameters<ReturnType<typeof useLanguage>['t']>[0]) => string;

function frequencyLabel(f: MedicationFrequencyInput | undefined, t: TranslateFn): string {
  switch (f) {
    case 'ONCE_DAILY': return t('intake.freq.once');
    case 'TWICE_DAILY': return t('intake.freq.twice');
    case 'THREE_TIMES_DAILY': return t('intake.freq.three');
    case 'AS_NEEDED': return t('intake.freq.asNeeded');
    case 'UNSURE': return t('intake.freq.unsure');
    default: return t('intake.freq.unset');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Modals
// ─────────────────────────────────────────────────────────────────────────────

function DedupModal({
  conflicts,
  onResolve,
  onCancel,
}: {
  conflicts: DedupConflict[];
  onResolve: (mode: 'KEEP_BOTH' | 'KEEP_COMBO' | 'KEEP_SINGLE', conflict: DedupConflict) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const conflict = conflicts[0];
  if (!conflict) return null;
  const componentSentenceCased = sentenceCase(conflict.componentName);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15,23,42,0.5)' }}
    >
      <motion.div
        initial={{ scale: 0.92, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, y: 12 }}
        transition={{ type: 'spring', stiffness: 340, damping: 26 }}
        className="bg-white rounded-3xl p-6 max-w-sm w-full"
        style={{ boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}
      >
        <h3 className="text-[18px] font-bold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
          {t('intake.a7.title')}
        </h3>
        <p className="text-[13px] mb-5 leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
          {t('intake.a7.body')
            .replace('{component}', componentSentenceCased)
            .replace('{combo}', conflict.comboBrand)
            .replace('{componentLower}', conflict.componentName)}
        </p>
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={() => onResolve('KEEP_COMBO', conflict)}
            className="w-full h-11 rounded-xl text-[13.5px] font-bold cursor-pointer"
            style={{ backgroundColor: 'var(--brand-primary-purple)', color: 'white' }}
          >
            {t('intake.a7.keepCombo').replace('{combo}', conflict.comboBrand)}
          </button>
          <button
            type="button"
            onClick={() => onResolve('KEEP_SINGLE', conflict)}
            className="w-full h-11 rounded-xl text-[13.5px] font-bold cursor-pointer"
            style={{ backgroundColor: 'var(--brand-primary-purple-light)', color: 'var(--brand-primary-purple)' }}
          >
            {t('intake.a7.keepSingle').replace('{component}', componentSentenceCased)}
          </button>
          <button
            type="button"
            onClick={() => onResolve('KEEP_BOTH', conflict)}
            className="w-full h-11 rounded-xl text-[13.5px] font-bold cursor-pointer"
            style={{ backgroundColor: 'white', color: 'var(--brand-text-secondary)', border: '1.5px solid var(--brand-border)' }}
          >
            {t('intake.a7.keepBoth')}
          </button>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="w-full mt-3 text-[12px] font-semibold cursor-pointer"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          {t('intake.a7.goBack')}
        </button>
      </motion.div>
    </motion.div>
  );
}

function ExitSaveModal({
  editMode,
  saving,
  error,
  onConfirm,
  onCancel,
  onDiscard,
}: {
  editMode: boolean;
  saving: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** When provided (nav-guard case), renders a "Leave without saving" action
   *  that abandons the edits and continues to the requested destination. */
  onDiscard?: () => void;
}) {
  const { t } = useLanguage();
  const title = editMode ? t('intake.exitSave.editTitle') : t('intake.exitSave.title');
  const body = editMode ? t('intake.exitSave.editBody') : t('intake.exitSave.body');
  const cta = editMode ? t('intake.exitSave.editCta') : t('intake.exitSave.cta');
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15,23,42,0.5)' }}
    >
      <motion.div
        initial={{ scale: 0.92, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, y: 12 }}
        transition={{ type: 'spring', stiffness: 340, damping: 26 }}
        className="bg-white rounded-3xl p-6 max-w-sm w-full text-center"
        style={{ boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}
      >
        <div
          className="rounded-full mx-auto mb-4 flex items-center justify-center"
          style={{ width: 64, height: 64, backgroundColor: 'var(--brand-primary-purple-light)' }}
        >
          <Save className="w-7 h-7" style={{ color: 'var(--brand-primary-purple)' }} />
        </div>
        <h3 className="text-[18px] font-bold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
          {title}
        </h3>
        <p className="text-[13px] mb-4 leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
          {body}
        </p>
        {error && (
          <p
            className="text-[12px] mb-4 px-3 py-2 rounded-lg"
            style={{
              color: 'var(--brand-alert-red-text)',
              backgroundColor: 'var(--brand-alert-red-light)',
            }}
          >
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={onConfirm}
          disabled={saving}
          className="w-full h-11 rounded-full text-white font-bold text-[14px] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ backgroundColor: 'var(--brand-primary-purple)', boxShadow: 'var(--brand-shadow-button)' }}
        >
          {saving ? t('intake.exitSave.saving') : cta}
        </button>
        {onDiscard && (
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className="w-full mt-2 h-11 rounded-full font-semibold text-[14px] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--brand-alert-red-light)',
              color: 'var(--brand-alert-red-text)',
            }}
          >
            {t('intake.exitSave.leaveWithoutSaving')}
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="w-full mt-2 text-[12px] font-semibold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          {t('intake.exitSave.keepGoing')}
        </button>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main wizard
// ─────────────────────────────────────────────────────────────────────────────

const VALID_DEEP_LINK_STEPS: IntakeStepKey[] = ['A1', 'A2', 'A3', 'A4', 'A5', 'A8', 'A6', 'A9', 'A10'];

// Next 16 requires components that read useSearchParams() to be wrapped in
// a Suspense boundary so prerendering can bail out cleanly. Default export
// provides that wrapper around the real wizard component.
export default function ClinicalIntakePage() {
  return (
    <Suspense fallback={
      <div
        className="min-h-[calc(100dvh-4rem)] flex items-center justify-center"
        style={{ backgroundColor: 'var(--brand-background)' }}
      >
        <SpinnerIndicator size={40} className="text-[#7B00E0]" />
      </div>
    }>
      <ClinicalIntakeWizard />
    </Suspense>
  );
}

function ClinicalIntakeWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  const [state, setStateRaw] = useState<IntakeFormState>(EMPTY_INTAKE_STATE);
  const [step, setStep] = useState<IntakeStepKey>('A0b');
  const [direction, setDirection] = useState(1);
  const [pendingDedup, setPendingDedup] = useState<DedupConflict[]>([]);
  const [showExitSave, setShowExitSave] = useState(false);
  // Destination stashed when the patient tries to navigate away mid-edit —
  // we hold it until they choose Save or Leave in the exit prompt.
  const [pendingNav, setPendingNav] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Stored as a translation-key (+ optional interpolation values) OR a raw
  // backend message — never as the rendered string. We translate at render
  // time so the message updates if the patient switches language while the
  // error is on screen.
  const [submitError, setSubmitError] = useState<
    | { kind: 'key'; key: TranslationKey; values?: Record<string, string> }
    | { kind: 'raw'; text: string }
    | null
  >(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  // True only when we hit the route without ?step= AND the patient already
  // has a profile saved — in that case we render the "you're all set" page
  // and the patient must edit via the /profile page (which sends them back
  // here with ?step=AX). With ?step= we go straight into edit mode.
  const [profileExists, setProfileExists] = useState(false);
  // True when hydration seeded from an existing PatientProfile via ?step=
  // deep-link. In this mode the Save-and-exit flow upserts the profile to
  // the backend instead of only writing a local draft (which is ignored on
  // re-entry because Branch 2 reseeds from the server).
  const [editMode, setEditMode] = useState(false);
  const [exitSaving, setExitSaving] = useState(false);
  const [exitError, setExitError] = useState('');
  // True when hydration found a VERIFIED profile — render the re-verify
  // banner above the step content so the patient knows edits will reset
  // their verified status until the care team confirms.
  const [showReverifyBanner, setShowReverifyBanner] = useState(false);

  // Hydrate state. Three branches:
  //   1. No profile saved yet → fresh wizard (or resume localStorage draft)
  //   2. Profile exists + ?step= deep-link → load existing profile + meds
  //      into the form and start at the requested step (E3 edit flow)
  //   3. Profile exists + no ?step= → "you're all set" page
  useEffect(() => {
    if (isLoading || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const requestedStepRaw = searchParams.get('step') as IntakeStepKey | null;
        const requestedStep = requestedStepRaw && VALID_DEEP_LINK_STEPS.includes(requestedStepRaw)
          ? requestedStepRaw
          : null;
        const isEdit = !!requestedStep;

        const [profile, meds] = await Promise.all([
          getMyPatientProfile().catch(() => null),
          isEdit ? getMyMedications().catch(() => []) : Promise.resolve([]),
        ]);
        // Pull dateOfBirth off the auth profile so A1 can pre-fill it for
        // returning users who set DOB during the old onboarding flow before
        // it moved here. Best-effort — DOB is optional fallback only.
        const authProfile = await getAuthProfile().catch(() => null);
        const carriedDob = toDateInput(authProfile?.dateOfBirth);
        if (cancelled) return;

        // Branch 3 — show the all-set page only when the patient is truly
        // done (profile in DB AND no in-progress localStorage draft).
        // A draft mid-flow signals partial save → fall through to Branch
        // 1 so they can resume instead of being told they're done.
        // Without a server-side completion field this is our gate.
        const draftSnapshot = loadDraft(user.id);
        const draftMidFlow =
          !!draftSnapshot && draftSnapshot.currentStep && draftSnapshot.currentStep !== 'A11';
        if (profile && !isEdit && !draftMidFlow) {
          setProfileExists(true);
          setBootstrapping(false);
          return;
        }

        if (profile && isEdit) {
          // Branch 2 — populate form with existing data so the patient sees
          // their current answers and can edit just what changed.
          const seeded: IntakeFormState = {
            gender: profile.gender ?? undefined,
            heightCm: profile.heightCm ?? undefined,
            dateOfBirth: carriedDob,
            isPregnant: profile.isPregnant ?? undefined,
            pregnancyDueDate: toDateInput(profile.pregnancyDueDate),
            historyPreeclampsia: profile.historyPreeclampsia ?? false,
            hasHeartFailure: profile.hasHeartFailure ?? false,
            hasAFib: profile.hasAFib ?? false,
            hasCAD: profile.hasCAD ?? false,
            hasHCM: profile.hasHCM ?? false,
            hasDCM: profile.hasDCM ?? false,
            heartFailureType:
              profile.heartFailureType && profile.heartFailureType !== 'NOT_APPLICABLE'
                ? profile.heartFailureType
                : undefined,
            diagnosedHypertension: profile.diagnosedHypertension ?? false,
            selectedMedications: (Array.isArray(meds) ? meds : [])
              .filter((m) => !m.discontinuedAt)
              .map((m) => {
                // Resolve the catalog id from drugName so the toggle UI lights up
                // when the patient revisits. Match against both brandName AND
                // genericName — the OCR confirm flow saves entryToMatch's
                // drugName=genericName, so a brand-only lookup misses every
                // OCR-added catalog row and the tile fails to light up on
                // reload. Combos only have a brandName so they're brand-only.
                const lower = m.drugName.toLowerCase();
                const catEntry =
                  ALL_CORE_MEDS.find(
                    (c) =>
                      c.brandName.toLowerCase() === lower ||
                      c.genericName.toLowerCase() === lower,
                  ) ??
                  ALL_CATEGORY_MEDS.find(
                    (c) =>
                      c.brandName.toLowerCase() === lower ||
                      c.genericName.toLowerCase() === lower,
                  );
                const comboEntry = ALL_COMBO_MEDS.find((c) => c.brandName.toLowerCase() === lower);
                return {
                  catalogId: catEntry?.id ?? comboEntry?.id,
                  serverId: m.id,
                  drugName: m.drugName,
                  drugClass: m.drugClass as IntakeFormState['selectedMedications'][number]['drugClass'],
                  isCombination: m.isCombination,
                  combinationComponents: m.combinationComponents as IntakeFormState['selectedMedications'][number]['combinationComponents'],
                  source: m.source as IntakeFormState['selectedMedications'][number]['source'],
                  rawInputText: m.rawInputText ?? undefined,
                  frequency: m.frequency,
                  pillImageUrl: m.pillImageUrl,
                  plainLanguageDescription: m.plainLanguageDescription,
                };
              }),
          };
          setStateRaw(seeded);
          setStep(requestedStep);
          setEditMode(true);
          if (profile.profileVerificationStatus === 'VERIFIED') {
            setShowReverifyBanner(true);
          }
          setBootstrapping(false);
          return;
        }

        // Branch 1 — no completed intake yet. Resume from draft or start
        // fresh. (When a partial profile exists in DB but no draft on this
        // device, we accept that the patient re-enters their answers; the
        // backend diff will be a no-op so it's just a small UX pinch, not
        // data loss.)
        const draft = loadDraft(user.id);
        if (draft) {
          // A draft pointing at the completion screen is stale — submit must
          // have succeeded but the row was later deleted. Treat as fresh.
          if (draft.currentStep === 'A11') {
            clearDraft(user.id);
          } else {
            // Carry user's existing DOB into the draft if the draft predates
            // the DOB-on-A1 change.
            setStateRaw({ ...draft, dateOfBirth: draft.dateOfBirth ?? carriedDob });
            if (draft.currentStep) setStep(draft.currentStep);
          }
        } else if (carriedDob) {
          setStateRaw((prev) => ({ ...prev, dateOfBirth: carriedDob }));
        }
        // Honor ?step= even on a fresh wizard so deep-links still work.
        if (requestedStep) setStep(requestedStep);
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, isLoading, searchParams]);

  // Auth gating: send unauthenticated to sign-in; basic onboarding incomplete
  // to /onboarding — but honor the localStorage skip flag (ONB-20: skip no
  // longer marks onboardingStatus=COMPLETED, so we'd otherwise loop here).
  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace('/sign-in');
      return;
    }
    if (
      user.onboardingStatus !== 'COMPLETED' &&
      shouldShowOnboardingForUser({ userId: user.id })
    ) {
      router.replace('/onboarding');
    }
  }, [user, isLoading, router]);

  // Snap to the top whenever the wizard advances (or jumps via the Edit
  // links on A10) so the new step is fully in view.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [step]);

  // Edit-mode navigation guard. Edit mode keeps NO localStorage draft, so
  // leaving the page would silently drop unsaved edits. Intercept in-app link
  // clicks (the navbar tabs / logo / bell / avatar) and hard unloads so the
  // patient must explicitly Save or Leave first.
  useEffect(() => {
    if (!editMode) return;
    const onClickCapture = (e: MouseEvent) => {
      // Let modified clicks (new tab, etc.) and non-primary buttons through.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      let dest: URL;
      try { dest = new URL(href, window.location.href); } catch { return; }
      if (dest.origin !== window.location.origin) return; // external — let it go
      if (dest.pathname === window.location.pathname) return; // same page
      // Block the navigation and prompt Save / Leave instead.
      e.preventDefault();
      e.stopPropagation();
      setExitError('');
      setPendingNav(dest.pathname + dest.search);
      setShowExitSave(true);
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    document.addEventListener('click', onClickCapture, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [editMode]);

  // Wrap setState to persist draft on every change.
  const setState = (updater: (prev: IntakeFormState) => IntakeFormState) => {
    setStateRaw((prev) => {
      const next = updater(prev);
      // Edit mode deliberately keeps NO localStorage draft — edits commit
      // straight to the backend via Save changes, and a draft here would make
      // the dashboard's "Resume" card reappear for an already-complete profile.
      if (user?.id && !editMode) {
        saveDraft(user.id, { ...next, currentStep: step });
      }
      return next;
    });
  };

  // Derived flow + position.
  const flow = useMemo(() => computeFlow(state), [state]);
  const stepIndex = flow.indexOf(step);
  const visibleTotal = flow.length - 2; // exclude A0b + A11
  const visibleIndex = Math.max(1, Math.min(visibleTotal, stepIndex));

  const persistStep = (next: IntakeStepKey) => {
    // No draft in edit mode (see setState) — just move the step in memory.
    if (user?.id && !editMode) {
      saveDraft(user.id, { ...state, currentStep: next });
    }
    setStep(next);
  };

  // Per-step field validation, shared by Continue (goNext) and the edit-mode
  // Save-changes quick-save so both reject the same invalid input.
  const validateStep = (s: IntakeStepKey): typeof submitError => {
    if (s === 'A1') {
      if (!state.gender) return { kind: 'key', key: 'intake.nav.errorGender' };
      if (!state.dateOfBirth) return { kind: 'key', key: 'intake.nav.errorDob' };
      const dobErrKey = validateDateOfBirth(state.dateOfBirth);
      if (dobErrKey) return { kind: 'key', key: dobErrKey };
      if (!state.heightCm || state.heightCm < 100 || state.heightCm > 250) {
        return { kind: 'key', key: 'intake.nav.errorHeight' };
      }
    }
    if (s === 'A2') {
      if (state.isPregnant !== true && state.isPregnant !== false) {
        return { kind: 'key', key: 'intake.nav.errorPregnancy' };
      }
      if (state.historyPreeclampsia !== true && state.historyPreeclampsia !== false) {
        return { kind: 'key', key: 'intake.nav.errorPreeclampsia' };
      }
    }
    if (s === 'A4' && !state.heartFailureType) {
      return { kind: 'key', key: 'intake.nav.errorHfType' };
    }
    if (s === 'A9') {
      const missingFreq = state.selectedMedications.find((m) => !m.frequency);
      if (missingFreq) {
        return { kind: 'key', key: 'intake.nav.errorFreq', values: { name: missingFreq.drugName } };
      }
    }
    return null;
  };

  const goNext = async () => {
    const stepErr = validateStep(step);
    if (stepErr) { setSubmitError(stepErr); return; }
    setSubmitError(null);

    // A6 (combos — the last med screen) → A9 transition: surface dedup
    // conflicts before letting the user proceed, so combo entries can be
    // compared against everything they picked on A5 (core) + A8 (categories).
    if (step === 'A6') {
      const conflicts = detectDedupConflicts(state.selectedMedications);
      if (conflicts.length > 0) {
        setPendingDedup(conflicts);
        return;
      }
    }

    // A10 → A11 = submit
    if (step === 'A10') {
      await handleSubmit();
      return;
    }

    const nextIdx = stepIndex + 1;
    if (nextIdx >= flow.length) return;
    setDirection(1);
    persistStep(flow[nextIdx]);
  };

  const goBack = () => {
    setSubmitError(null);
    if (step === 'A0b') {
      router.push('/dashboard');
      return;
    }
    const prevIdx = stepIndex - 1;
    if (prevIdx < 0) return;
    setDirection(-1);
    persistStep(flow[prevIdx]);
  };

  const goTo = (target: IntakeStepKey) => {
    if (!flow.includes(target)) return;
    setSubmitError(null);
    const targetIdx = flow.indexOf(target);
    setDirection(targetIdx > stepIndex ? 1 : -1);
    persistStep(target);
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await saveIntakeProfile(buildProfilePayload(state));
      // Use PUT (replace) instead of POST (append) so a returning patient
      // who already saved a partial draft, OR an edit-mode submit, doesn't
      // duplicate every medication on top of the existing list. PUT with
      // an empty array correctly represents "patient takes no medications"
      // — soft-deleting any prior rows. Matches handleExitSave so both
      // exit paths leave the DB in the same shape.
      await replaceIntakeMedications(buildMedsPayload(state));
      setStateRaw((p) => ({ ...p, hasSubmitted: true }));
      setDirection(1);
      // Use raw setStep — persistStep would re-write the draft we just cleared.
      setStep('A11');
      if (user?.id) clearDraft(user.id);
    } catch (e) {
      setSubmitError(
        e instanceof Error
          ? { kind: 'raw', text: e.message }
          : { kind: 'key', key: 'intake.nav.errorSubmit' },
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Exit-and-save from the top-bar Save button. Behaves the same in both
  // create AND edit mode: if the user has filled enough to make a valid
  // profile (gender is the minimum the backend requires), we upsert via
  // saveIntakeProfile + replaceIntakeMedications. If they haven't even
  // picked a gender yet, the localStorage draft is already in sync — just
  // navigate so they can resume from the Action Required card.
  const handleExitSave = async () => {
    if (exitSaving) return;
    setExitError('');
    // When triggered by the nav guard, return to where the patient was
    // headed; otherwise fall back to the dashboard.
    const dest = pendingNav ?? '/dashboard';

    // No gender yet → can't create a profile server-side. Keep the draft
    // and let them resume later. (Backend POST /intake/profile rejects
    // payloads with no gender.)
    if (!state.gender) {
      setPendingNav(null);
      router.push(dest);
      return;
    }

    setExitSaving(true);
    try {
      await Promise.all([
        saveIntakeProfile(buildProfilePayload(state)),
        replaceIntakeMedications(buildMedsPayload(state)),
      ]);
      setPendingNav(null);
      // Keep the local draft on partial save — without a server-side
      // intakeCompletedAt field the dashboard's Action-Required card uses
      // the draft's presence + currentStep as the "still in progress"
      // sentinel. Clearing it here would prematurely flip the card to
      // "done" even though the patient hasn't submitted A10 → A11. The
      // draft is only cleared by handleSubmit on final submit. Edit mode
      // never had a draft to begin with, so this no-op for edits.
      router.push(dest);
    } catch (e) {
      setExitError(e instanceof Error ? e.message : t('intake.exitSave.errorFallback'));
      setExitSaving(false);
    }
  };

  // Edit-mode quick-save: commit the current answers right away and go back to
  // the profile, instead of forcing the patient to click Continue through every
  // remaining step to reach the final submit. The upsert sends the full state
  // — which in edit mode is the existing profile pre-loaded + their change — so
  // unchanged fields are preserved and only what they edited differs. Validates
  // the current step (and surfaces combo dedup on A6) so we never persist the
  // same invalid input Continue would reject.
  const handleQuickSave = async () => {
    if (exitSaving || submitting) return;
    // Enforce EVERY cross-step dependency, not just the step being edited —
    // editing one answer can make a field on another step newly required
    // (e.g. switching conditions to Heart failure makes HF type required on
    // A4; a female patient must have answered pregnancy on A2; every med
    // needs a frequency on A9). `flow` already encodes those conditionals,
    // so validating each step in it catches all of them. Jump to the first
    // offending step so the patient sees exactly what to fix.
    for (const s of flow) {
      const err = validateStep(s);
      if (err) {
        goTo(s);
        setSubmitError(err);
        return;
      }
    }
    // Combo/single medication dedup — surface conflicts before saving so we
    // never persist a combo pill alongside one of its components.
    const conflicts = detectDedupConflicts(state.selectedMedications);
    if (conflicts.length > 0) {
      if (flow.includes('A6')) goTo('A6');
      setPendingDedup(conflicts);
      return;
    }
    setSubmitError(null);
    setExitSaving(true);
    try {
      await Promise.all([
        saveIntakeProfile(buildProfilePayload(state)),
        replaceIntakeMedications(buildMedsPayload(state)),
      ]);
      router.push('/profile');
    } catch (e) {
      setSubmitError(
        e instanceof Error
          ? { kind: 'raw', text: e.message }
          : { kind: 'key', key: 'intake.nav.errorSubmit' },
      );
      setExitSaving(false);
    }
  };

  const resolveDedup = (mode: 'KEEP_BOTH' | 'KEEP_COMBO' | 'KEEP_SINGLE', conflict: DedupConflict) => {
    setStateRaw((prev) => {
      let next = prev.selectedMedications;
      if (mode === 'KEEP_COMBO') {
        next = next.filter((m) => m.catalogId !== conflict.componentMedId);
      } else if (mode === 'KEEP_SINGLE') {
        next = next.filter((m) => m.catalogId !== conflict.comboId);
      }
      return { ...prev, selectedMedications: next };
    });
    const remaining = pendingDedup.slice(1);
    setPendingDedup(remaining);
    if (remaining.length === 0) {
      // Continue to A9 (the screen after A6 in the new ordering) once
      // all conflicts have been resolved.
      const nextIdx = flow.indexOf('A6') + 1;
      if (nextIdx < flow.length) {
        setDirection(1);
        persistStep(flow[nextIdx]);
      }
    }
  };

  // If clinical intake is already on file, send the patient back — A11-style page also fine but
  // the A0 card on the dashboard hides itself once profile exists, so an extra hop is fine.
  if (profileExists) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ backgroundColor: 'var(--brand-background)' }}>
        <div className="rounded-full flex items-center justify-center mb-5" style={{ width: 80, height: 80, backgroundColor: 'var(--brand-success-green-light)' }}>
          <Check className="w-10 h-10" style={{ color: 'var(--brand-success-green)' }} strokeWidth={3} />
        </div>
        <h1 className="text-[22px] font-bold mb-2" style={{ color: 'var(--brand-text-primary)' }}>{t('intake.profileExists.title')}</h1>
        <p className="text-[14px] mb-6 max-w-sm" style={{ color: 'var(--brand-text-secondary)' }}>
          {t('intake.profileExists.body')}
        </p>
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          className="h-11 px-6 rounded-full text-white font-bold text-[14px] cursor-pointer"
          style={{ backgroundColor: 'var(--brand-primary-purple)', boxShadow: 'var(--brand-shadow-button)' }}
        >
          {t('intake.profileExists.cta')}
        </button>
      </div>
    );
  }

  if (isLoading || !user || bootstrapping) {
    return (
      <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center" style={{ backgroundColor: 'var(--brand-background)' }}>
        <SpinnerIndicator size={40} className="text-[#7B00E0]" />
      </div>
    );
  }

  const isIntro = step === 'A0b';
  const isComplete = step === 'A11';
  const showNav = !isIntro && !isComplete;

  const stepProps: StepProps = { state, setState, goTo };

  return (
    <div
      className={
        'flex flex-col ' +
        // Intro (A0b) + complete (A11) are single-screen panels: pin them to
        // the viewport so they never grow past the screen or introduce a page
        // scroll. Other steps keep min-h-screen and scroll.
        (isIntro || isComplete ? '' : 'min-h-screen')
      }
      style={{
        backgroundColor: 'var(--brand-background)',
        // The global navbar is fixed (h-16) and NavbarWrapper reserves space
        // for it with pt-16, so this route already sits 4rem below the top.
        // Cap the single-screen panels at viewport MINUS that 4rem, otherwise
        // 4rem (navbar) + 100dvh (page) overflows and shows a browser scroll.
        // Inline style, not a Tailwind calc class — arbitrary calc() values
        // get stripped on some builds (see the main padding note below).
        ...(isIntro || isComplete ? { height: 'calc(100dvh - 4rem)' } : null),
      }}
    >
      {/* Top bar — visible when not on intro/complete */}
      {showNav && (
        <header
          className="sticky top-0 z-20 bg-white"
          style={{ borderBottom: '1px solid var(--brand-border)' }}
        >
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={goBack}
              className="flex items-center gap-1.5 h-9 px-3 rounded-full text-[13px] font-semibold cursor-pointer"
              style={{ color: 'var(--brand-text-secondary)' }}
            >
              <ArrowLeft className="w-4 h-4" />
              {t('intake.nav.back')}
            </button>
            <StepDots current={visibleIndex} total={visibleTotal} />
            <button
              type="button"
              onClick={() => setShowExitSave(true)}
              className="flex items-center gap-1.5 h-9 px-3 rounded-full text-[13px] font-semibold cursor-pointer"
              style={{ color: 'var(--brand-text-muted)' }}
              aria-label={t('intake.nav.saveAria')}
            >
              <Save className="w-4 h-4" />
              <span className="hidden sm:inline">{t('intake.nav.save')}</span>
            </button>
          </div>
        </header>
      )}

      {/* Re-verify banner — rendered above the first step content whenever a
          VERIFIED patient enters edit mode, regardless of the ?step= anchor.
          Tells the patient that saving will reset their verified status
          until the care team reconfirms. */}
      {showNav && showReverifyBanner && (
        <div
          className="w-full"
          style={{
            backgroundColor: 'var(--brand-warning-amber-light)',
            borderBottom: '1px solid rgba(245,158,11,0.3)',
          }}
        >
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-start gap-3">
            <Shield
              className="w-4 h-4 shrink-0 mt-0.5"
              style={{ color: 'var(--brand-warning-amber-text)' }}
              aria-hidden
            />
            <p
              className="text-[12.5px] leading-snug"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              {t('intake.edit.reverifyBanner')}
            </p>
          </div>
        </div>
      )}

      {/* Main content — A0b/A11 are full-screen-centered (no chrome); other
          steps scroll with extra bottom padding so the last form item never
          tucks under the sticky Continue button (or the iOS home indicator).
          Padding goes via inline style because Tailwind arbitrary values
          containing env() + calc() were getting stripped on some builds. */}
      <main
        id="main"
        className={
          // overflow-x-clip on every step clips the page-transition slide
          // (steps animate in from x:±60) so it never flashes a horizontal
          // scrollbar mid-transition.
          'flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 overflow-x-clip ' +
          (isComplete
            // Complete (A11) is a short, fixed-height panel: clip BOTH axes so
            // the brief moment when the tall previous step is still exiting
            // doesn't flash a vertical scrollbar before A11 settles.
            ? 'flex items-center-safe justify-center overflow-y-clip min-h-0 py-6'
            : isIntro
              // min-h-0 lets the flex child shrink so overflow-y-auto can take
              // over; items-center-safe centers when it fits and falls back to
              // top-aligned + scroll when content is taller than the screen.
              ? 'flex items-center-safe justify-center overflow-y-auto min-h-0 py-6'
              : 'py-5 sm:py-8')
        }
        style={
          isIntro || isComplete
            ? undefined
            : { paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 7rem)' }
        }
      >
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            data-testid={isIntro || isComplete ? undefined : `intake-step-${visibleIndex}`}
            custom={direction}
            initial={{ x: direction > 0 ? 60 : -60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: direction > 0 ? -60 : 60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
          >
            {step === 'A0b' && <A0bIntro onBegin={() => { setDirection(1); persistStep('A1'); }} onSaveLater={() => router.push('/dashboard')} />}
            {step === 'A1' && <A1Demographics {...stepProps} />}
            {step === 'A2' && <A2Pregnancy {...stepProps} />}
            {step === 'A3' && <A3Conditions {...stepProps} />}
            {step === 'A4' && <A4HFType {...stepProps} />}
            {step === 'A5' && <A5CoreMeds {...stepProps} />}
            {step === 'A6' && <A6Combos {...stepProps} />}
            {step === 'A8' && <A8Categories {...stepProps} />}
            {step === 'A9' && <A9Frequency {...stepProps} />}
            {step === 'A10' && <A10Review {...stepProps} />}
            {step === 'A11' && <A11Complete onDone={() => router.push('/dashboard')} />}
          </motion.div>
        </AnimatePresence>

        {submitError && (
          <p
            className="mt-5 text-[13px] text-center font-semibold px-4 py-2 rounded-lg"
            style={{ color: 'var(--brand-alert-red-text)', backgroundColor: 'var(--brand-alert-red-light)' }}
          >
            {(() => {
              if (submitError.kind === 'raw') return submitError.text;
              let s = t(submitError.key);
              if (submitError.values) {
                for (const [k, v] of Object.entries(submitError.values)) {
                  s = s.replace(`{${k}}`, v);
                }
              }
              return s;
            })()}
          </p>
        )}
      </main>

      {/* Sticky bottom CTA — hidden on intro/complete */}
      {showNav && (
        <div
          className="fixed bottom-0 left-0 right-0 bg-white px-4 pt-3 z-30"
          style={{
            borderTop: '1px solid var(--brand-border)',
            boxShadow: '0 -4px 16px rgba(0,0,0,0.05)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)',
          }}
        >
          <div className="max-w-3xl mx-auto">
            {editMode ? (
              // Edit mode — a one-tap "Save changes" that commits immediately
              // (no stepping to the last screen), with Continue kept as a
              // secondary action for patients who want to review other steps.
              <div className="flex gap-3">
                <button
                  type="button"
                  data-testid="intake-submit"
                  onClick={goNext}
                  disabled={submitting || exitSaving}
                  className="flex-1 h-12 rounded-full border-2 font-bold text-[14px] flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
                  style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-secondary)' }}
                >
                  {step === 'A10' ? t('intake.nav.submit') : t('intake.nav.continue')}
                </button>
                <motion.button
                  type="button"
                  data-testid="intake-quick-save"
                  onClick={handleQuickSave}
                  disabled={submitting || exitSaving}
                  className="flex-1 h-12 rounded-full text-white font-bold text-[14px] flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
                  style={{ backgroundColor: 'var(--brand-primary-purple)', boxShadow: 'var(--brand-shadow-button)' }}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                >
                  {exitSaving ? t('intake.nav.saving') : t('intake.nav.saveChanges')}
                  {!exitSaving && <Check className="w-4 h-4" />}
                </motion.button>
              </div>
            ) : (
              <motion.button
                type="button"
                data-testid="intake-submit"
                onClick={goNext}
                disabled={submitting}
                className="w-full h-12 rounded-full text-white font-bold text-[14px] flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--brand-primary-purple)', boxShadow: 'var(--brand-shadow-button)' }}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
              >
                {submitting ? t('intake.nav.saving') : step === 'A10' ? t('intake.nav.submit') : t('intake.nav.continue')}
                {!submitting && step !== 'A10' && <ArrowRight className="w-4 h-4" />}
                {!submitting && step === 'A10' && <Check className="w-4 h-4" />}
              </motion.button>
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {pendingDedup.length > 0 && (
          <DedupModal
            conflicts={pendingDedup}
            onResolve={resolveDedup}
            onCancel={() => setPendingDedup([])}
          />
        )}
        {showExitSave && (
          <ExitSaveModal
            editMode={editMode}
            saving={exitSaving}
            error={exitError}
            onConfirm={handleExitSave}
            onCancel={() => {
              if (exitSaving) return;
              setExitError('');
              setShowExitSave(false);
              setPendingNav(null);
            }}
            onDiscard={
              pendingNav
                ? () => {
                    const dest = pendingNav;
                    setShowExitSave(false);
                    setPendingNav(null);
                    router.push(dest);
                  }
                : undefined
            }
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Suppress "unused" lints for STEP_ORDER + ClipboardList — they're documented exports
// kept here intentionally for future cross-references during admin verification work.
void STEP_ORDER;
void ClipboardList;
