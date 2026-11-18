import type { TransportMode } from '@travel/shared';

/**
 * 行李清单与出行提醒（改编自 liuyan 分支 V1 的 tripReminders.ts）。
 *
 * 与 V1 的差异：Trip 改用 v2 模型（cityId/标题/英文主题码/单一交通方式），
 * 行李清单改为「季节 + 主题 + 常用物品」，不再强依赖实时天气接口。
 */

export type ReminderTrip = {
  id: string;
  destination: string;
  startDate: string;
  endDate: string;
  themes: string[];
  transport: TransportMode;
};

export type ReminderSettings = {
  enabled: boolean;
  train: boolean;
  saleTime: string;
  departureTime: string;
  completed: string[];
  packed: string[];
};

export type TripReminder = {
  id: string;
  title: string;
  due: string;
  detail: string;
  kind: 'ticket-out' | 'ticket-back' | 'packing' | 'departure';
  tripId: string;
};

export type PackingItem = { id: string; title: string; reason: string };

const dayLength = 86400000;

export function shanghaiDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * dayLength).toISOString().slice(0, 10);
}

export function readReminderSettings(trip: ReminderTrip): ReminderSettings {
  const defaults: ReminderSettings = {
    enabled: true,
    train: trip.transport === 'transit',
    saleTime: '08:00',
    departureTime: '09:00',
    completed: [],
    packed: [],
  };
  try {
    const value = JSON.parse(localStorage.getItem(`wander-reminders:${trip.id}`) || '{}') as
      Partial<ReminderSettings> | undefined;
    return {
      enabled: typeof value?.enabled === 'boolean' ? value.enabled : defaults.enabled,
      train: typeof value?.train === 'boolean' ? value.train : defaults.train,
      saleTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(value?.saleTime ?? '')
        ? value!.saleTime!
        : defaults.saleTime,
      departureTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(value?.departureTime ?? '')
        ? value!.departureTime!
        : defaults.departureTime,
      completed: Array.isArray(value?.completed) ? value.completed : [],
      packed: Array.isArray(value?.packed) ? value.packed : [],
    };
  } catch {
    return defaults;
  }
}

export function saveReminderSettings(tripId: string, settings: ReminderSettings) {
  localStorage.setItem(`wander-reminders:${tripId}`, JSON.stringify(settings));
}

export function buildReminders(trip: ReminderTrip, settings: ReminderSettings): TripReminder[] {
  if (
    !settings.enabled ||
    !/^\d{4}-\d{2}-\d{2}$/.test(trip.startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(trip.endDate)
  )
    return [];
  const result: TripReminder[] = [];
  const add = (
    kind: TripReminder['kind'],
    date: string,
    time: string,
    title: string,
    detail: string,
  ) => {
    const due = new Date(`${date}T${time}:00+08:00`).toISOString();
    result.push({ id: `${trip.id}:${kind}:${due}`, title, due, detail, kind, tripId: trip.id });
  };
  if (settings.train) {
    add(
      'ticket-out',
      shiftDate(trip.startDate, -14),
      settings.saleTime,
      `${trip.destination}之旅 · 去程购票`,
      '按通常 15 天预售期（含出发当日）推算；具体起售时间以 12306 和出发站为准。',
    );
    add(
      'ticket-back',
      shiftDate(trip.endDate, -14),
      settings.saleTime,
      `${trip.destination}之旅 · 返程购票`,
      '返程车票也按返程日期单独计算，请核对出发站起售时间。',
    );
  }
  add(
    'packing',
    shiftDate(trip.startDate, -1),
    '20:00',
    `${trip.destination}之旅 · 出发前整理`,
    '核对证件、车票、住宿与行李清单。',
  );
  const departure = new Date(
    new Date(`${trip.startDate}T${settings.departureTime}:00+08:00`).getTime() - 2 * 3600000,
  );
  result.push({
    id: `${trip.id}:departure:${departure.toISOString()}`,
    tripId: trip.id,
    kind: 'departure',
    title: `${trip.destination}之旅 · 准备出发`,
    due: departure.toISOString(),
    detail: `计划 ${settings.departureTime} 出发，提前 2 小时提醒；请自行预留到站及安检时间。`,
  });
  return result.sort((first, second) => first.due.localeCompare(second.due));
}

export function packingSuggestions(trip: ReminderTrip, now = new Date()): PackingItem[] {
  const month = now.getMonth() + 1;
  const result: PackingItem[] = [
    { id: 'documents', title: '证件与票务', reason: '身份证、门票、车票等，出发前逐一核对。' },
    {
      id: 'charger',
      title: '充电器与移动电源',
      reason: '充电宝、数据线提前充好电，留意交通工具携带要求。',
    },
  ];
  if ([6, 7, 8].includes(month))
    result.push({
      id: 'sun',
      title: '遮阳帽、防晒与补水',
      reason: '夏季出行注意防晒，户外及时补水。',
    });
  if ([12, 1, 2].includes(month))
    result.push({
      id: 'warm',
      title: '保暖衣物',
      reason: '冬季出行注意保暖，尤其是早晚温差大的时候。',
    });
  if ([3, 4, 5, 9, 10, 11].includes(month))
    result.push({
      id: 'layers',
      title: '外套与分层衣物',
      reason: '春秋昼夜温差大，备一件外套方便增减。',
    });
  if (trip.themes.includes('nature'))
    result.push({
      id: 'mosquito',
      title: '户外防蚊用品',
      reason: '前往自然/户外环境建议准备防蚊，尤其是夏季。',
    });
  return result;
}

function escapeCalendar(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function calendarFile(reminders: TripReminder[], now = new Date()): string {
  const stamp = (date: string) => date.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WANDER//Trip Reminders//ZH',
    'CALSCALE:GREGORIAN',
  ];
  for (const reminder of reminders)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${reminder.id.replace(/:/g, '-')}@wander.local`,
      `DTSTAMP:${stamp(now.toISOString())}`,
      `DTSTART:${stamp(reminder.due)}`,
      'DURATION:PT10M',
      `SUMMARY:${escapeCalendar(reminder.title)}`,
      `DESCRIPTION:${escapeCalendar(reminder.detail)}`,
      'BEGIN:VALARM',
      'TRIGGER:PT0S',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeCalendar(reminder.title)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  lines.push('END:VCALENDAR');
  const encoder = new TextEncoder();
  return (
    lines
      .map((line) => {
        let folded = '';
        let bytes = 0;
        for (const character of line) {
          const size = encoder.encode(character).length;
          if (bytes + size > 73) {
            folded += '\r\n ';
            bytes = 1;
          }
          folded += character;
          bytes += size;
        }
        return folded;
      })
      .join('\r\n') + '\r\n'
  );
}
