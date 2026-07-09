-- N6 (2026-07-10) — §164.528 accounting-of-disclosures for outbound email.
--
-- One row per email that actually delivered through EmailService.sendEmail —
-- Resend or nodemailer resolved. Failed deliveries do NOT write a row.
--
-- FK to User("id") on patientUserId uses SET NULL on delete so a hard-deleted
-- patient keeps their disclosure history; mirrors the PatientCaregiver.userId
-- pattern already in the schema. Indices support the three canonical audit
-- queries: by-patient-timeline, by-recipient-timeline, by-template.

CREATE TABLE "EmailDisclosureLog" (
    "id" TEXT NOT NULL,
    "senderPrincipal" TEXT NOT NULL,
    "senderType" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "patientUserId" TEXT,
    "template" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "EmailDisclosureLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailDisclosureLog_patientUserId_sentAt_idx"
    ON "EmailDisclosureLog"("patientUserId", "sentAt");

CREATE INDEX "EmailDisclosureLog_recipientEmail_sentAt_idx"
    ON "EmailDisclosureLog"("recipientEmail", "sentAt");

CREATE INDEX "EmailDisclosureLog_template_sentAt_idx"
    ON "EmailDisclosureLog"("template", "sentAt");

ALTER TABLE "EmailDisclosureLog"
    ADD CONSTRAINT "EmailDisclosureLog_patientUserId_fkey"
    FOREIGN KEY ("patientUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
