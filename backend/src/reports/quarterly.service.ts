import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  QUARTERLY_RULES,
  type ControlPatientRow,
  type ControlStatus,
  type MonthVolumeRow,
  type QuarterlyControlOverall,
  type QuarterlyReport,
} from '@cardioplace/shared'
import PDFDocument from 'pdfkit'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  monthWindowInTz,
  ReportsService,
  type PracticeRow,
  type ReportsActor,
} from './reports.service.js'

// ─── Quarter helpers ────────────────────────────────────────────────────────

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** Validate "YYYY-Qn" and return the three YYYY-MM months of that quarter. */
export function quarterMonths(quarter: string): string[] {
  const m = /^(\d{4})-Q([1-4])$/.exec(quarter)
  if (!m) throw new BadRequestException(`Invalid quarter: ${quarter}`)
  const year = Number(m[1])
  const q = Number(m[2])
  const firstMonth = (q - 1) * 3 + 1 // 1,4,7,10
  return [0, 1, 2].map(
    (i) => `${year}-${String(firstMonth + i).padStart(2, '0')}`,
  )
}

/** "2026-04" → "Apr 2026". */
function monthLabel(monthYear: string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(monthYear)
  if (!m) return monthYear
  return `${MONTH_LABELS[Number(m[2]) - 1]} ${m[1]}`
}

/** The calendar quarter containing "now" in the practice timezone. */
export function currentQuarterInTz(now: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  })
  const parts: Record<string, string> = {}
  for (const p of fmt.formatToParts(now)) {
    if (p.type !== 'literal') parts[p.type] = p.value
  }
  const year = Number(parts.year)
  const month = Number(parts.month)
  return `${year}-Q${Math.ceil(month / 3)}`
}

function pct(part: number, whole: number): number | null {
  if (whole === 0) return null
  return Math.round((part / whole) * 10000) / 100
}

// ─── Service ──────────────────────────────────────────────────────────────

@Injectable()
export class QuarterlyService {
  constructor(
    private readonly prisma: PrismaService,
    // Reuse the monthly report's auth + per-month alert aggregation verbatim.
    private readonly reports: ReportsService,
  ) {}

  async getQuarterly(params: {
    caller: ReportsActor
    practiceId: string
    quarter?: string
  }): Promise<QuarterlyReport> {
    await this.reports.assertCanRead(params.caller, params.practiceId)

    const practice = await this.prisma.practice.findUnique({
      where: { id: params.practiceId },
      select: { id: true, name: true, businessHoursTimezone: true },
    })
    if (!practice) throw new NotFoundException('Practice not found')

    const quarter =
      params.quarter ??
      currentQuarterInTz(new Date(), practice.businessHoursTimezone)
    return this.compute(practice, quarter)
  }

  /** Pure compute — no auth. */
  async compute(
    practice: PracticeRow,
    quarter: string,
  ): Promise<QuarterlyReport> {
    const tz = practice.businessHoursTimezone
    const months = quarterMonths(quarter)

    // ── Alert-volume trend: reuse the monthly aggregation per month ──────
    const alertVolume: MonthVolumeRow[] = []
    for (const monthYear of months) {
      const { start, end } = monthWindowInTz(monthYear, tz)
      const monthly = await this.reports.compute(practice, monthYear, start, end)
      alertVolume.push({
        monthYear,
        label: monthLabel(monthYear),
        totalAlerts: monthly.overall.totalAlerts,
      })
    }
    const totalAlertsInQuarter = alertVolume.reduce(
      (s, r) => s + r.totalAlerts,
      0,
    )

    // ── Quarter window [start of month 1, start of month after month 3) ──
    const windowStart = monthWindowInTz(months[0], tz).start
    const windowEnd = monthWindowInTz(months[2], tz).end

    // ── BP-control rate ──────────────────────────────────────────────────
    const { control, byPatient } = await this.computeControl(
      practice,
      windowStart,
      windowEnd,
    )

    return {
      practiceId: practice.id,
      practiceName: practice.name,
      practiceTimezone: tz,
      quarter,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      generatedAt: new Date().toISOString(),
      provisional: true,
      alertVolume,
      totalAlertsInQuarter,
      control,
      byPatient,
    }
  }

  private async computeControl(
    practice: PracticeRow,
    start: Date,
    end: Date,
  ): Promise<{
    control: QuarterlyControlOverall
    byPatient: ControlPatientRow[]
  }> {
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

    if (rosterIds.length === 0) {
      return {
        control: {
          patientsWithReadings: 0,
          controlled: 0,
          notControlled: 0,
          controlRatePct: null,
        },
        byPatient: [],
      }
    }

    // Readings with a usable BP pair in the quarter.
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        userId: { in: rosterIds },
        measuredAt: { gte: start, lt: end },
        systolicBP: { not: null },
        diastolicBP: { not: null },
      },
      select: { userId: true, systolicBP: true, diastolicBP: true },
    })

    // Current per-patient provider targets (replacedAt null = active).
    const thresholds = await this.prisma.patientThreshold.findMany({
      where: { userId: { in: rosterIds }, replacedAt: null },
      select: { userId: true, sbpUpperTarget: true, dbpUpperTarget: true },
    })
    const thresholdById = new Map(thresholds.map((t) => [t.userId, t]))

    // Sum + count per patient for the average.
    type Acc = { sbpSum: number; dbpSum: number; n: number }
    const accById = new Map<string, Acc>()
    for (const e of entries) {
      if (e.systolicBP === null || e.diastolicBP === null) continue
      const a = accById.get(e.userId) ?? { sbpSum: 0, dbpSum: 0, n: 0 }
      a.sbpSum += e.systolicBP
      a.dbpSum += e.diastolicBP
      a.n += 1
      accById.set(e.userId, a)
    }

    const byPatient: ControlPatientRow[] = Array.from(accById.entries()).map(
      ([patientId, a]) => {
        const meanSystolic = Math.round(a.sbpSum / a.n)
        const meanDiastolic = Math.round(a.dbpSum / a.n)
        const t = thresholdById.get(patientId)
        const sbpUpper = t?.sbpUpperTarget ?? QUARTERLY_RULES.defaultSbpUpper
        const dbpUpper = t?.dbpUpperTarget ?? QUARTERLY_RULES.defaultDbpUpper
        const usedCustomTarget =
          t?.sbpUpperTarget != null || t?.dbpUpperTarget != null
        const controlled = meanSystolic <= sbpUpper && meanDiastolic <= dbpUpper
        const status: ControlStatus = controlled
          ? 'CONTROLLED'
          : 'NOT_CONTROLLED'
        return {
          patientId,
          name: nameById.get(patientId) ?? '(unknown)',
          readings: a.n,
          meanSystolic,
          meanDiastolic,
          sbpUpper,
          dbpUpper,
          usedCustomTarget,
          status,
        }
      },
    )

    // Worst-first: not-controlled at the top, highest mean systolic first.
    byPatient.sort((x, y) => {
      if (x.status !== y.status) return x.status === 'NOT_CONTROLLED' ? -1 : 1
      if (y.meanSystolic !== x.meanSystolic) return y.meanSystolic - x.meanSystolic
      return x.name.localeCompare(y.name)
    })

    const controlled = byPatient.filter((r) => r.status === 'CONTROLLED').length
    const withReadings = byPatient.length
    const control: QuarterlyControlOverall = {
      patientsWithReadings: withReadings,
      controlled,
      notControlled: withReadings - controlled,
      controlRatePct: pct(controlled, withReadings),
    }
    return { control, byPatient }
  }

  // ─── CSV serialization ──────────────────────────────────────────────────
  toCsv(report: QuarterlyReport): string {
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
    row('Quarter', report.quarter)
    row('Window', `${report.windowStart} → ${report.windowEnd}`)
    row('Timezone', report.practiceTimezone)
    row('Generated', report.generatedAt)
    row('BP-control definition', 'PROVISIONAL — pending clinical sign-off')
    row('')

    row('ALERT VOLUME (per month)')
    row('Month', 'Total alerts')
    for (const m of report.alertVolume) row(m.label, m.totalAlerts)
    row('Quarter total', report.totalAlertsInQuarter)
    row('')

    row('BP CONTROL')
    row('Metric', 'Value')
    row('Patients with readings', report.control.patientsWithReadings)
    row('Controlled', report.control.controlled)
    row('Not controlled', report.control.notControlled)
    row('Control rate', pctStr(report.control.controlRatePct))
    row('')

    row('BY PATIENT')
    row(
      'Patient',
      'Status',
      'Mean systolic',
      'Mean diastolic',
      'Target (upper)',
      'Readings',
      'Custom target',
    )
    for (const p of report.byPatient) {
      row(
        p.name,
        p.status === 'CONTROLLED' ? 'Controlled' : 'Not controlled',
        p.meanSystolic,
        p.meanDiastolic,
        `${p.sbpUpper}/${p.dbpUpper}`,
        p.readings,
        p.usedCustomTarget ? 'yes' : 'default',
      )
    }

    return lines.join('\n') + '\n'
  }

  // ─── PDF serialization ──────────────────────────────────────────────────
  toPdf(report: QuarterlyReport): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 44, bottom: 56, left: 44, right: 44 },
        bufferPages: true,
        info: {
          Title: `Quarterly Outcomes — ${report.practiceName} — ${report.quarter}`,
          Author: 'Cardioplace',
          Subject: 'Quarterly Outcomes Report',
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
      const fmtDate = (iso: string) => {
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

      // Header
      doc
        .font('Helvetica-Bold')
        .fillColor(TEXT)
        .fontSize(20)
        .text('Quarterly Outcomes Report', leftX, doc.y, { characterSpacing: 0.2 })
      doc.font('Helvetica')
      doc.moveDown(0.2)
      doc
        .fillColor(PURPLE)
        .fontSize(13)
        .text(`${report.practiceName} | ${report.quarter}`, leftX, doc.y)
      doc.moveDown(0.3)
      doc
        .fillColor(MUTED)
        .fontSize(9)
        .text(
          `Window: ${fmtDate(report.windowStart)} | ${fmtDate(report.windowEnd)}  ·  ${report.practiceTimezone}  ·  generated ${fmtDate(report.generatedAt)}`,
          leftX,
          doc.y,
        )
      doc.moveDown(1.2)

      // KPI tiles
      const drawTile = (
        x: number, y: number, w: number, h: number,
        label: string, value: string, caption: string,
      ) => {
        doc.save()
        doc.roundedRect(x, y, w, h, 8).fillAndStroke(TILE_BG, TILE_BG)
        doc.fillColor(PURPLE).fontSize(8.5).text(label.toUpperCase(), x + 12, y + 10, {
          width: w - 24, characterSpacing: 0.8,
        })
        doc.fillColor(TEXT).fontSize(18).text(value, x + 12, y + 24, { width: w - 24 })
        doc.fillColor(MUTED).fontSize(8.5).text(caption, x + 12, y + 48, { width: w - 24 })
        doc.restore()
      }
      const tileGap = 12
      const tileW = (pageWidth - tileGap) / 2
      const tileH = 70
      const tileTop = doc.y
      drawTile(
        leftX, tileTop, tileW, tileH,
        'BP control rate',
        pctStr(report.control.controlRatePct),
        `${report.control.controlled} of ${report.control.patientsWithReadings} patients`,
      )
      drawTile(
        leftX + tileW + tileGap, tileTop, tileW, tileH,
        'Not controlled',
        String(report.control.notControlled),
        'quarter-average above target',
      )
      drawTile(
        leftX, tileTop + tileH + tileGap, tileW, tileH,
        'Alerts this quarter',
        String(report.totalAlertsInQuarter),
        report.alertVolume.map((m) => `${m.label.split(' ')[0]} ${m.totalAlerts}`).join('  ·  '),
      )
      drawTile(
        leftX + tileW + tileGap, tileTop + tileH + tileGap, tileW, tileH,
        'Patients with readings',
        String(report.control.patientsWithReadings),
        'in the quarter',
      )
      doc.y = tileTop + tileH * 2 + tileGap
      doc.x = leftX
      doc.moveDown(1.2)

      // Alert-volume trend (small table)
      doc.font('Helvetica-Bold').fillColor(TEXT).fontSize(11)
        .text('ALERT VOLUME BY MONTH', leftX, doc.y, { characterSpacing: 0.6 })
      doc.font('Helvetica').moveDown(0.5)
      for (const m of report.alertVolume) {
        doc.fillColor(TEXT_SOFT).fontSize(10)
          .text(`${m.label}:  ${m.totalAlerts} alert${m.totalAlerts === 1 ? '' : 's'}`, leftX + 4, doc.y)
        doc.moveDown(0.2)
      }
      doc.moveDown(1.0)

      // By-patient control table
      doc.font('Helvetica-Bold').fillColor(TEXT).fontSize(11)
        .text('BP CONTROL BY PATIENT', leftX, doc.y, { characterSpacing: 0.6 })
      doc.font('Helvetica').moveDown(0.4)
      doc.fillColor(MUTED).fontSize(8).text(
        'Controlled = quarter-average systolic AND diastolic at/below the upper target (provider target when set, otherwise default).',
        leftX, doc.y, { width: pageWidth },
      )
      doc.moveDown(0.6)

      type Col = { label: string; width: number; align?: 'left' | 'right' }
      const cols: Col[] = [
        { label: 'Patient', width: 0.3 },
        { label: 'Status', width: 0.18 },
        { label: 'Avg BP', width: 0.16, align: 'right' },
        { label: 'Target', width: 0.16, align: 'right' },
        { label: 'Readings', width: 0.2, align: 'right' },
      ]
      const cells: string[][] = report.byPatient.map((p) => [
        p.name,
        p.status === 'CONTROLLED' ? 'Controlled' : 'Not controlled',
        `${p.meanSystolic}/${p.meanDiastolic}`,
        `${p.sbpUpper}/${p.dbpUpper}${p.usedCustomTarget ? '*' : ''}`,
        String(p.readings),
      ])

      if (cells.length === 0) {
        doc.fillColor(MUTED).fontSize(10)
          .text('(No patients with BP readings in this quarter.)', leftX, doc.y, { width: pageWidth })
      } else {
        const HEADER_H = 30
        const ROW_H = 20
        const CELL_PAD_X = 8
        const FOOTER_RESERVE = 28
        const bottomLimit = doc.page.height - doc.page.margins.bottom - FOOTER_RESERVE

        const drawHeader = (top: number) => {
          doc.save()
          doc.fillColor(HEADER_BG).rect(leftX, top, pageWidth, HEADER_H).fill()
          doc.restore()
          let cx = leftX
          doc.font('Helvetica-Bold').fillColor(TEXT).fontSize(8.5)
          for (const c of cols) {
            const w = c.width * pageWidth
            doc.text(c.label.toUpperCase(), cx + CELL_PAD_X, top + 5, {
              width: w - CELL_PAD_X * 2, align: c.align ?? 'left',
            })
            cx += w
          }
        }
        let top = doc.y
        let y = HEADER_H
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
          doc.moveTo(leftX, top + HEADER_H).lineTo(leftX + pageWidth, top + HEADER_H).stroke()
          doc.restore()
        }
        for (let i = 0; i < cells.length; i++) {
          if (top + y + ROW_H > bottomLimit) {
            closeSegment()
            doc.addPage()
            top = doc.y
            y = HEADER_H
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
              width: w - CELL_PAD_X * 2, align: cols[j].align ?? 'left',
              lineBreak: false, ellipsis: true,
            })
            cx += w
          }
          y += ROW_H
        }
        closeSegment()
        doc.y = top + y
        doc.moveDown(0.4)
        doc.fillColor(MUTED).fontSize(8).text('*  provider-set target', leftX, doc.y)
      }

      // Footer
      const footerText = `BP control ${pctStr(report.control.controlRatePct)}  ·  ${report.totalAlertsInQuarter} alerts  ·  Cardioplace Quarterly Outcomes`
      const range = doc.bufferedPageRange()
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i)
        const footerY = doc.page.height - doc.page.margins.bottom - 14
        doc.font('Helvetica').fillColor(MUTED).fontSize(8)
          .text(footerText, leftX, footerY, { width: pageWidth, align: 'center', lineBreak: false })
      }

      doc.end()
    })
  }
}
