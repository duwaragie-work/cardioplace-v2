import type { TranslationKey } from "@/i18n";

// Map known backend English messages to translation keys. Stored at module
// level so the lookup is independent of language — callers translate the
// returned key via t() at render time, which re-runs on language switch.
export const BACKEND_MSG_KEY_MAP: Record<string, TranslationKey> = {
  'OTP sent successfully': 'register.otpSentSuccess',
  'Please wait 60 seconds before requesting a new OTP': 'register.pleaseWait',
  'Invalid OTP': 'register.invalidOtp',
  'Verification failed': 'register.verificationFailed',
  // Admin-app gate (auth.service.ts assertAdminAccessAllowed). Both rejection
  // paths — unknown email and known email without an admin role — collapse
  // to one friendly "no permission" message.
  'No admin account exists for this email': 'register.adminAccessDenied',
  'This account is not authorized to access the admin app': 'register.adminAccessDenied',
  'Account is suspended': 'register.accountSuspended',
  'Account is blocked': 'register.accountBlocked',
  'Account is deactivated': 'register.accountDeactivated',
};

export function backendMsgToKey(msg: string | undefined): TranslationKey | null {
  if (!msg) return null;
  for (const [en, key] of Object.entries(BACKEND_MSG_KEY_MAP)) {
    if (msg.includes(en)) return key;
  }
  return null;
}
