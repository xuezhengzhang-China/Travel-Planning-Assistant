import type { Coordinates, PlanningInput, Theme, TransportMode } from './types';
import { invalid } from './errors';

export const THEMES: readonly Theme[] = ['history', 'nature', 'landmark', 'art', 'family', 'local'];
export const MODES: readonly TransportMode[] = ['walking', 'driving', 'transit'];
export function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('需要 JSON 对象');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !keys.includes(key))) invalid('包含未知字段');
  return result;
}
export function text(value: unknown, max = 100): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid('字符串格式不合法');
  return value.trim();
}
export function uuid(value: unknown): string {
  const result = text(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result))
    invalid('UUID 格式不合法');
  return result.toLowerCase();
}
export function enumeration<T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== 'string' || !options.includes(value as T)) invalid('枚举值不合法');
  return value as T;
}
export function integer(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) invalid('分页参数必须是正整数');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result > max) invalid('分页参数超出范围');
  return result;
}
export function pagination(query: Record<string, unknown>) {
  return { page: integer(query.page, 1, 100000), pageSize: integer(query.pageSize, 20, 100) };
}
export function coordinates(value: unknown): Coordinates {
  const input = object(value, ['longitude', 'latitude', 'coordinateSystem']);
  if (input.coordinateSystem !== 'GCJ-02') invalid('坐标系必须为 GCJ-02');
  if (
    typeof input.longitude !== 'number' ||
    !Number.isFinite(input.longitude) ||
    Math.abs(input.longitude) > 180 ||
    typeof input.latitude !== 'number' ||
    !Number.isFinite(input.latitude) ||
    Math.abs(input.latitude) > 90
  )
    invalid('经纬度不合法');
  return { longitude: input.longitude, latitude: input.latitude, coordinateSystem: 'GCJ-02' };
}
export function calendarDates(start: unknown, end: unknown): string[] {
  function parse(value: unknown): number {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      value < '1900-01-01' ||
      value > '2100-12-31'
    )
      invalid('日期格式或范围不合法', 'INVALID_DATE_RANGE');
    const result = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(result) || new Date(result).toISOString().slice(0, 10) !== value)
      invalid('日期不存在', 'INVALID_DATE_RANGE');
    return result;
  }
  // UTC here encodes calendar components only, not destination instants or elapsed local time.
  const first = parse(start),
    last = parse(end);
  const count = (last - first) / 86400000 + 1;
  if (count < 1 || count > 30) invalid('日期范围应为 1 至 30 天', 'INVALID_DATE_RANGE');
  return Array.from({ length: count }, (_, i) =>
    new Date(first + i * 86400000).toISOString().slice(0, 10),
  );
}
export function planningInput(value: unknown): PlanningInput {
  const input = object(value, [
    'cityId',
    'startDate',
    'endDate',
    'themes',
    'pace',
    'transportMode',
    'selectedPlaceIds',
  ]);
  calendarDates(input.startDate, input.endDate);
  if (!Array.isArray(input.themes) || input.themes.length > 20) invalid('主题必须为数组');
  if (
    !Array.isArray(input.selectedPlaceIds) ||
    input.selectedPlaceIds.length < 1 ||
    input.selectedPlaceIds.length > 120
  )
    invalid('已选景点应为 1 至 120 个');
  const selectedPlaceIds = input.selectedPlaceIds.map(uuid);
  if (new Set(selectedPlaceIds).size !== selectedPlaceIds.length) invalid('景点不能重复');
  return {
    cityId: uuid(input.cityId),
    startDate: input.startDate as string,
    endDate: input.endDate as string,
    themes: [...new Set(input.themes.map((theme) => enumeration(theme, THEMES)))].sort(),
    pace: enumeration(input.pace, ['relaxed', 'standard', 'intensive']),
    transportMode: enumeration(input.transportMode, MODES),
    selectedPlaceIds,
  };
}
