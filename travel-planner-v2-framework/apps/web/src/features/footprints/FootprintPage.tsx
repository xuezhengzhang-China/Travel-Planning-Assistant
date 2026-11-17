import { useCallback, useEffect, useState } from 'react';
import type { FootprintMapData } from '@travel/shared';
import { ApiError, type ApiClient } from '../../lib/api-client';
import AtlasMap, { NATIONAL_ADCODE } from './AtlasMap';
import './footprint-page.css';

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

export interface FootprintPageProps {
  client: ApiClient;
}

/**
 * 旅行足迹页：行政区地图（DataV 自绘，**不需要高德 Key**）。
 *
 * 数据只拉一次：`GET /api/footprints/map?includeLocations=true`（全国点位）。
 * 之所以不按省份分别请求：没有高德 Key 时足迹的 `provinceAdcode` 是 null，
 * 服务端按 `provinceAdcode` 过滤会返回空。所以省级视图的筛选改由 `AtlasMap`
 * 按「坐标落在哪个行政区多边形里」在前端完成。
 *
 * 代价：服务端已有的 `provinces` / `cities` 聚合暂时不用（那套依赖 adcode）。
 * 配好高德 Key 之后可以切回服务端聚合，届时删掉 `AtlasMap` 里的前端归属即可。
 */
export default function FootprintPage({ client }: FootprintPageProps) {
  const [data, setData] = useState<FootprintMapData | null>(null);
  const [province, setProvince] = useState<SelectedProvince | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    client
      .request<FootprintMapData>('/footprints/map?includeLocations=true')
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
  }, [client, refreshToken]);

  const reload = useCallback(() => setRefreshToken((value) => value + 1), []);
  const locations = data?.locations ?? [];
  const checkIns = data?.summary.checkInCount ?? 0;

  return (
    <section className="sub-page">
      <p className="eyebrow">YOUR TRAVEL MEMORIES</p>
      <div className="sub-page-title">
        <div>
          <h1>旅行足迹</h1>
          <p>走过的地方，都是生活的礼物。</p>
        </div>
        <button type="button" className="primary-button" disabled={loading} onClick={reload}>
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

      <p className="footprint-page-summary">
        {loading ? '正在读取足迹…' : `共 ${checkIns} 次打卡 · ${locations.length} 个位置`}
      </p>

      <AtlasMap
        adcode={province?.adcode ?? NATIONAL_ADCODE}
        locations={locations}
        onSelectRegion={province ? undefined : (adcode, name) => setProvince({ adcode, name })}
      />

      {!loading && locations.length === 0 && (
        <p className="footprint-page-note">
          还没有足迹记录，所以地图上没有点位。接上「记录到访」表单后就能直接在地图上添加。
        </p>
      )}

      <p className="footprint-page-note">
        地图数据来自 DataV.GeoAtlas，按坐标在前端判断所属行政区，因此
        <strong>不需要高德 Key 也能点亮省份</strong>。地址文字与 POI 搜索仍依赖服务端地图 Key。
      </p>
      <p className="profile-version">WANDER · TRAVEL PLANNER</p>
    </section>
  );
}
