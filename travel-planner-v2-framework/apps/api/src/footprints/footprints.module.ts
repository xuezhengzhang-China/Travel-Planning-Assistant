import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { AmapLocationService } from './amap-location.service';
import { FootprintsController } from './footprints.controller';
import { MediaStorageService } from './media-storage.service';
import { FootprintsService } from './footprints.service';

@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule],
  controllers: [FootprintsController],
  providers: [AmapLocationService, MediaStorageService, FootprintsService],
})
export class FootprintsModule {}
