import { Injectable, NotFoundException } from '@nestjs/common'
import {
  TIER_RESOLVE_SLA_MINUTES,
  TIER_SLA_MINUTES,
  type MonthlyReport,
  type SlaReport,
  type SlaTierRow,
} from '@cardioplace/shared'
import PDFDocument from 'pdfkit'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  monthWindowInTz,
  previousMonthInTz,
  ReportsService,
  type ReportsActor,
} from './reports.service.js'

function pct(part: number, whole: number): number | null {
  if (whole === 0) return null
  return Math.round((part / whole) * 10000) / 100
}

@Injectable()
export class SlaService {
  constructor(
    private readonly prisma: PrismaService,
    // Reuse the monthly aggregation verbatim so SLA numbers always match the
    // Monthly report (same means, same acked-in-window counts).
    private readonly reports: ReportsService,
  ) {}

  async getSla(params: {
    caller: ReportsActor
    practiceId: string
    monthYear?: string
  }): Promise<SlaReport> {
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

    const monthly = await this.reports.compute(practice, month, start, end)
    return this.fromMonthly(monthly)
  }

  /** Map a MonthlyReport into the SLA scorecard. Pure — easy to unit test. */
  fromMonthly(monthly: MonthlyReport): SlaReport {
    const byTier: SlaTierRow[] = monthly.byTier.map((t) => {
      const ackTargetSeconds = TIER_SLA_MINUTES[t.tier] * 60
      const resolveTargetSeconds = TIER_RESOLVE_SLA_MINUTES[t.tier] * 60
      const ackPass =
        t.meanAckSeconds === null
          ? null
          : t.meanAckSeconds <= ackTargetSeconds
      const resolvePass =
        t.meanResolveSeconds === null
          ? null
          : t.meanResolveSeconds <= resolveTargetSeconds
      return {
        tier: t.tier,
        total: t.total,
        ackTargetSeconds,
        meanAckSeconds: t.meanAckSeconds,
        // acknowledgedInWindow is already "acked within the ack target".
        ackWithinPct: t.total > 0 ? pct(t.acknowledgedInWindow, t.total) : null,
        ackPass,
        resolveTargetSeconds,
        meanResolveSeconds: t.meanResolveSeconds,
        resolvePass,
      }
    })

    const tiersFailing = byTier.filter(
      (r) => r.ackPass === false || r.resolvePass === false,
    ).length

    return {
      practiceId: monthly.practiceId,
      practiceName: monthly.practiceName,
      monthYear: monthly.monthYear,
      windowStart: monthly.windowStart,
      windowEnd: monthly.windowEnd,
      practiceTimezone: monthly.practiceTimezone,
      generatedAt: monthly.generatedAt,
      provisional: true,
      overallAckWithinPct: monthly.overall.acknowledgedInWindowPct,
      tiersFailing,
      byTier,
    }
  }

  // ─── CSV ──────────────────────────────────────────────────────────────────
  toCsv(report: SlaReport): string {
    const lines: string[] = []
    const esc = (v: string | number | null) => {
      if (v === null || v === undefined) return ''
      const s = String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const row = (...cells: Array<string | number | null>) =>
      lines.push(cells.map(esc).join(','))
    const verdict = (p: boolean | null) =>
      p === null ? 'no data' : p ? 'PASS' : 'FAIL'

    row('Practice', report.practiceName)
    row('Month', report.monthYear)
    row('Window', `${report.windowStart} → ${report.windowEnd}`)
    row('Timezone', report.practiceTimezone)
    row('Generated', report.generatedAt)
    row('SLA targets', 'PROVISIONAL — pending clinical sign-off')
    row('')

    row('SLA BY TIER')
    row(
      'Tier',
      'Alerts',
      'Ack target',
      'Mean ack',
      'Ack within target %',
      'Ack verdict',
      'Resolve target',
      'Mean resolve',
      'Resolve verdict',
    )
    for (const r of report.byTier) {
      row(
        r.tier.replace(/_/g, ' '),
        r.total,
        durationLabel(r.ackTargetSeconds),
        durationLabel(r.meanAckSeconds),
        r.ackWithinPct === null ? '' : `${r.ackWithinPct}%`,
        verdict(r.ackPass),
        durationLabel(r.resolveTargetSeconds),
        durationLabel(r.meanResolveSeconds),
        verdict(r.resolvePass),
      )
    }
    return lines.join('\n') + '\n'
  }

  // ─── PDF ──────────────────────────────────────────────────────────────────
  toPdf(report: SlaReport): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 44, bottom: 56, left: 44, right: 44 },
        bufferPages: true,
        info: {
          Title: `SLA Report — ${report.practiceName} — ${report.monthYear}`,
          Author: 'Cardioplace',
          Subject: 'Alert-Resolution-Time SLA Report',
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
      const GREEN = '#15803D'
      const RED = '#B91C1C'

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

      // Header
      doc.font('Helvetica-Bold').fillColor(TEXT).fontSize(20)
        .text('Alert SLA Report', leftX, doc.y, { characterSpacing: 0.2 })
      doc.font('Helvetica').moveDown(0.2)
      doc.fillColor(PURPLE).fontSize(13)
        .text(`${report.practiceName} | ${report.monthYear}`, leftX, doc.y)
      doc.moveDown(0.3)
      doc.fillColor(MUTED).fontSize(9).text(
        `Window: ${fmtDate(report.windowStart)} | ${fmtDate(report.windowEnd)}  ·  ${report.practiceTimezone}  ·  generated ${fmtDate(report.generatedAt)}`,
        leftX, doc.y,
      )
      doc.moveDown(1.2)

      // KPI tiles
      const drawTile = (
        x: number, y: number, w: number, h: number,
        label: string, value: string, caption: string,
      ) => {
        doc.save()
        doc.roundedRect(x, y, w, h, 8).fillAndStroke(TILE_BG, TILE_BG)
        doc.fillColor(PURPLE).fontSize(8.5).text(label.toUpperCase(), x + 12, y + 10, { width: w - 24, characterSpacing: 0.8 })
        doc.fillColor(TEXT).fontSize(18).text(value, x + 12, y + 24, { width: w - 24 })
        doc.fillColor(MUTED).fontSize(8.5).text(caption, x + 12, y + 48, { width: w - 24 })
        doc.restore()
      }
      const tileGap = 12
      const tileW = (pageWidth - tileGap) / 2
      const tileH = 70
      const tileTop = doc.y
      drawTile(leftX, tileTop, tileW, tileH, 'Acked within target',
        report.overallAckWithinPct === null ? '—' : `${report.overallAckWithinPct}%`,
        'across all alerts')
      drawTile(leftX + tileW + tileGap, tileTop, tileW, tileH, 'Tiers failing',
        String(report.tiersFailing), 'mean over target')
      doc.y = tileTop + tileH
      doc.x = leftX
      doc.moveDown(1.2)

      // Table
      doc.font('Helvetica-Bold').fillColor(TEXT).fontSize(11)
        .text('SLA BY TIER', leftX, doc.y, { characterSpacing: 0.6 })
      doc.font('Helvetica').moveDown(0.4)
      doc.fillColor(MUTED).fontSize(8).text(
        'Verdict = PASS when the average time is at or below the target. Targets are provisional, pending sign-off.',
        leftX, doc.y, { width: pageWidth },
      )
      doc.moveDown(0.6)

      type Col = { label: string; width: number; align?: 'left' | 'right' }
      const cols: Col[] = [
        { label: 'Tier', width: 0.26 },
        { label: 'Ack target', width: 0.14, align: 'right' },
        { label: 'Mean ack', width: 0.15, align: 'right' },
        { label: 'Ack', width: 0.09, align: 'right' },
        { label: 'Resolve target', width: 0.15, align: 'right' },
        { label: 'Mean resolve', width: 0.13, align: 'right' },
        { label: 'Resolve', width: 0.08, align: 'right' },
      ]
      const HEADER_H = 30
      const ROW_H = 22
      const CELL_PAD_X = 6
      const FOOTER_RESERVE = 28
      const bottomLimit = doc.page.height - doc.page.margins.bottom - FOOTER_RESERVE

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
      const verdictLabel = (p: boolean | null) => (p === null ? '—' : p ? 'PASS' : 'FAIL')
      const verdictColor = (p: boolean | null) => (p === null ? MUTED : p ? GREEN : RED)

      for (let i = 0; i < report.byTier.length; i++) {
        const r = report.byTier[i]
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
        const values: Array<{ text: string; color?: string }> = [
          { text: r.tier.replace(/_/g, ' ') },
          { text: durationLabel(r.ackTargetSeconds) },
          { text: durationLabel(r.meanAckSeconds) },
          { text: verdictLabel(r.ackPass), color: verdictColor(r.ackPass) },
          { text: durationLabel(r.resolveTargetSeconds) },
          { text: durationLabel(r.meanResolveSeconds) },
          { text: verdictLabel(r.resolvePass), color: verdictColor(r.resolvePass) },
        ]
        let cx = leftX
        doc.font('Helvetica').fontSize(8.5)
        for (let j = 0; j < cols.length; j++) {
          const w = cols[j].width * pageWidth
          doc.fillColor(values[j].color ?? TEXT_SOFT)
          doc.text(values[j].text, cx + CELL_PAD_X, top + y + 7, {
            width: w - CELL_PAD_X * 2, align: cols[j].align ?? 'left',
            lineBreak: false, ellipsis: true,
          })
          cx += w
        }
        y += ROW_H
      }
      closeSegment()
      doc.y = top + y

      // Footer
      const footerText = `Acked within target ${report.overallAckWithinPct === null ? '—' : report.overallAckWithinPct + '%'}  ·  ${report.tiersFailing} tier(s) failing  ·  Cardioplace SLA Report`
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

/** Seconds → "15 min" / "4 h" / "2 d" / "—". Compact label for SLA tables. */
function durationLabel(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '—'
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min`
  const hours = mins / 60
  if (hours < 24) return `${Math.round(hours)} h`
  return `${Math.round(hours / 24)} d`
}
