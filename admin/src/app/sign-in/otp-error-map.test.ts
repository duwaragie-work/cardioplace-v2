import { backendMsgToKey, BACKEND_MSG_KEY_MAP } from './otp-error-map';
import en from '@/i18n/en';
import es from '@/i18n/es';
import fr from '@/i18n/fr';
import de from '@/i18n/de';
import am from '@/i18n/am';

const LOCALES: [string, Record<string, string>][] = [
  ['en', en as Record<string, string>],
  ['es', es as Record<string, string>],
  ['fr', fr as Record<string, string>],
  ['de', de as Record<string, string>],
  ['am', am as Record<string, string>],
];

describe('backendMsgToKey', () => {
  it('maps a deactivated-account rejection to a clear message key', () => {
    // The OTP-send endpoint throws `Account is ${status.toLowerCase()}` — a
    // deactivated staff/admin must see the friendly message, not the generic
    // "Failed to request OTP." fallback the sign-in page uses when this returns
    // null.
    expect(backendMsgToKey('Account is deactivated')).toBe(
      'register.accountDeactivated',
    );
  });

  it('matches on substring so a wrapped Nest error message still maps', () => {
    expect(
      backendMsgToKey('Forbidden: Account is deactivated'),
    ).toBe('register.accountDeactivated');
  });

  it('returns null for an unknown message (page falls back to failedOtp)', () => {
    expect(backendMsgToKey('Some brand-new backend error')).toBeNull();
    expect(backendMsgToKey(undefined)).toBeNull();
  });

  it('every mapped translation key exists in all locales', () => {
    const keys = Object.values(BACKEND_MSG_KEY_MAP);
    for (const [locale, dict] of LOCALES) {
      for (const key of keys) {
        // Empty string → missing translation. Surface locale+key on failure.
        if (!dict[key]) {
          throw new Error(`missing "${key}" in locale "${locale}"`);
        }
        expect(dict[key]).toBeTruthy();
      }
    }
  });
});
