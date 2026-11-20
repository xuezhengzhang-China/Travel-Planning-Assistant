import { Injectable, Logger } from '@nestjs/common';
import type { ValidatedFootprintInput } from '../footprints/footprints.dto';
import { FootprintsService } from '../footprints/footprints.service';
import { ApiError } from '../common/api-error';
import { DatabaseService } from '../database/database.service';

/**
 * 行程的“用户附加状态”：勾选去过、预约状态、住宿与行李、提醒设置。
 *
 * 这些数据原来只存在浏览器 localStorage（键名 suixin:/wander:），换设备就丢。
 * 这里集中存进 trip_state.state（jsonb），归属跟着用户走；
 * 其中“去过”会同步出一条足迹记录，避免出现两套互不相通的“去过”。
 */

export type BookingStatus = 'pending' | 'booked' | 'unnecessary';

export interface TripPackingItem {
  id: string;
  label: string;
  packed: boolean;
}

export interface TripState {
  /** `${date}:${placeId}`，行程里勾选过的“去过”。 */
  visited: string[];
  /** 同一个键 → 自动创建的足迹 id，用于取消勾选时删除。 */
  footprints: Record<string, string>;
  /** placeId → 预约状态。 */
  bookings: Record<string, BookingStatus>;
  stay: { name: string; address: string };
  packing: TripPackingItem[];
  reminders: Record<string, unknown>;
}

const VISIT_KEY =
  /^\d{4}-\d{2}-\d{2}:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOOKING_VALUES = new Set<BookingStatus>(['pending', 'booked', 'unnecessary']);
const MAX_VISITED = 200;
const MAX_PACKING = 50;
const MAX_REMINDERS_BYTES = 4000;

function emptyState(): TripState {
  return {
    visited: [],
    footprints: {},
    bookings: {},
    stay: { name: '', address: '' },
    packing: [],
    reminders: {},
  };
}

function todayInShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function bad(field: string, message: string): never {
  throw new ApiError('VALIDATION_ERROR', message, 400, { field });
}

@Injectable()
export class TripStateService {
  private readonly logger = new Logger(TripStateService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly footprints: FootprintsService,
  ) {}

  async get(ownerId: string, tripId: string): Promise<TripState> {
    await this.assertOwned(ownerId, tripId);
    const result = await this.database.query<{ state: unknown }>(
      'SELECT state FROM trip_state WHERE trip_id = $1 AND owner_id = $2',
      [tripId, ownerId],
    );
    return normalize(result.rows[0]?.state);
  }

  async save(ownerId: string, tripId: string, body: unknown): Promise<TripState> {
    await this.assertOwned(ownerId, tripId);
    const current = await this.get(ownerId, tripId);
    const next = merge(current, body);
    await this.syncFootprints(ownerId, next);
    await this.database.query(
      `INSERT INTO trip_state (trip_id, owner_id, state)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (trip_id)
       DO UPDATE SET state = EXCLUDED.state, owner_id = EXCLUDED.owner_id, updated_at = current_timestamp`,
      [tripId, ownerId, JSON.stringify(next)],
    );
    return next;
  }

  private async assertOwned(ownerId: string, tripId: string): Promise<void> {
    const result = await this.database.query<{ id: string }>(
      'SELECT id FROM trips WHERE id = $1 AND owner_id = $2',
      [tripId, ownerId],
    );
    if (!result.rows[0]) {
      throw new ApiError('NOT_FOUND', '行程不存在', 404);
    }
  }

  /**
   * 勾选“去过”时补一条足迹，取消时删掉它。
   * 足迹创建失败不应让整个状态保存失败，所以逐条捕获并只记日志。
   */
  private async syncFootprints(ownerId: string, state: TripState): Promise<void> {
    const visited = new Set(state.visited);
    for (const key of [...visited]) {
      if (state.footprints[key]) continue;
      const created = await this.createFootprint(ownerId, key);
      if (created) state.footprints[key] = created;
    }
    for (const key of Object.keys(state.footprints)) {
      if (visited.has(key)) continue;
      const footprintId = state.footprints[key];
      delete state.footprints[key];
      try {
        await this.footprints.delete(ownerId, footprintId);
      } catch (error) {
        this.logger.warn(`Failed to delete footprint ${footprintId}: ${String(error)}`);
      }
    }
  }

  private async createFootprint(ownerId: string, key: string): Promise<string | null> {
    const separator = key.indexOf(':');
    const visitDate = key.slice(0, separator);
    const placeId = key.slice(separator + 1);
    const place = await this.database.query<{
      name: string;
      longitude: number;
      latitude: number;
    }>('SELECT name, longitude, latitude FROM places WHERE id = $1', [placeId]);
    const row = place.rows[0];
    if (!row) return null;
    const recordedOn = visitDate > todayInShanghai() ? todayInShanghai() : visitDate;
    const input: ValidatedFootprintInput = {
      longitude: Number(row.longitude),
      latitude: Number(row.latitude),
      coordinateSystem: 'GCJ-02',
      recordedOn,
      text: `${row.name}（行程打卡）`,
    };
    try {
      const entry = await this.footprints.create(ownerId, input, [], []);
      return entry.id;
    } catch (error) {
      this.logger.warn(`Failed to create footprint for ${key}: ${String(error)}`);
      return null;
    }
  }
}

/** 只接受已知字段，其它一律忽略；类型不对直接 400，避免脏数据写进 jsonb。 */
export function normalize(raw: unknown): TripState {
  const state = emptyState();
  if (!raw || typeof raw !== 'object') return state;
  const value = raw as Record<string, unknown>;

  if (Array.isArray(value.visited)) {
    for (const item of value.visited) {
      if (typeof item === 'string' && VISIT_KEY.test(item) && !state.visited.includes(item)) {
        state.visited.push(item);
      }
    }
  }
  if (value.footprints && typeof value.footprints === 'object') {
    for (const [key, id] of Object.entries(value.footprints as Record<string, unknown>)) {
      if (VISIT_KEY.test(key) && typeof id === 'string') state.footprints[key] = id;
    }
  }
  if (value.bookings && typeof value.bookings === 'object') {
    for (const [placeId, status] of Object.entries(value.bookings as Record<string, unknown>)) {
      if (typeof status === 'string' && BOOKING_VALUES.has(status as BookingStatus)) {
        state.bookings[placeId] = status as BookingStatus;
      }
    }
  }
  if (value.stay && typeof value.stay === 'object') {
    const stay = value.stay as Record<string, unknown>;
    state.stay = {
      name: typeof stay.name === 'string' ? stay.name.slice(0, 120) : '',
      address: typeof stay.address === 'string' ? stay.address.slice(0, 255) : '',
    };
  }
  if (Array.isArray(value.packing)) {
    for (const item of value.packing.slice(0, MAX_PACKING)) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.id !== 'string' || typeof entry.label !== 'string') continue;
      state.packing.push({
        id: entry.id.slice(0, 60),
        label: entry.label.slice(0, 60),
        packed: entry.packed === true,
      });
    }
  }
  if (value.reminders && typeof value.reminders === 'object' && !Array.isArray(value.reminders)) {
    const serialized = JSON.stringify(value.reminders);
    if (serialized.length <= MAX_REMINDERS_BYTES) {
      state.reminders = value.reminders as Record<string, unknown>;
    }
  }
  return state;
}

/** 局部更新：只取传来的部分，其它保留现有值。 */
export function merge(current: TripState, body: unknown): TripState {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    bad('body', '请求体必须是对象');
  }
  const patch = body as Record<string, unknown>;
  const next: TripState = {
    visited: [...current.visited],
    footprints: { ...current.footprints },
    bookings: { ...current.bookings },
    stay: { ...current.stay },
    packing: [...current.packing],
    reminders: { ...current.reminders },
  };

  if ('visited' in patch) {
    if (!Array.isArray(patch.visited) || patch.visited.length > MAX_VISITED) {
      bad('visited', `visited 必须是数组，且不超过 ${MAX_VISITED} 项`);
    }
    const visited: string[] = [];
    for (const item of patch.visited) {
      if (typeof item !== 'string' || !VISIT_KEY.test(item)) {
        bad('visited', 'visited 的每一项必须是「日期:景点ID」');
      }
      if (!visited.includes(item)) visited.push(item);
    }
    next.visited = visited;
  }

  if ('bookings' in patch) {
    if (!patch.bookings || typeof patch.bookings !== 'object' || Array.isArray(patch.bookings)) {
      bad('bookings', 'bookings 必须是对象');
    }
    const bookings: Record<string, BookingStatus> = {};
    for (const [placeId, status] of Object.entries(patch.bookings as Record<string, unknown>)) {
      if (typeof status !== 'string' || !BOOKING_VALUES.has(status as BookingStatus)) {
        bad('bookings', '预约状态只能是 pending、booked 或 unnecessary');
      }
      bookings[placeId] = status as BookingStatus;
    }
    next.bookings = bookings;
  }

  if ('stay' in patch) {
    const stay = patch.stay;
    if (!stay || typeof stay !== 'object' || Array.isArray(stay)) bad('stay', 'stay 必须是对象');
    const value = stay as Record<string, unknown>;
    next.stay = {
      name: readText(value.name, 'stay.name', 120),
      address: readText(value.address, 'stay.address', 255),
    };
  }

  if ('packing' in patch) {
    if (!Array.isArray(patch.packing) || patch.packing.length > MAX_PACKING) {
      bad('packing', `packing 必须是数组，且不超过 ${MAX_PACKING} 项`);
    }
    next.packing = patch.packing.map((item, index) => {
      if (!item || typeof item !== 'object') bad('packing', '行李条目格式不正确');
      const entry = item as Record<string, unknown>;
      if (typeof entry.label !== 'string' || !entry.label.trim()) {
        bad('packing', `第 ${index + 1} 条行李缺少名称`);
      }
      return {
        id: typeof entry.id === 'string' && entry.id ? entry.id : `item-${index + 1}`,
        label: entry.label.trim().slice(0, 60),
        packed: entry.packed === true,
      };
    });
  }

  if ('reminders' in patch) {
    const reminders = patch.reminders;
    if (!reminders || typeof reminders !== 'object' || Array.isArray(reminders)) {
      bad('reminders', 'reminders 必须是对象');
    }
    if (JSON.stringify(reminders).length > MAX_REMINDERS_BYTES) {
      bad('reminders', '提醒设置内容过大');
    }
    next.reminders = reminders as Record<string, unknown>;
  }

  return next;
}

function readText(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') bad(field, `${field} 必须是字符串`);
  if (value.length > max) bad(field, `${field} 最多 ${max} 字`);
  return value;
}
