import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { ProfileNotFoundException } from '@cardioplace/shared'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ProfileResolverService } from './profile-resolver.service.js'

describe('ProfileResolverService', () => {
  let service: ProfileResolverService
  let prisma: Record<string, any>

  // ── fixture builders ────────────────────────────────────────────────────
  const profileDefaults = {
    gender: 'FEMALE',
    heightCm: 165,
    isPregnant: false,
    pregnancyDueDate: null,
    historyPreeclampsia: false,
    hasHeartFailure: false,
    heartFailureType: 'NOT_APPLICABLE',
    hasAFib: false,
    hasCAD: false,
    hasHCM: false,
    hasDCM: false,
    hasTachycardia: false,
    hasBradycardia: false,
    diagnosedHypertension: false,
    profileVerificationStatus: 'VERIFIED',
    profileVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    profileLastEditedAt: new Date('2026-01-01T00:00:00Z'),
  }

  const medDefaults = {
    isCombination: false,
    combinationComponents: [] as string[],
    frequency: 'ONCE_DAILY',
    source: 'PATIENT_SELF_REPORT',
    verificationStatus: 'VERIFIED',
    reportedAt: new Date('2026-01-01T00:00:00Z'),
    discontinuedAt: null as Date | null,
  }

  function userFixture(overrides: Partial<{
    dateOfBirth: Date | null
    timezone: string | null
    patientProfile: any
    patientThreshold: any
    providerAssignmentAsPatient: any
    patientMedications: any[]
  }> = {}) {
    return {
      id: 'user-1',
      dateOfBirth: new Date('1980-06-15T00:00:00Z'),
      timezone: 'America/New_York',
      patientProfile: { ...profileDefaults },
      patientThreshold: null,
      providerAssignmentAsPatient: null,
      patientMedications: [],
      ...overrides,
    }
  }

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: (jest.fn() as jest.Mock<any>).mockResolvedValue(userFixture()),
      },
      journalEntry: {
        count: (jest.fn() as jest.Mock<any>).mockResolvedValue(0),
      },
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileResolverService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile()

    service = module.get<ProfileResolverService>(ProfileResolverService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  // ──────────────────────────────────────────────────────────────────────
  // B.1 Loading
  // ──────────────────────────────────────────────────────────────────────
  describe('loading', () => {
    it('returns ResolvedContext with user+profile+meds+threshold+assignment+readingCount', async () => {
      prisma.journalEntry.count.mockResolvedValue(10)

      const ctx = await service.resolve('user-1')

      expect(ctx.userId).toBe('user-1')
      expect(ctx.profile).toBeDefined()
      expect(ctx.contextMeds).toEqual([])
      expect(ctx.excludedMeds).toEqual([])
      expect(ctx.threshold).toBeNull()
      expect(ctx.assignment).toBeNull()
      expect(ctx.readingCount).toBe(10)
    })

    it('throws ProfileNotFoundException when user has no PatientProfile (admin)', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...userFixture(), patientProfile: null })

      await expect(service.resolve('user-1')).rejects.toBeInstanceOf(ProfileNotFoundException)
    })

    it('throws ProfileNotFoundException when user not found at all', async () => {
      prisma.user.findUnique.mockResolvedValue(null)

      await expect(service.resolve('nope')).rejects.toBeInstanceOf(ProfileNotFoundException)
    })

    it('uses a single user query — no N+1', async () => {
      await service.resolve('user-1')
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1)
      expect(prisma.journalEntry.count).toHaveBeenCalledTimes(1)
    })
  })

  // ──────────────────────────────────────────────────────────────────────
  // B.2 Medication filtering
  // ──────────────────────────────────────────────────────────────────────
  describe('medication filtering', () => {
    it('discontinued meds are never loaded (filtered by the DB query)', async () => {
      // The query itself passes `where: { discontinuedAt: null }` — we assert
      // the spy saw that filter rather than simulating a discontinued row.
      await service.resolve('user-1')
      const call = prisma.user.findUnique.mock.calls[0][0]
      expect(call.include.patientMedications.where).toEqual({ discontinuedAt: null })
    })

    it('excludes REJECTED medication from contextMeds', async () => {
      prisma.user.findUnique.mockResolvedValue(
        userFixture({
          patientMedications: [
            { ...medDefaults, id: 'm1', drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR', verificationStatus: 'REJECTED' },
          ],
        }),
      )

      const ctx = await service.resolve('user-1')

      expect(ctx.contextMeds).toHaveLength(0)
      expect(ctx.excludedMeds).toHaveLength(1)
      expect(ctx.excludedMeds[0].drugName).toBe('Lisinopril')
    })

    it('excludes OTHER_UNVERIFIED drug class from contextMeds', async () => {
      prisma.user.findUnique.mockResolvedValue(
        userFixture({
          patientMedications: [
            { ...medDefaults, id: 'm1', drugName: 'Unknown pill', drugClass: 'OTHER_UNVERIFIED', verificationStatus: 'UNVERIFIED' },
          ],
        }),
      )

      const ctx = await service.resolve('user-1')

      expect(ctx.contextMeds).toHaveLength(0)
      expect(ctx.excludedMeds).toHaveLength(1)
    })

    it('excludes UNVERIFIED PATIENT_VOICE med from contextMeds', async () => {
      prisma.user.findUnique.mockResolvedValue(
        userFixture({
          patientMedications: [
            { ...medDefaults, id: 'm1', drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR', source: 'PATIENT_VOICE', verificationStatus: 'UNVERIFIED' },
          ],
        }),
      )

      const ctx = await service.resolve('user-1')

      expect(ctx.contextMeds).toHaveLength(0)
      expect(ctx.excludedMeds).toHaveLength(1)
    })

    it('excludes UNVERIFIED PATIENT_PHOTO med from contextMeds', async () => {
      prisma.user.findUnique.mockResolvedValue(
        userFixture({
          patientMedications: [
            { ...medDefaults, id: 'm1', drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR', source: 'PATIENT_PHOTO', verificationStatus: 'UNVERIFIED' },
          ],
        }),
      )

      const ctx = await service.resolve('user-1')

      expect(ctx.contextMeds).toHaveLength(0)
      expect(ctx.excludedMeds).toHaveLength(1)
    })

    it('keeps known-class UNVERIFIED med in contextMeds (for suppression logic)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        userFixture({
          patientMedications: [
            { ...medDefaults, id: 'm1', drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER', verificationStatus: 'UNVERIFIED' },
          ],
        }),
      )

      const ctx = await service.resolve('user-1')

      expect(ctx.contextMeds).toHaveLength(1)
      expect(ctx.contextMeds[0].drugClass).toBe('BETA_BLOCKER')
      expect(ctx.contextMeds[0].verificationStatus).toBe('UNVERIFIED')
    })

    it('VERIFIED voice med still qualifies for contextMeds', async () => {
      prisma.user.findUnique.mockResolvedValue(
        userFixture({
          patientMedications: [
            { ...medDefaults, id: 'm1', drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR', source: 'PATIENT_VOICE', verificationStatus: 'VERIFIED' },
          ],
        }),
      )

      const ctx = await service.resolve('user-1')

      expect(ctx.contextMeds).toHaveLength(1)
    })
  })

  // ──────────────────────────────────────────────────────────────────────
  // B.3 Safety-net biases
  // ──────────────────────────────────────────────────────────────────────
  describe('safety-net biases', () => {
    it('heartFailureType=UNKNOWN → resolvedHFType=HFREF (conservative)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        userFixture({
          patientProfile: { ...profileDefaults, hasHeartFailure: true, heartFailureType: 'UNKNOWN' },
        }),
      )

      const ctx = await service.resolve('user-1')

      expect(ctx.profile.heartFailureType).toBe('UNKNOWN')
      expect(ctx.profile.resolvedHFType).toBe('HFREF')
    })

    it('declared HFREF is preserved', async () => {
      prisma.user.findUnique.mockResolvedValue(
        userFixture({
          patientProfile: { ...profileDefaults, hasHeartFailure: true, heartFailureType: 'HFREF' },
        }),
      )

      const ctx = await service.resolve('user-1')
      expect(ctx.profile.resolvedHFType).toBe('HFREF')
    })

    it('declared HFPEF is preserved (not auto-biased to HFREF)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        userFixture({
          patientProfile: { ...profileDefaults, hasHeartFailure: true, heartFailureType: 'HFPEF' },
        }),
      )

      const ctx = await service.resolve('user-1')
      expect(ctx.profile.resolvedHFType).toBe('HFPEF')
    })

    it('DCM without HeartFailure flag → resolvedHFType=HFREF (§4.8 managed as HFrEF)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        userFixture({
          patientProfile: { ...profileDefaults, hasHeartFailure: false, hasDCM: true, heartFailureType: 'NOT_APPLICABLE' },
        }),
      )

      const ctx = await service.resolve('user-1')
      expect(ctx.profile.resolvedHFType).toBe('HFREF')
    })

    it('no HF, no DCM → resolvedHFType=NOT_APPLICABLE', async () => {
      const ctx = await service.resolve('user-1')
      expect(ctx.profile.resolvedHFType).toBe('NOT_APPLICABLE')
    })

    it('isPregnant + UNVERIFIED profile → pregnancyThresholdsActive=true', async () => {
      prisma.user.findUnique.mockResolvedValue(
        userFixture({
          patientProfile: {
            ...profileDefaults,
            isPregnant: true,
            profileVerificationStatus: 'UNVERIFIED',
          },
        }),
      )

      const ctx = await service.resolve('user-1')
      expect(ctx.pregnancyThresholdsActive).toBe(true)
      expect(ctx.triggerPregnancyContraindicationCheck).toBe(true)
    })

    it('isPregnant=false → pregnancyThresholdsActive=false regardless of verification', async () => {
      const ctx = await service.resolve('user-1')
      expect(ctx.pregnancyThresholdsActive).toBe(false)
      expect(ctx.triggerPregnancyContraindicationCheck).toBe(false)
    })
  })

  // ──────────────────────────────────────────────────────────────────────
  // B.4 Pre-Day-3 flag
  // ──────────────────────────────────────────────────────────────────────
  describe('pre-Day-3 flag', () => {
    it('0 readings → preDay3Mode=true', async () => {
      prisma.journalEntry.count.mockResolvedValue(0)
      const ctx = await service.resolve('user-1')
      expect(ctx.preDay3Mode).toBe(true)
    })

    it('6 readings → preDay3Mode=true', async () => {
      prisma.journalEntry.count.mockResolvedValue(6)
      const ctx = await service.resolve('user-1')
      expect(ctx.preDay3Mode).toBe(true)
    })

    it('7 readings → preDay3Mode=false (boundary)', async () => {
      prisma.journalEntry.count.mockResolvedValue(7)
      const ctx = await service.resolve('user-1')
      expect(ctx.preDay3Mode).toBe(false)
    })

    it('20 readings → preDay3Mode=false', async () => {
      prisma.journalEntry.count.mockResolvedValue(20)
      const ctx = await service.resolve('user-1')
      expect(ctx.preDay3Mode).toBe(false)
    })
  })

  // ──────────────────────────────────────────────────────────────────────
  // B.5 Age bucket
  // ──────────────────────────────────────────────────────────────────────
  describe('age bucket', () => {
    it('derives 40-64 bucket from dateOfBirth', async () => {
      const ctx = await service.resolve('user-1', new Date('2026-04-22T00:00:00Z'))
      expect(ctx.ageGroup).toBe('40-64')
    })

    it('null dateOfBirth → ageGroup=null', async () => {
      prisma.user.findUnique.mockResolvedValue(userFixture({ dateOfBirth: null }))
      const ctx = await service.resolve('user-1')
      expect(ctx.ageGroup).toBeNull()
    })

    it('65+ bucket for elderly user', async () => {
      prisma.user.findUnique.mockResolvedValue(
        userFixture({ dateOfBirth: new Date('1950-01-01T00:00:00Z') }),
      )
      const ctx = await service.resolve('user-1', new Date('2026-04-22T00:00:00Z'))
      expect(ctx.ageGroup).toBe('65+')
    })
  })

  // ──────────────────────────────────────────────────────────────────────
  // B.6 Personalized-mode eligibility
  // ──────────────────────────────────────────────────────────────────────
  describe('personalized-mode eligibility', () => {
    const threshold = {
      sbpUpperTarget: 130,
      sbpLowerTarget: 90,
      dbpUpperTarget: 80,
      dbpLowerTarget: 60,
      hrUpperTarget: null,
      hrLowerTarget: null,
      setByProviderId: 'prov-1',
      setAt: new Date('2026-01-01T00:00:00Z'),
      notes: null,
    }

    it('threshold + ≥7 readings → personalizedEligible=true', async () => {
      prisma.user.findUnique.mockResolvedValue(userFixture({ patientThreshold: threshold }))
      prisma.journalEntry.count.mockResolvedValue(10)

      const ctx = await service.resolve('user-1')
      expect(ctx.personalizedEligible).toBe(true)
      expect(ctx.threshold?.sbpUpperTarget).toBe(130)
    })

    it('threshold + <7 readings → personalizedEligible=false (pre-Day-3 blocks it)', async () => {
      prisma.user.findUnique.mockResolvedValue(userFixture({ patientThreshold: threshold }))
      prisma.journalEntry.count.mockResolvedValue(3)

      const ctx = await service.resolve('user-1')
      expect(ctx.personalizedEligible).toBe(false)
      expect(ctx.preDay3Mode).toBe(true)
    })

    it('no threshold + ≥7 readings → personalizedEligible=false', async () => {
      prisma.journalEntry.count.mockResolvedValue(10)

      const ctx = await service.resolve('user-1')
      expect(ctx.personalizedEligible).toBe(false)
      expect(ctx.threshold).toBeNull()
    })
  })

  // ──────────────────────────────────────────────────────────────────────
  // Assignment pass-through
  // ──────────────────────────────────────────────────────────────────────
  describe('assignment pass-through', () => {
    it('flattens PatientProviderAssignment into ContextAssignment', async () => {
      prisma.user.findUnique.mockResolvedValue(
        userFixture({
          providerAssignmentAsPatient: {
            practiceId: 'prac-1',
            primaryProviderId: 'prov-primary',
            backupProviderId: 'prov-backup',
            medicalDirectorId: 'prov-md',
          },
        }),
      )

      const ctx = await service.resolve('user-1')
      expect(ctx.assignment).toEqual({
        practiceId: 'prac-1',
        primaryProviderId: 'prov-primary',
        backupProviderId: 'prov-backup',
        medicalDirectorId: 'prov-md',
      })
    })
  })
})
