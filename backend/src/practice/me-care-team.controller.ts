import { Controller, Get, Req } from '@nestjs/common'
import type { Request } from 'express'
import { AssignmentService } from './assignment.service.js'

type AuthedReq = Request & { user: { id: string } }

/**
 * Patient-facing read of their own care team. Returns null (not 404) when
 * no assignment exists yet — the profile page uses that to decide whether
 * to render the "Assigned care team" section vs an "awaiting assignment"
 * placeholder.
 */
@Controller('me/care-team')
export class MeCareTeamController {
  constructor(private readonly service: AssignmentService) {}

  @Get()
  findMine(@Req() req: AuthedReq) {
    return this.service.findCareTeamForPatient(req.user.id)
  }
}
