-- Notification inline actor attribution (audit, HIPAA §164.312(b), Humaira
-- Activity 1). Additive + nullable — existing rows stay valid (NULL = actor
-- unknown at write time). Auto-populated forward by the access-log Prisma
-- extension (sentByActorId / sentByActorType) and by dispatchers (dispatchTrigger).

-- AlterTable
ALTER TABLE "Notification"
  ADD COLUMN "sentByActorId" TEXT,
  ADD COLUMN "sentByActorType" TEXT,
  ADD COLUMN "dispatchTrigger" TEXT;
