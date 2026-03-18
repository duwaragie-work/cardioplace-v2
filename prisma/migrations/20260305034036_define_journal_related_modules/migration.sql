-- CreateEnum
CREATE TYPE "DeviationType" AS ENUM ('SLEEP_HOURS', 'SLEEP_QUALITY', 'AWAKENINGS');

-- CreateEnum
CREATE TYPE "DeviationSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "EscalationLevel" AS ENUM ('LEVEL_1', 'LEVEL_2');

-- CreateTable
CREATE TABLE "BaselineSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "computedForDate" DATE NOT NULL,
    "baselineSleepHours" DECIMAL(5,2),
    "baselineSleepQuality" DECIMAL(4,2),
    "baselineAwakenings" DECIMAL(4,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BaselineSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "sleepHours" DECIMAL(4,2) NOT NULL,
    "sleepQuality" INTEGER NOT NULL,
    "awakenings" INTEGER NOT NULL,
    "notes" TEXT,
    "snapshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviationAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "type" "DeviationType" NOT NULL,
    "severity" "DeviationSeverity" NOT NULL,
    "magnitude" DECIMAL(6,2) NOT NULL,
    "baselineValue" DECIMAL(6,2),
    "actualValue" DECIMAL(6,2),
    "consecutiveDays" INTEGER NOT NULL DEFAULT 1,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "DeviationAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationEvent" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "escalationLevel" "EscalationLevel" NOT NULL,
    "reason" TEXT,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notificationSentAt" TIMESTAMP(3),

    CONSTRAINT "EscalationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "alertId" TEXT,
    "escalationEventId" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tips" TEXT[],
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BaselineSnapshot_userId_computedForDate_idx" ON "BaselineSnapshot"("userId", "computedForDate" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "BaselineSnapshot_userId_computedForDate_key" ON "BaselineSnapshot"("userId", "computedForDate");

-- CreateIndex
CREATE INDEX "JournalEntry_userId_entryDate_idx" ON "JournalEntry"("userId", "entryDate" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_userId_entryDate_key" ON "JournalEntry"("userId", "entryDate");

-- CreateIndex
CREATE INDEX "DeviationAlert_userId_createdAt_idx" ON "DeviationAlert"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "DeviationAlert_userId_status_createdAt_idx" ON "DeviationAlert"("userId", "status", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "DeviationAlert_journalEntryId_type_key" ON "DeviationAlert"("journalEntryId", "type");

-- CreateIndex
CREATE INDEX "EscalationEvent_alertId_triggeredAt_idx" ON "EscalationEvent"("alertId", "triggeredAt" DESC);

-- CreateIndex
CREATE INDEX "EscalationEvent_userId_triggeredAt_idx" ON "EscalationEvent"("userId", "triggeredAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_userId_sentAt_idx" ON "Notification"("userId", "sentAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "BaselineSnapshot" ADD CONSTRAINT "BaselineSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "BaselineSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviationAlert" ADD CONSTRAINT "DeviationAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviationAlert" ADD CONSTRAINT "DeviationAlert_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationEvent" ADD CONSTRAINT "EscalationEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "DeviationAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationEvent" ADD CONSTRAINT "EscalationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "DeviationAlert"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_escalationEventId_fkey" FOREIGN KEY ("escalationEventId") REFERENCES "EscalationEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
