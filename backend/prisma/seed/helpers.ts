// Phase 0 §C — shared seed utilities.
//
// Single source of the PrismaClient used by every seed module, plus the
// perma-OTP trick + date helpers. Construction is copied verbatim from the
// pre-Phase-0 monolithic seed.ts so the modular seed connects identically
// (Accelerate URL vs pg adapter).
import { PrismaClient } from '../../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import bcrypt from 'bcrypt'
import 'dotenv/config'

const dbUrl = process.env.DATABASE_URL!
const isAccelerate = dbUrl.startsWith('prisma://')

export const prisma = isAccelerate
  ? new PrismaClient({ accelerateUrl: dbUrl })
  : new PrismaClient({
      adapter: new PrismaPg(new pg.Pool({ connectionString: dbUrl })),
    })

export type SeedPrisma = typeof prisma

export const DEMO_OTP = '666666'
export const PERMA_EXPIRY = new Date('2099-12-31')

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

export function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000)
}

export function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000)
}

/**
 * Idempotent perma-OTP seed. Deletes any prior perma row for the email
 * (expiry past 2098) then inserts a fresh one so re-running never stacks
 * duplicates. Copied verbatim from the pre-Phase-0 seed.ts.
 */
export async function seedPermaOtp(email: string, codeHash: string) {
  await prisma.otpCode.deleteMany({
    where: { email, expiresAt: { gt: new Date('2098-01-01') } },
  })
  await prisma.otpCode.create({
    data: { email, codeHash, expiresAt: PERMA_EXPIRY },
  })
}

/** bcrypt helpers — fixed cost 10, matching the pre-Phase-0 seed. */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10)
}

export function hashOtp(otp: string): Promise<string> {
  return bcrypt.hash(otp, 10)
}

// ─── Shared persona shape (used by patients.ts) ────────────────────────────
export type PatientSeed = {
  email: string
  name: string
  dateOfBirth: Date
  gender: 'MALE' | 'FEMALE' | 'OTHER'
  heightCm: number
  profile: {
    isPregnant?: boolean
    pregnancyDueDate?: Date
    historyHDP?: boolean
    hasHeartFailure?: boolean
    heartFailureType?: 'HFREF' | 'HFPEF' | 'UNKNOWN' | 'NOT_APPLICABLE'
    hasAFib?: boolean
    hasCAD?: boolean
    hasHCM?: boolean
    hasDCM?: boolean
    hasBradycardia?: boolean
    hasTachycardia?: boolean
    diagnosedHypertension?: boolean
  }
  medications: Array<{
    drugName: string
    drugClass:
      | 'ACE_INHIBITOR'
      | 'ARB'
      | 'BETA_BLOCKER'
      | 'DHP_CCB'
      | 'NDHP_CCB'
      | 'LOOP_DIURETIC'
      | 'STATIN'
      | 'ANTICOAGULANT'
      | 'ANTIARRHYTHMIC'
    frequency: 'ONCE_DAILY' | 'TWICE_DAILY'
    verificationStatus: 'VERIFIED' | 'UNVERIFIED'
  }>
  threshold?: {
    sbpUpperTarget?: number
    sbpLowerTarget?: number
    dbpUpperTarget?: number
    dbpLowerTarget?: number
    notes?: string
  }
  readings: Array<{ daysAgo: number; sbp: number; dbp: number; pulse: number }>
  archetype: string
}
