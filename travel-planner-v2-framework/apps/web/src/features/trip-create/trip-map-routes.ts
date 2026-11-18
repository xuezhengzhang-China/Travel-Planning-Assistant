import type { BPlaces, Place, TransportMode, Trip } from '@travel/shared';
import type { LocalDay } from '../../data/planner';

const dayColors = ['#217552', '#335cb3', '#a85221', '#8b499e', '#167883', '#a03e58'];
export const transportNames = { walking: '步行', driving: '自驾', transit: '公共交通' };
export type RouteResult = BPlaces.RoutePreview | 'unavailable';

export function savedOrder(trip: Trip): LocalDay[] {
  return trip.days.map(({ date, items }) => ({
    date,
    placeIds: [...items]
      .sort((left, right) => left.position - right.position)
      .map((item) => item.placeId),
  }));
}

export function buildDays(trip: Trip, places: Place[], order: LocalDay[]) {
  const byId = new Map(places.map((place) => [place.id, place]));
  const items = new Map(trip.days.flatMap((day) => day.items.map((item) => [item.placeId, item])));
  let number = 0;
  return order.map((day, index) => {
    const color = dayColors[index % dayColors.length]!;
    const stops = day.placeIds.map((placeId) => ({
      ...items.get(placeId)!,
      place: byId.get(placeId),
      number: ++number,
    }));
    const legs = stops.slice(1).map((to, position) => {
      const from = stops[position]!;
      const key = JSON.stringify([
        trip.planningInput.transportMode,
        from.placeId,
        to.placeId,
        from.place?.coordinates,
        to.place?.coordinates,
      ]);
      return { key, from, to };
    });
    return { date: day.date, number: index + 1, color, stops, legs };
  });
}

export function summarizeRoutes(
  legs: readonly { key: string }[],
  routes: ReadonlyMap<string, RouteResult>,
) {
  let minutes = 0;
  let known = 0;
  let pending = 0;
  let estimates = 0;
  for (const { key } of legs) {
    const route = routes.get(key);
    if (route === undefined) pending++;
    else if (route !== 'unavailable') {
      minutes += route.durationMinutes;
      known++;
      if (route.source === 'estimate') estimates++;
    }
  }
  return { count: legs.length, minutes, known, pending, estimates };
}

export function formatRouteSummary(
  summary: ReturnType<typeof summarizeRoutes>,
  transport: TransportMode,
) {
  const { count, minutes, known, pending, estimates } = summary;
  if (!count) return '无站间交通';
  const segments = `${count} 段${transportNames[transport]}`;
  if (!known) return `${segments} · ${pending ? '查询中' : '暂无耗时'}`;
  const duration = `约 ${minutes} 分钟${estimates ? '（含估算）' : ''}`;
  return known === count
    ? `${segments} · ${duration}`
    : `${segments} · ${known} 段已查，${duration}`;
}

export function canCompareRoutes(summary: ReturnType<typeof summarizeRoutes>) {
  return summary.known === summary.count && summary.estimates === 0;
}

export function transitSummary(route: RouteResult | undefined) {
  if (!route || route === 'unavailable') return '';
  return (
    route.transitSteps
      ?.filter(({ mode }) => mode !== 'walking')
      .map(({ name }) => name)
      .join(' → ') ?? ''
  );
}

export function navigationUrl(place: Place, transport: TransportMode, from?: Place) {
  if (!place.coordinates || (from && !from.coordinates)) return null;
  const { longitude, latitude } = place.coordinates;
  const mode = { walking: 'walk', driving: 'car', transit: 'bus' }[transport];
  const params = new URLSearchParams({
    from: from?.coordinates
      ? `${from.coordinates.longitude},${from.coordinates.latitude},${from.name}`
      : '',
    to: `${longitude},${latitude},${place.name}`,
    mode,
    src: 'suixinxing',
    callnative: '1',
  });
  return `https://uri.amap.com/navigation?${params}`;
}
