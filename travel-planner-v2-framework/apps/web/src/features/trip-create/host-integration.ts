import type { Trip } from '@travel/shared';
export type TripEntry = { view: 'list' } | { view: 'new' } | { view: 'edit'; tripId: string };
export function tripEntryKey(entry: TripEntry): string {
  return entry.view === 'edit' ? `edit:${entry.tripId}` : entry.view;
}
export function tripEntryPath(entry: TripEntry): string {
  return entry.view === 'list'
    ? '/trips'
    : entry.view === 'new'
      ? '/trips/new'
      : `/trips/${encodeURIComponent(entry.tripId)}/edit`;
}
export function tripEntryFromPath(path: string): TripEntry {
  if (/^\/trips\/new\/?$/.test(path)) return { view: 'new' };
  const match = /^\/trips\/([0-9a-f-]+)\/edit\/?$/i.exec(path);
  if (
    match &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(match[1]!)
  )
    return { view: 'edit', tripId: match[1]!.toLowerCase() };
  return { view: 'list' };
}
// 通知是已完成服务器操作之后的观察回调，不让宿主刷新失败变成一次重复保存。
export function notifyHost<T>(
  callback: ((value: T) => void | Promise<void>) | undefined,
  value: T,
): void {
  try {
    void Promise.resolve(callback?.(value)).catch(() =>
      console.error('随心行：宿主通知处理失败，服务器操作已完成'),
    );
  } catch {
    console.error('随心行：宿主通知处理失败，服务器操作已完成');
  }
}
export interface TripHostEvents {
  onNavigate?: (entry: TripEntry) => void | Promise<void>;
  onSaved?: (trip: Trip) => void | Promise<void>;
  onDraftSaved?: (trip: Trip) => void | Promise<void>;
  onDeleted?: (trip: Trip) => void | Promise<void>;
}
