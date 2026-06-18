-- Concurrent-session enforcement (Manisha 2026-06-12 Doc 2 Q1) +
-- idle-timeout activity tracking (Doc 3 Q7). 1:1 with RefreshToken.

CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenId" TEXT NOT NULL,
    "deviceType" TEXT,
    "deviceId" TEXT,
    "deviceName" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthSession_refreshTokenId_key" ON "AuthSession"("refreshTokenId");
CREATE INDEX "AuthSession_userId_lastActivityAt_idx" ON "AuthSession"("userId", "lastActivityAt");
CREATE INDEX "AuthSession_userId_createdAt_idx" ON "AuthSession"("userId", "createdAt");

ALTER TABLE "AuthSession"
    ADD CONSTRAINT "AuthSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuthSession"
    ADD CONSTRAINT "AuthSession_refreshTokenId_fkey"
    FOREIGN KEY ("refreshTokenId") REFERENCES "RefreshToken"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
