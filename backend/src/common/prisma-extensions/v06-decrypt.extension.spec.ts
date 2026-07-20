import { jest } from '@jest/globals'
import { decryptTree, injectSiblingSelect, V06_SIBLINGS } from './v06-decrypt.extension.js'

/**
 * Reversible stand-in for AES-256-GCM. The extension's contract is "hand the
 * envelope to decrypt, put the result in the plaintext field" — the real cipher
 * is EncryptionService's business and is covered by encryption.service.spec.ts.
 */
const fakeDecrypt = (envelope: string): string => {
  if (!envelope.startsWith('enc(')) throw new Error(`Malformed envelope: ${envelope}`)
  return envelope.slice(4, -1)
}
const enc = (plain: string): string => `enc(${plain})`

describe('V06_SIBLINGS', () => {
  it('covers the 14 V-06 columns via 12 unique sibling names', () => {
    // notesEncrypted is shared by JournalEntry / PatientMedication /
    // PatientThreshold — one rule, three columns. 12 names → 14 columns.
    expect(Object.keys(V06_SIBLINGS)).toHaveLength(12)
  })

  it('does NOT claim TotpCredential.secretEncrypted', () => {
    // It has no `secret` plaintext twin — synthesising one would invent a
    // field the schema does not have. It is MFA's, not V-06's.
    expect(V06_SIBLINGS).not.toHaveProperty('secretEncrypted')
  })
})

describe('decryptTree', () => {
  it('resolves a text sibling into its plaintext field', () => {
    const row = { id: 'j1', notes: 'stale-plaintext', notesEncrypted: enc('chest pain since Tuesday') }
    expect(decryptTree(row, fakeDecrypt)).toMatchObject({
      id: 'j1',
      notes: 'chest pain since Tuesday',
    })
  })

  it('ciphertext WINS over the plaintext column (this is the whole point)', () => {
    // If plaintext won, phase 3's DROP would silently turn every one of these
    // fields into null.
    const row = { notes: 'WRONG', notesEncrypted: enc('RIGHT') }
    expect((decryptTree(row, fakeDecrypt) as { notes: string }).notes).toBe('RIGHT')
  })

  it('JSON-decodes an otherSymptoms envelope back to an array', () => {
    const row = { otherSymptoms: [], otherSymptomsEncrypted: enc(JSON.stringify(['dizzy', 'blurred vision'])) }
    expect((decryptTree(row, fakeDecrypt) as { otherSymptoms: string[] }).otherSymptoms).toEqual([
      'dizzy',
      'blurred vision',
    ])
  })

  it('reads an encryptJson([]) envelope as []', () => {
    // New rows get a "[]" envelope...
    const row = { otherSymptoms: [], otherSymptomsEncrypted: enc('[]') }
    expect((decryptTree(row, fakeDecrypt) as { otherSymptoms: string[] }).otherSymptoms).toEqual([])
  })

  it('reads a NULL json sibling as [] once the plaintext column is gone', () => {
    // ...but the backfill SKIPS empty arrays (v06-backfill-encryption.ts:216-219),
    // so an always-empty row keeps a NULL sibling forever. Post-phase-3 that must
    // still read as [], not undefined.
    const row = { id: 'j1', otherSymptomsEncrypted: null }
    expect((decryptTree(row, fakeDecrypt) as { otherSymptoms: string[] }).otherSymptoms).toEqual([])
  })

  it('leaves a NULL json sibling alone while the plaintext column still exists', () => {
    // During the bake window the plaintext IS the right answer for those rows.
    const row = { otherSymptoms: ['dizzy'], otherSymptomsEncrypted: null }
    expect((decryptTree(row, fakeDecrypt) as { otherSymptoms: string[] }).otherSymptoms).toEqual(['dizzy'])
  })

  it('maps over a findMany array', () => {
    const rows = [
      { notes: 'x', notesEncrypted: enc('first') },
      { notes: 'y', notesEncrypted: enc('second') },
    ]
    expect(decryptTree(rows, fakeDecrypt)).toMatchObject([{ notes: 'first' }, { notes: 'second' }])
  })

  it('decrypts through a nested include — the gap a per-model hook would leave', () => {
    // Prisma query extensions never fire for nested relation loads, so
    // `deviationAlert.include.journalEntry` would keep serving plaintext under
    // a `query.journalEntry` hook. The structural walk is what covers it.
    const alert = {
      id: 'a1',
      journalEntry: { id: 'j1', notes: 'stale', notesEncrypted: enc('real note') },
    }
    expect(decryptTree(alert, fakeDecrypt)).toMatchObject({
      journalEntry: { notes: 'real note' },
    })
  })

  it('decrypts an array of nested relations', () => {
    const session = {
      id: 's1',
      conversations: [
        { userMessage: 'stale', userMessageEncrypted: enc('my head hurts') },
        { userMessage: 'stale', userMessageEncrypted: enc('better today') },
      ],
    }
    expect(decryptTree(session, fakeDecrypt)).toMatchObject({
      conversations: [{ userMessage: 'my head hurts' }, { userMessage: 'better today' }],
    })
  })

  it('passes through counts, nulls and aggregates untouched', () => {
    expect(decryptTree(7, fakeDecrypt)).toBe(7)
    expect(decryptTree(null, fakeDecrypt)).toBeNull()
    expect(decryptTree({ _count: { id: 3 }, _avg: { systolic: 128 } }, fakeDecrypt)).toEqual({
      _count: { id: 3 },
      _avg: { systolic: 128 },
    })
  })

  it('does not walk into Date instances', () => {
    const measuredAt = new Date('2026-07-17T10:00:00Z')
    const out = decryptTree({ id: 'j1', measuredAt }, fakeDecrypt) as { measuredAt: Date }
    expect(out.measuredAt).toBeInstanceOf(Date)
    expect(out.measuredAt.toISOString()).toBe('2026-07-17T10:00:00.000Z')
  })

  it('ignores an unknown *Encrypted key (e.g. TotpCredential.secretEncrypted)', () => {
    const row = { id: 't1', secretEncrypted: enc('JBSWY3DP') }
    const out = decryptTree(row, fakeDecrypt) as Record<string, unknown>
    expect(out).not.toHaveProperty('secret')
    expect(out.secretEncrypted).toBe(enc('JBSWY3DP'))
  })

  describe('decrypt failure', () => {
    it('falls back to the plaintext column and warns when plaintext is present', () => {
      // Bake window: a bad MFA_ENCRYPTION_KEY must not take clinical reads
      // down — the plaintext holds identical bytes, so this degrades to
      // "no worse than phase 1".
      const onWarn = jest.fn()
      const row = { notes: 'the same bytes', notesEncrypted: 'GARBAGE' }
      const out = decryptTree(row, fakeDecrypt, { onWarn }) as { notes: string }
      expect(out.notes).toBe('the same bytes')
      expect(onWarn).toHaveBeenCalledWith('notesEncrypted', expect.any(Error))
    })

    it('RETHROWS when the plaintext column is gone (post phase 3)', () => {
      // No fallback exists. Silently serving `undefined` for a clinical note
      // would hide it from a clinician — failing loudly is the safer error.
      const row = { id: 'j1', notesEncrypted: 'GARBAGE' }
      expect(() => decryptTree(row, fakeDecrypt)).toThrow('Malformed envelope')
    })
  })

  it('strips only the siblings it was told to strip', () => {
    const row = { id: 's1', summary: 'stale', summaryEncrypted: enc('real summary') }
    const out = decryptTree(row, fakeDecrypt, { strip: ['summaryEncrypted'] }) as Record<string, unknown>
    expect(out.summary).toBe('real summary')
    expect(out).not.toHaveProperty('summaryEncrypted')
  })

  it('keeps siblings that were naturally selected', () => {
    // No `select` → Prisma returns all scalars and the declared type includes
    // the sibling. Deleting it would violate that type.
    const row = { id: 's1', summary: 'stale', summaryEncrypted: enc('real summary') }
    const out = decryptTree(row, fakeDecrypt) as Record<string, unknown>
    expect(out.summaryEncrypted).toBe(enc('real summary'))
  })

  it('does not mutate the input record', () => {
    const row = { notes: 'original', notesEncrypted: enc('decrypted') }
    decryptTree(row, fakeDecrypt)
    expect(row.notes).toBe('original')
  })
})

describe('injectSiblingSelect', () => {
  it('injects the sibling when a select asks for the plaintext', () => {
    // The five real sites today are all Session.title/summary.
    const { args, injected } = injectSiblingSelect('session', { select: { summary: true } })
    expect(args).toEqual({ select: { summary: true, summaryEncrypted: true } })
    expect(injected).toEqual(['summaryEncrypted'])
  })

  it('injects every matching sibling in a multi-field select', () => {
    const { args, injected } = injectSiblingSelect('session', {
      select: { id: true, title: true, summary: true, userId: true },
    })
    expect(args).toEqual({
      select: { id: true, title: true, summary: true, userId: true, titleEncrypted: true, summaryEncrypted: true },
    })
    expect(injected).toEqual(['titleEncrypted', 'summaryEncrypted'])
  })

  it('preserves other args (where / take / orderBy)', () => {
    const { args } = injectSiblingSelect('session', {
      where: { userId: 'u1' },
      take: 10,
      select: { summary: true },
    })
    expect(args).toMatchObject({ where: { userId: 'u1' }, take: 10 })
  })

  it('is a no-op with no select — Prisma returns all scalars anyway', () => {
    const input = { where: { userId: 'u1' } }
    const { args, injected } = injectSiblingSelect('session', input)
    expect(args).toBe(input)
    expect(injected).toEqual([])
  })

  it('is a no-op for a model with no V-06 pairs', () => {
    const input = { select: { title: true } }
    const { args, injected } = injectSiblingSelect('article', input)
    // Blindly injecting `titleEncrypted` on a model without the column would
    // make Prisma throw — this is why injection is model-aware.
    expect(args).toBe(input)
    expect(injected).toEqual([])
  })

  it('does not re-inject a sibling the caller already selected', () => {
    const { injected } = injectSiblingSelect('session', {
      select: { summary: true, summaryEncrypted: true },
    })
    expect(injected).toEqual([])
  })

  it('ignores a plaintext field the select excludes (false)', () => {
    const { injected } = injectSiblingSelect('session', { select: { id: true, summary: false } })
    expect(injected).toEqual([])
  })
})
