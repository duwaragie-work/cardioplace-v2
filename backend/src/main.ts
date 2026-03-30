import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import cookieParser from 'cookie-parser'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { AppModule } from './app.module.js'

async function bootstrap() {
  
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

  await app.listen(process.env.PORT ?? 3000)
}
bootstrap()
