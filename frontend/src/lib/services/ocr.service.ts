// Phase/27 BP photo OCR client wrapper (NIVA_SILENT_LITERACY_PLAN §3).
// Uploads a single image via multipart/form-data; backend returns Gemini's
// extracted SBP/DBP/pulse or a typed failure. Caller is responsible for
// surfacing user-facing copy — this layer translates HTTP statuses into
// `BpOcrError.code` so the UI can show the right toast string.

import { fetchWithAuth } from './token';
import { compressImageForUpload } from '../image-compress';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export interface BpOcrSuccess {
  sbp: number;
  dbp: number;
  pulse: number | null;
  confidence: number;
}

export type BpOcrErrorCode =
  | 'LOW_CONFIDENCE'
  | 'OUT_OF_RANGE'
  | 'GEMINI_ERROR'
  | 'RATE_LIMITED'
  | 'TOO_LARGE'
  | 'WRONG_TYPE'
  | 'NETWORK';

export class BpOcrError extends Error {
  constructor(public readonly code: BpOcrErrorCode, message: string) {
    super(message);
    this.name = 'BpOcrError';
  }
}

const MAX_BYTES = 10 * 1024 * 1024; // mirror backend cap (ocr.controller.ts)

export async function uploadBpPhoto(file: File): Promise<BpOcrSuccess> {
  // Downscale large phone photos before the size check so a high-quality
  // camera shot isn't rejected for being too big (falls back to the original
  // when it can't be decoded — e.g. HEIC outside Safari).
  const prepared = await compressImageForUpload(file);
  if (prepared.size > MAX_BYTES) {
    throw new BpOcrError('TOO_LARGE', 'Image exceeds 10 MB');
  }

  const formData = new FormData();
  formData.append('image', prepared);

  let res: Response;
  try {
    res = await fetchWithAuth(`${API}/api/v2/ocr/bp`, {
      method: 'POST',
      body: formData,
      // Note: do NOT set Content-Type — the browser adds the multipart boundary.
    });
  } catch {
    throw new BpOcrError('NETWORK', 'Network error');
  }

  if (res.ok) {
    return (await res.json()) as BpOcrSuccess;
  }

  // Backend returns { error, code } for the typed failures.
  const body = await res.json().catch(() => ({}) as Record<string, unknown>);
  const code = (body as { code?: string }).code;
  switch (res.status) {
    case 422:
      throw new BpOcrError(
        code === 'OUT_OF_RANGE' ? 'OUT_OF_RANGE' : 'LOW_CONFIDENCE',
        (body as { error?: string }).error ?? 'Could not read the cuff',
      );
    case 429:
      throw new BpOcrError('RATE_LIMITED', 'Daily OCR limit reached');
    case 415:
      throw new BpOcrError('WRONG_TYPE', 'Unsupported image type');
    case 413:
      throw new BpOcrError('TOO_LARGE', 'Image too large');
    case 502:
      throw new BpOcrError('GEMINI_ERROR', 'OCR provider unavailable');
    default:
      throw new BpOcrError('NETWORK', `Server returned ${res.status}`);
  }
}

// ─── Medication-list OCR (Phase/27 follow-up) ───────────────────────────────

export interface MedOcrItem {
  drugName: string;
  /** Free-text frequency from the label — caller normalises via normaliseFrequency(). */
  frequency: string;
  /** Dose as printed (e.g. "10 mg"). Informational. */
  doseText: string;
  /** Exact text snippet Gemini extracted; persisted on PatientMedication.rawInputText. */
  raw: string;
}

export interface MedOcrSuccess {
  medications: MedOcrItem[];
  confidence: number;
}

export type MedOcrErrorCode =
  | 'LOW_CONFIDENCE'
  | 'EMPTY_EXTRACTION'
  | 'GEMINI_ERROR'
  | 'RATE_LIMITED'
  | 'TOO_LARGE'
  | 'WRONG_TYPE'
  | 'NETWORK';

export class MedOcrError extends Error {
  constructor(public readonly code: MedOcrErrorCode, message: string) {
    super(message);
    this.name = 'MedOcrError';
  }
}

export async function uploadMedicationPhoto(file: File): Promise<MedOcrSuccess> {
  // Downscale large phone photos before the size check (see uploadBpPhoto).
  const prepared = await compressImageForUpload(file);
  if (prepared.size > MAX_BYTES) {
    throw new MedOcrError('TOO_LARGE', 'Image exceeds 10 MB');
  }

  const formData = new FormData();
  formData.append('image', prepared);

  let res: Response;
  try {
    res = await fetchWithAuth(`${API}/api/v2/ocr/medications`, {
      method: 'POST',
      body: formData,
    });
  } catch {
    throw new MedOcrError('NETWORK', 'Network error');
  }

  if (res.ok) {
    return (await res.json()) as MedOcrSuccess;
  }

  const body = await res.json().catch(() => ({}) as Record<string, unknown>);
  const code = (body as { code?: string }).code;
  switch (res.status) {
    case 422:
      throw new MedOcrError(
        code === 'EMPTY_EXTRACTION' ? 'EMPTY_EXTRACTION' : 'LOW_CONFIDENCE',
        (body as { error?: string }).error ?? 'Could not read the photo',
      );
    case 429:
      throw new MedOcrError('RATE_LIMITED', 'Daily OCR limit reached');
    case 415:
      throw new MedOcrError('WRONG_TYPE', 'Unsupported image type');
    case 413:
      throw new MedOcrError('TOO_LARGE', 'Image too large');
    case 502:
      throw new MedOcrError('GEMINI_ERROR', 'OCR provider unavailable');
    default:
      throw new MedOcrError('NETWORK', `Server returned ${res.status}`);
  }
}

// ─── Drug-name enrichment (RxNorm + DailyMed + OpenFDA + Gemini) ──────────

export interface DrugEnrichment {
  rxcui: string;
  canonicalDrugName: string;
  pillImageUrl: string | null;
  plainLanguageDescription: string | null;
  pregnancy: { category: string | null; warning: string | null } | null;
  source: 'rxnorm+dailymed+openfda';
}

/**
 * Resolve a freeform drug name into canonical name + pill image + plain-language
 * description. Returns null when RxNorm doesn't recognise the drug or when the
 * backend is rate-limited / down — caller falls back to showing the raw name.
 */
export async function enrichDrugName(
  drugName: string,
  locale: string = 'en',
): Promise<DrugEnrichment | null> {
  const trimmed = drugName.trim();
  if (!trimmed) return null;

  let res: Response;
  try {
    res = await fetchWithAuth(`${API}/api/v2/medications/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drugName: trimmed, locale }),
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as DrugEnrichment | null;
  return body && typeof body === 'object' && 'canonicalDrugName' in body ? body : null;
}
