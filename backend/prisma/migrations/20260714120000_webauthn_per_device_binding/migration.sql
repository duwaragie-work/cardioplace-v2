-- Per-device biometric binding (2026-07-14).
--
-- Biometric (WebAuthn) becomes a second factor ONLY on the device that
-- registered it. Each credential now records the `x-device-id` of the browser
-- it was created on. At sign-in we challenge biometric only when the incoming
-- deviceId has a credential for that user; signing in from any OTHER device
-- falls back to OTP / magic-link and never prompts. The patient can enable
-- biometric for the new device separately, from Settings.
--
-- Existing rows get deviceId = NULL ("not bound to a device"). Those are never
-- challenged — a deliberate fail-open matching the opt-in posture, so nobody is
-- locked out by this migration. Those patients simply re-enable biometric on
-- whichever device they want it on.

ALTER TABLE "WebAuthnCredential" ADD COLUMN "deviceId" TEXT;

-- Sign-in hot path: "does THIS device hold a passkey for this user?"
CREATE INDEX "WebAuthnCredential_userId_deviceId_idx"
    ON "WebAuthnCredential"("userId", "deviceId");
