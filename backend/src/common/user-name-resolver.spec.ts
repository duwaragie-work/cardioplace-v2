import { pickDisplayRole, type UserDisplay } from './user-name-resolver.js'

// Audit surfaces store a coarse VerifierRole (ADMIN for every admin action).
// pickDisplayRole recovers the actor's real role from their account so the
// Timeline reads "(provider)" instead of a blanket "(admin)".
describe('pickDisplayRole', () => {
  function mapOf(entries: Array<[string, string[]]>): Map<string, UserDisplay> {
    return new Map(
      entries.map(([id, roles]) => [id, { id, name: null, email: null, roles }]),
    )
  }

  it('returns the actor real role (PROVIDER) over the coarse stored ADMIN', () => {
    const map = mapOf([['u1', ['PROVIDER']]])
    expect(pickDisplayRole('u1', map, 'ADMIN')).toBe('PROVIDER')
  })

  it('prefers the most clinically specific role for a multi-role actor', () => {
    const map = mapOf([['u1', ['SUPER_ADMIN', 'PROVIDER', 'MEDICAL_DIRECTOR']]])
    expect(pickDisplayRole('u1', map, 'ADMIN')).toBe('MEDICAL_DIRECTOR')
  })

  it('keeps PATIENT for patient-authored logs', () => {
    const map = mapOf([['p1', ['PATIENT']]])
    expect(pickDisplayRole('p1', map, 'PATIENT')).toBe('PATIENT')
  })

  it('falls back to the stored role when the user cannot be resolved', () => {
    const map = mapOf([])
    expect(pickDisplayRole('gone', map, 'ADMIN')).toBe('ADMIN')
  })

  it('returns null when unresolved and no fallback is given', () => {
    expect(pickDisplayRole(null, new Map(), null)).toBeNull()
  })
})
