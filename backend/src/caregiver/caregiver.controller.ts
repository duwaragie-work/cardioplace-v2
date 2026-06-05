import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common'
import type { Request } from 'express'
import { CaregiverService } from './caregiver.service.js'
import { CreateCaregiverDto } from './dto/create-caregiver.dto.js'
import { UpdateCaregiverDto } from './dto/update-caregiver.dto.js'

type AuthedReq = Request & { user: { id: string } }

// Patient-scoped caregiver management. The patient owns their caregiver list
// and captures consent themselves. All routes operate on req.user.id.
@Controller('me/caregivers')
export class CaregiverController {
  constructor(private readonly caregiver: CaregiverService) {}

  @Get()
  list(@Req() req: AuthedReq) {
    return this.caregiver.list(req.user.id)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Req() req: AuthedReq, @Body() dto: CreateCaregiverDto) {
    return this.caregiver.create(req.user.id, req.user.id, 'PATIENT', dto)
  }

  @Patch(':id')
  update(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: UpdateCaregiverDto,
  ) {
    return this.caregiver.update(req.user.id, id, req.user.id, 'PATIENT', dto)
  }

  @Delete(':id')
  remove(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.caregiver.remove(req.user.id, id, req.user.id, 'PATIENT')
  }
}
