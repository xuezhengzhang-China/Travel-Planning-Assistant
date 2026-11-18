import type { Place, ScheduleDay, Trip } from '@travel/shared';
import { scheduleGroups } from '@travel/shared/recommendation-engine';
import type { LocalDay } from '../../data/planner';
import { formatScheduleMinutes, scheduleMinutes } from './trip-day';

export function scheduleWindow(day: ScheduleDay | undefined) {
  const first = day?.items[0];
  const last = day?.items.at(-1);
  if (!first || !last) return '无景点';
  const end = scheduleMinutes(last.startTime) + last.durationMinutes;
  return `${first.startTime}–${formatScheduleMinutes(end)}`;
}

export function previewScheduleChanges(
  trip: Trip,
  places: Place[],
  order: LocalDay[],
  changedDates: ReadonlySet<string>,
) {
  const { startDate, endDate } = trip.planningInput;
  if (!startDate || !endDate) throw new Error('行程缺少完整日期');
  const groups = order.map((day) =>
    changedDates.has(day.date) ? day : { date: day.date, placeIds: [] },
  );
  const plan = scheduleGroups(
    places,
    {
      ...trip.planningInput,
      startDate,
      endDate,
      selectedPlaceIds: groups.flatMap(({ placeIds }) => placeIds),
    },
    groups,
  );
  return {
    unassigned: plan.unassignedPlaceIds,
    days: plan.days.map((day, index) =>
      changedDates.has(day.date) ? day : (trip.days[index] ?? day),
    ),
  };
}
