import { useCallback, useEffect, useState } from 'react';
import type {
  FootprintEntry,
  FootprintListPage,
  FootprintMapData,
  FootprintMapLocation,
} from '@travel/shared';
import { ApiError, type ApiClient } from '../../lib/api-client';
import AtlasMap, { NATIONAL_ADCODE } from './AtlasMap';

function mapErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'UNAUTHENTICATED' || error.status === 401) return '登录已过期，请重新登录。';
    return error.message;
  }
  if (error instanceof TypeError) return '无法连接服务器，请检查后端是否启动。';
  return error instanceof Error ? error.message : '足迹数据加载失败，请重试。';
}

interface SelectedProvince {
  adcode: string;
  name: string;
}

export interface FootprintMapViewProps {
  client: ApiClient;
  /** 足迹增删后由宿主递增，触发重新拉取。 */
  refreshToken: number;
}

/**
 * 足迹地图视图：行政区地图（DataV 自绘）+ 点亮统计 + 省份/城市清单 + 年份筛选。
 * 全国视图拉 `GET /footprints/map?includeLocations=true`；下钻到省时再拉该省数据。
 */
export default function FootprintMapView({ client, refreshToken }: FootprintMapViewProps) {
  const [data, setData] = useState<FootprintMapData | null>(null);
  const [provinceData, setProvinceData] = useState<FootprintMapData | null>(null);
  const [province, setProvince] = useState<SelectedProvince | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedLocation, setSelectedLocation] = useState<FootprintMapLocation | null>(null);
  const [footprints, setFootprints] = useState<FootprintEntry[]>([]);
  const [footprintsLoading, setFootprintsLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ includeLocations: 'true' });
    if (year) query.set('year', year);
    client
      .request<FootprintMapData>(`/footprints/map?${query.toString()}`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((failure: unknown) => {
        if (active) setError(mapErrorMessage(failure));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, refreshToken, year, reloadToken]);

  useEffect(() => {
    if (!province) {
      setProvinceData(null);
      return;
    }
    let active = true;
    const query = new URLSearchParams({
      provinceAdcode: province.adcode,
      includeLocations: 'true',
    });
    if (year) query.set('year', year);
    client
      .request<FootprintMapData>(`/footprints/map?${query.toString()}`)
      .then((result) => {
        if (active) setProvinceData(result);
      })
      .catch(() => {
        if (active) setProvinceData(null);
      });
    return () => {
      active = false;
    };
  }, [client, province, year, refreshToken, reloadToken]);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  const openLocation = useCallback(
    (location: FootprintMapLocation) => {
      setSelectedLocation(location);
      setFootprintsLoading(true);
      client
        .request<FootprintListPage>('/footprints?page=1&pageSize=100')
        .then((page) =>
          setFootprints([...page.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
        )
        .catch(() => setFootprints([]))
        .finally(() => setFootprintsLoading(false));
    },
    [client],
  );

  const matchedFootprints = selectedLocation
    ? footprints.filter((footprint) => {
        if (selectedLocation.poiId && footprint.poiId === selectedLocation.poiId) return true;
        return (
          Math.abs(footprint.longitude - selectedLocation.longitude) < 0.001 &&
          Math.abs(footprint.latitude - selectedLocation.latitude) < 0.001
        );
      })
    : [];
  const locations = data?.locations ?? [];
  const summary = data?.summary;
  const litProvinces = data?.provinces ?? [];
  const litCities = provinceData?.cities ?? [];
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 11 }, (_, index) => currentYear - index);

  return (
    <>
      <div className="footprint-toolbar">
        <div className="footprint-year">
          <label htmlFor="footprint-year">年份</label>
          <select
            id="footprint-year"
            value={year}
            onChange={(event) => {
              setProvince(null);
              setYear(event.target.value);
            }}
          >
            <option value="">全部年份</option>
            {yearOptions.map((item) => (
              <option key={item} value={String(item)}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="secondary-button" disabled={loading} onClick={reload}>
          {loading ? '读取中…' : '刷新'}
        </button>
      </div>

      {error && (
        <p role="alert" className="profile-alert">
          {error}
        </p>
      )}

      {province && (
        <div className="footprint-breadcrumb">
          <button type="button" onClick={() => setProvince(null)}>
            ← 全国
          </button>
          <strong>{province.name}</strong>
        </div>
      )}

      {summary && (
        <div className="footprint-stats" role="status">
          <div>
            <strong>{summary.checkInCount}</strong>
            <span>打卡次数</span>
          </div>
          <div>
            <strong>{summary.provinceCount}</strong>
            <span>点亮省份</span>
          </div>
          <div>
            <strong>{summary.cityCount}</strong>
            <span>点亮城市</span>
          </div>
          <div>
            <strong>{summary.locationCount}</strong>
            <span>位置数</span>
          </div>
        </div>
      )}

      <p className="footprint-page-summary">
        {loading
          ? '正在读取足迹…'
          : `共 ${summary?.checkInCount ?? 0} 次打卡 · ${locations.length} 个位置`}
      </p>

      <AtlasMap
        adcode={province?.adcode ?? NATIONAL_ADCODE}
        locations={locations}
        onSelectRegion={province ? undefined : (adcode, name) => setProvince({ adcode, name })}
        onSelectLocation={openLocation}
      />

      {selectedLocation && (
        <div className="location-panel" aria-label="该地点的到访记录">
          <div className="location-panel-head">
            <strong>{selectedLocation.placeName ?? selectedLocation.cityName ?? '足迹'}</strong>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setSelectedLocation(null)}
            >
              关闭
            </button>
          </div>
          {footprintsLoading ? (
            <p className="footprint-page-summary">正在读取到访记录…</p>
          ) : matchedFootprints.length === 0 ? (
            <p className="footprint-page-note">这里还没有到访记录。</p>
          ) : (
            <ul className="location-footprints">
              {matchedFootprints.map((footprint) => (
                <li key={footprint.id}>
                  <span className="footprint-entry-date">{footprint.recordedOn}</span>
                  {footprint.text && <p>{footprint.text}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!province && litProvinces.length > 0 && (
        <div className="lit-list" aria-label="已点亮省份">
          <p className="lit-title">已点亮省份</p>
          <div className="lit-chips">
            {litProvinces.map((item) => (
              <span key={item.provinceAdcode} className="lit-chip">
                {item.provinceName}
                <em>{item.cityCount} 城</em>
              </span>
            ))}
          </div>
        </div>
      )}

      {province && litCities.length > 0 && (
        <div className="lit-list" aria-label="已点亮城市">
          <p className="lit-title">{province.name} · 已点亮城市</p>
          <div className="lit-chips">
            {litCities.map((item) => (
              <span key={item.cityAdcode} className="lit-chip">
                {item.cityName}
                <em>{item.checkInCount} 次</em>
              </span>
            ))}
          </div>
        </div>
      )}

      {!loading && locations.length === 0 && (
        <p className="footprint-page-note">
          {year
            ? `${year} 年还没有足迹记录。`
            : '还没有足迹记录，所以地图上没有点位。点击「记录足迹」添加第一条。'}
        </p>
      )}

      <p className="footprint-page-note">
        地图数据来自
        DataV.GeoAtlas，按坐标在前端判断所属行政区；点亮统计与省市清单来自服务端高德逆地理。
      </p>
    </>
  );
}
