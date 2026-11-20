export interface OutingStop {
  id: string;
  name: string;
  time: string;
  directions: string | null;
  hasDetails: boolean;
  reminder?: string;
}

export default function TripOuting({
  days,
  date,
  today,
  count,
  completed,
  next,
  error,
  onDate,
  onExit,
  onOpen,
  onComplete,
}: {
  days: { date: string; number: number }[];
  date: string;
  today: string;
  count: number;
  completed: number;
  next?: OutingStop;
  error: string;
  onDate: (date: string) => void;
  onExit: () => void;
  onOpen: (id: string, trigger: HTMLButtonElement) => void;
  onComplete: (id: string) => void;
}) {
  return (
    <section className="trip-outing" aria-label="出游模式">
      <div className="trip-outing-heading">
        <label>
          <strong>出游日期</strong>
          <select value={date} onChange={(event) => onDate(event.target.value)}>
            {days.map((day) => (
              <option key={day.date} value={day.date}>
                {day.date === today ? '今天 · ' : ''}第 {day.number} 天 · {day.date}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="trip-text-button" onClick={onExit}>
          退出出游模式
        </button>
      </div>
      {count > 0 && (
        <div className="trip-outing-progress">
          <span role="status">
            已游览 {completed} / {count} 站
          </span>
          <progress max={count} value={completed} aria-label="游览进度" />
        </div>
      )}
      {next ? (
        <div className="trip-outing-next">
          <div>
            <span>下一站 · {next.time}</span>
            <h3>{next.name}</h3>
            {next.reminder && <span className="trip-visit-badge">{next.reminder}</span>}
          </div>
          <div className="trip-outing-actions">
            {next.hasDetails && (
              <button type="button" onClick={(event) => onOpen(next.id, event.currentTarget)}>
                看景点
              </button>
            )}
            {next.directions && (
              <a href={next.directions} rel="noreferrer" target="_blank">
                高德导航 ↗
              </a>
            )}
            <button type="button" onClick={() => onComplete(next.id)}>
              标记已游览
            </button>
          </div>
        </div>
      ) : (
        <p>{count ? '当天景点已全部游览。' : '当天没有安排景点。'}</p>
      )}
      {error && (
        <p className="trip-outing-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
