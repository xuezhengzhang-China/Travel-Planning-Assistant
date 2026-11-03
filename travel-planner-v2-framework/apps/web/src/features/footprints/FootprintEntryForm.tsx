import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { FootprintPlaceSearchResult } from '@travel/shared';

interface CreatedEntry {
  id: string;
  recordedOn: string;
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

export default function FootprintEntryForm() {
  const locationOverridden = useRef(false);
  const [recordedOn, setRecordedOn] = useState(todayInShanghai);
  const [longitude, setLongitude] = useState('');
  const [latitude, setLatitude] = useState('');
  const [coordinateSystem, setCoordinateSystem] = useState<'WGS-84' | 'GCJ-02'>('WGS-84');
  const [locationSource, setLocationSource] = useState<'automatic' | 'manual' | 'searched'>(
    'manual',
  );
  const [placeKeyword, setPlaceKeyword] = useState('');
  const [places, setPlaces] = useState<FootprintPlaceSearchResult[]>([]);
  const [placeSearchMessage, setPlaceSearchMessage] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<FootprintPlaceSearchResult | null>(null);
  const [locationMessage, setLocationMessage] = useState('正在获取当前位置…');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationMessage('浏览器不支持自动定位，请手动填写经纬度。');
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
      () => setLocationMessage('未能获取位置，请允许定位权限或手动填写经纬度。'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 },
    );
  }, []);

  async function searchPlaces() {
    setPlaceSearchMessage('');
    setPlaces([]);
    try {
      const response = await fetch(
        `/api/footprints/places/search?keywords=${encodeURIComponent(placeKeyword.trim())}`,
      );
      const payload = (await response.json().catch(() => null)) as
        FootprintPlaceSearchResult[] | { message?: string } | null;
      if (!response.ok) {
        throw new Error(
          !Array.isArray(payload) && payload?.message
            ? payload.message
            : `地点搜索失败（${response.status}）。`,
        );
      }
      if (!Array.isArray(payload)) throw new Error('地点搜索返回了无法识别的结果。');
      setPlaces(payload);
      if (payload.length === 0) setPlaceSearchMessage('没有找到地点，请换一个关键词。');
    } catch (error) {
      setPlaceSearchMessage(error instanceof Error ? error.message : '地点搜索失败，请稍后重试。');
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
    const form = event.currentTarget;
    setMessage('');
    if (!text.trim() && !file) {
      setMessage('请填写文字，或选择一张照片/一个视频。');
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.set('recordedOn', recordedOn);
      body.set('longitude', longitude);
      body.set('latitude', latitude);
      body.set('coordinateSystem', coordinateSystem);
      body.set('text', text);
      if (selectedPlace) body.set('poiId', selectedPlace.poiId);
      if (file) body.set('file', file);

      const response = await fetch('/api/footprints', { method: 'POST', body });
      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as {
          message?: string | string[];
        } | null;
        const errorMessage = Array.isArray(error?.message)
          ? error.message.join('、')
          : error?.message;
        if (response.status === 401) {
          throw new Error('需要先登录才能保存；登录功能尚未接入。');
        }
        throw new Error(errorMessage || `保存失败（${response.status}）。`);
      }
      const entry = (await response.json()) as CreatedEntry;
      setMessage(`已保存：${entry.recordedOn} 的足迹记录。`);
      setText('');
      setFile(null);
      const input = form.querySelector<HTMLInputElement>('input[type="file"]');
      if (input) input.value = '';
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="footprint-card" aria-labelledby="footprint-title">
      <h2 id="footprint-title">记录一条足迹</h2>
      <p className="footprint-description">
        每条记录都会保存日期和位置；可以写文字，也可以附一张照片或一个视频。
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
                  setLocationMessage('使用手动填写的位置。');
                  setLatitude(event.target.value);
                }}
              />
            </label>
          </div>
          {locationSource === 'manual' ? (
            <label>
              坐标类型
              <select
                value={coordinateSystem}
                onChange={(event) =>
                  setCoordinateSystem(event.target.value === 'GCJ-02' ? 'GCJ-02' : 'WGS-84')
                }
              >
                <option value="WGS-84">WGS-84</option>
                <option value="GCJ-02">GCJ-02（地图坐标）</option>
              </select>
            </label>
          ) : (
            <small>
              {locationSource === 'searched'
                ? '选中的地点将由服务端按高德 POI 编号确认。'
                : '当前位置按 WGS-84 保存；服务端会在高德服务可用时转换地图坐标。'}
            </small>
          )}
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
        <label>
          照片或视频（可选，最多一个文件）
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        {file && <p className="selected-file">{file.name}</p>}
        <button type="submit" disabled={busy}>
          {busy ? '正在保存…' : '保存足迹'}
        </button>
        {message && (
          <p className="footprint-message" role="status">
            {message}
          </p>
        )}
      </form>
    </section>
  );
}
