import { useEffect, useId, useRef, useState } from 'react';
import type { Place } from '@travel/shared';
import { getBeijingVisitInfo } from '../../data/beijing';
import { bookingLabels, type BookingStatus } from './trip-booking';
import { groupVisitHours, type VisitConflict, type VisitHour } from './visit-hours';

type Neighbor = Pick<Place, 'id' | 'name'>;

function HoursList({ hours }: { hours: readonly VisitHour[] }) {
  return (
    <dl>
      {hours.map(({ label, time }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{time}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function TripPlaceCard({
  place,
  visit,
  directions,
  previous,
  next,
  conflicts,
  moveDates,
  onMove,
  onReviewChanges,
  booking,
  bookedForAnotherDate,
  onBookingChange,
  onSelect,
  onClose,
}: {
  place: Place;
  visit: { date: string; dayNumber: number; startTime?: string; durationMinutes: number };
  directions: string | null;
  previous?: Neighbor;
  next?: Neighbor;
  conflicts: VisitConflict[];
  moveDates: { date: string; number: number }[];
  onMove?: (date: string) => void;
  onReviewChanges?: () => void;
  booking?: BookingStatus;
  bookedForAnotherDate: boolean;
  onBookingChange: (status: BookingStatus | '') => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const card = useRef<HTMLElement>(null);
  const titleId = useId();
  const [copyStatus, setCopyStatus] = useState('');
  const [bookingFeedback, setBookingFeedback] = useState('');
  const [moveDate, setMoveDate] = useState('');
  const visitInfo = getBeijingVisitInfo(place.id);
  const overview = visitInfo?.overview ?? place.description;
  const hours = visitInfo && groupVisitHours(visitInfo.hours, visit.date);
  const ticket = visitInfo?.booking;

  useEffect(() => {
    const element = card.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    if (getComputedStyle(element).getPropertyValue('--trip-inline-card').trim() === '1') {
      element.scrollIntoView({ block: 'start' });
    }
  }, []);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(place.address);
      setCopyStatus('已复制地址');
    } catch {
      setCopyStatus('复制失败，可选中地址手动复制。');
    }
  }

  return (
    <section
      ref={card}
      className="trip-map-info trip-place-card"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="trip-place-card-header">
        <p className="trip-place-card-visit">
          <span>
            第 {visit.dayNumber} 天 · <time dateTime={visit.date}>{visit.date}</time>
          </span>
          <span>
            {visit.startTime && (
              <>
                <time dateTime={visit.startTime}>{visit.startTime}</time> ·{' '}
              </>
            )}
            {visit.startTime ? `游览 ${visit.durationMinutes} 分钟` : '时间待调整'}
          </span>
        </p>
        <h3 id={titleId}>{place.name}</h3>
        <div className="trip-place-card-meta">
          {place.address && (
            <>
              <span>{place.address}</span>
              <button type="button" className="trip-text-button" onClick={() => void copyAddress()}>
                复制地址
              </button>
            </>
          )}
        </div>
        {copyStatus && (
          <p className="trip-place-copy" role="status">
            {copyStatus}
          </p>
        )}
        {onReviewChanges && (
          <button
            type="button"
            className="trip-text-button trip-review-changes"
            onClick={onReviewChanges}
          >
            查看并保存调整 <span aria-hidden="true">↑</span>
          </button>
        )}
        <button
          type="button"
          className="trip-map-info-close"
          aria-label="关闭景点信息"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="trip-place-card-body" tabIndex={0}>
        {conflicts.length > 0 && (
          <section className="trip-visit-conflicts" aria-label="开放时间提醒">
            <h4>开放时间提醒</h4>
            {conflicts.map(({ message }) => (
              <p key={message}>{message}</p>
            ))}
            {visitInfo && (
              <a href={visitInfo.sourceUrl} target="_blank" rel="noreferrer">
                核对官方开放时间 ↗
              </a>
            )}
          </section>
        )}
        <div className="trip-place-actions">
          {moveDates.length > 0 && (
            <details>
              <summary>移到其他日期</summary>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (moveDate) onMove?.(moveDate);
                }}
              >
                <label>
                  目标日期
                  <select
                    value={moveDate}
                    onChange={(event) => setMoveDate(event.target.value)}
                    required
                    disabled={!onMove}
                  >
                    <option value="">选择日期</option>
                    {moveDates.map((day) => (
                      <option key={day.date} value={day.date}>
                        第 {day.number} 天 · {day.date}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" disabled={!onMove || !moveDate}>
                  预览移动
                </button>
              </form>
            </details>
          )}
          <details>
            <summary>
              门票与预约
              {booking && <span className="trip-booking-badge">{bookingLabels[booking]}</span>}
              {booking !== 'booked' && bookedForAnotherDate && (
                <span className="trip-visit-badge">核对预约</span>
              )}
            </summary>
            {ticket ? (
              <>
                <p>
                  <strong>{ticket.policy}</strong> · {ticket.note}
                </p>
                <a href={ticket.url} target="_blank" rel="noreferrer">
                  官方票务或参观指南 ↗
                </a>
              </>
            ) : (
              <p>请查阅景点官方票务公告。</p>
            )}
            {booking !== 'booked' && bookedForAnotherDate && (
              <p className="trip-booking-note">该景点有其他日期的预约标记，请核对票面日期。</p>
            )}
            <label>
              预约状态
              <select
                value={booking ?? ''}
                onChange={(event) => {
                  try {
                    onBookingChange(event.target.value as BookingStatus | '');
                    setBookingFeedback('已保存预约标记');
                  } catch {
                    setBookingFeedback('浏览器暂时无法保存预约标记。');
                  }
                }}
              >
                <option value="">未标记</option>
                {Object.entries(bookingLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {bookingFeedback && <p role="status">{bookingFeedback}</p>}
          </details>
        </div>
        <div>
          <h4>{hours?.other.length ? '出行日期对应的常规时段' : '常规开放时间'}</h4>
          {hours ? (
            <>
              <HoursList hours={hours.relevant} />
              {hours.other.length > 0 && (
                <details className="trip-place-other-hours">
                  <summary>查看其他时段</summary>
                  <HoursList hours={hours.other} />
                </details>
              )}
            </>
          ) : (
            <p className="trip-place-card-hours">{place.openingHours || '开放时间待核实'}</p>
          )}
        </div>
        {overview && <p className="trip-place-card-overview">{overview}</p>}
        {visitInfo && (
          <div>
            <h4>游览看点</h4>
            <ul>
              {visitInfo.highlights.map((highlight) => (
                <li key={highlight}>{highlight}</li>
              ))}
            </ul>
          </div>
        )}
        {visitInfo && (
          <div>
            <h4>参观提示</h4>
            <p>{visitInfo.tips}</p>
          </div>
        )}
      </div>

      <footer>
        {(visitInfo || directions) && (
          <div className="trip-place-card-footer">
            {visitInfo && (
              <div>
                <a href={visitInfo.sourceUrl} target="_blank" rel="noreferrer">
                  开放时间来源 <span aria-hidden="true">↗</span>
                </a>
                <small>{visitInfo.checkedAt} 核实</small>
              </div>
            )}
            {directions && (
              <a href={directions} target="_blank" rel="noreferrer">
                高德导航 <span aria-hidden="true">↗</span>
              </a>
            )}
          </div>
        )}
        {(previous || next) && (
          <nav className="trip-place-card-neighbors" aria-label="切换景点">
            <button
              type="button"
              disabled={!previous}
              onClick={() => previous && onSelect(previous.id)}
            >
              <span aria-hidden="true">‹</span> 上一站
              {previous && <span className="trip-place-neighbor-name">{previous.name}</span>}
            </button>
            <button type="button" disabled={!next} onClick={() => next && onSelect(next.id)}>
              下一站 <span aria-hidden="true">›</span>
              {next && <span className="trip-place-neighbor-name">{next.name}</span>}
            </button>
          </nav>
        )}
      </footer>
    </section>
  );
}
