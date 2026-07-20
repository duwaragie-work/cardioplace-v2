// V-audit §1 — regression guards for the "no PHI/PII in URLs" fixes.
//
// These lock the SECURITY contract: the chat prompt param is an opaque
// allowlisted ID (never free text → never PHI), and the support-email prefill
// travels in sessionStorage (never a query param) and is one-shot.

import { CHAT_PROMPTS, isChatPromptId } from './chat-prompts';
import { stashSupportEmail, takeSupportEmail } from './support-prefill';

describe('chat-prompts allowlist (1.9)', () => {
  it('accepts only the known prompt IDs', () => {
    for (const id of Object.keys(CHAT_PROMPTS)) {
      expect(isChatPromptId(id)).toBe(true);
    }
  });

  it('rejects free text (the PHI-leak vector) and junk', () => {
    // The exact thing the old ?q= carried — must never be treated as a prompt.
    expect(isChatPromptId('My blood pressure is 180/110')).toBe(false);
    expect(isChatPromptId('')).toBe(false);
    expect(isChatPromptId(null)).toBe(false);
    expect(isChatPromptId(undefined)).toBe(false);
    // Prototype keys must not sneak through the `in`-style check.
    expect(isChatPromptId('toString')).toBe(false);
    expect(isChatPromptId('constructor')).toBe(false);
  });

  it('maps each ID to an i18n key, not literal text', () => {
    for (const key of Object.values(CHAT_PROMPTS)) {
      expect(key.startsWith('home.chip')).toBe(true);
    }
  });
});

describe('support-email prefill (1.5)', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('round-trips a trimmed email via sessionStorage', () => {
    stashSupportEmail('  patient@example.com  ');
    expect(takeSupportEmail()).toBe('patient@example.com');
  });

  it('is one-shot — a second read is empty (no lingering PII)', () => {
    stashSupportEmail('patient@example.com');
    expect(takeSupportEmail()).toBe('patient@example.com');
    expect(takeSupportEmail()).toBe('');
  });

  it('stores nothing for a blank email', () => {
    stashSupportEmail('   ');
    expect(window.sessionStorage.length).toBe(0);
    expect(takeSupportEmail()).toBe('');
  });

  it('never uses a URL/query — value lives only in sessionStorage', () => {
    stashSupportEmail('patient@example.com');
    // The whole point: it is in storage, and the caller reads it from there.
    expect(window.sessionStorage.getItem('cp_support_prefill_email')).toBe(
      'patient@example.com',
    );
  });
});
