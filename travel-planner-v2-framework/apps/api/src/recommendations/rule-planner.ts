import type {
  Pace,
  Place,
  PlanningInput,
  RoutePreview,
  ScheduleDay,
  TravelWarning,
} from '../b/types';
import { calendarDates, planningInput } from '../b/validation';
import { invalid, unavailable } from '../b/errors';

export const PACE_POLICY: Readonly<
  Record<Pace, { start: number; end: number; rest: number; maxPlaces: number }>
> = Object.freeze({
  relaxed: Object.freeze({ start: 600, end: 1080, rest: 30, maxPlaces: 2 }),
  standard: Object.freeze({ start: 540, end: 1080, rest: 15, maxPlaces: 3 }),
  intensive: Object.freeze({ start: 480, end: 1080, rest: 10, maxPlaces: 4 }),
});
export const routeKey = (from: string, to: string) => `${from}>${to}`;
export class RouteNeeded extends Error {
  constructor(
    readonly from: Place,
    readonly to: Place,
  ) {
    super('Route required');
  }
}
function minutes(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) invalid('日程时间格式不合法', 'INVALID_SCHEDULE');
  const [h, m] = value.split(':').map(Number);
  if (h > 23 || m > 59) invalid('日程时间格式不合法', 'INVALID_SCHEDULE');
  return h * 60 + m;
}
function hhmm(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function validateSchedule(
  input: PlanningInput,
  places: Place[],
  days: ScheduleDay[],
  unassigned: string[] = [],
) {
  const dates = calendarDates(input.startDate, input.endDate),
    policy = PACE_POLICY[input.pace];
  if (days.length !== dates.length || days.some((day, index) => day.date !== dates[index]))
    invalid('日程日期不完整', 'INVALID_SCHEDULE');
  const byId = new Map(places.map((p) => [p.id, p]));
  const seen = new Set<string>();
  for (const day of days) {
    if (day.items.length > policy.maxPlaces) invalid('超出每日景点上限', 'INVALID_SCHEDULE');
    let end = policy.start;
    day.items.forEach((item, i) => {
      const place = byId.get(item.placeId);
      if (
        !place ||
        seen.has(item.placeId) ||
        !input.selectedPlaceIds.includes(item.placeId) ||
        place.cityId !== input.cityId ||
        item.position !== i ||
        !Number.isSafeInteger(item.durationMinutes) ||
        item.durationMinutes <= 0 ||
        !Number.isSafeInteger(item.travelMinutesFromPrevious) ||
        item.travelMinutesFromPrevious < 0
      )
        invalid('日程景点或时长不合法', 'INVALID_SCHEDULE');
      if (
        i === 0
          ? item.travelMinutesFromPrevious !== 0 || item.travelTimeSource !== 'none'
          : !['provider', 'estimate'].includes(item.travelTimeSource) ||
            item.travelMinutesFromPrevious < 1
      )
        invalid('日程交通来源不合法', 'INVALID_SCHEDULE');
      const start = minutes(item.startTime);
      if (
        start < end + (i ? policy.rest + item.travelMinutesFromPrevious : 0) ||
        start + item.durationMinutes > policy.end
      )
        invalid('日程超预算或时间重叠', 'INVALID_SCHEDULE');
      end = start + item.durationMinutes;
      seen.add(item.placeId);
    });
  }
  for (const id of unassigned) {
    if (seen.has(id) || !input.selectedPlaceIds.includes(id))
      invalid('未安排集合不合法', 'INVALID_SCHEDULE');
    seen.add(id);
  }
  if (seen.size !== input.selectedPlaceIds.length) invalid('日程遗漏已选景点', 'INVALID_SCHEDULE');
}

// Pure, deterministic first-fit planning. Network/SQL/clock/IDs stay in the orchestrator.
export function planRule(
  rawInput: PlanningInput,
  places: Place[],
  routes: ReadonlyMap<string, RoutePreview | null>,
) {
  const input = planningInput(rawInput),
    policy = PACE_POLICY[input.pace];
  const byId = new Map(places.map((p) => [p.id, p]));
  const selected = input.selectedPlaceIds.map((id) => {
    const p = byId.get(id);
    if (
      !p ||
      p.cityId !== input.cityId ||
      !Number.isSafeInteger(p.suggestedDurationMinutes) ||
      p.suggestedDurationMinutes <= 0
    )
      invalid('景点数据不存在或不合法');
    return p;
  });
  const days: ScheduleDay[] = calendarDates(input.startDate, input.endDate).map((date) => ({
    date,
    items: [],
  }));
  const unassignedPlaceIds: string[] = [],
    warnings: TravelWarning[] = [];
  for (const place of selected) {
    let assigned = false;
    let unknownRoute = false;
    for (const day of days) {
      const previous = day.items.at(-1);
      const end = previous ? minutes(previous.startTime) + previous.durationMinutes : policy.start;
      if (
        day.items.length >= policy.maxPlaces ||
        end + (previous ? policy.rest : 0) + place.suggestedDurationMinutes > policy.end
      )
        continue;
      let route: RoutePreview | undefined;
      if (previous) {
        const known = routes.get(routeKey(previous.placeId, place.id));
        if (known === undefined) throw new RouteNeeded(byId.get(previous.placeId)!, place);
        if (known === null) {
          unknownRoute = true;
          continue;
        }
        route = known;
        if (
          !Number.isSafeInteger(route.durationMinutes) ||
          route.durationMinutes <= 0 ||
          !['estimate', 'provider'].includes(route.source)
        )
          invalid('交通估时不合法');
      }
      const start = end + (previous ? policy.rest + route!.durationMinutes : 0);
      if (start + place.suggestedDurationMinutes > policy.end) continue;
      const matches = place.categories.filter((category) => input.themes.includes(category));
      day.items.push({
        placeId: place.id,
        position: day.items.length,
        startTime: hhmm(start),
        durationMinutes: place.suggestedDurationMinutes,
        travelMinutesFromPrevious: route?.durationMinutes ?? 0,
        travelTimeSource: route?.source ?? 'none',
        reason: `${matches.length ? `匹配主题：${matches.join('、')}` : '按已选景点顺序安排'}；${previous ? '已计入交通与休息。' : '未包含未知首站出发地的交通。'}`,
      });
      if (route)
        warnings.push(
          ...route.warnings.map((w) => ({ ...w, placeIds: [previous!.placeId, place.id] })),
        );
      if (unknownRoute)
        warnings.push({
          code: 'ROUTE_UNAVAILABLE_SEPARATED',
          message: '部分候选站间路线不可用，已改用其他可行日期或顺序；首站出发交通未包含。',
          placeIds: [place.id],
        });
      assigned = true;
      break;
    }
    if (!assigned) {
      if (unknownRoute)
        unavailable('缺少必要站间路线，无法判断剩余景点能否安排，请稍后重试或增加日期');
      unassignedPlaceIds.push(place.id);
      warnings.push({
        code: 'UNASSIGNED_PLACES',
        message: '按当前顺序、日期、节奏和交通预算无法安排，请调整条件。',
        placeIds: [place.id],
      });
    }
  }
  if (selected.length)
    warnings.push({
      code: 'OPENING_HOURS_UNVERIFIED',
      message: '尚未核实开放时间、闭馆日与预约要求，请出行前确认。',
      placeIds: selected.map((p) => p.id),
    });
  validateSchedule(input, places, days, unassignedPlaceIds);
  return { days, unassignedPlaceIds, warnings };
}
