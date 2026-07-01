import { Module } from '@nestjs/common'

/**
 * AccessLog module wiring point (Humaira N8 / 164.312-T7). Empty today —
 * controllers/services land Thursday alongside the access-log Prisma
 * extension. Registered in AppModule now so Thursday's PR is pure behavior,
 * no plumbing.
 */
@Module({
  imports: [],
  providers: [],
  exports: [],
})
export class AccessLogModule {}
