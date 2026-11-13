import { Injectable } from '@nestjs/common';
import type { Destination, Place, Theme, TripPace } from '@travel/shared' with {
  'resolution-mode': 'import',
};
import { rankPlaces } from '@travel/shared/recommendation-engine';
import { DatabaseService } from '../database/database.service';
import { TripCatalog } from '../trips/trip-catalog';
import { ApiError } from '../common/api-error';
@Injectable()
export class PlacesService extends TripCatalog {
  constructor(private readonly db: DatabaseService) {
    super();
  }
  async assertCityExists(id: string) {
    const result = await this.db.query('SELECT id FROM c_destinations WHERE id=$1 AND level=$2', [
      id,
      'city',
    ]);
    if (!result.rows.length)
      throw new ApiError('VALIDATION_ERROR', '城市不在当前目录中', 400, { field: 'cityId' });
  }
  async getCityPlaces(cityId: string): Promise<Place[]> {
    await this.assertCityExists(cityId);
    const result = await this.db.query<{ data: Place }>(
      'SELECT data FROM c_places WHERE city_id=$1 ORDER BY id',
      [cityId],
    );
    return result.rows.map(({ data }) => ({
      ...data,
      coordinates: data.coordinates ?? null,
      openingHours: data.openingHours ?? null,
    }));
  }
  async assertPlacesBelongToCity(cityId: string, ids: string[]) {
    await this.assertCityExists(cityId);
    const result = await this.db.query(
      'SELECT id FROM c_places WHERE city_id=$1 AND id=ANY($2::uuid[])',
      [cityId, ids],
    );
    if (result.rows.length !== new Set(ids).size)
      throw new ApiError('VALIDATION_ERROR', '包含不存在或不属于该城市的景点', 400, {
        field: 'placeIds',
      });
  }
  async destinations(input: {
    level?: string;
    parentId?: string;
    keyword?: string;
    page: number;
    pageSize: number;
  }) {
    const result = await this.db.query<Destination>(
      `SELECT id,name,adcode,level,parent_id AS "parentId" FROM c_destinations
      WHERE ($1::text IS NULL OR level=$1) AND ($2::uuid IS NULL OR parent_id=$2) AND ($3::text IS NULL OR strpos(name,$3)>0) ORDER BY adcode`,
      [input.level ?? null, input.parentId ?? null, input.keyword ?? null],
    );
    return {
      items: result.rows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize),
      total: result.rows.length,
      page: input.page,
      pageSize: input.pageSize,
    };
  }
  async places(input: {
    cityId: string;
    keyword?: string;
    category?: string;
    themes: Theme[];
    pace: TripPace;
    page: number;
    pageSize: number;
  }) {
    const places = (await this.getCityPlaces(input.cityId)).filter(
      (p) =>
        (!input.category || p.category === input.category) &&
        (!input.keyword ||
          [p.name, p.district, p.address, p.category].some((v) => v.includes(input.keyword!))),
    );
    const byId = new Map(places.map((p) => [p.id, p]));
    const ranked = rankPlaces(places, input).map((r) => byId.get(r.placeId)!);
    return {
      items: ranked.slice((input.page - 1) * input.pageSize, input.page * input.pageSize),
      total: ranked.length,
      page: input.page,
      pageSize: input.pageSize,
    };
  }
  async place(id: string) {
    const result = await this.db.query<{ data: Place }>('SELECT data FROM c_places WHERE id=$1', [
      id,
    ]);
    if (!result.rows[0]) throw new ApiError('NOT_FOUND', '景点不存在', 404);
    const data = result.rows[0].data;
    return {
      ...data,
      coordinates: data.coordinates ?? null,
      openingHours: data.openingHours ?? null,
    };
  }
}
