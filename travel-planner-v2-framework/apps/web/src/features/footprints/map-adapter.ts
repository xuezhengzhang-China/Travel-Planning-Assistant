import type { Coordinates, FootprintMapLocation } from '@travel/shared';

const SCRIPT_BASE = 'https://webapi.amap.com/maps';
const LOAD_TIMEOUT_MS = 10_000;
/** 全国视图中心点，避免每次挂载都跳到用户上次拖到的地方。 */
const CHINA_CENTER: [number, number] = [104.2, 35.8];
const DEFAULT_ZOOM = 4;
const FIT_AVOID_PADDING: number[] = [48, 48, 48, 48];
const FIT_MAX_ZOOM = 12;

/** AMap JS API v2 中本组件实际会用到的部分；其余能力不在这里猜测声明。 */
interface AmapLngLat {
  getLng(): number;
  getLat(): number;
}

interface AmapClickEvent {
  lnglat: AmapLngLat;
  originEvent?: { stopPropagation?: () => void };
}

interface AmapMarker {
  setMap(map: AmapMap | null): void;
  on(event: 'click', handler: (event: AmapClickEvent) => void): void;
}

interface AmapMap {
  on(event: 'click', handler: (event: AmapClickEvent) => void): void;
  off(event: 'click', handler: (event: AmapClickEvent) => void): void;
  setCenter(center: [number, number]): void;
  setZoom(zoom: number): void;
  setFitView(
    overlays: AmapMarker[],
    immediately?: boolean,
    avoid?: number[],
    maxZoom?: number,
  ): void;
  destroy(): void;
}

interface AmapNamespace {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => AmapMap;
  Marker: new (options: Record<string, unknown>) => AmapMarker;
}

declare global {
  interface Window {
    AMap?: AmapNamespace;
    _AMapSecurityConfig?: { securityJsCode?: string };
  }
}

/** 浏览器端高德 Web JS Key；为空表示未配置，组件应退化为列表视图。 */
export function mapApiKey(): string {
  return (import.meta.env.VITE_AMAP_WEB_KEY ?? '').trim();
}

export function isMapConfigured(): boolean {
  return mapApiKey().length > 0;
}

/** 已加载脚本的缓存，保证 React 严格模式重复挂载时只插入一个 script。 */
let pendingLoad: Promise<AmapNamespace> | null = null;

/**
 * 按需插入高德 JS API 脚本。失败或超时后清空缓存，允许用户点击“重试”再次加载。
 * 安全密钥（securityJsCode）只在此处设置一次，不写进任何共享类型或仓库文件。
 */
export function loadAmap(): Promise<AmapNamespace> {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (pendingLoad) return pendingLoad;

  const key = mapApiKey();
  if (!key) return Promise.reject(new Error('MISSING_KEY'));

  const securityCode = (import.meta.env.VITE_AMAP_SECURITY_CODE ?? '').trim();
  if (securityCode) {
    window._AMapSecurityConfig = { ...window._AMapSecurityConfig, securityJsCode: securityCode };
  }

  pendingLoad = new Promise<AmapNamespace>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${SCRIPT_BASE}?v=2.0&key=${encodeURIComponent(key)}`;
    script.async = true;

    const cleanup = () => {
      window.clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      script.remove();
    };

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('LOAD_TIMEOUT'));
    }, LOAD_TIMEOUT_MS);

    script.onload = () => {
      cleanup();
      if (window.AMap) resolve(window.AMap);
      else reject(new Error('LOAD_FAILED'));
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('LOAD_FAILED'));
    };

    document.head.appendChild(script);
  }).catch((error: unknown) => {
    pendingLoad = null;
    throw error;
  });

  return pendingLoad;
}

/** 地图实例的生命周期由组件持有，A 不需要也不应该直接操作。 */
export interface FootprintMapAdapter {
  /** 用最新数据重绘标记；同一实例可反复调用。 */
  render(markers: FootprintMapLocation[], selectedLocationId: string | null): void;
  /** 卸载地图、移除标记与监听；重复调用必须安全。 */
  destroy(): void;
}

export interface CreateMapAdapterOptions {
  container: HTMLElement;
  /** 点击标记时回调位置 ID；由组件转发给 A。 */
  onSelectLocation: (locationId: string) => void;
  /** 点击地图空白处时回调 GCJ-02 坐标。 */
  onPickLocation: (coordinates: Coordinates) => void;
}

function markerName(location: FootprintMapLocation): string {
  return location.placeName ?? location.cityName ?? '未知位置';
}

function markerTitle(location: FootprintMapLocation): string {
  const region = [location.provinceName, location.cityName].filter(Boolean).join(' · ');
  return [markerName(location), region, `打卡 ${location.checkInCount} 次`]
    .filter(Boolean)
    .join(' · ');
}

function buildMarkerElement(location: FootprintMapLocation, selected: boolean): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = selected ? 'footprint-map-marker is-selected' : 'footprint-map-marker';
  element.textContent = markerName(location);
  element.title = markerTitle(location);
  element.setAttribute('aria-label', markerTitle(location));
  return element;
}

/**
 * 在给定容器中创建地图。调用前应确认 `isMapConfigured()`，否则会以 MISSING_KEY 拒绝。
 * WGS-84 且没有服务端转换结果的点不会画在高德底图上，避免把未经转换的坐标当成地图坐标。
 */
export async function createMapAdapter(
  options: CreateMapAdapterOptions,
): Promise<FootprintMapAdapter> {
  const AMap = await loadAmap();
  const { container, onSelectLocation, onPickLocation } = options;

  const map = new AMap.Map(container, {
    viewMode: '2D',
    zoom: DEFAULT_ZOOM,
    center: CHINA_CENTER,
    resizeEnable: true,
  });

  const markerInstances = new Map<string, { marker: AmapMarker; element: HTMLButtonElement }>();
  let destroyed = false;
  let lastFitKey = '';

  const handleMapClick = (event: AmapClickEvent) => {
    if (destroyed) return;
    const longitude = event.lnglat?.getLng?.();
    const latitude = event.lnglat?.getLat?.();
    if (
      typeof longitude !== 'number' ||
      typeof latitude !== 'number' ||
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude)
    ) {
      return;
    }
    onPickLocation({ longitude, latitude, coordinateSystem: 'GCJ-02' });
  };
  map.on('click', handleMapClick);

  function clearMarkers() {
    for (const { marker } of markerInstances.values()) marker.setMap(null);
    markerInstances.clear();
  }

  function render(markers: FootprintMapLocation[], selectedLocationId: string | null) {
    if (destroyed) return;
    clearMarkers();

    const drawable = markers.filter(
      (location) =>
        location.coordinateSystem === 'GCJ-02' &&
        Number.isFinite(location.longitude) &&
        Number.isFinite(location.latitude),
    );

    for (const location of drawable) {
      const selected = location.locationId === selectedLocationId;
      const element = buildMarkerElement(location, selected);
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!destroyed) onSelectLocation(location.locationId);
      });
      const marker = new AMap.Marker({
        position: [location.longitude, location.latitude],
        content: element,
        anchor: 'bottom-center',
        title: markerTitle(location),
        zIndex: selected ? 200 : 120,
      });
      marker.setMap(map);
      markerInstances.set(location.locationId, { marker, element });
    }

    const fitKey = drawable
      .map((location) => location.locationId)
      .sort()
      .join('|');
    if (drawable.length > 0 && fitKey !== lastFitKey) {
      const overlays = drawable
        .map((location) => markerInstances.get(location.locationId))
        .filter((entry): entry is { marker: AmapMarker; element: HTMLButtonElement } =>
          Boolean(entry),
        )
        .map(({ marker }) => marker);
      map.setFitView(overlays, false, FIT_AVOID_PADDING, FIT_MAX_ZOOM);
      lastFitKey = fitKey;
    } else if (drawable.length === 0) {
      map.setCenter(CHINA_CENTER);
      map.setZoom(DEFAULT_ZOOM);
      lastFitKey = '';
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearMarkers();
    map.off('click', handleMapClick);
    map.destroy();
  }

  return { render, destroy };
}
