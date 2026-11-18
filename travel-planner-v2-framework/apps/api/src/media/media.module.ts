import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { MediaStorageService } from '../footprints/media-storage.service';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  imports: [AuthModule, ConfigModule, DatabaseModule],
  controllers: [MediaController],
  providers: [MediaStorageService, MediaService],
})
export class MediaModule {}
