import { PlacePhotosModule } from '../place-photos/place-photos.module';
import { LlmParseModule } from '../llm-parse/llm-parse.module';
import { StorageModule } from '../storage/storage.module';
import { AttractionGuideService } from './attraction-guide.service';
import { MapsController } from './maps.controller';
import { MapsMcp } from './maps.mcp';
import { MapsService } from './maps.service';
import { Module } from '@nestjs/common';

/**
 * Maps / geo domain (L3 leaf module). Registered in AppModule. Exports
 * MapsService for the in-container consumers (BookingImportModule's Nominatim
 * geocoding, PlacesModule's search_place tool and list-import enrichment).
 * Nothing outside the container consumes this domain, so there is no bridge.
 */
@Module({
  imports: [PlacePhotosModule, StorageModule, LlmParseModule],
  controllers: [MapsController],
  providers: [MapsService, MapsMcp, AttractionGuideService],
  exports: [MapsService],
})
export class MapsModule {}
