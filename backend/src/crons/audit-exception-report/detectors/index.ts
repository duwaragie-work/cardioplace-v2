import { BulkPhiReadDetector } from './bulk-phi-read.detector.js'
import { CrossPracticeAccessDetector } from './cross-practice-access.detector.js'
import { DroppedAuditWritesDetector } from './dropped-audit-writes.detector.js'
import { OffHoursPhiAccessDetector } from './off-hours-phi-access.detector.js'
import { RepeatedFailedAuthDetector } from './repeated-failed-auth.detector.js'
import { UnattributedSystemDisclosureDetector } from './unattributed-system-disclosure.detector.js'
import type { ExceptionDetector } from '../detector.types.js'

/**
 * The full N7 detector fleet. The cron iterates this array; a new detector
 * shows up in production the moment it lands here + gets an enum value.
 *
 * A static-drift guard test (audit-exception-report/detectors.spec.ts)
 * asserts:
 *   • Every `ExceptionDetector.id` matches an `AuditExceptionDetectorId`
 *     enum value.
 *   • No duplicate ids (two detectors claiming the same enum value).
 *   • The array's length matches the enum's cardinality — so a new detector
 *     added to the enum without a class implementation fails the build.
 */
export const ALL_DETECTORS: ExceptionDetector[] = [
  new BulkPhiReadDetector(),
  new OffHoursPhiAccessDetector(),
  new CrossPracticeAccessDetector(),
  new RepeatedFailedAuthDetector(),
  new DroppedAuditWritesDetector(),
  new UnattributedSystemDisclosureDetector(),
]
