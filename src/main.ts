import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import cookieParser from 'cookie-parser'
import { AppModule } from './app.module.js'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  app.use(cookieParser())

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        const messages = errors.map((e) => {
          const whitelistError = e.constraints?.['whitelistValidation']
          if (whitelistError) {
            return `Field name mismatch: '${e.property}' is not a valid field.`
          }
          return Object.values(e.constraints ?? {}).join('; ')
        })
        return new BadRequestException({
          message: messages,
          error: 'Bad Request',
        })
      },
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
