import { useCallback, useEffect, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import type {
  FootprintEntry,
  FootprintListPage,
  Journal,
  JournalListPage,
  MediaAsset,
} from '@travel/shared';
import { ApiError, type ApiClient } from '../../lib/api-client';
import { compressImageFile, ImageCompressError } from '../../lib/compress-image';

function journalErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'UNAUTHENTICATED' || error.status === 401) return '登录已过期，请重新登录。';
    return error.message;
  }
  return error instanceof Error ? error.message : '手账加载失败，请重试。';
}

/** 认证后读取手账图片（`GET /media/:id`）并显示。 */
function JournalMediaView({ client, mediaId }: { client: ApiClient; mediaId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    client
      .blob(`/media/${mediaId}`)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
      })
      .catch(() => {
        /* 读取失败静默降级。 */
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [client, mediaId]);

  if (!url) return <span className="journal-media-pending">图片加载中…</span>;
  return <img src={url} alt="手账图片" className="journal-media" />;
}

interface JournalDraft {
  footprintId: string;
  title: string;
  body: string;
  mediaIds: string[];
}

export interface JournalPageProps {
  client: ApiClient;
  refreshToken: number;
}

export default function JournalPage({ client, refreshToken }: JournalPageProps) {
  const [journals, setJournals] = useState<Journal[]>([]);
  const [footprints, setFootprints] = useState<FootprintEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Journal | null>(null);
  const [draft, setDraft] = useState<JournalDraft>({
    footprintId: '',
    title: '',
    body: '',
    mediaIds: [],
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      client.request<JournalListPage>('/journals?page=1&pageSize=100'),
      client.request<FootprintListPage>('/footprints?page=1&pageSize=100'),
    ])
      .then(([journalPage, footprintPage]) => {
        setJournals([...journalPage.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        setFootprints(footprintPage.items);
      })
      .catch((failure: unknown) => setError(journalErrorMessage(failure)))
      .finally(() => setLoading(false));
  }, [client]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  function footprintLabel(id: string): string {
    const footprint = footprints.find((item) => item.id === id);
    return footprint
      ? `${footprint.recordedOn} · ${footprint.placeName ?? '未命名位置'}`
      : '已删除的足迹';
  }

  function openNew() {
    setEditing(null);
    setDraft({ footprintId: footprints[0]?.id ?? '', title: '', body: '', mediaIds: [] });
    setMessage('');
    setOpen(true);
  }

  function openEdit(journal: Journal) {
    setEditing(journal);
    setDraft({
      footprintId: journal.footprintId,
      title: journal.title ?? '',
      body: journal.body,
      mediaIds: journal.mediaIds ?? [],
    });
    setMessage('');
    setOpen(true);
  }

  function closeEditor() {
    setOpen(false);
    setEditing(null);
    setMessage('');
  }

  async function handleImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    setMessage('');
    setUploading(true);
    try {
      const ids: string[] = [];
      for (const file of files) {
        if (draft.mediaIds.length + ids.length >= 9) break;
        const compressed = await compressImageFile(file);
        const formData = new FormData();
        formData.set('file', compressed);
        const asset = await client.request<MediaAsset>('/media', { body: formData });
        ids.push(asset.id);
      }
      setDraft((current) => ({
        ...current,
        mediaIds: [...current.mediaIds, ...ids].slice(0, 9),
      }));
      setMessage(ids.length ? `已上传 ${ids.length} 张图片。` : '已达最多 9 张图片。');
    } catch (failure) {
      setMessage(
        failure instanceof ImageCompressError || failure instanceof ApiError
          ? failure.message
          : '图片上传失败，请重试。',
      );
    } finally {
      setUploading(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.footprintId) {
      setMessage('请选择手账关联的足迹。');
      return;
    }
    if (!draft.body.trim()) {
      setMessage('请填写手账正文。');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      if (editing) {
        await client.request(`/journals/${editing.id}`, {
          method: 'PATCH',
          body: {
            title: draft.title.trim() || null,
            body: draft.body.trim(),
            mediaIds: draft.mediaIds,
          },
        });
      } else {
        await client.request('/journals', {
          body: {
            footprintId: draft.footprintId,
            title: draft.title.trim() || undefined,
            body: draft.body.trim(),
            mediaIds: draft.mediaIds,
          },
        });
      }
      setOpen(false);
      setEditing(null);
      setMessage('手账已保存。');
      load();
    } catch (failure) {
      setMessage(failure instanceof ApiError ? failure.message : '保存失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  async function remove(journal: Journal) {
    setBusy(true);
    setConfirmId(null);
    setMessage('');
    try {
      await client.request(`/journals/${journal.id}`, { method: 'DELETE' });
      setMessage('手账已删除。');
      load();
    } catch (failure) {
      setMessage(failure instanceof ApiError ? failure.message : '删除失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="journal-page" aria-label="旅行手账">
      <div className="journal-heading">
        <p className="footprint-page-summary">把沿途的风景，和当时的心情一起收藏。</p>
        <button type="button" className="primary-button" disabled={open} onClick={openNew}>
          ＋ 写一篇手账
        </button>
      </div>

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

      {open && (
        <form className="journal-editor" onSubmit={save}>
          <h3>{editing ? '编辑这篇手账' : '记录新的旅行回忆'}</h3>
          <label>
            关联足迹（必选）
            <select
              required
              value={draft.footprintId}
              onChange={(event) => setDraft({ ...draft, footprintId: event.target.value })}
            >
              <option value="" disabled>
                选择一条足迹
              </option>
              {footprints.map((footprint) => (
                <option key={footprint.id} value={footprint.id}>
                  {footprint.recordedOn} · {footprint.placeName ?? '未命名位置'}
                </option>
              ))}
            </select>
          </label>
          {footprints.length === 0 && (
            <p className="field-hint">还没有足迹记录，请先到「记录足迹」添加一条。</p>
          )}
          <label>
            标题（选填）
            <input
              maxLength={120}
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="给这段回忆起个标题"
            />
          </label>
          <label>
            正文（必填）
            <textarea
              required
              rows={5}
              maxLength={20000}
              value={draft.body}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
              placeholder="今天看到了什么？有什么想记住的瞬间……"
            />
          </label>

          <div className="journal-media-field">
            {draft.mediaIds.length > 0 && (
              <div className="journal-media-grid">
                {draft.mediaIds.map((mediaId, index) => (
                  <div key={mediaId} className="journal-media-item">
                    <JournalMediaView client={client} mediaId={mediaId} />
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || uploading}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          mediaIds: draft.mediaIds.filter((_, position) => position !== index),
                        })
                      }
                    >
                      移除
                    </button>
                  </div>
                ))}
              </div>
            )}
            <label className="journal-upload">
              {uploading
                ? '正在压缩并上传…'
                : draft.mediaIds.length >= 9
                  ? '已达最多 9 张图片'
                  : `＋ 添加图片（${draft.mediaIds.length}/9）`}
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                disabled={busy || uploading || draft.mediaIds.length >= 9}
                onChange={(event) => void handleImages(event)}
              />
            </label>
            <p className="field-hint">一篇手账最多 9 张图片，可一次多选，上传前会自动压缩。</p>
          </div>

          <div className="footprint-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={closeEditor}
            >
              取消
            </button>
            <button type="submit" className="primary-button" disabled={busy || uploading}>
              {busy ? '保存中…' : '保存手账'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="footprint-page-summary">正在读取手账…</p>
      ) : journals.length === 0 ? (
        <div className="empty-journal">
          <span>📷 每一段旅程，都可以从一篇手账开始。</span>
        </div>
      ) : (
        <div className="journal-list">
          {journals.map((journal) => (
            <article key={journal.id} className="journal-card">
              <h3>{journal.title || '未命名手账'}</h3>
              <p className="journal-meta">{footprintLabel(journal.footprintId)}</p>
              <p
                className={`journal-body${expandedId !== journal.id ? ' journal-body-collapsed' : ''}`}
              >
                {journal.body}
              </p>
              {journal.mediaIds.length > 0 && (
                <div
                  className={`journal-media-grid ${
                    journal.mediaIds.length === 1
                      ? 'count-1'
                      : journal.mediaIds.length === 2
                        ? 'count-2'
                        : 'count-3'
                  }`}
                >
                  {journal.mediaIds.map((mediaId) => (
                    <JournalMediaView key={mediaId} client={client} mediaId={mediaId} />
                  ))}
                </div>
              )}
              <div className="footprint-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || open}
                  onClick={() => setExpandedId(expandedId === journal.id ? null : journal.id)}
                >
                  {expandedId === journal.id ? '收起' : '查看'}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || open}
                  onClick={() => openEdit(journal)}
                >
                  编辑
                </button>
                {confirmId === journal.id ? (
                  <>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || open}
                      onClick={() => void remove(journal)}
                    >
                      确认删除
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || open}
                      onClick={() => setConfirmId(null)}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || open}
                    onClick={() => setConfirmId(journal.id)}
                  >
                    删除
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
