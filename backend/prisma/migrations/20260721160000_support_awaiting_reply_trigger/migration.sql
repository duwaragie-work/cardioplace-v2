-- Nudge trigger for the "waiting on the patient" sweep: ops replied, the thread
-- went quiet, and we prompt the patient before the ticket drifts to auto-close.
--
-- Hand-authored and applied via `prisma migrate deploy` (NOT `migrate dev`):
-- the dev DB carries a benign drift — the HNSW vector index prisma.service.ts
-- creates at boot — and `migrate dev` reacts by offering to RESET the shared
-- dev DB. Additive + idempotent, matching the prior enum migrations here.

ALTER TYPE "NotificationTrigger" ADD VALUE IF NOT EXISTS 'SUPPORT_AWAITING_REPLY';
