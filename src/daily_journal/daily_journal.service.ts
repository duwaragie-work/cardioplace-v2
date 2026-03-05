import { Injectable } from '@nestjs/common';

@Injectable()
export class DailyJournalService {
  getHello() {
    return "Hello World";
  }

  findAll() {
    return `This action returns all dailyJournal`;
  }

  findOne(id: number) {
    return `This action returns a #${id} dailyJournal`;
  }

}
