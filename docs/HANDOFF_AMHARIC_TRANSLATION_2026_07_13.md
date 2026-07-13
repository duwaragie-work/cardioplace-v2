# Handoff: Amharic native-speaker translation for Reminder & Engagement copy

**Date:** 2026-07-13
**Track:** Nivakaran (Reminders) — spec §N10
**Blocker owner:** Duwaragie Kugaraj → external native-speaker translator
**Ship gate:** no `am`-locale patient can be onboarded until this handoff resolves

---

## Why this exists

The 2026-07-07 Final Engineering Specification (Reminder & Engagement Workflow, §N10) explicitly requires:

> **Amharic — native speaker ONLY. Never machine-translate.** It's the only non-Latin script in the set. Confirm all Amharic strings with a native speaker before shipping.

Amharic reminder + confirmation body strings currently ship with the **English fallback** in every code location that owns Amharic copy. Runtime behavior is safe — a patient whose `preferredLanguage='am'` sees English text — but the spec's shipping bar is not met until a native speaker signs off on the Amharic translations.

## What needs translation

Every occurrence marked `TODO(l10n-am)` in the following files. Translations must be **idiomatic** (spec §N9 note on the "that's okay" pattern generalises: literal Amharic can read dismissive where the English is reassuring). Reading level ≤5th grade.

### 1. `shared/src/alert-messages.ts`

Backend-rendered reminder bodies. Each function has an `am` branch currently pointing at the English string.

| Symbol | Purpose | Interpolation |
|---|---|---|
| `reminderGreeting(hour, 'am')` | Time-of-day opener: morning / midday / evening | `{hour}` |
| `reminderBodyDay1('am')` | Day-1 daily nudge (standard) | `{name}`, `{hour}` |
| `reminderBodyDay1Tts('am')` | Day-1 spoken variant (voice-first surface) | `{name}`, `{hour}` |
| `reminderBodyDay2('am')` | Day-2 gentle reminder | `{name}` |
| `reminderBodyDay3Plus('am')` | Day-3+ supportive-but-firmer tone (repeats daily) | `{name}` |
| `LOGGED_BASE.am` | "Logged ✓ — your reading has been recorded." | (none) |
| `LOGGED_POSITIVE_SUFFIX.am` | " Looking good — keep it up!" — appended for normal-range readings | (none) |

### 2. `frontend/src/i18n/am.ts`

Patient-facing UI strings for the Profile Reminders section and Onboarding step. Every key with a `TODO(l10n-am)` comment above it.

Representative keys:
- `profile.reminders.heading` / `editHeading`
- `profile.reminders.dailyTime`
- `profile.reminders.quietHoursHeading` / `startLabel` / `endLabel` / `quietHoursStart` / `quietHoursEnd`
- `profile.reminders.emergencyDisclaimer`
- `profile.reminders.saveButton` / `savingButton` / `cancelButton`
- `onboarding.reminders.timeLabel` / `timeAudio`
- `onboarding.reminders.quietHoursHeading` / `quietStartLabel` / `quietEndLabel`
- `onboarding.reminders.emergencyDisclaimer`

The English source-of-truth strings live in `frontend/src/i18n/en.ts` — grep for the same keys.

## Content principles (spec §N10)

1. Active voice
2. ≤15-word sentences
3. No jargon ("blood pressure" not "BP"; "medicine" not "medication")
4. Action-focused
5. Warm, not clinical
6. Non-judgmental
7. Autonomy-respecting
8. ≤5th-grade reading level
9. Idiomatic translations (not literal)
10. Native speaker verified

## How to update

1. Native speaker rewrites each `TODO(l10n-am)` string per the principles above.
2. In the code file, replace the English fallback with the verified Amharic string and **remove the TODO comment**.
3. Run `node frontend/scripts/check-i18n-drift.mjs` — must stay green.
4. Backend: no rebuild step needed for `shared/`; on branch, run `cd shared && npx tsc` if any function body changed structurally (translation-only edits inside string literals don't require rebuild for TypeScript, but Jest CI expects `dist/` to be current).
5. Commit as `chore(i18n-am): native-speaker Amharic translations for Reminder & Engagement`. Post to WhatsApp for Duwaragie to merge.

## Runtime safety while this is pending

- The reminder cron ships and runs; Amharic-locale patients receive English text (not "no reminder").
- The daily-reminder cron does not gate on locale — a missing Amharic string never blocks a dispatch.
- All emergency / Tier 1 / BP L2 paths bypass this layer entirely (see `backend/src/daily_journal/services/emergency-quiet-hours-invariant.spec.ts` for the machine-checkable invariant).

**Do not onboard an Amharic-locale patient onto the reminder feature until this handoff is closed.** The runtime is safe, but shipping English text to an Amharic-speaking patient breaks the trust principle the whole workflow rests on.
