import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { FootprintsModule } from './footprints/footprints.module';
import { HealthModule } from './health/health.module';
import { BModule } from './b/b.module';

@Module({
  imports: [ConfigModule, DatabaseModule, HealthModule, FootprintsModule, BModule],
})
export class AppModule {}
