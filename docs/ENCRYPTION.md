# Encryption at Rest & In Transit — Cardioplace v2

> How Cardioplace v2 (HIPAA patient-safety project) handles data security at rest and in
> transit.
>
> **Status:** ✅ Both fully handled for the database via **Prisma Postgres**. A few
> app-level hardening items remain (see [gaps](#app-level-gaps-not-database)).

---

## Encryption at Rest 🛌

**Definition:** Data is encrypted while **stored** on disk, so the raw files can't be read
without the key. *"At rest" = parked on disk* (not moving = in transit; not in memory = in
use).

**Example:** `4111-1111-1111-1111` is written to disk as `8fK2xPq9mL7aR3...` — gibberish
without the key.

**Protects against:** stolen drives, leaked backups, exposed storage.
**Does NOT protect against:** an attacker with valid app access or the keys.

**Two layers:**

| Layer | What it encrypts | Code changes? |
|---|---|---|
| Storage / TDE | The whole database/disk | None — transparent |
| Field-level | Specific columns, in app code | Yes (and breaks querying) |

### Prisma support

Prisma Postgres encrypts at rest **automatically and always-on** — no setting, no toggle,
nothing to configure. Per Prisma's product spec:

> *"…automated backups, encryption at rest and in transit, full tenant isolation, and
> enterprise-grade compliance, all managed for you."*

---

## Encryption in Transit ✈️

**Definition:** Data is encrypted while **moving across a network** (browser ↔ server,
server ↔ database), so eavesdroppers see only ciphertext. Done via **TLS** (the "S" in
HTTPS).

**Example:** A password sent over HTTPS travels as `a3f9c1...7e2b`, not `MyP@ss123`.

**Protects against:** eavesdropping, man-in-the-middle, network interception.
**Does NOT protect against:** stored data (that's at rest) or a compromised endpoint.

### Prisma support

Prisma Postgres **enforces TLS — it is mandatory**. Every connection string carries
`sslmode=require`, and a non-TLS connection is **refused**. You cannot connect in plaintext.

---

## Project Status (Cardioplace v2)

Database: **Prisma Postgres** (`db.prisma.io` / `pooled.db.prisma.io`).

| Concern | Status | How |
|---|---|---|
| Encryption at rest (TDE) | ✅ | Automatic & always-on via Prisma Postgres |
| Encrypted backups | ✅ | Included in Prisma Postgres |
| In transit — DB hop | ✅ | `sslmode=require` + Prisma mandatory TLS |
| In transit — browser ↔ apps ↔ API | ✅ | HTTPS/TLS at AWS Load Balancer |
| In transit — external services | ✅ | HTTPS enforced by Gemini / Resend / Google SDKs |
| Field-level (MFA/TOTP secrets) | ✅ | AES-256-GCM via `backend/src/common/encryption.service.ts` |
| Passwords | ✅ | bcrypt (one-way hash) |
| HIPAA Business Associate Agreement | ✅ | Signed BAA with Prisma covers PHI |

**Conclusion:** Encryption at rest and in transit are **fully handled for the database** —
no config or code changes needed. Prisma Postgres provides both automatically, and a BAA is
in place.

### App-level gaps (not database)

Worth hardening, but separate from the database transport layer:

- 🔴 **Voice WebSocket CORS = wildcard** — accepts any origin (`backend/src/voice/voice.gateway.ts`).
- 🟠 **No HSTS header** on the Next.js apps.
- 🟡 **No Helmet** security headers on the backend.

---

*Last reviewed: 2026-06-24*
