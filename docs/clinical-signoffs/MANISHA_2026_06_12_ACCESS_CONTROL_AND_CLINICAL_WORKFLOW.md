# Cardioplace — Access Control & Clinical Workflow: Best Practice Responses

**Date:** 2026-06-12
**Prepared for:** Duwaragie Kugaraj (Dev 3), Ruhim (CTO)
**Reviewed by:** Dr. Manisha Singal (CMO)
**Re:** 7 access-control and clinical workflow questions — best practices and implementation recommendations
**Status:** REVIEWED — proceed with implementation per recommendations below

---

## 1. PRACTITIONER AFFILIATION WITH MULTIPLE PRACTICES

**Best practice:** One unique user identity per practitioner, with practice-context switching.

HIPAA Security Rule (45 CFR §164.312(a)(2)(i)) requires unique user identification so that every access event can be attributed to a specific individual. Major EHR systems implement this as a single login with a practice/organization selector at sign-in or via a context-switch menu.

**Cardioplace recommendation:**
- One credential per NPI-linked identity
- Practice-context selector at login (or context-switch menu if multi-practice is supported)
- Every audit-trail entry includes a `practiceContext` field
- Separate credentials per practice are **NOT recommended** — they create credential sprawl, increase password-reset burden, and make cross-practice auditing harder

---

## 2. PATIENT VISIBILITY WITHIN A PRACTICE

**Best practice:** Practice-level visibility with role-based access control (RBAC).

⚠️ **THIS CONTRADICTS CURRENT IMPLEMENTATION.** Currently the codebase enforces assignment-only visibility for PROVIDER role. The new policy is practice-wide visibility for all providers. See implementation impact below.

Under HIPAA's Treatment, Payment, and Operations (TPO) exception, providers within the same covered entity may access patient records for treatment purposes without individual patient authorization. The "minimum necessary" standard explicitly does not apply to disclosures for treatment. In practice, this means all physicians within a practice can see all patients of that practice — this is how virtually all EHR systems operate.

Access is restricted by role (physician vs. MA vs. billing staff), not by individual patient assignment.

**Cardioplace recommendation:**
- All providers within a practice see all patients of that practice (practice-level RBAC)
- Assignment determines who **receives alerts and escalations** — not who can view data
- Full audit logging of every patient-record access
- Role-based restrictions: physicians see clinical data; admin staff see administrative data; billing staff see billing-relevant data
- Do NOT implement assignment-only visibility — it would be more restrictive than standard healthcare practice and could impede coverage, cross-coverage, and quality review

---

## 3. ACCESS REQUEST / CONSENT WORKFLOW

**Best practice:** No patient consent required for same-practice provider access for treatment purposes.

Under HIPAA's TPO exception, patient consent is not required for provider-to-provider access within the same covered entity when the purpose is treatment, payment, or healthcare operations. Doctor B within the same practice does not need to request access from Doctor A or from the patient — they simply access the record, and the access is logged.

**Cardioplace recommendation:**
- No access-request workflow for same-practice providers
- Access is governed by practice membership + role, not by per-patient approval
- The audit trail is the accountability mechanism, not a consent gate
- No patient notification when a same-practice provider views their record
- Cross-practice access (if ever needed): out of MVP scope

---

## 4. DOCTOR DELEGATION / COVERAGE WORKFLOW

**Best practice:** Practice-level coverage model; no per-patient consent required.

Coverage is handled at the organizational level. When Doctor A is unavailable and Doctor B covers, Doctor B accesses the patient's record under the TPO treatment exception — no patient consent required.

**Cardioplace recommendation:**
- Admin app supports designating a covering provider (e.g., "Doctor B is covering for Doctor A from June 10–14")
- Coverage designation routes Doctor A's alerts to Doctor B during the coverage period
- Doctor B already has practice-level visibility to all patients (per Q2)
- Coverage designation is logged in the audit trail
- No patient consent workflow needed
- Coverage can be set by: the covering provider's own designation, the practice admin, or the departing provider

---

## 5. EMERGENCY ACCESS WORKFLOW

**Best practice:** "Break the Glass" (BtG) access — immediate access, logged and audited retrospectively.

**Cardioplace recommendation:**
- Since the MVP uses practice-level visibility (per Q2), a formal BtG mechanism is only needed if cross-practice access is implemented later
- Within a single practice, any provider can already access any patient's record
- The escalation ladder handles assigned-provider-unavailable by escalating to Medical Director
- For future cross-practice scenarios: implement BtG button that (a) requires emergency-purpose acknowledgment, (b) grants immediate access, (c) logs with reason code, (d) triggers retrospective audit review

---

## 6. AUTHENTICATION PRACTICES (2FA)

**Best practice:** Multi-factor authentication (MFA) with authenticator app (TOTP) as the preferred second factor.

⚠️ **THIS IS A PILOT GAP.** Current implementation is single-factor email OTP + magic link only. No 2FA exists today.

**Cardioplace recommendation:**
- Provider/admin login: password + authenticator app (TOTP) as the minimum
- Patient app: biometric unlock (fingerprint/Face ID) with password fallback
- Support for hardware security keys (FIDO2/WebAuthn) as an optional upgrade path
- **Do NOT rely on SMS OTP as the sole second factor** — vulnerable to SIM-swapping; phased out by NIST guidance

---

## 7. SESSION TIMEOUT / AUTO LOGOUT BEHAVIOR

**Best practice:** Automatic logoff after predetermined inactivity period; re-authentication required.

⚠️ **THIS IS A PILOT GAP.** Current implementation has no idle-timeout enforcement (only 15-min access token expiry without inactivity check).

HIPAA Security Rule (45 CFR §164.312(a)(2)(iii)) requires automatic logoff as addressable implementation specification.

**Cardioplace recommendation:**
- Provider/admin web app: **15-minute idle timeout**
- Patient mobile app: **5-minute idle timeout** with biometric re-unlock option
- Session termination logged in the audit trail
- Active session indicator in the UI (e.g., countdown warning at 2 minutes before timeout)
- No "remember me" option for provider/admin sessions — each session requires full authentication

---

## Summary Table

| Question | Best Practice | Cardioplace Recommendation | HIPAA Basis |
|---|---|---|---|
| 1. Multi-practice login | Single identity, practice-context switching | One credential per NPI; `practiceContext` in audit trail | 45 CFR §164.312(a)(2)(i) |
| 2. Patient visibility | Practice-level RBAC; all providers see all patients | Practice-level visibility; assignment governs alerts, not access | TPO exception; minimum necessary does not apply to treatment |
| 3. Access request/consent | No patient consent for same-practice TPO access | No access-request workflow; audit trail is accountability mechanism | TPO exception |
| 4. Coverage workflow | Organizational-level coverage; no per-patient consent | Admin-designated coverage; alerts rerouted; audit logged | TPO exception |
| 5. Emergency access | Break the Glass — immediate access, retrospective audit | Practice-level visibility already covers this; BtG for future cross-practice | TPO exception; BtG is standard EHR pattern |
| 6. Authentication (2FA) | MFA with authenticator app (TOTP) preferred | Password + TOTP for providers; biometric for patients | 45 CFR §164.312(d) |
| 7. Session timeout | Auto-logoff after inactivity; re-auth required | 15 min web, 5 min mobile; session termination logged | 45 CFR §164.312(a)(2)(iii) |

---

## Key Implementation Principles

1. **Audit everything:** Every access, every context switch, every coverage designation, every session start/end. The audit trail is the primary accountability mechanism under HIPAA.
2. **Practice-level RBAC is the standard:** Do not over-engineer patient-level access controls that are more restrictive than standard healthcare practice. Assignment governs alert routing, not data visibility.
3. **TPO is the governing exception:** Within a covered entity, treatment-purpose access does not require patient consent.
4. **MFA is non-negotiable:** Password-only authentication is below the current standard of care for healthcare applications.
5. **Session management is a HIPAA requirement:** Auto-logoff must be implemented; the timeout duration should match industry standards (15 min web / 5 min mobile).

---

## Items Added from Live Call Discussion (2026-06-12)

Beyond the docs, the call surfaced these additional decisions/asks (to be formalized by Rengan + Manisha in a separate document this weekend):

- **SMS/text notification channel** is needed in addition to email + in-app. Twilio mentioned as candidate.
- **"One number per practice"** hotline model — one rotating on-call person (could be nurse, practice manager, doctor) holds the SMS/voice number.
- **Practice-configurable escalation flow** via dropdowns — each practice configures who gets alerted, with timeouts and rules.
- **Acknowledgment via SMS reply** vs requiring app login — like OpenTable's text-1-for-yes / text-2-for-no pattern.
- **"Third contact" role flexibility** — was rigidly Medical Director in our care team model; may need to be practice manager / nurse manager configurable.
- **Practice-level emergency contact phone number** as a new entity in the data model.
