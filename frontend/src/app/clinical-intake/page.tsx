'use client';

// Clinical Intake wizard (Flow A) — multi-step, conditional path, draft-saved.
// Launched from the dashboard's Action Required card; submits to backend
// /intake/profile + /intake/medications endpoints; clears draft on success.
//
// Step flow (conditional skips applied):
//   A0b intro → A1 demographics → [A2 pregnancy if female] → A3 conditions
//     → [A4 HF type if HF] → A5 core meds → A6 combos → A8 categories
//     → A9 frequency → A10 review → A11 complete
//
// A7 dedup is a modal interrupt when transitioning from A6 (combos) to A8.

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Heart,
  Activity,
  Stethoscope,
  Sparkles,
  Mars,
  Venus,
  Asterisk,
  Baby,
  Pill,
  Droplet,
  Shield,
  Camera,
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
  type DrugClassInput,
  type IntakeProfilePayload,
  type IntakeMedicationsPayload,
  type IntakeMedicationItem,
  type MedicationFrequencyInput,
} from '@cardioplace/shared';

import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  getMyPatientProfile,
  getMyMedications,
  saveIntakeProfile,
  saveIntakeMedications,
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
import StepDots from '@/components/intake/StepDots';
import ChoiceCard from '@/components/intake/ChoiceCard';
import MedicationCard from '@/components/intake/MedicationCard';
import SpinnerIndicator from '@/components/ui/SpinnerIndicator';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function computeFlow(state: IntakeFormState): IntakeStepKey[] {
  const flow: IntakeStepKey[] = ['A0b', 'A1'];
  if (state.gender === 'FEMALE') flow.push('A2');
  flow.push('A3');
  if (state.hasHeartFailure) flow.push('A4');
  flow.push('A5', 'A6', 'A8', 'A9', 'A10', 'A11');
  return flow;
}

interface DedupConflict {
  comboId: string;
  comboBrand: string;
  componentName: string;
  componentMedId: string;
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

function buildProfilePayload(s: IntakeFormState): IntakeProfilePayload {
  return {
    gender: s.gender,
    heightCm: s.heightCm,
    isPregnant: s.gender === 'FEMALE' ? s.isPregnant ?? false : undefined,
    pregnancyDueDate: s.pregnancyDueDate || null,
    historyPreeclampsia: s.historyPreeclampsia ?? false,
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
    <div className="flex flex-col items-center text-center px-6 py-10">
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
            onClick={() => setState((p) => ({ ...p, gender: 'MALE', isPregnant: false }))}
            audioText={t('intake.a1.genderMale')}
            compact
          />
          <ChoiceCard
            icon={<Venus className="w-6 h-6" />}
            title={t('intake.a1.genderFemale')}
            selected={state.gender === 'FEMALE'}
            onClick={() => setState((p) => ({ ...p, gender: 'FEMALE' }))}
            audioText={t('intake.a1.genderFemale')}
            compact
          />
          <ChoiceCard
            icon={<Asterisk className="w-6 h-6" />}
            title={t('intake.a1.genderOther')}
            selected={state.gender === 'OTHER'}
            onClick={() => setState((p) => ({ ...p, gender: 'OTHER', isPregnant: false }))}
            audioText={t('intake.a1.genderOther')}
            compact
          />
        </div>
      </div>

      <div>
        <SectionLabel text={t('intake.a1.heightQuestion')} audio={t('intake.a1.heightAudio')} />
        <input
          type="number"
          inputMode="numeric"
          min={100}
          max={250}
          value={state.heightCm ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            setState((p) => ({ ...p, heightCm: v ? parseInt(v, 10) : undefined }));
          }}
          placeholder="170"
          className="w-full h-14 px-5 rounded-xl text-[18px] outline-none transition box-border"
          style={{
            border: '2px solid var(--brand-border)',
            color: 'var(--brand-text-primary)',
            backgroundColor: 'white',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--brand-primary-purple)'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--brand-border)'; }}
        />
        <p className="text-[12px] mt-2" style={{ color: 'var(--brand-text-muted)' }}>
          {t('intake.a1.heightHint')}
        </p>
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ChoiceCard
          icon={<Baby className="w-6 h-6" />}
          title={t('intake.a2.yesTitle')}
          description={t('intake.a2.yesDesc')}
          selected={state.isPregnant === true}
          onClick={() => setState((p) => ({ ...p, isPregnant: true }))}
          audioText={t('intake.a2.yesAudio')}
        />
        <ChoiceCard
          icon={<Heart className="w-6 h-6" />}
          title={t('intake.a2.noTitle')}
          description={t('intake.a2.noDesc')}
          selected={state.isPregnant === false}
          onClick={() => setState((p) => ({ ...p, isPregnant: false, pregnancyDueDate: undefined }))}
          audioText={t('intake.a2.noAudio')}
        />
        <ChoiceCard
          icon={<Asterisk className="w-6 h-6" />}
          title={t('intake.a2.naTitle')}
          description={t('intake.a2.naDesc')}
          selected={state.isPregnant === undefined}
          onClick={() => setState((p) => ({ ...p, isPregnant: undefined, pregnancyDueDate: undefined }))}
          audioText={t('intake.a2.naAudio')}
        />
      </div>

      <AnimatePresence>
        {isPregnant && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-5"
          >
            <div>
              <SectionLabel text={t('intake.a2.dueDateLabel')} audio={t('intake.a2.dueDateAudio')} />
              <input
                type="date"
                value={state.pregnancyDueDate ?? ''}
                onChange={(e) => setState((p) => ({ ...p, pregnancyDueDate: e.target.value || undefined }))}
                className="w-full h-14 px-5 rounded-xl text-[15px] outline-none transition box-border"
                style={{
                  border: '2px solid var(--brand-border)',
                  color: 'var(--brand-text-primary)',
                  backgroundColor: 'white',
                  colorScheme: 'light',
                }}
              />
            </div>

            <ChoiceCard
              icon={<Shield className="w-5 h-5" />}
              title={t('intake.a2.preeclampsiaTitle')}
              description={t('intake.a2.preeclampsiaDesc')}
              selected={state.historyPreeclampsia === true}
              onClick={() => setState((p) => ({ ...p, historyPreeclampsia: !p.historyPreeclampsia }))}
              audioText={t('intake.a2.preeclampsiaAudio')}
              compact
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function A3Conditions({ state, setState }: StepProps) {
  const { t } = useLanguage();
  const has = (k: keyof IntakeFormState): boolean => Boolean(state[k]);
  const set = (k: keyof IntakeFormState, v: boolean) =>
    setState((p) => ({ ...p, [k]: v }));

  const noneSelected =
    !state.hasHeartFailure && !state.hasAFib && !state.hasCAD && !state.hasHCM && !state.hasDCM;

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
        />
        <ChoiceCard
          icon={<Activity className="w-6 h-6" />}
          title={t('intake.a3.afTitle')}
          description={t('intake.a3.afDesc')}
          selected={has('hasAFib')}
          onClick={() => set('hasAFib', !state.hasAFib)}
          audioText={t('intake.a3.afAudio')}
        />
        <ChoiceCard
          icon={<Stethoscope className="w-6 h-6" />}
          title={t('intake.a3.cadTitle')}
          description={t('intake.a3.cadDesc')}
          selected={has('hasCAD')}
          onClick={() => set('hasCAD', !state.hasCAD)}
          audioText={t('intake.a3.cadAudio')}
        />
        <ChoiceCard
          icon={<Sparkles className="w-6 h-6" />}
          title={t('intake.a3.hcmTitle')}
          description={t('intake.a3.hcmDesc')}
          selected={has('hasHCM')}
          onClick={() => set('hasHCM', !state.hasHCM)}
          audioText={t('intake.a3.hcmAudio')}
        />
        <ChoiceCard
          icon={<Sparkles className="w-6 h-6" />}
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
          icon={<Heart className="w-6 h-6" />}
          title={t('intake.a4.hfrefTitle')}
          description={t('intake.a4.hfrefDesc')}
          selected={state.heartFailureType === 'HFREF'}
          onClick={() => setState((p) => ({ ...p, heartFailureType: 'HFREF' }))}
          audioText={t('intake.a4.hfrefAudio')}
        />
        <ChoiceCard
          icon={<Heart className="w-6 h-6" />}
          title={t('intake.a4.hfpefTitle')}
          description={t('intake.a4.hfpefDesc')}
          selected={state.heartFailureType === 'HFPEF'}
          onClick={() => setState((p) => ({ ...p, heartFailureType: 'HFPEF' }))}
          audioText={t('intake.a4.hfpefAudio')}
        />
        <ChoiceCard
          icon={<Asterisk className="w-6 h-6" />}
          title={t('intake.a4.unknownTitle')}
          description={t('intake.a4.unknownDesc')}
          selected={state.heartFailureType === 'UNKNOWN' || state.heartFailureType === undefined}
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

function A5CoreMeds({ state, setState }: StepProps) {
  const selectedIds = useMemo(
    () => new Set(state.selectedMedications.filter((m) => !m.isCombination).map((m) => m.catalogId).filter(Boolean) as string[]),
    [state.selectedMedications],
  );

  const toggle = (medId: string) => {
    setState((prev) => {
      const med = CORE_MEDS.find((m) => m.id === medId);
      if (!med) return prev;
      const isSelected = selectedIds.has(medId);
      const next = isSelected
        ? prev.selectedMedications.filter((m) => m.catalogId !== medId)
        : [
            ...prev.selectedMedications,
            {
              catalogId: med.id,
              drugName: med.brandName,
              drugClass: med.drugClass,
              isCombination: false,
              source: 'PATIENT_SELF_REPORT' as const,
            },
          ];
      return { ...prev, selectedMedications: next };
    });
  };

  const { t } = useLanguage();
  return (
    <div className="space-y-7">
      <StepHeader
        title={t('intake.a5.title')}
        subtitle={t('intake.a5.subtitle')}
        audio={t('intake.a5.audio')}
      />

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
    </div>
  );
}

function A6Combos({ state, setState }: StepProps) {
  const selectedIds = useMemo(
    () => new Set(state.selectedMedications.filter((m) => m.isCombination).map((m) => m.catalogId).filter(Boolean) as string[]),
    [state.selectedMedications],
  );

  const toggle = (comboId: string) => {
    setState((prev) => {
      const combo = COMBO_MEDS.find((c) => c.id === comboId);
      if (!combo) return prev;
      const isSelected = selectedIds.has(comboId);
      const next = isSelected
        ? prev.selectedMedications.filter((m) => m.catalogId !== comboId)
        : [
            ...prev.selectedMedications,
            {
              catalogId: combo.id,
              drugName: combo.brandName,
              // Pick first registered class as the primary; full set goes into combinationComponents.
              drugClass: combo.registersAs[0] as DrugClassInput,
              isCombination: true,
              combinationComponents: combo.registersAs,
              source: 'PATIENT_SELF_REPORT' as const,
            },
          ];
      return { ...prev, selectedMedications: next };
    });
  };

  const { t } = useLanguage();
  const contains = t('intake.a6.audioContains');
  const andWord = t('intake.a6.audioAnd');
  return (
    <div className="space-y-6">
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
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [otherText, setOtherText] = useState(state.otherDraft?.text ?? '');
  const [photoNote, setPhotoNote] = useState(state.otherDraft?.photoNote ?? '');

  const selectedIds = useMemo(
    () => new Set(state.selectedMedications.map((m) => m.catalogId).filter(Boolean) as string[]),
    [state.selectedMedications],
  );

  const toggleCategoryMed = (medId: string) => {
    setState((prev) => {
      const med = CATEGORY_MEDS.find((m) => m.id === medId);
      if (!med) return prev;
      const isSelected = selectedIds.has(medId);
      const next = isSelected
        ? prev.selectedMedications.filter((m) => m.catalogId !== medId)
        : [
            ...prev.selectedMedications,
            {
              catalogId: med.id,
              drugName: med.brandName,
              drugClass: med.drugClass,
              isCombination: false,
              source: 'PATIENT_SELF_REPORT' as const,
            },
          ];
      return { ...prev, selectedMedications: next };
    });
  };

  const addOther = (source: 'PATIENT_VOICE' | 'PATIENT_PHOTO', rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed) return;
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
    setPhotoNote('');
  };

  const otherCount = state.selectedMedications.filter((m) => m.drugClass === 'OTHER_UNVERIFIED').length;

  const categories: { key: string; label: string; icon: React.ReactNode; audio: string }[] = [
    { key: 'WATER_PILL', label: t('intake.a8.categoryWaterPill'), icon: <Droplet className="w-6 h-6" />, audio: t('intake.a8.categoryWaterPill') },
    { key: 'BLOOD_THINNER', label: t('intake.a8.categoryBloodThinner'), icon: <Pill className="w-6 h-6" />, audio: t('intake.a8.categoryBloodThinner') },
    { key: 'CHOLESTEROL', label: t('intake.a8.categoryCholesterol'), icon: <Pill className="w-6 h-6" />, audio: t('intake.a8.categoryCholesterol') },
    { key: 'HEART_RHYTHM', label: t('intake.a8.categoryHeartRhythm'), icon: <Activity className="w-6 h-6" />, audio: t('intake.a8.categoryHeartRhythm') },
    { key: 'SGLT2', label: t('intake.a8.categorySGLT2'), icon: <Heart className="w-6 h-6" />, audio: t('intake.a8.audioSGLT2') },
    { key: 'OTHER', label: t('intake.a8.categoryOther'), icon: <Sparkles className="w-6 h-6" />, audio: t('intake.a8.categoryOther') },
  ];
  const alsoKnown = t('intake.a5.audioAlsoKnown');

  return (
    <div className="space-y-6">
      <StepHeader
        title={t('intake.a8.title')}
        subtitle={t('intake.a8.subtitle')}
        audio={t('intake.a8.audio')}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {categories.map((cat) => (
          <ChoiceCard
            key={cat.key}
            icon={cat.icon}
            title={cat.label}
            selected={activeCategory === cat.key}
            onClick={() => setActiveCategory(activeCategory === cat.key ? null : cat.key)}
            audioText={cat.audio}
            compact
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeCategory && activeCategory !== 'OTHER' && (
          <motion.div
            key={activeCategory}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2"
          >
            {CATEGORY_MEDS.filter((m) => m.category === activeCategory).map((m) => (
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
          </motion.div>
        )}

        {activeCategory === 'OTHER' && (
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
                  <label className="block text-[12px] font-semibold mb-1" style={{ color: 'var(--brand-text-primary)' }}>
                    {t('intake.a8.otherSpeakLabel')}
                  </label>
                  <input
                    type="text"
                    value={otherText}
                    onChange={(e) => setOtherText(e.target.value)}
                    placeholder={t('intake.a8.otherSpeakPlaceholder')}
                    className="w-full h-11 px-4 rounded-lg text-[14px] outline-none transition box-border bg-white"
                    style={{ border: '2px solid var(--brand-border)', color: 'var(--brand-text-primary)' }}
                  />
                  <button
                    type="button"
                    onClick={() => addOther('PATIENT_VOICE', otherText)}
                    disabled={!otherText.trim()}
                    className="mt-2 px-4 py-1.5 rounded-full text-white text-[12px] font-bold disabled:opacity-50 cursor-pointer"
                    style={{ backgroundColor: 'var(--brand-primary-purple)' }}
                  >
                    {t('intake.a8.otherAdd')}
                  </button>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div
                  className="shrink-0 rounded-xl flex items-center justify-center"
                  style={{ width: 40, height: 40, backgroundColor: 'var(--brand-accent-teal)', color: 'white' }}
                >
                  <Camera className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <label className="block text-[12px] font-semibold mb-1" style={{ color: 'var(--brand-text-primary)' }}>
                    {t('intake.a8.otherPhotoLabel')}
                  </label>
                  <input
                    type="text"
                    value={photoNote}
                    onChange={(e) => setPhotoNote(e.target.value)}
                    placeholder={t('intake.a8.otherPhotoPlaceholder')}
                    className="w-full h-11 px-4 rounded-lg text-[14px] outline-none transition box-border bg-white"
                    style={{ border: '2px solid var(--brand-border)', color: 'var(--brand-text-primary)' }}
                  />
                  <button
                    type="button"
                    onClick={() => addOther('PATIENT_PHOTO', photoNote)}
                    disabled={!photoNote.trim()}
                    className="mt-2 px-4 py-1.5 rounded-full text-white text-[12px] font-bold disabled:opacity-50 cursor-pointer"
                    style={{ backgroundColor: 'var(--brand-accent-teal)' }}
                  >
                    {t('intake.a8.otherAdd')}
                  </button>
                </div>
              </div>
            </div>

            {otherCount > 0 && (
              <p className="text-[12px] text-center" style={{ color: 'var(--brand-text-muted)' }}>
                {(otherCount === 1 ? t('intake.a8.otherCountSingle') : t('intake.a8.otherCountPlural')).replace('{n}', String(otherCount))}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

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
            <div className="grid grid-cols-4 gap-2">
              {options.map((o) => {
                const active = m.frequency === o.value;
                return (
                  <motion.button
                    key={o.value}
                    type="button"
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
        <Shield className="w-5 h-5 mt-0.5 shrink-0" style={{ color: 'var(--brand-warning-amber)' }} />
        <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--brand-text-primary)' }}>
          {t('intake.a10.reviewBanner')}
        </p>
      </div>

      <ReviewSection title={t('intake.a10.sectionAbout')} onEdit={() => goTo?.('A1')}>
        <ReviewRow label={t('intake.a10.rowGender')} value={genderLabel(state.gender)} />
        <ReviewRow label={t('intake.a10.rowHeight')} value={state.heightCm ? `${state.heightCm} cm` : '—'} />
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
    <div className="flex flex-col items-center text-center px-4 py-10">
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

function ExitSaveModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const { t } = useLanguage();
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
          {t('intake.exitSave.title')}
        </h3>
        <p className="text-[13px] mb-6 leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
          {t('intake.exitSave.body')}
        </p>
        <button
          type="button"
          onClick={onConfirm}
          className="w-full h-11 rounded-full text-white font-bold text-[14px] cursor-pointer"
          style={{ backgroundColor: 'var(--brand-primary-purple)', boxShadow: 'var(--brand-shadow-button)' }}
        >
          {t('intake.exitSave.cta')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="w-full mt-2 text-[12px] font-semibold cursor-pointer"
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

const VALID_DEEP_LINK_STEPS: IntakeStepKey[] = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A8', 'A9', 'A10'];

// Next 16 requires components that read useSearchParams() to be wrapped in
// a Suspense boundary so prerendering can bail out cleanly. Default export
// provides that wrapper around the real wizard component.
export default function ClinicalIntakePage() {
  return (
    <Suspense fallback={
      <div
        className="min-h-screen flex items-center justify-center"
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
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [bootstrapping, setBootstrapping] = useState(true);
  // True only when we hit the route without ?step= AND the patient already
  // has a profile saved — in that case we render the "you're all set" page
  // and the patient must edit via the /profile page (which sends them back
  // here with ?step=AX). With ?step= we go straight into edit mode.
  const [profileExists, setProfileExists] = useState(false);

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
        if (cancelled) return;

        if (profile && !isEdit) {
          // Branch 3 — show the all-set page.
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
            isPregnant: profile.isPregnant ?? undefined,
            pregnancyDueDate: profile.pregnancyDueDate ?? undefined,
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
                // when the patient revisits.
                const lower = m.drugName.toLowerCase();
                const catEntry =
                  ALL_CORE_MEDS.find((c) => c.brandName.toLowerCase() === lower) ??
                  ALL_CATEGORY_MEDS.find((c) => c.brandName.toLowerCase() === lower);
                const comboEntry = ALL_COMBO_MEDS.find((c) => c.brandName.toLowerCase() === lower);
                return {
                  catalogId: catEntry?.id ?? comboEntry?.id,
                  drugName: m.drugName,
                  drugClass: m.drugClass as IntakeFormState['selectedMedications'][number]['drugClass'],
                  isCombination: m.isCombination,
                  combinationComponents: m.combinationComponents as IntakeFormState['selectedMedications'][number]['combinationComponents'],
                  source: m.source as IntakeFormState['selectedMedications'][number]['source'],
                  rawInputText: m.rawInputText ?? undefined,
                  frequency: m.frequency,
                };
              }),
          };
          setStateRaw(seeded);
          setStep(requestedStep);
          setBootstrapping(false);
          return;
        }

        // Branch 1 — no profile yet. Resume from draft or start fresh.
        const draft = loadDraft(user.id);
        if (draft) {
          // A draft pointing at the completion screen is stale — submit must
          // have succeeded but the row was later deleted. Treat as fresh.
          if (draft.currentStep === 'A11') {
            clearDraft(user.id);
          } else {
            setStateRaw(draft);
            if (draft.currentStep) setStep(draft.currentStep);
          }
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

  // Auth gating: send unauthenticated to sign-in; basic onboarding incomplete to /onboarding.
  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace('/sign-in');
      return;
    }
    if (user.onboardingStatus !== 'COMPLETED') {
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

  // Wrap setState to persist draft on every change.
  const setState = (updater: (prev: IntakeFormState) => IntakeFormState) => {
    setStateRaw((prev) => {
      const next = updater(prev);
      if (user?.id) {
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
    if (user?.id) {
      saveDraft(user.id, { ...state, currentStep: next });
    }
    setStep(next);
  };

  const goNext = async () => {
    // Validation gates.
    if (step === 'A1') {
      if (!state.gender) { setSubmitError(t('intake.nav.errorGender')); return; }
      if (!state.heightCm || state.heightCm < 100 || state.heightCm > 250) {
        setSubmitError(t('intake.nav.errorHeight'));
        return;
      }
    }
    if (step === 'A4' && !state.heartFailureType) {
      setSubmitError(t('intake.nav.errorHfType'));
      return;
    }
    if (step === 'A9') {
      const missingFreq = state.selectedMedications.find((m) => !m.frequency);
      if (missingFreq) {
        setSubmitError(t('intake.nav.errorFreq').replace('{name}', missingFreq.drugName));
        return;
      }
    }
    setSubmitError('');

    // A6 → A8 transition: surface dedup conflicts before letting the user proceed.
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
    setSubmitError('');
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
    setSubmitError('');
    const targetIdx = flow.indexOf(target);
    setDirection(targetIdx > stepIndex ? 1 : -1);
    persistStep(target);
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitError('');
    setSubmitting(true);
    try {
      await saveIntakeProfile(buildProfilePayload(state));
      if (state.selectedMedications.length > 0) {
        await saveIntakeMedications(buildMedsPayload(state));
      }
      setStateRaw((p) => ({ ...p, hasSubmitted: true }));
      setDirection(1);
      // Use raw setStep — persistStep would re-write the draft we just cleared.
      setStep('A11');
      if (user?.id) clearDraft(user.id);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : t('intake.nav.errorSubmit'));
    } finally {
      setSubmitting(false);
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
      // Continue to A8 after all conflicts handled.
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
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--brand-background)' }}>
        <SpinnerIndicator size={40} className="text-[#7B00E0]" />
      </div>
    );
  }

  const isIntro = step === 'A0b';
  const isComplete = step === 'A11';
  const showNav = !isIntro && !isComplete;

  const stepProps: StepProps = { state, setState, goTo };

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--brand-background)' }}>
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

      {/* Main content — A0b/A11 are full-screen-centered (no chrome); other
          steps scroll with extra bottom padding so the last form item never
          tucks under the sticky Continue button (or the iOS home indicator).
          Padding goes via inline style because Tailwind arbitrary values
          containing env() + calc() were getting stripped on some builds. */}
      <main
        className={
          'flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 ' +
          (isIntro || isComplete
            ? 'flex items-center justify-center py-8'
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
            style={{ color: 'var(--brand-alert-red)', backgroundColor: 'var(--brand-alert-red-light)' }}
          >
            {submitError}
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
            <motion.button
              type="button"
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
            onConfirm={() => router.push('/dashboard')}
            onCancel={() => setShowExitSave(false)}
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
