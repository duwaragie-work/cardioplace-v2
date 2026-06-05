-- May 2026 — user management & invite flow:
--   * UserRole enum: add COORDINATOR (front-desk staff who enroll patients)
--   * AccountStatus enum: add DEACTIVATED (soft-delete state)
--   * PracticeCoordinator: one practice per coordinator (@unique userId).
--     Relax later by dropping the unique constraint if real staff need to
--     cover multiple practices.
--   * UserInvite: pending email invitations issued by COORDINATOR /
--     HEALPLACE_OPS / SUPER_ADMIN. Token is sha256-hashed; the raw token
--     only exists in the activation URL we email. createdUserId back-fills
--     once the invite is accepted so we can audit who came in via which invite.

-- ── 1. UserRole enum: add COORDINATOR (between MEDICAL_DIRECTOR and OPS) ────
ALTER TYPE "UserRole" ADD VALUE 'COORDINATOR' BEFORE 'HEALPLACE_OPS';

-- ── 2. AccountStatus enum: add DEACTIVATED (soft-delete state) ──────────────
ALTER TYPE "AccountStatus" ADD VALUE 'DEACTIVATED';

-- ── 3. PracticeCoordinator table ────────────────────────────────────────────
CREATE TABLE "PracticeCoordinator" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeCoordinator_pkey" PRIMARY KEY ("id")
);

-- One practice per coordinator (v1 design decision — drop to enable multi-site).
CREATE UNIQUE INDEX "PracticeCoordinator_userId_key"
    ON "PracticeCoordinator"("userId");

CREATE INDEX "PracticeCoordinator_practiceId_idx"
    ON "PracticeCoordinator"("practiceId");

ALTER TABLE "PracticeCoordinator"
    ADD CONSTRAINT "PracticeCoordinator_practiceId_fkey"
    FOREIGN KEY ("practiceId") REFERENCES "Practice"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PracticeCoordinator"
    ADD CONSTRAINT "PracticeCoordinator_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 4. UserInvite table ─────────────────────────────────────────────────────
CREATE TABLE "UserInvite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "practiceId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdUserId" TEXT,

    CONSTRAINT "UserInvite_pkey" PRIMARY KEY ("id")
);

-- Token hash is the lookup key on activation. createdUserId is 1:1 so an
-- accepted invite can't be claimed twice.
CREATE UNIQUE INDEX "UserInvite_tokenHash_key"
    ON "UserInvite"("tokenHash");

CREATE UNIQUE INDEX "UserInvite_createdUserId_key"
    ON "UserInvite"("createdUserId");

CREATE INDEX "UserInvite_email_idx"
    ON "UserInvite"("email");

CREATE INDEX "UserInvite_expiresAt_idx"
    ON "UserInvite"("expiresAt");

CREATE INDEX "UserInvite_invitedById_idx"
    ON "UserInvite"("invitedById");

CREATE INDEX "UserInvite_practiceId_idx"
    ON "UserInvite"("practiceId");

-- Inviter row is preserved on delete-restrict so the audit trail can't lose
-- its "invited by whom" anchor. Practice + createdUser dangle to NULL on
-- delete so we keep the historical invite record around.
ALTER TABLE "UserInvite"
    ADD CONSTRAINT "UserInvite_invitedById_fkey"
    FOREIGN KEY ("invitedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserInvite"
    ADD CONSTRAINT "UserInvite_practiceId_fkey"
    FOREIGN KEY ("practiceId") REFERENCES "Practice"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UserInvite"
    ADD CONSTRAINT "UserInvite_createdUserId_fkey"
    FOREIGN KEY ("createdUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
