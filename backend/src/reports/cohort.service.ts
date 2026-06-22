import { Injectable, NotFoundException } from '@nestjs/common'
import {
  COHORT_KEYS,
  COHORT_LABELS,
  QUARTERLY_RULES,
  type CohortKey,
  type CohortReport,
  type CohortRow,
} from '@cardioplace/shared'
import PDFDocument from 'pdfkit'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  monthWindowInTz,
  previousMonthInTz,
  ReportsService,
  type PracticeRow,
  type ReportsActor,
} from './reports.service.js'

function pct(part: number, whole: number): number | null {
  if (whole === 0) return null
  return Math.round((part / whole) * 10000) / 100
}

@Injectable()
export class CohortService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
  ) {}

  async getCohorts(params: {
    caller: ReportsActor
    practiceId: string
    monthYear?: string
  }): Promise<CohortReport> {
    await this.reports.assertCanRead(params.caller, params.practiceId)

    const practice = await this.prisma.practice.findUnique({
      where: { id: params.practiceId },
      select: { id: true, name: true, businessHoursTimezone: true },
    })
    if (!practice) throw new NotFoundException('Practice not found')

    const month =
      params.monthYear ??
      previousMonthInTz(new Date(), practice.businessHoursTimezone)
    const { start, end } = monthWindowInTz(month, practice.businessHoursTimezone)
    return this.compute(practice, month, start, end)
  }

  /** Pure compute — no auth. */
  async compute(
    practice: PracticeRow,
    monthYear: string,
    start: Date,
    end: Date,
  ): Promise<CohortReport> {
    const assignments = await this.prisma.patientProviderAssignment.findMany({
      where: { practiceId: practice.id },
      select: { userId: true },
    })
    const rosterIds = assignments.map((a) => a.userId)

    const defaultSbpUpper = QUARTERLY_RULES.defaultSbpUpper
    const defaultDbpUpper = QUARTERLY_RULES.defaultDbpUpper

    if (rosterIds.length === 0) {
      return this.empty(practice, monthYear, start, end)
    }

    // Profiles → cohort membership + verification.
    const profiles = await this.prisma.patientProfile.findMany({
      where: { userId: { in: rosterIds } },
      select: {
        userId: true,
        hasHeartFailure: true,
        heartFailureType: true,
        hasCAD: true,
        isPregnant: true,
        profileVerificationStatus: true,
      },
    })
    const profileById = new Map(profiles.map((p) => [p.userId, p]))

    // BP readings in the window.
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        userId: { in: rosterIds },
        measuredAt: { gte: start, lt: end },
        systolicBP: { not: null },
        diastolicBP: { not: null },
      },
      select: { userId: true, systolicBP: true, diastolicBP: true },
    })

    // Per-patient provider targets (active only).
    const thresholds = await this.prisma.patientThreshold.findMany({
      where: { userId: { in: rosterIds }, replacedAt: null },
      select: { userId: true, sbpUpperTarget: true, dbpUpperTarget: true },
    })
    const thresholdById = new Map(thresholds.map((t) => [t.userId, t]))

    // Alerts in the window.
    const alerts = await this.prisma.deviationAlert.findMany({
      where: { userId: { in: rosterIds }, createdAt: { gte: start, lt: end } },
      select: { userId: true },
    })
    const alertCountById = new Map<string, number>()
    for (const a of alerts) {
      alertCountById.set(a.userId, (alertCountById.get(a.userId) ?? 0) + 1)
    }

    // Per-patient BP average + controlled flag.
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
    const controlledById = new Map<string, boolean>()
    for (const [id, a] of accById) {
      const meanS = a.sbpSum / a.n
      const meanD = a.dbpSum / a.n
      const t = thresholdById.get(id)
      const sbpUpper = t?.sbpUpperTarget ?? defaultSbpUpper
      const dbpUpper = t?.dbpUpperTarget ?? defaultDbpUpper
      controlledById.set(id, meanS <= sbpUpper && meanD <= dbpUpper)
    }

    // Cohort membership per patient (overlapping).
    const cohortsOf = (userId: string): CohortKey[] => {
      const keys: CohortKey[] = ['ALL']
      const p = profileById.get(userId)
      if (!p) return keys
      if (p.hasHeartFailure && p.heartFailureType === 'HFREF') keys.push('HFREF')
      if (p.hasCAD) keys.push('CAD')
      if (p.isPregnant) keys.push('PREGNANCY')
      return keys
    }
    const isUnverified = (userId: string): boolean => {
      const p = profileById.get(userId)
      return !p || p.profileVerificationStatus !== 'VERIFIED'
    }

    // Aggregate per cohort.
    const rows: CohortRow[] = COHORT_KEYS.map((cohort) => {
      const members = rosterIds.filter((id) => cohortsOf(id).includes(cohort))
      const withReadings = members.filter((id) => accById.has(id))
      const controlled = withReadings.filter((id) => controlledById.get(id))
      const alertCount = members.reduce(
        (s, id) => s + (alertCountById.get(id) ?? 0),
        0,
      )
      const unverified = members.filter((id) => isUnverified(id)).length
      return {
        cohort,
        label: COHORT_LABELS[cohort],
        patientCount: members.length,
        patientsWithReadings: withReadings.length,
        controlled: controlled.length,
        controlRatePct: pct(controlled.length, withReadings.length),
        alertCount,
        unverifiedProfiles: unverified,
      }
    })

    return {
      practiceId: practice.id,
      practiceName: practice.name,
      practiceTimezone: practice.businessHoursTimezone,
      monthYear,
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      generatedAt: new Date().toISOString(),
      provisional: true,
      defaultSbpUpper,
      defaultDbpUpper,
      totalPatients: rosterIds.length,
      rows,
    }
  }

  private empty(
    practice: PracticeRow,
    monthYear: string,
    start: Date,
    end: Date,
  ): CohortReport {
    return {
      practiceId: practice.id,
      practiceName: practice.name,
      practiceTimezone: practice.businessHoursTimezone,
      monthYear,
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      generatedAt: new Date().toISOString(),
      provisional: true,
      defaultSbpUpper: QUARTERLY_RULES.defaultSbpUpper,
      defaultDbpUpper: QUARTERLY_RULES.defaultDbpUpper,
      totalPatients: 0,
      rows: COHORT_KEYS.map((cohort) => ({
        cohort,
        label: COHORT_LABELS[cohort],
        patientCount: 0,
        patientsWithReadings: 0,
        controlled: 0,
        controlRatePct: null,
        alertCount: 0,
        unverifiedProfiles: 0,
      })),
    }
  }

  // ─── CSV ──────────────────────────────────────────────────────────────────
  toCsv(report: CohortReport): string {
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
    row('Month', report.monthYear)
    row('Window', `${report.windowStart} → ${report.windowEnd}`)
    row('Timezone', report.practiceTimezone)
    row('Generated', report.generatedAt)
    row('Default control target', `${report.defaultSbpUpper}/${report.defaultDbpUpper}`)
    row('BP-control definition', 'PROVISIONAL — pending clinical sign-off')
    row('Note', 'Cohorts overlap; a patient can appear in more than one.')
    row('')

    row('BY COHORT')
    row(
      'Cohort',
      'Patients',
      'With readings',
      'Controlled',
      'BP control rate',
      'Alerts',
      'Unverified profiles',
    )
    for (const r of report.rows) {
      row(
        r.label,
        r.patientCount,
        r.patientsWithReadings,
        r.controlled,
        pctStr(r.controlRatePct),
        r.alertCount,
        r.unverifiedProfiles,
      )
    }
    return lines.join('\n') + '\n'
  }

  // ─── PDF ──────────────────────────────────────────────────────────────────
  toPdf(report: CohortReport): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 44, bottom: 56, left: 44, right: 44 },
        bufferPages: true,
        info: {
          Title: `Cohort Report — ${report.practiceName} — ${report.monthYear}`,
          Author: 'Cardioplace',
          Subject: 'Per-Condition Cohort Report',
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
      const HEADER_BG = '#F8FAFC'
      const BORDER = '#E5E7EB'
      const ZEBRA = '#FAFBFF'

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
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

      doc.font('Helvetica-Bold').fillColor(TEXT).fontSize(20)
        .text('Per-Condition Cohort Report', leftX, doc.y, { characterSpacing: 0.2 })
      doc.font('Helvetica').moveDown(0.2)
      doc.fillColor(PURPLE).fontSize(13)
        .text(`${report.practiceName} | ${report.monthYear}`, leftX, doc.y)
      doc.moveDown(0.3)
      doc.fillColor(MUTED).fontSize(9).text(
        `Window: ${fmtDate(report.windowStart)} | ${fmtDate(report.windowEnd)}  ·  ${report.practiceTimezone}  ·  ${report.totalPatients} patients  ·  default target ${report.defaultSbpUpper}/${report.defaultDbpUpper}`,
        leftX, doc.y,
      )
      doc.moveDown(0.3)
      doc.fillColor(MUTED).fontSize(8).text(
        'Cohorts overlap — a patient with more than one condition is counted in each. Control definition is provisional, pending sign-off.',
        leftX, doc.y, { width: pageWidth },
      )
      doc.moveDown(1.0)

      type Col = { label: string; width: number; align?: 'left' | 'right' }
      const cols: Col[] = [
        { label: 'Cohort', width: 0.2 },
        { label: 'Patients', width: 0.13, align: 'right' },
        { label: 'With readings', width: 0.16, align: 'right' },
        { label: 'Controlled', width: 0.13, align: 'right' },
        { label: 'Control rate', width: 0.14, align: 'right' },
        { label: 'Alerts', width: 0.1, align: 'right' },
        { label: 'Unverified', width: 0.14, align: 'right' },
      ]
      const cells = report.rows.map((r) => [
        r.label,
        String(r.patientCount),
        String(r.patientsWithReadings),
        String(r.controlled),
        pctStr(r.controlRatePct),
        String(r.alertCount),
        String(r.unverifiedProfiles),
      ])

      const HEADER_H = 30
      const ROW_H = 22
      const CELL_PAD_X = 6
      const drawHeader = (top: number) => {
        doc.save()
        doc.fillColor(HEADER_BG).rect(leftX, top, pageWidth, HEADER_H).fill()
        doc.restore()
        let cx = leftX
        doc.font('Helvetica-Bold').fillColor(TEXT).fontSize(8)
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
      for (let i = 0; i < cells.length; i++) {
        if (i % 2 === 1) {
          doc.save()
          doc.fillColor(ZEBRA).rect(leftX, top + y, pageWidth, ROW_H).fill()
          doc.restore()
        }
        // Emphasise the "All patients" baseline row.
        const isBaseline = report.rows[i].cohort === 'ALL'
        let cx = leftX
        doc.font(isBaseline ? 'Helvetica-Bold' : 'Helvetica').fillColor(TEXT_SOFT).fontSize(8.5)
        for (let j = 0; j < cols.length; j++) {
          const w = cols[j].width * pageWidth
          doc.text(cells[i][j], cx + CELL_PAD_X, top + y + 7, {
            width: w - CELL_PAD_X * 2, align: cols[j].align ?? 'left',
            lineBreak: false, ellipsis: true,
          })
          cx += w
        }
        y += ROW_H
      }
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
      doc.y = top + y

      const footerText = `${report.totalPatients} patients  ·  Cardioplace Cohort Report`
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
