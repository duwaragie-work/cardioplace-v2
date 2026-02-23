import { defineConfig } from 'prisma/config'
import dotenv from 'dotenv'
dotenv.config()

export default defineConfig({
  schema: 'prisma/',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://build:build@localhost:5432/build',
  },
})
