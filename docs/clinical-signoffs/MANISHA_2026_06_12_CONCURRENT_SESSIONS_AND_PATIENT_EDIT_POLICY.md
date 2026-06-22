# Cardioplace — Concurrent Sessions & Patient Record Edit Policy

**Date:** 2026-06-12
**Prepared for:** Duwaragie Kugaraj (Dev 3), Ruhim (CTO)
**Reviewed by:** Dr. Manisha Singal (CMO)
**Re:** Follow-up questions from engineering team — (1) concurrent admin sessions and (2) patient requests to edit previous readings/records
**Status:** REVIEWED — proceed with implementation per recommendations below

---

## Q1 — CONCURRENT SESSIONS FOR ADMIN PORTAL USERS

**Decision:** ALLOW concurrent sessions, with constraints.

HIPAA Security Rule (45 CFR §164.312(a)(2)(i)) requires unique user identification and audit controls but does not prohibit concurrent sessions. Providers and admin staff routinely need multiple active sessions (e.g., desktop dashboard + mobile alert notifications). Major EHR systems permit concurrent sessions from the same authenticated user.

### Implementation

- Allow up to **3 concurrent sessions per admin/provider user** (desktop browser + mobile app + tablet)
- Each session maintains its own independent state, including practice context
- Each session has its own independent 15-minute idle timeout (per prior sign-off)
- Each session is independently logged in the audit trail with: session ID, device type, IP address, practice context, and all access events
- If a 4th session is initiated, the oldest idle session is terminated automatically
- Geographically implausible concurrent sessions (e.g., two different cities within minutes) generate an audit flag for practice admin review — **do NOT block access**, as this could impede clinical care
- **Patient app: limit to 1 active session** (no legitimate multi-device use case; single-session enforcement protects against unauthorized access on lost/shared devices)

### Risks mitigated

- Credential sharing: detected via geolocation anomaly flagging + audit trail review
- Session integrity: each session is independent; actions in one session do not affect another
- Unattended sessions: each session times out independently at 15 minutes

---

## Q2 — PATIENT REQUESTS TO UPDATE/EDIT PREVIOUS READINGS AND RECORDS

Two distinct scenarios with different handling requirements.

### Scenario A — Patient self-editing of previously submitted readings (within Cardioplace)

**Decision:** Patients can edit their own self-reported data at any time. No physician approval required.

Aligns with edit/delete policy already signed off. Patient-generated data (BP readings, weight, symptoms, medication entries) belongs to the patient — they have the right to correct their own self-reported entries.

#### How it works

- Within the 5-minute review window: patient can edit or delete freely; engine processes the latest value
- After the 5-minute window: patient can still edit or delete via the Readings list; edits are audit-logged but never retrigger alerts
- The original value is preserved in the audit trail — never permanently deleted
- Provider sees the full edit history in the Timeline tab: original value → edited value, with timestamps

#### Provider workflow when a patient edits a past reading

1. Provider sees the edit flagged in the Timeline tab
2. Provider uses clinical judgment to assess whether the edit is:
   - A legitimate correction (typo, misread cuff) — no action needed
   - A concerning pattern (systematically lowering readings to avoid alerts) — address during next clinical encounter
3. No system-level block on patient edits — the audit trail is the accountability mechanism
4. If a provider believes a patient is systematically falsifying readings, this is a clinical conversation, not a platform enforcement issue

### Scenario B — Patient requests to amend provider-generated records (HIPAA right of amendment)

**Decision:** Backlog for post-MVP. Handle manually during pilot.

Under HIPAA (45 CFR §164.526), patients have the right to request amendments to their PHI if they believe the information is inaccurate or incomplete.

**Volume expectation:** A 7-year study at a major academic medical center found that only approximately 0.2% of patients who accessed their records submitted an amendment request.

#### MVP handling (manual process)

1. Patient contacts care team with the amendment request (phone, in-app message, or in-person)
2. Assigned provider reviews the request
3. Provider either:
   - **Approves:** documents the amendment as an addendum in the patient's chart, linked to the original entry
   - **Denies:** documents the denial reason; informs the patient of their right to submit a statement of disagreement
4. All amendment requests, decisions, and any patient statements of disagreement are documented in the patient's record

#### Post-MVP automated workflow (backlog)

- In-app "Request Record Amendment" feature in the patient portal
- Request routes to the assigned provider's task queue
- Provider reviews and approves/denies within the platform
- Approved amendments are appended to the original record with full audit trail
- Denied requests include documented rationale + option for patient to submit statement of disagreement
- 60-day compliance timer with automated reminders

---

## Summary Table

| Question | Decision | Key Rationale | HIPAA Basis |
|---|---|---|---|
| Concurrent admin sessions | Allow up to 3; audit each independently | Providers need multi-device access; HIPAA requires unique ID + audit, not single-session | 45 CFR §164.312(a)(2)(i) — unique user ID; §164.312(b) — audit controls |
| Patient self-edit of readings | Allow at any time; no provider approval; audit-logged | Patient-generated data; patient has right to correct own entries; audit trail preserves originals | Consistent with edit/delete window policy; data integrity via audit trail |
| Patient amendment of provider records | Backlog for post-MVP; manual process during pilot | HIPAA right of amendment (45 CFR §164.526); low volume (~0.2% of patients); 60-day response requirement | 45 CFR §164.526 — right to amend PHI |
