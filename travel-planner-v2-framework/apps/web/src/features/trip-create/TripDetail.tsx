import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { BPlaces, Destination, Place, ScheduleDay, Trip } from '@travel/shared';
import { getBeijingVisitInfo } from '../../data/beijing';
import { movePlace, reorderPlace, type LocalDay } from '../../data/planner';
import { notifyHost, type TripHostEvents } from './host-integration';
import TripCover from './TripCover';
import TripDayTimeline from './TripDayTimeline';
import TripMap, { type TripPin } from './TripMap';
import TripOuting from './TripOuting';
import TripPlaceCard from './TripPlaceCard';
import TripTools from './TripTools';
import TripTransitSteps from './TripTransitSteps';
import { bookingLabels, readBookings, type BookingStatus } from './trip-booking';
import { destinationDate, readVisited } from './trip-day';
import type { TripDraftApi } from './trip-draft-client';
import { tripErrorMessage } from './trip-errors';
import { previewScheduleChanges, scheduleWindow } from './trip-schedule-preview';
import { visitConflicts } from './visit-hours';
import {
  buildDays,
  canCompareRoutes,
  formatRouteSummary,
  navigationUrl,
  savedOrder,
  summarizeRoutes,
  transitSummary,
  transportNames,
  type RouteResult,
} from './trip-map-routes';
import './trip-detail.css';
import './trip-day.css';

type RouteCache = { tripId: string; results: Map<string, BPlaces.RoutePreview> };

function focusRegion(element: HTMLElement | null) {
  element?.focus({ preventScroll: true });
  element?.scrollIntoView({ block: 'start' });
}

function routeText(route: RouteResult | undefined) {
  if (!route) return '正在查询路线…';
  if (route === 'unavailable') return '暂无路线';
  if (route.source === 'estimate') return `约 ${route.durationMinutes} 分钟 · 步行估算`;
  const duration = `约 ${route.durationMinutes} 分钟`;
  return route.paths?.length ? duration : `${duration} · 暂无轨迹`;
}

function TripSchedule({
  trip,
  places,
  previewRoute,
  routeCache,
  cityName,
  timeZone,
  onEdit,
  editDisabled,
  onSaveSchedule,
}: {
  trip: Trip;
  places: Place[];
  previewRoute?: TripDraftApi['previewRoute'];
  routeCache: RefObject<RouteCache>;
  cityName?: string;
  timeZone?: string;
  onEdit: () => void;
  editDisabled: boolean;
  onSaveSchedule: (days: ScheduleDay[]) => Promise<void>;
}) {
  const [date, setDate] = useState<string | null>(null);
  const [outing, setOuting] = useState(false);
  const [outingError, setOutingError] = useState('');
  const visitedKey = `suixin:trip-visited:${trip.ownerId}:${trip.id}`;
  const [visited, setVisited] = useState(() => readVisited(visitedKey));
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedLeg, setSelectedLeg] = useState<string | null>(null);
  const [draft, setDraft] = useState<LocalDay[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const bookingStorageKey = `suixin:trip-bookings:${trip.ownerId}:${trip.id}`;
  const [bookings, setBookings] = useState(() => readBookings(bookingStorageKey));
  const agenda = useRef<HTMLElement>(null);
  const mapPane = useRef<HTMLElement>(null);
  const changePreview = useRef<HTMLElement>(null);
  const agendaDays = useRef<HTMLDivElement>(null);
  const stopTrigger = useRef<HTMLButtonElement | null>(null);
  const [routes, setRoutes] = useState<Map<string, RouteResult>>(
    () => new Map(routeCache.current.tripId === trip.id ? routeCache.current.results : []),
  );
  const resolved = useRef(new Map<string, RouteResult>());
  const originalOrder = useMemo(() => savedOrder(trip), [trip]);
  const originalDays = useMemo(
    () => buildDays(trip, places, originalOrder),
    [trip, places, originalOrder],
  );
  const placeNames = useMemo(
    () => new Map(places.map((place) => [place.id, place.name])),
    [places],
  );
  const days = useMemo(
    () => (draft ? buildDays(trip, places, draft) : originalDays),
    [trip, places, draft, originalDays],
  );
  const changedDays = useMemo(
    () =>
      new Set(
        draft
          ?.filter(
            (day, index) =>
              day.placeIds.length !== originalOrder[index]?.placeIds.length ||
              day.placeIds.some(
                (placeId, position) => placeId !== originalOrder[index]?.placeIds[position],
              ),
          )
          .map((day) => day.date),
      ),
    [draft, originalOrder],
  );
  const draftPreview = useMemo(() => {
    if (!draft || !changedDays.size) return null;
    try {
      return previewScheduleChanges(trip, places, draft, changedDays);
    } catch {
      return null;
    }
  }, [changedDays, draft, places, trip]);
  const itemsByPlace = useMemo(
    () =>
      new Map(
        (draftPreview?.days ?? trip.days).flatMap((day) =>
          (!draftPreview && changedDays.has(day.date) ? [] : day.items).map((item) => [
            item.placeId,
            item,
          ]),
        ),
      ),
    [changedDays, draftPreview, trip.days],
  );
  const conflicts = useMemo(
    () =>
      new Map(
        days.flatMap((day) =>
          day.stops.map(({ placeId }) => {
            const hours = getBeijingVisitInfo(placeId)?.hours;
            const timing = itemsByPlace.get(placeId);
            return [
              placeId,
              hours && timing
                ? visitConflicts(hours, day.date, timing.startTime, timing.durationMinutes)
                : [],
            ];
          }),
        ),
      ),
    [days, itemsByPlace],
  );
  const visibleDays = useMemo(
    () => (date ? days.filter((day) => day.date === date) : days),
    [days, date],
  );
  const visibleLegs = useMemo(() => visibleDays.flatMap((day) => day.legs), [visibleDays]);
  const originalVisibleLegs = useMemo(
    () => originalDays.flatMap((day) => (!date || day.date === date ? day.legs : [])),
    [originalDays, date],
  );
  const comparing = visibleDays.some((day) => changedDays.has(day.date));
  const queryLegs = useMemo(
    () =>
      changedDays.size
        ? [
            ...new Map(
              [
                ...visibleLegs,
                ...[...days, ...originalDays].flatMap((day) =>
                  changedDays.has(day.date) ? day.legs : [],
                ),
              ].map((leg) => [leg.key, leg]),
            ).values(),
          ]
        : visibleLegs,
    [changedDays, days, originalDays, visibleLegs],
  );
  const { cityId, transportMode } = trip.planningInput;

  useEffect(() => {
    if (!previewRoute || !queryLegs.length) return;
    if (routeCache.current.tripId !== trip.id)
      routeCache.current = { tripId: trip.id, results: new Map() };
    const cache = routeCache.current.results;
    const controller = new AbortController();
    async function loadRoutes(preview: NonNullable<TripDraftApi['previewRoute']>) {
      for (const leg of queryLegs) {
        if (controller.signal.aborted) return;
        if (cache.has(leg.key) || resolved.current.has(leg.key)) continue;
        const from = leg.from.place?.coordinates;
        const to = leg.to.place?.coordinates;
        let route: RouteResult = 'unavailable';
        if (from && to) {
          try {
            route = await preview({ from, to, cityId, transportMode }, controller.signal);
          } catch {
            // 其他路段仍可以显示。
          }
        }
        if (controller.signal.aborted) return;
        if (route !== 'unavailable' && route.source === 'provider' && route.paths?.length)
          cache.set(leg.key, route);
        resolved.current.set(leg.key, route);
        setRoutes((current) => new Map(current).set(leg.key, route));
        if (from && to) await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
    void loadRoutes(previewRoute);
    return () => controller.abort();
  }, [attempt, queryLegs, previewRoute, routeCache, trip.id, cityId, transportMode]);

  const pins = useMemo(
    () =>
      visibleDays.flatMap(({ color, stops }) =>
        stops.flatMap(({ place, number }): TripPin[] =>
          place?.coordinates
            ? [
                {
                  id: place.id,
                  number,
                  label: place.name,
                  position: [place.coordinates.longitude, place.coordinates.latitude],
                  color,
                },
              ]
            : [],
        ),
      ),
    [visibleDays],
  );
  const lines = useMemo(
    () =>
      visibleDays.flatMap(({ color, legs }) =>
        legs.flatMap(({ key }) => {
          const route = routes.get(key);
          return route &&
            route !== 'unavailable' &&
            route.source === 'provider' &&
            route.paths?.length
            ? [{ id: key, color, paths: route.paths }]
            : [];
        }),
      ),
    [visibleDays, routes],
  );
  const availableLegs = queryLegs.filter(
    (leg) => leg.from.place?.coordinates && leg.to.place?.coordinates,
  );
  const pending = previewRoute ? availableLegs.filter(({ key }) => !routes.has(key)).length : 0;
  const incomplete = previewRoute
    ? availableLegs.filter(({ key }) => {
        const route = routes.get(key);
        return route && (route === 'unavailable' || !route.paths?.length);
      })
    : [];
  function showDay(nextDate: string | null) {
    if (!nextDate) setOuting(false);
    setDate(nextDate);
    setSelected(null);
    setSelectedLeg(null);
  }
  const outingDay = outing && !draft ? visibleDays.find((day) => day.date === date) : undefined;
  const today = destinationDate(timeZone);
  const upcoming = outingDay?.stops.find(
    (stop) => !visited.has(`${outingDay.date}:${stop.placeId}`),
  );
  const visitedCount =
    outingDay?.stops.filter((stop) => visited.has(`${outingDay.date}:${stop.placeId}`)).length ?? 0;

  function enterOuting() {
    const day = date ?? days.find((day) => day.date >= today)?.date ?? days.at(-1)?.date;
    if (!day) return;
    showDay(day);
    setOuting(true);
    setOutingError('');
  }

  function changeVisited(date: string, placeId: string, complete: boolean) {
    const next = readVisited(visitedKey);
    const key = `${date}:${placeId}`;
    if (complete) next.add(key);
    else next.delete(key);
    try {
      localStorage.setItem(visitedKey, JSON.stringify([...next]));
      setVisited(next);
      setOutingError('');
    } catch {
      setOutingError('浏览器暂时无法保存游览进度。');
    }
  }
  const focusStop = useCallback((id: string, trigger?: HTMLButtonElement) => {
    if (trigger) stopTrigger.current = trigger;
    setSelected(id);
    setSelectedLeg(null);
  }, []);
  const focusLeg = useCallback((id: string) => {
    setSelectedLeg(id);
    setSelected(null);
  }, []);
  const visibleStops = useMemo(
    () =>
      visibleDays.flatMap((day) =>
        day.stops.flatMap((stop) =>
          stop.place
            ? [
                {
                  place: stop.place,
                  date: day.date,
                  dayNumber: day.number,
                  startTime: itemsByPlace.get(stop.placeId)?.startTime,
                  durationMinutes:
                    itemsByPlace.get(stop.placeId)?.durationMinutes ?? stop.durationMinutes,
                },
              ]
            : [],
        ),
      ),
    [itemsByPlace, visibleDays],
  );
  const activeStopIndex = visibleStops.findIndex(({ place }) => place.id === selected);
  const activeStop = visibleStops[activeStopIndex];
  const activePlace = activeStop?.place;
  const activeBookingKey = activeStop && `${activeStop.date}:${activeStop.place.id}`;
  const activeLeg = visibleLegs.find((leg) => leg.key === selectedLeg);
  const activeRoute = activeLeg && routes.get(activeLeg.key);
  const legDirections =
    activeLeg?.from.place && activeLeg.to.place
      ? navigationUrl(activeLeg.to.place, transportMode, activeLeg.from.place)
      : null;

  useEffect(() => {
    const list = agendaDays.current;
    if (!selected || !list || list.scrollHeight <= list.clientHeight) return;
    const stop = list.querySelector(`button[data-place-id="${CSS.escape(selected)}"]`);
    if (!stop) return;
    const listBounds = list.getBoundingClientRect();
    const bounds = stop.getBoundingClientRect();
    if (bounds.bottom > listBounds.bottom) list.scrollTop += bounds.bottom - listBounds.bottom;
    if (bounds.top < listBounds.top) list.scrollTop += bounds.top - listBounds.top;
  }, [selected]);

  function closePlace() {
    setSelected(null);
    const trigger = stopTrigger.current;
    if (trigger?.isConnected) {
      trigger.focus();
    } else {
      agenda.current?.focus();
    }
  }
  const summary = summarizeRoutes(visibleLegs, routes);
  const previous = comparing ? summarizeRoutes(originalVisibleLegs, routes) : null;
  const difference =
    previous && canCompareRoutes(previous) && canCompareRoutes(summary)
      ? summary.minutes - previous.minutes
      : null;
  const differenceText =
    difference === 0
      ? '交通耗时相同'
      : difference !== null
        ? `${difference > 0 ? '增加' : '节省'}约 ${Math.abs(difference)} 分钟`
        : previous?.pending || summary.pending
          ? '正在查询对比路线…'
          : '部分路段缺少高德耗时，暂无法比较';

  function moveStop(id: string, direction: -1 | 1, day: string) {
    setDraft((current) => current && reorderPlace(current, id, direction));
    showDay(day);
    setSaveError('');
  }

  function moveToDay(id: string, nextDate: string) {
    setDraft((current) => movePlace(current ?? originalOrder, id, nextDate));
    setOuting(false);
    setDate(null);
    setSelectedLeg(null);
    setSaved(false);
    setSaveError('');
  }

  function changeBooking(key: string, status: BookingStatus | '') {
    const next = readBookings(bookingStorageKey);
    if (status) next[key] = status;
    else delete next[key];
    localStorage.setItem(bookingStorageKey, JSON.stringify(next));
    setBookings(next);
  }

  const previewError =
    changedDays.size && (!draftPreview || draftPreview.unassigned.length > 0)
      ? draftPreview
        ? `当前日期或路线无法安排：${draftPreview.unassigned.map((id) => placeNames.get(id) ?? id).join('、')}。请调整日期或顺序。`
        : '暂时无法生成时间预览，请检查景点目录或取消调整。'
      : '';
  const canSave = !saving && !editDisabled && draftPreview && !draftPreview.unassigned.length;

  function cancelOrder() {
    setDraft(null);
    setSelectedLeg(null);
    setSaveError('');
    if (date && selected) showDay(null);
  }

  async function saveOrder() {
    if (!canSave || !draftPreview) return;
    setSaving(true);
    setSaveError('');
    try {
      await onSaveSchedule(draftPreview.days);
      setDraft(null);
      setSaved(true);
    } catch (error) {
      setSaveError(tripErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="trip-detail-layout">
      <section className="trip-detail-agenda" aria-label="每日行程" ref={agenda} tabIndex={-1}>
        <header className="trip-detail-section-header">
          <h2>每日行程</h2>
          <button
            type="button"
            className="trip-text-button trip-map-jump"
            onClick={() => focusRegion(mapPane.current)}
          >
            回到地图 <span aria-hidden="true">↑</span>
          </button>
          <button
            className="trip-view-all"
            type="button"
            aria-pressed={date === null}
            onClick={() => showDay(null)}
          >
            查看全部
          </button>
        </header>
        <div className="trip-order-controls" data-editing={Boolean(draft)}>
          {draft ? (
            <>
              <button type="button" onClick={cancelOrder} disabled={saving}>
                取消
              </button>
              <button
                type="button"
                className="workspace-primary"
                onClick={() => void saveOrder()}
                disabled={!canSave}
              >
                {saving ? '正在保存…' : '保存安排'}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onEdit} disabled={editDisabled}>
                <span aria-hidden="true">＋ </span>添加景点
              </button>
              <button
                className="trip-order-toggle"
                type="button"
                disabled={editDisabled || originalOrder.every((day) => day.placeIds.length < 2)}
                onClick={() => {
                  setOuting(false);
                  setDraft(originalOrder);
                  setSaved(false);
                }}
              >
                调整顺序
              </button>
            </>
          )}
          {saved && <span role="status">已保存新安排</span>}
        </div>
        {previewError && (
          <p className="workspace-error trip-order-error" role="status">
            {previewError}
          </p>
        )}
        {saveError && (
          <p className="workspace-error trip-order-error" role="alert">
            {saveError}
          </p>
        )}
        <div className="trip-agenda-days" ref={agendaDays}>
          {(outingDay ? [outingDay] : days).map((day) => (
            <section className="trip-detail-day" key={day.date}>
              <h3>
                <button
                  className="trip-day-button"
                  type="button"
                  aria-pressed={date === day.date}
                  onClick={() => showDay(day.date)}
                >
                  <span className="trip-day-swatch" style={{ background: day.color }} />第{' '}
                  {day.number} 天{' '}
                  <time dateTime={day.date}>
                    {Number(day.date.slice(5, 7))}月{Number(day.date.slice(8))}日
                  </time>
                </button>
              </h3>
              {previewRoute && day.legs.length > 0 && (
                <p className="trip-day-traffic">
                  {formatRouteSummary(summarizeRoutes(day.legs, routes), transportMode)}
                </p>
              )}
              {!day.stops.length && <p className="trip-detail-muted">当天未安排景点</p>}
              {day.stops.length > 0 &&
                day.stops.every(({ placeId }) => itemsByPlace.has(placeId)) && (
                  <TripDayTimeline
                    items={day.stops.map(({ placeId }) => itemsByPlace.get(placeId)!)}
                    names={placeNames}
                  />
                )}
              <ol>
                {day.stops.map((stop, index) => {
                  const leg = day.legs[index - 1];
                  const place = stop.place;
                  const timing = itemsByPlace.get(stop.placeId);
                  const warning = conflicts.get(stop.placeId)?.[0];
                  const booking = bookings[`${day.date}:${stop.placeId}`];
                  const needsBooking = getBeijingVisitInfo(stop.placeId)?.booking
                    .reservationRequired;
                  const completed = Boolean(
                    outingDay && visited.has(`${day.date}:${stop.placeId}`),
                  );
                  return (
                    <li key={stop.placeId}>
                      {leg && previewRoute && (
                        <button
                          type="button"
                          className="trip-leg-info"
                          aria-label={`查看${leg.from.place?.name ?? '上一站'}到${place?.name ?? '本站'}的路线`}
                          aria-pressed={selectedLeg === leg.key}
                          onClick={() => {
                            if (date && date !== day.date) setDate(day.date);
                            focusLeg(leg.key);
                          }}
                        >
                          {leg.from.place?.coordinates && place?.coordinates
                            ? routeText(routes.get(leg.key))
                            : '景点缺少坐标'}
                          {transportMode === 'transit' && transitSummary(routes.get(leg.key)) && (
                            <span className="trip-leg-lines">
                              {transitSummary(routes.get(leg.key))}
                            </span>
                          )}
                        </button>
                      )}
                      <div className="trip-stop-row">
                        <button
                          className="trip-stop"
                          type="button"
                          data-place-id={stop.placeId}
                          data-completed={completed}
                          aria-pressed={selected === stop.placeId}
                          disabled={!place}
                          onClick={(event) => {
                            if (date && date !== day.date) setDate(day.date);
                            focusStop(stop.placeId, event.currentTarget);
                          }}
                        >
                          <span className="trip-stop-number" style={{ background: day.color }}>
                            {stop.number}
                          </span>
                          <span>
                            <strong>{place?.name ?? '景点资料不可用'}</strong>
                            <span className="trip-detail-muted">
                              {timing
                                ? `${timing.startTime} · 游览 ${timing.durationMinutes} 分钟`
                                : '时间待调整'}
                            </span>
                            {warning && <span className="trip-visit-badge">{warning.label}</span>}
                            {(booking || needsBooking) && (
                              <span className="trip-booking-badge">
                                {booking ? bookingLabels[booking] : '需预约'}
                              </span>
                            )}
                          </span>
                        </button>
                        {outingDay && (
                          <label className="trip-stop-complete">
                            <input
                              type="checkbox"
                              checked={completed}
                              aria-label={`已游览${place?.name ?? `景点 ${stop.number}`}`}
                              onChange={(event) =>
                                changeVisited(day.date, stop.placeId, event.target.checked)
                              }
                            />
                          </label>
                        )}
                        {draft && day.stops.length > 1 && (
                          <div className="trip-order-arrows">
                            <button
                              type="button"
                              aria-label={`上移${place?.name ?? stop.number}`}
                              disabled={saving || index === 0}
                              onClick={() => moveStop(stop.placeId, -1, day.date)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              aria-label={`下移${place?.name ?? stop.number}`}
                              disabled={saving || index === day.stops.length - 1}
                              onClick={() => moveStop(stop.placeId, 1, day.date)}
                            >
                              ↓
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      </section>
      <section className="trip-detail-map" aria-label="地图与路线" ref={mapPane} tabIndex={-1}>
        <header className="trip-detail-section-header">
          <h2>地图与路线</h2>
          <div className="trip-map-heading-actions">
            <span className="trip-map-scope">
              {date ?? '全部日期'} · {transportNames[transportMode]}
            </span>
            {!outingDay && (
              <button
                type="button"
                className="trip-view-all trip-outing-open"
                disabled={Boolean(draft)}
                onClick={enterOuting}
              >
                出游模式
              </button>
            )}
          </div>
          <button
            type="button"
            className="trip-text-button trip-map-jump"
            onClick={() => focusRegion(agenda.current)}
          >
            跳到每日行程 <span aria-hidden="true">↓</span>
          </button>
        </header>
        {outingDay && (
          <TripOuting
            days={days}
            date={outingDay.date}
            today={today}
            count={outingDay.stops.length}
            completed={visitedCount}
            next={
              upcoming && {
                id: upcoming.placeId,
                name: upcoming.place?.name ?? '景点资料不可用',
                time: upcoming.startTime,
                directions: upcoming.place ? navigationUrl(upcoming.place, transportMode) : null,
                hasDetails: Boolean(upcoming.place),
                reminder: conflicts.get(upcoming.placeId)?.[0]?.label,
              }
            }
            error={outingError}
            onDate={(nextDate) => {
              showDay(nextDate);
              setOutingError('');
            }}
            onExit={() => showDay(null)}
            onOpen={focusStop}
            onComplete={(id) => changeVisited(outingDay.date, id, true)}
          />
        )}
        {saved && (
          <p className="trip-map-saved" role="status">
            已保存新安排
          </p>
        )}
        {previewRoute && (
          <div className="trip-traffic-summary" aria-label="站间交通汇总" aria-live="polite">
            <div className="trip-traffic-total">
              <strong>{date ? '当天交通' : '行程交通'}</strong>
              <span>{formatRouteSummary(summary, transportMode)}</span>
            </div>
            {previous && (
              <div className="trip-route-comparison" aria-label="调序前后对比">
                <span>
                  <small>调整前</small> {formatRouteSummary(previous, transportMode)}
                </span>
                <span>
                  <small>调整后</small> {formatRouteSummary(summary, transportMode)}
                </span>
                <strong
                  data-change={
                    difference === null || difference === 0
                      ? 'neutral'
                      : difference > 0
                        ? 'longer'
                        : 'shorter'
                  }
                >
                  {differenceText}
                </strong>
              </div>
            )}
          </div>
        )}
        {changedDays.size > 0 && (
          <section
            className="trip-change-preview"
            aria-label="受影响日期"
            ref={changePreview}
            tabIndex={-1}
          >
            <strong>调整预览</strong>
            {days
              .filter((day) => changedDays.has(day.date))
              .map((day) => {
                const original = originalDays[day.number - 1]!;
                const nextSchedule = draftPreview?.days[day.number - 1];
                return (
                  <div key={day.date}>
                    <button
                      className="trip-text-button"
                      type="button"
                      onClick={() => showDay(day.date)}
                    >
                      第 {day.number} 天 · {day.date}
                    </button>
                    <span>
                      {original.stops.length} 站 → {day.stops.length} 站
                    </span>
                    <span>
                      {scheduleWindow(trip.days[day.number - 1])} →{' '}
                      {nextSchedule?.items.length === day.stops.length
                        ? scheduleWindow(nextSchedule)
                        : '时间待调整'}
                    </span>
                    {previewRoute && (
                      <span>
                        {formatRouteSummary(summarizeRoutes(original.legs, routes), transportMode)}
                        {' → '}
                        {formatRouteSummary(summarizeRoutes(day.legs, routes), transportMode)}
                      </span>
                    )}
                  </div>
                );
              })}
            {(previewError || saveError) && (
              <p className="trip-preview-error" role={saveError ? 'alert' : 'status'}>
                {saveError || previewError}
              </p>
            )}
            <div className="trip-order-controls trip-preview-actions" data-editing="true">
              <button
                type="button"
                onClick={() => {
                  cancelOrder();
                  focusRegion(mapPane.current);
                }}
                disabled={saving}
              >
                取消调整
              </button>
              <button
                type="button"
                className="workspace-primary"
                onClick={() => {
                  void saveOrder();
                  mapPane.current?.focus({ preventScroll: true });
                }}
                disabled={!canSave}
              >
                {saving ? '正在保存…' : '保存安排'}
              </button>
            </div>
          </section>
        )}
        <div className="trip-map-stage">
          {pins.length ? (
            <TripMap
              pins={pins}
              lines={lines}
              selected={selected}
              selectedLine={selectedLeg}
              onSelect={focusStop}
              onSelectLine={focusLeg}
              onOverview={() => {
                setSelected(null);
                setSelectedLeg(null);
              }}
            />
          ) : (
            <p className="trip-map-status">所选日期没有可显示的景点坐标。</p>
          )}
          {activeStop && activeBookingKey && (
            <TripPlaceCard
              key={activeBookingKey}
              place={activeStop.place}
              visit={activeStop}
              directions={navigationUrl(activeStop.place, transportMode)}
              previous={visibleStops[activeStopIndex - 1]?.place}
              next={visibleStops[activeStopIndex + 1]?.place}
              conflicts={conflicts.get(activeStop.place.id) ?? []}
              moveDates={days.filter((day) => day.date !== activeStop.date)}
              onMove={
                saving || editDisabled
                  ? undefined
                  : (nextDate) => moveToDay(activeStop.place.id, nextDate)
              }
              onReviewChanges={
                changedDays.size ? () => focusRegion(changePreview.current) : undefined
              }
              booking={bookings[activeBookingKey]}
              bookedForAnotherDate={Object.entries(bookings).some(
                ([key, status]) =>
                  key !== activeBookingKey &&
                  key.endsWith(`:${activeStop.place.id}`) &&
                  status === 'booked',
              )}
              onBookingChange={(status) => changeBooking(activeBookingKey, status)}
              onSelect={focusStop}
              onClose={closePlace}
            />
          )}
          {activeLeg && (
            <section className="trip-map-info trip-route-card" aria-label="路段详情">
              <button
                type="button"
                className="trip-map-info-close"
                aria-label="关闭路段详情"
                onClick={() => setSelectedLeg(null)}
              >
                ×
              </button>
              <h3>
                {activeLeg.from.place?.name ?? '上一站'} → {activeLeg.to.place?.name ?? '本站'}
              </h3>
              <p>
                {transportNames[transportMode]} ·{' '}
                {activeLeg.from.place?.coordinates && activeLeg.to.place?.coordinates
                  ? routeText(routes.get(activeLeg.key))
                  : '景点缺少坐标'}
              </p>
              {transportMode === 'transit' && (
                <TripTransitSteps
                  steps={
                    activeRoute && activeRoute !== 'unavailable'
                      ? activeRoute.transitSteps
                      : undefined
                  }
                />
              )}
              {legDirections && (
                <a href={legDirections} target="_blank" rel="noreferrer">
                  在高德查看{transportMode === 'transit' ? '公交' : ''}路线 ↗
                </a>
              )}
            </section>
          )}
        </div>
        <div className="trip-detail-map-footer">
          {pending > 0 && <p role="status">正在查询 {pending} 段路线…</p>}
          {incomplete.length > 0 && (
            <>
              <p>{incomplete.length} 段暂无轨迹，地图仍可查看景点位置。</p>
              <button
                type="button"
                onClick={() => {
                  for (const { key } of incomplete) resolved.current.delete(key);
                  setRoutes((current) => {
                    const next = new Map(current);
                    for (const { key } of incomplete) next.delete(key);
                    return next;
                  });
                  setAttempt((value) => value + 1);
                }}
              >
                重试路线
              </button>
            </>
          )}
          {pins.length > 0 && !visibleLegs.length && <p>这段日程的地图只显示景点位置。</p>}
        </div>
      </section>
      <TripTools
        trip={trip}
        cityName={cityName}
        guidePlace={activePlace?.name}
        days={originalDays}
        trafficScope={`${date ?? '全部日期'} · ${transportNames[transportMode]}`}
        trafficSummary={
          previewRoute ? formatRouteSummary(summary, transportMode) : '路线预览不可用'
        }
        trafficLegs={
          previewRoute
            ? visibleLegs.map(({ key, from, to }) => {
                const route = routes.get(key);
                return {
                  id: key,
                  label: `${from.place?.name ?? '上一站'} → ${to.place?.name ?? '本站'}`,
                  duration:
                    from.place?.coordinates && to.place?.coordinates
                      ? routeText(routes.get(key))
                      : '景点缺少坐标',
                  lines: transportMode === 'transit' ? transitSummary(routes.get(key)) : '',
                  transitSteps:
                    transportMode === 'transit' && route && route !== 'unavailable'
                      ? route.transitSteps
                      : undefined,
                  navigation:
                    from.place && to.place
                      ? navigationUrl(to.place, transportMode, from.place)
                      : null,
                };
              })
            : []
        }
        transportMode={transportMode}
        onSelectLeg={focusLeg}
        onEdit={onEdit}
        editDisabled={editDisabled}
      />
    </div>
  );
}

export default function TripDetail({
  id,
  api,
  cities,
  routeCache,
  onBack,
  onEdit,
  editDisabled,
  editError,
  onSaved,
}: {
  id: string;
  api: TripDraftApi;
  cities: Destination[];
  routeCache: RefObject<RouteCache>;
  onBack: () => void;
  onEdit: () => void;
  editDisabled: boolean;
  editError: string;
  onSaved?: TripHostEvents['onSaved'];
}) {
  const [data, setData] = useState<{ trip: Trip; places: Place[] } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void api
      .get(id)
      .then(async (trip) => ({ trip, places: await api.getPlaces(trip.planningInput.cityId) }))
      .then((value) => {
        if (active) setData(value);
      })
      .catch((failure) => {
        if (active) setError(tripErrorMessage(failure));
      });
    return () => {
      active = false;
    };
  }, [api, id, attempt]);
  const trip = data?.trip;
  const city = cities.find((item) => item.id === trip?.planningInput.cityId);

  return (
    <main className="trip-workspace trip-detail">
      <TripCover
        trip={trip}
        city={city}
        onBack={onBack}
        onEdit={onEdit}
        editDisabled={editDisabled}
      />
      {editError && (
        <p className="workspace-error" role="alert">
          {editError}
        </p>
      )}
      {error && (
        <p className="workspace-error" role="alert">
          {error}{' '}
          <button
            type="button"
            onClick={() => {
              setError('');
              setAttempt((value) => value + 1);
            }}
          >
            重新读取行程
          </button>
        </p>
      )}
      {!data && !error && <p role="status">正在读取行程…</p>}
      {trip && (trip.status === 'draft' || !trip.days.length) && <p>此行程还没有保存每日安排。</p>}
      {data?.trip.status === 'planned' && data.trip.days.length > 0 && (
        <TripSchedule
          trip={data.trip}
          places={data.places}
          previewRoute={api.previewRoute}
          routeCache={routeCache}
          cityName={city?.name}
          timeZone={city?.timeZone}
          onEdit={onEdit}
          editDisabled={editDisabled}
          onSaveSchedule={async (days) => {
            const { trip: current, places } = data;
            const updated = await api.updateSchedule(current.id, current.revision, days);
            setData({ trip: updated, places });
            notifyHost(onSaved, updated);
          }}
        />
      )}
    </main>
  );
}
