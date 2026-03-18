import { PartialType } from '@nestjs/mapped-types'
import { CreateJournalEntryDto } from './create-journal-entry.dto.js'

export class UpdateJournalEntryDto extends PartialType(CreateJournalEntryDto) {}
