import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TripsModule } from './trips/trips.module';

@Module({
  imports: [ConfigModule, DatabaseModule, HealthModule, AuthModule, UsersModule, TripsModule],
})
export class AppModule {}
