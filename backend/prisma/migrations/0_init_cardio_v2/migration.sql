-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('ARTICLE', 'TIP', 'FAQ');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PARTIALLY_APPROVED', 'PUBLISHED', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "ContentRevisionStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PARTIALLY_APPROVED');

-- CreateEnum
CREATE TYPE "ReviewType" AS ENUM ('EDITORIAL', 'CLINICAL');

-- CreateEnum
CREATE TYPE "ReviewOutcome" AS ENUM ('APPROVED', 'APPROVED_WITH_MINOR_REVISIONS', 'REJECTED');

-- CreateEnum
CREATE TYPE "Position" AS ENUM ('SITTING', 'STANDING', 'LYING');

-- CreateEnum
CREATE TYPE "DeviationType" AS ENUM ('SYSTOLIC_BP', 'DIASTOLIC_BP', 'WEIGHT', 'MEDICATION_ADHERENCE');

-- CreateEnum
CREATE TYPE "DeviationSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'EMAIL', 'PHONE', 'DASHBOARD');

-- CreateEnum
CREATE TYPE "EscalationLevel" AS ENUM ('LEVEL_1', 'LEVEL_2');

-- CreateEnum
CREATE TYPE "CommunicationPreference" AS ENUM ('TEXT_FIRST', 'AUDIO_FIRST');

-- CreateEnum
CREATE TYPE "EntrySource" AS ENUM ('MANUAL', 'HEALTHKIT');

-- CreateEnum
CREATE TYPE "AlertTier" AS ENUM ('TIER_1_CONTRAINDICATION', 'TIER_2_DISCREPANCY', 'TIER_3_INFO', 'BP_LEVEL_1_HIGH', 'BP_LEVEL_1_LOW', 'BP_LEVEL_2', 'BP_LEVEL_2_SYMPTOM_OVERRIDE');

-- CreateEnum
CREATE TYPE "AlertMode" AS ENUM ('STANDARD', 'PERSONALIZED');

-- CreateEnum
CREATE TYPE "LadderStep" AS ENUM ('T0', 'T4H', 'T8H', 'T24H', 'T48H', 'TIER2_48H', 'TIER2_7D', 'TIER2_14D');

-- CreateEnum
CREATE TYPE "DrugClass" AS ENUM ('ACE_INHIBITOR', 'ARB', 'BETA_BLOCKER', 'DHP_CCB', 'NDHP_CCB', 'LOOP_DIURETIC', 'THIAZIDE', 'MRA', 'SGLT2', 'ANTICOAGULANT', 'STATIN', 'ANTIARRHYTHMIC', 'VASODILATOR_NITRATE', 'ARNI', 'OTHER_UNVERIFIED');

-- CreateEnum
CREATE TYPE "MedicationFrequency" AS ENUM ('ONCE_DAILY', 'TWICE_DAILY', 'THREE_TIMES_DAILY', 'UNSURE');

-- CreateEnum
CREATE TYPE "MedicationSource" AS ENUM ('PATIENT_SELF_REPORT', 'PROVIDER_ENTERED', 'PATIENT_VOICE', 'PATIENT_PHOTO');

-- CreateEnum
CREATE TYPE "MedicationVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED', 'AWAITING_PROVIDER');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "HeartFailureType" AS ENUM ('HFREF', 'HFPEF', 'UNKNOWN', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ProfileVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'CORRECTED');

-- CreateEnum
CREATE TYPE "VerifierRole" AS ENUM ('PATIENT', 'ADMIN', 'PROVIDER');

-- CreateEnum
CREATE TYPE "VerificationChangeType" AS ENUM ('PATIENT_REPORT', 'ADMIN_VERIFY', 'ADMIN_CORRECT', 'ADMIN_REJECT');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('UPCOMING', 'COMPLETED', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PATIENT', 'PROVIDER', 'MEDICAL_DIRECTOR', 'HEALPLACE_OPS', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_COMPLETED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'SUSPENDED');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "email" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthLog" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "identifier" TEXT,
    "userId" TEXT,
    "method" TEXT,
    "deviceId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Content" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contentType" "ContentType" NOT NULL,
    "body" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "author" TEXT,
    "humanId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "tags" TEXT[],
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedVersionNo" INTEGER,
    "reviewVersionNo" INTEGER,
    "revisionStatus" "ContentRevisionStatus",
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "ratingAvg" DOUBLE PRECISION DEFAULT 0,
    "ratingsCount" INTEGER NOT NULL DEFAULT 0,
    "mediaUrl" TEXT,
    "lastReviewed" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentAuditLog" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "actorId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentRating" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ratingValue" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentReview" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "reviewType" "ReviewType" NOT NULL,
    "outcome" "ReviewOutcome" NOT NULL,
    "notes" TEXT,
    "reviewedById" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentVersion" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "changeReason" TEXT,
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentView" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "userId" TEXT,
    "deviceId" TEXT,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userMessage" TEXT NOT NULL,
    "aiSummary" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'text',
    "embedding" vector(384),
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "systolicBP" INTEGER,
    "diastolicBP" INTEGER,
    "pulse" INTEGER,
    "weight" DECIMAL(65,30),
    "position" "Position",
    "sessionId" TEXT,
    "measurementConditions" JSONB,
    "medicationTaken" BOOLEAN,
    "missedDoses" INTEGER DEFAULT 0,
    "severeHeadache" BOOLEAN NOT NULL DEFAULT false,
    "visualChanges" BOOLEAN NOT NULL DEFAULT false,
    "alteredMentalStatus" BOOLEAN NOT NULL DEFAULT false,
    "chestPainOrDyspnea" BOOLEAN NOT NULL DEFAULT false,
    "focalNeuroDeficit" BOOLEAN NOT NULL DEFAULT false,
    "severeEpigastricPain" BOOLEAN NOT NULL DEFAULT false,
    "newOnsetHeadache" BOOLEAN NOT NULL DEFAULT false,
    "ruqPain" BOOLEAN NOT NULL DEFAULT false,
    "edema" BOOLEAN NOT NULL DEFAULT false,
    "otherSymptoms" TEXT[],
    "teachBackAnswer" TEXT,
    "teachBackCorrect" BOOLEAN,
    "notes" TEXT,
    "source" "EntrySource" NOT NULL DEFAULT 'MANUAL',
    "sourceMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "platform" TEXT,
    "deviceType" TEXT,
    "deviceName" TEXT,
    "userAgent" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviationAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "type" "DeviationType",
    "severity" "DeviationSeverity",
    "magnitude" DECIMAL(6,2),
    "baselineValue" DECIMAL(6,2),
    "actualValue" DECIMAL(6,2),
    "tier" "AlertTier",
    "ruleId" TEXT,
    "mode" "AlertMode",
    "pulsePressure" INTEGER,
    "suboptimalMeasurement" BOOLEAN NOT NULL DEFAULT false,
    "patientMessage" TEXT,
    "caregiverMessage" TEXT,
    "physicianMessage" TEXT,
    "dismissible" BOOLEAN NOT NULL DEFAULT true,
    "resolutionAction" TEXT,
    "resolutionRationale" TEXT,
    "resolvedBy" TEXT,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "DeviationAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceFormat" TEXT NOT NULL,
    "sourceSize" INTEGER NOT NULL,
    "sourceChunkCount" INTEGER NOT NULL,
    "sourceResourceLink" TEXT NOT NULL,
    "sourceTags" TEXT[],
    "sourceActiveStatus" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVector" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(384),
    "documentId" TEXT NOT NULL,
    "sourceActiveStatus" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DocumentVector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "prompt" TEXT NOT NULL,
    "isEmergency" BOOLEAN NOT NULL,
    "emergency_situation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmergencyEvent_pkey" PRIMARY KEY ("id")
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
    "ladderStep" "LadderStep",
    "recipientIds" TEXT[],
    "recipientRoles" TEXT[],
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "notificationChannel" "NotificationChannel",
    "afterHours" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "EscalationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MagicLink" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MagicLink_pkey" PRIMARY KEY ("id")
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

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientMedication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "drugName" TEXT NOT NULL,
    "drugClass" "DrugClass" NOT NULL,
    "isCombination" BOOLEAN NOT NULL DEFAULT false,
    "combinationComponents" TEXT[],
    "frequency" "MedicationFrequency" NOT NULL,
    "source" "MedicationSource" NOT NULL,
    "verificationStatus" "MedicationVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedByAdminId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "discontinuedAt" TIMESTAMP(3),
    "rawInputText" TEXT,
    "notes" TEXT,

    CONSTRAINT "PatientMedication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gender" "Gender",
    "heightCm" INTEGER,
    "isPregnant" BOOLEAN NOT NULL DEFAULT false,
    "pregnancyDueDate" TIMESTAMP(3),
    "historyPreeclampsia" BOOLEAN NOT NULL DEFAULT false,
    "hasHeartFailure" BOOLEAN NOT NULL DEFAULT false,
    "heartFailureType" "HeartFailureType" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "hasAFib" BOOLEAN NOT NULL DEFAULT false,
    "hasCAD" BOOLEAN NOT NULL DEFAULT false,
    "hasHCM" BOOLEAN NOT NULL DEFAULT false,
    "hasDCM" BOOLEAN NOT NULL DEFAULT false,
    "hasTachycardia" BOOLEAN NOT NULL DEFAULT false,
    "hasBradycardia" BOOLEAN NOT NULL DEFAULT false,
    "diagnosedHypertension" BOOLEAN NOT NULL DEFAULT false,
    "profileVerificationStatus" "ProfileVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "profileVerifiedAt" TIMESTAMP(3),
    "profileVerifiedBy" TEXT,
    "profileLastEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientProviderAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "primaryProviderId" TEXT NOT NULL,
    "backupProviderId" TEXT NOT NULL,
    "medicalDirectorId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientProviderAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientThreshold" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sbpUpperTarget" INTEGER,
    "sbpLowerTarget" INTEGER,
    "dbpUpperTarget" INTEGER,
    "dbpLowerTarget" INTEGER,
    "hrUpperTarget" INTEGER,
    "hrLowerTarget" INTEGER,
    "setByProviderId" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "PatientThreshold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Practice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessHoursStart" TEXT NOT NULL,
    "businessHoursEnd" TEXT NOT NULL,
    "businessHoursTimezone" TEXT NOT NULL,
    "afterHoursProtocol" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Practice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileVerificationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fieldPath" TEXT NOT NULL,
    "previousValue" JSONB,
    "newValue" JSONB,
    "changedBy" TEXT NOT NULL,
    "changedByRole" "VerifierRole" NOT NULL,
    "changeType" "VerificationChangeType" NOT NULL,
    "discrepancyFlag" BOOLEAN NOT NULL DEFAULT false,
    "rationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileVerificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledCall" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "alertId" TEXT,
    "callDate" TEXT NOT NULL,
    "callTime" TEXT NOT NULL,
    "callType" TEXT NOT NULL,
    "notes" TEXT,
    "status" "CallStatus" NOT NULL DEFAULT 'UPCOMING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "userId" TEXT,
    "summary" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "pwdhash" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "timezone" TEXT,
    "communicationPreference" "CommunicationPreference",
    "preferredLanguage" TEXT DEFAULT 'en',
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "roles" "UserRole"[] DEFAULT ARRAY['PATIENT']::"UserRole"[],
    "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'NOT_COMPLETED',
    "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerId_key" ON "Account"("provider", "providerId");

-- CreateIndex
CREATE INDEX "AuthLog_userId_idx" ON "AuthLog"("userId");

-- CreateIndex
CREATE INDEX "AuthLog_identifier_idx" ON "AuthLog"("identifier");

-- CreateIndex
CREATE INDEX "AuthLog_event_idx" ON "AuthLog"("event");

-- CreateIndex
CREATE INDEX "AuthLog_createdAt_idx" ON "AuthLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Content_humanId_key" ON "Content"("humanId");

-- CreateIndex
CREATE INDEX "Content_contentType_idx" ON "Content"("contentType");

-- CreateIndex
CREATE INDEX "Content_status_idx" ON "Content"("status");

-- CreateIndex
CREATE INDEX "Content_needsReview_idx" ON "Content"("needsReview");

-- CreateIndex
CREATE INDEX "Content_lastReviewed_idx" ON "Content"("lastReviewed");

-- CreateIndex
CREATE INDEX "Content_submittedById_idx" ON "Content"("submittedById");

-- CreateIndex
CREATE INDEX "Content_deletedAt_idx" ON "Content"("deletedAt");

-- CreateIndex
CREATE INDEX "ContentAuditLog_contentId_idx" ON "ContentAuditLog"("contentId");

-- CreateIndex
CREATE INDEX "ContentAuditLog_event_idx" ON "ContentAuditLog"("event");

-- CreateIndex
CREATE INDEX "ContentAuditLog_createdAt_idx" ON "ContentAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "ContentRating_contentId_idx" ON "ContentRating"("contentId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentRating_contentId_userId_key" ON "ContentRating"("contentId", "userId");

-- CreateIndex
CREATE INDEX "ContentReview_contentId_idx" ON "ContentReview"("contentId");

-- CreateIndex
CREATE INDEX "ContentReview_versionNo_idx" ON "ContentReview"("versionNo");

-- CreateIndex
CREATE INDEX "ContentReview_reviewedById_idx" ON "ContentReview"("reviewedById");

-- CreateIndex
CREATE INDEX "ContentVersion_contentId_idx" ON "ContentVersion"("contentId");

-- CreateIndex
CREATE INDEX "ContentVersion_isDraft_idx" ON "ContentVersion"("isDraft");

-- CreateIndex
CREATE INDEX "ContentVersion_isPublished_idx" ON "ContentVersion"("isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "ContentVersion_contentId_versionNo_key" ON "ContentVersion"("contentId", "versionNo");

-- CreateIndex
CREATE INDEX "ContentView_contentId_idx" ON "ContentView"("contentId");

-- CreateIndex
CREATE INDEX "ContentView_userId_idx" ON "ContentView"("userId");

-- CreateIndex
CREATE INDEX "ContentView_viewedAt_idx" ON "ContentView"("viewedAt");

-- CreateIndex
CREATE INDEX "Conversation_sessionId_idx" ON "Conversation"("sessionId");

-- CreateIndex
CREATE INDEX "JournalEntry_userId_measuredAt_idx" ON "JournalEntry"("userId", "measuredAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_userId_measuredAt_key" ON "JournalEntry"("userId", "measuredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Device_deviceId_key" ON "Device"("deviceId");

-- CreateIndex
CREATE INDEX "DeviationAlert_userId_createdAt_idx" ON "DeviationAlert"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "DeviationAlert_userId_status_createdAt_idx" ON "DeviationAlert"("userId", "status", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "DeviationAlert_journalEntryId_type_key" ON "DeviationAlert"("journalEntryId", "type");

-- CreateIndex
CREATE INDEX "EmergencyEvent_userId_idx" ON "EmergencyEvent"("userId");

-- CreateIndex
CREATE INDEX "EmergencyEvent_sessionId_idx" ON "EmergencyEvent"("sessionId");

-- CreateIndex
CREATE INDEX "EscalationEvent_alertId_triggeredAt_idx" ON "EscalationEvent"("alertId", "triggeredAt" DESC);

-- CreateIndex
CREATE INDEX "EscalationEvent_userId_triggeredAt_idx" ON "EscalationEvent"("userId", "triggeredAt" DESC);

-- CreateIndex
CREATE INDEX "MagicLink_email_idx" ON "MagicLink"("email");

-- CreateIndex
CREATE INDEX "MagicLink_tokenHash_idx" ON "MagicLink"("tokenHash");

-- CreateIndex
CREATE INDEX "MagicLink_expiresAt_idx" ON "MagicLink"("expiresAt");

-- CreateIndex
CREATE INDEX "Notification_userId_sentAt_idx" ON "Notification"("userId", "sentAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "OtpCode_email_idx" ON "OtpCode"("email");

-- CreateIndex
CREATE INDEX "OtpCode_expiresAt_idx" ON "OtpCode"("expiresAt");

-- CreateIndex
CREATE INDEX "PatientMedication_userId_discontinuedAt_idx" ON "PatientMedication"("userId", "discontinuedAt");

-- CreateIndex
CREATE INDEX "PatientMedication_userId_verificationStatus_idx" ON "PatientMedication"("userId", "verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PatientProfile_userId_key" ON "PatientProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientProviderAssignment_userId_key" ON "PatientProviderAssignment"("userId");

-- CreateIndex
CREATE INDEX "PatientProviderAssignment_practiceId_idx" ON "PatientProviderAssignment"("practiceId");

-- CreateIndex
CREATE INDEX "PatientProviderAssignment_primaryProviderId_idx" ON "PatientProviderAssignment"("primaryProviderId");

-- CreateIndex
CREATE INDEX "PatientProviderAssignment_backupProviderId_idx" ON "PatientProviderAssignment"("backupProviderId");

-- CreateIndex
CREATE INDEX "PatientProviderAssignment_medicalDirectorId_idx" ON "PatientProviderAssignment"("medicalDirectorId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientThreshold_userId_key" ON "PatientThreshold"("userId");

-- CreateIndex
CREATE INDEX "ProfileVerificationLog_userId_createdAt_idx" ON "ProfileVerificationLog"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ScheduledCall_userId_status_idx" ON "ScheduledCall"("userId", "status");

-- CreateIndex
CREATE INDEX "ScheduledCall_status_callDate_idx" ON "ScheduledCall"("status", "callDate");

-- CreateIndex
CREATE INDEX "ScheduledCall_alertId_idx" ON "ScheduledCall"("alertId");

-- CreateIndex
CREATE INDEX "Session_id_idx" ON "Session"("id");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "UserDevice_userId_idx" ON "UserDevice"("userId");

-- CreateIndex
CREATE INDEX "UserDevice_deviceId_idx" ON "UserDevice"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "UserDevice_userId_deviceId_key" ON "UserDevice"("userId", "deviceId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthLog" ADD CONSTRAINT "AuthLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentAuditLog" ADD CONSTRAINT "ContentAuditLog_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRating" ADD CONSTRAINT "ContentRating_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRating" ADD CONSTRAINT "ContentRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentReview" ADD CONSTRAINT "ContentReview_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentReview" ADD CONSTRAINT "ContentReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentVersion" ADD CONSTRAINT "ContentVersion_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentView" ADD CONSTRAINT "ContentView_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviationAlert" ADD CONSTRAINT "DeviationAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviationAlert" ADD CONSTRAINT "DeviationAlert_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVector" ADD CONSTRAINT "DocumentVector_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationEvent" ADD CONSTRAINT "EscalationEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "DeviationAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationEvent" ADD CONSTRAINT "EscalationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "DeviationAlert"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_escalationEventId_fkey" FOREIGN KEY ("escalationEventId") REFERENCES "EscalationEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientMedication" ADD CONSTRAINT "PatientMedication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientProfile" ADD CONSTRAINT "PatientProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientProviderAssignment" ADD CONSTRAINT "PatientProviderAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientProviderAssignment" ADD CONSTRAINT "PatientProviderAssignment_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientProviderAssignment" ADD CONSTRAINT "PatientProviderAssignment_primaryProviderId_fkey" FOREIGN KEY ("primaryProviderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientProviderAssignment" ADD CONSTRAINT "PatientProviderAssignment_backupProviderId_fkey" FOREIGN KEY ("backupProviderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientProviderAssignment" ADD CONSTRAINT "PatientProviderAssignment_medicalDirectorId_fkey" FOREIGN KEY ("medicalDirectorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientThreshold" ADD CONSTRAINT "PatientThreshold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileVerificationLog" ADD CONSTRAINT "ProfileVerificationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledCall" ADD CONSTRAINT "ScheduledCall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledCall" ADD CONSTRAINT "ScheduledCall_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "DeviationAlert"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDevice" ADD CONSTRAINT "UserDevice_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDevice" ADD CONSTRAINT "UserDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
