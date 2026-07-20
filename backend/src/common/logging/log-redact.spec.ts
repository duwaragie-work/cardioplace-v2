import {
  argKeys,
  phiDebugEnabled,
  redactText,
  situationHash,
} from './log-redact.js'

// V-05 — the whole point of these helpers is that clinical text never reaches
// stdout. The highest-consequence assertions here are the production ones: if
// `CHAT_VOICE_DEBUG_PHI=1` is ever honoured in production, the HIGH finding is
// re-opened silently.

describe('log-redact (V-05 stdout PHI helpers)', () => {
  const originalEnv = process.env.NODE_ENV
  const originalFlag = process.env.CHAT_VOICE_DEBUG_PHI

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalEnv
    if (originalFlag === undefined) delete process.env.CHAT_VOICE_DEBUG_PHI
    else process.env.CHAT_VOICE_DEBUG_PHI = originalFlag
  })

  describe('phiDebugEnabled — double gate', () => {
    it('is off by default (no flag)', () => {
      process.env.NODE_ENV = 'development'
      delete process.env.CHAT_VOICE_DEBUG_PHI
      expect(phiDebugEnabled()).toBe(false)
    })

    it('is on in development with the flag', () => {
      process.env.NODE_ENV = 'development'
      process.env.CHAT_VOICE_DEBUG_PHI = '1'
      expect(phiDebugEnabled()).toBe(true)
    })

    it('IGNORES the flag in production (a flag that can be set in prod is not a control)', () => {
      process.env.NODE_ENV = 'production'
      process.env.CHAT_VOICE_DEBUG_PHI = '1'
      expect(phiDebugEnabled()).toBe(false)
    })
  })

  describe('redactText', () => {
    it('reports length only, never the text', () => {
      process.env.NODE_ENV = 'production'
      process.env.CHAT_VOICE_DEBUG_PHI = '1'
      const text = 'crushing chest pain radiating to left arm'
      const out = redactText(text)
      expect(out).toBe(`[${text.length} chars]`)
      expect(out).not.toContain('chest pain')
    })

    it('handles null without leaking a stack or "undefined"', () => {
      process.env.NODE_ENV = 'production'
      expect(redactText(null)).toBe('[null]')
    })

    it('appends the text only when the dev gate is open', () => {
      process.env.NODE_ENV = 'development'
      process.env.CHAT_VOICE_DEBUG_PHI = '1'
      expect(redactText('dizzy')).toBe('[5 chars] dizzy')
    })
  })

  describe('argKeys', () => {
    it('emits keys, never values — the JSON.stringify(toolArgs) replacement', () => {
      process.env.NODE_ENV = 'production'
      process.env.CHAT_VOICE_DEBUG_PHI = '1'
      const out = argKeys({ systolicBP: 184, diastolicBP: 121, symptoms: ['chestPain'] })

      expect(out).toBe('keys=[systolicBP,diastolicBP,symptoms]')
      // The actual clinical values must be absent.
      expect(out).not.toContain('184')
      expect(out).not.toContain('121')
      expect(out).not.toContain('chestPain')
    })

    it('tolerates null / non-objects', () => {
      process.env.NODE_ENV = 'production'
      expect(argKeys(null)).toBe('keys=[]')
      expect(argKeys(undefined)).toBe('keys=[]')
      expect(argKeys('nope')).toBe('keys=[]')
    })

    it('includes values only when the dev gate is open', () => {
      process.env.NODE_ENV = 'development'
      process.env.CHAT_VOICE_DEBUG_PHI = '1'
      expect(argKeys({ systolicBP: 184 })).toContain('args={"systolicBP":184}')
    })
  })

  describe('situationHash', () => {
    it('is stable for the same input (so an investigator can correlate)', () => {
      const a = situationHash('severe chest pain')
      const b = situationHash('severe chest pain')
      expect(a).toBe(b)
      expect(a).toMatch(/^sha256:[0-9a-f]{8}$/)
    })

    it('does not disclose the narrative', () => {
      const out = situationHash('severe chest pain, cannot breathe')
      expect(out).not.toContain('chest')
      expect(out).not.toContain('breathe')
    })

    it('differs for different input', () => {
      expect(situationHash('chest pain')).not.toBe(situationHash('headache'))
    })

    it('handles null', () => {
      expect(situationHash(null)).toBe('sha256:none')
    })
  })
})
