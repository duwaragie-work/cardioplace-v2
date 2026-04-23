import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common'
import type { Request } from 'express'
import { IntakeService } from './intake.service.js'
import { IntakeProfileDto } from './dto/intake-profile.dto.js'
import { IntakeMedicationsDto } from './dto/intake-medications.dto.js'
import { ReplaceMedicationsDto } from './dto/replace-medications.dto.js'
import { UpdateMedicationDto } from './dto/update-medication.dto.js'
import { PregnancyDto } from './dto/pregnancy.dto.js'

type AuthedReq = Request & { user: { id: string } }

@Controller()
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  @Post('intake/profile')
  @HttpCode(HttpStatus.OK)
  upsertProfile(@Req() req: AuthedReq, @Body() dto: IntakeProfileDto) {
    return this.intake.upsertProfile(req.user.id, dto)
  }

  @Get('me/profile')
  getProfile(@Req() req: AuthedReq) {
    return this.intake.getProfile(req.user.id)
  }

  @Post('intake/medications')
  @HttpCode(HttpStatus.CREATED)
  createMedications(
    @Req() req: AuthedReq,
    @Body() dto: IntakeMedicationsDto,
  ) {
    return this.intake.createMedications(req.user.id, dto)
  }

  @Get('me/medications')
  listMedications(
    @Req() req: AuthedReq,
    @Query('includeDiscontinued') includeDiscontinued?: string,
  ) {
    return this.intake.listMedications(
      req.user.id,
      includeDiscontinued === 'true',
    )
  }

  @Patch('me/medications/:id')
  updateMedication(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: UpdateMedicationDto,
  ) {
    return this.intake.updateMedication(req.user.id, id, dto)
  }

  @Put('me/medications')
  @HttpCode(HttpStatus.OK)
  replaceMedications(
    @Req() req: AuthedReq,
    @Body() dto: ReplaceMedicationsDto,
  ) {
    return this.intake.replaceMedications(req.user.id, dto)
  }

  @Post('me/pregnancy')
  @HttpCode(HttpStatus.OK)
  updatePregnancy(@Req() req: AuthedReq, @Body() dto: PregnancyDto) {
    return this.intake.updatePregnancy(req.user.id, dto)
  }
}
