import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PlacesModule } from '../places/places.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { TripRepository, PostgresTripRepository } from './trip.repository';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
@Module({
  imports: [AuthModule, DatabaseModule, PlacesModule, RecommendationsModule],
  controllers: [TripsController],
  providers: [TripsService, { provide: TripRepository, useClass: PostgresTripRepository }],
  exports: [TripsService],
})
export class TripsModule {}
