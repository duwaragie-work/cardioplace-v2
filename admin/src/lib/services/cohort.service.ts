// Task 4 — Per-Condition Cohort Report service.
//
// Wraps the three admin/reports/cohorts endpoints. Month-based, like the
// Monthly + SLA reports.
//
// Backend controller: backend/src/reports/cohort.controller.ts
//   GET /api/admin/reports/cohorts?practiceId=&month=YYYY-MM
//   GET /api/admin/reports/cohorts.csv?...
//   GET /api/admin/reports/cohorts.pdf?...

import type { CohortReport } from '@cardioplace/shared'
import { fetchWithAuth, getAccessToken } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

export type { CohortReport } from '@cardioplace/shared'
export {
  listReportPractices,
  type ReportPractice,
} from './reports.service'
export { defaultPreviousMonth, formatMonthLabel } from './reports.service'

interface CohortResponse {
  statusCode: number
  message: string
  data: CohortReport
}

export interface CohortReportQuery {
  practiceId?: string
  month?: string
}

function buildQuery(params: CohortReportQuery): string {
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

export async function getCohortReport(
  query: CohortReportQuery = {},
): Promise<CohortReport> {
  const res = await fetchWithAuth(`${API}/api/admin/reports/cohorts${buildQuery(query)}`, {
    cache: 'no-store',
  })
  const json = await unwrapOrThrow<CohortResponse>(res, 'Could not load cohort report')
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

export async function downloadCohortCsv(query: CohortReportQuery = {}): Promise<void> {
  await downloadFile(
    `${API}/api/admin/reports/cohorts.csv${buildQuery(query)}`,
    `cardioplace_cohorts_${query.month ?? 'latest'}.csv`,
  )
}

export async function downloadCohortPdf(query: CohortReportQuery = {}): Promise<void> {
  await downloadFile(
    `${API}/api/admin/reports/cohorts.pdf${buildQuery(query)}`,
    `cardioplace_cohorts_${query.month ?? 'latest'}.pdf`,
  )
}

export function formatPct(v: number | null): string {
  return v === null || v === undefined ? '—' : `${v}%`
}
