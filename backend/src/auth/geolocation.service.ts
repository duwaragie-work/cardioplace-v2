import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash } from 'crypto'

/**
 * June 2026 — geolocation anomaly support for AuthSession audit trail
 * (Manisha 2026-06-12 Doc 2 Q1, audit-only, never blocks).
 *
 * Two cheap operations:
 *   • `computeGeohash(ip)`  — privacy-preserving locator. Truncates IPv4
 *     to its /24 subnet and IPv6 to its /48 prefix, then SHA-256 hashes
 *     the result with a server-side salt and returns 12 hex chars. NOT
 *     a true geo-grid hash; sufficient for "did the network region
 *     change?" without retaining raw IP outside of `AuthSession.ipAddress`.
 *   • `lookupCountry(ip)`  — returns an ISO-3166 alpha-2 country code
 *     when known, or 'UNKNOWN'. Default impl is a stub so the audit
 *     pipeline ships now; swap in a real GeoIP DB later without touching
 *     callers.
 *
 * The salt is read from `AUTH_GEOHASH_SALT` (set in `.env`). If unset, a
 * static fallback is used and a one-time warning is emitted at boot —
 * production should always have a real salt. Rotating the salt invalidates
 * prior geohashes; the next rotation per session will log an anomaly,
 * which is expected and harmless (audit-only).
 */
@Injectable()
export class GeolocationService {
  private readonly logger = new Logger(GeolocationService.name)
  private readonly salt: string
  private readonly DEFAULT_SALT = 'cardioplace-geohash-default-do-not-use-in-prod'

  constructor(private readonly config: ConfigService) {
    const configured = this.config.get<string>('AUTH_GEOHASH_SALT')?.trim()
    if (!configured) {
      this.logger.warn(
        'AUTH_GEOHASH_SALT not set — using default. Set it in prod so rotating salt is the only thing that invalidates geohashes.',
      )
      this.salt = this.DEFAULT_SALT
    } else {
      this.salt = configured
    }
  }

  /**
   * Privacy-preserving locator hash. Returns null if the IP can't be
   * parsed (e.g. raw header value), so callers can skip the anomaly
   * check rather than silently storing junk.
   */
  computeGeohash(ip: string | null | undefined): string | null {
    if (!ip) return null
    const normalized = ip.trim()
    if (normalized.length === 0) return null

    const subnet = this.subnetOf(normalized)
    if (!subnet) return null

    return createHash('sha256')
      .update(`${this.salt}|${subnet}`)
      .digest('hex')
      .slice(0, 12)
  }

  /**
   * Country lookup stub — wire in a real GeoIP DB later. Returns
   * 'UNKNOWN' so audit logs stay schemaful; an unknown country is not
   * an anomaly (different unknowns shouldn't flag).
   */
  lookupCountry(_ip: string | null | undefined): string {
    return 'UNKNOWN'
  }

  /**
   * Decide whether the new geohash represents a region change vs the
   * stored one. Two nulls or one null = no anomaly. Both non-null and
   * different = anomaly.
   */
  isAnomaly(stored: string | null | undefined, current: string | null | undefined): boolean {
    if (!stored || !current) return false
    return stored !== current
  }

  private subnetOf(ip: string): string | null {
    // IPv6 first — has colons.
    if (ip.includes(':')) {
      // Strip zone suffix (e.g. fe80::1%eth0)
      const bare = ip.split('%')[0]
      // /48 = first three hextets. ::ffff:1.2.3.4 (v4-mapped) gets handled below.
      const v4MappedMatch = bare.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i)
      if (v4MappedMatch) return this.ipv4Subnet(v4MappedMatch[1])
      const hextets = bare.split(':').filter(Boolean).slice(0, 3)
      if (hextets.length === 0) return null
      return `v6:${hextets.join(':').toLowerCase()}::/48`
    }
    return this.ipv4Subnet(ip)
  }

  private ipv4Subnet(ip: string): string | null {
    const parts = ip.split('.')
    if (parts.length !== 4) return null
    const valid = parts.every((p) => {
      const n = parseInt(p, 10)
      return Number.isInteger(n) && n >= 0 && n <= 255 && String(n) === p
    })
    if (!valid) return null
    return `v4:${parts[0]}.${parts[1]}.${parts[2]}.0/24`
  }
}
