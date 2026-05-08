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
} as const

export type AdminKey = keyof typeof ADMINS

export const SEED_PRACTICE_ID = 'seed-cedar-hill'
