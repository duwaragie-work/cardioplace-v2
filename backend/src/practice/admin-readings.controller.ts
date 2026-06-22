import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common'
import type { Request } from 'express'
import { ActiveContext } from '../auth/decorators/active-context.decorator.js'
import { Roles } from '../auth/decorators/roles.decorator.js'
import {
  ActorUser,
  PatientAccessService,
} from '../common/patient-access.service.js'
import { DailyJournalService } from '../daily_journal/daily_journal.service.js'
import { CreateJournalEntryDto } from '../daily_journal/dto/create-journal-entry.dto.js'
import { UpdateJournalEntryDto } from '../daily_journal/dto/update-journal-entry.dto.js'
import { UserRole } from '../generated/prisma/enums.js'

type AuthedReq = Request & {
  user: { id: string; roles: UserRole[]; activePracticeId?: string | null }
}

// Care-team CRUD on patient readings — clinic-floor entry on the patient's
// behalf (coordinator/provider keying in cuff readings) + transcription-error
// correction. Clinical write action, so the role list matches the threshold
// WRITE scope (June 2026 decision):
//   • SUPER_ADMIN, MEDICAL_DIRECTOR (their practice patients), PROVIDER
//     (their assigned patients) — runtime-scoped per handler via
//     PatientAccessService.assertCanAccessPatient.
//   • HEALPLACE_OPS excluded (clinical write they're not authorized for).
//   • COORDINATOR excluded for MVP (pending Manisha confirmation).
//   • PATIENT excluded — they use their own /daily-journal endpoints.
// Every mutation delegates to DailyJournalService with the actor set, which
// flips the audit rows to ADMIN_READING_* and (per CTO Option C) suppresses
// engine re-evaluation on edit/delete. POST evaluates normally — a new
// reading is a new clinical datapoint regardless of who keyed it in.
@Controller('admin/patients/:userId/readings')
@Roles(UserRole.SUPER_ADMIN, UserRole.MEDICAL_DIRECTOR, UserRole.PROVIDER)
export class AdminReadingsController {
  constructor(
    private readonly journal: DailyJournalService,
    private readonly access: PatientAccessService,
  ) {}

  /**
   * Add a reading for the patient. Optional dto.sessionId joins an existing
   * multi-reading session — the service 400s ("Session expired or invalid")
   * when the session window has elapsed; absent, the backend assigns a fresh
   * session. 202 because the rule engine evaluates in the background, same
   * as the patient POST.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(
    @Req() req: AuthedReq,
    @Param('userId') patientUserId: string,
    @Body() dto: CreateJournalEntryDto,
    @ActiveContext() ctx: { practiceId: string | null },
  ) {
    const actor = this.actorOf(req)
    await this.access.assertCanAccessPatient(actor, patientUserId)
    return this.journal.create(patientUserId, dto, actor, ctx)
  }

  /**
   * Edit a reading. NO engine re-evaluation (CTO Option C) — the corrected
   * value flows into the next new reading's batch; existing alerts stand.
   */
  @Put(':entryId')
  async update(
    @Req() req: AuthedReq,
    @Param('userId') patientUserId: string,
    @Param('entryId') entryId: string,
    @Body() dto: UpdateJournalEntryDto,
    @ActiveContext() ctx: { practiceId: string | null },
  ) {
    const actor = this.actorOf(req)
    await this.access.assertCanAccessPatient(actor, patientUserId)
    // Service scopes the lookup to {entryId, patientUserId} — an entryId
    // belonging to a different patient 404s without confirming existence.
    return this.journal.update(patientUserId, entryId, dto, actor, ctx)
  }

  /**
   * Hard-delete a reading. The ADMIN_READING_DELETED audit row is written
   * before the row is removed (same transaction), so the deleted state
   * survives in the trail. No engine re-evaluation (CTO Option C).
   */
  @Delete(':entryId')
  async delete(
    @Req() req: AuthedReq,
    @Param('userId') patientUserId: string,
    @Param('entryId') entryId: string,
    @ActiveContext() ctx: { practiceId: string | null },
  ) {
    const actor = this.actorOf(req)
    await this.access.assertCanAccessPatient(actor, patientUserId)
    return this.journal.delete(patientUserId, entryId, actor, ctx)
  }

  private actorOf(req: AuthedReq): ActorUser {
    return {
      id: req.user.id,
      roles: req.user.roles,
      activePracticeId: req.user.activePracticeId,
    }
  }
}
