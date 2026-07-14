import { Injectable } from '@nestjs/common'
import { randomInt } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service.js'

// Crockford base32 alphabet (no I, L, O, U — the same set the DisplayId ledger
// uses, so support numbers read like the rest of the Cardioplace ID family).
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const BODY_LEN = 7

/**
 * Generates the human-readable public ticket handle `CP-SUP-XXXXXXX`. Kept
 * separate from DisplayIdService (that one is user-FK/ledger-scoped and only
 * issues PAT/STF classes). Retries on the (astronomically unlikely) collision.
 */
@Injectable()
export class TicketNumberService {
  constructor(private readonly prisma: PrismaService) {}

  async next(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      let body = ''
      for (let i = 0; i < BODY_LEN; i++) {
        body += CROCKFORD[randomInt(CROCKFORD.length)]
      }
      const ticketNumber = `CP-SUP-${body}`
      const existing = await this.prisma.supportTicket.findUnique({
        where: { ticketNumber },
        select: { id: true },
      })
      if (!existing) return ticketNumber
    }
    throw new Error('Could not generate a unique support ticket number')
  }
}
