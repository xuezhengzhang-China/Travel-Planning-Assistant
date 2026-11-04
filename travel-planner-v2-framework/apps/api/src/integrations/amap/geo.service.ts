import { Injectable } from '@nestjs/common';
import type { Coordinates, ReverseLocation, RoutePreview, TransportMode } from '../../b/types';
import { unavailable } from '../../b/errors';
import { coordinates } from '../../b/validation';
import { PlacesService } from '../../places/places.service';
import { AmapClient } from './amap.client';

export function walkingEstimate(from: Coordinates, to: Coordinates): RoutePreview | null {
  const radians = (value: number) => (value * Math.PI) / 180;
  const a =
    Math.sin(radians(to.latitude - from.latitude) / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(radians(to.longitude - from.longitude) / 2) ** 2;
  const metres = 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
  if (metres > 5000) return null;
  return {
    durationMinutes: Math.max(1, Math.ceil((metres * 1.3) / 70)),
    source: 'estimate',
    warnings: [
      {
        code: 'ROUTE_ESTIMATED',
        message:
          '短距离步行估算：直线距离 × 1.3，按每分钟 70 米计算；未核实通路、绕行和实际可达性。',
      },
    ],
  };
}
@Injectable()
export class GeoService {
  constructor(
    private readonly amap: AmapClient,
    private readonly places: PlacesService,
  ) {}
  async route(
    from: Coordinates,
    to: Coordinates,
    mode: TransportMode,
    cityCode?: string,
    signal?: AbortSignal,
  ): Promise<RoutePreview> {
    coordinates(from);
    coordinates(to);
    if (signal?.aborted) unavailable('推荐计算超时');
    try {
      return {
        durationMinutes: await this.amap.route(from, to, mode, cityCode, signal),
        source: 'provider',
        warnings: [],
      };
    } catch {
      if (signal?.aborted) unavailable('推荐计算超时');
      const estimate = mode === 'walking' ? walkingEstimate(from, to) : null;
      if (estimate) return estimate;
      unavailable('无法取得可靠路线估时，请稍后重试或调整交通方式');
    }
  }
  async reverse(point: Coordinates): Promise<ReverseLocation> {
    coordinates(point);
    const parsed = await this.amap.reverse(point);
    const city = parsed.adcode ? await this.places.cityForAdminCode(parsed.adcode) : null;
    return {
      placeName: parsed.placeName,
      cityId: city?.id ?? null,
      cityAdcode: city?.adcode ?? null,
      warnings: city
        ? []
        : [{ code: 'CITY_UNCONFIRMED', message: '暂不能确认所属支持城市，仅保留地点信息。' }],
    };
  }
}
