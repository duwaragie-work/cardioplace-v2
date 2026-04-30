// Phase/27 BP photo OCR client wrapper (NIVA_SILENT_LITERACY_PLAN §3).
// Uploads a single image via multipart/form-data; backend returns Gemini's
// extracted SBP/DBP/pulse or a typed failure. Caller is responsible for
// surfacing user-facing copy — this layer translates HTTP statuses into
// `BpOcrError.code` so the UI can show the right toast string.

import { fetchWithAuth } from './token';

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

const MAX_BYTES = 4 * 1024 * 1024; // mirror backend cap

export async function uploadBpPhoto(file: File): Promise<BpOcrSuccess> {
  if (file.size > MAX_BYTES) {
    throw new BpOcrError('TOO_LARGE', 'Image exceeds 4 MB');
  }

  const formData = new FormData();
  formData.append('image', file);

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
