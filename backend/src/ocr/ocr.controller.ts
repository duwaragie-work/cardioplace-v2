// Phase/27 BP photo OCR endpoint (NIVA_SILENT_LITERACY_PLAN §3).
//   POST /api/v2/ocr/bp  multipart/form-data  field=image
// Auth: same JwtAuthGuard as /chat — patient role.

import {
  BadRequestException,
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Request } from 'express'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js'
import { BpOcrFailure, MedOcrFailure, OcrService } from './ocr.service.js'

const MAX_BYTES = 4 * 1024 * 1024 // 4 MB
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

@Controller('v2/ocr')
@UseGuards(JwtAuthGuard)
export class OcrController {
  private readonly logger = new Logger(OcrController.name)

  constructor(private readonly ocr: OcrService) {}

  @Post('bp')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_BYTES } }))
  async extractBp(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('No image uploaded')
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new UnsupportedMediaTypeException(`Unsupported image type: ${file.mimetype}`)
    }
    if (file.size > MAX_BYTES) {
      // Multer fileSize limit normally rejects with 413 before we get here,
      // but defensive against future config drift.
      throw new HttpException('Image too large', HttpStatus.PAYLOAD_TOO_LARGE)
    }

    const userId = (req.user as { id: string } | undefined)?.id
    if (!userId) throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED)

    try {
      const result = await this.ocr.extractBp(userId, file.buffer, file.mimetype)
      return result
    } catch (err) {
      if (err instanceof BpOcrFailure) {
        const status =
          err.code === 'RATE_LIMITED'
            ? HttpStatus.TOO_MANY_REQUESTS
            : err.code === 'GEMINI_ERROR'
              ? HttpStatus.BAD_GATEWAY
              : HttpStatus.UNPROCESSABLE_ENTITY
        throw new HttpException(
          { error: err.message, code: err.code },
          status,
        )
      }
      this.logger.error(`BP OCR — unexpected error: ${(err as Error).message}`)
      throw new HttpException('OCR failed', HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }

  /**
   * POST /api/v2/ocr/medications
   * Phase/27 follow-up — patient snaps a prescription / pharmacy printout /
   * pill-bottle label. Gemini Vision returns a structured medication list;
   * frontend confirmation modal gates manual acceptance before persisting
   * via the existing /intake/medications endpoint with source=PATIENT_PHOTO.
   */
  @Post('medications')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_BYTES } }))
  async extractMedications(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('No image uploaded')
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new UnsupportedMediaTypeException(`Unsupported image type: ${file.mimetype}`)
    }
    if (file.size > MAX_BYTES) {
      throw new HttpException('Image too large', HttpStatus.PAYLOAD_TOO_LARGE)
    }

    const userId = (req.user as { id: string } | undefined)?.id
    if (!userId) throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED)

    try {
      const result = await this.ocr.extractMedications(userId, file.buffer, file.mimetype)
      return result
    } catch (err) {
      if (err instanceof MedOcrFailure) {
        const status =
          err.code === 'RATE_LIMITED'
            ? HttpStatus.TOO_MANY_REQUESTS
            : err.code === 'GEMINI_ERROR'
              ? HttpStatus.BAD_GATEWAY
              : HttpStatus.UNPROCESSABLE_ENTITY
        throw new HttpException(
          { error: err.message, code: err.code },
          status,
        )
      }
      this.logger.error(`Med OCR — unexpected error: ${(err as Error).message}`)
      throw new HttpException('OCR failed', HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }
}
