# ePHI Inventory — Cardioplace v2

**Owner:** Nivakaran (backend). Reviewed by Duwaragie (2026-07-07).
**Scope:** Every Prisma model in `backend/prisma/schema/*.prisma` — 45 models total (as of `origin/dev` head 2026-07-06).
**Purpose:** The authoritative list of which models carry electronic Protected Health Information (ePHI) and therefore fall under HIPAA §164.312(b) audit-controls scope. This document is the source of truth referenced by:

- `backend/src/common/prisma-extensions/phi-inventory.ts` — `CANONICAL_PHI_MODELS` set that the conformance suite (N3) asserts `PHI_MODELS` matches.
- `backend/src/common/prisma-extensions/access-log.extension.ts:28-37` — the runtime `PHI_MODELS` set that gates AccessLog writes.
- `docs/ACCESS_SCOPE.md` — the role-to-scope matrix.

**Rule for adding a new model to the schema:** update this file first, then update `phi-inventory.ts`. The conformance test in `access-log-conformance.e2e-spec.ts` will fail the build if these drift out of sync.

---

## Sensitivity tiers

| Tier | Definition | Examples |
|---|---|---|
| **T1 — Clinical** | Fields that carry a specific patient's health state: BP readings, symptoms, medications, chat/voice content, emergency events. | `JournalEntry`, `Conversation`, `EmergencyEvent`, `PatientMedication` |
| **T2 — Metadata** | Fields that identify a patient or their care relationship but don't themselves state a clinical fact. Still PHI under §164.514 (identifiers + relationship = disclosure). | `PatientProviderAssignment`, `PatientCaregiver`, `User` |
| **T3 — Disclosure trail** | Records of *who was told what* — critical for §164.528 accounting-of-disclosures. | `CaregiverDispatchLog`, `EmailDisclosureLog` (N6), `Notification` |

Every model in Table 1 below is tagged with one tier. Higher tiers get stricter retention and access requirements (defined in the forthcoming Audit Controls & Information System Activity Review Policy, Duwaragie sprint week 8).

---

## Table 1 — PHI-bearing models, audited by `PHI_MODELS` (20 rows)

### Currently in `PHI_MODELS` (7)

| # | Model | Schema file | Tier | PHI rationale |
|---|---|---|---|---|
| 1 | `User` | `user.prisma` | T2 | Patient identifier — name, email, DOB, role. Foundation for every downstream PHI join. |
| 2 | `PatientProfile` | `patient_profile.prisma` | T1 | Comorbidities (HF, CAD, AFib, HDP), pregnancy status, clinical booleans that gate alert logic. |
| 3 | `JournalEntry` | `daily_journal.prisma` | T1 | BP readings, pulse, weight, symptoms, session/timing metadata. The core clinical time series. |
| 4 | `DeviationAlert` | `diviation_alert.prisma` | T1 | Fired alert record with the specific reading that tripped a rule + the rule id + tier. |
| 5 | `Notification` | `notification.prisma` | T3 | Every in-app bell notice — includes `patientUserId`, alert-linked content, dispatch trigger. |
| 6 | `PatientMedication` | `patient_medication.prisma` | T1 | Drug name/class, dose, frequency, discontinue reason. Clinical medication list. |
| 7 | `PatientThreshold` | `patient_threshold.prisma` | T1 | SBP/DBP targets set per patient; a leak reveals the clinical goal. |

### To be added by N4 (13)

| # | Model | Schema file | Tier | PHI rationale |
|---|---|---|---|---|
| 8 | `EscalationEvent` | `escalation_event.prisma` | T3 | Alert dispatch ladder — recipient list, acknowledgedBy, resolvedBy — keyed on `userId` + `alertId`. §164.312(b) audit trail. |
| 9 | `ProfileVerificationLog` | `profile_verification_log.prisma` | T1 | previousValue/newValue JSON snapshots of clinical edits (profile, medication, threshold). Direct clinical change history. |
| 10 | `RejectedReadingLog` | `rejected_reading_log.prisma` | T1 | Raw BP/pulse readings (the malformed ones), userId FK. Same content as `JournalEntry` even though the read was rejected. |
| 11 | `PatientCaregiver` | `patient_caregiver.prisma` | T2 | Caregiver identity (name, phone, email) + `consentGivenAt` for PHI sharing. Schema comment: "consent to sharing PHI with this caregiver." |
| 12 | `CaregiverDispatchLog` | `patient_caregiver.prisma` | T3 | One row per (alert, caregiver, channel). Reveals a named caregiver was told about a named patient's alert. §164.528 disclosure trail. |
| 13 | `EmergencyEvent` | `emergencyEvent.prisma` | T1 | Patient's prompt text + emergency free-text + `isEmergency` flag, keyed on `userId`/`sessionId`. Clinical narrative. |
| 14 | `Conversation` | `conversation.prisma` | T1 | Chat history: `userMessage`, `aiSummary`, embedded vectors, keyed by `sessionId`. Patient-typed clinical Q&A. |
| 15 | `Session` | `session.prisma` | T1 | Chat session container: `title`, `summary`, `userId`. Same conversational stream as #14. |
| 16 | `SupportTicket` | `support.prisma` | T1 | subject/body/email/userId — patient free text on a HIPAA support channel. |
| 17 | `SupportTicketReply` | `support.prisma` | T1 | Reply body on the same ticket — same content type. |
| 18 | `SupportTicketAction` | `support.prisma` | T3 | Privileged reset actions with identity-verification metadata. Disclosure trail for MFA reset / account recovery. |
| 19 | `MonthlyReportSnapshot` | `monthly_report_snapshot.prisma` | T1 | Frozen monthly report `payload Json` — aggregated per-patient alert + adherence numbers, per practice. Not de-identified. |
| 20 | `PatientProviderAssignment` | `patient_provider_assignment.prisma` | T2 | Care-team assignment — the relationship "this provider treats this patient" is PHI under §164.514 identifiers. |

---

## Table 2 — Ambiguous, Manisha decision needed (2 rows)

| Model | Schema file | Current working assumption | Question for Manisha |
|---|---|---|---|
| `Document` | `document.prisma` | **Non-PHI.** Schema fields (`sourceName`, `sourceType`, `sourceSize`) are library-catalog metadata. No `userId` FK, no patient reference. Currently populated from `docs/*.md` (spec docs, ACCESS_SCOPE.md, etc.) for RAG. `content-scheduler.service.ts:23` comment classifies as non-PHI. | Is any patient-content document (chart notes, referral letters, uploaded medical records) ever ingested through this table? If yes → move to Table 1 (T1). |
| `DocumentVector` | `documentVector.prisma` | **Non-PHI** (inherits from Document). Chunk text + embedding vectors of the RAG library. Non-PHI iff Document is non-PHI. | Same question as above. |

**Action:** ping Manisha via WhatsApp (`docs/EPHI_INVENTORY.md` link) for sign-off. Response non-blocking for this week's N-tasks. If she flips either to PHI, add a follow-up PR that:
1. Moves the row(s) from Table 2 → Table 1 (Tier T1).
2. Adds `'Document'` (and/or `'DocumentVector'`) to `PHI_MODELS` in `access-log.extension.ts`.
3. Adds the same to `CANONICAL_PHI_MODELS` in `phi-inventory.ts`.
4. Runs conformance suite — expect green.

---

## Table 3 — Non-PHI (do NOT audit) — 23 rows

Grouped by concern. One-sentence rationale per group.

### Authentication mechanics (9)
Auth events are audited in `AuthLog` (separate stream from AccessLog). The auth-mechanism tables themselves carry credentials, not clinical data — a leak here compromises access, not privacy, and is handled by the auth-log audit stream.

| Model | Schema file |
|---|---|
| `AuthLog` | `authLog.prisma` |
| `AuthSession` | `auth_session.prisma` |
| `RefreshToken` | `refreshToken.prisma` |
| `Account` | `account.prisma` |
| `MagicLink` | `magicLink.prisma` |
| `OtpCode` | `otpCode.prisma` |
| `MfaRecoveryCode` | `mfa_recovery_code.prisma` |
| `TotpCredential` | `totp_credential.prisma` |
| `WebAuthnCredential` | `webauthn_credential.prisma` |

### Device fingerprints (2)
Device metadata (userAgent, deviceId) — no clinical content. Auditing device-registration attempts is a separate concern (also handled by AuthLog).

| Model | Schema file |
|---|---|
| `Device` | `device.prisma` |
| `UserDevice` | `userDevice.prisma` |

### Identifier ledger (2)
The DisplayId ledger is the "public handle" registry — the values themselves are designed to be shareable. No clinical content.

| Model | Schema file |
|---|---|
| `DisplayId` | `display_id.prisma` |
| `DisplayIdCollisionLog` | `display_id.prisma` |

### Org config (4)
Practice + role join tables. No patient linkage. Auditing these is org-management concern, not HIPAA §164.312(b).

| Model | Schema file |
|---|---|
| `Practice` | `practice.prisma` |
| `PracticeProvider` | `practice_provider.prisma` |
| `PracticeMedicalDirector` | `practice_medical_director.prisma` |
| `PracticeCoordinator` | `practice_coordinator.prisma` |

### Lifecycle / invite (2)
Admin-lifecycle audit trail. `AccountClosureLog` carries snapshotted `displayId`/`role` for the closed account but no clinical fields — structurally similar to AuthLog (an audit table already). `UserInvite` is a pre-account artifact.

| Model | Schema file |
|---|---|
| `UserInvite` | `user_invite.prisma` |
| `AccountClosureLog` | `account_closure_log.prisma` |

### Content library (6)
Educational articles / tips / FAQs. `ContentRating.userId` and `ContentView.userId` reveal what a patient viewed/rated — arguably a weak signal, but content is generic education (not a diagnosis). Currently coded as non-PHI (see `content-scheduler.service.ts:23`). Flag for Manisha review if strict interpretation preferred; not blocking.

| Model | Schema file |
|---|---|
| `Content` | `content.prisma` |
| `ContentAuditLog` | `contentAuditLog.prisma` |
| `ContentRating` | `contentRating.prisma` |
| `ContentReview` | `contentReview.prisma` |
| `ContentVersion` | `contentVersion.prisma` |
| `ContentView` | `contentView.prisma` |

### Audit sink itself (1)
`AccessLog` is the audit destination — auditing it would create infinite recursion. Guarded by the `PHI_MODELS` check in the Prisma extension.

| Model | Schema file |
|---|---|
| `AccessLog` | `access_log.prisma` |

---

## Reconciliation totals

- Table 1 (audited): **20 rows** (7 current + 13 to add via N4)
- Table 2 (ambiguous): **2 rows** (working assumption: non-PHI)
- Table 3 (non-PHI): **23 rows**
- **Total: 45 models** — matches full schema surface on `origin/dev` at commit `129b25a`.

---

## Change control

- Any PR that adds a new Prisma model MUST update this file BEFORE `PHI_MODELS` in `access-log.extension.ts` — the conformance test enforces that order.
- Any PR that reclassifies a model (Table 2 → 1, Table 3 → 1, etc.) needs Manisha sign-off (clinical) + Duwaragie sign-off (engineering) referenced in the PR description.
- Every quarterly HIPAA §164.308(a)(8) Evaluation reviews this file against the current schema.
