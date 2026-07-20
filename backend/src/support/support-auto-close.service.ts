import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { ClsService } from 'nestjs-cls'
import { runAsCronActor } from '../common/cls/cron-actor.util.js'
import { SupportService } from './support.service.js'

/**
 * Support System auto-close cron. Nightly sweep that moves long-idle RESOLVED
 * tickets to CLOSED (the terminal state) so the ops queue reflects genuinely
 * open work. The lifecycle logic lives on SupportService (unit-tested); this is
 * the thin scheduled wrapper, mirroring MonthlyReaskService.
 *
 * Wrapped in the `cron-support-auto-close` CLS actor scope so the SupportTicket
 * writes attribute to the seeded `support-auto-close` system principal rather
 * than a null actor (HIPAA §164.312(b) audit attribution).
 */
@Injectable()
export class SupportAutoCloseService {
  private readonly logger = new Logger(SupportAutoCloseService.name)

  constructor(
    private readonly support: SupportService,
    private readonly cls: ClsService,
  ) {}

  @Cron('0 3 * * *') // daily 03:00 UTC
  async scheduledRun() {
    return runAsCronActor(this.cls, 'cron-support-auto-close', async () => {
      const count = await this.support.autoCloseResolvedTickets()
      if (count > 0) {
        this.logger.log(`Auto-closed ${count} idle resolved support ticket(s)`)
      }
    })
  }
}
