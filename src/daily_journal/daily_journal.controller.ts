import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';

@Controller('daily-journal')
export class DailyJournalController {

  @Get('')
  getAllJournals() {
    return "Hello World";
  }
}
