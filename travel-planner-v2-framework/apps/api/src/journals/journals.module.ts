import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { JournalsController } from './journals.controller';
import { JournalsService } from './journals.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [JournalsController],
  providers: [JournalsService],
})
export class JournalsModule {}
