import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import type { Destination, Page, Place, Theme } from '../b/types';

export interface DestinationQuery {
  level?: string;
  parentId?: string;
  keyword?: string;
  page: number;
  pageSize: number;
}
export interface PlaceQuery {
  cityId: string;
  keyword?: string;
  category?: Theme;
  themes: Theme[];
  page: number;
  pageSize: number;
}
interface DestinationRow extends QueryResultRow {
  id: string;
  name: string;
  level: 'province' | 'city';
  parent_id: string | null;
  adcode: string;
  time_zone: string;
}
interface PlaceRow extends QueryResultRow {
  id: string;
  city_id: string;
  name: string;
  categories: Theme[];
  address: string;
  longitude: number;
  latitude: number;
  coordinate_system: 'GCJ-02';
  suggested_duration_minutes: number;
  description: string;
  opening_hours_text: string | null;
  source: Place['source'];
  updated_at: Date;
}
function destination(row: DestinationRow): Destination {
  return {
    id: row.id,
    name: row.name,
    level: row.level,
    parentId: row.parent_id,
    adcode: row.adcode,
    timeZone: row.time_zone,
  };
}
function place(row: PlaceRow): Place {
  return {
    id: row.id,
    cityId: row.city_id,
    name: row.name,
    categories: row.categories,
    address: row.address,
    coordinates: {
      longitude: row.longitude,
      latitude: row.latitude,
      coordinateSystem: row.coordinate_system,
    },
    suggestedDurationMinutes: row.suggested_duration_minutes,
    description: row.description,
    openingHoursText: row.opening_hours_text,
    source: row.source,
    updatedAt: row.updated_at.toISOString(),
  };
}

@Injectable()
export class PlacesRepository {
  constructor(private readonly db: DatabaseService) {}

  async destinations(query: DestinationQuery): Promise<Page<Destination>> {
    const where = `WHERE ($1::text IS NULL OR level = $1) AND ($2::uuid IS NULL OR parent_id = $2)
      AND ($3::text IS NULL OR position(lower($3) in lower(name)) > 0)`;
    const values = [query.level ?? null, query.parentId ?? null, query.keyword ?? null];
    const count = await this.db.query<{ total: string }>(
      `SELECT count(*) AS total FROM destinations ${where}`,
      values,
    );
    const rows = await this.db.query<DestinationRow>(
      `SELECT * FROM destinations ${where} ORDER BY id LIMIT $4 OFFSET $5`,
      [...values, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      items: rows.rows.map(destination),
      page: query.page,
      pageSize: query.pageSize,
      total: Number(count.rows[0].total),
    };
  }
  async places(query: PlaceQuery): Promise<Page<Place>> {
    const where = `WHERE city_id = $1 AND ($2::text IS NULL OR position(lower($2) in lower(name)) > 0)
      AND ($3::text IS NULL OR $3 = ANY(categories))`;
    const values = [query.cityId, query.keyword ?? null, query.category ?? null];
    const count = await this.db.query<{ total: string }>(
      `SELECT count(*) AS total FROM places ${where}`,
      values,
    );
    const rows = await this.db.query<PlaceRow>(
      `SELECT * FROM places ${where}
      ORDER BY (SELECT count(*) FROM unnest(categories) AS category WHERE category = ANY($4::text[])) DESC, id ASC
      LIMIT $5 OFFSET $6`,
      [...values, query.themes, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      items: rows.rows.map(place),
      page: query.page,
      pageSize: query.pageSize,
      total: Number(count.rows[0].total),
    };
  }
  async getCity(id: string): Promise<Destination | null> {
    const result = await this.db.query<DestinationRow>(
      "SELECT * FROM destinations WHERE id = $1 AND level = 'city'",
      [id],
    );
    return result.rows[0] ? destination(result.rows[0]) : null;
  }
  async getPlaces(ids: string[]): Promise<Place[]> {
    const result = await this.db.query<PlaceRow>(
      'SELECT * FROM places WHERE id = ANY($1::uuid[])',
      [ids],
    );
    return result.rows.map(place);
  }
  async getRouteCityCode(id: string): Promise<string | undefined> {
    const result = await this.db.query<{ amap_citycode: string | null }>(
      "SELECT amap_citycode FROM destinations WHERE id = $1 AND level = 'city'",
      [id],
    );
    return result.rows[0]?.amap_citycode ?? undefined;
  }
  async cityForAdminCode(adcode: string): Promise<Destination | null> {
    const result = await this.db.query<DestinationRow>(
      `SELECT d.* FROM destinations d
      WHERE d.level = 'city' AND (d.adcode = $1 OR d.id IN
        (SELECT city_id FROM destination_admin_codes WHERE adcode = $1)) ORDER BY d.id LIMIT 1`,
      [adcode],
    );
    return result.rows[0] ? destination(result.rows[0]) : null;
  }
}
