// Wave B (Handoff 5) — W9 regression lock for the "Reading new model + custom
// symptom input" change (c51264a). The patient check-in step 5 / readings edit
// modal now accepts free-text notes + patient-typed custom symptom chips, all
// bounded by the shared journal-limits constants so the client clamp and the
// server @MaxLength guard can't drift. These tests lock both the constant
// values AND the DTO enforcement.

import 'reflect-metadata' // class-validator decorators need it; standalone spec (no Nest import) must load it explicitly
import { validate } from 'class-validator'
import {
  JOURNAL_NOTE_MAX_LENGTH,
  JOURNAL_CUSTOM_SYMPTOM_MAX_LENGTH,
  JOURNAL_CUSTOM_SYMPTOMS_MAX_COUNT,
} from '@cardioplace/shared'
import { CreateJournalEntryDto } from './create-journal-entry.dto.js'

// measuredAt is the only required field and must be recent (IsMeasuredAtReasonable).
function baseDto(over: Partial<CreateJournalEntryDto> = {}): CreateJournalEntryDto {
  return Object.assign(new CreateJournalEntryDto(), {
    measuredAt: new Date().toISOString(),
    ...over,
  })
}

describe('journal-limits constants (W9 lock)', () => {
  it('hold the agreed values — a silent change here breaks client/server parity', () => {
    expect(JOURNAL_NOTE_MAX_LENGTH).toBe(1000)
    expect(JOURNAL_CUSTOM_SYMPTOM_MAX_LENGTH).toBe(120)
    expect(JOURNAL_CUSTOM_SYMPTOMS_MAX_COUNT).toBe(20)
  })
})

describe('CreateJournalEntryDto — journal free-text limits (W9)', () => {
  it('accepts a minimal valid entry (measuredAt only)', async () => {
    const errors = await validate(baseDto())
    expect(errors).toHaveLength(0)
  })

  it('accepts notes exactly at JOURNAL_NOTE_MAX_LENGTH', async () => {
    const errors = await validate(baseDto({ notes: 'n'.repeat(JOURNAL_NOTE_MAX_LENGTH) }))
    expect(errors).toHaveLength(0)
  })

  it('rejects notes longer than JOURNAL_NOTE_MAX_LENGTH', async () => {
    const errors = await validate(baseDto({ notes: 'n'.repeat(JOURNAL_NOTE_MAX_LENGTH + 1) }))
    expect(errors.some((e) => e.property === 'notes')).toBe(true)
  })

  it('accepts the max number of custom symptom chips', async () => {
    const chips = Array.from({ length: JOURNAL_CUSTOM_SYMPTOMS_MAX_COUNT }, (_v, i) => `chip ${i}`)
    const errors = await validate(baseDto({ otherSymptoms: chips }))
    expect(errors).toHaveLength(0)
  })

  it('rejects more than JOURNAL_CUSTOM_SYMPTOMS_MAX_COUNT chips', async () => {
    const chips = Array.from({ length: JOURNAL_CUSTOM_SYMPTOMS_MAX_COUNT + 1 }, (_v, i) => `chip ${i}`)
    const errors = await validate(baseDto({ otherSymptoms: chips }))
    expect(errors.some((e) => e.property === 'otherSymptoms')).toBe(true)
  })

  it('accepts a chip exactly at JOURNAL_CUSTOM_SYMPTOM_MAX_LENGTH', async () => {
    const errors = await validate(
      baseDto({ otherSymptoms: ['x'.repeat(JOURNAL_CUSTOM_SYMPTOM_MAX_LENGTH)] }),
    )
    expect(errors).toHaveLength(0)
  })

  it('rejects a chip longer than JOURNAL_CUSTOM_SYMPTOM_MAX_LENGTH', async () => {
    const errors = await validate(
      baseDto({ otherSymptoms: ['x'.repeat(JOURNAL_CUSTOM_SYMPTOM_MAX_LENGTH + 1)] }),
    )
    expect(errors.some((e) => e.property === 'otherSymptoms')).toBe(true)
  })
})
