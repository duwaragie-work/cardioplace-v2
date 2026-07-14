// Task 2 — Quarterly Outcomes Report service.
//
// Wraps the three admin/reports/quarterly endpoints. Reuses the practice
// list + download helpers pattern from the other report services.
//
// Backend controller: backend/src/reports/quarterly.controller.ts
//   GET /api/admin/reports/quarterly?practiceId=&quarter=YYYY-Qn
//   GET /api/admin/reports/quarterly.csv?...
//   GET /api/admin/reports/quarterly.pdf?...

import type { QuarterlyReport } from '@cardioplace/shared'
import { fetchWithAuth, getAccessToken } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

export type { QuarterlyReport } from '@cardioplace/shared'
export {
  listReportPractices,
  type ReportPractice,
} from './reports.service'

interface QuarterlyResponse {
  statusCode: number
  message: string
  data: QuarterlyReport
}

export interface QuarterlyReportQuery {
  practiceId?: string
  quarter?: string
}

function buildQuery(params: QuarterlyReportQuery): string {
  const qs = new URLSearchParams()
  if (params.practiceId) qs.set('practiceId', params.practiceId)
  if (params.quarter) qs.set('quarter', params.quarter)
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

export async function getQuarterlyReport(
  query: QuarterlyReportQuery = {},
): Promise<QuarterlyReport> {
  const res = await fetchWithAuth(
    `${API}/api/admin/reports/quarterly${buildQuery(query)}`,
    { cache: 'no-store' },
  )
  const json = await unwrapOrThrow<QuarterlyResponse>(
    res,
    'Could not load quarterly report',
  )
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

export async function downloadQuarterlyCsv(query: QuarterlyReportQuery = {}): Promise<void> {
  await downloadFile(
    `${API}/api/admin/reports/quarterly.csv${buildQuery(query)}`,
    `cardioplace_quarterly_${query.quarter ?? 'latest'}.csv`,
  )
}

export async function downloadQuarterlyPdf(query: QuarterlyReportQuery = {}): Promise<void> {
  await downloadFile(
    `${API}/api/admin/reports/quarterly.pdf${buildQuery(query)}`,
    `cardioplace_quarterly_${query.quarter ?? 'latest'}.pdf`,
  )
}

// ─── UI helpers ─────────────────────────────────────────────────────────────

export function formatPct(v: number | null): string {
  return v === null || v === undefined ? '—' : `${v}%`
}

/** Current calendar quarter as "YYYY-Qn" in the browser's local time. */
export function currentQuarter(now: Date = new Date()): string {
  const y = now.getFullYear()
  const q = Math.floor(now.getMonth() / 3) + 1
  return `${y}-Q${q}`
}

/** The last N quarters (most recent first) as selectable options. */
export function recentQuarters(count = 6, now: Date = new Date()): string[] {
  const out: string[] = []
  let y = now.getFullYear()
  let q = Math.floor(now.getMonth() / 3) + 1
  for (let i = 0; i < count; i++) {
    out.push(`${y}-Q${q}`)
    q -= 1
    if (q === 0) {
      q = 4
      y -= 1
    }
  }
  return out
}
