// Phase/25 — 90-day Medication Adherence Report service.
//
// Wraps the three admin/reports/adherence endpoints. Reuses the practice
// list + download helpers from reports.service so the two report surfaces
// stay in lock-step.
//
// Backend controller: backend/src/reports/adherence.controller.ts
//   GET /api/admin/reports/adherence?practiceId=&days=90
//   GET /api/admin/reports/adherence.csv?...
//   GET /api/admin/reports/adherence.pdf?...

import type { AdherenceReport } from '@cardioplace/shared'
import { fetchWithAuth, getAccessToken } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

export type { AdherenceReport } from '@cardioplace/shared'
export {
  listReportPractices,
  type ReportPractice,
} from './reports.service'

interface AdherenceResponse {
  statusCode: number
  message: string
  data: AdherenceReport
}

export interface AdherenceReportQuery {
  practiceId?: string
  days?: number
}

function buildQuery(params: AdherenceReportQuery): string {
  const qs = new URLSearchParams()
  if (params.practiceId) qs.set('practiceId', params.practiceId)
  if (params.days) qs.set('days', String(params.days))
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

export async function getAdherenceReport(
  query: AdherenceReportQuery = {},
): Promise<AdherenceReport> {
  const res = await fetchWithAuth(
    `${API}/api/admin/reports/adherence${buildQuery(query)}`,
    { cache: 'no-store' },
  )
  const json = await unwrapOrThrow<AdherenceResponse>(
    res,
    'Could not load adherence report',
  )
  return json.data
}

// ─── Downloads ─────────────────────────────────────────────────────────────

async function downloadFile(
  url: string,
  filenameFallback: string,
): Promise<void> {
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
      if (err && typeof err === 'object' && 'message' in err) {
        msg = String(err.message)
      }
    } catch {
      // body wasn't JSON — keep the status-based message
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

export async function downloadAdherenceCsv(
  query: AdherenceReportQuery = {},
): Promise<void> {
  await downloadFile(
    `${API}/api/admin/reports/adherence.csv${buildQuery(query)}`,
    `cardioplace_adherence_${query.days ?? 90}d.csv`,
  )
}

export async function downloadAdherencePdf(
  query: AdherenceReportQuery = {},
): Promise<void> {
  await downloadFile(
    `${API}/api/admin/reports/adherence.pdf${buildQuery(query)}`,
    `cardioplace_adherence_${query.days ?? 90}d.pdf`,
  )
}

// ─── UI helpers ─────────────────────────────────────────────────────────────

/** Adherence-percentage label, "—" for null. */
export function formatPct(v: number | null): string {
  return v === null || v === undefined ? '—' : `${v}%`
}

/** Window-length options surfaced in the day-range picker. */
export const ADHERENCE_WINDOW_OPTIONS = [
  { value: 30, label: '30 days' },
  { value: 60, label: '60 days' },
  { value: 90, label: '90 days' },
  { value: 180, label: '180 days' },
] as const
