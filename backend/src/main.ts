// MUST be the first import — registers OTEL global providers before any
// instrumented module loads. No-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset.
import './observability/tracing.js'

import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { AppModule } from './app.module.js'

async function bootstrap() {
  console.log('🚀 Starting Cardioplace backend...')
  console.log(`   PORT=${process.env.PORT}, DATABASE_URL=${process.env.DATABASE_URL ? 'set' : 'NOT SET'}`)

  const app = await NestFactory.create<NestExpressApplication>(AppModule)

  // Bug 51 — raise the JSON body limit from Express's default 100 KB to 25 MB.
  // The default rejected legitimate clinical payloads with
  // PayloadTooLargeError:
  //   • /api/chat/transcribe receives audioBase64 — even a few seconds of
  //     16 kHz 16-bit audio base64-encodes to 140-160 KB (the observed
  //     153 KB / 139 KB failures).
  //   • Photo OCR tools (BP cuff, medication-photo) receive image_base64 —
  //     phone-camera JPEGs run 1-3 MB raw → 1.3-4 MB base64.
  // 25 MB covers both with comfortable headroom and stays well under any
  // production reverse-proxy cap. Same limit on urlencoded for parity.
  app.useBodyParser('json', { limit: '25mb' })
  app.useBodyParser('urlencoded', { extended: true, limit: '25mb' })

  app.useWebSocketAdapter(new IoAdapter(app))
  app.use(cookieParser())

  // Security headers (Helmet). Two defaults are disabled because they would
  // break this app's cross-origin setup:
  //   • contentSecurityPolicy — backend serves JSON + images (OCR previews,
  //     Swagger), not first-party HTML pages; the strict default CSP would
  //     block them. Tighten this later as a separate, tested change.
  //   • crossOriginResourcePolicy — the patient (3000) and admin (3001) apps
  //     load resources cross-origin from the API (4000); the default
  //     `same-origin` value would block those loads.
  // Everything else (X-Frame-Options, nosniff, HSTS in prod, Referrer-Policy)
  // stays on and is transparent to the app.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: false,
    }),
  )

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
    }),
  )

  const corsOrigins = (process.env.WEB_APP_URL ?? 'http://localhost:3000,http://localhost:3001')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  })

  app.setGlobalPrefix('api', { exclude: ['/'] })

  const port = process.env.PORT ?? 4000
  await app.listen(port, '0.0.0.0')
  console.log(`✅ App listening on port ${port}`)
}
bootstrap().catch((err) => {
  console.error('❌ Bootstrap failed:', err)
  process.exit(1)
})
