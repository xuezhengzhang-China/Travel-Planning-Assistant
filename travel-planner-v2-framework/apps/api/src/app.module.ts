import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { BModule } from './b/b.module';

@Module({
  imports: [ConfigModule, DatabaseModule, HealthModule, BModule],
})
export class AppModule {}
