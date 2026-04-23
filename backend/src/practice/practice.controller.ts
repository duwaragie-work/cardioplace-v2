import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import { Roles } from '../auth/decorators/roles.decorator.js'
import { UserRole } from '../generated/prisma/enums.js'
import { CreatePracticeDto } from './dto/create-practice.dto.js'
import { UpdatePracticeDto } from './dto/update-practice.dto.js'
import { PracticeService } from './practice.service.js'

@Controller('admin/practices')
@Roles(UserRole.SUPER_ADMIN, UserRole.MEDICAL_DIRECTOR, UserRole.HEALPLACE_OPS)
export class PracticeController {
  constructor(private readonly service: PracticeService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreatePracticeDto) {
    return this.service.create(dto)
  }

  @Get()
  list() {
    return this.service.list()
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id)
  }

  @Get(':id/staff')
  listStaff(@Param('id') id: string) {
    return this.service.listStaff(id)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePracticeDto) {
    return this.service.update(id, dto)
  }
}
