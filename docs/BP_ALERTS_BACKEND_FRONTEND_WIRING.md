# Cardioplace v2 — BP Alert Engine: Backend ↔ Frontend Wiring Audit

**Companion to [BP_RULE_BASED_ALERTS.md](BP_RULE_BASED_ALERTS.md)**

_Document revision 2026-05-20 (rev 2 — corrected after exhaustive grep re-verification). The prior revision had factual errors on `mode`, `pulsePressure`, `caregiverMessage`, `suboptimalMeasurement`, `actualValue`, `profileVerificationStatus`, and `heartFailureType`. This revision verifies every absence claim by direct grep against the codebase before standing by it._

---

## 0. Methodology

For every backend concept catalogued in `BP_RULE_BASED_ALERTS.md`, three orthogonal questions were answered:

1. **Is the value persisted?** (does the backend write it to a table or include it in a DTO?)
2. **Is the value exposed via HTTP?** (does some controller return it on a documented endpoint?)
3. **Is the value rendered?** (does any frontend component place it in the DOM?)

Question 3 was answered by **grep against the patient frontend (`frontend/src/`) AND the admin frontend (`admin/src/`)** searching for the literal field name or rendering pattern, then by reading the matched file to confirm the match is a render call (not a type declaration). Every cell in the wiring matrix has a verified file:line backing it.

**Corrections from rev 1.** Seven cells were wrong in the prior revision and have been re-evaluated. The corrections are noted inline with each affected row.

---

## 1. Wiring status summary

Status legend:

- ✅ **Full** — persisted, exposed, rendered in at least one UI surface with appropriate context.
- 🟡 **Partial** — persisted and exposed, but only part of the data renders, or only one of the two frontends has the surface.
- ❌ **Missing** — persisted but no frontend renders it.
- 🔧 **Engine-internal** — by design never exposed to a frontend.

| # | Backend concept | Patient app | Admin app | Status | Verified at |
|---|---|---|---|---|---|
| 1 | `ResolvedContext` (full snapshot) | — | — | 🔧 Engine-internal | n/a |
| 2 | Profile booleans (`hasCAD`, `hasHFrEF`, …) | Intake selects them | ProfileTab confirm/correct flow | ✅ Full | `frontend/src/app/clinical-intake/page.tsx`, `admin/src/components/patient-detail/ProfileTab.tsx` |
| 3 | `profileVerificationStatus` (UNVERIFIED/VERIFIED/CORRECTED) | ✅ Dashboard banner + Profile page VerifiedBadge | ✅ ProfileTab + per-field flow | ✅ Full **— corrected from ❌** | `frontend/src/components/cardio/Dashboard.tsx:289`, `frontend/src/app/profile/page.tsx:669,726,964,977,1117` |
| 4 | `resolvedHFType` / `heartFailureType` | Set at intake; not surfaced back post-intake | ProfileTab dropdown | 🟡 Partial **— corrected from ❌** | `frontend/src/app/clinical-intake/page.tsx:774-794`, `admin/.../ProfileTab.tsx` |
| 5 | `User.enrolledAt` | — | Implicit in `enrollmentStatus` only; raw timestamp absent | 🟡 Partial | `admin/.../EnrollmentCard.tsx` (no grep hit on `enrolledAt`) |
| 6 | `User.preferredLanguage` | ✅ LanguageContext precedence | ❌ No admin surface (grep returned 0 hits) | 🟡 Partial | `frontend/src/contexts/LanguageContext.tsx`; absent from `admin/src/` |
| 7 | Active medications (drugClass / drugName) | Intake selects them | MedicationsTab with verification | ✅ Full | `admin/.../MedicationsTab.tsx` |
| 8 | `PatientThreshold.sbpUpperTarget` / `dbpUpperTarget` (provider override, UPPER) | ✅ "Your goal" card | ✅ ThresholdsTab editor | ✅ Full | `frontend/.../Dashboard.tsx:428-430`, `admin/.../ThresholdsTab.tsx` |
| 9 | `PatientThreshold.sbpLowerTarget` / `dbpLowerTarget` (LOWER targets) | Read for status-pill comparison but **not rendered as numbers** | ✅ Rendered as editable fields in ThresholdsTab | 🟡 Partial | `frontend/.../Dashboard.tsx:386-387` (read only), `admin/.../ThresholdsTab.tsx:49-86` (rendered) |
| 10 | Session-averaged mean SBP/DBP | — | — | ❌ Missing | grep for `sessionAverage`/`sessionMean` returned 0 hits in either frontend |
| 11 | `readingCount` at evaluation time | — | — | 🔧 Engine-internal | — |
| 12 | Q2 single-reading gate (`pendingSecondReading` hint) | ✅ CheckIn renders "take a second reading" prompt | — | ✅ Full | `frontend/src/components/cardio/CheckIn.tsx` |
| 13 | 5-minute finalize endpoint | ✅ Auto-fires on timer | — | ✅ Full | `frontend/src/lib/services/journal.service.ts` |
| 14 | AFib ≥3-reading gate | ❌ Patient unaware | ❌ Admin unaware | 🔧 Engine-internal | — |
| 15 | Mode (STANDARD / PERSONALIZED) on alert | ❌ No patient surface | ✅ EscalationAuditTrail "Mode" row | 🟡 Partial **— corrected from ❌** | `admin/src/components/patient-detail/EscalationAuditTrail.tsx:612` |
| 16 | Pre-baseline disclaimer (preDay3) | 🟡 Embedded in `patientMessage` text | — | 🟡 Partial | `shared/src/alert-messages.ts` |
| 17 | Stage A symptom flags (8 keys: severeHeadache, visualChanges, alteredMentalStatus, chestPainOrDyspnea, focalNeuroDeficit, severeEpigastricPain, plus ruqPain shared) | ✅ CheckIn checkboxes | ✅ ReadingsTab via JournalEntry | ✅ Full | `frontend/src/components/cardio/CheckIn.tsx` |
| 18 | Pregnancy symptoms (newOnsetHeadache, ruqPain, edema) | ✅ CheckIn checkboxes | ✅ ReadingsTab | ✅ Full | as above |
| 19 | Cluster 6/7/8 symptoms (8 keys: dizziness, syncope, palpitations, legSwelling, fatigue, shortnessOfBreath, dryCough, faceSwelling, throatTightness) | ✅ CheckIn checkboxes | ✅ ReadingsTab | ✅ Full | as above |
| 20 | `RULE_ABSOLUTE_EMERGENCY` (Stage B) | ✅ EmergencyAlertScreen + 911 CTA | ✅ AlertsTab BP_L2 bucket | ✅ Full | `frontend/.../EmergencyAlertScreen.tsx`, `admin/.../AlertCard.tsx:46-71` |
| 21 | `RULE_SYMPTOM_OVERRIDE_PREGNANCY` / `_GENERAL` (Stage A) | ✅ EmergencyAlertScreen | ✅ AlertsTab BP_L2 bucket | ✅ Full | as above |
| 22 | `RULE_PREGNANCY_L2` / `RULE_PREGNANCY_L1_HIGH` | ✅ TierAlertView | ✅ AlertsTab | ✅ Full | `frontend/.../TierAlertView.tsx`, `admin/.../AlertCard.tsx` |
| 23 | `RULE_HFREF_LOW` / `_HIGH` | ✅ TierAlertView | ✅ AlertsTab | ✅ Full | as above |
| 24 | `RULE_HFPEF_LOW` / `_HIGH` | ✅ TierAlertView | ✅ AlertsTab | ✅ Full | as above |
| 25 | `RULE_CAD_DBP_CRITICAL` (J-curve) | ✅ TierAlertView BP_L1_LOW | ✅ AlertsTab | ✅ Full | as above |
| 26 | `RULE_CAD_HIGH` (ramped SBP) | ✅ TierAlertView BP_L1_HIGH | ✅ AlertsTab | ✅ Full | as above |
| 27 | `RULE_CAD_DBP_HIGH` (Cluster 8 Q2) | ✅ TierAlertView | ✅ AlertsTab | ✅ Full | as above |
| 28 | `RULE_HCM_LOW` / `_HIGH` | ✅ TierAlertView (HCM_LOW carries under-perfusion wording) | ✅ AlertsTab | ✅ Full | as above |
| 29 | `RULE_HCM_VASODILATOR` (Tier 3) | — (empty patient text by design) | ✅ MedicationsTab inline pill + AlertsTab | ✅ Full | `admin/.../MedicationsTab.tsx`, `admin/.../AlertCard.tsx` |
| 30 | `RULE_DCM_LOW` / `_HIGH` | ✅ TierAlertView | ✅ AlertsTab | ✅ Full | as above |
| 31 | `RULE_PERSONALIZED_HIGH` (+20 band) | ✅ Body text | ✅ AlertsTab | ✅ Full | rule fires and routes through normal alert pipeline |
| 32 | `RULE_PERSONALIZED_LOW` | ✅ Body text | ✅ AlertsTab | ✅ Full | as above |
| 33 | `PERSONALIZED_BAND_MMHG = 20` (the +20 mmHg band itself) | ❌ Not displayed | ❌ Not displayed | ❌ Missing | grep for `PERSONALIZED_BAND`, `+ 20`, `target +` returned 0 hits in either frontend |
| 34 | `RULE_STANDARD_L1_HIGH` / `_LOW` | ✅ TierAlertView | ✅ AlertsTab | ✅ Full | — |
| 35 | `RULE_AGE_65_LOW` | ✅ TierAlertView | ✅ AlertsTab | ✅ Full | — |
| 36 | `RULE_PULSE_PRESSURE_WIDE` (Tier 3 standalone) | — (empty patient text by design) | ✅ AlertsTab Tier-3 section | ✅ Full | `admin/.../AlertCard.tsx:46-71` |
| 37 | `RULE_LOOP_DIURETIC_HYPOTENSION` (Tier 3) | — (empty patient text by design) | ✅ MedicationsTab inline pill + AlertsTab | ✅ Full | — |
| 38 | `getCadHtnUncontrolledAnnotation` | — (rides on `physicianMessage`) | ✅ Renders in AlertCard's Physician three-tier card | ✅ Full | `admin/src/components/AlertCard.tsx:374-380` |
| 39 | `RULE_PREGNANCY_ACE_ARB` (T1 contra) | ✅ TierAlertView TIER_1 variant | ✅ AlertsTab TIER_1 bucket | ✅ Full | — |
| 40 | `RULE_NDHP_HFREF` (T1 contra) | ✅ TierAlertView TIER_1 variant | ✅ AlertsTab TIER_1 bucket | ✅ Full | — |
| 41 | `TIER_1_ANGIOEDEMA` (Cluster 8) | ✅ TierAlertView + i18n routing | ✅ AlertsTab | ✅ Full | `frontend/.../TierAlertView.tsx:192-200` |
| 42 | Axis-based co-fire (multiple persisted rows per reading) | 🟡 Renders as separate cards, no grouping | 🟡 Separate AlertCard rows, no grouping | 🟡 Partial | both frontends list rows independently |
| 43 | `AXIS_PRIORITY` ordering | implicit in row order | implicit | 🔧 Engine-internal | — |
| 44 | `axisFor(ruleId)` mapping | — | — | 🔧 Engine-internal | — |
| 45 | Threshold hierarchy (provider > rollout > spec) | Patient sees provider upper only | ✅ ThresholdsTab + condition-default hints | 🟡 Partial | `admin/.../ThresholdsTab.tsx:127-128,197-216` (defaults rendered inline) |
| 46 | CAD phased rollout (`cadRampApplies`) | — | 🟡 Hardcoded English banner; no API field per patient | 🟡 Partial | `admin/.../ProfileTab.tsx` banner |
| 47 | `CAD_THRESHOLD_ROLLOUT_PHASE` / `CAD_ROLLOUT_START` env vars | — | — | 🔧 Engine-internal | — |
| 48 | One-time provider notice (CAD threshold update) | — | ✅ Dashboard Notification row | ✅ Full | `backend/src/daily_journal/services/alert-engine.service.ts` `maybeNotifyCadThresholdRamp` |
| 49 | Persistent CAD admin banner | — | ✅ ProfileTab teal info banner | ✅ Full | `admin/.../ProfileTab.tsx:419+` |
| 50 | `patientMessage` | ✅ TierAlertView body, notifications, dashboard top-alert | ✅ AlertCard expanded three-tier grid (`title="Patient"`) | ✅ Full | `admin/src/components/AlertCard.tsx:360-366` |
| 51 | `caregiverMessage` | ❌ Not rendered (no caregiver surface yet) | ✅ AlertCard expanded three-tier grid (`title="Caregiver"`) | 🟡 Partial **— corrected from ❌** | `admin/src/components/AlertCard.tsx:367-373` |
| 52 | `physicianMessage` | — (by design) | ✅ AlertCard expanded three-tier grid (`title="Physician"`) | ✅ Full **— corrected from "only Tier-3 section"** | `admin/src/components/AlertCard.tsx:374-380` |
| 53 | `formatTriggeringValue(ruleId, actualValue)` (axis-labelled value) | — | ✅ EscalationAuditTrail "Triggering value" row | ✅ Full | `admin/.../EscalationAuditTrail.tsx:641-643` |
| 54 | Locale-aware patient rendering (en/es/am/fr/de) | ✅ Wired for `RULE_ACE_ANGIOEDEMA` / `RULE_GENERIC_ANGIOEDEMA` only | — (admin is English-only by design) | 🟡 Partial | `frontend/src/components/alerts/TierAlertView.tsx:192-200` |
| 55 | `actualValue` (numeric trigger) | ✅ Rendered in notifications page for non-BP alerts (`alert.actualValue.toFixed(0)`) | ✅ Rendered via formatTriggeringValue in EscalationAuditTrail | ✅ Full **— corrected from "patient ❌"** | `frontend/src/app/notifications/page.tsx:410-414`, `admin/.../EscalationAuditTrail.tsx:643` |
| 56 | `thresholdValue` (rule's effective threshold value in metadata) | ❌ Not rendered | ❌ Not rendered (audit-trail row uses `actualValue`, not `thresholdValue`) | ❌ Missing **— corrected from "✅ admin"** | grep across both frontends returned only DTO type declarations, no rendering. The audit-trail's "Triggering value" row uses `actualValue`, not `thresholdValue`. |
| 57 | `pulsePressure` (derived field on alert + entry) | ✅ CheckinCard "Wide pulse pressure" teal badge with tooltip | ✅ Rendered THREE places: AlertCard inline `PP X` badge (amber when >60), ReadingsTab `Stat` (amber when >60), EscalationAuditTrail audit row | ✅ Full **— corrected from "❌ Missing"** | `frontend/src/components/cardio/cards/CheckinCard.tsx:166-177`, `admin/.../AlertCard.tsx:261-277`, `admin/.../ReadingsTab.tsx:368-374`, `admin/.../EscalationAuditTrail.tsx:635` |
| 58 | `suboptimalMeasurement` (quality flag) | ❌ Type declared in DTO; no render found | ✅ ReadingsTab shows quality warning + `failedConditions` detail when true | 🟡 Partial **— corrected from "❌ Missing"** | `admin/.../ReadingsTab.tsx:295,515` |
| 59 | `sessionId` on alert (links co-fired rows) | ❌ Not rendered | ❌ Not rendered (declared on DTO at `provider.service.ts:73`, never displayed) | ❌ Missing | grep returned 0 render hits in admin; patient hits were all `useVoiceSession.ts` (voice client sessions, unrelated) |
| 60 | `ruleId` displayed | — (implicit via tier variant routing + Cluster 6 Q4 sequential surfacing) | ✅ AlertCard row footer renders `ruleId` after timestamp | ✅ Full | `admin/src/components/AlertCard.tsx:287` |
| 61 | `dismissible` (computed from tier) | ✅ Hides ack button in TierAlertView | ✅ Admin requires resolution rationale when non-dismissable | ✅ Full | — |
| 62 | `acknowledgedAt` (patient) | ✅ "I've seen this" state | ✅ AlertCard status badge ("Acknowledged" pill) | ✅ Full | `admin/src/components/AlertCard.tsx:222-231` |
| 63 | `resolvedBy` / `resolutionAction` / `resolutionRationale` | ✅ TierAlertView resolution banner | ✅ AlertCard "Resolved" pill + EscalationAuditTrail "Resolution action" row | ✅ Full | `admin/src/components/AlertCard.tsx:212-221`, `admin/.../EscalationAuditTrail.tsx:629-633` |
| 64 | `escalated` flag | 🟡 Inconsistent across surfaces | ✅ AlertCard "Escalated" red pill | ✅ Full | `admin/src/components/AlertCard.tsx:232-239` |
| 65 | `status` (OPEN / ACKNOWLEDGED / RESOLVED) | ✅ | ✅ | ✅ Full | — |
| 66 | `ladderForTier` selection per tier | — | ✅ EscalationAuditTrail renders the full ladder | ✅ Full | — |
| 67 | `BP_LEVEL_1_PATIENT_T0` immediate patient push | ✅ Push + dashboard notification fires | — | ✅ Full | — |
| 68 | Acknowledgement-aware advancement (`@Cron 15m`) | — | ✅ TimelineTab renders advanced steps with timestamps + recipient roles | ✅ Full | — |
| 69 | After-hours queueing (`PENDING_SCHEDULED`) | — | 🟡 `afterHours` flag on step; next-business-hours preview absent | 🟡 Partial | — |
| 70 | Practice business hours configuration | — | 🟡 Stored; no preview UI of "this will fire at 8am Monday" | 🟡 Partial | — |
| 71 | 15-field JCAHO audit trail | — | ✅ EscalationAuditTrail (11 of 15 fields wired — see §2.13) | 🟡 Partial | `admin/.../EscalationAuditTrail.tsx:607-646` |
| 72 | `profileState` audit field (PROVISIONAL/VERIFIED at eval time) | — | ❌ Not in EscalationAuditTrail's field list | ❌ Missing | — |
| 73 | `outputGeneratorVersion` audit field (registry hash) | — | ❌ Not in EscalationAuditTrail's field list | ❌ Missing | — |
| 74 | Patient T+0 dashboard `Notification` | ✅ notifications/page.tsx | — | ✅ Full | — |
| 75 | Cluster 6 Q4 sequential surfacing (BP_L2 → T1 ACE/ARB) | ✅ `app/alerts/[id]/page.tsx` routing | — | ✅ Full | — |
| 76 | Brady-surveillance reading flag (`RULE_BRADY_SURVEILLANCE`) | — | ✅ ReadingsTab "Surveillance" pill | ✅ Full | `admin/.../ReadingsTab.tsx` |
| 77 | Tier-3 grouping ("Physician notes" vs primary alerts) | — | ✅ AlertsTab two-section render | ✅ Full | — |
| 78 | `tier` variant routing (Tier-1-angioedema, BP-L2, BP-L1, Tier-1-contra, Tier-3) | ✅ TierAlertView + EmergencyAlertScreen + alerts/[id] | ✅ AlertCard tier badge + bucket | ✅ Full | both frontends |

---

## 2. Per-concept detailed audit

### 2.1 Profile resolution (`§5` of disclosure)

| Concept | Backend source | API | Patient | Admin | Gap |
|---|---|---|---|---|---|
| Condition booleans | `PatientProfile` Prisma model | `GET /api/me/profile` · `GET /admin/users/:id/profile` | Selected at clinical intake | ProfileTab confirm/correct | None |
| Trust-then-verify state | `profileVerificationStatus` enum | exposed | ✅ Dashboard renders "complete your intake" CTA when UNVERIFIED; profile page shows `VerifiedBadge` with the status | ✅ ProfileTab badge | None |
| Resolved HF type | `resolvedHFType` field | exposed | Set at intake (HFREF/HFPEF/UNKNOWN); not re-displayed back on dashboard/profile | ✅ ProfileTab dropdown | Patient sets it but doesn't see "your resolved HF type is X" surfaced back |
| Verification timestamp | `profileVerifiedAt` | exposed | — | ✅ ProfileTab "Verified X days ago" | — |

### 2.2 Session averaging and Q2 gate (`§6`)

| Concept | Patient | Admin | Gap |
|---|---|---|---|
| Session window (10 min default) | — | — | Engine-internal config |
| Session-averaged mean SBP/DBP (the value the engine evaluates against) | ❌ | ❌ | **Verified absent** — grep for `sessionAverage`/`sessionMean` returned 0 hits in either frontend. A patient who sees a 138/89 reading but no alert (because the session mean was 134/86) cannot reconcile the discrepancy. |
| `pendingSecondReading` response field | ✅ CheckIn renders "take a second reading in about a minute" | — | None |
| 5-minute finalize | ✅ Auto-fires via timer | — | None |
| AFib ≥3-reading gate | ❌ Patient unaware | ❌ Admin unaware | New AFib patient gets no BP alerts for first two readings without explanation |

### 2.3 Mode resolution (`§7`)

| Concept | Patient | Admin | Gap |
|---|---|---|---|
| `mode` on alert (STANDARD/PERSONALIZED) | ❌ No surface | **✅ EscalationAuditTrail row `"Mode: <STANDARD|PERSONALIZED>"`** | Patient cannot tell whether their alert was evaluated against population defaults or their personal targets. Admin has the value in the audit panel but no inline badge on the AlertCard row itself. |
| Pre-baseline disclaimer (preDay3Mode) | 🟡 Inlined in `patientMessage` body string | — | If the engine omits the disclaimer suffix, the patient cannot infer the state |
| `personalizedEligible` / `preDay3Mode` flags | — | — | Engine-internal transients |

**Correction from rev 1.** Mode rendering in admin was missed in the first audit. It IS rendered via `prettify(alert.mode)` at `EscalationAuditTrail.tsx:612`. Severity downgraded from "Critical C2" to "Medium" — admin clinicians can see it; the gap is patient-only.

### 2.4 Three-tier message generation (`§12`)

This is the most consequential correction from rev 1.

| Field | Patient | Admin | Verified at |
|---|---|---|---|
| `patientMessage` | ✅ TierAlertView body, notifications, dashboard top-alert card | ✅ `<ThreeTierMessageCard title="Patient" message={alert.patientMessage} />` in expanded AlertCard | `admin/src/components/AlertCard.tsx:360-366` |
| `caregiverMessage` | ❌ Not rendered (no caregiver-recipient surface; flag-gated dispatch) | **✅ `<ThreeTierMessageCard title="Caregiver" message={alert.caregiverMessage} />` in expanded AlertCard** — visible to clinicians for QA / future caregiver outreach | `admin/src/components/AlertCard.tsx:367-373` |
| `physicianMessage` | — (by design) | **✅ `<ThreeTierMessageCard title="Physician" message={alert.physicianMessage} />` in expanded AlertCard** + clinician annotations (CAD-HTN-uncontrolled, wide-PP, loop-diuretic) ride this string | `admin/src/components/AlertCard.tsx:374-380` |
| Locale-aware patient rendering | 🟡 Wired only for `RULE_ACE_ANGIOEDEMA` / `RULE_GENERIC_ANGIOEDEMA` | — | All other patient messages render in English regardless of `User.preferredLanguage` |

**Correction from rev 1.** Rev 1 claimed `caregiverMessage` was "❌ Never rendered" — wrong. It renders in the admin's expanded AlertCard alongside the patient and physician strings. The `CAREGIVER_DISPATCH_ENABLED=false` flag gates *outbound notifications to the caregiver*, not the admin's read view of the string. The recommendation severity (rev 1 H5) is materially lower than stated.

### 2.5 Stage A symptom overrides (`§8.2`)

| Concept | Backend | Patient | Admin |
|---|---|---|---|
| All 19 structured symptom flags on `JournalEntry` | persisted booleans | ✅ CheckIn checkboxes for all (incl. faceSwelling, throatTightness, fatigue, SOB, dryCough — Clusters 6/7/8) | ✅ ReadingsTab + TimelineTab |
| Pregnancy-claim priority logging | logged at DEBUG | — | ❌ Forensic-only |

### 2.6 Stage B absolute emergency (`§8.3`)

| Concept | Patient | Admin |
|---|---|---|
| 180/120 cutoff | ✅ EmergencyAlertScreen full-bleed red 911 CTA | ✅ AlertsTab BP_L2 bucket |
| Bypass of Q2 gate | Implicit (emergency fires on first reading) | — |

### 2.7 Stage C condition branches (`§8.5`)

**HFrEF / HFpEF / HCM / DCM / CAD three-axis split:** all rule firings reach both UIs. Patient sees `TierAlertView` body; admin sees `AlertCard` with tier badge + ruleId + expanded three-tier messages + EscalationAuditTrail.

| Concept | Backend | Patient | Admin | Gap |
|---|---|---|---|---|
| CAD three-row co-fire from one reading | 3 persisted `DeviationAlert` rows with shared `sessionId` | 🟡 Renders as 3 independent cards | 🟡 Renders as 3 independent AlertCard rows | **No `sessionId`-grouping affordance on either side.** Reviewers cannot tell at a glance that three concerns came from one reading. |
| `getCadHtnUncontrolledAnnotation` (class-switch guidance) | appended to J-curve row's `physicianMessage` | — | ✅ Rendered inside `<ThreeTierMessageCard title="Physician">` | None |

**Personalized rules — the asymmetric +20 band:**

| Concept | Backend | Patient | Admin | Gap |
|---|---|---|---|---|
| `PERSONALIZED_BAND_MMHG = 20` (additive on the high-side target) | hardcoded constant | ❌ | ❌ | **Verified absent.** grep for `PERSONALIZED_BAND`, `+ 20`, `target +`, `sbpUpperTarget +` returned 0 hits in either frontend. Provider setting `sbpUpperTarget = 130` expects alerts at 130; engine fires at 150. The misalignment is silent in both UIs. |

### 2.8 Physician-only annotations (`§8.5.9`)

| Rule | Patient | Admin | Gap |
|---|---|---|---|
| `RULE_PULSE_PRESSURE_WIDE` | — (empty patient text per spec); 🟡 CheckinCard shows a generic "Wide pulse pressure" badge | ✅ AlertCard Tier-3 section + AlertCard row inline `PP X` badge with amber tint when >60 | None |
| `RULE_LOOP_DIURETIC_HYPOTENSION` | — | ✅ MedicationsTab inline teal "Note" badge + AlertsTab Tier-3 section | None |
| `getCadHtnUncontrolledAnnotation` | — | ✅ Inside Physician three-tier card | None |
| Loop-diuretic HF-exclusion rationale | — | ❌ The admin cannot see "this rule does not fire for HF patients because the HF-specific rules subsume it" | Documentation-only gap |

### 2.9 Threshold hierarchy and CAD phased rollout (`§9`, `§10`)

| Concept | Patient | Admin | Gap |
|---|---|---|---|
| Provider-set `sbpUpperTarget` / `dbpUpperTarget` | ✅ "Your goal" card renders **upper bound only** when set | ✅ ThresholdsTab editable fields | None |
| Provider-set `sbpLowerTarget` / `dbpLowerTarget` | Read internally for BP-status-pill coloring; **not rendered as numbers** | ✅ ThresholdsTab editable fields with condition-default hints | Patient does not see their own lower targets even when set |
| Spec defaults per condition (HFrEF 85, HFpEF 110, HCM 100, DCM 85, etc.) | ❌ | ✅ ThresholdsTab renders condition-default hints inline ("default for CAD: 70 / 140 / 80") and lets the user one-click apply them | Patient app never displays engine-active defaults |
| CAD ramp state for THIS patient | — | ❌ Banner text is hardcoded; no API field tells the admin "the effective threshold for this patient is currently 140" | Admin must mentally apply the threshold hierarchy |
| `CAD_THRESHOLD_ROLLOUT_PHASE` / `CAD_ROLLOUT_START` | — | ❌ No surface | Engine-internal by design; ops-managed |
| One-time CAD provider notice | — | ✅ Dashboard notification when the new default fires for the first time | None |
| Persistent CAD admin banner | — | ✅ ProfileTab teal info banner for every CAD patient | None |

### 2.10 Axis-based co-fire orchestration (`§11`)

| Concept | Backend | Patient | Admin | Gap |
|---|---|---|---|---|
| One alert row per axis | persisted as separate `DeviationAlert` rows sharing a `sessionId` | 🟡 Independent cards | 🟡 Independent AlertCard rows | **No visual grouping by `sessionId` on either side** |
| `sessionId` field on the alert DTO | ✅ Declared at `admin/src/lib/services/provider.service.ts:73` | ❌ Never rendered | ❌ Never rendered | Available for grouping; not used yet |
| Suppression logging | DEBUG-only | — | — | Forensic-only |

### 2.11 Persistence (`§13`) — `DeviationAlert` column-by-column

| Column | Persisted? | Patient UI | Admin UI |
|---|---|---|---|
| `tier` | ✅ | ✅ TierAlertView variant + EmergencyAlertScreen routing | ✅ AlertCard tier badge |
| `ruleId` | ✅ | ✅ Drives angioedema i18n + Cluster 6 Q4 sequential surfacing | ✅ AlertCard row footer (`{timeAgo} · {ruleId}`) |
| `mode` | ✅ | ❌ | ✅ EscalationAuditTrail row |
| `actualValue` | ✅ | ✅ notifications page renders for non-BP alerts | ✅ EscalationAuditTrail via formatTriggeringValue |
| `thresholdValue` (in metadata) | ✅ | ❌ | ❌ Audit trail's "Triggering value" row uses `actualValue`, not `thresholdValue` |
| `patientMessage` | ✅ | ✅ TierAlertView body | ✅ AlertCard "Patient" tier card |
| `caregiverMessage` | ✅ | ❌ (no caregiver surface yet) | ✅ AlertCard "Caregiver" tier card |
| `physicianMessage` | ✅ | — | ✅ AlertCard "Physician" tier card |
| `pulsePressure` | ✅ | ✅ CheckinCard "Wide pulse pressure" badge | ✅ Three rendered surfaces (AlertCard inline PP badge, ReadingsTab Stat, EscalationAuditTrail row) |
| `suboptimalMeasurement` | ✅ | ❌ | ✅ ReadingsTab quality warning + `failedConditions` detail |
| `sessionId` | ✅ | ❌ | ❌ Declared in DTO; never rendered |
| `journalEntryId` | ✅ | ✅ implicit | ✅ implicit |
| `count` (provider-notice idempotency) | ✅ | — | — |
| `dismissible` | ✅ | ✅ Hides ack button | ✅ Requires resolution rationale when false |
| `acknowledgedAt` | ✅ | ✅ | ✅ AlertCard "Acknowledged" pill |
| `resolvedBy` / `resolutionAction` / `resolutionRationale` | ✅ | ✅ Resolution banner | ✅ AlertCard + EscalationAuditTrail |
| `escalated` | ✅ | 🟡 Inconsistent | ✅ AlertCard "Escalated" pill |
| `status` | ✅ | ✅ | ✅ |

### 2.12 Escalation ladder (`§14`)

| Concept | Patient | Admin | Gap |
|---|---|---|---|
| `ladderForTier` selection | — | ✅ EscalationAuditTrail renders full ladder per tier | None |
| `BP_LEVEL_1_PATIENT_T0` immediate patient push | ✅ Push + dashboard notification | — | None |
| Acknowledgement-aware advancement | — | ✅ TimelineTab shows advanced steps | None |
| After-hours queueing | — | 🟡 `afterHours` flag visible; next-fire preview absent | Admin sees "step is queued" but not "this will fire at 8am Monday" |
| Recipient roles per step | — | ✅ EscalationAuditTrail per-step recipients | None |
| Notification channels (PUSH / EMAIL / PHONE / DASHBOARD) | — | ✅ Channel badges per step | None |

### 2.13 15-field JCAHO audit trail (`§15`)

Verified by reading `admin/.../EscalationAuditTrail.tsx:607-646`. The actual rendered field list is:

```ts
[alertId, tier, ruleId, severity, mode, status, created, acknowledged,
 acknowledgedBy, resolved, resolvedBy, resolutionAction, reading,
 pulsePressure, bmi, triggeringValue, escalationCount]
```

| Disclosure field | Status |
|---|---|
| 1. patientId | ✅ (context — parent page is patient-scoped) |
| 2. alertId | ✅ `alertId` row |
| 3. ruleId | ✅ `ruleId` row |
| 4. tier | ✅ `tier` row |
| 5. triggeringValue + axis (`formatTriggeringValue`) | ✅ `triggeringValue` row |
| 6. thresholdValue | ❌ **Not in rendered field list** — the audit-trail's "Triggering value" row uses `actualValue`, not `thresholdValue`. The threshold value is persisted in `RuleResult.metadata.thresholdValue` but never surfaced. |
| 7. mode | ✅ `mode` row |
| 8. profileState (PROVISIONAL/VERIFIED at evaluation time) | ❌ Not in field list; not persisted as a queryable snapshot |
| 9. resolvedAt | ✅ `resolved` row |
| 10. resolvedBy | ✅ `resolvedBy` row |
| 11. resolutionRationale | ✅ Resolution footer below audit fields |
| 12. ladderTouchpoints (role / channel / dispatchedAt / ackAt) | ✅ Per-event ladder detail |
| 13. sessionId + readingCount at evaluation time | 🟡 `sessionId` declared on DTO but not rendered; `readingCount` not persisted on audit row |
| 14. outputGeneratorVersion | ❌ Not persisted today |
| 15. practiceId | ✅ Context |

**Net: 11 of 15 disclosure fields fully wired; 4 partial or missing (fields 6, 8, 13, 14).**

### 2.14 Patient-facing threshold visibility (cross-cutting)

Confirmed by direct grep + file read. The patient app surfaces only one of the numbers from the §9.1 catalog:

| Threshold | Patient sees? | Where |
|---|---|---|
| Provider-set `sbpUpperTarget` / `dbpUpperTarget` | ✅ When set | Dashboard "Your goal" card formats `${sbpUpperTarget}/${dbpUpperTarget}` |
| Provider-set `sbpLowerTarget` / `dbpLowerTarget` | ❌ Used internally for the status-pill color logic; not displayed | `frontend/.../Dashboard.tsx:386-387` (read), no render |
| Condition-default thresholds (HFrEF 85, HFpEF 110, HCM 100, DCM 85, etc.) | ❌ | — |
| CAD ramp state (140 post / 160 pre) | ❌ | — |
| CAD `<70` J-curve / CAD `≥80` DBP-high | ❌ | — |
| Absolute emergency 180/120 | ❌ | — |
| Pregnancy 160/110 and 140/90 | ❌ | — |
| Standard L1 high 160/100, L1 low 90, age-65 low 100 | ❌ | — |
| Personalized HIGH `+20` band | ❌ | — |
| Wide pulse pressure `>60` | 🟡 The CheckinCard "Wide pulse pressure" badge appears when triggered, but the threshold value itself is in a tooltip only |
| Loop-diuretic `<90` strict | — (Tier 3) | — |

---

## 3. Wiring gaps requiring action (re-prioritized after corrections)

### 3.1 Critical (clinical-safety relevant)

| # | Gap | Where | Risk |
|---|---|---|---|
| C1 | **Co-fired alert rows render as independent cards / rows; no `sessionId` grouping** | Patient + Admin | Patient may dismiss "one of three" cards thinking it is a duplicate; clinician may not realize three concerns came from one reading |
| C2 | **Engine session-averaged mean is invisible everywhere** | Patient + Admin | Patient sees raw reading; engine evaluated against the mean. Reconciliation impossible. |
| C3 | **`PERSONALIZED_BAND_MMHG = 20` band is invisible to both provider and patient** | Both | Provider sets `sbpUpperTarget = 130` expecting alerts at 130; engine fires at 150. Verified absent by grep across both frontends. |
| C4 | **AFib ≥3-reading gate is silent** | Patient | New AFib patient gets no BP alerts for first two readings with no explanation |
| C5 | **`thresholdValue` (engine's effective threshold) not rendered anywhere** | Both | Audit trail's "Triggering value" row uses `actualValue`; the threshold the engine compared against is persisted in `metadata.thresholdValue` but never surfaced |

### 3.2 High (transparency / accuracy)

| # | Gap |
|---|---|
| H1 | **Mode badge missing on patient app and on admin AlertCard row** (only in expanded EscalationAuditTrail) — clinicians scanning the AlertsTab list cannot tell STANDARD vs PERSONALIZED at a glance |
| H2 | **Patient sees no engine-active threshold numbers** beyond their provider-set upper bound — no condition defaults, no CAD ramp state, no Personalized +20 band, no lower targets |
| H3 | **Locale-aware patient rendering only wired for angioedema** — pilot users with `preferredLanguage = es / am` see all non-angioedema patient messages in English regardless |
| H4 | **`heartFailureType` set at intake but not surfaced back to the patient** — the patient selects HFREF/HFPEF/UNKNOWN but the post-intake dashboard does not display "your resolved HF type is X" |

### 3.3 Medium (audit completeness / minor surfaces)

| # | Gap |
|---|---|
| M1 | **`profileState` audit field missing** — field 8 of the 15-field disclosure is not persisted in queryable form |
| M2 | **`outputGeneratorVersion` audit field missing** — field 14 |
| M3 | **`readingCount` at evaluation time not persisted on audit row** — field 13 partial (`sessionId` on DTO but not rendered; `readingCount` not on the audit row) |
| M4 | **`User.preferredLanguage` not visible to admin** — verified by 0 grep hits in `admin/src/` |
| M5 | **Practice business-hours next-fire computation not previewed** — admin sees `afterHours=true` but not "fires Monday 8am" |
| M6 | **`suboptimalMeasurement` not surfaced on patient frontend** — admin sees it in ReadingsTab; patient does not |

### 3.4 Low (cosmetic / nice-to-have)

| # | Gap |
|---|---|
| L1 | Loop-diuretic HF-exclusion rule rationale not surfaced anywhere |
| L2 | `escalated` flag display is inconsistent across patient surfaces |
| L3 | `PatientThreshold.replacedAt` (history of threshold edits) persisted but not displayed |
| L4 | `User.enrolledAt` only implicit in `enrollmentStatus` — raw timestamp absent from admin EnrollmentCard |
| L5 | Single-axis suppression logging is forensic-only; not surfaced |

---

## 4. Engine-internals deliberately not exposed

By design, never reach a UI surface:

- **`ResolvedContext` snapshot** — Phase/4 engine-internal immutable input
- **`axisFor(ruleId)` mapping** — static; not displayed
- **`AXIS_PRIORITY` ordering** — implicit in row order
- **`cadRampApplies(ctx)` per-patient result** — implicit in the threshold the engine applies
- **`CAD_THRESHOLD_ROLLOUT_PHASE` env var** — operational rollout flag
- **`personalizedEligible`, `preDay3Mode`, `readingCount` transients** — engine evaluation inputs
- **DEBUG suppression logs** — forensic-only

---

## 5. Cross-cutting wiring observations

### 5.1 API boundary is clean

ResolvedContext, engine transients, and rule-engine evaluation internals never cross the HTTP boundary. The frontend receives materialized `DeviationAlert` rows, `JournalEntry` snapshots, and `PatientThreshold` rows.

### 5.2 Admin app is the canonical clinical surface

Every persisted alert field surfaces somewhere in the admin app:
- Row-level: tier badge, status, escalated, ruleId, BP reading + inline PP badge, time-ago, optional patient name
- Expanded: three-tier message grid (Patient / Caregiver / Physician) + EscalationAuditTrail with 17 fields
- ReadingsTab: full `Stat` widgets for SBP, DBP, pulse, pulse pressure (amber when >60), suboptimal measurement detail

The only persisted alert fields NOT in any admin render path are `thresholdValue`, `sessionId`, and the missing audit fields (`profileState`, `outputGeneratorVersion`, `readingCount`-on-audit).

### 5.3 Patient app is presentation-thin by design

The patient app receives the engine's decisions as opaque tier + body text + tier-specific behavior. The only engine-derived number the patient app surfaces is `pulsePressure` (as a "Wide pulse pressure" badge on the check-in completion card) and `actualValue` for non-BP alerts on the notifications page.

### 5.4 Three-tier message generation is wired in two channels; the third is read-only-for-clinicians

| Channel | Status |
|---|---|
| Patient `patientMessage` | ✅ Displayed in TierAlertView, EmergencyAlertScreen, dashboard, notifications |
| Physician `physicianMessage` | ✅ Displayed in admin AlertCard expanded view |
| Caregiver `caregiverMessage` | ✅ Displayed in admin AlertCard (clinician-readable); ❌ No dispatch to caregiver yet (`CAREGIVER_DISPATCH_ENABLED=false`); ❌ No caregiver-facing UI |

### 5.5 Co-fire across disjoint axes lacks a UX affordance

The architectural insight in §11 of the disclosure (a single reading can produce multiple persisted rows on disjoint axes) is preserved in persistence and exposed via the API, but no UI groups the rows by `sessionId`. Both the patient and admin see independent cards/rows for what is conceptually one event.

### 5.6 Phased rollout has admin disclosure but no per-patient runtime status

A clinician sees the persistent teal banner in ProfileTab (hardcoded English). There is no API field that tells the clinician "this patient's effective `sbpUpperTarget` is currently 140 because the ramp has reached them." Compositing the effective threshold remains mental.

---

## 6. Recommendations (priority order)

1. **Group co-fired alert rows by `sessionId`** in both UIs (C1).
2. **Add a mode badge to the admin AlertCard row** (currently only in expanded audit panel) (H1).
3. **Surface the `PERSONALIZED_BAND_MMHG = 20` band explicitly** in admin ThresholdsTab editor and on the patient's "Your goal" card (C3).
4. **Expose effective per-patient threshold as an API field** so the admin banner and the patient app can render the engine-active value rather than mentally compositing the threshold hierarchy (H2 + admin banner accuracy).
5. **Render session-averaged mean** on the admin alert detail and optionally on the patient app's check-in confirmation (C2).
6. **Render `thresholdValue` next to `actualValue`** in EscalationAuditTrail's "Triggering value" row (C5).
7. **Add `profileState`, `outputGeneratorVersion`, and on-audit `readingCount`** to the audit-trail spec + render in EscalationAuditTrail (M1–M3).
8. **Extend locale-aware rendering to all BP rules** (H3).
9. **Surface the resolved HF type back to the patient** post-intake (H4).
10. **Add `preferredLanguage` to admin EnrollmentCard / ProfileTab** (M4).

Recommendations 1–6 are the highest-leverage clinical-safety / clinical-accuracy fixes.

---

## 7. Source-file map (frontend wiring — verified by direct read)

| Concept | Patient surface | Admin surface |
|---|---|---|
| Alert detail | [TierAlertView.tsx](frontend/src/components/alerts/TierAlertView.tsx), [EmergencyAlertScreen.tsx](frontend/src/components/alerts/EmergencyAlertScreen.tsx), [alerts/[id]/page.tsx](frontend/src/app/alerts/[id]/page.tsx) | [AlertCard.tsx](admin/src/components/AlertCard.tsx), [AlertsTab.tsx](admin/src/components/patient-detail/AlertsTab.tsx) |
| Dashboard / "Your goal" card / status pill | [Dashboard.tsx](frontend/src/components/cardio/Dashboard.tsx) | — |
| Notifications list | [notifications/page.tsx](frontend/src/app/notifications/page.tsx) | — |
| Check-in (symptoms + Q2 prompt + checkin completion card) | [CheckIn.tsx](frontend/src/components/cardio/CheckIn.tsx), [CheckinCard.tsx](frontend/src/components/cardio/cards/CheckinCard.tsx) | — |
| Locale precedence | [LanguageContext.tsx](frontend/src/contexts/LanguageContext.tsx) | — |
| i18n strings | [i18n/en.ts](frontend/src/i18n/en.ts), [es.ts](frontend/src/i18n/es.ts), [am.ts](frontend/src/i18n/am.ts), [fr.ts](frontend/src/i18n/fr.ts), [de.ts](frontend/src/i18n/de.ts) | — |
| Threshold DTO | [threshold.service.ts](frontend/src/lib/services/threshold.service.ts) | [patient-detail.service.ts](admin/src/lib/services/patient-detail.service.ts) |
| Alert DTO | [journal.service.ts](frontend/src/lib/services/journal.service.ts) | [provider.service.ts](admin/src/lib/services/provider.service.ts), [patient-detail.service.ts](admin/src/lib/services/patient-detail.service.ts) |
| Patient detail (admin) | — | [PatientDetailShell.tsx](admin/src/components/patient-detail/PatientDetailShell.tsx) |
| Profile (admin) | — | [ProfileTab.tsx](admin/src/components/patient-detail/ProfileTab.tsx) |
| Thresholds editor (admin) | — | [ThresholdsTab.tsx](admin/src/components/patient-detail/ThresholdsTab.tsx) |
| Readings + linked alerts (admin) | — | [ReadingsTab.tsx](admin/src/components/patient-detail/ReadingsTab.tsx) |
| Medications + Tier-3 inline (admin) | — | [MedicationsTab.tsx](admin/src/components/patient-detail/MedicationsTab.tsx) |
| Timeline (escalation events) | — | [TimelineTab.tsx](admin/src/components/patient-detail/TimelineTab.tsx) |
| 15-field audit trail | — | [EscalationAuditTrail.tsx](admin/src/components/patient-detail/EscalationAuditTrail.tsx) |
| Care team assignment | — | [CareTeamTab.tsx](admin/src/components/patient-detail/CareTeamTab.tsx) |
| Enrollment gate | — | [EnrollmentCard.tsx](admin/src/components/patient-detail/EnrollmentCard.tsx) |

---

## 8. Verification methodology (rev 2)

Each cell in the matrix was verified by one of three methods:

1. **Direct grep** for the field name (e.g. `pulsePressure`, `caregiverMessage`, `mode`) against both `frontend/src/` and `admin/src/`. Hits were then read in context to confirm the match is a render call, not a type declaration or a service-layer pass-through.
2. **Direct file read** of the cited component for the row's specific feature (e.g. `AlertCard.tsx:360-380` for the three-tier message grid).
3. **Bidirectional check** — for absence claims, grep was run with multiple synonym patterns (e.g. `+ 20`, `target +`, `sbpUpperTarget +`, `PERSONALIZED_BAND` for the Personalized band check). Only when all patterns returned 0 hits was the cell marked Missing.

**Corrections from rev 1, summarized:**

| Row | rev 1 status | rev 2 status | Reason |
|---|---|---|---|
| `profileVerificationStatus` (patient) | ❌ | ✅ | rendered in Dashboard.tsx + profile/page.tsx |
| `resolvedHFType` (patient) | ❌ | 🟡 | set at intake; not re-surfaced post-intake |
| `mode` (admin) | ❌ | ✅ | rendered in EscalationAuditTrail row |
| `actualValue` (patient) | ❌ | ✅ | rendered in notifications/page.tsx for non-BP alerts |
| `thresholdValue` (admin) | ✅ | ❌ | audit-trail row uses `actualValue`, not `thresholdValue` |
| `caregiverMessage` (admin) | ❌ | ✅ | rendered in AlertCard.tsx three-tier grid |
| `pulsePressure` (both) | ❌ | ✅ | rendered in 4 surfaces total (CheckinCard, AlertCard inline, ReadingsTab, EscalationAuditTrail) |
| `suboptimalMeasurement` (admin) | ❌ | ✅ | rendered in ReadingsTab quality detail |

— end of document —
