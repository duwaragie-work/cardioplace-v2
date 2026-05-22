// Limits for patient-entered journal free-text. Single source of truth shared
// by the patient check-in (Flow B step 5), the readings edit modal, and the
// backend CreateJournalEntryDto validation — so the client-side clamp/counter
// and the server-side @MaxLength guard can never drift apart.

/** Max characters for the free-text "Notes" field (JournalEntry.notes). */
export const JOURNAL_NOTE_MAX_LENGTH = 1000

/** Max characters for a single patient-typed custom symptom chip. */
export const JOURNAL_CUSTOM_SYMPTOM_MAX_LENGTH = 120

/** Max number of custom symptom chips per reading (JournalEntry.otherSymptoms). */
export const JOURNAL_CUSTOM_SYMPTOMS_MAX_COUNT = 20
