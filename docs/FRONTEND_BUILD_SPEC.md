# Frontend Build Spec — Cardioplace v2

## New pages / designs to build — v2 spec vs current state

Analyzed: `CLINICAL_SPEC.md` (Dr. Singal v1 + v2 addendum) vs what exists in `/frontend` and `/admin` today.

### Current state snapshot

| App | Existing pages |
|---|---|
| `/frontend` (patient) | about, auth, chat, check-in, dashboard, home, notifications, onboarding, profile, readings, sign-in, welcome |
| `/admin` (provider) | about, dashboard (v1-ported), home, patients (v1-ported), scheduled-calls (v1-ported), sign-in |

---

## Patient app — `/frontend`

### New — design from scratch

| Page / flow | Where | What it does | Spec source | Phase |
|---|---|---|---|---|
| Multi-step onboarding intake | replaces `/onboarding` | 5-step: demographics → pregnancy → conditions → medications (card-based) → confirmation | V2-A + V2-B + V2-E (silent literacy) | 14 |
| Medication card picker | inside onboarding | 20 meds × 4 classes + 5 combos, visual cards with pill image + audio button | V2-B Screen 1 | 14 |
| "Not listed" category screen | inside onboarding | icons for water pill / blood thinner / cholesterol / rhythm / SGLT2 / other + voice + photo capture | V2-B Screen 2 | 14 |
| Combo-pill dedup modal | inside onboarding | when patient picks both Lisinopril AND Lisinopril+HCTZ | V2-B Screen 3 | 14 |
| Frequency-only dose capture | inside onboarding | once/twice/three/unsure — no mg entry | V2-B Screen 4 | 14 |
| "Awaiting Provider Verification" badge | on `/dashboard`, on reading cards | surfaces `profileVerificationStatus=UNVERIFIED` visually | V2-A Step 3 | 15 |
| Pre-measurement checklist | inside `/check-in` | 8 boolean items before reading entry | CLINICAL_SPEC Part 6 | 15 |
| Structured symptom buttons | inside `/check-in` | 6 Level-2 symptoms + 3 pregnancy-specific, with `otherSymptoms` freeform below | V2-D §2.3 + §Pregnancy | 15 |
| Session grouping UI | inside `/check-in` | "Add another reading in this session" — groups 2–3 readings for averaging (AFib needs ≥3) | CLINICAL_SPEC Part 5 | 15 |
| BP Level 2 emergency alert screen | new `/alerts/:id` | red-screen with 911 CTA, symptom-assessment prompt, "Have you called 911?" follow-up state | V2-D BP Level 2 | 11 / 15 |
| Tier 1 contraindication alert screen | `/alerts/:id` | prominent non-dismissable notice, medication context, provider-contact guidance | V2-D Tier 1 | 11 / 15 |
| Personal threshold display card | on `/dashboard` | read-only: "Your goal: below X/Y, set by Dr. [name] on [date]" | BUILD_PLAN §2.3 | 15 |
| Monthly med re-check prompt | full-screen modal, cron-triggered | "Are you still taking the same medicines?" Yes / No → re-opens card flow | V2-B Unscheduled triggers | 17 |

### Redesign — exists but spec-misaligned

| Existing page | What needs to change |
|---|---|
| `/check-in` | `entryDate` + `measurementTime` → single `measuredAt` datetime picker. Add pulse, position, checklist, structured symptoms. Remove old symptoms `String[]` UI. |
| `/dashboard` | Add verification badge + threshold card. Replace v1 alert rendering with three-tier `patientMessage` pulled from `DeviationAlert`. Add emergency-mode rendering for BP Level 2. |
| `/readings` | Sort by `measuredAt` (not `createdAt`). Display pulse + pulse pressure. Group readings visually by session. |
| `/notifications` | Group by alert tier (emergency first). Link to new `/alerts/:id` detail screens. |
| `/profile` | Show assigned provider + all clinical-intake data from `PatientProfile` (demographics, pregnancy status, conditions, HF subtype, medications) with verification badges per section. Add per-section **Edit** buttons that re-open the matching Flow A step (A1 demographics, A2 pregnancy, A3 conditions, A4 HF subtype, A5/A6/A8/A9 medications). Any edit flips `profileVerificationStatus` back to UNVERIFIED and re-triggers provider verification. |

### Stays mostly as-is

`/chat` (UI unchanged; backend system-prompt rewrite is phase/16). `/home`, `/about`, `/welcome`, `/sign-in`, `/auth/*`.

---

## Admin app — `/admin`

### New — design from scratch

| Page / flow | Where | What it does | Spec source | Phase |
|---|---|---|---|---|
| 3-Layer alert dashboard | replaces `/dashboard` | Layer 1 top panel: 🔴 Tier 1 red banner (non-dismissable) + 🟡 Tier 2 yellow badges + 🟢 Tier 3 passive info | V2-C Layer 1 | 11 |
| Alert resolution modal — Tier 1 | modal on alert row | 5 enum actions + rationale (required) | V2-C + V2-D | 11 |
| Alert resolution modal — Tier 2 | modal | 5 enum actions + optional rationale | V2-C + V2-D | 11 |
| Alert resolution modal — BP Level 2 | modal | 6 enum actions + trend doc required for #5 + retry trigger for #6 | V2-D BP Level 2 | 11 |
| Animated Tier 1 banner @ T+8h | admin layout | blinking/pulse effect when escalation reaches medical director level | V2-D Tier 1 ladder | 11 |
| Escalation audit trail view | tab on patient detail | chronological 15-field timeline per alert: T+0 → T+4h → T+8h → ack/resolve | V2-D §audit 15 fields | 11 |
| Profile verification panel | tab on patient detail | patient-reported column vs admin-editable column; per-field Confirm/Correct/Reject buttons | V2-A Step 2 | 9 |
| Medication reconciliation view | tab on patient detail | side-by-side patient-reported vs provider-verified; status column (✅ matched / ⚠️ discrepancy / 🔵 unverified); resolution actions per discrepancy type | V2-C Layer 2 | 12 |
| Medication timeline view | tab on patient detail | chronological log: patient update / provider verify / BP-triggered inquiry / monthly check-in | V2-C Layer 3 | 12 |
| PatientThreshold editor | tab on patient detail | 6 targets (sbp/dbp/hr × upper/lower) + notes; condition-defaulted pre-fills; "Mandatory configuration required" red banner for HFrEF/HCM/DCM with no threshold | §2.3 + CLINICAL_SPEC §4.2 / §4.7 / §4.8 | 10 |
| Threshold version history | inside threshold editor | shows replaced rows (`replacedAt`) | BUILD_PLAN §2.3 | 10 |
| Practice config screen | new `/practices` + `/practices/:id` | create/edit practice: name, business hours, timezone, after-hours protocol | V2-D §D.9 + §2.5 | 13-assist |
| Provider assignment panel | inside patient detail | assign primary / backup / medical director from practice staff | V2-D §D.9 | 13-assist |
| "Complete onboarding" CTA | patient detail | calls `/admin/patients/:id/complete-onboarding`; shows 409 gate reasons if not ready | BUILD_PLAN §2.5 + enrollment gate | 13-assist |
| "Awaiting Verification" filter | patient list | quick-filter on verification status | V2-A Step 3 | 9 |
| Practice directory | new `/practices` (list) | all practices + staff count + patient count | V2-D §D.9 | 13-assist |

### Redesign — exists (from v1 port) but v1 mental model

| Existing page | What needs to change |
|---|---|
| `/dashboard` (ported `ProviderDashboard.tsx`) | Alert rendering uses v1 L1/L2 flag. Rewrite to use `DeviationAlert.tier` + three-tier messages. Keep stat cards + Recharts BP trend. Keep responsive side-panel / bottom-sheet architecture from `AlertPanel.tsx`. |
| `/patients` (ported) | Keep table + search + filter shell. Add verification status column. Replace modal internals with tabbed patient-detail view (Profile / Medications / Alerts / Thresholds / Timeline). |
| `/scheduled-calls` (ported) | Port-as-is. Minor: business-hours filter on date picker from practice config. |

### Stays mostly as-is

`/home`, `/about`, `/sign-in`.

---

## Post-MVP (design only, activate later)

| Design-only for MVP | Why |
|---|---|
| Exportable reconciled medication list (Priority 3 #26) | Design template; implement when full reconciliation workflow lands |
| Monthly escalation analytics report (Priority 3 #27) | Design data model + mock dashboard; automation deferred |
| Medication catalog admin UI | Post-MVP — catalog hardcoded in `/shared/medications.ts` |
| Patient 911 acknowledgment tracking (#37) | Post-MVP |
| Multi-site health-system config (#36) | Post-MVP |

---

## Counts

- Patient app new flows/screens: **13 new + 5 redesigns**
- Admin app new flows/screens: **15 new + 3 redesigns**
- Total net-new designs: **~28**
- Critical path (ship before first cohort): **~22** (MVP Priority 1 + 2 from CLINICAL_SPEC V2-F)

---

## Priority order for design work (matches Dev 1 phase sequence)

1. **Phase/14** — patient intake cards + condition flow + pregnancy flow
2. **Phase/15** — patient check-in v2 + alert screens + threshold display
3. **Phase/8** — admin shell + patient list redesign + verification filter
4. **Phase/9** — profile verification panel
5. **Phase/10** — threshold editor + version history
6. **Phase/11** — 3-layer alert dashboard + resolution modals + emergency banners
7. **Phase/12** — reconciliation view + timeline (data model + UI shell)
8. **Phase/13-assist** — practice config + provider assignment + complete-onboarding CTA

Figma or hand-off doc needed before Dev 1 starts phase/8 (week 3 per BUILD_PLAN §9). The intake flows (phase/14) also deserve design polish given the silent-literacy requirements — pure-code scaffolding won't cut it.

---

# Figma Make prompt — v2 redesign

Prompt designed for Figma Make. Structured so it can generate in sections and preserve existing components.

```
I'm modifying our existing Cardioplace Figma Make file for a v2 redesign. We're pivoting from an ML-hybrid BP monitoring prototype to a pure rule-based clinical alert system. Preserve current color tokens, typography, and component library — ADD new screens using existing atoms where they fit. Don't rebuild the design system.

═══════════════════════════════════════════════════════════
CONTEXT
═══════════════════════════════════════════════════════════

Product: Cardioplace v2 — cardiovascular remote monitoring for the Elevance Health Foundation Patient Safety Prize cohort (Cedar Hill / BridgePoint / AmeriHealth, Ward 7 & 8 DC).

Two apps sharing one backend:
• app.cardioplaceai.com → patient app (mobile-first, touch, icon+audio)
• admin.cardioplaceai.com → provider app (desktop-first, data-dense, keyboard-friendly)

Key architectural shifts from v1:
1. Patient-self-reports clinical data; provider verifies within 48–72h ("trust then verify")
2. Every alert produces three messages: patient-facing, caregiver-facing, physician-facing
3. Alerts are tiered — not L1/L2 anymore, but: TIER_1 contraindication, TIER_2 discrepancy, TIER_3 info, BP_LEVEL_1_HIGH, BP_LEVEL_1_LOW, BP_LEVEL_2 emergency
4. Five-step escalation ladder per alert (T+0, T+4h, T+8h, T+24h, T+48h)
5. "Silent literacy" design principle — all patient UI must work identically for readers and non-readers; icon + audio alongside text, pill images with no typed drug names required

═══════════════════════════════════════════════════════════
DESIGN SYSTEM ADDITIONS
═══════════════════════════════════════════════════════════

Alert tier color tokens (traffic-light schema per clinical spec):
• TIER 1 / BP LEVEL 2 emergency: red #DC2626 (non-dismissable banner + red border)
• TIER 2 discrepancy: yellow #F59E0B (numbered badge + yellow banner when escalated)
• TIER 3 info: green #10B981 (passive, detail-view only)
• BP LEVEL 1 HIGH: orange #EA580C
• BP LEVEL 1 LOW: blue #3B82F6

Silent-literacy atoms (add if missing):
• MedicationCard — pill image (round/oval/capsule) + pill color + brand name (large) + plain-language purpose + audio-playback button + "I take this ✅ / I don't ❌" toggle
• ConditionCard — icon (heart, lightning bolt, etc.) + plain text label + audio button
• AudioButton — used on every patient-facing text block
• VerificationBadge — "Awaiting Provider Verification" pill, muted amber

═══════════════════════════════════════════════════════════
PATIENT APP (/frontend) — NEW SCREENS
═══════════════════════════════════════════════════════════

Flow A — Clinical Intake (multi-step, SEPARATE from existing /onboarding)

IMPORTANT: The existing /onboarding screen stays as-is — it remains basic account setup only (name, dateOfBirth, communicationPreference, preferredLanguage). Clinical Intake is a NEW flow that launches AFTER basic onboarding, triggered by an "Action Required" card on the dashboard.

Patient journey:
  1. Sign up → existing /onboarding (unchanged) → dashboard
  2. Dashboard shows an "Action Required" card prompting clinical intake
  3. Tap card → launches Clinical Intake flow (A0 → A1 → … → A11)
  4. Submit → dashboard shows "Awaiting Provider Verification" badge (Flow D1)
  5. Admin verifies → badge is removed; conditions show as "Confirmed by [provider name]"

A0. Action Required card (lives on /dashboard, above all other content)
    Large tappable card. Amber/warm accent (not alarming red — this is a task, not a crisis). Icon: clipboard + heart. Headline: "Complete your health profile." Sub: "Your care team needs this to keep you safe. Takes about 5 minutes." CTA button: "Start" → opens A0b.
    Show this card only when:
      • User has completed basic onboarding (onboardingStatus = COMPLETED)
      • Clinical intake is not done (no PatientProfile data yet)
    "Pick up where you left off" variant — if patient dropped off mid-flow, card becomes: headline "Continue your health profile" + sub "Step 3 of 8 · Conditions" + "Resume" CTA + progress bar beneath headline.

A0b. Clinical Intake entry screen
    Full-screen intro: large heart illustration, headline "Let's build your health profile," sub "This helps your care team give you the right support. Your answers stay private." Audio playback of intro text. Two buttons: "Begin" (primary) and "Save for later" (text-only, returns to dashboard).

A1. Demographics — gender (MALE/FEMALE/OTHER big buttons), heightCm (cm slider or number input), preferred language
A2. Pregnancy flow — "Are you pregnant?" Yes / No / Not applicable (only shown if female). If Yes → due date picker (optional).
A3. Cardiac conditions — 6 condition cards with icons (Heart Failure, Atrial Fibrillation, Coronary Artery Disease, Hypertrophic Cardiomyopathy, Dilated Cardiomyopathy, None of these). Multi-select checkboxes.
A4. Heart failure type picker — only shown if Heart Failure selected. HFrEF / HFpEF / Not sure — three cards.
A5. Medication selection Screen 1 — four drug-class sections, each showing cards for the meds in that class. Visual design:
    • ACE Inhibitors: Lisinopril, Enalapril, Ramipril, Benazepril
    • ARBs: Losartan, Valsartan, Irbesartan, Olmesartan
    • Beta-Blockers: Metoprolol (Toprol/Lopressor), Carvedilol (Coreg), Atenolol, Bisoprolol
    • Calcium Channel Blockers: Amlodipine (Norvasc), Diltiazem (Cardizem), Nifedipine (Procardia), Verapamil (Calan)
    Each card = pill image + brand name + "Lowers blood pressure" text + audio button + I take this / I don't toggle.
    CRITICAL: Diltiazem and Verapamil cards have a subtle color-coded border to distinguish them from Amlodipine/Nifedipine. Patients don't see this distinction in labels but the visual variation matters for provider-side coding.
A6. Combination pills — separate cards with "2-in-1" badge:
    • Lisinopril + HCTZ (Zestoretic)
    • Losartan + HCTZ (Hyzaar)
    • Amlodipine + Benazepril (Lotrel)
    • Sacubitril + Valsartan (Entresto) — label "Heart failure medicine"
    • Amlodipine + Atorvastatin (Caduet)
A7. Combo dedup modal — if patient picked both "Lisinopril" AND "Lisinopril + HCTZ" → modal showing both pill images side by side: "Are these the same pill? Or do you take both?"
A8. "I take something not listed here" — category screen with 6 icons: Water pill, Blood thinner, Cholesterol medicine, Heart rhythm medicine, Diabetes medicine that also helps the heart, Other medicine not listed. Tapping "Other" opens voice-input mic + photo-capture camera.
A9. Frequency capture — per selected medication: "How many times a day do you take this?" Once / Twice / Three times / Not sure. Four big buttons.
A10. Review + submit — summary of intake with "everything will be reviewed by your care team within 48–72 hours" reassurance banner.
A11. Clinical Intake completion screen — full-screen success: checkmark animation, headline "Thank you — we got it." Sub "Your care team will review your profile within 48–72 hours. You can use the app normally in the meantime — we'll let you know when review is complete." Single "Go to dashboard" button.

Exit-save confirmation (can be triggered at any step): "We saved your progress. You can continue anytime from your dashboard." Single "Back to dashboard" button.

Flow B — Daily Check-in (extends existing /check-in)

B1. Pre-measurement checklist — 8 boolean checks with icons:
    • No caffeine in the last 30 minutes
    • No smoking in the last 30 minutes
    • No exercise in the last 30 minutes
    • Bladder has been emptied
    • Seated quietly for at least 5 minutes
    • Back supported, feet flat, arm supported at heart level
    • Not talking during measurement
    • Cuff placed on bare upper arm (not over clothing)
B2. BP entry — existing systolic/diastolic fields + NEW:
    • pulse (bpm)
    • position selector (Sitting / Standing / Lying — three big icons)
    • datetime picker for measurement time (default = now)
B3. Symptom check — structured symptom buttons as icons:
    • Severe headache
    • Vision changes
    • Altered mental state / confusion
    • Chest pain or difficulty breathing
    • Weakness / numbness / speech difficulty
    • Severe stomach or upper right pain
    Pregnancy-specific (only shown if isPregnant): new headache, right-upper-quadrant pain, swelling/edema.
    Optional: "Anything else?" text field.
B4. Session grouping — after submitting a reading: "Add another reading in this session?" button. Shows small card with reading #1 summary at top. AFib patients see badge: "Your care team requires 3 readings per session."
B5. Reading confirmation — shows what was submitted + "What happens next" micro-education.

Flow C — Alert Screens (NEW)

C1. BP Level 2 emergency screen — full-screen red background, white text:
    "Your blood pressure is very high.
    If you have chest pain, severe headache, difficulty breathing, or vision changes, CALL 911 NOW."
    Giant red 911 call button. Below: "Your care team has been notified."
    Audio auto-plays message. Dismissable only by explicit "I understand" tap.
C2. BP Level 2 T+2h follow-up — appears 2 hours later if no provider ack and emergency symptoms reported. Says: "Have you called 911?" Yes / Not yet. If "Not yet" → repeats emergency message.
C3. Tier 1 contraindication alert — red banner, title "Important medication alert." Body: three-tier patientMessage (specific to rule). Below: "Your care team has been notified and will contact you within the day. Please don't stop any medicine without talking to your doctor."
C4. BP Level 1 High alert — orange banner, title "Your blood pressure is elevated." Guidance text + "Your care team will review within 24 hours."
C5. BP Level 1 Low alert — blue banner, "Your blood pressure is low." Dizziness safety prompt.

Flow D — Dashboard updates (modify existing /dashboard)

D0. Action Required card at top (see Flow A0) — shown when clinical intake is incomplete.
D1. "Awaiting Provider Verification" badge below user greeting when profileVerificationStatus = UNVERIFIED (shown only AFTER clinical intake is submitted).
D2. Personal threshold card — "Your goal: below X/Y · set by Dr. [name] · [date]" — shown when PatientThreshold exists.
D3. Active alert card — if any unresolved alerts, show tier-colored card at top with patient message + "View details" CTA.
D4. Latest reading summary — most recent measuredAt + sys/dia/pulse + color-coded vs target.
    Note: when both D0 and D1 conditions are false (intake done + verified), neither is shown — dashboard looks clean.

Flow E — Other patient updates

E1. /notifications — redesign: group by tier (emergency first), link to alert detail screens.
E2. /readings — sort by measuredAt, show pulse + pulse pressure, group readings by session with collapsible cards.
E3. /profile — patient can view AND edit their entire clinical-intake record. Sections shown:
    • Assigned Care Team — primary / backup / medical director names (read-only)
    • My Demographics — gender, heightCm, preferred language, with [Edit] → re-opens A1
    • Pregnancy status (only if female) — "Pregnant: Yes/No" + due date if applicable, with [Edit] → re-opens A2
    • My Conditions — structured condition list + HF subtype if applicable, each showing "confirmed by Dr. [name]" or "awaiting verification" badge, with [Edit] → re-opens A3 (and A4 if HF is selected)
    • My Medications — full list with verification badges per med, with [Edit] → re-opens A5 flow (which flows through A6 combos, A8 not-listed, A9 frequency as needed)
    Editing any section flips profileVerificationStatus back to UNVERIFIED, shows the "Awaiting Provider Verification" badge on /dashboard again, and surfaces the change in the admin H1 Profile tab as a new diff to verify.
    Edit confirmation screen — before submitting edits, show a "These changes will be re-reviewed by your care team within 48–72 hours" reassurance banner matching the A10 pattern.
E4. Monthly medication re-check — full-screen modal, cron-triggered: "Are you still taking the same medicines?" Yes / No. If No → re-opens Flow A5.

═══════════════════════════════════════════════════════════
ADMIN APP (/admin) — NEW SCREENS
═══════════════════════════════════════════════════════════

Visual language differs from patient app: dense tables, keyboard shortcuts, sidebar nav, traffic-light alert schema everywhere.

Flow F — 3-Layer Dashboard (replaces existing /dashboard)

F1. Layer 1 — Medication Alerts Panel (top, always visible):
    • Red banner block for each open Tier 1 contraindication — non-dismissable, shows patient name + medication + condition + "Immediate review required" + [Resolve] button. Multiple banners stack vertically.
    • Yellow badge row — numbered badges for each Tier 2 category ("Discrepancies ⚠️3", "Unreported meds ⚠️1"), click to expand.
    • Green info notes — visible only in patient detail view, not on dashboard.
    • BP Level 2 emergency — pulsing red banner at top, even more prominent than Tier 1.
F2. Layer 2 — Alert queue (middle): tier-filterable list of open alerts with patient + tier + time-since-created + ack state. Each row opens side panel.
F3. Layer 3 — Stat cards (bottom): open alerts by tier, avg time-to-ack, patients with unverified profiles, etc. (Keep Recharts BP trend chart from existing ported ProviderDashboard.)

Flow G — Resolution Modals

G1. Tier 1 resolution — non-dismissable modal. Dropdown with 5 enum actions:
    • Confirmed — medication discontinued / will contact patient
    • Confirmed — medication change ordered
    • False positive — patient is not [condition] / medication incorrect (requires rationale)
    • Acknowledged — provider aware, clinical rationale documented (requires rationale)
    • Deferred to in-person visit — appointment within 24h / 48h / 1 week
    Rationale textarea required. Cannot close modal without action + rationale.
G2. Tier 2 resolution — 5 enum actions (Reviewed — no action needed requires rationale; Will contact patient; Medication change ordered; Referred to pharmacy; Deferred to next visit). Rationale optional except where noted.
G3. BP Level 2 resolution — 6 enum actions (Patient contacted — med adjusted; advised to go to ED; BP re-check requested; Patient seen in office; Reviewed — BP trending down requires trend documentation; Unable to reach — will retry triggers T+4h follow-up).

Flow H — Patient Detail (full redesign; replaces current modal)

Tabbed layout, side panel or full page:

H1. Profile tab — two columns:
    • Left: Patient-reported (pregnancy, conditions, etc.)
    • Right: Admin-editable column with same fields, default pre-filled from patient side
    • Each field has inline buttons: ✅ Confirm / ✏️ Correct / ❌ Reject. Footer: "Verification complete" button flips profileVerificationStatus.
H2. Medications tab — side-by-side reconciliation:
    • Left column: patient-reported medications (card layout with brand + frequency + "I take this")
    • Right column: provider-verified / prescribed (same layout)
    • Status column in middle: ✅ Matched / ⚠️ Discrepancy / 🔵 Unverified
    • "Action required" next-step button per row.
H3. Alerts tab — filtered alert list for this patient (tier filter + status filter). Each row expands to show three-tier messages (patient / caregiver / physician) + escalation ladder progress.
H4. Thresholds tab — PatientThreshold editor:
    • 6 numeric inputs: SBP upper target, SBP lower target, DBP upper target, DBP lower target, HR upper (optional), HR lower (optional)
    • Condition-defaulted pre-fills: if patient has CAD, DBP lower target pre-fills to 70. HFrEF → SBP lower 85. HCM → SBP lower 100.
    • "Mandatory configuration required" red banner if patient is HFrEF / HCM / DCM and no threshold row exists yet.
    • Notes textarea for clinical rationale.
    • Version history below form: "Previous target set [date] by [provider]" collapsible entries.
H5. Timeline tab — chronological audit log: medication changes, profile corrections, alerts + escalations + resolutions. Each entry timestamped with actor + event.

Flow I — Escalation Audit Trail View (inside H3 Alerts tab)

I1. Per-alert vertical timeline: T+0 → T+4h → T+8h → T+24h → T+48h
    • Each step shows recipients notified, channels (push / email / phone / dashboard), acknowledgment timestamp
    • Green checkmarks for completed acknowledgments, red for still-pending
    • At bottom: resolution action + rationale (15-field audit view)

Flow J — Practice Configuration

J1. /practices index — list of practices (Cedar Hill, BridgePoint, AmeriHealth) with staff count + patient count. Add practice button.
J2. /practices/:id detail — practice name, business hours (start/end time pickers), timezone picker (IANA), after-hours protocol textarea, staff list.
J3. Provider assignment panel (reusable, shown inside patient detail) — dropdowns for Primary provider, Backup provider, Medical director, all populated from practice staff.

Flow K — Patient List (modify existing /patients)

K1. Add verification status column + quick filter ("Awaiting Verification" chip).
K2. Add open-alert count column with tier color coding.
K3. "Complete onboarding" CTA per row — disabled if enrollment gate fails, with tooltip showing 409 reasons.

═══════════════════════════════════════════════════════════
PRESERVE FROM V1 (no changes)
═══════════════════════════════════════════════════════════

Patient app: /chat, /home, /about, /welcome, /sign-in, /auth/*
Admin app: /home, /about, /sign-in, /scheduled-calls
BP trend chart component (Recharts-based, reuse in admin dashboards)
Top-level layout grids and responsive breakpoints

═══════════════════════════════════════════════════════════
OUTPUT REQUEST
═══════════════════════════════════════════════════════════

Generate all Flow A through Flow K screens as new frames in the existing file, organized into page sections "Patient v2" and "Admin v2". Reuse existing color tokens + typography + base atoms. Where a new atom is needed (MedicationCard, AudioButton, VerificationBadge, TierBanner, ResolutionModal), add to the component library.

Priority order for generation (matches our dev phase sequence):
1. Flow A (patient intake) — Dev 1 phase/14
2. Flow B + C + D (patient check-in + alerts + dashboard) — Dev 1 phase/15
3. Flow F (admin 3-layer dashboard) — Dev 1 phase/11
4. Flow H (patient detail tabs) — Dev 1 phase/9 / 10 / 12
5. Flow J (practice config) — Dev 1 phase/13-assist
6. Flow G + I (modals + audit) — Dev 1 phase/11
7. Flow K (patient list updates)
8. Flow E (patient profile / notifications / readings updates)

Do Flow A first. Pause when done and show me before proceeding.
```

### Two tips before you paste

1. **Pause after Flow A** — Figma Make can get ambitious. The instruction at the end to stop after Flow A gives you a checkpoint before it regenerates 40 screens.
2. **Keep the original file open in another tab** — if Figma Make's additions clash with your existing design system tokens, you want visual reference to compare.

---

### Architectural note for Dev 1 implementation

The backend doesn't need changes — the data model already supports this pattern:

- `User.onboardingStatus = COMPLETED` once basic onboarding is done
- `PatientProfile` row creation = signal that clinical intake is done
- `PatientProfile.profileVerificationStatus = UNVERIFIED` → show "Awaiting Verification" badge
- `PatientProfile.profileVerificationStatus = VERIFIED` → clean dashboard

Dev 1 phase/14 (patient intake UI) wires the Action Required card to trigger Flow A's Clinical Intake steps. Phase/15 adds the dashboard badge states. No phase/3 or phase/13 changes needed on the backend — the existing schema and endpoints handle it.
