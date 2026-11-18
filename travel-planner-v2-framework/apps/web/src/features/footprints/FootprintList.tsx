import { useCallback, useEffect, useState } from 'react';
import type { FootprintEntry, FootprintListPage, FootprintMedia } from '@travel/shared';
import { ApiError, type ApiClient } from '../../lib/api-client';

function listErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'UNAUTHENTICATED' || error.status === 401) return '登录已过期，请重新登录。';
    return error.message;
  }
  return error instanceof Error ? error.message : '足迹列表加载失败，请重试。';
}

/** 用认证后的 Blob 显示足迹媒体（图片/视频）。 */
function FootprintMediaView({ client, media }: { client: ApiClient; media: FootprintMedia }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    client
      .blob(`/footprints/media/${media.id}`)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
      })
      .catch(() => {
        /* 媒体读取失败时静默降级为占位提示。 */
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [client, media.id]);

  if (!url) return <span className="footprint-media-pending">媒体加载中…</span>;
  return media.kind === 'video' ? (
    <video src={url} controls className="footprint-media" />
  ) : (
    <img src={url} alt={media.originalName} className="footprint-media" />
  );
}

export interface FootprintListProps {
  client: ApiClient;
  refreshToken: number;
  onChanged?: () => void;
  /** 点击「编辑」时交给宿主，用统一表单打开（预填）。 */
  onEdit?: (entry: FootprintEntry) => void;
}

export default function FootprintList({
  client,
  refreshToken,
  onChanged,
  onEdit,
}: FootprintListProps) {
  const [items, setItems] = useState<FootprintEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    client
      .request<FootprintListPage>('/footprints?page=1&pageSize=100')
      .then((page) =>
        setItems([...page.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
      )
      .catch((failure: unknown) => setError(listErrorMessage(failure)))
      .finally(() => setLoading(false));
  }, [client]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  async function remove(entry: FootprintEntry) {
    setBusy(true);
    setConfirmId(null);
    setMessage('');
    try {
      await client.request(`/footprints/${entry.id}`, { method: 'DELETE' });
      setMessage('足迹已删除。');
      onChanged?.();
      load();
    } catch (failure) {
      setMessage(failure instanceof ApiError ? failure.message : '删除失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="footprint-list" aria-label="足迹列表">
      {error && (
        <p role="alert" className="profile-alert">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="footprint-message">
          {message}
        </p>
      )}

      {loading ? (
        <p className="footprint-page-summary">正在读取足迹…</p>
      ) : items.length === 0 ? (
        <div className="empty-journal">
          <span>还没有足迹记录，点上方「新建足迹」写第一条吧。</span>
        </div>
      ) : (
        <ul className="footprint-entries">
          {items.map((entry) => (
            <li key={entry.id} className="footprint-entry">
              <button
                type="button"
                className="footprint-entry-main"
                onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              >
                <span className="footprint-entry-date">{entry.recordedOn}</span>
                <strong>{entry.placeName ?? '未命名位置'}</strong>
                {entry.cityName && <small>{entry.cityName}</small>}
                {entry.text && <p>{entry.text}</p>}
                {entry.media.length > 0 && <em className="footprint-media-badge">📎 含媒体</em>}
              </button>

              <div className="footprint-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                >
                  {expandedId === entry.id ? '收起' : '查看'}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => onEdit?.(entry)}
                >
                  编辑
                </button>
                {confirmId === entry.id ? (
                  <>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void remove(entry)}
                    >
                      确认删除
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => setConfirmId(null)}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => setConfirmId(entry.id)}
                  >
                    删除
                  </button>
                )}
              </div>

              {expandedId === entry.id && (
                <div className="footprint-entry-detail">
                  {entry.media.map((media) => (
                    <FootprintMediaView key={media.id} client={client} media={media} />
                  ))}
                  {entry.placeAddress && (
                    <p className="footprint-page-summary">{entry.placeAddress}</p>
                  )}
                  <p className="footprint-page-note">
                    坐标 {entry.longitude.toFixed(5)}, {entry.latitude.toFixed(5)}（
                    {entry.coordinateSystem}）
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
