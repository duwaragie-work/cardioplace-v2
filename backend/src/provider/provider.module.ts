import { Module } from '@nestjs/common'
import { ProviderController } from './provider.controller.js'
import { ProviderService } from './provider.service.js'

@Module({
  controllers: [ProviderController],
  providers: [ProviderService],
})
export class ProviderModule {}
