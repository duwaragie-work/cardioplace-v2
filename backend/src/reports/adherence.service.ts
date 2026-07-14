import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import {
  ADHERENCE_RULES,
  type AdherenceOverall,
  type AdherencePatientRow,
  type AdherenceReport,
  type AdherenceStatus,
} from '@cardioplace/shared'
import PDFDocument from 'pdfkit'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  ReportsService,
  type PracticeRow,
  type ReportsActor,
} from './reports.service.js'

// ─── Helpers ──────────────────────────────────────────────────────────────

function pct(part: number, whole: number): number | null {
  if (whole === 0) return null
  return Math.round((part / whole) * 10000) / 100 // two decimals
}

/**
 * Sum the doses a patient marked "missed" on one check-in.
 *
 * The accurate source is the per-medication snapshot the check-in form
 * writes — a patient on multiple meds sets a miss-count (1..10) per med, so
 * the single scalar `JournalEntry.missedDoses` column (legacy, usually 1)
 * undercounts. Preference order:
 *   1. `medicationStatuses` — every answered med; sum the count on each "no".
 *      Most complete (captures "no" answers even without a reason).
 *   2. `missedMedications` — the dedicated missed list; sum each entry.
 *   3. `missedDoses` scalar — legacy rows that predate the per-med snapshot.
 */
function missedDosesInEntry(e: {
  missedMedications: unknown
  medicationStatuses: unknown
  missedDoses: number | null
}): number {
  const fromStatuses = sumStatusMisses(e.medicationStatuses)
  if (fromStatuses !== null) return fromStatuses
  const fromList = sumMissedList(e.missedMedications)
  if (fromList !== null) return fromList
  return e.missedDoses ?? 0
}

/** Sum `missedDoses` over `medicationStatuses` items whose answer was "no".
 *  Returns null when the value isn't a usable array (so the caller can fall
 *  back to another source). */
function sumStatusMisses(json: unknown): number | null {
  if (!Array.isArray(json)) return null
  let sum = 0
  for (const item of json) {
    if (item && typeof item === 'object' && (item as any).taken === 'no') {
      const n = Number((item as any).missedDoses)
      sum += Number.isFinite(n) && n > 0 ? n : 1 // a "no" is at least one miss
    }
  }
  return sum
}

/** Sum `missedDoses` over a `missedMedications` array (every item is a miss). */
function sumMissedList(json: unknown): number | null {
  if (!Array.isArray(json)) return null
  let sum = 0
  for (const item of json) {
    if (item && typeof item === 'object') {
      const n = Number((item as any).missedDoses)
      sum += Number.isFinite(n) && n > 0 ? n : 1
    }
  }
  return sum
}

/**
 * Resolve the rolling window for an N-day look-back ending "now". Rolling
 * (not calendar-bound) — the adherence report always covers the last N days
 * up to the moment of the request. Timezone is carried only for display;
 * a rolling day-count window doesn't need a tz-aligned boundary.
 */
function rollingWindow(now: Date, days: number): { start: Date; end: Date } {
  const end = now
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  return { start, end }
}

// ─── Service ──────────────────────────────────────────────────────────────

@Injectable()
export class AdherenceService {
  private readonly logger = new Logger(AdherenceService.name)

  constructor(
    private readonly prisma: PrismaService,
    // Reuse the monthly-report authorization + practice-list logic verbatim
    // so the two report surfaces can never drift on who may read what.
    private readonly reports: ReportsService,
  ) {}

  /**
   * Authorize, resolve the practice, and compute the rolling adherence
   * report. Always a fresh compute — adherence has no snapshot cache
   * (the window moves every request, so a cache would be stale instantly).
   */
  async getAdherence(params: {
    caller: ReportsActor
    practiceId: string
    days?: number
  }): Promise<AdherenceReport> {
    await this.reports.assertCanRead(params.caller, params.practiceId)

    const practice = await this.prisma.practice.findUnique({
      where: { id: params.practiceId },
      select: { id: true, name: true, businessHoursTimezone: true },
    })
    if (!practice) throw new NotFoundException('Practice not found')

    const days =
      params.days && params.days > 0 ? params.days : ADHERENCE_RULES.windowDays
    const { start, end } = rollingWindow(new Date(), days)
    return this.compute(practice, days, start, end)
  }

  /**
   * Pure compute — no auth. Aggregates self-reported medication adherence
   * from `JournalEntry` for every roster patient who has ≥1 active
   * medication. Definition is PROVISIONAL (see ADHERENCE_RULES).
   */
  async compute(
    practice: PracticeRow,
    days: number,
    start: Date,
    end: Date,
  ): Promise<AdherenceReport> {
    // ── Roster: patients clinically assigned to this practice ────────────
    const assignments = await this.prisma.patientProviderAssignment.findMany({
      where: { practiceId: practice.id },
      select: {
        userId: true,
        user: { select: { name: true, email: true } },
      },
    })
    const rosterIds = assignments.map((a) => a.userId)
    const nameById = new Map<string, string>(
      assignments.map((a) => [
        a.userId,
        a.user?.name || a.user?.email || '(unknown)',
      ]),
    )

    // Early exit — empty roster yields an all-zero report (still a valid,
    // downloadable document the reader can act on).
    if (rosterIds.length === 0) {
      return this.empty(practice, days, start, end)
    }

    // ── Patients with ≥1 active medication = the adherence denominator ───
    const activeMeds = await this.prisma.patientMedication.findMany({
      where: { userId: { in: rosterIds }, discontinuedAt: null },
      select: { userId: true },
    })
    const patientsWithMeds = new Set(activeMeds.map((m) => m.userId))

    // ── Check-ins in the window for those patients ───────────────────────
    const entries =
      patientsWithMeds.size === 0
        ? []
        : await this.prisma.journalEntry.findMany({
            where: {
              userId: { in: Array.from(patientsWithMeds) },
              measuredAt: { gte: start, lt: end },
            },
            select: {
              userId: true,
              medicationTaken: true,
              medicationScheduledLater: true,
              missedDoses: true,
              missedMedications: true,
              medicationStatuses: true,
            },
          })

    // ── Per-patient tally ────────────────────────────────────────────────
    type Tally = {
      checkInsLogged: number
      dueCheckIns: number
      takenCheckIns: number
      missedDosesTotal: number
    }
    const tallyById = new Map<string, Tally>()
    const ensure = (id: string): Tally => {
      let t = tallyById.get(id)
      if (!t) {
        t = {
          checkInsLogged: 0,
          dueCheckIns: 0,
          takenCheckIns: 0,
          missedDosesTotal: 0,
        }
        tallyById.set(id, t)
      }
      return t
    }
    // Seed every med-holding patient so non-loggers still get a NO_DATA row.
    for (const id of patientsWithMeds) ensure(id)

    for (const e of entries) {
      const t = ensure(e.userId)
      t.checkInsLogged += 1
      t.missedDosesTotal += missedDosesInEntry(e)

      // "Due" = a medication decision was actually required on this entry.
      // Exclude entries where the patient never answered the med question
      // (medicationTaken null) and — per the provisional rule — entries
      // flagged "not due yet" (medicationScheduledLater).
      const notDueYet =
        e.medicationScheduledLater &&
        !ADHERENCE_RULES.scheduledLaterCountsAsDue
      if (e.medicationTaken === null || notDueYet) continue

      t.dueCheckIns += 1
      if (e.medicationTaken === true) t.takenCheckIns += 1
    }

    // ── Build rows ───────────────────────────────────────────────────────
    const target = ADHERENCE_RULES.targetPct
    const byPatient: AdherencePatientRow[] = Array.from(tallyById.entries()).map(
      ([patientId, t]) => {
        const adherencePct = pct(t.takenCheckIns, t.dueCheckIns)
        let status: AdherenceStatus
        if (t.dueCheckIns === 0) status = 'NO_DATA'
        else if ((adherencePct ?? 0) < target) status = 'BELOW_TARGET'
        else status = 'ON_TRACK'
        return {
          patientId,
          name: nameById.get(patientId) ?? '(unknown)',
          checkInsLogged: t.checkInsLogged,
          dueCheckIns: t.dueCheckIns,
          takenCheckIns: t.takenCheckIns,
          adherencePct,
          missedDosesTotal: t.missedDosesTotal,
          status,
        }
      },
    )

    // Worst-first so the reader sees the patients who need outreach at the
    // top. NO_DATA sinks to the bottom (no actionable number yet).
    byPatient.sort((a, b) => {
      const rank = (s: AdherenceStatus) =>
        s === 'BELOW_TARGET' ? 0 : s === 'ON_TRACK' ? 1 : 2
      if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status)
      if (a.status !== 'NO_DATA' && b.status !== 'NO_DATA') {
        return (a.adherencePct ?? 0) - (b.adherencePct ?? 0)
      }
      return a.name.localeCompare(b.name)
    })

    // ── Overall ──────────────────────────────────────────────────────────
    const totalDue = byPatient.reduce((s, r) => s + r.dueCheckIns, 0)
    const totalTaken = byPatient.reduce((s, r) => s + r.takenCheckIns, 0)
    const overall: AdherenceOverall = {
      patientsWithMeds: patientsWithMeds.size,
      patientsReporting: byPatient.filter((r) => r.dueCheckIns > 0).length,
      practiceAdherencePct: pct(totalTaken, totalDue),
      patientsBelowTarget: byPatient.filter((r) => r.status === 'BELOW_TARGET')
        .length,
      patientsNoData: byPatient.filter((r) => r.status === 'NO_DATA').length,
      totalDueCheckIns: totalDue,
      totalTakenCheckIns: totalTaken,
      totalMissedDoses: byPatient.reduce((s, r) => s + r.missedDosesTotal, 0),
    }

    return {
      practiceId: practice.id,
      practiceName: practice.name,
      practiceTimezone: practice.businessHoursTimezone,
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      windowDays: days,
      targetPct: target,
      generatedAt: new Date().toISOString(),
      provisional: true,
      overall,
      byPatient,
    }
  }

  private empty(
    practice: PracticeRow,
    days: number,
    start: Date,
    end: Date,
  ): AdherenceReport {
    return {
      practiceId: practice.id,
      practiceName: practice.name,
      practiceTimezone: practice.businessHoursTimezone,
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      windowDays: days,
      targetPct: ADHERENCE_RULES.targetPct,
      generatedAt: new Date().toISOString(),
      provisional: true,
      overall: {
        patientsWithMeds: 0,
        patientsReporting: 0,
        practiceAdherencePct: null,
        patientsBelowTarget: 0,
        patientsNoData: 0,
        totalDueCheckIns: 0,
        totalTakenCheckIns: 0,
        totalMissedDoses: 0,
      },
      byPatient: [],
    }
  }

  // ─── CSV serialization ──────────────────────────────────────────────────
  toCsv(report: AdherenceReport): string {
    const lines: string[] = []
    const esc = (v: string | number | null) => {
      if (v === null || v === undefined) return ''
      const s = String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const row = (...cells: Array<string | number | null>) =>
      lines.push(cells.map(esc).join(','))
    const pctStr = (v: number | null) => (v === null ? '' : `${v}%`)

    row('Practice', report.practiceName)
    row(
      'Window',
      `${report.windowStart} → ${report.windowEnd} (${report.windowDays} days)`,
    )
    row('Timezone', report.practiceTimezone)
    row('Adherence target', `${report.targetPct}%`)
    row('Generated', report.generatedAt)
    row('Definition', 'PROVISIONAL — pending clinical sign-off')
    row('')

    row('SUMMARY')
    row('Metric', 'Value')
    row('Patients with active meds', report.overall.patientsWithMeds)
    row('Patients reporting', report.overall.patientsReporting)
    row('Practice adherence', pctStr(report.overall.practiceAdherencePct))
    row('Patients below target', report.overall.patientsBelowTarget)
    row('Patients with no data', report.overall.patientsNoData)
    row('Total due check-ins', report.overall.totalDueCheckIns)
    row('Total taken check-ins', report.overall.totalTakenCheckIns)
    row('Total missed doses', report.overall.totalMissedDoses)
    row('')

    row('BY PATIENT')
    row(
      'Patient',
      'Status',
      'Adherence',
      'Times due',
      'Times taken',
      'Doses missed',
      'Check-ins logged',
    )
    for (const p of report.byPatient) {
      row(
        p.name,
        p.status.replace(/_/g, ' '),
        pctStr(p.adherencePct),
        p.dueCheckIns,
        p.takenCheckIns,
        p.missedDosesTotal,
        p.checkInsLogged,
      )
    }

    return lines.join('\n') + '\n'
  }

  // ─── PDF serialization ──────────────────────────────────────────────────
  /**
   * Render the adherence report as a printable PDF. Header → provisional
   * disclaimer band → KPI tiles → paginated patient table. pdfkit (pure JS,
   * no headless browser) so the request stays cheap.
   */
  toPdf(report: AdherenceReport): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 44, bottom: 56, left: 44, right: 44 },
        bufferPages: true,
        info: {
          Title: `Adherence Report — ${report.practiceName}`,
          Author: 'Cardioplace',
          Subject: '90-day Medication Adherence Report',
        },
      })

      const chunks: Buffer[] = []
      doc.on('data', (c: Buffer) => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const PURPLE = '#7B00E0'
      const TEXT = '#1F2937'
      const TEXT_SOFT = '#374151'
      const MUTED = '#6B7280'
      const TILE_BG = '#F3F0FF'
      const HEADER_BG = '#F8FAFC'
      const BORDER = '#E5E7EB'
      const ZEBRA = '#FAFBFF'

      const pageWidth =
        doc.page.width - doc.page.margins.left - doc.page.margins.right
      const leftX = doc.page.margins.left

      const fmtDate = (iso: string): string => {
        try {
          return new Date(iso).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        } catch {
          return iso
        }
      }
      const pctStr = (v: number | null) => (v === null ? '—' : `${v}%`)
      const statusLabel = (s: AdherenceStatus) =>
        s === 'BELOW_TARGET'
          ? 'Below target'
          : s === 'ON_TRACK'
            ? 'On track'
            : 'No data'

      // ── Header ───────────────────────────────────────────────────────
      doc
        .font('Helvetica-Bold')
        .fillColor(TEXT)
        .fontSize(20)
        .text('Medication Adherence Report', leftX, doc.y, {
          characterSpacing: 0.2,
        })
      doc.font('Helvetica')
      doc.moveDown(0.2)
      doc
        .fillColor(PURPLE)
        .fontSize(13)
        .text(
          `${report.practiceName} | last ${report.windowDays} days`,
          leftX,
          doc.y,
        )
      doc.moveDown(0.3)
      doc
        .fillColor(MUTED)
        .fontSize(9)
        .text(
          `Window: ${fmtDate(report.windowStart)} | ${fmtDate(report.windowEnd)}  ·  ${report.practiceTimezone}  ·  target ${report.targetPct}%  ·  generated ${fmtDate(report.generatedAt)}`,
          leftX,
          doc.y,
        )

      doc.moveDown(1.2)

      // ── KPI tiles (2x2) ──────────────────────────────────────────────
      const drawTile = (
        x: number,
        y: number,
        w: number,
        h: number,
        label: string,
        value: string,
        caption: string,
      ) => {
        doc.save()
        doc.roundedRect(x, y, w, h, 8).fillAndStroke(TILE_BG, TILE_BG)
        doc
          .fillColor(PURPLE)
          .fontSize(8.5)
          .text(label.toUpperCase(), x + 12, y + 10, {
            width: w - 24,
            characterSpacing: 0.8,
          })
        doc
          .fillColor(TEXT)
          .fontSize(18)
          .text(value, x + 12, y + 24, { width: w - 24 })
        doc
          .fillColor(MUTED)
          .fontSize(8.5)
          .text(caption, x + 12, y + 48, { width: w - 24 })
        doc.restore()
      }
      const tileGap = 12
      const tileW = (pageWidth - tileGap) / 2
      const tileH = 70
      const tileTop = doc.y
      drawTile(
        leftX,
        tileTop,
        tileW,
        tileH,
        'Practice adherence',
        pctStr(report.overall.practiceAdherencePct),
        `${report.overall.totalTakenCheckIns} of ${report.overall.totalDueCheckIns} due check-ins`,
      )
      drawTile(
        leftX + tileW + tileGap,
        tileTop,
        tileW,
        tileH,
        'Below target',
        String(report.overall.patientsBelowTarget),
        `of ${report.overall.patientsWithMeds} patients with meds`,
      )
      drawTile(
        leftX,
        tileTop + tileH + tileGap,
        tileW,
        tileH,
        'Reporting',
        String(report.overall.patientsReporting),
        `${report.overall.patientsNoData} with no data`,
      )
      drawTile(
        leftX + tileW + tileGap,
        tileTop + tileH + tileGap,
        tileW,
        tileH,
        'Missed doses',
        String(report.overall.totalMissedDoses),
        'self-reported in window',
      )
      doc.y = tileTop + tileH * 2 + tileGap
      doc.x = leftX
      doc.moveDown(1.2)

      // ── By-patient table (paginated) ─────────────────────────────────
      doc
        .font('Helvetica-Bold')
        .fillColor(TEXT)
        .fontSize(11)
        .text('BY PATIENT', leftX, doc.y, { characterSpacing: 0.6 })
      doc.font('Helvetica')
      doc.moveDown(0.4)
      // Plain-language legend so the column meanings are unambiguous.
      doc
        .fillColor(MUTED)
        .fontSize(8)
        .text(
          'Times due = check-ins where a dose was due (Yes or No).  Times taken = of those, how many were taken.  Doses missed = total doses reported missed.  Adherence = taken ÷ due.',
          leftX,
          doc.y,
          { width: pageWidth },
        )
      doc.moveDown(0.6)

      type Col = { label: string; width: number; align?: 'left' | 'right' }
      const cols: Col[] = [
        { label: 'Patient', width: 0.3 },
        { label: 'Status', width: 0.16 },
        { label: 'Adherence', width: 0.14, align: 'right' },
        { label: 'Times due', width: 0.13, align: 'right' },
        { label: 'Times taken', width: 0.14, align: 'right' },
        { label: 'Doses missed', width: 0.13, align: 'right' },
      ]
      const cells: string[][] = report.byPatient.map((p) => [
        p.name,
        statusLabel(p.status),
        pctStr(p.adherencePct),
        String(p.dueCheckIns),
        String(p.takenCheckIns),
        String(p.missedDosesTotal),
      ])

      if (cells.length === 0) {
        doc
          .fillColor(MUTED)
          .fontSize(10)
          .text('(No patients with active medications in this practice.)', leftX, doc.y, {
            width: pageWidth,
          })
      } else {
        // Taller header so two-word labels (e.g. "DOSES MISSED") can wrap to
        // two lines without overlapping the row below.
        const HEADER_H = 30
        const ROW_H = 20
        const CELL_PAD_X = 8
        const FOOTER_RESERVE = 28
        const bottomLimit =
          doc.page.height - doc.page.margins.bottom - FOOTER_RESERVE

        const drawHeader = (top: number) => {
          doc.save()
          doc.fillColor(HEADER_BG).rect(leftX, top, pageWidth, HEADER_H).fill()
          doc.restore()
          let cx = leftX
          doc.font('Helvetica-Bold').fillColor(TEXT).fontSize(8.5)
          for (const c of cols) {
            const w = c.width * pageWidth
            // Allow wrapping (no lineBreak:false) so a narrow column stacks
            // its label instead of clipping it.
            doc.text(c.label.toUpperCase(), cx + CELL_PAD_X, top + 5, {
              width: w - CELL_PAD_X * 2,
              align: c.align ?? 'left',
            })
            cx += w
          }
        }

        let top = doc.y
        let y = HEADER_H
        let rowsInSegment = 0
        drawHeader(top)

        const closeSegment = () => {
          doc.save()
          doc.strokeColor(BORDER).lineWidth(0.5)
          doc.rect(leftX, top, pageWidth, y).stroke()
          let cx = leftX
          for (let j = 0; j < cols.length - 1; j++) {
            cx += cols[j].width * pageWidth
            doc.moveTo(cx, top).lineTo(cx, top + y).stroke()
          }
          doc
            .moveTo(leftX, top + HEADER_H)
            .lineTo(leftX + pageWidth, top + HEADER_H)
            .stroke()
          doc.restore()
        }

        for (let i = 0; i < cells.length; i++) {
          if (top + y + ROW_H > bottomLimit) {
            closeSegment()
            doc.addPage()
            top = doc.y
            y = HEADER_H
            rowsInSegment = 0
            drawHeader(top)
          }
          if (i % 2 === 1) {
            doc.save()
            doc.fillColor(ZEBRA).rect(leftX, top + y, pageWidth, ROW_H).fill()
            doc.restore()
          }
          let cx = leftX
          doc.font('Helvetica').fillColor(TEXT_SOFT).fontSize(9)
          for (let j = 0; j < cols.length; j++) {
            const w = cols[j].width * pageWidth
            doc.text(cells[i][j], cx + CELL_PAD_X, top + y + 6, {
              width: w - CELL_PAD_X * 2,
              align: cols[j].align ?? 'left',
              lineBreak: false,
              ellipsis: true,
            })
            cx += w
          }
          y += ROW_H
          rowsInSegment += 1
        }
        if (rowsInSegment > 0 || cells.length > 0) closeSegment()
        doc.y = top + y
      }

      // ── Footer on every page ─────────────────────────────────────────
      const footerText = `${report.overall.patientsWithMeds} patients with meds  ·  ${report.overall.patientsBelowTarget} below target  ·  Cardioplace Adherence Report`
      const range = doc.bufferedPageRange()
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i)
        const footerY = doc.page.height - doc.page.margins.bottom - 14
        doc
          .font('Helvetica')
          .fillColor(MUTED)
          .fontSize(8)
          .text(footerText, leftX, footerY, {
            width: pageWidth,
            align: 'center',
            lineBreak: false,
          })
      }

      doc.end()
    })
  }
}
