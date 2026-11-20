import type { ScheduleItem } from '@travel/shared';

export function scheduleMinutes(time: string) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function formatScheduleMinutes(minutes: number) {
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  return `${hours}:${String(minutes % 60).padStart(2, '0')}`;
}

export function destinationDate(timeZone = 'Asia/Shanghai', instant = new Date()) {
  const options = { year: 'numeric', month: '2-digit', day: '2-digit' } as const;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en', { ...options, timeZone });
  } catch {
    formatter = new Intl.DateTimeFormat('en', { ...options, timeZone: 'Asia/Shanghai' });
  }
  const parts = formatter.formatToParts(instant);
  return ['year', 'month', 'day']
    .map((key) => parts.find(({ type }) => type === key)?.value)
    .join('-');
}

type SegmentKind = 'visit' | 'travel' | 'buffer';

export interface DaySegment {
  kind: SegmentKind;
  start: number;
  end: number;
  placeId: string;
  estimated?: boolean;
}

export function buildDayTimeline(items: readonly ScheduleItem[]) {
  const segments: DaySegment[] = [];
  const totals = { visit: 0, travel: 0, buffer: 0 };
  let previousEnd: number | undefined;
  for (const item of items) {
    const { placeId, durationMinutes, travelMinutesFromPrevious, travelTimeSource } = item;
    const start = scheduleMinutes(item.startTime);
    const end = start + durationMinutes;
    if (previousEnd !== undefined && start > previousEnd) {
      const travelEnd = Math.min(start, previousEnd + travelMinutesFromPrevious);
      if (travelEnd > previousEnd) {
        segments.push({
          kind: 'travel',
          start: previousEnd,
          end: travelEnd,
          placeId,
          estimated: travelTimeSource === 'estimate',
        });
        totals.travel += travelEnd - previousEnd;
      }
      if (travelEnd < start) {
        segments.push({ kind: 'buffer', start: travelEnd, end: start, placeId });
        totals.buffer += start - travelEnd;
      }
    }
    segments.push({ kind: 'visit', start, end, placeId });
    totals.visit += durationMinutes;
    previousEnd = end;
  }
  return { segments, totals };
}

export function readVisited(key: string): Set<string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}
