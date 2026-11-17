import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FootprintMapLocation } from '@travel/shared';
import {
  ATLAS_SHADES,
  atlasShade,
  buildProjection,
  countByFeature,
  featureAt,
  type AtlasGeo,
} from './atlas-geo';
import { loadAtlasRegions } from './region-loader';
import './atlas-map.css';

/** 全国视图的 adcode。 */
export const NATIONAL_ADCODE = '100000';

const LEGEND_LABELS = ['未点亮', '1–2', '3–5', '6–9', '10+'];
const PIN_PATH = 'M0 0 C-6 -9 -13 -15 -13 -23 A13 13 0 1 1 13 -23 C13 -15 6 -9 0 0Z';

export interface AtlasMapProps {
  /** `100000` 显示全国省级行政区；传省级 adcode 显示该省下级行政区。 */
  adcode: string;
  locations: FootprintMapLocation[];
  /** 传了才可点击行政区（全国视图用来下钻）。 */
  onSelectRegion?: (adcode: string, name: string) => void;
  /** 行政区名称标签数量多时会挤，省级视图可以关掉。 */
  showLabels?: boolean;
}

/**
 * 行政区足迹地图（DataV GeoJSON 自绘，**不需要高德 Key**）。
 *
 * 与 D 的 `FootprintMap` 的分工：
 * - 本组件只负责「把行政区画出来 + 按坐标着色 + 画点位」，不依赖任何地图 SDK；
 * - `FootprintMap` 用高德底图，需要 `VITE_AMAP_WEB_KEY`，配好 Key 后可以并存。
 *
 * 着色依据是**前端按坐标落在哪个省/市多边形里**统计出来的，不依赖服务端
 * 逆地理编码，所以没有 Key 时也能点亮行政区。
 */
export default function AtlasMap({
  adcode,
  locations,
  onSelectRegion,
  showLabels = adcode === NATIONAL_ADCODE,
}: AtlasMapProps) {
  const [geo, setGeo] = useState<AtlasGeo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    loadAtlasRegions(adcode)
      .then((result) => {
        if (active) setGeo(result);
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(failure instanceof Error ? failure.message : '行政区地图加载失败');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [adcode, retryToken]);

  const projection = useMemo(() => (geo ? buildProjection(geo.features) : null), [geo]);
  // 省级视图不能依赖服务端按 provinceAdcode 过滤：没有高德 Key 时足迹的 adcode 是 null，
  // 服务端会返回空。这里改用「点是否落在当前地图的行政区多边形里」来筛，纯前端。
  const visibleLocations = useMemo(() => {
    if (!geo) return [] as FootprintMapLocation[];
    if (adcode === NATIONAL_ADCODE) return locations;
    return locations.filter(
      (location) => featureAt(geo.features, location.longitude, location.latitude) !== null,
    );
  }, [geo, adcode, locations]);

  const counts = useMemo(
    () => (geo ? countByFeature(geo.features, visibleLocations) : new Map<string, number>()),
    [geo, visibleLocations],
  );

  /** 被点亮的行政区（按数量降序），用于统计行与省级视图的芯片。 */
  const lit = useMemo(() => {
    if (!geo) return [] as { code: string; name: string; count: number }[];
    return geo.features
      .map((feature) => ({
        code: String(feature.properties.adcode),
        name: feature.properties.name,
        count: counts.get(String(feature.properties.adcode)) ?? 0,
      }))
      .filter((item) => item.count > 0)
      .sort((left, right) => right.count - left.count);
  }, [geo, counts]);
  const retry = useCallback(() => setRetryToken((value) => value + 1), []);

  if (loading) {
    return (
      <section className="atlas-panel" aria-busy="true">
        <p className="atlas-empty" role="status">
          正在加载行政区地图…
        </p>
      </section>
    );
  }

  if (error || !geo || !projection) {
    return (
      <section className="atlas-panel">
        <p className="atlas-empty" role="alert">
          {error ?? '行政区地图不可用'}
          <button type="button" onClick={retry}>
            重试
          </button>
        </p>
      </section>
    );
  }

  return (
    <section className="atlas-panel">
      <svg
        className="atlas-svg"
        viewBox="0 0 1000 620"
        role="img"
        aria-label={adcode === NATIONAL_ADCODE ? '全国足迹分布图' : '省级足迹分布图'}
      >
        {geo.features.map((feature) => {
          const code = String(feature.properties.adcode);
          const name = feature.properties.name;
          const count = counts.get(code) ?? 0;
          const select = onSelectRegion ? () => onSelectRegion(code, name) : undefined;
          const labelPoint = feature.properties.centroid ?? feature.properties.center;
          return (
            <g key={code}>
              <path
                d={projection.path(feature)}
                fillRule="evenodd"
                style={{ fill: atlasShade(count) }}
                className={`atlas-region${count > 0 ? ' visited' : ''}`}
                role={select ? 'button' : undefined}
                tabIndex={select ? 0 : undefined}
                aria-label={name}
                onClick={select}
                onKeyDown={
                  select
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          select();
                        }
                      }
                    : undefined
                }
              >
                <title>{count > 0 ? `${name} · ${count} 个足迹` : name}</title>
              </path>
              {showLabels && labelPoint && labelPoint.length >= 2 && (
                <text
                  className="atlas-label"
                  x={projection.position(labelPoint)[0]}
                  y={projection.position(labelPoint)[1]}
                >
                  {name}
                </text>
              )}
            </g>
          );
        })}

        {visibleLocations.map((location) => {
          const [x, y] = projection.position([location.longitude, location.latitude]);
          return (
            <g
              key={location.locationId}
              className="atlas-pin"
              transform={`translate(${x},${y})`}
              aria-label={location.placeName ?? location.cityName ?? '足迹'}
            >
              <path d={PIN_PATH} />
              <circle cy="-23" r="4" />
              <text y="18">{location.placeName ?? location.cityName ?? '足迹'}</text>
            </g>
          );
        })}
      </svg>

      <div className="atlas-legend">
        {LEGEND_LABELS.map((label, index) => (
          <span key={label}>
            <i style={{ background: ATLAS_SHADES[index] }} />
            {label}
          </span>
        ))}
      </div>

      {onSelectRegion && <p className="atlas-credit">点击省份，查看该省的城市与点位。</p>}

      <p className="atlas-summary" role="status">
        {lit.length === 0
          ? '还没有被点亮的行政区'
          : `已点亮 ${lit.length} 个行政区 · 共 ${visibleLocations.length} 个点位`}
      </p>

      {adcode !== NATIONAL_ADCODE && lit.length > 0 && (
        <div className="atlas-chips">
          {lit.map((item) => (
            <span key={item.code} className="atlas-chip">
              {item.name}
              <em>{item.count}</em>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
