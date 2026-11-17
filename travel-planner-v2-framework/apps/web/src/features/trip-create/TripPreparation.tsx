import { useMemo, useState } from 'react';
import type { TransportMode } from '@travel/shared';
import {
  buildReminders,
  calendarFile,
  packingSuggestions,
  readReminderSettings,
  saveReminderSettings,
  type ReminderSettings,
  type ReminderTrip,
} from './trip-reminders';
import './trip-preparation.css';

function reminderDate(date: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(date));
}

export interface TripPreparationProps {
  destination: string;
  startDate: string;
  endDate: string;
  themes: string[];
  transport: TransportMode;
}

/**
 * 行程详情里的「出发提醒与行李清单」。
 * 纯前端：提醒与行李按目的地 + 日期 + 季节 + 主题生成，设置保存在浏览器。
 */
export default function TripPreparation({
  destination,
  startDate,
  endDate,
  themes,
  transport,
}: TripPreparationProps) {
  const trip: ReminderTrip = useMemo(
    () => ({
      id: `${destination}:${startDate}`,
      destination,
      startDate,
      endDate,
      themes,
      transport,
    }),
    [destination, startDate, endDate, themes, transport],
  );
  const [settings, setSettings] = useState<ReminderSettings>(() => readReminderSettings(trip));
  const [message, setMessage] = useState('');

  const reminders = useMemo(() => buildReminders(trip, settings), [trip, settings]);
  const packing = useMemo(() => packingSuggestions(trip), [trip]);

  function update(next: ReminderSettings) {
    try {
      saveReminderSettings(trip.id, next);
      setSettings(next);
      setMessage('');
    } catch {
      setMessage('设置保存失败，请检查浏览器存储空间。');
    }
  }

  function exportCalendar() {
    const remaining = reminders.filter(
      (reminder) =>
        !settings.completed.includes(reminder.id) && new Date(reminder.due) > new Date(),
    );
    if (!remaining.length) {
      setMessage('没有未来的待办提醒可导出，请检查日期或提醒设置。');
      return;
    }
    const url = URL.createObjectURL(
      new Blob([calendarFile(remaining)], { type: 'text/calendar;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${destination}-出行提醒.ics`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('');
  }

  return (
    <section className="trip-preparation">
      <h3>出发提醒与行李清单</h3>

      <label className="prep-check">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(event) => update({ ...settings, enabled: event.target.checked })}
        />
        启用本次行程提醒
      </label>

      {settings.enabled && (
        <div className="prep-block">
          <div className="prep-row">
            <label className="prep-check">
              <input
                type="checkbox"
                checked={settings.train}
                onChange={(event) => update({ ...settings, train: event.target.checked })}
              />
              乘火车/高铁（含购票提醒）
            </label>
          </div>
          <div className="prep-row">
            <label>
              计划出发时间
              <input
                type="time"
                value={settings.departureTime}
                onChange={(event) => {
                  if (event.target.value)
                    update({ ...settings, departureTime: event.target.value });
                }}
              />
            </label>
          </div>

          <ul className="prep-list">
            {reminders.map((reminder) => (
              <li
                key={reminder.id}
                className={settings.completed.includes(reminder.id) ? 'done' : ''}
              >
                <label>
                  <input
                    type="checkbox"
                    checked={settings.completed.includes(reminder.id)}
                    onChange={() =>
                      update({
                        ...settings,
                        completed: settings.completed.includes(reminder.id)
                          ? settings.completed.filter((id) => id !== reminder.id)
                          : [...settings.completed, reminder.id],
                      })
                    }
                  />
                  <span>
                    <strong>{reminder.title}</strong>
                    <small>{reminderDate(reminder.due)}</small>
                    <small>{reminder.detail}</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <button type="button" className="prep-export" onClick={exportCalendar}>
            导出日历提醒 .ics
          </button>
        </div>
      )}

      <div className="prep-block">
        <p className="prep-caption">行李清单（按季节与主题建议）</p>
        <ul className="prep-list">
          {packing.map((item) => (
            <li key={item.id} className={settings.packed.includes(item.id) ? 'done' : ''}>
              <label>
                <input
                  type="checkbox"
                  checked={settings.packed.includes(item.id)}
                  onChange={() =>
                    update({
                      ...settings,
                      packed: settings.packed.includes(item.id)
                        ? settings.packed.filter((id) => id !== item.id)
                        : [...settings.packed, item.id],
                    })
                  }
                />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.reason}</small>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      {message && (
        <p className="prep-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
