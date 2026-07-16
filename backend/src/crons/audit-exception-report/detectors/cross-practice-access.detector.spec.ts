import { jest } from '@jest/globals'
import {
  AuditExceptionSeverity,
  UserRole,
} from '../../../generated/prisma/enums.js'
import { CrossPracticeAccessDetector } from './cross-practice-access.detector.js'
import type { DetectorContext } from '../detector.types.js'

function makeCtx(opts: {
  accessRows: any[]
  users: Record<string, any>
}): DetectorContext {
  const accessLogFindMany = jest.fn<any>().mockResolvedValue(opts.accessRows)
  const userFindMany = jest.fn<any>().mockImplementation((args: any) => {
    const ids = args.where.id.in as string[]
    return Promise.resolve(ids.map((id) => opts.users[id]).filter(Boolean))
  })
  return {
    prisma: {
      accessLog: { findMany: accessLogFindMany },
      user: { findMany: userFindMany },
    } as any,
    now: new Date('2026-07-10T12:00:00Z'),
    windowStart: new Date('2026-07-09T12:00:00Z'),
    windowEnd: new Date('2026-07-10T12:00:00Z'),
  }
}

function accessRow(actorId: string, targetId: string, minutesAgo = 0) {
  return {
    actorId,
    recordId: targetId,
    createdAt: new Date(Date.parse('2026-07-10T12:00:00Z') - minutesAgo * 60_000),
  }
}

function providerUser(id: string, practiceIds: string[]) {
  return {
    id,
    roles: [UserRole.PROVIDER],
    practiceProviderMemberships: practiceIds.map((practiceId) => ({ practiceId })),
    practiceMedicalDirectorMemberships: [],
    practiceCoordinator: null,
    providerAssignmentAsPatient: null,
  }
}

function mdUser(id: string, practiceIds: string[]) {
  return {
    id,
    roles: [UserRole.MEDICAL_DIRECTOR],
    practiceProviderMemberships: [],
    practiceMedicalDirectorMemberships: practiceIds.map((practiceId) => ({ practiceId })),
    practiceCoordinator: null,
    providerAssignmentAsPatient: null,
  }
}

function coordinatorUser(id: string, practiceId: string) {
  return {
    id,
    roles: [UserRole.COORDINATOR],
    practiceProviderMemberships: [],
    practiceMedicalDirectorMemberships: [],
    practiceCoordinator: { practiceId },
    providerAssignmentAsPatient: null,
  }
}

function opsUser(id: string) {
  return {
    id,
    roles: [UserRole.HEALPLACE_OPS],
    practiceProviderMemberships: [],
    practiceMedicalDirectorMemberships: [],
    practiceCoordinator: null,
    providerAssignmentAsPatient: null,
  }
}

function superAdminUser(id: string) {
  return {
    id,
    roles: [UserRole.SUPER_ADMIN],
    practiceProviderMemberships: [],
    practiceMedicalDirectorMemberships: [],
    practiceCoordinator: null,
    providerAssignmentAsPatient: null,
  }
}

function patientUser(id: string, practiceId: string | null) {
  return {
    id,
    roles: [UserRole.PATIENT],
    practiceProviderMemberships: [],
    practiceMedicalDirectorMemberships: [],
    practiceCoordinator: null,
    providerAssignmentAsPatient: practiceId ? { practiceId } : null,
  }
}

describe('CrossPracticeAccessDetector — N7', () => {
  it('does NOT fire when provider accesses a patient in one of their practices', async () => {
    const ctx = makeCtx({
      accessRows: [accessRow('provider-1', 'patient-1')],
      users: {
        'provider-1': providerUser('provider-1', ['practice-a']),
        'patient-1': patientUser('patient-1', 'practice-a'),
      },
    })
    const candidates = await new CrossPracticeAccessDetector().scan(ctx)
    expect(candidates).toEqual([])
  })

  it('fires HIGH when provider accesses a patient in a different practice', async () => {
    const ctx = makeCtx({
      accessRows: [accessRow('provider-1', 'patient-1')],
      users: {
        'provider-1': providerUser('provider-1', ['practice-a']),
        'patient-1': patientUser('patient-1', 'practice-b'),
      },
    })
    const candidates = await new CrossPracticeAccessDetector().scan(ctx)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].severityOverride).toBeUndefined()
    expect(candidates[0].practiceContext).toBe('practice-b')
    expect(candidates[0].evidence.targetPatientUserId).toBe('patient-1')
  })

  it('fires CRITICAL for COORDINATOR touching patient PHI', async () => {
    const ctx = makeCtx({
      accessRows: [accessRow('coord-1', 'patient-1')],
      users: {
        'coord-1': coordinatorUser('coord-1', 'practice-a'),
        'patient-1': patientUser('patient-1', 'practice-a'),
      },
    })
    const candidates = await new CrossPracticeAccessDetector().scan(ctx)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].severityOverride).toBe(AuditExceptionSeverity.CRITICAL)
    expect(candidates[0].evidence.role).toBe('COORDINATOR')
  })

  it('fires MEDIUM + auto-ACK for HEALPLACE_OPS cross-practice access (N-5 tuning)', async () => {
    // N-5 (Duwaragie 2026-07-14 triage) — ops cross-practice access is by
    // design (ACCESS_SCOPE.md §5), so the audit row lands with LOW-tier
    // severity + status ACKNOWLEDGED. Pre-fix it landed HIGH-open and
    // flooded Lakshitha's L3 worklist with rubber-stamp work.
    const ctx = makeCtx({
      accessRows: [accessRow('ops-1', 'patient-1')],
      users: {
        'ops-1': opsUser('ops-1'),
        'patient-1': patientUser('patient-1', 'practice-a'),
      },
    })
    const candidates = await new CrossPracticeAccessDetector().scan(ctx)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].evidence.role).toBe('HEALPLACE_OPS')
    expect(candidates[0].severityOverride).toBe(AuditExceptionSeverity.MEDIUM)
    expect(candidates[0].initialStatus).toBe('ACKNOWLEDGED')
    // Evidence string signals the intent to any future reviewer inspecting
    // the row directly (or hitting it through a compliance export).
    expect(candidates[0].evidence.reason).toMatch(/auto-acknowledged/i)
  })

  it('never fires for SUPER_ADMIN — unscoped by policy', async () => {
    const ctx = makeCtx({
      accessRows: [accessRow('admin-1', 'patient-1')],
      users: {
        'admin-1': superAdminUser('admin-1'),
        'patient-1': patientUser('patient-1', 'practice-a'),
      },
    })
    const candidates = await new CrossPracticeAccessDetector().scan(ctx)
    expect(candidates).toEqual([])
  })

  it('does NOT fire when MD is a member of the target patient\'s practice', async () => {
    const ctx = makeCtx({
      accessRows: [accessRow('md-1', 'patient-1')],
      users: {
        'md-1': mdUser('md-1', ['practice-a', 'practice-b']),
        'patient-1': patientUser('patient-1', 'practice-b'),
      },
    })
    const candidates = await new CrossPracticeAccessDetector().scan(ctx)
    expect(candidates).toEqual([])
  })

  it('fires when MD accesses a patient in a practice they do not head', async () => {
    const ctx = makeCtx({
      accessRows: [accessRow('md-1', 'patient-1')],
      users: {
        'md-1': mdUser('md-1', ['practice-a']),
        'patient-1': patientUser('patient-1', 'practice-b'),
      },
    })
    const candidates = await new CrossPracticeAccessDetector().scan(ctx)
    expect(candidates).toHaveLength(1)
  })

  it('collapses repeated accesses of the same (actor, target) into one candidate', async () => {
    const ctx = makeCtx({
      accessRows: [
        accessRow('provider-1', 'patient-1', 60),
        accessRow('provider-1', 'patient-1', 30),
        accessRow('provider-1', 'patient-1', 10),
      ],
      users: {
        'provider-1': providerUser('provider-1', ['practice-a']),
        'patient-1': patientUser('patient-1', 'practice-b'),
      },
    })
    const candidates = await new CrossPracticeAccessDetector().scan(ctx)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].evidence.hits).toBe(3)
  })

  it('ignores actor viewing their own record (self-read)', async () => {
    const ctx = makeCtx({
      accessRows: [accessRow('u-1', 'u-1')],
      users: { 'u-1': patientUser('u-1', 'practice-a') },
    })
    const candidates = await new CrossPracticeAccessDetector().scan(ctx)
    expect(candidates).toEqual([])
  })
})
