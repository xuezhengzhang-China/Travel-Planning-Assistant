import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import type { Coordinates, TransportMode } from '@travel/shared' with {
  'resolution-mode': 'import',
};
import { AuthGuard } from '../auth/auth.guard';
import { ApiError } from '../common/api-error';
import { JsonBodyPipe, rejectUnknownFields } from '../common/json-body.pipe';
import { MapService } from './map.service';
export function coordinates(value: unknown): Coordinates {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiError('VALIDATION_ERROR', '需要 GCJ-02 经纬度', 400);
  const data = value as Record<string, unknown>;
  rejectUnknownFields(data, ['longitude', 'latitude', 'coordinateSystem']);
  if (
    data.coordinateSystem !== 'GCJ-02' ||
    typeof data.longitude !== 'number' ||
    !Number.isFinite(data.longitude) ||
    data.longitude < -180 ||
    data.longitude > 180 ||
    typeof data.latitude !== 'number' ||
    !Number.isFinite(data.latitude) ||
    data.latitude < -90 ||
    data.latitude > 90
  )
    throw new ApiError('VALIDATION_ERROR', '经纬度范围或坐标系不合法', 400);
  return data as unknown as Coordinates;
}
@Controller()
@UseGuards(AuthGuard)
export class MapController {
  constructor(private readonly maps: MapService) {}
  @Post('routes/preview')
  @HttpCode(200)
  route(@Body(new JsonBodyPipe()) body: Record<string, unknown>) {
    rejectUnknownFields(body, ['from', 'to', 'transportMode']);
    if (!['walking', 'transit', 'driving'].includes(body.transportMode as string))
      throw new ApiError('VALIDATION_ERROR', '交通方式不合法', 400);
    return this.maps.preview(
      coordinates(body.from),
      coordinates(body.to),
      body.transportMode as TransportMode,
    );
  }
  @Post('locations/reverse')
  @HttpCode(200)
  reverse(@Body(new JsonBodyPipe()) body: Record<string, unknown>) {
    rejectUnknownFields(body, ['coordinates']);
    return this.maps.reverse(coordinates(body.coordinates));
  }
}
