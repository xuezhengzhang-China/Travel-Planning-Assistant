import { useCallback, useEffect, useState } from 'react';
import type { Coordinates, FootprintMapData, FootprintMapProvince } from '@travel/shared';
import { ApiError, type ApiClient } from '../../lib/api-client';
import FootprintMap from './FootprintMap';
import './footprint-page.css';

function mapErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'UNAUTHENTICATED' || error.status === 401) return '登录已过期，请重新登录。';
    return error.message;
  }
  if (error instanceof TypeError) return '无法连接服务器，请检查后端是否启动。';
  return error instanceof Error ? error.message : '足迹数据加载失败，请重试。';
}

export interface FootprintPageProps {
  client: ApiClient;
}

/**
 * 旅行足迹页。
 *
 * 后端 `GET /api/footprints/map` 是**两级**返回：
 * - 不传 `provinceAdcode`：给 `provinces`（省份汇总），`cities` 与 `locations` 都为空；
 * - 传 `provinceAdcode`：给该省的 `cities` 与 `locations`，`provinces` 为空。
 *
 * 所以页面按「全国省份列表 → 单省城市 + 地图」做下钻，而不是一次拉全部。
 * 地图渲染交给 `FootprintMap`（缺 Key、加载失败、空态都由它自己处理）。
 *
 * 「记录到访」表单尚未接入，地图拾取的坐标只回显、不写库。
 */
export default function FootprintPage({ client }: FootprintPageProps) {
  const [data, setData] = useState<FootprintMapData | null>(null);
  const [province, setProvince] = useState<FootprintMapProvince | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<Coordinates | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    // 地图拾取的是当前省份下的坐标，换省后清空，避免误以为属于新省份。
    setSelected(null);
    setPicked(null);
    const query = province
      ? `/footprints/map?provinceAdcode=${province.provinceAdcode}&includeLocations=true`
      : '/footprints/map?includeLocations=true';
    client
      .request<FootprintMapData>(query)
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
  }, [client, province, refreshToken]);

  const reload = useCallback(() => setRefreshToken((value) => value + 1), []);
  const summary = data?.summary;

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

      {!province && (
        <>
          <p className="footprint-page-summary">
            {summary
              ? `${summary.provinceCount} 个省份 · ${summary.cityCount} 个城市 · ${summary.checkInCount} 次打卡`
              : '正在读取足迹汇总…'}
          </p>
          {!loading && (data?.provinces.length ?? 0) === 0 && (
            <p className="footprint-page-note">还没有足迹记录，先记录一条到访吧。</p>
          )}
          <ul className="footprint-province-list">
            {(data?.provinces ?? []).map((item) => (
              <li key={item.provinceAdcode}>
                <button type="button" onClick={() => setProvince(item)}>
                  <strong>{item.provinceName}</strong>
                  <span>
                    {item.cityCount} 个城市 · {item.locationCount} 个位置 · {item.checkInCount}{' '}
                    次打卡
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="footprint-page-note">
            点选省份后才会显示该省的城市与地图位置（后端省级视图才返回 cities 与 locations）。
          </p>
        </>
      )}

      {province && (
        <>
          <div className="footprint-breadcrumb">
            <button type="button" onClick={() => setProvince(null)}>
              ← 全部省份
            </button>
            <strong>{province.provinceName}</strong>
          </div>

          <FootprintMap
            markers={data?.locations ?? []}
            litCities={data?.cities ?? []}
            selectedVisitedPlaceId={selected}
            loading={loading}
            errorMessage={error}
            onSelectVisitedPlace={setSelected}
            onPickLocation={(coordinates) => setPicked(coordinates)}
            height={360}
          />

          {picked && (
            <p className="footprint-page-note">
              已拾取坐标：{picked.longitude.toFixed(5)}, {picked.latitude.toFixed(5)}
              （「记录到访」表单将在下一步接入）。
            </p>
          )}
        </>
      )}

      <p className="footprint-page-note">
        数据来自 <code>GET /api/footprints/map</code>。未配置浏览器地图 Key
        时只显示列表、不显示底图； 足迹的省市归属需要服务端配置高德 Web 服务 Key。
      </p>
      <p className="profile-version">WANDER · TRAVEL PLANNER</p>
    </section>
  );
}
