// Task 3 — Alert-Resolution-Time SLA Report service.
//
// Wraps the three admin/reports/sla endpoints. Month-based, like the Monthly
// report. Reuses the practice list + month helpers from reports.service.
//
// Backend controller: backend/src/reports/sla.controller.ts
//   GET /api/admin/reports/sla?practiceId=&month=YYYY-MM
//   GET /api/admin/reports/sla.csv?...
//   GET /api/admin/reports/sla.pdf?...

import type { SlaReport } from '@cardioplace/shared'
import { fetchWithAuth, getAccessToken } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

export type { SlaReport } from '@cardioplace/shared'
export { isSlaExemptTier, SLA_NOT_APPLICABLE_LABEL } from '@cardioplace/shared'
export {
  listReportPractices,
  type ReportPractice,
} from './reports.service'
export {
  defaultPreviousMonth,
  formatMonthLabel,
  formatDuration,
  formatTierLabel,
} from './reports.service'

interface SlaResponse {
  statusCode: number
  message: string
  data: SlaReport
}

export interface SlaReportQuery {
  practiceId?: string
  month?: string
}

function buildQuery(params: SlaReportQuery): string {
  const qs = new URLSearchParams()
  if (params.practiceId) qs.set('practiceId', params.practiceId)
  if (params.month) qs.set('month', params.month)
  return qs.toString() ? `?${qs.toString()}` : ''
}

async function unwrapOrThrow<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(
      (err && typeof err === 'object' && 'message' in err && err.message) ||
        `${fallback}: ${res.status}`,
    )
  }
  return (await res.json()) as T
}

export async function getSlaReport(query: SlaReportQuery = {}): Promise<SlaReport> {
  const res = await fetchWithAuth(`${API}/api/admin/reports/sla${buildQuery(query)}`, {
    cache: 'no-store',
  })
  const json = await unwrapOrThrow<SlaResponse>(res, 'Could not load SLA report')
  return json.data
}

// ─── Downloads ─────────────────────────────────────────────────────────────

async function downloadFile(url: string, filenameFallback: string): Promise<void> {
  const token = getAccessToken()
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  if (!res.ok) {
    let msg = `Download failed: ${res.status}`
    try {
      const err = await res.json()
      if (err && typeof err === 'object' && 'message' in err) msg = String(err.message)
    } catch {
      // keep status-based message
    }
    throw new Error(msg)
  }
  let filename = filenameFallback
  const cd = res.headers.get('Content-Disposition') ?? ''
  const match = /filename="?([^";]+)"?/i.exec(cd)
  if (match && match[1]) filename = match[1]

  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function downloadSlaCsv(query: SlaReportQuery = {}): Promise<void> {
  await downloadFile(
    `${API}/api/admin/reports/sla.csv${buildQuery(query)}`,
    `cardioplace_sla_${query.month ?? 'latest'}.csv`,
  )
}

export async function downloadSlaPdf(query: SlaReportQuery = {}): Promise<void> {
  await downloadFile(
    `${API}/api/admin/reports/sla.pdf${buildQuery(query)}`,
    `cardioplace_sla_${query.month ?? 'latest'}.pdf`,
  )
}
