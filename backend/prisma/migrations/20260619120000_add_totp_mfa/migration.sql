-- Provider/admin TOTP second factor (Manisha 2026-06-12 Access Control §6,
-- HIPAA 45 CFR §164.312(d)). Two self-contained tables — no ALTER on "User"
-- because both relations carry their FK on the child side.
--   * TotpCredential   — 1:1 authenticator secret per user (secret encrypted
--                        at rest via MFA_ENCRYPTION_KEY; never plaintext).
--   * MfaRecoveryCode  — 10 one-time backup codes per user (bcrypt hashed).
-- Patients leave both empty; their biometric arrives later in its own table.

-- ── 1. TotpCredential (1:1 with User) ───────────────────────────────────────
CREATE TABLE "TotpCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3),
    "mfaResetByAdminAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TotpCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TotpCredential_userId_key" ON "TotpCredential"("userId");

ALTER TABLE "TotpCredential"
    ADD CONSTRAINT "TotpCredential_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 2. MfaRecoveryCode (1:many with User) ───────────────────────────────────
CREATE TABLE "MfaRecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- Serves the "fetch this user's still-usable codes" lookup on the recovery path.
CREATE INDEX "MfaRecoveryCode_userId_usedAt_idx" ON "MfaRecoveryCode"("userId", "usedAt");

ALTER TABLE "MfaRecoveryCode"
    ADD CONSTRAINT "MfaRecoveryCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
