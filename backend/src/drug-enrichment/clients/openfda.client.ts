import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { PregnancyInfo } from '../drug-enrichment.types.js'

const BASE = 'https://api.fda.gov/drug/label.json'
const TIMEOUT_MS = 5000

export interface OpenFdaResult {
  indication: string | null
  pregnancy: PregnancyInfo | null
}

@Injectable()
export class OpenFdaClient {
  private readonly logger = new Logger(OpenFdaClient.name)

  constructor(private readonly config: ConfigService) {}

  // Search by generic_name (lowercased canonical from RxNorm). Spike showed
  // openfda.rxcui field is too sparse to be useful as primary key.
  async labelByGenericName(genericName: string): Promise<OpenFdaResult | null> {
    const apiKey = this.config.get<string>('OPENFDA_API_KEY')
    const params = new URLSearchParams({
      search: `openfda.generic_name:"${genericName.toLowerCase()}"`,
      limit: '1',
    })
    if (apiKey) params.set('api_key', apiKey)

    const url = `${BASE}?${params.toString()}`
    const json = await this.fetchJson(url)
    const result = (json as { results?: Array<Record<string, unknown>> })?.results?.[0]
    if (!result) return null

    const indicationArr = result['indications_and_usage'] as string[] | undefined
    const pregnancyArr = result['pregnancy'] as string[] | undefined
    const openfdaMeta = result['openfda'] as Record<string, unknown> | undefined
    const categoryArr = openfdaMeta?.['pregnancy_category'] as string[] | undefined

    return {
      indication: indicationArr?.[0]?.trim() || null,
      pregnancy: pregnancyArr?.[0]
        ? { category: categoryArr?.[0] ?? null, warning: pregnancyArr[0] }
        : null,
    }
  }

  private async fetchJson(url: string): Promise<unknown> {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'cardioplace-drug-enrichment/1.0' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (r.status === 404) return null
      if (!r.ok) {
        this.logger.warn(`OpenFDA ${url} -> ${r.status}`)
        return null
      }
      return await r.json()
    } catch (err) {
      this.logger.warn(`OpenFDA ${url} failed: ${(err as Error).message}`)
      return null
    }
  }
}
