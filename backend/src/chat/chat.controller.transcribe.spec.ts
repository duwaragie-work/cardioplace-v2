// Focused tests for the new POST /chat/transcribe endpoint (Gemini-backed
// patient dictation). Covers DTO validation (mimeType allow-list, length
// cap, languageHint sanity), the controller's wiring to GeminiService, and
// the error-to-500 translation. Other ChatController routes are exercised
// in their own specs / e2e.

import { jest } from '@jest/globals'
import { Test } from '@nestjs/testing'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { ChatController } from './chat.controller.js'
import { ChatService } from './chat.service.js'
import { GeminiService } from '../gemini/gemini.service.js'
import { TranscribeRequestDto } from './dto/transcribe.dto.js'
import { HttpException } from '@nestjs/common'

const REQ_USER = { user: { id: 'user-A' } } as unknown as Parameters<
  ChatController['transcribe']
>[1]

describe('ChatController.transcribe — DTO validation', () => {
  function dto(over: Partial<TranscribeRequestDto> = {}): TranscribeRequestDto {
    return plainToInstance(TranscribeRequestDto, {
      audioBase64: 'AAAA', // valid base64
      mimeType: 'audio/webm;codecs=opus',
      ...over,
    })
  }

  it('accepts a valid payload with an allow-listed mimeType', async () => {
    const errors = await validate(dto())
    expect(errors).toEqual([])
  })

  it('accepts audio/webm without the codecs= suffix', async () => {
    const errors = await validate(dto({ mimeType: 'audio/webm' }))
    expect(errors).toEqual([])
  })

  it('accepts audio/mp4 (iOS Safari typical) and audio/mpeg', async () => {
    expect(await validate(dto({ mimeType: 'audio/mp4' }))).toEqual([])
    expect(await validate(dto({ mimeType: 'audio/mpeg' }))).toEqual([])
  })

  it('rejects a non-allow-listed mimeType (e.g. audio/aac)', async () => {
    const errors = await validate(dto({ mimeType: 'audio/aac' }))
    expect(errors.length).toBeGreaterThan(0)
    expect(JSON.stringify(errors[0].constraints)).toMatch(/supported/i)
  })

  it('rejects an empty audioBase64', async () => {
    const errors = await validate(dto({ audioBase64: '' }))
    expect(errors.length).toBeGreaterThan(0)
  })

  it('rejects an audioBase64 larger than ~13.5 MB (≈10 MB raw)', async () => {
    const huge = 'A'.repeat(14_000_000)
    const errors = await validate(dto({ audioBase64: huge }))
    expect(errors.length).toBeGreaterThan(0)
    expect(JSON.stringify(errors[0].constraints)).toMatch(/maximum/i)
  })

  it('accepts an optional languageHint of reasonable length', async () => {
    expect(await validate(dto({ languageHint: 'es-ES' }))).toEqual([])
    expect(await validate(dto({ languageHint: 'en' }))).toEqual([])
  })

  it('rejects a languageHint longer than 20 chars (likely abuse)', async () => {
    const errors = await validate(dto({ languageHint: 'a'.repeat(25) }))
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('ChatController.transcribe — wiring + error handling', () => {
  let controller: ChatController
  let geminiTranscribe: jest.Mock

  beforeEach(async () => {
    geminiTranscribe = jest.fn() as jest.Mock
    const moduleRef = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: {} },
        { provide: GeminiService, useValue: { transcribeAudio: geminiTranscribe } },
      ],
    }).compile()
    controller = moduleRef.get(ChatController)
  })

  it('forwards audioBase64, mimeType, and languageHint to GeminiService', async () => {
    geminiTranscribe.mockResolvedValue('I had a headache this morning' as never)
    const body = plainToInstance(TranscribeRequestDto, {
      audioBase64: 'AAAA',
      mimeType: 'audio/webm;codecs=opus',
      languageHint: 'es-ES',
    })
    const res = await controller.transcribe(body, REQ_USER)
    expect(geminiTranscribe).toHaveBeenCalledWith(
      'AAAA',
      'audio/webm;codecs=opus',
      'es-ES',
    )
    expect(res).toEqual({ transcript: 'I had a headache this morning' })
  })

  it('omits languageHint when not provided (Gemini auto-detects)', async () => {
    geminiTranscribe.mockResolvedValue('test' as never)
    const body = plainToInstance(TranscribeRequestDto, {
      audioBase64: 'AAAA',
      mimeType: 'audio/webm',
    })
    await controller.transcribe(body, REQ_USER)
    expect(geminiTranscribe).toHaveBeenCalledWith('AAAA', 'audio/webm', undefined)
  })

  it('translates a GeminiService throw into a 500 HttpException', async () => {
    geminiTranscribe.mockRejectedValue(new Error('Gemini API down') as never)
    const body = plainToInstance(TranscribeRequestDto, {
      audioBase64: 'AAAA',
      mimeType: 'audio/webm',
    })
    await expect(controller.transcribe(body, REQ_USER)).rejects.toThrow(HttpException)
    await expect(controller.transcribe(body, REQ_USER)).rejects.toMatchObject({
      status: 500,
      message: expect.stringMatching(/transcription failed/i),
    })
  })

  it('returns an empty transcript verbatim when Gemini sends back ""', async () => {
    geminiTranscribe.mockResolvedValue('' as never)
    const body = plainToInstance(TranscribeRequestDto, {
      audioBase64: 'AAAA',
      mimeType: 'audio/webm',
    })
    const res = await controller.transcribe(body, REQ_USER)
    // The empty-string case is the patient's audio being silent /
    // unintelligible — caller decides whether to surface "try again" copy.
    // Controller doesn't translate this to an error.
    expect(res).toEqual({ transcript: '' })
  })
})
