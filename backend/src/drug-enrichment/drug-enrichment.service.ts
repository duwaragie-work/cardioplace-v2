import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GeminiService } from '../gemini/gemini.service.js'
import { DailyMedClient } from './clients/dailymed.client.js'
import { OpenFdaClient } from './clients/openfda.client.js'
import { RxNormClient } from './clients/rxnorm.client.js'
import type { DrugEnrichment } from './drug-enrichment.types.js'

const CACHE_MAX = 500
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000 // 1 day for misses
const POSITIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days for hits

interface CacheEntry {
  value: DrugEnrichment | null
  expiresAt: number
}

@Injectable()
export class DrugEnrichmentService {
  private readonly logger = new Logger(DrugEnrichmentService.name)
  private readonly cache = new Map<string, CacheEntry>()
  private readonly enabled: boolean

  constructor(
    config: ConfigService,
    private readonly rxnorm: RxNormClient,
    private readonly dailymed: DailyMedClient,
    private readonly openfda: OpenFdaClient,
    private readonly gemini: GeminiService,
  ) {
    this.enabled = (config.get<string>('DRUG_ENRICHMENT_ENABLED') ?? 'true').toLowerCase() !== 'false'
  }

  /**
   * Resolve a freeform drug name into canonical name + pill image URL +
   * plain-language description by chaining RxNorm -> DailyMed/OpenFDA in
   * parallel -> Gemini simplification. Returns null when RxNorm doesn't
   * recognise the drug (caller persists raw text only).
   *
   * Cached in an in-memory LRU keyed by lowercased name + locale; resets on
   * process restart. No DB cache by design (intentional minimum-schema scope).
   */
  async enrich(rawDrugName: string, locale: string = 'en'): Promise<DrugEnrichment | null> {
    if (!this.enabled) return null
    const trimmed = rawDrugName.trim()
    if (!trimmed) return null

    const key = `${trimmed.toLowerCase()}::${locale}`
    const cached = this.readCache(key)
    if (cached) return cached.value

    let payload: DrugEnrichment | null = null
    try {
      const hit = await this.rxnorm.approximateTerm(trimmed)
      if (hit) {
        const [imageUrl, fda] = await Promise.all([
          this.dailymed.firstImageUrlForDrugName(hit.canonicalName),
          this.openfda.labelByGenericName(hit.canonicalName),
        ])
        const plainLanguageDescription = fda?.indication
          ? await this.gemini.simplifyDrugIndication(fda.indication, locale)
          : null

        payload = {
          rxcui: hit.rxcui,
          canonicalDrugName: hit.canonicalName,
          pillImageUrl: imageUrl,
          plainLanguageDescription,
          pregnancy: fda?.pregnancy ?? null,
          source: 'rxnorm+dailymed+openfda',
        }
      }
    } catch (err) {
      this.logger.warn(`enrich(${trimmed}) failed: ${(err as Error).message}`)
    }

    this.writeCache(key, payload)
    return payload
  }

  private readCache(key: string): CacheEntry | null {
    const entry = this.cache.get(key)
    if (!entry) return null
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key)
      return null
    }
    // Refresh LRU position
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry
  }

  private writeCache(key: string, value: DrugEnrichment | null): void {
    if (this.cache.size >= CACHE_MAX) {
      // delete oldest (Map preserves insertion order)
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    const ttl = value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS
    this.cache.set(key, { value, expiresAt: Date.now() + ttl })
  }
}
