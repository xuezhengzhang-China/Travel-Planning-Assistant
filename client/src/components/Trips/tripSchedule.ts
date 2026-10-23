export type PlannerPoi = {
  id: string;
  name?: string;
  lat?: number;
  lng?: number;
  suggested_duration_minutes: number;
  opening_hours?: {
    status?: 'seasonal' | 'daily' | 'variable';
    periods?: { from: string; to: string; open: string; lastEntry: string; close: string }[];
    closedWeekdays?: number[];
    note?: string;
  };
  appointment_time?: string | null;
  appointment_end_time?: string | null;
};

export type PlannedStop = { poi: PlannerPoi; time: string; duration: number; travelMinutes: number };
export type PlannedDay = { date: string; stops: PlannedStop[] };

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};
const formatTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const dateInPeriod = (date: string, from: string, to: string) => {
  const md = date.slice(5);
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
};
const distanceKm = (a: PlannerPoi, b: PlannerPoi) => {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return 5;
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat),
    dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

/** Reorder a day's selected attractions to reduce backtracking. Keep the first
 * chosen attraction as the day's starting point, greedily connect nearby stops,
 * then apply 2-opt improvements. The route provider later supplies real leg
 * durations and road geometry for this suggested order. */
export function optimizePoiOrder<T extends PlannerPoi>(pois: T[]): T[] {
  if (pois.length < 3) return pois.slice();
  const ordered = [pois[0]];
  const remaining = pois.slice(1);
  while (remaining.length) {
    const previous = ordered[ordered.length - 1];
    let nearestIndex = 0;
    for (let index = 1; index < remaining.length; index += 1) {
      if (distanceKm(previous, remaining[index]) < distanceKm(previous, remaining[nearestIndex])) nearestIndex = index;
    }
    ordered.push(remaining.splice(nearestIndex, 1)[0]);
  }

  const pathLength = (items: T[]) => items.slice(1).reduce((total, item, index) => total + distanceKm(items[index], item), 0);
  let improved = true;
  while (improved) {
    improved = false;
    for (let start = 1; start < ordered.length - 1; start += 1) {
      for (let end = start + 1; end < ordered.length; end += 1) {
        const candidate = ordered.slice();
        candidate.splice(start, end - start + 1, ...candidate.slice(start, end + 1).reverse());
        if (pathLength(candidate) + 0.01 < pathLength(ordered)) {
          ordered.splice(0, ordered.length, ...candidate);
          improved = true;
        }
      }
    }
  }
  return ordered;
}

export function estimateTravelMinutes(a: PlannerPoi, b: PlannerPoi, mode: 'walking' | 'driving') {
  const km = distanceKm(a, b);
  return Math.max(10, Math.ceil((km / (mode === 'walking' ? 4 : 24)) * 60 + 10));
}

export function scheduleDay(
  date: string,
  pois: PlannerPoi[],
  legMinutes: number[],
  mode: 'walking' | 'driving',
  startTime = '09:00',
  breakMinutes = 15
): PlannedDay {
  let cursor = toMinutes(startTime);
  const stops: PlannedStop[] = [];
  for (let i = 0; i < pois.length; i += 1) {
    const poi = pois[i];
    const travelMinutes = i === 0 ? 0 : (legMinutes[i - 1] ?? estimateTravelMinutes(pois[i - 1], poi, mode));
    let arrival = cursor + travelMinutes;
    const hours = poi.opening_hours;
    if (hours?.closedWeekdays?.includes(new Date(`${date}T12:00:00`).getDay())) {
      throw new Error(`${poi.name} 在 ${date} 闭馆，请调整日期或景点。`);
    }
    const period = hours?.periods?.find((item) => dateInPeriod(date, item.from, item.to));
    if (hours?.status !== 'variable' && hours?.periods?.length && !period) {
      throw new Error(`${poi.name} 暂无 ${date} 对应季节的开放时间，建议核对官方公告。`);
    }
    if (period) arrival = Math.max(arrival, toMinutes(period.open));
    const duration = poi.suggested_duration_minutes || 90;
    if (period && (arrival > toMinutes(period.lastEntry) || arrival + duration > toMinutes(period.close))) {
      throw new Error(
        `${poi.name} 按当前路线约 ${formatTime(arrival)} 到达，超过停止入场或闭园时间；请调整景点顺序或日期。`
      );
    }
    if (poi.appointment_time) {
      const appointment = toMinutes(poi.appointment_time);
      if (arrival > appointment + 15) {
        throw new Error(`${poi.name} 按当前交通路线约 ${formatTime(arrival)} 到达，可能错过 ${poi.appointment_time} 的预约时段。`);
      }
      arrival = Math.max(arrival, appointment);
      if (poi.appointment_end_time && arrival + duration > toMinutes(poi.appointment_end_time)) {
        throw new Error(`${poi.name} 的游玩时长超出预约结束时间 ${poi.appointment_end_time}，请调整时段或游玩时间。`);
      }
    }
    if (period && (arrival > toMinutes(period.lastEntry) || arrival + duration > toMinutes(period.close))) {
      throw new Error(`${poi.name} 的预约或等待时间使游玩计划超出开放时段，请调整预约时间。`);
    }
    stops.push({ poi, time: formatTime(arrival), duration, travelMinutes });
    cursor = arrival + duration + (i < pois.length - 1 ? breakMinutes : 0);
  }
  return { date, stops };
}

/** Build a bounded set of orders whose opening and appointment windows are feasible.
 * The beam search keeps route-provider calls small while allowing a reservation
 * or a venue closing time to move a stop earlier in the day. */
export function findCandidatePoiOrders<T extends PlannerPoi>(
  date: string,
  pois: T[],
  mode: 'walking' | 'driving',
  startTime = '09:00',
  breakMinutes = 15,
  limit = 3,
): T[][] {
  if (pois.length < 2) return [pois.slice()];
  type Candidate = { ordered: T[]; score: number };
  let beam: Candidate[] = [{ ordered: [], score: toMinutes(startTime) }];
  const width = 36;
  for (let depth = 0; depth < pois.length; depth += 1) {
    const expanded: Candidate[] = [];
    for (const state of beam) {
      const remaining = pois.filter((poi) => !state.ordered.some((item) => item.id === poi.id));
      for (const next of remaining) {
        const ordered = [...state.ordered, next];
        const legs = ordered.slice(1).map((poi, index) => estimateTravelMinutes(ordered[index], poi, mode));
        try {
          const plan = scheduleDay(date, ordered, legs, mode, startTime, breakMinutes);
          const last = plan.stops[plan.stops.length - 1];
          const finish = toMinutes(last.time) + last.duration;
          const travel = plan.stops.reduce((sum, stop) => sum + stop.travelMinutes, 0);
          expanded.push({ ordered, score: finish + travel * 0.15 });
        } catch {
          // This prefix cannot be completed in this order under known constraints.
        }
      }
    }
    if (!expanded.length) return [pois.slice()];
    expanded.sort((a, b) => a.score - b.score);
    beam = expanded.slice(0, width);
  }
  return beam.slice(0, Math.max(1, limit)).map(({ ordered }) => ordered);
}
