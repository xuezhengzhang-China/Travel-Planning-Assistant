/**
 * 行政区 GeoJSON 的加载与缓存。
 *
 * 数据源是阿里 DataV.GeoAtlas（`areas_v3/bound/{adcode}_full.json`）：
 * - `100000` → 全国 34 个省级行政区；
 * - 省级 adcode（如 `330000`）→ 该省的下级市/区。
 *
 * 为什么用它：高德底图需要浏览器 Key，而这块只需要一份公开的 GeoJSON，
 * 所以「画地图 + 按坐标判断省份」在没有 Key 的环境里也能工作。
 *
 * 缓存策略：成功结果按 adcode 常驻（一份全国数据 582KB，重复拉不值得）；
 * 失败不缓存，调用方可以重试。
 */

import type { AtlasGeo } from './atlas-geo';

const ENDPOINT = 'https://geo.datav.aliyun.com/areas_v3/bound';
const cache = new Map<string, Promise<AtlasGeo>>();

export function atlasRegionUrl(adcode: string): string {
  return `${ENDPOINT}/${adcode}_full.json`;
}

export function loadAtlasRegions(adcode: string, timeoutMs = 12000): Promise<AtlasGeo> {
  const cached = cache.get(adcode);
  if (cached) return cached;

  const task = fetch(atlasRegionUrl(adcode), { signal: AbortSignal.timeout(timeoutMs) })
    .then((response) => {
      if (!response.ok) throw new Error(`行政区地图加载失败（HTTP ${response.status}）`);
      return response.json() as Promise<AtlasGeo>;
    })
    .then((data) => {
      if (!data || !Array.isArray(data.features) || data.features.length === 0) {
        throw new Error('行政区地图数据格式异常');
      }
      return data;
    })
    .catch((error: unknown) => {
      cache.delete(adcode);
      throw error instanceof Error ? error : new Error('行政区地图加载失败');
    });

  cache.set(adcode, task);
  return task;
}

/** 供测试或「重试」使用。 */
export function clearAtlasCache(): void {
  cache.clear();
}
