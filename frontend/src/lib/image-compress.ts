// Client-side image downscaling for OCR uploads.
//
// Phone cameras (iPhone especially) produce 3–8 MB photos that blow past the
// 4 MB OCR cap, so the upload was rejected before it ever reached the server.
// We decode the image, scale the longest edge down to a sane maximum, and
// re-encode as JPEG — dropping quality in steps until it fits the byte budget.
// EXIF orientation is honoured via createImageBitmap so portrait phone photos
// don't arrive sideways. Everything degrades gracefully: if the browser can't
// decode the file (e.g. HEIC outside Safari) we return the original and let the
// size guard / server produce the normal error.

export interface CompressOptions {
  /** Longest-edge cap in pixels. 2048 keeps prescription text readable. */
  maxDimension?: number;
  /** Byte budget. Default leaves headroom under the 4 MB server cap. */
  maxBytes?: number;
}

const DEFAULTS: Required<CompressOptions> = {
  maxDimension: 2048,
  maxBytes: 3.5 * 1024 * 1024,
};

// Quality ladder tried in order; we stop at the first that fits the budget,
// otherwise fall back to the smallest.
const QUALITY_STEPS = [0.85, 0.7, 0.6, 0.5] as const;

function toJpgName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, '');
  return `${base || 'photo'}.jpg`;
}

/**
 * Returns a JPEG `File` scaled to fit `maxDimension` and under `maxBytes`, or
 * the original file when it's already small enough or can't be processed.
 */
export async function compressImageForUpload(
  file: File,
  options: CompressOptions = {},
): Promise<File> {
  const { maxDimension, maxBytes } = { ...DEFAULTS, ...options };

  // Only images, and only when there's something to gain.
  if (typeof window === 'undefined') return file;
  if (!file.type.startsWith('image/')) return file;
  if (file.size <= maxBytes) return file;

  let bitmap: ImageBitmap;
  try {
    // Honour EXIF rotation so portrait phone photos aren't sideways.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      // Older engines reject the options arg — decode without it rather than
      // failing the whole upload (orientation may be off, but it'll fit).
      bitmap = await createImageBitmap(file);
    } catch {
      return file; // undecodable here (e.g. HEIC on non-Safari) — let caller handle
    }
  }

  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    let smallest: Blob | null = null;
    for (const quality of QUALITY_STEPS) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality),
      );
      if (!blob) continue;
      smallest = blob;
      if (blob.size <= maxBytes) break;
    }

    if (!smallest) return file;
    return new File([smallest], toJpgName(file.name), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } finally {
    bitmap.close();
  }
}
