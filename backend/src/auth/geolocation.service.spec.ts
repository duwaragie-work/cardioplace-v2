import { jest } from '@jest/globals'
import { ConfigService } from '@nestjs/config'
import { Test, TestingModule } from '@nestjs/testing'
import { GeolocationService } from './geolocation.service.js'

describe('GeolocationService', () => {
  let service: GeolocationService

  async function buildService(salt: string | undefined) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeolocationService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'AUTH_GEOHASH_SALT' ? salt : undefined,
            ),
          },
        },
      ],
    }).compile()
    return module.get<GeolocationService>(GeolocationService)
  }

  beforeEach(async () => {
    service = await buildService('test-salt')
  })

  describe('computeGeohash', () => {
    it('returns null for null/undefined/empty', () => {
      expect(service.computeGeohash(null)).toBeNull()
      expect(service.computeGeohash(undefined)).toBeNull()
      expect(service.computeGeohash('')).toBeNull()
      expect(service.computeGeohash('   ')).toBeNull()
    })

    it('returns null for malformed IPs', () => {
      expect(service.computeGeohash('not-an-ip')).toBeNull()
      expect(service.computeGeohash('1.2.3')).toBeNull()
      expect(service.computeGeohash('256.1.1.1')).toBeNull()
      expect(service.computeGeohash('1.2.3.04')).toBeNull()
    })

    it('IPv4 — same /24 subnet maps to the same hash, different /24 maps to a different hash', () => {
      const a1 = service.computeGeohash('192.168.1.10')
      const a2 = service.computeGeohash('192.168.1.250')
      const b = service.computeGeohash('192.168.2.10')
      expect(a1).toBeTruthy()
      expect(a1).toBe(a2) // same /24 → same hash
      expect(a1).not.toBe(b) // different /24 → different hash
    })

    it('IPv6 — same /48 prefix maps to same hash, different prefix differs', () => {
      const a = service.computeGeohash('2001:db8:abcd:1::1')
      const b = service.computeGeohash('2001:db8:abcd:2::1')
      const c = service.computeGeohash('2001:db8:beef:1::1')
      expect(a).toBe(b) // same /48
      expect(a).not.toBe(c)
    })

    it('strips IPv6 zone suffix before hashing', () => {
      expect(service.computeGeohash('fe80::1%eth0')).toBe(service.computeGeohash('fe80::1'))
    })

    it('IPv6 v4-mapped routes through IPv4 subnet logic', () => {
      const mapped = service.computeGeohash('::ffff:192.168.1.10')
      const plain = service.computeGeohash('192.168.1.10')
      expect(mapped).toBe(plain)
    })

    it('returns a stable 12-char hex string', () => {
      const out = service.computeGeohash('192.168.1.10')
      expect(out).toMatch(/^[0-9a-f]{12}$/)
    })

    it('rotating the salt invalidates prior geohashes', async () => {
      const otherSalt = await buildService('different-salt')
      expect(otherSalt.computeGeohash('192.168.1.10')).not.toBe(
        service.computeGeohash('192.168.1.10'),
      )
    })
  })

  describe('lookupCountry', () => {
    it('returns UNKNOWN as a stub — wire a real GeoIP DB later', () => {
      expect(service.lookupCountry('1.2.3.4')).toBe('UNKNOWN')
      expect(service.lookupCountry(null)).toBe('UNKNOWN')
    })
  })

  describe('isAnomaly', () => {
    it('null stored or null current → not an anomaly', () => {
      expect(service.isAnomaly(null, 'a')).toBe(false)
      expect(service.isAnomaly('a', null)).toBe(false)
      expect(service.isAnomaly(null, null)).toBe(false)
    })

    it('same non-null pair → not an anomaly', () => {
      expect(service.isAnomaly('abc', 'abc')).toBe(false)
    })

    it('different non-null pair → anomaly', () => {
      expect(service.isAnomaly('abc', 'def')).toBe(true)
    })
  })
})
