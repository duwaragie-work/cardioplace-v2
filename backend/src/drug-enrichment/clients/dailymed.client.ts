import { Injectable, Logger } from '@nestjs/common'

const BASE = 'https://dailymed.nlm.nih.gov/dailymed/services/v2'
const TIMEOUT_MS = 5000

@Injectable()
export class DailyMedClient {
  private readonly logger = new Logger(DailyMedClient.name)

  // Returns the first image URL (skipping PDFs) for the most recent SPL
  // matching this drug name. NDC routing is intentionally skipped — the spike
  // showed name-based search has 100% coverage on cardio top-30 while NDC
  // lookups via RxNorm return empty for many SCDs.
  async firstImageUrlForDrugName(drugName: string): Promise<string | null> {
    const splUrl = `${BASE}/spls.json?drug_name=${encodeURIComponent(drugName)}&pagesize=3`
    const splJson = await this.fetchJson(splUrl)
    const setId = (splJson as { data?: Array<{ setid?: string }> })?.data?.[0]?.setid
    if (!setId) return null

    const mediaUrl = `${BASE}/spls/${encodeURIComponent(setId)}/media.json`
    const mediaJson = await this.fetchJson(mediaUrl)
    const media = (mediaJson as { data?: { media?: Array<{ mime_type?: string; url?: string }> } })
      ?.data?.media

    if (!Array.isArray(media)) return null
    const imageEntry = media.find((m) => typeof m.mime_type === 'string' && /^image\//i.test(m.mime_type))
    return imageEntry?.url ?? null
  }

  private async fetchJson(url: string): Promise<unknown> {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'cardioplace-drug-enrichment/1.0' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!r.ok) {
        this.logger.warn(`DailyMed ${url} -> ${r.status}`)
        return null
      }
      return await r.json()
    } catch (err) {
      this.logger.warn(`DailyMed ${url} failed: ${(err as Error).message}`)
      return null
    }
  }
}
