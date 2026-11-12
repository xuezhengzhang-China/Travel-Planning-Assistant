import { Module } from '@nestjs/common';
import { TripCatalog } from '../trips/trip-catalog';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { PlacesService } from './c-places.service';
import { PlacesController } from './places.controller';
import { ConfigModule } from '../config/config.module';
import { MAP_FETCH, MapService } from './map.service';
import { MapController } from './map.controller';
@Module({
  imports: [DatabaseModule, AuthModule, ConfigModule],
  controllers: [PlacesController, MapController],
  providers: [
    PlacesService,
    MapService,
    { provide: MAP_FETCH, useValue: fetch },
    { provide: TripCatalog, useExisting: PlacesService },
  ],
  exports: [TripCatalog, PlacesService],
})
export class PlacesModule {}
