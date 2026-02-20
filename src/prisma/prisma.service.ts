import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { PrismaClient } from '../generated/prisma/client.js'

@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL!,
    })

    super({ adapter })
  }

  async onModuleInit() {
    await this.$connect()
    console.log('✅ Database connected')

    try {
      await this.$executeRawUnsafe(`DROP INDEX IF EXISTS "hnsw_index"`)
      await this.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`)

      await this.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "hnsw_index" 
            ON "DocumentVector" 
            USING hnsw ("embedding" vector_cosine_ops)
        `)
      console.log('✅ HNSW index verified/created')
    } catch (error) {
      console.warn(
        '⚠️  Failed to create HNSW index (might already be correct or extension missing):',
        error.message,
      )
    }
  }
}
