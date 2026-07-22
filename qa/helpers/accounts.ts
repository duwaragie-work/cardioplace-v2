/**
 * Seed accounts (backend/prisma/seed.ts). All share the perma-OTP `666666`.
 *
 * The five patients are calibrated archetypes — each triggers exactly one
 * branch of the rule engine when their seeded readings replay. Don't write
 * tests that mutate these patients' state across specs without resetting:
 * use a fresh ad-hoc patient via `signUpAdHocPatient` instead.
 */
export const DEMO_OTP = process.env.DEMO_OTP ?? '666666'

export const PATIENTS = {
  priya: {
    email: process.env.PATIENT_PRIYA_EMAIL ?? 'priya.menon@cardioplace.test',
    name: 'Priya Menon',
    archetype: 'Pregnant + ACE inhibitor → Tier 1 contraindication',
    expectedRuleId: 'RULE_PREGNANCY_ACE_ARB',
  },
  james: {
    email: process.env.PATIENT_JAMES_EMAIL ?? 'james.okafor@cardioplace.test',
    name: 'James Okafor',
    archetype: 'HFrEF + NDHP-CCB → Tier 1 contraindication',
    expectedRuleId: 'RULE_NDHP_HFREF',
  },
  rita: {
    email: process.env.PATIENT_RITA_EMAIL ?? 'rita.washington@cardioplace.test',
    name: 'Rita Washington',
    archetype: 'CAD + DBP <70 → CAD critical',
    expectedRuleId: 'RULE_CAD_DBP_CRITICAL',
  },
  charles: {
    email: process.env.PATIENT_CHARLES_EMAIL ?? 'charles.brown@cardioplace.test',
    name: 'Charles Brown',
    archetype: 'AFib + HR >110 → AFib HR alert',
    expectedRuleId: 'RULE_AFIB_HR_HIGH',
  },
  aisha: {
    email: process.env.PATIENT_AISHA_EMAIL ?? 'aisha.johnson@cardioplace.test',
    name: 'Aisha Johnson',
    archetype: 'Control — well-controlled HTN, no alerts',
    expectedRuleId: null,
  },

  // ─── Bucket B personas (8 of 11) ─────────────────────────────────────────
  carol: {
    email: process.env.PATIENT_CAROL_EMAIL ?? 'carol.miller@cardioplace.test',
    name: 'Carol Miller',
    archetype: 'HFrEF + loop diuretic — clean (no NDHP)',
    expectedRuleId: null,
  },
  mike: {
    email: process.env.PATIENT_MIKE_EMAIL ?? 'mike.peterson@cardioplace.test',
    name: 'Mike Peterson',
    archetype: 'HFpEF — preserved EF, ARB regimen',
    expectedRuleId: null,
  },
  olive: {
    email: process.env.PATIENT_OLIVE_EMAIL ?? 'olive.thompson@cardioplace.test',
    name: 'Olive Thompson',
    archetype: 'Loop diuretic + age 70 — no HF',
    expectedRuleId: null,
  },
  paul: {
    email: process.env.PATIENT_PAUL_EMAIL ?? 'paul.davis@cardioplace.test',
    name: 'Paul Davis',
    archetype: 'CAD + age 65+',
    expectedRuleId: null,
  },
  kate: {
    email: process.env.PATIENT_KATE_EMAIL ?? 'kate.wong@cardioplace.test',
    name: 'Kate Wong',
    archetype: 'HCM + DHP-CCB — vasodilator concern',
    expectedRuleId: null,
  },
  nora: {
    email: process.env.PATIENT_NORA_EMAIL ?? 'nora.adams@cardioplace.test',
    name: 'Nora Adams',
    archetype: 'Bradycardia + BB — HR rule suppression',
    expectedRuleId: null,
  },
  iris: {
    email: process.env.PATIENT_IRIS_EMAIL ?? 'iris.kim@cardioplace.test',
    name: 'Iris Kim',
    archetype: 'AFib + anticoag + BB — single-reading HR exception target',
    expectedRuleId: null,
  },
  jane: {
    email: process.env.PATIENT_JANE_EMAIL ?? 'jane.smith@cardioplace.test',
    name: 'Jane Smith',
    archetype: '65+ control — no comorbidities, age threshold edges',
    expectedRuleId: null,
  },

  // ─── Phase 4 §B.1 — young-adult persona (18–29 bucket) ───────────────────
  taylor: {
    email: process.env.PATIENT_TAYLOR_EMAIL ?? 'taylor.brown@cardioplace.test',
    name: 'Taylor Brown',
    archetype: 'Young adult (18–29 bucket) — general adult HTN',
    expectedRuleId: null,
  },

  // ─── Onboarding E2E fixture (spec 03, A1–A5) ─────────────────────────────
  // Seeded UN-onboarded (NOT_COMPLETED, no name/comm/reminder/consent, no
  // PatientProfile). The only persona that walks the onboarding flow from
  // cold; reset back to this state via test-control `resetOnboarding`.
  e2eOnboarding: {
    email:
      process.env.PATIENT_E2E_ONBOARDING_EMAIL ?? 'e2e-onboarding@cardioplace.test',
    name: null,
    archetype: 'Un-onboarded — onboarding flow subject',
    expectedRuleId: null,
  },
} as const

export type SeedPatientKey = keyof typeof PATIENTS

export const ADMINS = {
  manisha: {
    email: process.env.ADMIN_MANISHA_EMAIL ?? 'manisha.patel@cardioplace.test',
    roles: ['PROVIDER', 'SUPER_ADMIN'],
    name: 'Dr. Manisha Patel',
  },
  support: {
    email: process.env.ADMIN_SUPPORT_EMAIL ?? 'support@healplace.com',
    roles: ['SUPER_ADMIN', 'PROVIDER', 'MEDICAL_DIRECTOR'],
    name: 'Dr. Manisha Singal',
  },
  primaryProvider: {
    email: process.env.ADMIN_PRIMARY_PROVIDER_EMAIL ?? 'primary-provider@cardioplace.test',
    roles: ['PROVIDER'],
    name: 'Dr. Samuel Okonkwo',
  },
  backupProvider: {
    email: process.env.ADMIN_BACKUP_PROVIDER_EMAIL ?? 'backup-provider@cardioplace.test',
    roles: ['PROVIDER'],
    name: 'Dr. Elena Reyes',
  },
  medicalDirector: {
    email: process.env.ADMIN_MD_EMAIL ?? 'medical-director@cardioplace.test',
    roles: ['MEDICAL_DIRECTOR'],
    name: 'Dr. Priya Raman',
  },
  ops: {
    email: process.env.ADMIN_OPS_EMAIL ?? 'ops@healplace.com',
    roles: ['HEALPLACE_OPS'],
    name: 'HealPlace Ops',
  },
  // phase/23 — front-desk role scoped to the Cedar Hill seed practice via
  // PracticeCoordinator. Drives the patient-invite + user-management e2e
  // flows (specs 35/37) and the COORDINATOR permission-boundary spec (38).
  coordinator: {
    email:
      process.env.ADMIN_COORDINATOR_EMAIL ??
      'coordinator.fernando@cardioplace.test',
    roles: ['COORDINATOR'],
    name: 'Lakshitha Fernando',
  },
  // 2026-07-17 — PROVIDER with NO PracticeProvider row and NO patient
  // assignment. By construction, PatientAccessService rejects every patient
  // for this actor, which is exactly the "scoped PROVIDER outside the alert's
  // scope" case that spec 76 (V-01/V-04 IDOR) needs to assert. The three
  // other provider-role personas (primary, backup, multiPractice) are all
  // assigned to Cedar Hill and would legitimately return 200 on a Cedar Hill
  // alert. See backend/prisma/seed/admins.ts for the seed rationale.
  outOfScopeProvider: {
    email:
      process.env.ADMIN_OUT_OF_SCOPE_PROVIDER_EMAIL ??
      'outofscope-provider@cardioplace.test',
    roles: ['PROVIDER'],
    name: 'Dr. Ines Vega',
  },
  // June 2026 — phase/practice-identity (Manisha 2026-06-12 §1). Seeded
  // ONLY when SEED_TEST_FIXTURES=true so production seed stays single-
  // practice. Member of BOTH seed-cedar-hill and seed-bridgepoint to drive
  // specs 34/35/36 (selector + switcher + audit attribution).
  multiPracticeProvider: {
    email:
      process.env.ADMIN_MULTI_PRACTICE_PROVIDER_EMAIL ??
      'multi-practice-provider@cardioplace.test',
    roles: ['PROVIDER'],
    name: 'Dr. Aisha Nasser',
  },
} as const

export type AdminKey = keyof typeof ADMINS

export const SEED_PRACTICE_ID = 'seed-cedar-hill'
// Phase/practice-identity — second practice seeded behind SEED_TEST_FIXTURES.
export const SEED_PRACTICE_B_ID = 'seed-bridgepoint'
