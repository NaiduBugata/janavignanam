import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';

@Module({
  imports: [DatabaseModule],
  controllers: [RagController],
  providers: [RagService],
  exports: [RagService],
})
export class RagModule {}
