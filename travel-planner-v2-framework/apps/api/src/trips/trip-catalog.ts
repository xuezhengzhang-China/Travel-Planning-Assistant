import catalog from '@travel/shared/beijing-catalog.json';
import type { RecommendationPlace } from '@travel/shared' with { 'resolution-mode': 'import' };
import { Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error';
// B 的集成端口；替换 Nest provider 即可接入数据库目录/景点服务，无须改行程业务。
export abstract class TripCatalog {
  abstract getCityPlaces(cityId: string): Promise<RecommendationPlace[]>;
  abstract assertCityExists(cityId: string): Promise<void>;
  abstract assertPlacesBelongToCity(cityId: string, placeIds: string[]): Promise<void>;
}
export const BEIJING_CITY_ID = '11000000-0000-4000-8000-000000000001';
@Injectable()
export class CuratedBeijingCatalog extends TripCatalog {
  private readonly ids = new Set(catalog.places.map((place) => place.id));
  async getCityPlaces(cityId: string): Promise<RecommendationPlace[]> {
    await this.assertCityExists(cityId);
    return structuredClone(catalog.places) as RecommendationPlace[];
  }
  async assertCityExists(cityId: string): Promise<void> {
    if (cityId !== BEIJING_CITY_ID)
      throw new ApiError('VALIDATION_ERROR', '城市不在当前目录中', 400, { field: 'cityId' });
  }
  async assertPlacesBelongToCity(cityId: string, placeIds: string[]): Promise<void> {
    await this.assertCityExists(cityId);
    if (placeIds.some((id) => !this.ids.has(id)))
      throw new ApiError('VALIDATION_ERROR', '包含不存在或不属于该城市的景点', 400, {
        field: 'placeIds',
      });
  }
}
