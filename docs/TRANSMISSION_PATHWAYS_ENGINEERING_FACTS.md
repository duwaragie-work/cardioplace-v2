# Transmission pathways — engineering facts

**From:** Nivakaran · **To:** Humaira, for the transmission-pathway table in `docs/EPHI_INVENTORY.md`
**Date:** 2026-07-14 · **Refreshed:** 2026-07-16 (row 2 minimization landed, row 4 provider notify-and-link split landed, §5 decisions recorded per Ruhaim 2026-07-16 addendum) · **Verified against:** `nivakaran-dev`, by reading the code

Feeds NIST SP 800-66r2 Activity 1 / §164.312(e)(1), Technical item 1 of your Transmission Security assessment v(iii): *"each pathway, the ePHI it carries, its protection mechanism, and whether a BAA applies."*

Sensitivity tiers use your existing legend (T1 Clinical · T2 Metadata · T3 Disclosure trail).

---

## 1 · The six pathways

| # | Pathway | ePHI carried | Protection mechanism | BAA status |
|---|---|---|---|---|
| **1** | **Voice WebSocket**<br>browser ↔ backend<br>`voice/voice.gateway.ts` | **T1.** Raw Int16 PCM patient audio (`:206-224`). Transcripts for **both** speakers, patient and agent (`:162-167`). Tool results carrying `systolicBP` / `diastolicBP` and check-in summaries (`:176-190`). | WSS — TLS at transport. JWT verified on connect (`:87-89`). PATIENT-role gate rejects every other role (`:95-103`). CORS allowlist derived from `WEB_APP_URL` (`:34-59`). | **N/A** — no third party on this hop. It is browser ↔ our own backend. The onward hop to Google is pathway 5. |
| **2** | **Web Push**<br>backend → browser push service<br>`push/web-push.service.ts` | **T2 minimized (post-Lakshitha two-tier).** Two constants only: `PUSH_LOCK_SCREEN_BODY_ROUTINE = 'You have a new update'` and `PUSH_LOCK_SCREEN_BODY_URGENT = 'Please open Cardioplace now'` (`push/web-push.service.ts:41-43`; title is the fixed brand string `'Cardioplace'`). **No `Notification.title` or `Notification.body` reach the payload** — `send()` at `:194` takes `notificationId` only, and the design comment at `:186-192` states this explicitly ("payload never carries clinical text"). Payload assembly at `:221-229` reads only the two constants and the routing tier. URGENT tier fires only for a fixed set (`URGENT_ALERT_TIERS` at `:52-57`: `BP_LEVEL_2`, `BP_LEVEL_2_SYMPTOM_OVERRIDE`, `TIER_1_CONTRAINDICATION`, `TIER_1_ANGIOEDEMA`). | HTTPS to the push service. The payload is aes128gcm-encrypted by the `web-push` library to the subscription's own `p256dh`/`auth` keys — the push operator sees ciphertext. VAPID identifies the sender. | **None with FCM (Google) / Mozilla / Apple — and no BAA is needed post-minimization.** With no clinical text or patient identifiers in the encrypted body (just a generic prompt), the push operator has no PHI to disclose even if it decrypted the payload. Locked in with the two-tier fix. |
| **3** | **OTLP traces**<br>backend → collector<br>`observability/tracing.ts` | **T2, potential** — but the pathway is **reserved-but-unused in prod** (see §4). `http.url` / `http.route` carry path params including patient ids under auto-instrumentation (`:36-42`); manual spans set `voice.user.id` / `voice.session.id` (`voice/voice.service.ts:344-350`); **`db.statement` is NOT emitted** — no `@prisma/instrumentation` dependency. Content risk only realizes if the pathway is ever enabled in prod. | TLS to the collector. **No PHI scrubbing of any kind** — there is no span processor and no redaction of `http.url` in the file. The whole SDK **no-ops when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset** (`:15-18`), which is the prod state. | **N/A while dev-only.** Ruhaim confirmed 2026-07-16: OTLP is dev/local debugging only, never set in prod — no BAA needed. See §4 for the pre-conditions before this pathway can ever be enabled in prod. |
| **4** | **Email**<br>backend → recipient<br>`email/email.service.ts` | **Split by recipient class post-Lakshitha two-tier fix.**<br>• **Provider / MD / backup / ops** — **notify-and-link, NO patient PHI** (`daily_journal/services/escalation.service.ts:1877-1896`; comment at `:1877-1881` explicitly documents "NO patient PHI (no name, email, DOB, age, BP/pulse/position, clinical narrative, or rule metadata) — only the alert tier, practice, ack window, the non-PHI displayId reference, and a dashboard deep-link"). Staff subject lines carry no identifier (`:1782-1784`).<br>• **Patient (own email)** — carries name, DOB/age, BP block, and clinical narrative (`:1857-1875`). The patient is the data subject, so the content is permitted PHI, but the transport concern is the third-party BAA (see column).<br>• **Caregiver** — signed-off `caregiverMessage` only (minimum necessary).<br>• **Support-ops** — genuinely notify-and-link, no PHI (`email-templates.ts:535-537`). | **Prod = Resend HTTPS API** when `RESEND_API_KEY` is set (routing decision at `:112-114`; the actual `fetch('https://api.resend.com/emails', …)` is at `:299-320`) — Railway Hobby blocks SMTP ports. **Fallback = nodemailer SMTP with no `requireTLS` and no `tls.minVersion`** (`:121-128`) → opportunistic STARTTLS, silently downgradable. Confidentiality footer on every outbound template — universal `FOOTER` applied via `wrap()` on all transactional/operational templates (OTP, welcome, invite, MFA/biometric reset, caregiver update, scheduled call, monthly report, contact form) at `email/email-templates.ts:33-41`, plus a mirror escalation-only footer applied to both patient and provider/MD/Ops escalation bodies at `daily_journal/services/escalation.service.ts:1823-1824`.<br>**T3:** `EmailDisclosureLog` written on every *successful* PHI-bearing send — write trigger at `:162-187`, SHA-256 body hash for tamper-evidence at `:256` inside `_writeDisclosure`. Failed deliveries write no row — deliberate. | **Provider / MD / backup / ops = N/A** post-notify-and-link split (nothing to disclose).<br>**Patient email = interim non-compliant** — Resend has no BAA (routing above), so the patient-email path currently ships permitted-content PHI over an unsigned processor. Interim only; Google SMTP under the signed Google BAA is in progress. On Google-BAA landing, flip the patient email path to that transport. **Alternative interim** if the Google BAA slips: convert the patient email to notify-and-link too (parity with staff), so no PHI leaves the perimeter. |
| **5** | **Gemini / Vertex AI**<br>backend → Google<br>`gemini/google-genai-client.factory.ts` | **T1.** Voice audio plus **the patient's clinical context embedded in the system prompt** (`voice/voice.service.ts:282, 337-363`). Chat text (`gemini/gemini.service.ts:296-310`). OCR images — photos of prescriptions, pill bottles, BP monitors (`:216-246`). | HTTPS + WSS. **Vertex AI only** — `vertexai: true` with ADC / service-account credentials, and **no API-key path exists in the code at all** (`:45-63`; the header comment at `:4-8` confirms the AI-Studio fallback was removed). That is precisely what makes this pathway BAA-coverable. | **Google Cloud BAA** — being handled. |
| **6** | **Admin report downloads**<br>backend → admin browser → local device<br>`reports/*.controller.ts` | **T1.** CSV and PDF file attachments containing **patient names + per-patient adherence %, times due, times taken, doses missed, check-ins logged** (adherence — content confirmed at `reports/adherence.service.ts:365-374` writing `p.name` verbatim to the `BY PATIENT` section). Peer controllers ship comparable per-patient rollups: `reports/sla.controller.ts` (SLA metrics), `reports/quarterly.controller.ts` (quarterly clinical/operational rollup), `reports/cohort.controller.ts` (cohort analytics), `reports/reports.controller.ts` (monthly practice report). Every endpoint returns `Content-Disposition: attachment` (adherence CSV at `:81-83`, PDF at `:107-111`; SLA CSV at `:81-82`, PDF at `:105-109`) so the file **persists at rest on the admin's device** the moment it's saved. | HTTPS + `JwtAuthGuard` + `RolesGuard(SUPER_ADMIN, HEALPLACE_OPS, MEDICAL_DIRECTOR)` (`reports/adherence.controller.ts:34-36`) + per-practice scope check inside `ReportsService.assertCanRead`. **`AccessLog` write on every download** via `logRead()` (adherence at `:74`, `:101` — same on the peer controllers), so the "who exported which practice, when" trail is preserved as required by §164.312(b). | **N/A** — admin is a covered-entity user, not a third party. Downstream device-security (full-disk encryption, screen lock, safe disposal) is the admin org's responsibility and is covered by the workforce-safeguards clause of their BAA with us, not by a separate BAA. |

**Not in the six, but the register should be complete:** browser ↔ apps ↔ API over HTTPS; backend ↔ managed Postgres (fails closed in prod without a TLS signal, `prisma.service.ts:177-197`); backend `Logger.log` output → **AWS CloudWatch via the ECS `awslogs` driver** (`ecs/task-definition.json:20-23` — `logDriver: "awslogs"`, group `/ecs/healplace-backend`), inside the signed AWS BAA perimeter; non-PHI outbound HTTPS: public drug lookups (RxNorm / DailyMed / OpenFDA) and third-party ID-token verification endpoints — Google `oauth2.googleapis.com/tokeninfo` at `auth/auth.service.ts:2510` and Apple JWKS via `apple-signin-auth` at `:2612` — both receive only client-supplied OAuth tokens, no patient data. SMS exists only as a stub that throws (`sms/sms.service.ts:22-30` — `sendSms` throws `'SMS not configured'` unconditionally at `:27`) and there is **no WhatsApp implementation code** — WhatsApp appears once, as a comment in `crons/audit-exception-report.service.ts:30` naming it a downstream channel owned outside this codebase — neither is a live pathway.

**Companion audit-of-content note for row 6 and the CloudWatch line:** the file-content Minimum Necessary check on admin reports and a §164.312(b) log-content audit (grep of backend log lines for patient-name and clinical-value leakage) are both scoped **out** of this transmission-pathway table (they are content-safeguard checks, not transmission-security checks). Neither is complete yet; flag both to Humaira as adjacent open items.

---

## 2 · Residual worth recording (a real finding, not a doc error)

`voice.gateway.ts:50-55` — a client sending **no `Origin` header** (i.e. any non-browser client) bypasses the CORS allowlist:

```ts
// No Origin header → non-browser client (e.g. native/mobile voice). These
// can't mount a CSRF-style cross-site attack, so allow them through.
if (!origin) { callback(null, true); return }
```

The JWT check and the PATIENT-role gate still apply, so this is **not an open door** — and the reasoning in the comment is sound (CORS defends against browser cross-site attacks, which a non-browser client cannot mount). But it belongs in the register as a stated residual rather than being quietly dropped.

---

## 3 · Corrections history — both landed post-audit

On the 2026-07-14 revision, two entries in my task memo did not match the code and I flagged them to Humaira. **Both have since been fixed on `dev` and merged into `nivakaran-dev`.** Keeping the historical entries here for audit-trail continuity — future readers should ignore the "not fixed" tone and rely on the row-2 / row-4 statements above.

### 3.1 Web push minimization — RESOLVED 2026-07-15 (Lakshitha)

**Then (2026-07-14):** `web-push.service.ts:159-163` passed `Notification.title`/`body` straight through; `push-dispatch.extension.ts:43-48` forwarded them unchanged from the `Notification` row; `sw.js:16-25` rendered them on the lockscreen. The unit test at `push/web-push.service.spec.ts:96-99` asserted clinical content reaches the payload.

**Now:** two-tier minimization landed. `push/web-push.service.ts:41-43` defines the two generic bodies; `send()` at `:194` takes `notificationId` only and never touches title/body from the row (design comment `:186-192`, payload assembly `:221-229`). URGENT tier fires only for `URGENT_ALERT_TIERS` (`:52-57`). Row 2 above reflects the landed state.

### 3.2 Email escalation notify-and-link split — RESOLVED 2026-07-15 (Lakshitha)

**Then (2026-07-14):** the provider/MD body carried BP block, pulse, position, tier, step, mode, ruleId, and the pseudonymous `displayId` (`escalation.service.ts:1775-1819`). No patient name, but genuine clinical values — I described it as "minimum-necessary with a pseudonymous handle."

**Now:** the provider/MD/backup/ops body is genuinely notify-and-link with NO patient PHI (`escalation.service.ts:1877-1896`, explicit "NO patient PHI" comment at `:1877-1881`). Patient's own email still carries permitted-content PHI (unchanged). Row 4 above reflects the landed split.

### 3.3 Stale lines in `docs/ENCRYPTION.md` — still stale

- `:81` — *"🔴 Voice WebSocket CORS = wildcard — accepts any origin."* **Stale.** `voice.gateway.ts:34-59` now enforces a `WEB_APP_URL` allowlist (with the null-origin carve-out in §2).
- `:68` — *"In transit — external services ✅ HTTPS enforced by Gemini / Resend / Google SDKs."* Omits Web Push and OTLP entirely, and glosses the un-enforced SMTP STARTTLS.

### 3.3 Stale lines in `docs/ENCRYPTION.md`

- `:81` — *"🔴 Voice WebSocket CORS = wildcard — accepts any origin."* **Stale.** `voice.gateway.ts:34-59` now enforces a `WEB_APP_URL` allowlist (with the null-origin carve-out in §2).
- `:68` — *"In transit — external services ✅ HTTPS enforced by Gemini / Resend / Google SDKs."* Omits Web Push and OTLP entirely, and glosses the un-enforced SMTP STARTTLS.

---

## 4 · OTLP row — RESOLVED 2026-07-16 (Ruhaim)

**Ruhaim's 2026-07-16 CTO call confirmed:** `OTEL_EXPORTER_OTLP_ENDPOINT` is **development and local-debugging only, never set in production**. No ePHI has ever crossed this pathway with real patient data. No BAA is needed.

Register row 3 as **reserved-but-unused in prod**. The SDK no-ops when the env is unset (`tracing.ts:15-18`), which is the prod state. Pre-conditions for ever enabling it in prod (recorded so a future change doesn't slip through):

1. A signed BAA with the collector (LangSmith today would require one).
2. PHI scrubbing on `http.url` / `http.route` before spans leave the process (patient ids appear in path params; no span processor exists).
3. Explicit sign-off from the security/compliance owner and this doc updated to reflect the new state.

---

## 5 · Recorded decisions from the Ruhaim 2026-07-16 addendum

| Decision | Recorded by | Recorded on |
|---|---|---|
| **OTLP / LangSmith is dev/local only, no BAA needed.** See §4. | Ruhaim (CTO call) | 2026-07-16 |
| **Admin report downloads = HTTPS in transit + AWS-BAA-covered at rest.** The pathway-6 row already carries HTTPS + `JwtAuthGuard` + per-practice scope + `AccessLog` writes. Server-side rest is inside the signed AWS perimeter via the ECS `awslogs` driver's CloudWatch group (row-6 catch-all L23) and Postgres inside the same VPC. Downstream device-security (full-disk encryption, screen lock, safe disposal) is the admin org's workforce-safeguards responsibility, not a separate BAA. | Humaira / Ruhaim | 2026-07-16 |
| **Patient email carries permitted-content PHI over Resend without a BAA — interim non-compliant.** Google SMTP under the signed Google BAA is in progress. On Google-BAA landing, flip the patient email path to that transport. Alternative interim (if Google BAA slips) is to convert the patient email to notify-and-link too (parity with staff). | Ruhaim | 2026-07-16 |

These are the operational answers Humaira asked for in the 2026-07-14 review. They are ENGINEERING FACTS — the code paths supporting them are cited in rows 3, 4, and 6 above; the decision itself is a Compliance/CTO call, recorded here for traceability.
