import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service.js'
import { GeminiService } from '../../gemini/gemini.service.js'
import { EmbeddingService } from '../../common/embedding.service.js'

/**
 * How many of the most-recent turns getConversationHistory pulls verbatim
 * (the `LIMIT 12` chronological window). Shared with getSessionSummary so
 * the rolling-summary slice excludes the same turns that are already going
 * to Gemini raw — avoids the model seeing the same exchange twice (once in
 * the system-prompt summary + once in the contents array).
 *
 * Bump in lock-step with the LIMIT 12 in the raw-history queries below.
 */
const RAW_RECENT_TURNS = 12

@Injectable()
export class ConversationHistoryService {
  private readonly logger = new Logger(ConversationHistoryService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly geminiService: GeminiService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  // ── Retrieval ───────────────────────────────────────────────────────────────

  /**
   * Retrieve the most relevant past messages for a session using vector
   * similarity. Works for both text and voice rows since all have embeddings.
   *
   * Multi-tenant safety: the raw SQL below joins on Session so the userId is
   * enforced inside the query itself — even if a caller someday forgets to
   * validate sessionId upstream, no cross-patient rows can leak. A foreign
   * sessionId returns an empty result + a `[SECURITY] cross_tenant_attempt`
   * log line for ops alerting.
   */
  async getConversationHistory(
    userId: string,
    sessionId: string,
    query: string,
  ): Promise<[string, string][]> {
    try {
      if (!userId || !sessionId) return []

      // Defense-in-depth: confirm the session actually belongs to this user
      // BEFORE running the embedding similarity query (which is the expensive
      // step). Mismatch → log + bail out, no DB rows returned.
      const session = await this.prisma.session.findFirst({
        where: { id: sessionId, userId },
        select: { id: true },
      })
      if (!session) {
        this.logger.warn(
          `[SECURITY] cross_tenant_attempt service=conversation_history userId=${userId} sessionId=${sessionId}`,
        )
        return []
      }

      type RawRow = { userMessage: string; aiSummary: string; timestamp: Date }

      // 1. Always get the last 12 turns chronologically (ensures recent context).
      // The Session join keeps the userId predicate inside the SQL so any
      // future schema migration (or accidental sessionId-only call site) can't
      // bypass tenant isolation at the raw-SQL layer.
      const recentRows: RawRow[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT c."userMessage", c."aiSummary", c.timestamp
         FROM "Conversation" c
         JOIN "Session" s ON s.id = c."sessionId"
         WHERE c."sessionId" = $1 AND s."userId" = $2
         ORDER BY c.timestamp DESC
         LIMIT 12`,
        sessionId,
        userId,
      )

      // 2. If query is provided, also get similar turns via vector search
      let similarRows: RawRow[] = []
      if (query?.trim()) {
        try {
          const embeddingResponse = await this.embeddingService.getEmbeddings(query)
          const queryEmbedding = embeddingResponse.data[0]?.embedding
          if (queryEmbedding && queryEmbedding.length > 0) {
            const embeddingString = `[${queryEmbedding.join(',')}]`
            similarRows = await (this.prisma as any).$queryRawUnsafe(
              `SELECT c."userMessage", c."aiSummary", c.timestamp
               FROM "Conversation" c
               JOIN "Session" s ON s.id = c."sessionId"
               WHERE c."sessionId" = $1 AND s."userId" = $2 AND c.embedding IS NOT NULL
               ORDER BY c.embedding <-> $3::vector
               LIMIT 6`,
              sessionId,
              userId,
              embeddingString,
            )
          }
        } catch {
          // Vector search failed — continue with chronological only
        }
      }

      // 3. Merge and deduplicate
      const seen = new Set<string>()
      const merged: RawRow[] = []
      for (const row of [...recentRows, ...similarRows]) {
        const key = `${new Date(row.timestamp).getTime()}:${row.userMessage.slice(0, 30)}`
        if (!seen.has(key)) {
          seen.add(key)
          merged.push(row)
        }
      }

      // 4. Sort chronologically
      const sorted = merged.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      )

      const history: [string, string][] = []
      for (const row of sorted) {
        history.push(['human', row.userMessage])
        history.push(['ai', row.aiSummary])
      }

      console.log(`Retrieved ${history.length / 2} conversation turns for session ${sessionId} (${recentRows.length} recent, ${similarRows.length} similar)`)
      return history
    } catch (error) {
      console.error('Error retrieving conversation history:', error)
      return []
    }
  }

  /**
   * Read the rolling session summary for the LLM system prompt. One DB read,
   * no LLM call.
   *
   * The stored `Session.summary` is a hybrid of LLM-compressed bullets (at
   * the top, written by updateRollingSummary every 10 messages) plus a tail
   * of per-turn append lines in the format `- [Text|Voice] Patient: … → AI: …`
   * (one line per turn since the last compression).
   *
   * The most-recent RAW_RECENT_TURNS append lines correspond to the same
   * turns getConversationHistory ships raw in the Gemini `contents` array.
   * Returning the WHOLE summary here would duplicate those exchanges (once
   * verbatim in contents + once as an append line in the prompt) — wasted
   * tokens AND a known echo-bias trigger in long-context models. We strip
   * those tail appends here so the prompt-side summary is genuinely the
   * "older history" tier of the hybrid memory.
   */
  async getSessionSummary(userId: string, sessionId: string): Promise<string> {
    if (!userId || !sessionId) return ''
    try {
      // Bug 9 fix — match the userId-scope guard on the sibling
      // getConversationHistory call. Without it, a user passing another
      // user's sessionId would receive the foreign session's rolling
      // summary in their system prompt while getConversationHistory
      // correctly returned []. Cross-tenant leak via the LLM context.
      const session = await this.prisma.session.findFirst({
        where: { id: sessionId, userId },
        select: { summary: true },
      })
      if (!session) {
        this.logger.warn(
          `[SECURITY] cross_tenant_attempt service=conversation_history.summary userId=${userId} sessionId=${sessionId}`,
        )
        return ''
      }
      return sliceSummaryForPrompt(session.summary ?? '', RAW_RECENT_TURNS)
    } catch {
      return ''
    }
  }

  /**
   * Bug 17 — read the rolling session summary for voice's Gemini Live system
   * instruction. Unlike text chat (which slices off the last 12 append lines
   * because they're already shipped verbatim in the Gemini `contents` array),
   * VOICE has no `contents` array — the system instruction is the ONLY way
   * to seed Gemini Live with the prior conversation at session open. So we
   * return the WHOLE summary (compressed bullets + ALL append lines) without
   * slicing.
   *
   * Same userId-scope + `[SECURITY] cross_tenant_attempt` guard as the text
   * sibling above. The summary includes both `[Text]` and `[Voice]` tagged
   * turns thanks to `updateRollingSummary`'s label, so when voice joins a
   * conversation that already has text turns (or vice versa), Gemini Live
   * gets the full picture across modalities.
   */
  async getSessionSummaryForVoice(
    userId: string,
    sessionId: string,
  ): Promise<string> {
    if (!userId || !sessionId) return ''
    try {
      const session = await this.prisma.session.findFirst({
        where: { id: sessionId, userId },
        select: { summary: true },
      })
      if (!session) {
        this.logger.warn(
          `[SECURITY] cross_tenant_attempt service=conversation_history.summary_for_voice userId=${userId} sessionId=${sessionId}`,
        )
        return ''
      }
      return session.summary ?? ''
    } catch {
      return ''
    }
  }

  // ── Saving ──────────────────────────────────────────────────────────────────

  /**
   * Save a text chat turn: summarise the AI response, embed, persist,
   * and incrementally update the session rolling summary.
   */
  async saveConversation(
    sessionId: string,
    userMessage: string,
    rawAiResponse: string,
  ): Promise<void> {
    try {
      if (!userMessage?.trim() && !rawAiResponse?.trim()) return

      const aiSummary = this.summariseText(rawAiResponse)

      // Generate embedding
      const content = `Patient: ${userMessage}\nAI: ${aiSummary}`
      const embeddingResponse = await this.embeddingService.getEmbeddings(content)
      const embedding = embeddingResponse.data[0]?.embedding

      if (embedding && embedding.length > 0) {
        const embeddingString = `[${embedding.join(',')}]`
        await (this.prisma as any).$executeRawUnsafe(
          `INSERT INTO "Conversation" (id, "sessionId", "userMessage", "aiSummary", source, embedding)
           VALUES (gen_random_uuid(), $1, $2, $3, 'text', $4::vector)`,
          sessionId,
          userMessage,
          aiSummary,
          embeddingString,
        )
      } else {
        await (this.prisma as any).$executeRawUnsafe(
          `INSERT INTO "Conversation" (id, "sessionId", "userMessage", "aiSummary", source)
           VALUES (gen_random_uuid(), $1, $2, $3, 'text')`,
          sessionId,
          userMessage,
          aiSummary,
        )
      }

      // Incrementally update the session rolling summary
      await this.updateRollingSummary(sessionId, userMessage, aiSummary, 'text')

      console.log(`Saved text conversation for session ${sessionId}`)
    } catch (error) {
      console.error('Error saving conversation:', error)
    }
  }

  /**
   * Save a voice session turn (already summarised patient + AI parts),
   * generate embedding, and update the session rolling summary.
   */
  async saveVoiceConversation(
    sessionId: string,
    patientSummary: string,
    aiSummary: string,
  ): Promise<void> {
    try {
      const content = `Patient: ${patientSummary}\nAI: ${aiSummary}`
      const embeddingResponse = await this.embeddingService.getEmbeddings(content)
      const embedding = embeddingResponse.data[0]?.embedding

      if (embedding && embedding.length > 0) {
        const embeddingString = `[${embedding.join(',')}]`
        await (this.prisma as any).$executeRawUnsafe(
          `INSERT INTO "Conversation" (id, "sessionId", "userMessage", "aiSummary", source, embedding)
           VALUES (gen_random_uuid(), $1, $2, $3, 'voice', $4::vector)`,
          sessionId,
          patientSummary,
          aiSummary,
          embeddingString,
        )
      } else {
        await (this.prisma as any).$executeRawUnsafe(
          `INSERT INTO "Conversation" (id, "sessionId", "userMessage", "aiSummary", source)
           VALUES (gen_random_uuid(), $1, $2, $3, 'voice')`,
          sessionId,
          patientSummary,
          aiSummary,
        )
      }

      // Incrementally update the session rolling summary
      await this.updateRollingSummary(sessionId, patientSummary, aiSummary, 'voice')

      console.log(`Saved voice conversation for session ${sessionId}`)
    } catch (error) {
      console.error('Error saving voice conversation:', error)
    }
  }

  /**
   * Save individual voice transcript lines as separate Conversation rows
   * (for frontend display) AND update the rolling session summary
   * (for system prompt context).
   */
  async saveVoiceTranscriptLines(
    sessionId: string,
    lines: Array<{ speaker: 'user' | 'agent'; text: string }>,
  ): Promise<void> {
    if (lines.length === 0) return

    try {
      // Group consecutive lines by speaker into turns
      const turns: Array<{ userMessage: string; aiSummary: string }> = []
      let currentUser = ''
      let currentAgent = ''

      for (const line of lines) {
        if (line.speaker === 'user') {
          // If we had agent text, flush the turn
          if (currentAgent) {
            turns.push({ userMessage: currentUser || '[voice]', aiSummary: currentAgent })
            currentUser = ''
            currentAgent = ''
          }
          currentUser += (currentUser ? ' ' : '') + line.text
        } else {
          currentAgent += (currentAgent ? ' ' : '') + line.text
        }
      }
      // Flush remaining
      if (currentUser || currentAgent) {
        turns.push({
          userMessage: currentUser || '[voice]',
          aiSummary: currentAgent || '[voice response]',
        })
      }

      // Save each turn as a Conversation row with embedding
      for (const turn of turns) {
        const content = `Patient: ${turn.userMessage}\nAI: ${turn.aiSummary}`
        let embeddingString: string | null = null
        try {
          const embeddingResponse = await this.embeddingService.getEmbeddings(content)
          const embedding = embeddingResponse.data[0]?.embedding
          if (embedding && embedding.length > 0) {
            embeddingString = `[${embedding.join(',')}]`
          }
        } catch {
          // Continue without embedding
        }

        if (embeddingString) {
          await (this.prisma as any).$executeRawUnsafe(
            `INSERT INTO "Conversation" (id, "sessionId", "userMessage", "aiSummary", source, embedding)
             VALUES (gen_random_uuid(), $1, $2, $3, 'voice', $4::vector)`,
            sessionId,
            turn.userMessage,
            turn.aiSummary,
            embeddingString,
          )
        } else {
          await (this.prisma as any).$executeRawUnsafe(
            `INSERT INTO "Conversation" (id, "sessionId", "userMessage", "aiSummary", source)
             VALUES (gen_random_uuid(), $1, $2, $3, 'voice')`,
            sessionId,
            turn.userMessage,
            turn.aiSummary,
          )
        }
      }

      // Generate a concise LLM summary for the session (not the raw transcript)
      const transcript = turns
        .map((t) => `Patient: ${t.userMessage}\nAI: ${t.aiSummary}`)
        .join('\n')

      let summary: string
      try {
        const result = await this.geminiService.getChatCompletion([
          {
            role: 'system',
            content:
              'You are a medical scribe. Summarise this voice conversation in 3–5 concise bullet points. ' +
              'Preserve specific numbers (BP values, weight, dates). Focus on what the patient reported, ' +
              'what actions were taken (check-ins saved, readings viewed, entries updated/deleted), ' +
              'and any health concerns discussed. Return only bullet points, no preamble.',
          },
          { role: 'user', content: transcript },
        ])
        summary = (result.choices?.[0]?.message?.content as string | undefined)?.trim() ?? ''
      } catch {
        summary = ''
      }

      // Fallback: generate a basic summary from the turns if LLM failed
      if (!summary) {
        summary = turns
          .slice(0, 3)
          .map((t) => `- Patient: ${t.userMessage.slice(0, 80)}`)
          .join('\n')
      }

      // Merge with any existing summary (from action events saved earlier)
      const existing = await this.prisma.session.findUnique({
        where: { id: sessionId },
        select: { summary: true, messageCount: true },
      })
      const prevSummary = existing?.summary ?? ''
      const mergedSummary = prevSummary && !prevSummary.includes('Voice conversation about cardiovascular health')
        ? prevSummary + '\n' + summary
        : summary

      await this.prisma.session.update({
        where: { id: sessionId },
        data: { summary: mergedSummary, messageCount: (existing?.messageCount ?? 0) + turns.length },
      })

      console.log(`Saved ${turns.length} voice transcript turns for session ${sessionId} with LLM summary`)
    } catch (error) {
      console.error('Error saving voice transcript lines:', error)
      // Even if conversation rows failed, try to save a brief summary
      try {
        const userLines = lines.filter((l) => l.speaker === 'user')
        const topics = userLines.slice(0, 3).map((l) => l.text.slice(0, 60))
        const basicSummary = topics.length > 0
          ? `- Voice conversation topics: ${topics.join('; ')}`
          : '- Voice conversation (transcript save failed)'
        await this.prisma.session.update({
          where: { id: sessionId },
          data: { summary: basicSummary },
        })
        console.log(`[Voice Summary] Fallback summary saved for session ${sessionId}`)
      } catch (fallbackErr) {
        console.error('Fallback summary also failed:', fallbackErr)
      }
    }
  }

  // ── Rolling summary ─────────────────────────────────────────────────────────

  /**
   * Incrementally update Session.summary by appending new exchange.
   * Uses simple truncation to keep size bounded — no LLM call.
   * The LLM-based summary is done lazily only when messageCount hits
   * a threshold (every 10 messages) to save API quota.
   */
  private async updateRollingSummary(
    sessionId: string,
    userMessage: string,
    aiSummary: string,
    source: 'text' | 'voice',
  ): Promise<void> {
    try {
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        select: { summary: true, messageCount: true },
      })
      if (!session) return

      const currentSummary = session.summary ?? ''
      const newCount = (session.messageCount ?? 0) + 1
      const label = source === 'voice' ? 'Voice' : 'Text'
      const truncatedAi = aiSummary.length > 200 ? aiSummary.slice(0, 197) + '...' : aiSummary
      const newLine = `- [${label}] Patient: ${userMessage.slice(0, 100)} → AI: ${truncatedAi}`

      let updatedSummary: string

      // Compression triggers:
      //   • count-based (every 10 messages once the summary is non-trivial)
      //     — keeps long sessions periodically distilled even when turns are
      //       short and never breach the byte budget.
      //   • budget-based (whenever appending the new line would push the
      //     summary past SUMMARY_SOFT_BUDGET chars) — fires BEFORE the simple-
      //     append fallback below starts dropping the oldest lines, so
      //     middle-of-session turns survive instead of being silently
      //     truncated on a chatty patient.
      const SUMMARY_SOFT_BUDGET = 1500
      const shouldCompressByCount = newCount % 10 === 0 && currentSummary.length > 500
      const shouldCompressByBudget = (currentSummary + '\n' + newLine).length > SUMMARY_SOFT_BUDGET
      if (shouldCompressByCount || shouldCompressByBudget) {
        try {
          const result = await this.geminiService.getChatCompletion([
            {
              role: 'system',
              content:
                'You are a medical scribe. Compress this chat summary into 4–6 bullet points. ' +
                'Preserve specific numbers (BP values, weight, dates). Return only bullet points.',
            },
            { role: 'user', content: currentSummary + '\n' + newLine },
          ])
          updatedSummary =
            (result.choices?.[0]?.message?.content as string | undefined)?.trim() ?? (currentSummary + '\n' + newLine)
        } catch {
          // LLM failed — just append
          updatedSummary = currentSummary + '\n' + newLine
        }
      } else {
        // Simple append — keep last ~2000 chars
        updatedSummary = currentSummary + '\n' + newLine
        if (updatedSummary.length > 2000) {
          const lines = updatedSummary.split('\n')
          while (updatedSummary.length > 1500 && lines.length > 3) {
            lines.shift()
            updatedSummary = lines.join('\n')
          }
        }
      }

      await this.prisma.session.update({
        where: { id: sessionId },
        data: { summary: updatedSummary, messageCount: newCount },
      })
      console.log(`[Rolling Summary] Updated session ${sessionId} (count=${newCount}, len=${updatedSummary.length})`)
    } catch (error) {
      console.error('[Rolling Summary] FAILED for session', sessionId, error)
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private summariseText(text: string): string {
    return text ?? ''
  }
}

// ── Module-level helpers ─────────────────────────────────────────────────────

/** Lines in `Session.summary` that correspond to a single un-compressed turn
 *  use the literal `- [Text] Patient: …` / `- [Voice] Patient: …` template
 *  written by updateRollingSummary. LLM-compressed bullets don't match this
 *  pattern (the medical-scribe prompt returns "•" or "-" bullets WITHOUT
 *  the `[Text]/[Voice]` tag). The boundary lets us cleanly separate the
 *  compressed-old block from the appended-recent block.
 */
const APPEND_LINE_PATTERN = /^-\s*\[(?:Text|Voice)\]\s/

/**
 * Return the rolling summary with the most-recent `excludeRecent` append
 * lines removed — those exchanges are about to be sent raw in Gemini's
 * `contents` array, so duplicating them in the system prompt is pure waste.
 *
 * Compressed bullets (above the first append line) are always kept — they
 * cover history older than the raw window and have no exchange-for-exchange
 * overlap with what `getConversationHistory` returns.
 *
 * If there are no append lines at all (we're between compressions and the
 * summary is pure bullets), this is a no-op — the full bullet summary
 * ships, since none of it can possibly overlap with raw recent turns.
 */
export function sliceSummaryForPrompt(summary: string, excludeRecent: number): string {
  if (!summary) return ''
  if (excludeRecent <= 0) return summary
  const lines = summary.split('\n')
  const firstAppendIdx = lines.findIndex((l) => APPEND_LINE_PATTERN.test(l))
  if (firstAppendIdx === -1) return summary
  const compressed = lines.slice(0, firstAppendIdx)
  const appends = lines.slice(firstAppendIdx)
  const olderAppends = appends.slice(0, Math.max(0, appends.length - excludeRecent))
  return [...compressed, ...olderAppends].join('\n').trim()
}
