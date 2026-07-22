import 'reflect-metadata'
import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service.js';
import { DailyJournalController } from './daily_journal.controller.js';
import { DailyJournalService } from './daily_journal.service.js';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import { EncryptionService } from '../common/encryption.service.js';
import { encryptionMock } from '../common/test/encryption.mock.js';

const mockPrisma = {
  journalEntry: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  deviationAlert: { findMany: jest.fn() },
}
const mockEventEmitter = { emit: jest.fn() }

describe('DailyJournalController', () => {
  let controller: DailyJournalController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DailyJournalController],
      providers: [
        DailyJournalService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: EncryptionService, useValue: encryptionMock() },
      ],
    }).compile();

    controller = module.get<DailyJournalController>(DailyJournalController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // The admin app's NotificationBell + /notifications inbox call the SAME
  // daily-journal notification routes as the patient app. The controller is
  // class-gated to PATIENT, so the notification feed/status routes must
  // override @Roles to also admit care-team roles — otherwise the global
  // RolesGuard 403s every admin (30k.1/30k.2/31.11). Each route stays scoped
  // to req.user.id, and the universal BELL_VISIBLE_NOTIFICATION_FILTER (G.4,
  // covered in the service spec) still excludes alert-linked PUSH for every
  // role — clinical alerts live in the patient-detail Alerts tab, not the bell.
  describe('notification feed routes admit care-team roles (admin bell parity)', () => {
    const CARE_TEAM = [
      UserRole.PATIENT,
      UserRole.PROVIDER,
      UserRole.MEDICAL_DIRECTOR,
      UserRole.HEALPLACE_OPS,
      UserRole.SUPER_ADMIN,
    ];

    it.each([
      ['getNotifications', () => controller.getNotifications],
      ['getNotificationsUnreadCount', () => controller.getNotificationsUnreadCount],
      ['getNotification', () => controller.getNotification],
      ['bulkUpdateNotificationStatus', () => controller.bulkUpdateNotificationStatus],
      ['updateNotificationStatus', () => controller.updateNotificationStatus],
    ])('%s allows PROVIDER + the full care-team set (not PATIENT-only)', (_name, handler) => {
      const roles = Reflect.getMetadata(ROLES_KEY, handler()) as UserRole[];
      expect(roles).toEqual(expect.arrayContaining(CARE_TEAM));
      expect(roles).toContain(UserRole.PROVIDER);
    });
  });
});
