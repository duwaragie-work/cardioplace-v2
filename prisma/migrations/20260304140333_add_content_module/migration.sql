-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('ARTICLE', 'TIP', 'FAQ');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PARTIALLY_APPROVED', 'PUBLISHED', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "ReviewType" AS ENUM ('EDITORIAL', 'CLINICAL');

-- CreateEnum
CREATE TYPE "ReviewOutcome" AS ENUM ('APPROVED', 'APPROVED_WITH_MINOR_REVISIONS', 'REJECTED');

-- CreateTable
CREATE TABLE "Content" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contentType" "ContentType" NOT NULL,
    "body" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "author" TEXT,
    "submittedById" TEXT NOT NULL,
    "tags" TEXT[],
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "ratingAvg" DOUBLE PRECISION DEFAULT 0,
    "ratingsCount" INTEGER NOT NULL DEFAULT 0,
    "mediaUrl" TEXT,
    "lastReviewed" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
CREATE INDEX "ContentVersion_isPublished_idx" ON "ContentVersion"("isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "ContentVersion_contentId_versionNo_key" ON "ContentVersion"("contentId", "versionNo");

-- CreateIndex
CREATE INDEX "ContentView_contentId_idx" ON "ContentView"("contentId");

-- CreateIndex
CREATE INDEX "ContentView_userId_idx" ON "ContentView"("userId");

-- CreateIndex
CREATE INDEX "ContentView_viewedAt_idx" ON "ContentView"("viewedAt");

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
