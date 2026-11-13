import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { BExceptionFilter } from './errors';
import { BIdentityGuard } from './identity';
import type { BRequest } from './identity';
import { coordinates, enumeration, MODES, object } from './validation';
import { PlacesService } from '../places/places.service';
import { GeoService } from '../integrations/amap/geo.service';
import { RecommendationsService } from '../recommendations/recommendations.service';

@Controller()
@UseGuards(BIdentityGuard)
@UseFilters(BExceptionFilter)
export class BController {
  constructor(
    private readonly places: PlacesService,
    private readonly geo: GeoService,
    private readonly recommendations: RecommendationsService,
  ) {}
  @Get('destinations') destinations(@Query() query: unknown) {
    return this.places.destinations(query);
  }
  @Get('places') list(@Query() query: unknown) {
    return this.places.places(query);
  }
  @Get('places/:id') detail(@Param('id') id: string) {
    return this.places.getPlace(id);
  }
  @Post('routes/preview')
  @HttpCode(200)
  route(@Body() body: unknown) {
    const value = object(body, ['from', 'to', 'transportMode']);
    return this.geo.route(
      coordinates(value.from),
      coordinates(value.to),
      enumeration(value.transportMode, MODES),
    );
  }
  @Post('locations/reverse')
  @HttpCode(200)
  reverse(@Body() body: unknown) {
    const value = object(body, ['coordinates']);
    return this.geo.reverse(coordinates(value.coordinates));
  }
  @Post('recommendations/itinerary')
  @HttpCode(200)
  generate(@Body() body: unknown, @Req() request: BRequest) {
    return this.recommendations.generate(body, request.bUserId);
  }
}
