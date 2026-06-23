# Patient Biometric Authentication (WebAuthn / Passkeys)

Optional **second factor** for patients — Face ID / fingerprint / Windows Hello —
layered on top of the email OTP / magic-link first factor. Providers/admins use
TOTP instead (see `AUTH_MODULE.md`); this document is the patient biometric path.

---

## 1. Concepts

### SimpleWebAuthn (the library we use)

**SimpleWebAuthn** helps add **passkeys, fingerprints, Face ID, Windows Hello,
and security keys** to an app using the **WebAuthn standard**. Instead of
handling biometric data ourselves, we use it to:

- Register a user's fingerprint / Face ID
- Verify login requests
- Support passwordless or MFA authentication

> In short: a library that makes biometric and passkey authentication easy in
> web apps.

We use:
- **Backend** → `@simplewebauthn/server` (in `backend/src/auth/webauthn.service.ts`)
- **Patient app** → `@simplewebauthn/browser` (in `frontend/src/lib/services/webauthn.service.ts`)

### Biometric 👆🙂

A biometric is how the user proves they are the **owner of the device** —
fingerprint, Face ID, Windows Hello face scan, iris scan.

**Purpose: verify the human.**

```
Phone:  "Scan your fingerprint"
User:    places finger
Phone:  "Yes, it's you"
```

At this point the phone only knows the **person** is valid.

### Passkey 🔑

A passkey is a **digital credential stored securely on the device**.

| | |
|---|---|
| Password | secret text |
| Passkey | secret cryptographic key |

**Registration:**
```
App    → "create passkey"
Device → creates a private/public key pair
         · private key stays on the device (never leaves)
         · public key is sent to our server (stored)
```

**Login:**
```
Server → "prove who you are"
Device → signs a challenge with the private key
Server → verifies the signature with the stored public key
```

**Purpose: verify the account.** The biometric/PIN only unlocks the private key
locally — the biometric data itself never leaves the device.

### WebAuthn 🌐

WebAuthn is the **standard / protocol** that lets browsers and servers use
passkeys. It's the main standard for passkey- and biometric-based web auth.

```
Biometric = the fingerprint scanner
Passkey   = the digital key
WebAuthn  = the rules that let browser, device, and server talk
```

It's framework-agnostic (not tied to a language):

| Backend | Library |
|---|---|
| NestJS / Express | `@simplewebauthn/server` |
| Django | `django-webauthn` (or other WebAuthn libs) |
| Spring Boot | WebAuthn Java libraries |
| Laravel | WebAuthn PHP packages |
| ASP.NET | FIDO2 / WebAuthn libraries |

### The device chooses the method

WebAuthn provides the **mechanism**; the **OS / device decides which
authenticator** to use, based on what's available and configured by the user.
WebAuthn just asks the device to authenticate the user.

| Device | Method offered |
|---|---|
| iPhone | Face ID or Touch ID (depends on model) |
| Android | Fingerprint or supported face unlock |
| Windows | Windows Hello face, fingerprint, or PIN |
| Mac | Touch ID |
| Desktop | Security key, Windows Hello, external fingerprint reader, etc. |

We never code per-method — our options just request a **platform authenticator
with user verification required** (`backend/src/auth/webauthn.service.ts`), and
the OS picks Face ID / fingerprint / PIN itself.

### How a passkey travels between devices

| Scenario | How it works | Needs Bluetooth? |
|---|---|---|
| **Same device** (Face ID on the same phone) | local | No |
| **Same ecosystem** (passkey already synced to your other Apple/Google device) | cloud sync (iCloud Keychain / Google Password Manager) | No |
| **Cross-device** (scan a QR with your phone to sign in on a laptop) | "hybrid" transport | **Yes** |

For **cross-device / hybrid**: Bluetooth is only a **proximity check** to confirm
the two devices are physically near each other — the actual data goes over the
internet. This is why a desktop **without Bluetooth** can't complete the QR
flow, and why the **recovery code** is the universal fallback.

---

## 2. Scenario — Enable biometric (registration)

A signed-in patient turns on Face ID / fingerprint from **Settings**. Nothing
happens during sign-up or first login — enabling needs an existing session
(`JwtAuthGuard`), so a not-yet-signed-in user is never asked to set it up.

### The crypto in one picture

```
            ┌─────────────── DEVICE (phone / laptop) ───────────────┐
            │  Face ID / fingerprint / PIN unlocks the device only  │
            │                                                       │
   create → │   ┌──────────────┐        ┌──────────────┐           │
            │   │ PRIVATE KEY  │  pair  │  PUBLIC KEY  │           │
            │   │ never leaves │ ─────  │  safe to send│ ───────────┼──→ our server (DB)
            │   └──────────────┘        └──────────────┘           │
            └───────────────────────────────────────────────────────┘
```

- The **device** generates a brand-new public/private **key pair** for our site.
- The **private key never leaves the device** (and is itself locked behind the
  biometric/PIN). We never see it, and the fingerprint/face data never leaves
  the device either.
- The **public key** is sent to us and stored. It can only *verify* signatures,
  not create them — so it's harmless if leaked.
- A one-time random **challenge** ties each ceremony to *this* request so a
  response can't be replayed later.

### Why two round-trips (start → verify)

WebAuthn registration is always **two calls**: the server first hands out a
challenge + options (`start`), the device signs/creates against them, then the
server checks the result (`verify`). We keep the challenge **stateless** — it
rides inside a signed JWT (`registrationToken`, 10-min TTL) instead of a DB row,
so it works across backend instances and self-expires.

### Step-by-step flow

#### Pre-check (frontend)
`settings/page.tsx` → `isBiometricSupported()`:
- `browserSupportsWebAuthn()` — does the browser know WebAuthn at all?
- `platformAuthenticatorIsAvailable()` — does the device have a built-in
  biometric?

Both true → show **"Set up Face ID / fingerprint"**. Otherwise → hide it and
show a "not available on this device" note (the patient just keeps using OTP).

#### Step A — `start` (get the challenge + options)
`registerBiometric()` → `POST /api/v2/auth/webauthn/register/start` *(authed)*
→ `AuthService.startWebAuthnRegistration(userId)`:

| Call | What it does |
|---|---|
| `prisma.user.findUnique` | load the user; **assert role `PATIENT`** (providers use TOTP — 403 otherwise) |
| `prisma.webAuthnCredential.findMany` | existing passkeys → `excludeCredentials` so the same device can't register twice |
| `webAuthnService.randomChallenge()` | 32 random bytes → base64url (the one-time challenge) |
| `webAuthnService.buildRegistrationOptions()` → lib `generateRegistrationOptions` | builds the `create()` config: `rpID`/`rpName`, the challenge, **`authenticatorAttachment: 'platform'`** (built-in biometric, not a roaming key) and **`userVerification: 'required'`** (force the actual Face ID / fingerprint / PIN) |
| `signWebAuthnRegToken(userId, challenge)` | wraps the challenge in a signed JWT (`kind: 'webauthn_reg'`, 10 min) → `registrationToken` |
| `logAuthEvent('webauthn_registration_started')` | audit |

→ returns `{ options, registrationToken }`. **Nothing is saved yet.**

#### Step B — browser ceremony (create the passkey)
`startRegistration({ optionsJSON: options })` (`@simplewebauthn/browser`):
- the OS shows the **Face ID / fingerprint / PIN** prompt,
- the device **creates the key pair**, keeps the private key, and
- returns the **attestation** (`RegistrationResponseJSON`) — the new public key
  + a signature over the challenge.

#### Step C — `verify` (check + persist)
`POST /api/v2/auth/webauthn/register/verify { registrationToken, response, deviceName }`
*(authed)* → `AuthService.completeWebAuthnRegistration()`:

| Call | What it does |
|---|---|
| `verifyWebAuthnRegToken(token, userId)` | unwrap the challenge from the JWT; confirm it belongs to this user |
| `webAuthnService.verifyRegistration()` → lib `verifyRegistrationResponse` | validate the attestation against the **challenge + origin + RP id**. Fail → log `webauthn_registration_failed`, throw |
| `prisma.webAuthnCredential.findUnique({ credentialId })` | friendly dup-guard ("already registered") |
| `webAuthnService.encodePublicKey()` | COSE public-key bytes → base64url for storage |
| **`prisma.webAuthnCredential.create`** | **DB write** — the passkey row (see below) |
| `logAuthEvent('webauthn_registration_completed')` | audit |
| `prisma.webAuthnCredential.count` | if **`=== 1`** (this is the *first* passkey) → mint recovery codes |
| `issueRecoveryCodes(userId)` | `mfaService.generateRecoveryCodes()` → 10 codes; **DB write (txn):** `mfaRecoveryCode.deleteMany` + `createMany(hashes)`. Plaintext returned once, only **bcrypt hashes** stored |

→ returns `{ id, deviceName, recoveryCodes? }` (`recoveryCodes` present **only on
the first passkey**).

#### Finish (frontend)
- First passkey → `RecoveryCodesPanel` shows the codes once (copy / download /
  acknowledge) — they can't be shown again.
- Adding a 2nd/3rd device → no codes, just a "biometric is on for this device"
  notice.
- If the only passkey so far is on a **laptop/desktop**, Settings shows the
  **"Add your phone too"** nudge (a desktop passkey can't travel to a phone).

### Two registration modes + device limit (up to 3)

`register/start` takes a **`mode`** that sets `authenticatorAttachment` in the
options — so the same flow registers either *this* device or *another* one:

| Mode | `authenticatorAttachment` | What the patient gets | Settings button |
|---|---|---|---|
| **`platform`** (default) | `'platform'` | **this** device's Face ID / fingerprint / Hello | **"Set up this device"** |
| **`cross-platform`** | `'cross-platform'` | the browser offers the **QR / "use a phone"** flow → the passkey is created on **another** device | **"Add another device (phone / tablet)"** |

- **Max 3 devices** — enforced server-side in `startWebAuthnRegistration`
  (`MAX_WEBAUTHN_DEVICES = 3`); a 4th `start` is rejected.
- **"Set up this device" hides itself** once this device is registered. WebAuthn
  doesn't tell the page which list row is the current device, so the FE remembers
  this device's **`credentialId`** in `localStorage`
  (`cp_patient_webauthn_this_device`) — recorded on a successful `platform`
  registration **and** on every successful biometric **login** on this device (so
  devices registered before this tracking are recognised too). The device list
  now returns each row's `credentialId` (a public id, not a secret), and Settings
  hides the button when a remembered id is still in the list. A `cross-platform`
  registration is **not** recorded (it lives on a different device); removing the
  device un-hides the button (its id leaves the list).
- **Bluetooth hint** — the `cross-platform` / QR flow needs Bluetooth on **both**
  devices (the hybrid proximity check). Both the **"Add another device"** step
  (Settings) and the **biometric sign-in page** show a hint to keep Bluetooth on.
  It's only a message — the page can't read or toggle the system Bluetooth.

### What's stored in the DB

`WebAuthnCredential` (one row **per device**, 1‑to‑many with `User`). Every
field except `deviceName` comes **from the device**, inside the attestation that
`startRegistration()` returns — the backend reads them out of
`verifyRegistration().registrationInfo` and saves them.

| Column | What it is (simple) | Where it comes from | Example |
|---|---|---|---|
| `credentialId` | the passkey's unique "name tag" — login looks the passkey up by this | the **device** creates it (in the attestation), base64url, unique | `"A4BA7E4821..."` |
| `publicKey` | the public half of the key pair — only **verifies** signatures, can't create them (safe to store) | the **device** creates it (COSE bytes → base64url) | `"pQECAyYgAS..."` |
| `counter` | "number of times used" — replay/clone check | the **device** reports it; `0` at first | `0` → `1` → `2`… |
| `transports` | how the authenticator can be reached (UI hint for next time) | the **device** reports it | `["internal"]`, `["internal","hybrid"]` |
| `deviceType` | single-device key vs a synced passkey | the **verify result** (`credentialDeviceType`) | `"singleDevice"` / `"multiDevice"` |
| `backedUp` | is it backed up to the cloud (iCloud / Google)? | the **verify result** (`credentialBackedUp`) | `true` / `false` |
| `deviceName` | friendly label for the Settings list | **we** set it — `describeThisDevice()` (browser user-agent) for a `platform` passkey; a generic **"Phone or tablet"** for a `cross-platform` one (the browser can't identify the *other* device, so we can't tell iPhone vs Android). Patients can **rename** it in Settings | `"iPhone"`, `"Windows device"`, `"Phone or tablet"` |

> **Why `counter` often stays 0:** synced passkeys (iCloud Keychain / Google,
> i.e. `deviceType: "multiDevice"`, `backedUp: true`) deliberately **don't use
> the counter** — it stays `0` forever, because they're meant to live on several
> devices. The counter only climbs on a **single-device** hardware key (e.g. a
> USB security key). So a phone passkey showing `counter: 0` after several logins
> is **normal**, not a bug — clone-detection just doesn't apply to that type.

`MfaRecoveryCode` (10 rows, reused from the provider TOTP path): `codeHash`
(bcrypt), `usedAt`. Plaintext is **never** stored.

> Key takeaway: registration is "the device makes a key pair, proves it with the
> biometric, and we keep only the public half." The private key and the
> biometric never reach the server.

---

## 3. Scenario — Sign in with biometric (the second factor)

The email code / magic link is **factor 1**. Once a patient has a passkey,
biometric becomes a **required factor 2**: after the first factor we do **not**
issue tokens — we return a challenge and route to the biometric step.

### The crypto in one picture

```
   server  ──── random challenge ────►  device
                                         · biometric/PIN unlocks the PRIVATE key
                                         · PRIVATE key SIGNS the challenge
   server  ◄──── signature ───────────  device
      │
      └─ verify the signature with the stored PUBLIC key  →  match = it's them
```

Login is the **mirror** of registration: registration *stored* the public key;
login *uses* it to check a fresh signature. The private key never moves; only a
one-time signature crosses the wire.

### Two stages

1. **First factor + gate** — OTP / magic-link succeeds, the backend sees the
   patient has a passkey, and returns `WEBAUTHN_REQUIRED` instead of tokens.
2. **Second factor** — the `/sign-in/biometric` page runs the WebAuthn assertion
   and exchanges it for the real session.

### Stage 1 — first factor decides if biometric is needed

`POST /api/v2/auth/otp/verify` (or magic-link) → `AuthService.verifyOtp()`:

| Call | What it does |
|---|---|
| (validate OTP, resolve practice) | normal first-factor checks |
| `shouldChallengeMfa()` | false for patients (that's the provider TOTP gate) |
| `shouldChallengeWebAuthn(userId, roles)` | **the fork** — true only when role is `PATIENT` **and** `webAuthnCredential.count > 0` |
| → **NO** | issue tokens normally (every patient without biometric — unaffected) |
| → **YES** → `startWebAuthnAuthentication()` | `randomChallenge()` → `signWebAuthnAuthToken()` (JWT, `kind: 'webauthn_auth'`, 5 min, carries the challenge + resolved `activePracticeId`) |

→ returns `{ status: 'WEBAUTHN_REQUIRED', challengeToken }`. The controller passes
it through **verbatim — no cookies set**.

**Frontend hand-off** (`sign-in/page.tsx`): sees `WEBAUTHN_REQUIRED` → stashes
the `challengeToken` in `sessionStorage` → `router.push('/sign-in/biometric')`.
*(Magic-link variant: the controller **redirects** to
`/sign-in/biometric?challengeToken=…` since a GET can't return JSON.)*

### Stage 2 — the biometric page

`sign-in/biometric/page.tsx` auto-runs `authenticateBiometric(challengeToken)`,
which is **three** calls:

#### 2a — `options` (build the get() request)
`POST /api/v2/auth/webauthn/authenticate/options { challengeToken }` *(public)*
→ `webAuthnAuthenticationOptions()`:

| Call | What it does |
|---|---|
| `verifyWebAuthnAuthToken(token)` | unwrap the userId + challenge from the JWT |
| `prisma.webAuthnCredential.findMany` | the patient's credential ids → `allowCredentials`, so the browser only prompts on a device that actually **holds** one of them |
| `buildAuthenticationOptions()` → lib `generateAuthenticationOptions` | reuses the token's challenge, `userVerification: 'required'` |

→ returns the options.

#### 2b — browser ceremony (sign the challenge)
`startAuthentication({ optionsJSON })`:
- the OS shows **Face ID / fingerprint / PIN**,
- the device **signs the challenge** with the private key, and
- returns the **assertion** (`AuthenticationResponseJSON`).

*(If this device has no matching passkey, the browser may instead offer the
**QR / cross-device** flow, or fail → that's Scenario 4, recovery code.)*

#### 2c — `verify` (check signature → issue tokens)
`POST /api/v2/auth/webauthn/authenticate/verify { challengeToken, response }`
*(public)* → `AuthService.webAuthnAuthenticate()`:

| Call | What it does |
|---|---|
| `verifyWebAuthnAuthToken` | userId + challenge + `activePracticeId` |
| `prisma.webAuthnCredential.findUnique({ credentialId: response.id })` | find the stored passkey; **confirm it belongs to this user**. Unknown → log `webauthn_auth_failed`, throw |
| `webAuthnService.verifyAuthentication()` → lib `verifyAuthenticationResponse` | verify the **signature against the stored `publicKey` + challenge + origin + RP**. Fail → log `webauthn_auth_failed`, throw |
| **`prisma.webAuthnCredential.update`** | **DB write** — `counter = newCounter`, `lastUsedAt = now` |
| `loadActiveUser` + `issueTokenPair` | **now** mint the real token pair |
| `logAuthEvent('webauthn_auth_succeeded')` | audit |
| controller: `issueSessionCookies` + `trackDevice` | set the session cookies + record the device (same steps as a normal OTP login) |

→ Frontend: `login(data)` → `/dashboard` (or `/onboarding` if required).

### Why the counter matters

Some authenticators keep a **signature counter** that goes up every time they're
used. `verifyAuthenticationResponse` returns the new value and we store it
(`counter` column). If a later login ever presents a **lower** counter, that
signals a **cloned authenticator** and verification rejects it — replay/clone
protection.

**But synced passkeys (iPhone/iCloud, Google) always report `0`** and don't use
the counter at all (they're designed to live on many devices). So you'll usually
see `counter: 0` for patient phone passkeys — that's expected; the counter check
only matters for single-device hardware keys.

> Key takeaway: the gate sits **between "OTP verified" and "cookies issued."**
> Patients without a passkey walk straight through; enrolled patients must sign a
> fresh challenge with their device, which we verify using only the public key we
> stored at registration.

---

## 4. Scenario — Sign in when biometric can't be used (recovery code)

This happens when the patient is on a device that **doesn't hold their passkey**
— e.g. a brand-new phone, a different browser/Google account, or a desktop with
no Bluetooth so the QR cross-device flow can't finish.

Stage 1 is **identical** to Scenario 3 — the first factor passes and the backend
returns `WEBAUTHN_REQUIRED`. The difference is in Stage 2: the biometric prompt
can't complete, so we fall back to a **one-time recovery code** (the **only**
fallback — there is no email bypass).

### How it's reached

On `/sign-in/biometric`, `startAuthentication()` either:
- **offers the QR / cross-device** flow → scan with the phone that holds the
  passkey → succeeds via Scenario 3's verify, **or**
- **fails** (cancel / no passkey here / no Bluetooth) → `NotAllowedError` → the
  page reveals **"Use a recovery code"**.

### The flow

`signInWithRecoveryCode(challengeToken, code)` →
`POST /api/v2/auth/webauthn/authenticate/recovery` *(public)* →
`AuthService.webAuthnRecoverySignIn()`:

| Call | What it does |
|---|---|
| `verifyWebAuthnAuthToken` | unwrap the userId (the token already proves the first factor passed) |
| `prisma.mfaRecoveryCode.findMany({ usedAt: null })` | load the patient's **unused** codes (stored as **bcrypt hashes**, never plaintext) |
| loop `mfaService.verifyRecoveryCode` | bcrypt-compare the entered code against each hash. No match → log `webauthn_recovery_code_failed`, throw |
| **`prisma.mfaRecoveryCode.update` → `usedAt = now`** | **DB write** — burns **only that one** code; the other 9 stay valid |
| `prisma.mfaRecoveryCode.count` | how many remain |
| `loadActiveUser` + `issueTokenPair` | mint the session |
| `logAuthEvent('webauthn_recovery_code_used', { remaining })` | audit |
| controller: `issueSessionCookies` + `trackDevice` | finish the login |

→ returns `AuthResponse + recoveryRemaining`. Frontend shows **"You used a
recovery code. N of 10 left."**

> **Design choice:** using a code consumes **only that one** (no auto-regenerate,
> no re-display of a fresh set) — the remaining codes keep working, and the
> patient regenerates from Settings when running low.

### Offer to set up biometric on this device

The patient is now signed in on a device that **lacked** a passkey. So right on
that confirmation screen, if `isBiometricSupported()` is true, we offer
**"Set up on this device"** (a `platform` registration, no QR needed) plus a
**"Maybe later"** link. This is the easiest moment to enroll the new device — it
means no recovery code is needed next time on it. (If the device has no built-in
biometric, we just show a tip to add a phone from Settings instead.)

---

## 5. Scenario — Manage from Settings

All authenticated (`fetchWithAuth`), from `settings/page.tsx`.

| Action | Endpoint → service | What happens |
|---|---|---|
| **List devices** | `GET /webauthn/credentials` → `listWebAuthnCredentials` | `findMany` the patient's passkeys for the device list |
| **Set up this device** | `POST /webauthn/register/start { mode: 'platform' }` → Scenario 2 | registers the current device's biometric; button **hides** afterwards (localStorage tracking) |
| **Add another device (QR)** | `POST /webauthn/register/start { mode: 'cross-platform' }` → Scenario 2 | browser shows the QR / "use a phone"; passkey is created on the **other** device. Shows the **Bluetooth hint** |
| **Rename a device** | `PATCH /webauthn/credentials/:id { deviceName }` → `renameWebAuthnCredential` | cosmetic label only (1–40 chars, scoped to the patient's own credential, **not** used in any auth check). Lets a patient relabel "Phone or tablet" → "My Samsung" |
| **Remove a device** | `DELETE /webauthn/credentials/:id` → `deleteWebAuthnCredential` | `deleteMany({ id, userId })` (a patient can only delete their own). Remove the **last** one → `count = 0` → next sign-in is plain OTP again (no gate) |
| **Recovery status** | `GET /webauthn/recovery-codes` → `patientRecoveryStatus` | `{ remaining, hasBiometric }` for the "N of 10 left" line |
| **Regenerate codes** | `POST /webauthn/recovery-codes/regenerate` → `regeneratePatientRecoveryCodes` → `issueRecoveryCodes` | **DB write (txn):** delete all + create 10 fresh hashes; returns the new codes → shown once in `RecoveryCodesPanel` |

Adding the **2nd / 3rd** device returns **no** recovery codes
(`completeWebAuthnRegistration` only mints them on the first passkey). At **3
devices** both add-buttons are hidden with a "maximum reached" note.

The **"Add your phone too"** nudge appears when the patient has biometric but
**no phone passkey** (heuristic on `deviceName`) — because a desktop passkey
can't travel to a phone.

---

## 6. Scenario — Lost both device + recovery codes (admin reset)

The true lockout case: the patient can't use biometric **and** has no recovery
codes. The biometric page shows a **"Contact support"** hint; an admin then
resets them.

**Admin side** (`/users` in the admin app, `SUPER_ADMIN` / `HEALPLACE_OPS` only):
the **"Reset biometric"** action appears on a patient row only when
`biometricEnrolled` is true. It opens a reason modal →
`resetPatientBiometric(userId, reason)`:

`POST /api/v2/auth/admin/webauthn/reset/:userId` *(role-gated)* →
`AuthService.adminResetPatientBiometric()`:

| Call | What it does |
|---|---|
| `prisma.user.findUnique` | assert the target is a `PATIENT` |
| **`prisma.$transaction`** | **DB write** — `webAuthnCredential.deleteMany` + `mfaRecoveryCode.deleteMany` (wipe both) |
| `logAuthEvent('webauthn_reset_by_admin', { resetBy, reason })` | audit who reset + why |
| `emailService.sendEmail` | notify the patient their biometric was reset |

→ The admin list refetches; the button disappears (`biometricEnrolled` now
false). The patient's **next sign-in**: `shouldChallengeWebAuthn` sees `count = 0`
→ **plain OTP**, and they can re-enroll from Settings (which mints fresh recovery
codes again).

---

## Cross-cutting notes

- **Unsupported device** → `isBiometricSupported()` is false → setup is hidden →
  the patient never enrolls → never gated → plain OTP forever. No breakage.
- **Patients with no biometric** → `shouldChallengeWebAuthn` is false → zero
  change to their sign-in.
- **The biometric/private key never reaches the server** — only public keys,
  signatures, and (hashed) recovery codes are stored.
- **Audit events:** `webauthn_registration_started/completed/failed`,
  `webauthn_auth_succeeded/failed`, `webauthn_recovery_code_used/failed`,
  `webauthn_recovery_codes_regenerated`, `webauthn_credential_renamed`,
  `webauthn_credential_removed`, `webauthn_reset_by_admin`.
