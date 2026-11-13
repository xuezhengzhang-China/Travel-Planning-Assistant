import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { FootprintsAuthGuard } from '../footprints/footprints-auth.guard';
import { JournalsController } from './journals.controller';
import { JournalsService } from './journals.service';

@Module({
  imports: [DatabaseModule],
  controllers: [JournalsController],
  providers: [FootprintsAuthGuard, JournalsService],
})
export class JournalsModule {}
