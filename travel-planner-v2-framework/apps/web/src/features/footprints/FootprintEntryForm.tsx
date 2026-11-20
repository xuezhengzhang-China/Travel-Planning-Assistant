import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { FootprintEntry, FootprintMedia, FootprintPlaceSearchResult } from '@travel/shared';
import { ApiError, type ApiClient } from '../../lib/api-client';
import { compressImageFile, ImageCompressError } from '../../lib/compress-image';
import { describeGeolocationError } from '../../lib/geo-error';

/** 与服务端 MAX_FOOTPRINT_MEDIA 一致：一条足迹最多 100 个附件。 */
const MAX_FOOTPRINT_FILES = 100;

/** 与服务端 MAX_FOOTPRINT_TOTAL_BYTES 一致：单次上传总大小上限 300 MiB。 */
const MAX_FOOTPRINT_TOTAL_BYTES = 300 * 1024 * 1024;

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function todayInShanghai(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/** 显示足迹已有的媒体（图片/视频）。 */
function ExistingMedia({ client, media }: { client: ApiClient; media: FootprintMedia }) {
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
        /* 读取失败静默降级。 */
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

export interface FootprintEntryFormProps {
  client: ApiClient;
  /** 保存成功后通知宿主刷新列表与地图。 */
  onSaved?: () => void;
  /** 传入则为编辑模式（预填该足迹），不传为新建。 */
  initialEntry?: FootprintEntry | null;
  onCancel?: () => void;
}

export default function FootprintEntryForm({
  client,
  onSaved,
  initialEntry,
  onCancel,
}: FootprintEntryFormProps) {
  const editing = initialEntry ?? null;
  const locationOverridden = useRef(false);
  const [recordedOn, setRecordedOn] = useState(editing?.recordedOn ?? todayInShanghai());
  const [longitude, setLongitude] = useState(editing ? String(editing.longitude) : '');
  const [latitude, setLatitude] = useState(editing ? String(editing.latitude) : '');
  const [coordinateSystem, setCoordinateSystem] = useState<'WGS-84' | 'GCJ-02'>(
    editing?.coordinateSystem ?? 'WGS-84',
  );
  const [locationSource, setLocationSource] = useState<'automatic' | 'manual' | 'searched'>(
    editing?.poiId ? 'searched' : 'manual',
  );
  const [placeKeyword, setPlaceKeyword] = useState('');
  const [places, setPlaces] = useState<FootprintPlaceSearchResult[]>([]);
  const [placeSearchMessage, setPlaceSearchMessage] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<FootprintPlaceSearchResult | null>(null);
  const [locationMessage, setLocationMessage] = useState(
    editing
      ? editing.placeName
        ? `正在编辑：${editing.placeName}`
        : editing.placeAddress
          ? `正在编辑：${editing.placeAddress}`
          : '正在编辑已保存的足迹。'
      : '正在获取当前位置…',
  );
  const [text, setText] = useState(editing?.text ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [removedMediaIds, setRemovedMediaIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (editing) return;
    if (!navigator.geolocation) {
      setLocationMessage('浏览器不支持自动定位，请手动填写经纬度或搜索地点。');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (locationOverridden.current) return;
        setLongitude(String(coords.longitude));
        setLatitude(String(coords.latitude));
        setCoordinateSystem('WGS-84');
        setLocationSource('automatic');
        setSelectedPlace(null);
        setLocationMessage('已获取当前位置（WGS-84）。');
      },
      (error) => setLocationMessage(describeGeolocationError(error)),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 },
    );
  }, []);

  async function searchPlaces() {
    setPlaceSearchMessage('');
    setPlaces([]);
    try {
      const results = await client.request<FootprintPlaceSearchResult[]>(
        `/footprints/places/search?keywords=${encodeURIComponent(placeKeyword.trim())}`,
      );
      setPlaces(results);
      if (results.length === 0) setPlaceSearchMessage('没有找到地点，请换一个关键词。');
    } catch (error) {
      setPlaceSearchMessage(
        error instanceof ApiError ? error.message : '地点搜索失败，请稍后重试。',
      );
    }
  }

  function choosePlace(place: FootprintPlaceSearchResult) {
    locationOverridden.current = true;
    setSelectedPlace(place);
    setLongitude(String(place.longitude));
    setLatitude(String(place.latitude));
    setCoordinateSystem('GCJ-02');
    setLocationSource('searched');
    setLocationMessage(`已选择：${place.name}`);
    setPlaces([]);
    setPlaceSearchMessage('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setBusy(true);
    try {
      const body = new FormData();
      body.set('recordedOn', recordedOn);
      body.set('longitude', longitude);
      body.set('latitude', latitude);
      body.set('coordinateSystem', coordinateSystem);
      body.set(
        'text',
        text.trim() ||
          (files.length === 0 ? (selectedPlace ? `打卡：${selectedPlace.name}` : '到此一游') : ''),
      );
      // 编辑时若没有重新搜索地点，保留原 poiId，避免位置（地点名）丢失。
      const poiId = selectedPlace?.poiId ?? editing?.poiId ?? null;
      if (poiId) body.set('poiId', poiId);
      let totalBytes = 0;
      for (const item of files) {
        // 图片先压缩再上传（与手账一致）；视频原样上传。
        const uploadFile = item.type.startsWith('image/') ? await compressImageFile(item) : item;
        totalBytes += uploadFile.size;
        body.append('files', uploadFile);
      }
      if (totalBytes > MAX_FOOTPRINT_TOTAL_BYTES) {
        setMessage(
          `附件总大小约 ${formatMb(totalBytes)}，超过上限 ${formatMb(MAX_FOOTPRINT_TOTAL_BYTES)}，请分批上传。`,
        );
        return;
      }
      if (editing && removedMediaIds.length > 0) {
        body.set('removeMediaIds', removedMediaIds.join(','));
      }

      if (editing) {
        await client.request(`/footprints/${editing.id}`, { method: 'PATCH', body });
        setMessage('足迹已更新。');
      } else {
        await client.request<FootprintEntry>('/footprints', { body });
        setMessage('足迹已保存。');
      }
      onSaved?.();
    } catch (error) {
      setMessage(
        error instanceof ApiError || error instanceof ImageCompressError
          ? error.message
          : '保存失败，请稍后重试。',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="footprint-card" aria-labelledby="footprint-title">
      <h2 id="footprint-title">{editing ? '编辑足迹' : '记录一条足迹'}</h2>
      <p className="footprint-description">
        每条记录都会保存日期和位置；可以写文字，也可以附最多 {MAX_FOOTPRINT_FILES} 张照片或视频。
      </p>
      <form className="footprint-form" onSubmit={submit}>
        <label>
          日期
          <input
            type="date"
            required
            max={todayInShanghai()}
            value={recordedOn}
            onChange={(event) => setRecordedOn(event.target.value)}
          />
        </label>
        <fieldset className="coordinate-fields">
          <legend>位置（必填）</legend>
          <div className="place-search">
            <label>
              搜索景点或目的地
              <input
                type="search"
                maxLength={80}
                value={placeKeyword}
                onChange={(event) => setPlaceKeyword(event.target.value)}
                placeholder="例如：故宫博物院"
              />
            </label>
            <button
              type="button"
              disabled={!placeKeyword.trim()}
              onClick={() => void searchPlaces()}
            >
              搜索地点
            </button>
            {placeSearchMessage && <p role="status">{placeSearchMessage}</p>}
            {places.length > 0 && (
              <ul className="place-results">
                {places.map((place) => (
                  <li key={place.poiId}>
                    <button type="button" onClick={() => choosePlace(place)}>
                      <strong>{place.name}</strong>
                      <span>
                        {[place.provinceName, place.cityName, place.address]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p>{locationMessage}</p>
          <div>
            <label>
              经度
              <input
                type="number"
                required
                min="-180"
                max="180"
                step="any"
                value={longitude}
                onChange={(event) => {
                  locationOverridden.current = true;
                  setLocationSource('manual');
                  setSelectedPlace(null);
                  setCoordinateSystem('WGS-84');
                  setLocationMessage('使用手动填写的位置。');
                  setLongitude(event.target.value);
                }}
              />
            </label>
            <label>
              纬度
              <input
                type="number"
                required
                min="-90"
                max="90"
                step="any"
                value={latitude}
                onChange={(event) => {
                  locationOverridden.current = true;
                  setLocationSource('manual');
                  setSelectedPlace(null);
                  setCoordinateSystem('WGS-84');
                  setLocationMessage('使用手动填写的位置。');
                  setLatitude(event.target.value);
                }}
              />
            </label>
          </div>
          <small>
            {locationSource === 'searched'
              ? '已按地图坐标记录该地点，无需手动填写坐标。'
              : locationSource === 'automatic'
                ? '已按当前位置（GPS）记录，服务端会自动转换地图坐标。'
                : '手动填写的经纬度按 GPS 原始坐标保存。'}
          </small>
        </fieldset>
        <label>
          文字（可选）
          <textarea
            rows={4}
            maxLength={10000}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="写下此刻的见闻……"
          />
        </label>

        {(editing?.media.length ?? 0) > 0 && (
          <div className="footprint-existing-media">
            {editing?.media.map((media) => {
              const removed = removedMediaIds.includes(media.id);
              return (
                <div key={media.id} className="footprint-media-item">
                  <ExistingMedia client={client} media={media} />
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      setRemovedMediaIds((current) =>
                        removed ? current.filter((id) => id !== media.id) : [...current, media.id],
                      )
                    }
                  >
                    {removed ? '恢复' : '移除'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <label>
          {(editing?.media.length ?? 0) > 0
            ? `追加照片或视频（可选，最多补到 ${MAX_FOOTPRINT_FILES} 个）`
            : `照片或视频（可选，最多 ${MAX_FOOTPRINT_FILES} 个）`}
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? []);
              // 与后端 FilesInterceptor('files', 9) 保持一致，避免选多了到服务端才报错。
              const kept = (editing?.media.length ?? 0) - removedMediaIds.length;
              const room = Math.max(0, MAX_FOOTPRINT_FILES - Math.max(0, kept));
              const accepted = picked.slice(0, room);
              setFiles(accepted);
              setMessage(
                picked.length > accepted.length
                  ? `最多 ${MAX_FOOTPRINT_FILES} 个附件，已忽略多余的 ${picked.length - accepted.length} 个。`
                  : '',
              );
              event.target.value = '';
            }}
          />
        </label>
        {files.length > 0 && (
          <p className="selected-file">{files.map((item) => item.name).join('、')}</p>
        )}

        <div className="footprint-actions">
          {onCancel && (
            <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>
              取消
            </button>
          )}
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? '正在保存…' : editing ? '保存修改' : '保存足迹'}
          </button>
        </div>
        {message && (
          <p className="footprint-message" role="status">
            {message}
          </p>
        )}
      </form>
    </section>
  );
}
