import { ApiError } from '../common/api-error';
import { JsonBodyPipe, rejectUnknownFields, requiredString } from '../common/json-body.pipe';
import type {
  CreateTripRequest,
  UpdateTripRequest,
  UpdateTripSelectionsRequest,
  DraftPlanningInput,
  Theme,
} from '@travel/shared' with { 'resolution-mode': 'import' };
const bad = (field: string): never => {
  throw new ApiError('VALIDATION_ERROR', `${field} 格式不正确`, 400, { field });
};
export function uuid(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    return bad(field);
  return value.toLowerCase();
}
export function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value >= 2147483647)
    return bad('expectedRevision');
  return value;
}
function reset(value: Record<string, unknown>): boolean | undefined {
  if ('acknowledgeScheduleReset' in value && typeof value.acknowledgeScheduleReset !== 'boolean')
    bad('acknowledgeScheduleReset');
  return value.acknowledgeScheduleReset as boolean | undefined;
}
export function createInput(value: Record<string, unknown>): CreateTripRequest {
  rejectUnknownFields(value, ['title', 'cityId']);
  return {
    title: requiredString(value.title, 'title', 1, 120),
    cityId: uuid(value.cityId, 'cityId'),
  };
}
export function patchInput(value: Record<string, unknown>): UpdateTripRequest {
  rejectUnknownFields(value, [
    'expectedRevision',
    'title',
    'planningInput',
    'acknowledgeScheduleReset',
  ]);
  const result: UpdateTripRequest = {
    expectedRevision: revision(value.expectedRevision),
    acknowledgeScheduleReset: reset(value),
  };
  if ('title' in value) result.title = requiredString(value.title, 'title', 1, 120);
  if ('planningInput' in value) {
    const p = new JsonBodyPipe().transform(value.planningInput);
    rejectUnknownFields(p, ['cityId', 'startDate', 'endDate', 'themes', 'pace', 'transportMode']);
    const input: Partial<Omit<DraftPlanningInput, 'selectedPlaceIds'>> = {};
    if ('cityId' in p) input.cityId = uuid(p.cityId, 'cityId');
    if ('startDate' in p !== 'endDate' in p) bad('startDate/endDate');
    if ('startDate' in p) {
      validateDates(p.startDate, p.endDate);
      input.startDate = p.startDate as string | null;
      input.endDate = p.endDate as string | null;
    }
    if ('themes' in p) {
      const options = ['history', 'nature', 'landmark', 'art', 'family', 'local'];
      if (
        !Array.isArray(p.themes) ||
        p.themes.length > 6 ||
        p.themes.some((t) => typeof t !== 'string' || !options.includes(t)) ||
        new Set(p.themes).size !== p.themes.length
      )
        bad('themes');
      input.themes = [...(p.themes as Theme[])].sort();
    }
    if ('pace' in p) {
      if (!['relaxed', 'standard', 'intensive'].includes(p.pace as string)) bad('pace');
      input.pace = p.pace as DraftPlanningInput['pace'];
    }
    if ('transportMode' in p) {
      if (!['walking', 'transit', 'driving'].includes(p.transportMode as string))
        bad('transportMode');
      input.transportMode = p.transportMode as DraftPlanningInput['transportMode'];
    }
    result.planningInput = input;
  }
  if (!('title' in value) && !('planningInput' in value)) bad('title/planningInput');
  return result;
}
export function selectionsInput(value: Record<string, unknown>): UpdateTripSelectionsRequest {
  rejectUnknownFields(value, ['expectedRevision', 'placeIds', 'acknowledgeScheduleReset']);
  if (!Array.isArray(value.placeIds) || value.placeIds.length > 100) bad('placeIds');
  const placeIds = (value.placeIds as unknown[]).map((id) => uuid(id, 'placeIds'));
  if (new Set(placeIds).size !== placeIds.length) bad('placeIds');
  return {
    expectedRevision: revision(value.expectedRevision),
    placeIds,
    acknowledgeScheduleReset: reset(value),
  };
}
export function validateDates(start: unknown, end: unknown): void {
  if (start === null && end === null) return;
  const valid = (value: unknown): value is string =>
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value >= '0001-01-01' &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (
    !valid(start) ||
    !valid(end) ||
    (Date.parse(end) - Date.parse(start)) / 86400000 < 0 ||
    (Date.parse(end) - Date.parse(start)) / 86400000 >= 30
  )
    throw new ApiError('INVALID_DATE_RANGE', '日期必须同时为空或为有效的 1～30 天范围', 400);
}
export function pagination(page: unknown, pageSize: unknown) {
  const parse = (v: unknown, fallback: number, max: number) => {
    if (v === undefined) return fallback;
    if (
      typeof v !== 'string' ||
      !/^[1-9]\d*$/.test(v) ||
      !Number.isSafeInteger(Number(v)) ||
      Number(v) > max
    )
      bad('pagination');
    return Number(v);
  };
  return { page: parse(page, 1, 1000000), pageSize: parse(pageSize, 20, 100) };
}

export function scheduleInput(
  value: unknown,
): import('@travel/shared', { with: { 'resolution-mode': 'import' } }).ScheduleDay[] {
  if (!Array.isArray(value) || value.length > 30) bad('days');
  return (value as unknown[]).map((raw) => {
    const day = new JsonBodyPipe().transform(raw);
    rejectUnknownFields(day, ['date', 'items']);
    if (typeof day.date !== 'string' || !Array.isArray(day.items) || day.items.length > 100)
      bad('days');
    return {
      date: day.date as string,
      items: (day.items as unknown[]).map((rawItem) => {
        const item = new JsonBodyPipe().transform(rawItem);
        rejectUnknownFields(item, [
          'placeId',
          'position',
          'startTime',
          'durationMinutes',
          'travelMinutesFromPrevious',
          'travelTimeSource',
          'reason',
        ]);
        uuid(item.placeId, 'placeId');
        if (
          !Number.isInteger(item.position) ||
          !Number.isInteger(item.durationMinutes) ||
          !Number.isInteger(item.travelMinutesFromPrevious) ||
          typeof item.startTime !== 'string' ||
          typeof item.reason !== 'string' ||
          item.reason.length > 500 ||
          !['none', 'estimate', 'provider'].includes(item.travelTimeSource as string)
        )
          bad('items');
        return item as unknown as import('@travel/shared', {
          with: { 'resolution-mode': 'import' },
        }).ScheduleItem;
      }),
    };
  });
}
