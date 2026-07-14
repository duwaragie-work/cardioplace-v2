-- Patient biometric sign-in (WebAuthn / passkeys — Face ID / fingerprint).
-- Optional convenience layer on top of OTP; OTP stays the fallback. One row
-- per registered authenticator (1:many with User) — a patient may enable it
-- on more than one device. The challenge is carried in a short-lived signed
-- JWT during each ceremony, so no challenge table is needed. Self-contained:
-- the FK lives on the child side, so there is no ALTER on "User".

CREATE TABLE "WebAuthnCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "deviceType" TEXT,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "deviceName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "WebAuthnCredential_pkey" PRIMARY KEY ("id")
);

-- Login looks the credential up by its authenticator-assigned id.
CREATE UNIQUE INDEX "WebAuthnCredential_credentialId_key" ON "WebAuthnCredential"("credentialId");

-- Serves "list this patient's registered devices" + the per-user lookup.
CREATE INDEX "WebAuthnCredential_userId_idx" ON "WebAuthnCredential"("userId");

ALTER TABLE "WebAuthnCredential"
    ADD CONSTRAINT "WebAuthnCredential_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
