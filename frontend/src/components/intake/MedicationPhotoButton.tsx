'use client';

// Phase/27 medication-list OCR button — patient snaps a prescription /
// pharmacy printout / pill-bottle label. Mirrors BpPhotoButton's ARIA + 44×44
// + capture="environment" pattern. Renders nothing when
// NEXT_PUBLIC_MED_OCR_ENABLED !== 'true' so we can disable without redeploy.
//
// On successful upload, opens MedicationPhotoConfirmModal which handles
// catalog matching + per-row editing. The patient must explicitly tap
// "Add all" — values never auto-populate.

import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Camera, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  uploadMedicationPhoto,
  MedOcrError,
  type MedOcrSuccess,
  type MedOcrErrorCode,
} from '@/lib/services/ocr.service';
import MedicationPhotoConfirmModal, {
  type ConfirmedMedication,
  type ExistingMedicationMatch,
} from './MedicationPhotoConfirmModal';

interface Props {
  /** Called with the kept rows AFTER the patient taps "Add all". The handler
   *  is responsible for catalog matching + dedup against existing meds. */
  onConfirm: (medications: ConfirmedMedication[]) => void;
  /** Optional callback used to badge each row "Already in your list" and
   *  surface frequency-update intent before the patient taps Add all. Should
   *  match the same dedup logic the parent uses post-Confirm (drugName +
   *  catalog brandName/genericName). */
  findExisting?: (drugName: string) => ExistingMedicationMatch | null;
  /** Optional className for layout overrides. */
  className?: string;
  /** Optional override for the button label. Defaults to the i18n key. */
  label?: string;
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

export default function MedicationPhotoButton({
  onConfirm,
  findExisting,
  className,
  label,
}: Props) {
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<
    { result: MedOcrSuccess; previewUrl: string } | null
  >(null);

  // Feature flag — hide the button when disabled.
  const enabled = process.env.NEXT_PUBLIC_MED_OCR_ENABLED === 'true';
  if (!enabled) return null;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError(null);
    setUploading(true);
    try {
      // uploadMedicationPhoto downscales large phone photos before upload.
      const result = await uploadMedicationPhoto(file);
      // If nothing readable came back, surface the error inline (in red)
      // instead of opening a confirm modal with empty rows. (The backend
      // already 422s on a fully empty read; this also catches blank rows.)
      const readable = result.medications.filter((m) => m.drugName?.trim());
      if (readable.length === 0) {
        setError(t('ocr.med.errEmpty'));
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      setPending({ result: { ...result, medications: readable }, previewUrl });
    } catch (err) {
      if (err instanceof MedOcrError) {
        setError(messageFor(err.code, t));
      } else {
        setError(t('ocr.med.errNetwork'));
      }
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = (kept: ConfirmedMedication[]) => {
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    onConfirm(kept);
    setPending(null);
  };

  const handleCancel = () => {
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
  };

  const handleRetake = () => {
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
    setTimeout(() => fileInputRef.current?.click(), 0);
  };

  const buttonLabel = label ?? t('ocr.med.cameraLabel');

  return (
    <>
      {/* Self-contained column so the error always stacks BELOW the button —
          the parent may be a flex row, which would otherwise push the error
          off to the right of the button. */}
      <div className="flex flex-col items-start gap-2 max-w-full">
        <motion.button
          type="button"
          data-testid="intake-medication-photo-button"
          onClick={() => fileInputRef.current?.click()}
          aria-label={uploading ? t('ocr.med.uploading') : buttonLabel}
          aria-pressed={uploading}
          disabled={uploading}
          className={`inline-flex shrink-0 items-center justify-center gap-2 px-4 h-11 rounded-full font-semibold text-[0.8125rem] whitespace-nowrap transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--brand-primary-purple)] disabled:cursor-wait ${className ?? ''}`}
          style={{
            backgroundColor: uploading
              ? 'var(--brand-primary-purple)'
              : 'var(--brand-primary-purple-light)',
            color: uploading ? 'white' : 'var(--brand-primary-purple)',
          }}
          whileHover={{ scale: uploading ? 1 : 1.03 }}
          whileTap={{ scale: uploading ? 1 : 0.96 }}
        >
          {uploading ? (
            <Loader2 size={16} className="animate-spin shrink-0" aria-hidden="true" />
          ) : (
            <Camera size={16} className="shrink-0" aria-hidden="true" />
          )}
          <span>{uploading ? t('ocr.med.uploading') : buttonLabel}</span>
        </motion.button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          capture="environment"
          className="sr-only"
          onChange={handleFile}
        />
        {error && (
          <p
            role="alert"
            className="text-[0.75rem] font-medium"
            style={{ color: 'var(--brand-alert-red)' }}
          >
            {error}
          </p>
        )}
      </div>
      {pending && (
        <MedicationPhotoConfirmModal
          medications={pending.result.medications}
          confidence={pending.result.confidence}
          previewUrl={pending.previewUrl}
          findExisting={findExisting}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          onRetake={handleRetake}
        />
      )}
    </>
  );
}

function messageFor(
  code: MedOcrErrorCode,
  t: (
    key:
      | 'ocr.med.errLowConfidence'
      | 'ocr.med.errEmpty'
      | 'ocr.med.errRateLimited'
      | 'ocr.med.errTooLarge'
      | 'ocr.med.errNetwork',
  ) => string,
): string {
  switch (code) {
    case 'LOW_CONFIDENCE':
      return t('ocr.med.errLowConfidence');
    case 'EMPTY_EXTRACTION':
      return t('ocr.med.errEmpty');
    case 'RATE_LIMITED':
      return t('ocr.med.errRateLimited');
    case 'TOO_LARGE':
      return t('ocr.med.errTooLarge');
    case 'WRONG_TYPE':
    case 'GEMINI_ERROR':
    case 'NETWORK':
    default:
      return t('ocr.med.errNetwork');
  }
}
