import { Injectable, Logger } from '@nestjs/common'

const BASE = 'https://rxnav.nlm.nih.gov/REST'
const TIMEOUT_MS = 5000

export interface RxNormHit {
  rxcui: string
  canonicalName: string
}

@Injectable()
export class RxNormClient {
  private readonly logger = new Logger(RxNormClient.name)

  async approximateTerm(rawDrugName: string): Promise<RxNormHit | null> {
    const url = `${BASE}/approximateTerm.json?term=${encodeURIComponent(rawDrugName)}&maxEntries=3`
    const json = (await this.fetchJson(url)) as
      | { approximateGroup?: { candidate?: Array<{ rxcui?: string | number; name?: string }> } }
      | null
    const top = json?.approximateGroup?.candidate?.[0]
    if (!top?.rxcui) return null

    const canonicalName = top.name ?? (await this.rxNormName(String(top.rxcui)))
    if (!canonicalName) return null
    return { rxcui: String(top.rxcui), canonicalName: String(canonicalName) }
  }

  private async rxNormName(rxcui: string): Promise<string | null> {
    const url = `${BASE}/rxcui/${encodeURIComponent(rxcui)}/property.json?propName=RxNorm%20Name`
    const json = (await this.fetchJson(url)) as
      | { propConceptGroup?: { propConcept?: Array<{ propValue?: string }> } }
      | null
    const value = json?.propConceptGroup?.propConcept?.[0]?.propValue
    return typeof value === 'string' ? value : null
  }

  private async fetchJson(url: string): Promise<unknown> {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'cardioplace-drug-enrichment/1.0' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!r.ok) {
        this.logger.warn(`RxNorm ${url} -> ${r.status}`)
        return null
      }
      return await r.json()
    } catch (err) {
      this.logger.warn(`RxNorm ${url} failed: ${(err as Error).message}`)
      return null
    }
  }
}
