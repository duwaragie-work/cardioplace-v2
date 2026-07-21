// V-audit 1.9 — chat prompt-chip allowlist.
//
// The homepage "Try now" chips used to serialize their FULL translated text into
// the URL (`/chat?q=<text>`), which lands in the CloudFront/S3 access log, browser
// history, and the Referer header. Today that text is a fixed marketing prompt —
// but the mechanism would put ANY future free-text (i.e. patient symptoms = PHI)
// straight into a logged URL.
//
// Fix: the URL carries only an opaque, fixed prompt ID from this allowlist
// (`/chat?prompt=chip1`). The chat page maps the ID back to the localized text
// client-side, so no free text — and no PHI — can ever reach the URL.

import type { TranslationKey } from '@/i18n';

/** Allowed chat prompt IDs → their i18n key. IDs are stable + opaque. */
export const CHAT_PROMPTS = {
  chip1: 'home.chip1',
  chip2: 'home.chip2',
  chip3: 'home.chip3',
} as const satisfies Record<string, TranslationKey>;

export type ChatPromptId = keyof typeof CHAT_PROMPTS;

/** Narrow an untrusted `?prompt=` value to a known ID (anything else is ignored). */
export function isChatPromptId(value: string | null | undefined): value is ChatPromptId {
  return !!value && Object.prototype.hasOwnProperty.call(CHAT_PROMPTS, value);
}
