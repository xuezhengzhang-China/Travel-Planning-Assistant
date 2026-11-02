import { useEffect, useState } from 'react';
import FoldSection from './FoldSection';
import { loadDestinations } from './destinations';
import { loadRegions } from './footprintData';
import { buildReminders, calendarFile, packingSuggestions, readReminderSettings, saveReminderSettings, shanghaiDate } from './tripReminders';
import type { ReminderSettings, ReminderTrip, WeatherDay } from './tripReminders';

function useReminderRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const update = () => setRevision(value => value + 1);
    const timer = window.setInterval(update, 60000);
    window.addEventListener('trip-reminders-changed', update); window.addEventListener('storage', update);
    return () => { clearInterval(timer); window.removeEventListener('trip-reminders-changed', update); window.removeEventListener('storage', update); };
  }, []);
  return revision;
}
function reminderDate(date: string) { return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(date)); }

export function ReminderNotifier({ trips }: { trips: ReminderTrip[] }) {
  const revision = useReminderRevision();
  useEffect(() => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      if (localStorage.getItem('wander-notifications') !== 'enabled') return;
      const now = new Date();
      for (const trip of trips.filter(item => item.endDate >= shanghaiDate(now))) {
        const settings = readReminderSettings(trip);
        for (const reminder of buildReminders(trip, settings)) {
          if (new Date(reminder.due) > now || settings.completed.includes(reminder.id) || localStorage.getItem(`wander-notified:${reminder.id}`)) continue;
          new Notification(reminder.title, { body: reminder.detail, tag: reminder.id });
          localStorage.setItem(`wander-notified:${reminder.id}`, 'true');
        }
      }
    } catch { return; }
  }, [trips, revision]);
  return null;
}

export function TripReminderSummary({ trips, onOpen }: { trips: ReminderTrip[]; onOpen: (id: number) => void }) {
  useReminderRevision();
  const [message, setMessage] = useState('');
  const upcoming = trips.filter(trip => trip.endDate >= shanghaiDate()).flatMap(trip => {
    const settings = readReminderSettings(trip);
    return buildReminders(trip, settings).filter(reminder => !settings.completed.includes(reminder.id));
  }).sort((first, second) => first.due.localeCompare(second.due));
  async function enableNotifications() {
    if (!('Notification' in window)) { setMessage('当前浏览器不支持通知，可以导出日历提醒。'); return; }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setMessage('未获得通知权限，站内提醒和日历导出仍可使用。'); return; }
      localStorage.setItem('wander-notifications', 'enabled');
      window.dispatchEvent(new Event('trip-reminders-changed'));
      setMessage('已开启浏览器通知，页面打开期间会检查到期提醒。');
    } catch { setMessage('通知暂不可用，可使用站内提醒或日历导出。'); }
  }
  function disableNotifications() {
    try { localStorage.removeItem('wander-notifications'); setMessage('已关闭浏览器通知，保留站内提醒。'); }
    catch { setMessage('通知设置保存失败，请重试。'); }
  }
  return <FoldSection title="出发提醒" hint={`${upcoming.length} 项待办`}>
    <div className="reminder-overview">{upcoming.length ? upcoming.slice(0, 4).map(reminder => <button key={reminder.id} className="reminder-preview" onClick={() => onOpen(reminder.tripId)}><span>{reminder.title}</span><small>{new Date(reminder.due) <= new Date() ? '待确认 · ' : ''}{reminderDate(reminder.due)}</small></button>) : <p className="field-hint">创建行程后可设置购票、出发提醒和天气行李清单。</p>}</div>
    <div className="reminder-buttons"><button type="button" className="secondary-button" onClick={enableNotifications}>开启浏览器通知</button><button type="button" className="secondary-button" onClick={disableNotifications}>关闭通知</button></div>
    {message && <p role="status" className="field-hint">{message}</p>}
    <p className="field-hint">浏览器通知仅在页面打开时检查。关闭页面后，请使用行程详情里的“导出日历提醒”，导入手机或电脑日历。</p>
  </FoldSection>;
}

type Forecast = { days: WeatherDay[]; fetchedAt: string };
type ForecastResponse = { daily?: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[]; weather_code: number[]; wind_speed_10m_max: number[] } };

export default function TripPreparation({ trip }: { trip: ReminderTrip }) {
  const [settings, setSettings] = useState(() => readReminderSettings(trip));
  const [error, setError] = useState('');
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [weatherMessage, setWeatherMessage] = useState('');
  const [loading, setLoading] = useState(false);
  useReminderRevision();
  useEffect(() => {
    const update = () => setSettings(readReminderSettings(trip));
    window.addEventListener('trip-reminders-changed', update); window.addEventListener('storage', update);
    return () => { window.removeEventListener('trip-reminders-changed', update); window.removeEventListener('storage', update); };
  }, [trip]);
  function updateSettings(next: ReminderSettings) {
    try { saveReminderSettings(trip.id, next); setSettings(next); setError(''); }
    catch { setError('设置保存失败，请检查浏览器存储空间。'); }
  }
  const reminders = buildReminders(trip, settings);
  const days = forecast?.days.filter(day => day.date >= trip.startDate && day.date <= trip.endDate && day.date >= shanghaiDate()) || [];
  const packing = packingSuggestions(days, trip);
  const ended = trip.endDate < shanghaiDate();
  const tooEarly = (Date.parse(`${trip.startDate}T00:00:00Z`) - Date.parse(`${shanghaiDate()}T00:00:00Z`)) / 86400000 > 15;

  async function fetchWeather() {
    setLoading(true); setWeatherMessage(''); setForecast(null);
    try {
      let destination = trip.destinationRegion;
      if (!destination) {
        const directory = await loadDestinations();
        const matches = directory.flatMap(group => [...group.cities, ...group.counties]).filter(item => item.name.replace(/市$/, '') === trip.destination.trim().replace(/市$/, ''));
        const unique = [...new Map(matches.map(item => [item.code, item])).values()];
        if (unique.length !== 1) throw new Error('请编辑行程，从省市目录中选择目的地，再获取天气。');
        destination = unique[0];
      }
      if (!/^\d{6}$/.test(destination.code)) throw new Error('该目的地暂未接入天气坐标，可先使用基础行李清单。');
      const geography = await loadRegions(destination.parentCode);
      const feature = geography.features.find(region => String(region.properties.adcode) === destination.code);
      const center = feature?.properties.centroid || feature?.properties.center;
      if (!center) throw new Error('暂未找到目的地天气坐标，可先使用基础行李清单。');
      const query = new URLSearchParams({ latitude: String(center[1]), longitude: String(center[0]), daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,wind_speed_10m_max', timezone: 'Asia/Shanghai', forecast_days: '16' });
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('天气服务暂不可用，请稍后重试。');
      const result = await response.json() as ForecastResponse;
      if (!result.daily?.time?.length) throw new Error('没有取得可用预报，请稍后重试。');
      const daily = result.daily;
      const weatherDays = daily.time.map((date, index) => ({ date, high: daily.temperature_2m_max[index], low: daily.temperature_2m_min[index], rain: daily.precipitation_probability_max[index], code: daily.weather_code[index], wind: daily.wind_speed_10m_max[index] })).filter(day => [day.high, day.low, day.rain, day.code, day.wind].every(value => typeof value === 'number' && Number.isFinite(value)));
      setForecast({ days: weatherDays, fetchedAt: new Date().toISOString() });
      if (!weatherDays.some(day => day.date >= trip.startDate && day.date <= trip.endDate)) setWeatherMessage('当前预报尚未覆盖旅行日期，请临近出发再更新。');
    } catch (cause) { setWeatherMessage(cause instanceof Error && cause.name !== 'TimeoutError' ? cause.message : '天气查询超时，请稍后重试。行程与提醒不受影响。'); }
    finally { setLoading(false); }
  }
  function exportCalendar() {
    const remaining = reminders.filter(reminder => !settings.completed.includes(reminder.id) && new Date(reminder.due) > new Date());
    if (!remaining.length) { setError('没有未来的待办提醒可导出，请检查日期或提醒设置。'); return; }
    const url = URL.createObjectURL(new Blob([calendarFile(remaining)], { type: 'text/calendar;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${trip.destination}-出行提醒.ics`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); setError('');
  }
  return <div className="trip-preparation">
    <FoldSection title="购票与出发提醒" hint={ended ? '行程已结束' : '提前准备，安心出发'}>
      <div className="reminder-settings"><label className="feature-checkbox"><input type="checkbox" checked={settings.enabled} onChange={event => updateSettings({ ...settings, enabled: event.target.checked })} />启用本次行程提醒</label><label className="feature-checkbox"><input type="checkbox" checked={settings.train} onChange={event => updateSettings({ ...settings, train: event.target.checked })} />计划乘火车 / 高铁（含返程购票提醒）</label><div className="destination-filters"><label>购票提醒时间<input type="time" value={settings.saleTime} onChange={event => { if (event.target.value) updateSettings({ ...settings, saleTime: event.target.value }); }} /></label><label>计划出发时间<input type="time" value={settings.departureTime} onChange={event => { if (event.target.value) updateSettings({ ...settings, departureTime: event.target.value }); }} /></label></div></div>
      <p className="field-hint">火车票通常实行 15 天预售期（含当天），按乘车日提前 14 天推算购票日。这里的提醒时间由你设置，实际起售以 <a href="https://www.12306.cn/index/view/infos/sale_time.html" target="_blank" rel="noreferrer">12306 起售时间</a>为准。时间均为北京时间。</p>
      {!settings.enabled && <p className="field-hint">本次行程提醒已关闭，行程和行李清单仍保留。</p>}
      <div className="reminder-items">{reminders.map(reminder => <label key={reminder.id} className={`reminder-item ${settings.completed.includes(reminder.id) ? 'is-complete' : ''}`}><input type="checkbox" checked={settings.completed.includes(reminder.id)} onChange={event => updateSettings({ ...settings, completed: event.target.checked ? [...settings.completed, reminder.id] : settings.completed.filter(id => id !== reminder.id) })} /><span><strong>{reminder.title}</strong><small>{reminderDate(reminder.due)}{!ended && new Date(reminder.due) <= new Date() && !settings.completed.includes(reminder.id) ? ' · 已到提醒时间，请确认是否完成' : ''}</small><small>{reminder.detail}</small></span></label>)}</div>
      <button type="button" className="secondary-button" disabled={!settings.enabled || ended} onClick={exportCalendar}>导出日历提醒 .ics</button><p className="field-hint">导出后需导入日历并开启日历通知；修改行程后请替换旧日历事件。网页关闭后不会自行推送提醒。</p>
      {error && <p role="alert" className="feature-error">{error}</p>}
    </FoldSection>
    <FoldSection title="目的地天气与行李" hint="天气建议 / 可勾选清单">
      <div className="weather-heading"><div><strong>{trip.destination}</strong><p className="field-hint">{trip.startDate} — {trip.endDate}</p></div><button type="button" className="secondary-button" disabled={loading || tooEarly || ended} onClick={fetchWeather}>{loading ? '正在获取预报…' : forecast ? '更新天气建议' : '获取天气建议'}</button></div>
      {tooEarly && <p className="weather-note">距离出发超过 15 天，暂不生成旅行天气判断。临近出发后可获取预报，先准备基础用品。</p>}
      {ended && <p className="field-hint">行程已结束，不再查询未来预报。</p>}
      {weatherMessage && <p role="status" className="weather-note">{weatherMessage}</p>}
      {days.length > 0 && <><div className="weather-strip">{days.map(day => <div key={day.date}><time dateTime={day.date}>{day.date.slice(5)}</time><strong>{Math.round(day.low)}° — {Math.round(day.high)}°</strong><small>降水概率 {day.rain}%</small></div>)}</div><p className="field-hint">仅对已覆盖的 {days.length} 天预报生成建议；后续日期尚未覆盖。获取于 {forecast && reminderDate(forecast.fetchedAt)}，请临近出发更新。</p></>}
      {!forecast && !tooEarly && !ended && <p className="field-hint">点击获取后，根据实际预报补充温差、降雨、保暖等建议；未获取前不推测天气。</p>}
      <div className="packing-grid">{packing.map(item => <label key={item.id} className={`packing-item ${settings.packed.includes(item.id) ? 'is-complete' : ''}`}><input type="checkbox" checked={settings.packed.includes(item.id)} onChange={event => updateSettings({ ...settings, packed: event.target.checked ? [...settings.packed, item.id] : settings.packed.filter(id => id !== item.id) })} /><span><strong>{item.title}</strong><small>{item.reason}</small></span></label>)}</div>
      <p className="field-hint">天气来源：<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>，最多覆盖未来 16 天，使用目的地区域代表点；预报会变化。防蚊建议依据户外活动计划，非实时蚊虫监测。</p>
    </FoldSection>
  </div>;
}
