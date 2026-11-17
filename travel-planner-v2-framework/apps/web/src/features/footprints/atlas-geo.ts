/**
 * 行政区地图的纯几何工具：给 `AtlasMap` 用，也是唯一能单测的部分。
 *
 * 数据来源：阿里 DataV.GeoAtlas 的行政区 GeoJSON（`areas_v3/bound/{adcode}_full.json`）。
 * 用它自绘地图的好处是**不需要高德 Key**：省份归属由坐标落在哪个多边形里算出来，
 * 不依赖服务端逆地理编码。
 *
 * 坐标约定：GeoJSON 是 [经度, 纬度]；投影沿用 V1 的 Web 墨卡托变体，y 轴取负以便 SVG 向下。
 */

export interface AtlasProperties {
  adcode: number | string;
  name: string;
  center?: number[];
  centroid?: number[];
  level?: string;
}

export interface AtlasFeature {
  properties: AtlasProperties;
  geometry: {
    type: 'Polygon' | 'MultiPolygon' | string;
    coordinates: number[][][] | number[][][][];
  };
}

export interface AtlasGeo {
  features: AtlasFeature[];
}

/** 绘图区尺寸与留白，与 V1 的 `viewBox 0 0 1000 620` 对齐。 */
export const ATLAS_WIDTH = 860;
export const ATLAS_HEIGHT = 520;
export const ATLAS_PAD_X = 70;
export const ATLAS_PAD_Y = 45;

/** 5 档色阶：0 / 1–2 / 3–5 / 6–9 / 10+。 */
export const ATLAS_SHADES = ['#e8eae3', '#dde6d4', '#cbdcbd', '#b6cda6', '#9fba8f'];

export function atlasShade(count: number): string {
  const index = count <= 0 ? 0 : count < 3 ? 1 : count < 6 ? 2 : count < 10 ? 3 : 4;
  return ATLAS_SHADES[index]!;
}

const RAD = Math.PI / 180;

/** 经纬度 → 投影坐标（y 轴向下为正）。 */
export function projectCoordinate(point: number[]): [number, number] {
  const longitude = point[0] ?? 0;
  const latitude = point[1] ?? 0;
  return [longitude, -Math.log(Math.tan(Math.PI / 4 + (latitude * RAD) / 2)) / RAD];
}

/** 取多边形的分组：每个 Polygon 是 [外环, 洞...]。 */
export function featurePolygons(feature: AtlasFeature): number[][][][] {
  if (feature.geometry.type === 'Polygon') {
    return [feature.geometry.coordinates as number[][][]];
  }
  return feature.geometry.coordinates as number[][][][];
}

/** 取所有环（外环与洞混在一起，仅用于算包围盒与画路径）。 */
export function featureRings(feature: AtlasFeature): number[][][] {
  return featurePolygons(feature).flat();
}

/** 射线法：点是否在单个环内。 */
export function pointInRing(longitude: number, latitude: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]?.[0];
    const yi = ring[i]?.[1];
    const xj = ring[j]?.[0];
    const yj = ring[j]?.[1];
    if (xi === undefined || yi === undefined || xj === undefined || yj === undefined) continue;
    if (yi > latitude === yj > latitude) continue;
    const crossLng = ((xj - xi) * (latitude - yi)) / (yj - yi) + xi;
    if (longitude < crossLng) inside = !inside;
  }
  return inside;
}

/** 点是否落在该要素内（在外环内且不在任何一个洞里）。 */
export function featureContains(
  feature: AtlasFeature,
  longitude: number,
  latitude: number,
): boolean {
  for (const polygon of featurePolygons(feature)) {
    const [outer, ...holes] = polygon;
    if (!outer || !pointInRing(longitude, latitude, outer)) continue;
    if (holes.some((hole) => pointInRing(longitude, latitude, hole))) continue;
    return true;
  }
  return false;
}

/** 找出包含该坐标的要素；没有则返回 null（例如落在海上）。 */
export function featureAt(
  features: AtlasFeature[],
  longitude: number,
  latitude: number,
): AtlasFeature | null {
  for (const feature of features) {
    if (featureContains(feature, longitude, latitude)) return feature;
  }
  return null;
}

/** 按要素统计点位数量：adcode → count。落在任何要素外的点直接跳过。 */
export function countByFeature(
  features: AtlasFeature[],
  points: { longitude: number; latitude: number }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const point of points) {
    const feature = featureAt(features, point.longitude, point.latitude);
    if (!feature) continue;
    const code = String(feature.properties.adcode);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
}

export interface AtlasProjection {
  /** 经纬度 → SVG 坐标。 */
  position(point: number[]): [number, number];
  /** 要素 → SVG 路径字符串。 */
  path(feature: AtlasFeature): string;
}

/**
 * 按所有要素的包围盒做等比缩放，映射到 860×520 的绘图区。
 * 没有点时返回恒等映射，避免出现 NaN 路径。
 */
export function buildProjection(features: AtlasFeature[]): AtlasProjection {
  // 注意层级：featureRings 返回的是「环的数组」，projectCoordinate 只接受「点」。
  // 早期写成 featureRings(feature).map(projectCoordinate) 会把整个环当成点，
  // point[0] / point[1] 变成数组，包围盒直接算出 NaN。
  const projected = features.flatMap((feature) =>
    featureRings(feature).flatMap((ring) => ring.map(projectCoordinate)),
  );
  if (projected.length === 0) {
    return {
      position: () => [ATLAS_PAD_X, ATLAS_PAD_Y],
      path: () => '',
    };
  }
  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(ATLAS_WIDTH / (maxX - minX || 1), ATLAS_HEIGHT / (maxY - minY || 1));

  const position = (point: number[]): [number, number] => {
    const [x, y] = projectCoordinate(point);
    return [ATLAS_PAD_X + (x - minX) * scale, ATLAS_PAD_Y + (y - minY) * scale];
  };

  const path = (feature: AtlasFeature): string =>
    featureRings(feature)
      .map(
        (ring) =>
          ring.map((point, index) => `${index ? 'L' : 'M'}${position(point).join(',')}`).join(' ') +
          'Z',
      )
      .join(' ');

  return { position, path };
}
