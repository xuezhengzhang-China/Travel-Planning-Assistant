import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ApiError } from '../common/api-error';
import type { Trip, TripList, CreateTripRequest } from '@travel/shared' with {
  'resolution-mode': 'import',
};
import type { PoolClient } from 'pg';
// 可替换持久化端口；mutation 必须在仓库锁定版本后执行。
export abstract class TripRepository {
  abstract create(ownerId: string, input: CreateTripRequest): Promise<Trip>;
  abstract get(ownerId: string, id: string): Promise<Trip>;
  abstract list(ownerId: string, page: number, pageSize: number): Promise<TripList>;
  abstract remove(ownerId: string, id: string, revision: number): Promise<void>;
  abstract mutate(
    ownerId: string,
    id: string,
    revision: number,
    change: (trip: Trip) => Promise<Trip>,
  ): Promise<Trip>;
}
interface TripRow {
  id: string;
  owner_id: string;
  title: string;
  city_id: string;
  revision: number;
  status: Trip['status'];
  start_date: string | null;
  end_date: string | null;
  themes: Trip['planningInput']['themes'];
  pace: Trip['planningInput']['pace'];
  transport_mode: Trip['planningInput']['transportMode'];
  selected_place_ids: string[];
  days: Trip['days'];
  created_at: Date;
  updated_at: Date;
}
const columns = `id, owner_id, title, city_id, revision, status, start_date::text, end_date::text,
 themes, pace, transport_mode, selected_place_ids, days, created_at, updated_at`;
const baseColumns = `id, owner_id, title, city_id, revision, status, start_date::text, end_date::text,
 themes, pace, transport_mode, created_at, updated_at`;
function map(row: TripRow): Trip {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    revision: row.revision,
    status: row.status,
    planningInput: {
      cityId: row.city_id,
      startDate: row.start_date,
      endDate: row.end_date,
      themes: row.themes,
      pace: row.pace,
      transportMode: row.transport_mode,
      selectedPlaceIds: row.selected_place_ids,
    },
    days: row.days,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
@Injectable()
export class PostgresTripRepository extends TripRepository {
  constructor(private readonly db: DatabaseService) {
    super();
  }
  async create(ownerId: string, input: CreateTripRequest): Promise<Trip> {
    const result = await this.db.query<TripRow>(
      `INSERT INTO trips (owner_id, title, city_id) VALUES ($1,$2,$3) RETURNING ${baseColumns}`,
      [ownerId, input.title, input.cityId],
    );
    return map({ ...result.rows[0]!, selected_place_ids: [], days: [] });
  }
  async get(ownerId: string, id: string): Promise<Trip> {
    const result = await this.db.query<TripRow>(
      `SELECT ${columns} FROM trip_resources WHERE owner_id=$1 AND id=$2 AND city_id IS NOT NULL`,
      [ownerId, id],
    );
    if (!result.rows[0]) throw new ApiError('NOT_FOUND', '行程不存在', 404);
    return map(result.rows[0]);
  }
  async list(ownerId: string, page: number, pageSize: number): Promise<TripList> {
    const count = await this.db.query<{ total: string }>(
      'SELECT count(*) AS total FROM trips WHERE owner_id=$1 AND city_id IS NOT NULL',
      [ownerId],
    );
    const result = await this.db.query<TripRow>(
      `SELECT ${columns} FROM trip_resources WHERE owner_id=$1 AND city_id IS NOT NULL ORDER BY updated_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [ownerId, pageSize, (page - 1) * pageSize],
    );
    return { items: result.rows.map(map), page, pageSize, total: Number(count.rows[0]!.total) };
  }
  async mutate(
    ownerId: string,
    id: string,
    revision: number,
    change: (trip: Trip) => Promise<Trip>,
  ): Promise<Trip> {
    return this.db.transaction(async (client: PoolClient) => {
      const locked = await client.query<{ revision: number }>(
        `SELECT revision FROM trips WHERE owner_id=$1 AND id=$2 AND city_id IS NOT NULL FOR UPDATE`,
        [ownerId, id],
      );
      if (!locked.rows[0]) throw new ApiError('NOT_FOUND', '行程不存在', 404);
      if (locked.rows[0].revision !== revision)
        throw new ApiError('REVISION_CONFLICT', '行程已发生变化，请重新读取后重试', 409, {
          currentRevision: locked.rows[0].revision,
        });
      // 获得行锁后另起一次读语句，让关系表聚合看到等待期间已提交的最新版本。
      const snapshot = await client.query<TripRow>(
        `SELECT ${columns} FROM trip_resources WHERE owner_id=$1 AND id=$2`,
        [ownerId, id],
      );
      const current = map(snapshot.rows[0]!);
      const next = await change(current);
      const p = next.planningInput;
      const updated = await client.query<TripRow>(
        `UPDATE trips SET title=$4, city_id=$5, start_date=$6, end_date=$7,
        themes=$8::jsonb, pace=$9, transport_mode=$10,
        status=$11, revision=revision+1, updated_at=clock_timestamp()
        WHERE owner_id=$1 AND id=$2 AND revision=$3 RETURNING ${baseColumns}`,
        [
          ownerId,
          id,
          revision,
          next.title,
          p.cityId,
          p.startDate,
          p.endDate,
          JSON.stringify(p.themes),
          p.pace,
          p.transportMode,
          next.status,
        ],
      );
      if (!updated.rows[0]) throw new ApiError('REVISION_CONFLICT', '行程版本冲突', 409);
      await client.query('DELETE FROM trip_days WHERE trip_id=$1', [id]);
      await client.query('DELETE FROM trip_selections WHERE trip_id=$1', [id]);
      for (const [position, placeId] of p.selectedPlaceIds.entries())
        await client.query(
          'INSERT INTO trip_selections(trip_id,city_id,place_id,position) VALUES($1,$2,$3,$4)',
          [id, p.cityId, placeId, position],
        );
      for (const day of next.days) {
        await client.query('INSERT INTO trip_days(trip_id,date) VALUES($1,$2)', [id, day.date]);
        for (const item of day.items)
          await client.query(
            `INSERT INTO trip_items(trip_id,date,place_id,position,start_time,duration_minutes,travel_minutes_from_previous,travel_time_source,reason)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              id,
              day.date,
              item.placeId,
              item.position,
              item.startTime,
              item.durationMinutes,
              item.travelMinutesFromPrevious,
              item.travelTimeSource,
              item.reason,
            ],
          );
      }
      return map({ ...updated.rows[0], selected_place_ids: p.selectedPlaceIds, days: next.days });
    });
  }
  async remove(ownerId: string, id: string, revision: number): Promise<void> {
    await this.db.transaction(async (client) => {
      const found = await client.query<{ revision: number }>(
        'SELECT revision FROM trips WHERE owner_id=$1 AND id=$2 AND city_id IS NOT NULL FOR UPDATE',
        [ownerId, id],
      );
      if (!found.rows[0]) throw new ApiError('NOT_FOUND', '行程不存在', 404);
      if (found.rows[0].revision !== revision)
        throw new ApiError('REVISION_CONFLICT', '行程已变化，请重新读取后删除', 409, {
          currentRevision: found.rows[0].revision,
        });
      await client.query('DELETE FROM trips WHERE owner_id=$1 AND id=$2 AND revision=$3', [
        ownerId,
        id,
        revision,
      ]);
    });
  }
}
