// Single source of truth for the legal-document version a patient agrees to
// at sign-in. Bump this string whenever the Terms of Service or Privacy Policy
// text changes — patients then re-acknowledge the new version and the backend
// records a fresh PolicyAcknowledgment row (one per user per version).
export const POLICY_VERSION = '2026-05-25';

export const POLICY_TYPE = {
  TERMS_AND_PRIVACY: 'TERMS_AND_PRIVACY',
} as const;

export type PolicyType = (typeof POLICY_TYPE)[keyof typeof POLICY_TYPE];
