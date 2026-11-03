import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { AmapLocationService } from './amap-location.service';
import { FootprintsController } from './footprints.controller';
import { FootprintsAuthGuard } from './footprints-auth.guard';
import { MediaStorageService } from './media-storage.service';
import { FootprintsService } from './footprints.service';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [FootprintsController],
  providers: [AmapLocationService, FootprintsAuthGuard, MediaStorageService, FootprintsService],
})
export class FootprintsModule {}
