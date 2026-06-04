// Phase/24 — Monthly Practice Analytics Report service.
//
// Wraps the three admin/reports endpoints. JSON reads go through
// `fetchWithAuth` (cookie + bearer); file downloads also need the bearer
// + credentials but pull a Blob and trigger a browser download.
//
// Backend controller: backend/src/reports/reports.controller.ts
//   GET /api/admin/reports/practices
//   GET /api/admin/reports/monthly?practiceId=&month=YYYY-MM&fresh=1
//   GET /api/admin/reports/monthly.csv?...
//   GET /api/admin/reports/monthly.pdf?...

import type { MonthlyReport } from '@cardioplace/shared'
import { fetchWithAuth, getAccessToken } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

export type { MonthlyReport } from '@cardioplace/shared'

export interface ReportPractice {
  id: string
  name: string
  businessHoursTimezone: string
}

interface ListPracticesResponse {
  statusCode: number
  message: string
  data: ReportPractice[]
}

interface MonthlyResponse {
  statusCode: number
  message: string
  data: MonthlyReport
}

export interface MonthlyReportQuery {
  practiceId?: string
  month?: string
  fresh?: boolean
}

function buildQuery(params: MonthlyReportQuery): string {
  const qs = new URLSearchParams()
  if (params.practiceId) qs.set('practiceId', params.practiceId)
  if (params.month) qs.set('month', params.month)
  if (params.fresh) qs.set('fresh', '1')
  return qs.toString() ? `?${qs.toString()}` : ''
}

async function unwrapOrThrow<T>(
  res: Response,
  fallback: string,
): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(
      (err && typeof err === 'object' && 'message' in err && err.message) ||
        `${fallback}: ${res.status}`,
    )
  }
  return (await res.json()) as T
}

// ─── Endpoints ─────────────────────────────────────────────────────────────

export async function listReportPractices(): Promise<ReportPractice[]> {
  const res = await fetchWithAuth(`${API}/api/admin/reports/practices`)
  const json = await unwrapOrThrow<ListPracticesResponse>(
    res,
    'Could not load practices',
  )
  return json.data
}

export async function getMonthlyReport(
  query: MonthlyReportQuery = {},
): Promise<MonthlyReport> {
  const res = await fetchWithAuth(
    `${API}/api/admin/reports/monthly${buildQuery(query)}`,
    { cache: 'no-store' },
  )
  const json = await unwrapOrThrow<MonthlyResponse>(
    res,
    'Could not load report',
  )
  return json.data
}

// ─── Downloads ─────────────────────────────────────────────────────────────
//
// `fetchWithAuth` is JSON-oriented (sets Content-Type to JSON, parses on
// 401 via attemptTokenRefresh). For file downloads we do a direct fetch
// with `credentials: 'include'` + Authorization header — same auth path,
// minus the JSON Content-Type that would confuse some browsers on GET.

async function downloadFile(
  url: string,
  filenameFallback: string,
): Promise<void> {
  const token = getAccessToken()
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!res.ok) {
    let msg = `Download failed: ${res.status}`
    try {
      const err = await res.json()
      if (err && typeof err === 'object' && 'message' in err) {
        msg = String(err.message)
      }
    } catch {
      // body wasn't JSON — keep the status-based message
    }
    throw new Error(msg)
  }

  // Pull a suggested filename from Content-Disposition when present.
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

export async function downloadMonthlyReportCsv(
  query: MonthlyReportQuery = {},
): Promise<void> {
  await downloadFile(
    `${API}/api/admin/reports/monthly.csv${buildQuery(query)}`,
    `cardioplace_report_${query.month ?? 'latest'}.csv`,
  )
}

export async function downloadMonthlyReportPdf(
  query: MonthlyReportQuery = {},
): Promise<void> {
  await downloadFile(
    `${API}/api/admin/reports/monthly.pdf${buildQuery(query)}`,
    `cardioplace_report_${query.month ?? 'latest'}.pdf`,
  )
}

// ─── UI helpers ───────────────────────────────────────────────────────────

/**
 * Default month picker value — the calendar month immediately before
 * "now" in the browser's local timezone. Matches the backend's
 * `previousMonthInTz` default behavior when no `month=` is sent.
 * Format: 'YYYY-MM'.
 */
export function defaultPreviousMonth(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = now.getMonth() // 0-11
  const py = m === 0 ? y - 1 : y
  const pm = m === 0 ? 12 : m
  return `${py}-${String(pm).padStart(2, '0')}`
}

/** "2026-05" → "May 2026". */
export function formatMonthLabel(monthYear: string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(monthYear)
  if (!m) return monthYear
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
  return d.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Seconds → "1h 23m" / "23m" / "47s" / "—" (nulls). */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** "TIER_1_CONTRAINDICATION" → "Tier 1 — Contraindication" style label. */
export function formatTierLabel(tier: string): string {
  switch (tier) {
    case 'BP_LEVEL_2':
      return 'BP Level 2'
    case 'BP_LEVEL_2_SYMPTOM_OVERRIDE':
      return 'BP L2 — Symptom override'
    case 'TIER_1_CONTRAINDICATION':
      return 'Tier 1 — Contraindication'
    case 'TIER_1_ANGIOEDEMA':
      return 'Tier 1 — Angioedema'
    case 'TIER_2_DISCREPANCY':
      return 'Tier 2 — Discrepancy'
    case 'BP_LEVEL_1_HIGH':
      return 'BP Level 1 — High'
    case 'BP_LEVEL_1_LOW':
      return 'BP Level 1 — Low'
    case 'TIER_3_INFO':
      return 'Tier 3 — Info'
    default:
      return tier.replace(/_/g, ' ')
  }
}

/** Color slot for a tier — used by chips/dots so all surfaces agree. */
export function tierSeverityColor(tier: string): 'red' | 'amber' | 'teal' | 'muted' {
  switch (tier) {
    case 'BP_LEVEL_2':
    case 'BP_LEVEL_2_SYMPTOM_OVERRIDE':
    case 'TIER_1_CONTRAINDICATION':
    case 'TIER_1_ANGIOEDEMA':
      return 'red'
    case 'TIER_2_DISCREPANCY':
    case 'BP_LEVEL_1_HIGH':
    case 'BP_LEVEL_1_LOW':
      return 'amber'
    case 'TIER_3_INFO':
      return 'teal'
    default:
      return 'muted'
  }
}
