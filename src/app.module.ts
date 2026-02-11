import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { KnowledgebaseModule } from './knowledgebase/knowledgebase.module';

@Module({
  imports: [KnowledgebaseModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
