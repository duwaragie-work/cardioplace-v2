import { jest } from '@jest/globals'
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { UserRole } from '../generated/prisma/enums.js'
import { ProviderController } from './provider.controller.js'

/**
 * V-04 regression (Humaira assessment 2026-07-14, HIGH) — cross-tenant IDOR on
 * the alert-acknowledge WRITE path.
 *
 * `acknowledgeAlert` called `providerService.acknowledgeAlert(alertId, userId)`
 * with no scope check, while its READ sibling `getAlertDetail` had one. Any
 * authenticated provider could acknowledge another practice's alert — making an
 * unaddressed patient-safety alert appear handled, and stamping their own id as
 * the acting clinician in the escalation audit trail.
 *
 * These are the first tests to exist for either handler. As with
 * admin-caregiver.controller.spec.ts, the practice-scope POLICY lives in
 * patient-access.service.spec.ts — here we prove the wiring: that the gate is
 * called with the alert's OWNING patient, that a refusal propagates, and that
 * the ordering doesn't leak which alertIds are real.
 */

const OTHER_PRACTICE_PATIENT = 'patient-b'
const ALERT = 'alert-1'
const provActor = {
  id: 'provider-a',
  roles: [UserRole.PROVIDER] as UserRole[],
  activePracticeId: 'practice-a',
}

function makeReq(actor: typeof provActor) {
  return { user: actor } as any
}

describe('ProviderController — alert scope gates', () => {
  let controller: ProviderController
  let providerService: {
    acknowledgeAlert: jest.Mock<any>
    getAlertDetail: jest.Mock<any>
  }
  let prisma: { deviationAlert: { findUnique: jest.Mock<any> } }
  let access: { assertCanAccessPatient: jest.Mock<any> }

  beforeEach(() => {
    providerService = {
      acknowledgeAlert: jest.fn(() => Promise.resolve({ statusCode: 200 })) as any,
      getAlertDetail: jest.fn(() => Promise.resolve({ id: ALERT })) as any,
    }
    prisma = {
      deviationAlert: {
        // The alert belongs to a patient at ANOTHER practice.
        findUnique: jest.fn(() =>
          Promise.resolve({ userId: OTHER_PRACTICE_PATIENT }),
        ) as any,
      },
    }
    access = { assertCanAccessPatient: jest.fn(() => Promise.resolve()) as any }
    controller = new ProviderController(
      providerService as any,
      prisma as any,
      access as any,
    )
  })

  describe('acknowledgeAlert (V-04)', () => {
    it("gates on the alert's OWNING patient before mutating", async () => {
      await controller.acknowledgeAlert(makeReq(provActor), ALERT)

      expect(access.assertCanAccessPatient).toHaveBeenCalledWith(
        {
          id: provActor.id,
          roles: provActor.roles,
          activePracticeId: provActor.activePracticeId,
        },
        OTHER_PRACTICE_PATIENT,
      )
      expect(providerService.acknowledgeAlert).toHaveBeenCalledWith(
        ALERT,
        provActor.id,
      )
    })

    it('does NOT mutate when the patient is outside the actor scope', async () => {
      access.assertCanAccessPatient.mockRejectedValue(
        new ForbiddenException('Requested record is outside your role scope'),
      )

      await expect(
        controller.acknowledgeAlert(makeReq(provActor), ALERT),
      ).rejects.toThrow(ForbiddenException)

      // The whole point of V-04: the write must not happen.
      expect(providerService.acknowledgeAlert).not.toHaveBeenCalled()
    })

    it('404s an unknown alert WITHOUT consulting the gate (no id oracle)', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue(null)

      await expect(
        controller.acknowledgeAlert(makeReq(provActor), ALERT),
      ).rejects.toThrow(NotFoundException)
      expect(access.assertCanAccessPatient).not.toHaveBeenCalled()
      expect(providerService.acknowledgeAlert).not.toHaveBeenCalled()
    })

    it('a patient acknowledging their OWN alert short-circuits the scope lookup', async () => {
      // assertCanViewPatient's self short-circuit (provider.controller.ts:174) —
      // PatientAccessService only handles admin-role callers.
      const selfActor = { ...provActor, id: OTHER_PRACTICE_PATIENT }
      await controller.acknowledgeAlert(makeReq(selfActor), ALERT)

      expect(access.assertCanAccessPatient).not.toHaveBeenCalled()
      expect(providerService.acknowledgeAlert).toHaveBeenCalled()
    })
  })

  describe('getAlertDetail (the read sibling — guards the pattern)', () => {
    it('gates on the owning patient before reading', async () => {
      await controller.getAlertDetail(makeReq(provActor), ALERT)

      expect(access.assertCanAccessPatient).toHaveBeenCalledWith(
        {
          id: provActor.id,
          roles: provActor.roles,
          activePracticeId: provActor.activePracticeId,
        },
        OTHER_PRACTICE_PATIENT,
      )
    })

    it('does NOT read when the patient is outside the actor scope', async () => {
      access.assertCanAccessPatient.mockRejectedValue(
        new ForbiddenException('Requested record is outside your role scope'),
      )

      await expect(
        controller.getAlertDetail(makeReq(provActor), ALERT),
      ).rejects.toThrow(ForbiddenException)
      expect(providerService.getAlertDetail).not.toHaveBeenCalled()
    })
  })
})
