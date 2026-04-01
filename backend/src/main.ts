import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import cookieParser from 'cookie-parser'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { AppModule } from './app.module.js'

async function bootstrap() {
  console.log('🚀 Starting Healplace Cardio backend...')
  console.log(`   PORT=${process.env.PORT}, DATABASE_URL=${process.env.DATABASE_URL ? 'set' : 'NOT SET'}`)

  const app = await NestFactory.create(AppModule)

  app.useWebSocketAdapter(new IoAdapter(app))
  app.use(cookieParser())

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
    }),
  )

  app.enableCors({
    origin: process.env.WEB_APP_URL ?? 'http://localhost:3001',
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
