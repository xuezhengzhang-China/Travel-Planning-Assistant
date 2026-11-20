export interface VisitHour {
  label: string;
  time: string;
  monthDayRanges?: readonly (readonly number[])[];
  access?: readonly VisitWindow[];
}

interface VisitWindow {
  opens: string;
  closes: string;
  lastEntry?: string;
  area?: string;
  closedWeekday?: number;
  weekdays?: readonly number[];
}

export interface VisitConflict {
  label: string;
  message: string;
}

function matchesSeason({ monthDayRanges }: VisitHour, date: string) {
  const monthDay = Number(date.slice(5, 7)) * 100 + Number(date.slice(8, 10));
  return monthDayRanges?.some(([start = 0, end = 0]) =>
    start <= end ? monthDay >= start && monthDay <= end : monthDay >= start || monthDay <= end,
  );
}

export function groupVisitHours(hours: readonly VisitHour[], date: string) {
  const inSeason = (row: VisitHour) => matchesSeason(row, date);

  if (!hours.some(inSeason)) return { relevant: hours, other: [] };
  return {
    relevant: hours.filter((row) => !row.monthDayRanges || inSeason(row)),
    other: hours.filter((row) => row.monthDayRanges && !inSeason(row)),
  };
}

function minutes(time: string) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function visitConflicts(
  hours: readonly VisitHour[],
  date: string,
  startTime: string | undefined,
  durationMinutes: number,
): VisitConflict[] {
  if (!startTime) return [];
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const start = minutes(startTime);
  const end = start + durationMinutes;
  const conflicts: VisitConflict[] = [];
  for (const row of hours) {
    if (row.monthDayRanges && !matchesSeason(row, date)) continue;
    for (const window of row.access ?? []) {
      if (window.weekdays && !window.weekdays.includes(weekday)) continue;
      const { area, closedWeekday, opens, closes, lastEntry } = window;
      const subject = area ?? '该景点';
      if (closedWeekday === weekday) {
        const dayName = ['日', '一', '二', '三', '四', '五', '六'][weekday];
        conflicts.push({
          label: area ? '园内时段需核对' : '当天可能闭馆',
          message: `${subject}周${dayName}通常关闭，节假日安排以官方公告为准。`,
        });
      } else if (start < minutes(opens)) {
        conflicts.push({
          label: area ? '园内时段需核对' : '到达早于开放',
          message: `${subject}通常 ${opens} 开放，计划 ${startTime} 到达。`,
        });
      } else if (start >= minutes(lastEntry ?? closes)) {
        conflicts.push({
          label: area ? '可能赶不上园内参观' : '可能赶不上',
          message: `${subject}通常 ${lastEntry ?? closes} ${lastEntry ? '停止入场' : '关闭'}，计划 ${startTime} 到达。`,
        });
      } else if (!area && end > minutes(closes)) {
        conflicts.push({
          label: '游览可能超时',
          message: `该景点通常 ${closes} 关闭，按计划游览 ${durationMinutes} 分钟可能超过关闭时间。`,
        });
      }
    }
  }
  return conflicts;
}
