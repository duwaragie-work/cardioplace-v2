# Auth Module — Implementation Reference

> **Status:** ✅ Complete & tested  
> **Backend:** NestJS + Prisma + PostgreSQL

**Recent updates:** Multi-role support (User.roles array), guest login (device-linked), API paths under `/api/v2/auth`.

---

## Table of Contents

1. [Goals & Design Philosophy](#1-goals--design-philosophy)
2. [Architecture Overview](#2-architecture-overview)
3. [Prisma Schema Changes](#3-prisma-schema-changes)
4. [NPM Packages Added](#4-npm-packages-added)
5. [Token Strategy](#5-token-strategy)
   - [Multi-Role Support](#51-multi-role-support)
6. [Auth Flows](#6-auth-flows)
   - [Email OTP](#61-email-otp-flow)
   - [Google Web (Redirect)](#62-google-web-redirect-flow)
   - [Google Mobile (idToken)](#63-google-mobile-flow)
   - [Apple Mobile (identityToken)](#64-apple-mobile-flow)
   - [Apple Web (Redirect)](#65-apple-web-redirect-flow)
   - [Guest Login (Device-Linked)](#66-guest-login-device-linked)
7. [Account Linking Policy](#7-account-linking-policy)
8. [Profile & Onboarding Flow](#8-profile--onboarding-flow)
9. [Device Tracking](#9-device-tracking)
10. [Refresh Token Rotation](#10-refresh-token-rotation)
11. [Logout](#11-logout)
12. [JWT Guard & Guest Mode](#12-jwt-guard--guest-mode)
13. [Rate Limiting](#13-rate-limiting)
14. [Cookie vs Body Token Delivery](#14-cookie-vs-body-token-delivery)
15. [Environment Variables](#15-environment-variables)
16. [File-by-File Reference](#16-file-by-file-reference)
17. [API Endpoint Reference](#17-api-endpoint-reference)
18. [Security Decisions](#18-security-decisions)

---

## 1. Goals & Design Philosophy

### Single Upsert Endpoint Per Provider
There are **no separate sign-up and sign-in endpoints**. Every auth endpoint is an upsert:
- First call → creates the user and account
- Subsequent calls → finds the user and returns new tokens

This eliminates the "account already exists" / "account not found" error class entirely.

### Identity by Provider Sub, Not Email
Social accounts are identified by the provider's stable `sub` (subject) ID — never by email. Email addresses can change, can be reused, and can be faked. The `Account` table maps `(provider, providerId)` → `userId`.

### Short-lived Access + Long-lived Refresh
- **Access token:** 15 minutes, signed JWT, stateless
- **Refresh token:** 30 days, random bytes, hashed in the database

This means a stolen access token expires quickly, and compromised refresh tokens can be individually revoked from the database.

---

## 2. Architecture Overview

```
Client
  │
  ├── Web browser   → httpOnly cookie for refresh token
  └── Mobile app    → request body for refresh token, Keychain/Keystore for storage

NestJS API
  ├── AuthController        /v2/auth/*  (under global prefix /api)
  ├── AuthService           core logic (upsert, OTP, guest, token issuance)
  ├── JwtStrategy           validates Bearer tokens → req.user (id, email, roles)
  ├── GoogleStrategy        Passport OAuth2 web flow
  ├── JwtAuthGuard          global guard — skips @Public() routes
  └── GoogleAuthGuard       wraps Passport google strategy

Database (PostgreSQL via Prisma)
  ├── User          canonical identity
  ├── Account       one row per social provider link
  ├── RefreshToken  one row per active session (hashed)
  └── OtpCode       one row per sent OTP (hashed)
```

---

## 3. Prisma Schema Changes

### `prisma/schema/user.prisma` — Updated
```prisma
enum UserRole {
  GUEST
  REGISTERED_USER
  VERIFIED_USER
  CONTENT_ADMIN     
  CONTENT_APPROVER  // Reviews content (editorial + clinical approval)
  KB_UPLOADER
  KB_APPROVER
  CHAT_REVIEWER
  SUPER_ADMIN
}

enum MenopauseStage {
  PERIMENOPAUSE
  MENOPAUSE
  POSTMENOPAUSE
  UNKNOWN
}

enum OnboardingStatus {
  NOT_COMPLETED
  COMPLETED
}

enum AccountStatus {
  ACTIVE
  BLOCKED
  SUSPENDED
}

model User {
  id      String  @id @default(ulid())
  email   String? @unique
  name    String?
  pwdhash String?

  // Profile fields set during / after onboarding
  dateOfBirth    DateTime?
  menopauseStage MenopauseStage @default(UNKNOWN)
  timezone       String?        // IANA identifier, e.g. "Asia/Colombo"

  isVerified       Boolean          @default(false)
  roles            UserRole[]       @default([GUEST])
  onboardingStatus OnboardingStatus @default(NOT_COMPLETED)
  accountStatus    AccountStatus    @default(ACTIVE)

  accounts      Account[]
  refreshTokens RefreshToken[]
  devices       Device[]
  authLogs      AuthLog[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Key changes from original:
- `id` uses **ULID** for better performance and sortability.
- `email` made **nullable** (`String?`) — required for Apple users and guests (no email).
- **RBAC**: `roles` field — **array** of `UserRole` (multi-role per user). Default `[GUEST]`.
- **Onboarding status**: Uses `OnboardingStatus` enum (`NOT_COMPLETED`, `COMPLETED`).
- **Account status**: Uses `AccountStatus` enum (`ACTIVE`, `BLOCKED`, `SUSPENDED`).
- **Profile fields**: Added `dateOfBirth`, `menopauseStage`, and `timezone`.
- **Guest users**: A `User` with no email/account, identified by `Device.deviceId`; `roles: [GUEST]`.

---

### `prisma/schema/account.prisma`
```prisma
model Account {
  id         String  @id @default(ulid())
  provider   String // "google" | "apple"
  providerId String // Google sub OR Apple sub
  email      String? // snapshot from provider — informational only
  userId     String
  user       User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now())

  @@unique([provider, providerId])
}
```

---

### `prisma/schema/refreshToken.prisma`
```prisma
model RefreshToken {
  id        String    @id @default(ulid())
  tokenHash String 
  expiresAt DateTime
  revokedAt DateTime? // null = active; set on logout/rotation
  userAgent String? // browser/device from request headers

  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now())
}
```

---

### `prisma/schema/otpCode.prisma`
```prisma
model OtpCode {
  id        String   @id @default(ulid())
  email     String   
  codeHash  String
  expiresAt DateTime 
  attempts  Int      @default(0)
  
  createdAt DateTime @default(now())
  
  @@index([email])     
  @@index([expiresAt]) 
}
```

---

### `prisma/schema/device.prisma`
```prisma
model Device {
  id         String   @id @default(ulid())
  deviceId   String   @unique // UUID from browser localStorage / mobile SDK
  platform   String? // OS: "web" | "ios" | "android" | "watchos" | "wearos"
  deviceType String? // Category: "browser" | "phone" | "tablet" | "watch" | "wearable"
  deviceName String? // e.g. "iPhone 15 Pro"
  userAgent  String?
  lastSeenAt DateTime @default(now())

  userId String? // null for guests; set after login
  user   User?   @relation(fields: [userId], references: [id], onDelete: SetNull)

  createdAt DateTime @default(now())

  @@index([userId])
}
```

---

## 4. NPM Packages Added

| Package | Purpose |
|---|---|
| `@nestjs/jwt` | JWT signing and verification |
| `@nestjs/passport` | Passport.js integration for NestJS |
| `@nestjs/throttler` | Global rate limiting |
| `passport` | Core Passport.js |
| `passport-jwt` | JWT Passport strategy |
| `passport-google-oauth20` | Google OAuth2 Passport strategy |
| `passport-apple` | Apple OAuth2 web redirect Passport strategy |
| `apple-signin-auth` | Apple identityToken verification (mobile) |
| `nodemailer` | SMTP email sending |
| `bcrypt` | OTP hashing |
| `cookie-parser` | Parse httpOnly cookies in Express |

---

## 5. Token Strategy

### Access Token
- **Format:** Signed JWT
- **Payload:** `{ sub: userId, email: userEmail | null, roles: UserRole[] }`
- **Expiry:** `JWT_ACCESS_EXPIRES_IN` (15m)
- **Delivery:** Always in JSON response body

### Refresh Token
- **Format:** 40 random bytes → hex string (80 chars)
- **Storage:** SHA-256 hash stored in `RefreshToken` table
- **Expiry:** `JWT_REFRESH_EXPIRES_IN` (30d)
- **Rotation:** Token rotated on every use

### 5.1 Multi-Role Support

- **Schema:** `User.roles` is an array (`UserRole[]`), default `[GUEST]`. A user can have multiple roles (e.g. `[REGISTERED_USER, CONTENT_ADMIN]`).
- **JWT:** The access token payload includes `roles: UserRole[]` (not a single `role`). `req.user.roles` is used for authorization.
- **Authorization:** `RolesGuard` allows access if the user has **any** of the required roles: `requiredRoles.some(r => user.roles.includes(r))`. Use `@Roles(UserRole.CONTENT_ADMIN, UserRole.SUPER_ADMIN)` to allow either role.
- **Backward compatibility:** The auth API still returns `user_type` (primary role, e.g. first in `roles`) for redirects and existing clients; the full list is in `roles`.

## 6. Auth Flows

### 6.1 Email OTP Flow

```mermaid
sequenceDiagram
    participant Client
    participant Server
    participant DB
    participant SMTP

    Note over Client, SMTP: Step 1: Send OTP
    Client->>Server: POST /v2/auth/otp/send { email }
    Server->>DB: Check per-email cooldown (60s)
    Server->>Server: Generate 6-digit OTP
    Server->>Server: Hash OTP (bcrypt)
    Server->>DB: Store OtpCode { email, codeHash, expiresAt }
    Server->>SMTP: Send HTML email with OTP
    Server->>DB: Log: otp_requested
    Server-->>Client: 200 { message: "OTP sent" }

    Note over Client, SMTP: Step 2: Verify OTP
    Client->>Server: POST /v2/auth/otp/verify { email, otp }
    Server->>DB: Find OtpCode (unexpired)
    Server->>Server: Check attempts < 5
    Server->>Server: Verify hash (bcrypt.compare)
    Server->>DB: Upsert User (roles: [REGISTERED_USER])
    Server->>DB: Update isVerified: true
    Server->>DB: Delete OtpCode
    Server->>Server: issueAccessToken (JWT 15m)
    Server->>Server: issueRefreshToken (opaque 30d)
    Server->>DB: Log: otp_verified
    Server-->>Client: 200 { accessToken, refreshToken, onboarding_required, user_type, roles, login_method, name }
    Note right of Server: Set-Cookie: refresh_token=... (Web)
```

### 6.2 Google Web (Redirect) Flow

```mermaid
sequenceDiagram
    participant Browser
    participant Server
    participant Google

    Browser->>Server: GET /v2/auth/google
    Server-->>Browser: 302 Redirect to Google
    Browser->>Google: Authenticate & Consent
    Google-->>Browser: 302 Redirect to /v2/auth/google/callback?code=...
    Browser->>Server: GET /v2/auth/google/callback?code=...
    Server->>Google: Exchange code for profile
    Google-->>Server: Profile { id, email, name, ... }
    Server->>DB: upsertSocialUser (by providerId)
    Server->>Server: issueAccessToken + issueRefreshToken
    Server-->>Browser: 302 Redirect to {WEB_APP_URL}/auth/callback?access=...
    Note right of Server: Set-Cookie: refresh_token=...
```

### 6.3 Google & Apple Mobile Flow

```mermaid
sequenceDiagram
    participant Mobile
    participant Server
    participant Provider API

    Mobile->>Mobile: Native SDK Sign-In
    Mobile-->>Mobile: identityToken / idToken
    Mobile->>Server: POST /v2/auth/google/mobile OR /v2/auth/apple
    Server->>Provider API: Verify Token (tokeninfo / apple-signin-auth)
    Provider API-->>Server: Token Claims { sub, email, ... }
    Server->>DB: upsertSocialUser (by providerId)
    Server->>Server: issueAccessToken + issueRefreshToken
    Server->>DB: upsertOrTrackDevice (x-device-id)
    Server-->>Mobile: 200 { accessToken, refreshToken, onboarding_required, user_type, roles, ... }
```

### 6.6 Guest Login (Device-Linked)

Guest = **unregistered** but **authenticated** user: no email/sign-in, identified by device ID. Every guest gets a real `User` row and JWT so the app has a single “everyone is a user” model.

```mermaid
sequenceDiagram
    participant Client
    participant Server
    participant DB

    Client->>Server: POST /v2/auth/guest (Header: x-device-id)
    Server->>DB: Find Device by deviceId (include user)
    alt Device not found
        Server->>DB: Create User (roles: [GUEST], no email)
        Server->>DB: Create Device(deviceId, userId)
    else Device exists, no user linked
        Server->>DB: Create User (roles: [GUEST])
        Server->>DB: Update Device.userId
    else Device exists with user
        Server->>Server: Use existing user (guest or registered)
    end
    Server->>Server: issueAccessToken + issueRefreshToken
    Server->>DB: Log: guest_login_success
    Server-->>Client: 200 { accessToken, refreshToken, userId, user_type: GUEST, roles: [GUEST], login_method: guest, ... }
```

**Request:** `POST /api/v2/auth/guest` with header `x-device-id` (or body `{ deviceId }`). Device ID is required.

**Response:** Same shape as other logins (`accessToken`, `refreshToken`, `userId`, `user_type`, `roles`, `login_method: 'guest'`, `name: null`). Frontend stores tokens and redirects to the main app; no email/OTP step.

**Scenarios:**

| Scenario | Backend action |
|----------|----------------|
| **No device** (first time this device) | Create `User` (guest), create `Device(deviceId, userId)`, issue tokens. |
| **Device exists, no user** | Create `User` (guest), set `Device.userId`, issue tokens. |
| **Device exists with user** | Use that user (guest or registered), issue new tokens. |

**Upgrade path:** When a guest later signs up (OTP/Google/Apple), the same `User` can be updated (add email, add `REGISTERED_USER` to `roles`, link `Account`) so history (e.g. content views) stays under one `userId`.

---

## 7. Account Linking Policy

| Scenario | Action |
|---|---|
| Google login, `email_verified=true`, email matches existing `User` | **Auto-link:** Create `Account(google)` pointing to existing `User` |
| Google login, `email_verified=false` | **No link:** Create new `User` — never link on unverified email |
| Apple login (any flow), any email | **No link:** Create new `User`, identify by `sub` (providerId) only |
| OTP login, email matches social-linked `User` | Identical identifier — finds existing `User` by email, issues tokens |

---

## 8. Profile & Onboarding Flow

After successful authentication, if `onboarding_required: true`, the user must complete their profile.

- `GET /v2/auth/profile`: Fetch current user profile.
- `POST /v2/auth/profile`: Submit initial onboarding data (sets `onboardingStatus: COMPLETED`).
- `PATCH /v2/auth/profile`: Update existing profile data.

---

## 9. Security Properties

| Property | Implementation |
|----------|---------------|
| **Short-lived access tokens** | JWT 15 min expiry — compromised tokens self-expire quickly |
| **Opaque refresh tokens** | 40 random bytes; only SHA-256 hash in DB — safe against DB dumps |
| **Refresh token rotation** | Every use revokes old token + issues new pair — replay attacks prevented |
| **OTP bcrypt hashing** | 10 rounds — brute force infeasible even with DB access |
| **OTP rate limiting** | 60-second per-email cooldown + 5-attempt lockout + global throttler |
| **OTP short window** | 10-minute TTL; single-use (deleted on success or lockout) |
| **httpOnly refresh cookie** | JavaScript cannot read the refresh token in web clients |
| **Secure cookie flag** | Enforced in `NODE_ENV=production` — HTTPS only |
| **CORS credentials** | Locked to `WEB_APP_URL` — no wildcard origin |
| **Audit logging** | Every event (success + failure) logged with IP, user-agent, device ID |
| **Log fault tolerance** | Logging errors are caught and swallowed — auth flow never breaks |
| **RBAC** | Multi-role per user (`User.roles[]`); `RolesGuard` allows access if user has any required role; `@Roles()` per-route |
| **Social email linking** | Google verified emails linked to existing accounts automatically |
| **No plaintext secrets** | OTPs are bcrypt-hashed; refresh tokens are SHA-256-hashed |
| **ULID IDs** | Sortable, URL-safe, time-ordered — no sequential ID enumeration |

---

## 10. API Endpoint Reference

All auth routes are under **`/api/v2/auth`** (global prefix `/api` + controller prefix `v2/auth`).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/v2/auth/google` | Public | Redirect to Google consent screen |
| `GET` | `/v2/auth/google/callback` | Google Guard | Handle OAuth callback; set cookie; redirect to frontend |
| `POST` | `/v2/auth/google/mobile` | Public | Verify Google `idToken`; track device; return auth response |
| `GET` | `/v2/auth/apple/web` | Public | Redirect to Apple consent screen |
| `GET` | `/v2/auth/apple/callback` | Apple Guard | Handle Apple OAuth callback; set cookie; redirect to frontend |
| `POST` | `/v2/auth/apple` | Public | Verify Apple `identityToken`; track device; return auth response |
| `POST` | `/v2/auth/guest` | Public | Guest login: require `x-device-id` (or body `deviceId`); find/create guest user; return auth response |
| `POST` | `/v2/auth/otp/send` | Public | Send 6-digit OTP to email |
| `POST` | `/v2/auth/otp/verify` | Public | Verify OTP; track device; return auth response |
| `GET` | `/v2/auth/profile` | JWT | Fetch current user profile |
| `POST` | `/v2/auth/profile` | JWT | Submit initial onboarding profile |
| `PATCH` | `/v2/auth/profile` | JWT | Update user profile |
| `POST` | `/v2/auth/refresh` | Public | Rotate refresh token |
| `POST` | `/v2/auth/logout` | JWT | Revoke refresh token; clear cookie |
| `GET` | `/v2/auth/me` | JWT | Return JWT payload `{ id, email, roles }` |

### Auth Response Model

Endpoints returning an `AuthResponse` (login and guest) provide:
```typescript
{
  accessToken: string
  refreshToken: string
  userId: string
  onboarding_required: boolean
  user_type: UserRole        // primary role (e.g. roles[0]) for backward compatibility
  roles: UserRole[]          // full list of roles
  login_method: 'otp' | 'google' | 'apple' | 'guest'
  name: string | null
}
```

### 12. JWT Guard & Guest Mode

- **All users are authenticated.** There is no “unauthenticated” path for app usage: public routes (e.g. login, guest) do not set `req.user` until the client calls an auth endpoint and gets tokens.
- **Guest users** are authenticated via `POST /v2/auth/guest` with a device ID. They receive a real `User` (with `roles: [GUEST]`) and a JWT. From then on they use the same Bearer token as registered users; `RolesGuard` allows `GUEST` where `@Roles()` includes it (e.g. for limited content or chat).
- **`@Public()`** is used only for auth entrypoints (OTP send/verify, social redirects, guest, refresh) so the client can obtain tokens without a prior JWT.
