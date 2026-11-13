import { paceSettings } from '@travel/shared/recommendation-engine';
export type Pace = 'relaxed' | 'standard' | 'intensive';
export type Transport = 'walking' | 'transit' | 'driving';
export interface PlanningDraft {
  cityId: string;
  startDate: string;
  endDate: string;
  themes: string[];
  pace: Pace;
  transport: Transport;
  selectedPlaceIds: string[];
}
export interface LocalDay {
  date: string;
  placeIds: string[];
}
export interface LocalTrip {
  title: string;
  themes: string[];
  pace: Pace;
  transport: Transport;
  days: LocalDay[];
  updatedAt: string;
}
export const paceOptions = [
  {
    value: 'relaxed',
    name: '轻松漫游',
    description: '给散步和休息多留一点时间',
    count: 2,
    minutes: paceSettings.relaxed.budget,
  },
  {
    value: 'standard',
    name: '经典节奏',
    description: '看风景，也享受途中的停留',
    count: 3,
    minutes: paceSettings.standard.budget,
  },
  {
    value: 'intensive',
    name: '充实探索',
    description: '想把更多目的地装进旅程',
    count: 4,
    minutes: paceSettings.intensive.budget,
  },
] as const;
const DAY = 86400000;
function dateValue(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN;
}
export function dateRange(start: string, end: string): string[] {
  const from = dateValue(start),
    to = dateValue(end);
  const count = (to - from) / DAY + 1;
  if (!Number.isInteger(count) || count < 1 || count > 30) return [];
  return Array.from({ length: count }, (_, i) =>
    new Date(from + i * DAY).toISOString().slice(0, 10),
  );
}
export function dateError(start: string, end: string): string {
  if (!start || !end) return '请选择出发日期和返程日期。';
  if (!Number.isFinite(dateValue(start)) || !Number.isFinite(dateValue(end)))
    return '请输入有效的日期。';
  if (end < start) return '返程日期不能早于出发日期。';
  if (!dateRange(start, end).length) return '每次行程最多支持 30 天，请调整日期。';
  return '';
}
export function movePlace(days: LocalDay[], id: string, targetDate: string): LocalDay[] {
  if (
    !days.some((day) => day.date === targetDate) ||
    !days.some((day) => day.placeIds.includes(id))
  )
    return days;
  return days.map((day) => ({
    ...day,
    placeIds: [
      ...day.placeIds.filter((value) => value !== id),
      ...(day.date === targetDate ? [id] : []),
    ],
  }));
}
export function reorderPlace(days: LocalDay[], id: string, direction: -1 | 1): LocalDay[] {
  return days.map((day) => {
    const index = day.placeIds.indexOf(id),
      next = index + direction;
    if (index < 0 || next < 0 || next >= day.placeIds.length) return day;
    const placeIds = [...day.placeIds];
    [placeIds[index], placeIds[next]] = [placeIds[next]!, placeIds[index]!];
    return { ...day, placeIds };
  });
}
