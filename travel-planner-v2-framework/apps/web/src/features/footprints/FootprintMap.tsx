import { useEffect, useRef, useState } from 'react';
import type { FootprintMapLocation } from '@travel/shared';
import { createMapAdapter, isMapConfigured, type FootprintMapAdapter } from './map-adapter';
import type { FootprintMapProps } from './footprint-map.types';
import './footprint-map.css';

type SdkState = 'idle' | 'loading' | 'ready' | 'unavailable';

function locationName(location: FootprintMapLocation): string {
  return location.placeName ?? location.cityName ?? '未知位置';
}

function locationRegion(location: FootprintMapLocation): string {
  return [location.provinceName, location.cityName].filter(Boolean).join(' · ');
}

export default function FootprintMap({
  markers,
  litCities,
  selectedVisitedPlaceId,
  loading,
  errorMessage,
  onSelectVisitedPlace,
  onPickLocation,
  height = 420,
  disableMapSdk = false,
}: FootprintMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const adapterRef = useRef<FootprintMapAdapter | null>(null);
  // 回调与数据放在 ref 里，避免地图初始化完成后用到过期的 props 闭包。
  const callbacksRef = useRef({ onSelectVisitedPlace, onPickLocation });
  callbacksRef.current = { onSelectVisitedPlace, onPickLocation };
  const dataRef = useRef({ markers, selectedVisitedPlaceId });
  dataRef.current = { markers, selectedVisitedPlaceId };

  const [sdkState, setSdkState] = useState<SdkState>('idle');
  const [sdkReason, setSdkReason] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (disableMapSdk) {
      setSdkState('idle');
      setSdkReason(null);
      return;
    }
    if (!isMapConfigured()) {
      setSdkState('unavailable');
      setSdkReason('MISSING_KEY');
      return;
    }
    const container = containerRef.current;
    if (!container) return;

    let active = true;
    setSdkState('loading');
    setSdkReason(null);

    createMapAdapter({
      container,
      onSelectLocation: (locationId) => callbacksRef.current.onSelectVisitedPlace(locationId),
      onPickLocation: (coordinates) => callbacksRef.current.onPickLocation(coordinates),
    })
      .then((adapter) => {
        if (!active) {
          adapter.destroy();
          return;
        }
        adapterRef.current = adapter;
        adapter.render(dataRef.current.markers, dataRef.current.selectedVisitedPlaceId);
        setSdkState('ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        adapterRef.current = null;
        setSdkState('unavailable');
        setSdkReason(error instanceof Error ? error.message : 'LOAD_FAILED');
      });

    return () => {
      active = false;
      adapterRef.current?.destroy();
      adapterRef.current = null;
    };
  }, [disableMapSdk, retryToken]);

  useEffect(() => {
    adapterRef.current?.render(markers, selectedVisitedPlaceId);
  }, [markers, selectedVisitedPlaceId, sdkState]);

  const selected = markers.find((location) => location.locationId === selectedVisitedPlaceId);
  const checkInTotal = markers.reduce((total, location) => total + location.checkInCount, 0);
  const unmappedCount = markers.filter((location) => location.coordinateSystem !== 'GCJ-02').length;
  const sortedCities = [...litCities].sort((left, right) => right.checkInCount - left.checkInCount);

  const sdkNotice =
    sdkState === 'unavailable'
      ? sdkReason === 'MISSING_KEY'
        ? '未配置浏览器地图 Key（VITE_AMAP_WEB_KEY），底图不可用；已点亮城市与足迹列表仍可查看。'
        : '地图资源加载失败，请检查网络、Key 与域名白名单；已点亮城市与足迹列表仍可查看。'
      : null;
  const canRetry = sdkState === 'unavailable' && sdkReason !== 'MISSING_KEY' && !disableMapSdk;

  return (
    <section className="footprint-map" aria-labelledby="footprint-map-title">
      <header className="footprint-map-header">
        <div>
          <h2 id="footprint-map-title">足迹地图</h2>
          <p className="footprint-map-summary">
            {markers.length} 个位置 · 共 {checkInTotal} 次打卡 · {sortedCities.length} 个城市已点亮
          </p>
        </div>
        {canRetry && (
          <button
            type="button"
            className="footprint-map-retry"
            onClick={() => setRetryToken((token) => token + 1)}
          >
            重试加载地图
          </button>
        )}
      </header>

      <div className="footprint-map-stage" style={{ height }}>
        <div
          ref={containerRef}
          className="footprint-map-canvas"
          role="region"
          aria-label="足迹地图，点击地图空白处可选取坐标"
        />
        {loading && (
          <p className="footprint-map-overlay" role="status">
            正在加载足迹数据…
          </p>
        )}
        {!loading && errorMessage && (
          <p className="footprint-map-overlay is-error" role="alert">
            {errorMessage}
          </p>
        )}
        {!loading && !errorMessage && markers.length === 0 && (
          <p className="footprint-map-overlay">还没有足迹记录，先记录一条到访吧。</p>
        )}
      </div>

      {sdkNotice && (
        <p className="footprint-map-notice" role="status">
          {sdkNotice}
        </p>
      )}
      {!loading && !errorMessage && sdkState === 'ready' && markers.length > 0 && (
        <p className="footprint-map-hint">
          点击地图上的标记选择位置，点击空白处可拾取坐标。
          {unmappedCount > 0
            ? `另有 ${unmappedCount} 个位置只有原始 WGS-84 坐标，未绘制在底图上。`
            : ''}
        </p>
      )}

      <p className="footprint-map-selected" aria-live="polite">
        {selected
          ? `已选择：${locationName(selected)}${locationRegion(selected) ? `（${locationRegion(selected)}）` : ''}`
          : '尚未选择位置。'}
      </p>

      <div className="footprint-map-body">
        <section className="footprint-map-cities" aria-labelledby="footprint-map-cities-title">
          <h3 id="footprint-map-cities-title">已点亮城市</h3>
          {sortedCities.length === 0 ? (
            <p className="footprint-map-empty">还没有点亮任何城市。</p>
          ) : (
            <ul>
              {sortedCities.map((city) => (
                <li key={city.cityAdcode}>
                  <span>{city.cityName}</span>
                  <span className="footprint-map-count">{city.checkInCount} 次</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="footprint-map-places" aria-labelledby="footprint-map-places-title">
          <h3 id="footprint-map-places-title">足迹位置</h3>
          {markers.length === 0 ? (
            <p className="footprint-map-empty">暂无足迹位置。</p>
          ) : (
            <ul>
              {markers.map((location) => {
                const isSelected = location.locationId === selectedVisitedPlaceId;
                return (
                  <li key={location.locationId}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      className={isSelected ? 'is-selected' : undefined}
                      onClick={() => onSelectVisitedPlace(location.locationId)}
                    >
                      <strong>{locationName(location)}</strong>
                      <span>
                        {[locationRegion(location), `打卡 ${location.checkInCount} 次`]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {location.coordinateSystem !== 'GCJ-02' && (
                        <em className="footprint-map-badge">坐标未转换</em>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
