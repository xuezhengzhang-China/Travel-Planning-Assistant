import type { Destination } from './destinations';
export type ReminderTrip = { id: number; destination: string; startDate: string; endDate: string; transport: string[]; theme: string[]; spots: string; destinationRegion?: Destination };
export type ReminderSettings = { enabled: boolean; train: boolean; saleTime: string; departureTime: string; completed: string[]; packed: string[] };
export type TripReminder = { id: string; title: string; due: string; detail: string; kind: 'ticket-out' | 'ticket-back' | 'packing' | 'departure'; tripId: number };
export type WeatherDay = { date: string; high: number; low: number; rain: number; code: number; wind: number };
export type PackingItem = { id: string; title: string; reason: string };
const dayLength = 86400000;
export function shanghaiDate(now = new Date()): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
export function shiftDate(date: string, days: number): string { return new Date(Date.parse(`${date}T00:00:00Z`) + days * dayLength).toISOString().slice(0, 10); }
export function readReminderSettings(trip: ReminderTrip): ReminderSettings {
  const defaults = { enabled: true, train: trip.transport.includes('火车/高铁'), saleTime: '08:00', departureTime: '09:00', completed: [], packed: [] };
  try {
    const value = JSON.parse(localStorage.getItem(`wander-reminders:${trip.id}`) || '{}');
    return { enabled: typeof value.enabled === 'boolean' ? value.enabled : defaults.enabled, train: typeof value.train === 'boolean' ? value.train : defaults.train, saleTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(value.saleTime) ? value.saleTime : defaults.saleTime, departureTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(value.departureTime) ? value.departureTime : defaults.departureTime, completed: Array.isArray(value.completed) ? value.completed : [], packed: Array.isArray(value.packed) ? value.packed : [] };
  } catch { return defaults; }
}
export function saveReminderSettings(tripId: number, settings: ReminderSettings) { localStorage.setItem(`wander-reminders:${tripId}`, JSON.stringify(settings)); window.dispatchEvent(new Event('trip-reminders-changed')); }
export function buildReminders(trip: ReminderTrip, settings: ReminderSettings): TripReminder[] {
  if (!settings.enabled || !/^\d{4}-\d{2}-\d{2}$/.test(trip.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(trip.endDate)) return [];
  const result: TripReminder[] = [];
  const add = (kind: TripReminder['kind'], date: string, time: string, title: string, detail: string) => {
    const due = new Date(`${date}T${time}:00+08:00`).toISOString();
    result.push({ id: `${trip.id}:${kind}:${due}`, title, due, detail, kind, tripId: trip.id });
  };
  if (settings.train) {
    add('ticket-out', shiftDate(trip.startDate, -14), settings.saleTime, `${trip.destination}之旅 · 去程购票`, '按通常 15 天预售期（含出发当日）推算；具体起售时间以 12306 和出发站为准。');
    add('ticket-back', shiftDate(trip.endDate, -14), settings.saleTime, `${trip.destination}之旅 · 返程购票`, '返程车票也按返程日期单独计算，请核对出发站起售时间。');
  }
  add('packing', shiftDate(trip.startDate, -1), '20:00', `${trip.destination}之旅 · 出发前整理`, '核对证件、车票、住宿与天气行李清单。');
  const departure = new Date(new Date(`${trip.startDate}T${settings.departureTime}:00+08:00`).getTime() - 2 * 3600000);
  result.push({ id: `${trip.id}:departure:${departure.toISOString()}`, tripId: trip.id, kind: 'departure', title: `${trip.destination}之旅 · 准备出发`, due: departure.toISOString(), detail: `计划 ${settings.departureTime} 出发，提前 2 小时提醒；请自行预留到站及安检时间。` });
  return result.sort((first, second) => first.due.localeCompare(second.due));
}
export function packingSuggestions(days: WeatherDay[], trip: ReminderTrip): PackingItem[] {
  const result: PackingItem[] = [{ id: 'documents', title: '证件与票务', reason: '核对有效证件、车票及住宿信息。' }, { id: 'charger', title: '充电器与移动电源', reason: '提前充电，并核对交通工具的携带要求。' }];
  if (days.some(day => day.high - day.low >= 10)) result.push({ id: 'layers', title: '外套与分层衣物', reason: '预报中有昼夜温差达到 10℃ 的日期。' });
  if (days.some(day => day.low <= 12)) result.push({ id: 'warm', title: '保暖衣物', reason: '预报最低气温不高于 12℃，早晚注意保暖。' });
  if (days.some(day => day.rain >= 40 || day.code >= 51)) result.push({ id: 'umbrella', title: '雨伞或雨衣', reason: '预报有降水或降水概率达到 40%。' });
  if (days.some(day => day.high >= 28)) result.push({ id: 'sun', title: '遮阳帽、防晒用品与水杯', reason: '预报最高气温达到 28℃，户外注意遮阳补水。' });
  if (days.some(day => day.wind >= 30)) result.push({ id: 'wind', title: '防风外层', reason: '预报最大风速达到 30 km/h，留意户外活动安排。' });
  if (trip.theme.some(theme => ['自然风光', '户外探险'].includes(theme)) || /山|公园|湿地|森林|湖/.test(trip.spots)) result.push({ id: 'mosquito', title: '户外防蚊用品', reason: '计划前往自然或户外环境时可准备，具体按季节与当地情况调整。' });
  return result;
}
function escapeCalendar(value: string) { return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }
export function calendarFile(reminders: TripReminder[], now = new Date()): string {
  const stamp = (date: string) => date.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WANDER//Trip Reminders//ZH', 'CALSCALE:GREGORIAN'];
  for (const reminder of reminders) lines.push('BEGIN:VEVENT', `UID:${reminder.id.replace(/:/g, '-')}@wander.local`, `DTSTAMP:${stamp(now.toISOString())}`, `DTSTART:${stamp(reminder.due)}`, 'DURATION:PT10M', `SUMMARY:${escapeCalendar(reminder.title)}`, `DESCRIPTION:${escapeCalendar(reminder.detail)}`, 'BEGIN:VALARM', 'TRIGGER:PT0S', 'ACTION:DISPLAY', `DESCRIPTION:${escapeCalendar(reminder.title)}`, 'END:VALARM', 'END:VEVENT');
  lines.push('END:VCALENDAR');
  const encoder = new TextEncoder();
  return lines.map(line => {
    let folded = ''; let bytes = 0;
    for (const character of line) { const size = encoder.encode(character).length; if (bytes + size > 73) { folded += '\r\n '; bytes = 1; } folded += character; bytes += size; }
    return folded;
  }).join('\r\n') + '\r\n';
}
