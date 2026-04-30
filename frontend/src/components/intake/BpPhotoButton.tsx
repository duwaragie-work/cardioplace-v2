'use client';

// Phase/27 BP photo OCR button (NIVA_SILENT_LITERACY_PLAN §3).
// Mirrors AudioButton/MicButton ARIA pattern: 44×44 hit area, focus-visible
// ring, aria-label + aria-pressed. The hidden file input uses
// `capture="environment"` so mobile browsers open the rear camera directly;
// desktop browsers fall back to a file picker.
//
// Renders nothing when NEXT_PUBLIC_BP_OCR_ENABLED !== 'true' so we can
// disable in seconds without redeploying.

import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Camera, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { uploadBpPhoto, BpOcrError, type BpOcrSuccess } from '@/lib/services/ocr.service';
import BpPhotoConfirmModal from './BpPhotoConfirmModal';

interface Props {
  /** Called with the OCR result AFTER the patient confirms the modal. */
  onConfirm: (result: BpOcrSuccess) => void;
  /** Optional className for layout overrides. */
  className?: string;
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

export default function BpPhotoButton({ onConfirm, className }: Props) {
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ result: BpOcrSuccess; previewUrl: string } | null>(null);

  // Feature flag — hide the camera button entirely when disabled.
  const enabled = process.env.NEXT_PUBLIC_BP_OCR_ENABLED === 'true';
  if (!enabled) return null;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file again still triggers onChange.
    e.target.value = '';
    if (!file) return;

    setError(null);
    setUploading(true);
    try {
      const result = await uploadBpPhoto(file);
      const previewUrl = URL.createObjectURL(file);
      setPending({ result, previewUrl });
    } catch (err) {
      if (err instanceof BpOcrError) {
        setError(messageFor(err.code, t));
      } else {
        setError(t('ocr.bp.errNetwork'));
      }
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = () => {
    if (!pending) return;
    URL.revokeObjectURL(pending.previewUrl);
    onConfirm(pending.result);
    setPending(null);
  };

  const handleCancel = () => {
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
  };

  const handleRetake = () => {
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
    // Open the camera again on the next tick so the input change-handler resets cleanly.
    setTimeout(() => fileInputRef.current?.click(), 0);
  };

  return (
    <>
      <motion.button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        aria-label={uploading ? t('ocr.bp.uploading') : t('ocr.bp.cameraLabel')}
        aria-pressed={uploading}
        disabled={uploading}
        className={`flex items-center justify-center rounded-full transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--brand-primary-purple)] disabled:cursor-wait ${className ?? ''}`}
        style={{
          width: 44,
          height: 44,
          backgroundColor: uploading
            ? 'var(--brand-primary-purple)'
            : 'var(--brand-primary-purple-light)',
          color: uploading ? 'white' : 'var(--brand-primary-purple)',
        }}
        whileHover={{ scale: uploading ? 1 : 1.05 }}
        whileTap={{ scale: uploading ? 1 : 0.93 }}
      >
        {uploading ? (
          <Loader2 size={18} className="animate-spin" aria-hidden="true" />
        ) : (
          <Camera size={18} aria-hidden="true" />
        )}
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
          className="mt-2 text-[12px]"
          style={{ color: 'var(--brand-error)' }}
        >
          {error}
        </p>
      )}
      {pending && (
        <BpPhotoConfirmModal
          result={pending.result}
          previewUrl={pending.previewUrl}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          onRetake={handleRetake}
        />
      )}
    </>
  );
}

function messageFor(
  code: BpOcrError['code'],
  t: (key: 'ocr.bp.errLowConfidence' | 'ocr.bp.errRateLimited' | 'ocr.bp.errTooLarge' | 'ocr.bp.errNetwork') => string,
): string {
  switch (code) {
    case 'LOW_CONFIDENCE':
    case 'OUT_OF_RANGE':
      return t('ocr.bp.errLowConfidence');
    case 'RATE_LIMITED':
      return t('ocr.bp.errRateLimited');
    case 'TOO_LARGE':
      return t('ocr.bp.errTooLarge');
    case 'WRONG_TYPE':
    case 'GEMINI_ERROR':
    case 'NETWORK':
    default:
      return t('ocr.bp.errNetwork');
  }
}
