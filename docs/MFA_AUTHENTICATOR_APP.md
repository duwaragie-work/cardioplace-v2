# MFA — Authenticator App

## What is MFA?

MFA (Multi-Factor Authentication) is a security method that requires **two or more forms of verification** before allowing access to an account or system.

Instead of relying only on a password, MFA combines different factors:

- **Something you know** – Password, PIN
- **Something you have** – Phone, security key, authenticator app
- **Something you are** – Fingerprint, face recognition

**Example:**

1. Enter password → first factor
2. Enter code from authenticator app → second factor

Even if someone steals your password, they usually cannot log in without the second factor.

## Why is MFA used?

MFA helps protect against:

- Stolen passwords
- Phishing attacks
- Credential leaks
- Unauthorized access
- Account takeovers

Many security standards and organizations require MFA because passwords alone are no longer considered sufficiently secure.

## When is MFA used?

- Work Systems
- Banking & Finance
- Personal Accounts
- High-Security Actions

## Types of MFA Methods

| Method | Example |
|---|---|
| SMS OTP | Code sent by text message |
| Email OTP | Code sent by email |
| Authenticator App | Google Authenticator, Microsoft Authenticator |
| Push Notification | Approve sign-in on phone |
| Hardware Token | YubiKey, RSA Token |
| Biometrics | Fingerprint, Face ID |

## What is an Authenticator?

An Authenticator is an application or device that provides the **second authentication factor** for MFA.

Instead of receiving a code via SMS, the app generates secure codes or sends approval requests.

**Popular authenticator apps:**

- Microsoft Authenticator
- Google Authenticator
- Authy
- Duo Mobile
- 2FAS

## How does an Authenticator work?

### Setup

1. Sign in to a system.
2. Enable MFA.
3. Scan a QR code using the authenticator app.
4. The app stores a secret key securely.

### Login

1. Enter username and password.
2. Open the authenticator app.
3. Enter the 6-digit code shown in the app (or approve a notification).
4. Access is granted.

**Example:**

```
Microsoft 365 Login

Username: lakshitha@company.com
Password: ********

Enter MFA code:
482913
```

The code changes every 30 seconds.

## TOTP Libraries

**TOTP = Time-Based One-Time Password**

This is the standard used by Google Authenticator, Microsoft Authenticator, Authy, etc.

### Common libraries

**Node.js / JavaScript**

```bash
npm install otplib qrcode
```

Common choices:

- **otplib** – generate/verify OTP codes
- **speakeasy** – older but popular
- **qrcode** – generate QR code for authenticator setup

**Python**

```bash
pip install pyotp qrcode
```

Common choices:

- **pyotp** – generate/verify OTP codes
- **qrcode** – generate QR code

**Java**

Common choices:

- java-otp
- GoogleAuthenticator
- TOTP libraries using `javax.crypto`

**PHP**

Common choices:

- pragmarx/google2fa
- sonata-project/google-authenticator

**.NET / C#**

Common choices:

- Otp.NET
- ASP.NET Identity built-in MFA support

### What the library gives you

A TOTP library usually provides:

- **Secret key generation**

  ```
  JBSWY3DPEHPK3PXP
  ```

- **Authenticator app URL**

  ```
  otpauth://totp/MyApp:user@email.com?secret=...&issuer=MyApp
  ```

- **QR code support**

  The user scans this QR code using Google Authenticator or Microsoft Authenticator.

- **OTP verification**

  User enters:

  ```
  482913
  ```

  Your backend checks whether the code is valid.

### Typical flow

1. User enables MFA.
2. Backend generates a secret.
3. Save the secret against the user.
4. Show QR code.
5. User scans QR code in Authenticator app.
6. User enters the 6-digit code.
7. Backend verifies it.
8. MFA is enabled.

### Example stack

For a Node.js backend:

```bash
npm install otplib qrcode
```

Use:

- **otplib** for TOTP generation/verification
- **qrcode** to display setup QR
- **database** to store user MFA secret
- **backup codes** for recovery

### Important security note

Store the MFA secret securely. Ideally **encrypt it in the database**. Also provide **backup codes**, because users can lose their phone.

---

# Our Implementation (Cardioplace Admin)

Everything above is the general theory. This section documents **how we actually built it** in this codebase, method by method.

## Who gets the authenticator app?

TOTP MFA is for **privileged staff roles only** — `PROVIDER`, `MEDICAL_DIRECTOR`, `COORDINATOR`, `HEALPLACE_OPS`, `SUPER_ADMIN` (the `MFA_REQUIRED_ROLES` list). The check is a single helper, `requiresMfa(roles)`. Patients never use TOTP — they get **biometric (WebAuthn)** instead. So this whole flow is in the **admin app**, not the patient app.

## The building blocks

| Piece | What it is |
|---|---|
| **`TotpCredential`** (DB table) | One row per user. Holds `secretEncrypted`, `enrolledAt`, `mfaResetByAdminAt`. |
| **`MfaRecoveryCode`** (DB table) | The backup codes — stored as **bcrypt hashes** only, with `usedAt` for one-time use. |
| **`mfa_enroll` JWT** | A short-lived signed token that **carries the secret** during setup (so nothing is stored until the user proves it works). |
| **`mfa_challenge` JWT** | A short-lived token used at sign-in (carries `userId` + `activePracticeId`). |
| **`MfaService`** | Pure crypto — `generateSecret`, `buildProvisioningUri`, `buildQrDataUrl`, `verifyCode`, `encryptSecret`/`decryptSecret`, `generateRecoveryCodes`. Uses `otplib` + `qrcode`. No DB, no HTTP (easy to unit-test). |
| **`EncryptionService`** | AES encryption for the secret, keyed by the env var `MFA_ENCRYPTION_KEY` (64 hex chars). |
| **`MFA_ENFORCEMENT_ENABLED`** + **`MfaRequiredGuard`** | The on/off switch that *forces* enrollment and blocks other routes until the user enrolls. |

---

## Scenario 1 — Enroll (set up the authenticator)

This is the flow that turns MFA **on** for a staff account: generate a secret, show a QR code, verify the first 6-digit code, then hand the user their recovery codes.

### Where the user enters this flow

All paths land on the same page — `admin/src/app/sign-in/mfa-enroll/page.tsx` — which has **three internal steps**: `intro → verify → recovery`.

- **Voluntary** — from Settings → "Set up" → `/sign-in/mfa-enroll`
- **Forced** — `/sign-in/mfa-enroll?required=1` (enforcement is on and the user hasn't enrolled; the sign-in page redirected them here)
- **Re-enroll** — `/sign-in/mfa-enroll?reEnroll=1` (after an admin reset / recovery sign-in)

The page sits under `/sign-in/*` so the app shell renders it **chrome-free** (no sidebar or top bar). It only ever calls the enroll endpoints, which the `MfaRequiredGuard` always allows — so it still loads even when every other route is blocked for a not-yet-enrolled user.

### Step A — "Begin setup": generate the secret + QR

**Frontend:** `begin()` → `startEnrollment()` → `POST /api/v2/auth/mfa/enroll/start`
(authenticated — the JWT bearer + cookie are attached automatically).

**Backend:** `startTotpEnrollment(userId)` does:

1. Load the user's `email` + `roles`.
2. **Guard:** if `!requiresMfa(roles)` → `403 Forbidden`. A non-privileged account can't enroll.
3. `generateSecret()` → a fresh base32 TOTP secret (e.g. `JBSWY3DPEHPK3PXP`).
4. `buildProvisioningUri(email, secret, issuer)` → the `otpauth://totp/Cardioplace:email?secret=...&issuer=Cardioplace` string that authenticator apps understand.
5. `buildQrDataUrl(uri)` → that URI rendered as a scannable **PNG data URL**.
6. `signEnrollmentToken(userId, secret)` → an `mfa_enroll` JWT that **contains the secret**.
7. Audit-log `mfa_enrollment_started`.

**Returns:** `{ provisioningUri, qrCodeDataUrl, enrollmentToken }`

> **Key logic:** nothing is written to the database yet. The secret only lives inside the signed token. This is safe because the QR code already shows the secret to the user, and it keeps the server **stateless** (works across multiple backend instances — no need to remember a pending secret).

### Step B — scan + verify the first code

**Frontend (`verify` step):**

- Shows the QR image (`qrCodeDataUrl`).
- Also shows a **manual key** for users who can't scan — `secretFromUri()` pulls the `?secret=` value out of the provisioning URI.
- The user adds it to Google/Microsoft Authenticator, types the **6-digit code**, and submits.
- `completeEnrollment(enrollmentToken, code)` → `POST /api/v2/auth/mfa/enroll/complete`.

**Backend:** `completeTotpEnrollment(userId, enrollmentToken, code)` does:

1. `verifyEnrollmentToken(token, userId)` → decode the `mfa_enroll` JWT, confirm `kind` + that it belongs to this user, and **pull the secret back out**.
   - Expired/invalid → `400 Bad Request` ("Enrollment session expired — restart MFA setup").
2. `verifyCode(secret, code)` → check the 6 digits, allowing **±1 time-step (±30s)** for clock drift (`window: 1`).
   - **Wrong code** → log `mfa_enrollment_failed` → `400 Bad Request`. The UI clears the field and the user retries (still Step B, same token).
3. **On success:**
   - `generateRecoveryCodes()` → 10 codes in two forms: `plain` (`XXXXX-XXXXX`, shown once) and `hashes` (bcrypt, stored).
   - `encryptSecret(secret)` → AES envelope (via `MFA_ENCRYPTION_KEY`).
   - **One database transaction:**
     - `totpCredential.upsert` → `{ secretEncrypted, enrolledAt: now, mfaResetByAdminAt: null }`
       *(the `null` clears any earlier admin-reset flag — this is what makes the re-enroll path clean)*
     - `mfaRecoveryCode.deleteMany({ userId, usedAt: null })` → remove any leftover unused codes
     - `mfaRecoveryCode.createMany(hashes)` → store the 10 new hashes
   - Audit-log `mfa_enrollment_completed`.

**Returns:** `{ recoveryCodes: plain }` — the **only** moment the plaintext codes ever exist.

> **Key logic:** the secret is persisted **only after** the first code verifies. If the user abandons setup after Step A, nothing is stored — the token simply expires. After this step `enrolledAt` is set, so the next sign-in will start asking for an MFA code (Scenario 3).

### Step C — show the recovery codes once

**Frontend (`recovery` step):**

- Displays the 10 codes with **Copy** and **Download** (`cardioplace-recovery-codes.txt`).
- An "I've saved my recovery codes" checkbox gates the **Done** button.
- **Done** → `/dashboard`.

The plaintext codes are **never retrievable again** — only bcrypt hashes remain. If the user wants a fresh set later, that's the separate **Regenerate recovery codes** action in Settings.

### The whole chain at a glance

```
Begin setup
  → startEnrollment → POST /mfa/enroll/start → startTotpEnrollment
      → requiresMfa? → generateSecret → provisioning URI → QR → sign mfa_enroll token
      → DB: nothing yet

Scan + enter code
  → completeEnrollment → POST /mfa/enroll/complete → completeTotpEnrollment
      → verifyEnrollmentToken (get secret back) → verifyCode (±30s)
      → encryptSecret + generateRecoveryCodes (plain + hashes)
      → DB transaction: upsert TotpCredential(enrolledAt), replace MfaRecoveryCode hashes
      → returns 10 plaintext codes ONCE

Show 10 recovery codes → Copy / Download → Done → /dashboard
```

### Why it's designed this way (the 3 guarantees)

1. **Secret persisted only after proof** — abandoning setup stores nothing; the token just expires.
2. **Stateless** — no pending secret/challenge kept server-side, so it scales across instances.
3. **Recovery codes are write-once** — shown a single time, stored only as bcrypt hashes.

---

## Scenario 2 — Forced enrollment (enforcement is on, user hasn't enrolled)

Scenario 1 is the *act* of enrolling. Scenario 2 is what **drives a user into it** once `MFA_ENFORCEMENT_ENABLED=true`: a privileged user who hasn't set up MFA is not allowed to use the app until they do.

There are **two layers** that make this happen — one at sign-in (proactive) and one on every request (the safety net).

### Layer 1 — caught at sign-in (the nice path)

**Backend:** when `verifyOtp()` succeeds it calls `shouldForceMfaEnrollment(userId, roles)`, which returns `true` when **all** of these hold:

- `MFA_ENFORCEMENT_ENABLED === 'true'`
- `requiresMfa(roles)` (a privileged role)
- the user has **no `enrolledAt`** (never finished setup)

If so, the normal auth response is returned **with an extra flag**: `{ ...tokens, mfaEnrollmentRequired: true }`.

> **Key logic:** tokens *are* issued here (unlike the challenge in Scenario 3). That's deliberate — the session has to be valid so the enroll endpoints work. The frontend just doesn't *use* the session for the dashboard yet.

**Frontend (`admin/src/app/sign-in/page.tsx`):**

```
forceEnroll = data.mfaEnrollmentRequired
if (forceEnroll) skipAuthedRedirect.current = true   // don't flash the dashboard
login(data)                                           // store the session
router.push('/sign-in/mfa-enroll?required=1')         // go straight to setup
```

So the user lands on the enroll page (Scenario 1, `?required=1`) **before the dashboard ever renders**.

### Layer 2 — the safety net on every request (`MfaRequiredGuard`)

What if the user navigates directly to `/patients` by URL, or skips the redirect? A global guard catches it.

**`MfaRequiredGuard.canActivate()`** runs after auth on every request:

1. If `MFA_ENFORCEMENT_ENABLED !== 'true'` → allow (the feature is "dark" until cutover).
2. If the route is `@Public()` → allow.
3. If the user's role isn't in `MFA_REQUIRED_ROLES` → allow.
4. If the path is **always-allowed** (`/auth/mfa/enroll*` or `/auth/logout`) → allow — so a blocked user can still finish setup or sign out.
5. Look up `TotpCredential.enrolledAt`. If set → allow.
6. Otherwise → `403 Forbidden` with `errorCode: 'mfa_enrollment_required'`.

**Frontend (`token.ts`):** every API call checks for that 403. When it sees `errorCode === 'mfa_enrollment_required'` and isn't already on the enroll page, it hard-redirects to `/sign-in/mfa-enroll?required=1`.

> **Key logic:** the guard is **gated entirely by the env flag**, so it can be deployed "dark" and flipped on at cutover (after existing testers have enrolled) — no code change. The always-allowed list is what stops a redirect loop: the enroll endpoints themselves must never be blocked.

### The whole chain at a glance

```
Sign in (OTP)
  → verifyOtp → shouldForceMfaEnrollment? (enforcement + requiresMfa + no enrolledAt)
      → returns { ...tokens, mfaEnrollmentRequired: true }
  → FE: login(session) → push /sign-in/mfa-enroll?required=1   (Scenario 1)

Any other route while not enrolled
  → MfaRequiredGuard → 403 { errorCode: 'mfa_enrollment_required' }
  → FE token.ts → redirect to /sign-in/mfa-enroll?required=1
```

---

## Scenario 3 — Normal sign-in challenge (already enrolled)

Once a user has `enrolledAt` set, every sign-in asks for their 6-digit code as a **second factor** — after the OTP first factor, before any tokens are issued.

### Step 1 — first factor returns a challenge, not tokens

**Backend:** `verifyOtp()` → `shouldChallengeMfa(userId, roles)` returns `true` when `requiresMfa(roles)` **and** the user has a `TotpCredential` with `enrolledAt` set. If so, instead of the token pair it returns:

```
{ status: 'MFA_REQUIRED', challengeToken }
```

`challengeToken` is a signed `mfa_challenge` JWT (`signMfaChallenge`) carrying `userId` + `activePracticeId`, with a **5-minute TTL**.

> **Key logic:** no tokens are issued at this point — the user is only half-authenticated. The challenge token is the "ticket" that proves the first factor passed, and it remembers which practice they were signing into.

**Frontend (`admin/src/app/sign-in/page.tsx`):** sees `status === 'MFA_REQUIRED'`, stashes the `challengeToken` in `sessionStorage` (key `cp_admin_mfa_challenge`), and routes to `/sign-in/mfa-challenge`.

### Step 2 — verify the authenticator code

**Frontend (`mfa-challenge` page):** reads the stashed token, the user types the 6-digit code → `verifyChallenge(token, code)` → `POST /api/v2/auth/mfa/challenge`.

**Backend `mfaChallenge(challengeToken, code)`:**

1. `verifyMfaChallenge(token)` → decode the `mfa_challenge` JWT, get `userId` + `activePracticeId` (expired/invalid → `401`).
2. `assertNotMfaLocked(userId)` → throttle check (see below).
3. Load `TotpCredential`; if no `enrolledAt`/secret → `400` ("MFA is not set up").
4. `decryptSecret(secretEncrypted)` → the real secret.
5. `verifyCode(secret, code)`:
   - **wrong** → log `mfa_challenge_failed` (`invalid_code`) → `401` ("Invalid code"). The UI clears the field; the user retries.
   - **right** → `issueTokenPair()` + set cookies, log `mfa_challenge_succeeded`.

**Frontend:** on success, `login(data)` → `/dashboard`.

### The lockout logic (brute-force protection)

`assertNotMfaLocked()` counts recent `mfa_challenge_failed` rows in `AuthLog`:

| Tier | Trigger | Result |
|---|---|---|
| **Soft lock** | 5 failures / 15 min | `403 mfa_locked_temporary` — "wait a few minutes or use a recovery code" (recovery still works) |
| **Hard lock** | 10 failures / 1 hour | `403 mfa_locked_admin` — only an **admin reset** clears it |

> **Key logic:** the counter is derived from audit logs, not a separate column — every failed attempt is already recorded, so the lock is just a `count()` over a time window. Soft lock is self-healing (wait it out); hard lock needs a human.

### The whole chain at a glance

```
Sign in (OTP)
  → verifyOtp → shouldChallengeMfa? (requiresMfa + enrolledAt)
      → returns { status: 'MFA_REQUIRED', challengeToken }
  → FE: stash token → /sign-in/mfa-challenge

Enter 6-digit code
  → verifyChallenge → POST /mfa/challenge → mfaChallenge
      → verifyMfaChallenge → assertNotMfaLocked → decryptSecret → verifyCode
      → issueTokenPair + cookies
  → FE: login → /dashboard
```

---

## Scenario 4 — Sign in with a recovery code (lost the phone)

If the user can't reach their authenticator app, they use one of the **10 one-time recovery codes** from enrollment. This is reached from the same challenge page via "Use a recovery code instead".

### The flow

**Frontend (`mfa-challenge` page, `recovery` mode):** the user types a code (`XXXXX-XXXXX`) → `verifyRecovery(token, code)` → `POST /api/v2/auth/mfa/recovery`.

**Backend `mfaRecovery(challengeToken, recoveryCode)`:**

1. `verifyMfaChallenge(token)` → get `userId` + `activePracticeId` (same challenge token as Scenario 3).
2. Load the user's **unused** `MfaRecoveryCode` rows (`usedAt: null`).
3. Loop and `verifyRecoveryCode(entered, row.codeHash)` (bcrypt compare, formatting-insensitive) to find a match.
   - **no match** → log `mfa_challenge_failed` (`invalid_recovery_code`) → `401` ("Invalid or already-used recovery code").
4. **match** → `mfaRecoveryCode.update({ usedAt: now })` — **burn that one code** (one-time use).
5. `issueTokenPair()` + cookies, log `mfa_recovery_code_used`.

**Frontend:** on success, `login(data)` → `/dashboard`.

> **Key logic:** a recovery sign-in **does not reset or rotate the authenticator** — the TOTP secret is left intact and only the single code is consumed. The reasoning: a user who merely can't reach their phone *right now* shouldn't be forced to re-enroll; someone who truly lost the device re-enrolls themselves from Settings, and someone who lost the device **and** the codes needs an admin reset (Scenario 6).
>
> (The admin FE has a dormant `forceReEnroll` branch from an earlier design; the current backend never sets it, so a recovery sign-in simply lands on the dashboard.)

### The whole chain at a glance

```
On the challenge page → "Use a recovery code instead"
  → verifyRecovery → POST /mfa/recovery → mfaRecovery
      → verifyMfaChallenge → find unused codes → bcrypt match
      → burn matched code (usedAt = now) → issueTokenPair + cookies
  → FE: login → /dashboard
  (authenticator secret stays intact — codes get fewer by one)
```

When the user runs low on codes, they regenerate a fresh set of 10 from Settings (Scenario 6).

---

## Scenario 5 — Admin reset (the escape hatch)

The recovery path for when a user has lost **both** their authenticator app **and** their recovery codes — or got **hard-locked** (Scenario 3). They can't get in alone, so a senior admin wipes their MFA and they set it up fresh on next sign-in.

### Who can do it

Only `SUPER_ADMIN` / `HEALPLACE_OPS` (enforced by `@Roles(...)` on the endpoint). And **never on yourself** — self-reset is explicitly blocked.

### Where it starts

Admin app → **User management** → pick the affected user → "Reset MFA" → opens `ResetMfaModal`:

- Requires a typed **reason** (min 3 chars) — the confirm button is disabled until it's filled.
- **Amber** chrome, not red — it's framed as a *recovery* action, not a destructive one.
- On confirm → `resetUserMfa(userId, reason)` → `POST /api/v2/auth/admin/mfa/reset/:userId`.

### Backend `adminResetMfa(actorId, targetUserId, reason)`

1. **Self-reset guard:** if `actorId === targetUserId` → `403 Forbidden` ("ask another administrator").
2. Load the target user (`id`, `email`, `name`); not found → `404`.
3. **One transaction:**
   - `totpCredential.updateMany` → `{ secretEncrypted: '', enrolledAt: null, mfaResetByAdminAt: now }`
   - `mfaRecoveryCode.deleteMany({ usedAt: null })` → remove their unused codes
4. Audit-log `mfa_reset_by_admin` with `metadata: { resetBy: actorId, reason }`.
5. **Email the user** ("Your two-factor authentication was reset").
6. Return a friendly message.

### What happens next

`enrolledAt` is now `null`, so the user's **next sign-in hits Scenario 2** (forced enrollment) and they re-enroll from scratch — new secret, new QR, new recovery codes.

### Key logic (the "why")

- **Row is updated, not deleted** — keeping the `TotpCredential` row preserves `mfaResetByAdminAt` as a permanent audit marker (who/when an admin intervened).
- **Reason is required + audited** — every reset records *who* did it and *why*. No silent resets.
- **No self-reset** — forces a *second human* into the loop. A compromised admin session can't clear its own MFA, and an admin can't quietly weaken their own account.
- **User gets emailed** — if a reset wasn't expected, the real owner finds out immediately (tamper detection).
- **Unused recovery codes are wiped too** — otherwise old codes from the previous secret would still work after a "fresh" reset.

### The whole chain at a glance

```
User mgmt → Reset MFA (reason) → ResetMfaModal
  → resetUserMfa → POST /admin/mfa/reset/:userId   (@Roles SUPER_ADMIN/HEALPLACE_OPS)
  → adminResetMfa
      → block self-reset → load target
      → DB tx: TotpCredential{secret:'', enrolledAt:null, mfaResetByAdminAt:now}
               + delete unused MfaRecoveryCode
      → audit mfa_reset_by_admin(resetBy, reason) → email user
Next sign-in → enrolledAt is null → Scenario 2 (forced re-enroll)
```

---

## Scenario 6 — Regenerate recovery codes (from Settings)

A user who's running low on codes (or wants a fresh set after using a few) can generate 10 new ones themselves — no admin needed. This **replaces** all their old codes.

### Where it starts

Admin app → **Settings → Security**. The "Recovery codes" button only appears when MFA is actually enabled (`mfaEnabled`, from Scenario 7). Clicking it opens `RecoveryCodesModal`, which has two phases:

- **confirm** — warns "this replaces your existing codes"
- **codes** — shows the new 10 with Copy / Download

On confirm → `regenerateRecoveryCodes()` → `POST /api/v2/auth/mfa/recovery-codes/regenerate`.

### Backend `regenerateRecoveryCodes(userId)`

1. Load `TotpCredential`; if **not enrolled** (`enrolledAt == null`) → `400 Bad Request` ("Set up two-factor authentication before generating recovery codes").
2. `generateRecoveryCodes()` → 10 fresh codes (`plain` + bcrypt `hashes`).
3. **One transaction:**
   - `mfaRecoveryCode.deleteMany({ userId })` → delete **ALL** prior codes (used **and** unused)
   - `mfaRecoveryCode.createMany(hashes)` → insert the 10 new hashes
4. Audit-log `mfa_recovery_regenerated`.
5. Return `{ recoveryCodes: plain }` — shown once.

### Key logic (the "why")

- **Deletes used codes too**, not just unused. The new set fully replaces the old, so a printout from before can *never* be reused.
- **Requires enrollment** — you can't have recovery codes without an authenticator to recover *into*.
- **Write-once, same as enrollment** — plaintext shown once, only hashes persisted.
- **Doesn't touch the secret** — the authenticator app keeps working; only the backup codes change.

### The whole chain at a glance

```
Settings → Security → Recovery codes → RecoveryCodesModal (confirm)
  → regenerateRecoveryCodes → POST /mfa/recovery-codes/regenerate
  → regenerateRecoveryCodes(userId)
      → require enrolledAt → generate 10 new (plain + hashes)
      → DB tx: delete ALL MfaRecoveryCode + insert 10 new hashes
      → audit mfa_recovery_regenerated → return 10 plaintext codes ONCE
Modal shows codes → Copy / Download → Done
```

---

## Scenario 7 — Show MFA status (the Settings pill)

The Settings → Security card shows whether two-factor is on, and offers the right action. It's read-only status — there's no "turn off" toggle, because MFA is **mandatory** for these roles.

### The flow

Admin app → **Settings** → `getMyProfile()` → `GET /api/v2/auth/profile` → `getProfile(userId)`.

`getProfile` looks up the user's `TotpCredential` and returns two extra fields:

- **`mfaEnabled`** = `true` when a `TotpCredential` row has `enrolledAt` set (mirrors `shouldChallengeMfa`).
- **`mfaRequired`** = `requiresMfa(roles)` — whether the role is under the enforced-MFA policy.

### What the UI shows

| State | Pill | Primary action | Extra action |
|---|---|---|---|
| `mfaEnabled` | green **Enabled ✓** | "Reset authenticator" (→ enroll page) | "Recovery codes" (Scenario 6) |
| not enabled, `mfaRequired` | amber **Setup required** | "Set up" (→ enroll page) | — |
| not enabled, not required | amber **Not set up** | "Set up" | — |

### Key logic (the "why")

- **No disable toggle.** For `requiresMfa` roles MFA can't be turned off — so the UI only ever shows *status + set-up/reset*, never an off switch. Showing a fake toggle would imply you can opt out, which you can't.
- **Status is derived, not stored separately.** "Enabled" is simply "does a credential with `enrolledAt` exist" — the same source of truth the sign-in gate uses, so the pill can never disagree with reality.

### The whole chain at a glance

```
Open Settings
  → getMyProfile → GET /auth/profile → getProfile
      → look up TotpCredential
      → returns mfaEnabled (enrolledAt?) + mfaRequired (requiresMfa)
  → UI renders Enabled / Setup required / Not set up + the matching buttons
```

---

# How TOTP actually works (the algorithm)

A natural question: the **authenticator app** and the **server** never talk to each other after setup — so how do they always show/accept the *same* 6-digit code? The answer is the **TOTP algorithm** (RFC 6238). Both sides compute the code independently from two ingredients they both have.

## The two shared ingredients

1. **The secret** — the base32 key created at enrollment. The app stored it (from the QR), and we stored it encrypted in `TotpCredential.secretEncrypted`. **Both sides know it.**
2. **The current time** — both the phone and the server have a clock. Time is "public" — they don't need to share it.

Because they share the **same secret** and read the **same time**, they each derive the **same code** — without ever exchanging it.

## The math, step by step

```
1. counter = floor(currentUnixTime / 30)      ← which 30-second "slot" are we in
2. hash    = HMAC-SHA1(secret, counter)        ← keyed hash → 20 bytes
3. offset  = last nibble of hash               ← "dynamic truncation" pointer
4. number  = 4 bytes of hash starting at offset (top bit masked off)
5. code    = number % 1,000,000                ← keep 6 digits → e.g. 482913
```

- **Step 1** turns time into a counter that changes once every 30 seconds. That's why the code rotates every 30s and why both sides land on the same counter at the same moment.
- **Step 2** mixes the secret into the counter with HMAC-SHA1. Without the secret you can't produce this — that's the security.
- **Steps 3–5** squeeze the 20-byte hash down to a readable 6-digit number (RFC 4226 "dynamic truncation").

This is the **RFC 6238 default** every authenticator app expects: **6 digits, 30-second step, SHA-1**. In our code, `MfaService` sets exactly these via `otplib`.

## How verification works (and clock drift)

When the user types `482913`:

- The **server** runs the same 5 steps with the stored secret and *its own* clock, then checks if the result matches.
- `MfaService.verifyCode()` calls `authenticator.verify({ token, secret })` configured with **`window: 1`**.

`window: 1` means the server also checks the **previous** and **next** 30-second slot (±30s), not just the current one. This tolerates small **clock drift** between the phone and the server — if the phone is a few seconds fast/slow, the code still verifies.

## Why this design is safe

- **The code is never sent over the network by the server** — only the user typing it in. There's nothing to intercept on the way to the phone.
- **Codes expire in ~30 seconds**, so even a captured code is useless almost immediately.
- **The secret never leaves storage** — it's encrypted at rest (`MFA_ENCRYPTION_KEY`) and only decrypted in memory for the `verify` math.
- **Replay within the window** is bounded by the short TTL plus the lockout counter (Scenario 3).

## One-line summary

> Both the app and the server hold the **same secret** and read the **same clock**, so each independently computes `HMAC-SHA1(secret, time/30)` → 6 digits. They never exchange the code; they just both *know how to derive it*. The server checks ±1 step to forgive clock drift.
