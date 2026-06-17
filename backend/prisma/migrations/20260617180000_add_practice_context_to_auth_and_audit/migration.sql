-- Practice-context attribution (Manisha 2026-06-12 Access Control §1).
-- HIPAA 45 CFR §164.312(a)(2)(i) — unique attribution by acting practice
-- when a provider is a member of more than one. NULL on existing rows
-- (pre-policy events stay unattributed; do not infer from membership).

-- AuthSession: which practice the user is acting as for this session.
ALTER TABLE "AuthSession" ADD COLUMN "activePracticeId" TEXT;
ALTER TABLE "AuthSession"
  ADD CONSTRAINT "AuthSession_activePracticeId_fkey"
  FOREIGN KEY ("activePracticeId") REFERENCES "Practice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AuthLog: practice attribution per auth event.
ALTER TABLE "AuthLog" ADD COLUMN "practiceContext" TEXT;
CREATE INDEX "AuthLog_practiceContext_createdAt_idx"
  ON "AuthLog"("practiceContext", "createdAt");

-- EscalationEvent: practice context of the actor at ack/resolve time.
ALTER TABLE "EscalationEvent" ADD COLUMN "actorPracticeContext" TEXT;
CREATE INDEX "EscalationEvent_actorPracticeContext_triggeredAt_idx"
  ON "EscalationEvent"("actorPracticeContext", "triggeredAt" DESC);

-- DeviationAlert: practice context of the actor at ack/resolve time.
-- (Creation has no actor — cron-fired alerts leave this NULL.)
ALTER TABLE "DeviationAlert" ADD COLUMN "actorPracticeContext" TEXT;

-- ProfileVerificationLog: practice attribution per verification action.
ALTER TABLE "ProfileVerificationLog" ADD COLUMN "practiceContext" TEXT;
CREATE INDEX "ProfileVerificationLog_practiceContext_createdAt_idx"
  ON "ProfileVerificationLog"("practiceContext", "createdAt");
