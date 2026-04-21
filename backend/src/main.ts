import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import cookieParser from 'cookie-parser'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { AppModule } from './app.module.js'

async function bootstrap() {
  console.log('🚀 Starting Cardioplace backend...')
  console.log(`   PORT=${process.env.PORT}, DATABASE_URL=${process.env.DATABASE_URL ? 'set' : 'NOT SET'}`)

  const app = await NestFactory.create(AppModule)

  app.useWebSocketAdapter(new IoAdapter(app))
  app.use(cookieParser())

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

  const port = process.env.PORT ?? 3000
  await app.listen(port, '0.0.0.0')
  console.log(`✅ App listening on port ${port}`)
}
bootstrap().catch((err) => {
  console.error('❌ Bootstrap failed:', err)
  process.exit(1)
})
