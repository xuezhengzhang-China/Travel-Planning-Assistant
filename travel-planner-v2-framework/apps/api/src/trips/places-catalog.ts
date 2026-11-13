import { Injectable } from '@nestjs/common';
import type { RecommendationPlace } from '@travel/shared' with { 'resolution-mode': 'import' };
import { ApiError } from '../common/api-error';
import { DatabaseService } from '../database/database.service';
import { TripCatalog } from './trip-catalog';

interface PlaceRow {
  id: string;
  city_id: string;
  name: string;
  categories: string[];
  suggested_duration_minutes: number;
}

/**
 * 行程目录统一到 B：城市与景点都读取 B 的 destinations / places 表。
 * 这里只做“是否存在、是否属于该城市、可排程字段”的校验，不复制 B 的检索与推荐逻辑。
 */
@Injectable()
export class BPlacesCatalog extends TripCatalog {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  async assertCityExists(cityId: string): Promise<void> {
    const result = await this.database.query<{ id: string }>(
      "SELECT id FROM destinations WHERE id = $1 AND level = 'city'",
      [cityId],
    );
    if (!result.rows[0]) {
      throw new ApiError('VALIDATION_ERROR', '城市不在当前目录中', 400, { field: 'cityId' });
    }
  }

  async assertPlacesBelongToCity(cityId: string, placeIds: string[]): Promise<void> {
    await this.assertCityExists(cityId);
    const unique = [...new Set(placeIds)];
    if (unique.length === 0) return;
    const result = await this.database.query<{ id: string }>(
      'SELECT id FROM places WHERE city_id = $1 AND id = ANY($2::uuid[])',
      [cityId, unique],
    );
    if (result.rows.length !== unique.length) {
      throw new ApiError('VALIDATION_ERROR', '包含不存在或不属于该城市的景点', 400, {
        field: 'placeIds',
      });
    }
  }

  async getCityPlaces(cityId: string): Promise<RecommendationPlace[]> {
    await this.assertCityExists(cityId);
    const result = await this.database.query<PlaceRow>(
      `SELECT id, city_id, name, categories, suggested_duration_minutes
       FROM places WHERE city_id = $1 ORDER BY id`,
      [cityId],
    );
    // B 的目录暂不区分行政区与远郊标记：district 留空，excursion 为 false，
    // 排程仍按主题、时长和交通预算计算，不虚构不存在的地点属性。
    return result.rows.map((row) => ({
      id: row.id,
      cityId: row.city_id,
      name: row.name,
      district: '',
      categories: row.categories as RecommendationPlace['categories'],
      suggestedDurationMinutes: row.suggested_duration_minutes,
      excursion: false,
    }));
  }
}
