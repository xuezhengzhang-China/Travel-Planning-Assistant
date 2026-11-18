import type { ScheduleItem } from '@travel/shared';
import { buildDayTimeline, formatScheduleMinutes } from './trip-day';

const labels = { visit: '游览', travel: '交通预留', buffer: '缓冲' } as const;

export default function TripDayTimeline({
  items,
  names,
}: {
  items: ScheduleItem[];
  names: ReadonlyMap<string, string>;
}) {
  const { segments, totals } = buildDayTimeline(items);
  const first = segments[0];
  const last = segments.at(-1);
  if (!first || !last) return null;

  return (
    <details className="trip-day-timeline">
      <summary>查看时间轴</summary>
      <div className="trip-timeline-range">
        <span>{formatScheduleMinutes(first.start)}</span>
        <span>{formatScheduleMinutes(last.end)}</span>
      </div>
      <div className="trip-timeline-bar" aria-hidden="true">
        {segments.map((segment) => (
          <span
            key={`${segment.placeId}:${segment.kind}`}
            data-kind={segment.kind}
            style={{ flexGrow: segment.end - segment.start }}
          />
        ))}
      </div>
      <ul className="trip-timeline-totals" aria-label="时间分布">
        {Object.entries(totals).map(([kind, total]) => (
          <li key={kind} data-kind={kind}>
            {labels[kind as keyof typeof labels]} {total} 分钟
          </li>
        ))}
      </ul>
      <ol className="trip-timeline-times">
        {segments.map(({ kind, placeId, start, end, estimated }) => {
          const name = names.get(placeId);
          return (
            <li key={`${placeId}:${kind}`}>
              <span>
                {formatScheduleMinutes(start)}–{formatScheduleMinutes(end)}
              </span>
              <span>
                {kind === 'visit' ? (name ?? '游览景点') : labels[kind]}
                {kind === 'travel' && name && ` · 前往${name}`}
                {estimated && '（估算）'}
              </span>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
