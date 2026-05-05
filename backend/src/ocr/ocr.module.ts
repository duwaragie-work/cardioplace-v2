import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { GeminiModule } from '../gemini/gemini.module.js'
import { OcrController } from './ocr.controller.js'
import { OcrService } from './ocr.service.js'

@Module({
  imports: [ConfigModule, GeminiModule],
  controllers: [OcrController],
  providers: [OcrService],
  exports: [OcrService],
})
export class OcrModule {}
