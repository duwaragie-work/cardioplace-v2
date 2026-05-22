-- Per-medication status snapshot (taken / missed / scheduledLater) for EVERY
-- answered medication on a reading, not just the missed ones. Lets the readings
-- edit modal + detail view reconstruct each med's exact answer on reopen — the
-- aggregate medicationTaken + medicationScheduledLater booleans can't tell
-- "med A taken" from "med B not due yet". Additive + nullable: existing rows
-- stay valid and the rule engine (which reads medicationTaken +
-- missedMedications) is unaffected.
ALTER TABLE "JournalEntry" ADD COLUMN "medicationStatuses" JSONB;
