import { Inject, Injectable } from '@nestjs/common';
import { BConfig } from '../../b/config';
import { unavailable } from '../../b/errors';
import type { Coordinates, TransportMode } from '../../b/types';
import type { BPlaces } from '@travel/shared' with { 'resolution-mode': 'import' };

export const B_FETCH = Symbol('B_FETCH');
export type Fetcher = typeof fetch;
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function nonempty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
const point = (p: Coordinates) => `${p.longitude.toFixed(6)},${p.latitude.toFixed(6)}`;

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record) : [];
}

function routePaths(choice: Record<string, unknown>, mode: TransportMode) {
  const steps =
    mode === 'transit'
      ? records(choice.segments).flatMap((segment) => [
          ...records(record(segment.walking).steps),
          records(record(segment.bus).buslines)[0] ?? {},
          record(segment.railway),
          record(segment.taxi),
        ])
      : records(choice.steps);
  return steps.flatMap(({ polyline }) => {
    const line = typeof polyline === 'string' ? polyline : record(polyline).polyline;
    if (typeof line !== 'string' || !line.trim()) return [];
    const points = line
      .trim()
      .split(/\s*;\s*/)
      .map((pair) => {
        const [longitude, latitude, extra] = pair.split(',');
        const lng = Number(longitude);
        const lat = Number(latitude);
        if (
          !longitude?.trim() ||
          !latitude?.trim() ||
          extra !== undefined ||
          !Number.isFinite(lng) ||
          !Number.isFinite(lat) ||
          Math.abs(lng) > 180 ||
          Math.abs(lat) > 90
        )
          return null;
        return [lng, lat] as [number, number];
      });
    return points.length >= 2 && points.every((coordinate) => coordinate !== null) ? [points] : [];
  });
}

function nonnegativeNumber(value: unknown): number | undefined {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '')
    return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function transitSteps(choice: Record<string, unknown>): BPlaces.TransitStep[] {
  return records(choice.segments).flatMap((segment) => {
    const steps: BPlaces.TransitStep[] = [];
    for (const mode of ['walking', 'bus', 'railway', 'taxi'] as const) {
      const raw = record(segment[mode]);
      const detail = mode === 'bus' ? (records(raw.buslines)[0] ?? {}) : raw;
      if (!Object.keys(detail).length) continue;
      const name = nonempty(detail.name);
      const departureStop = nonempty(record(detail.departure_stop).name);
      const arrivalStop = nonempty(record(detail.arrival_stop).name);
      const entrance = nonempty(record(record(detail.departure_stop).entrance).name);
      const exit = nonempty(record(record(detail.arrival_stop).exit).name);
      const serviceNotice = nonempty(detail.bus_time_tips);
      const distanceMeters = nonnegativeNumber(detail.distance);
      const seconds = nonnegativeNumber(
        record(detail.cost).duration ?? detail.duration ?? detail.drivetime,
      );
      const stopCount = nonnegativeNumber(detail.via_num);
      if (mode === 'walking' && !distanceMeters && !seconds) continue;
      if (mode === 'bus' && !name) continue;
      steps.push({
        mode,
        name: name ?? { walking: '步行', bus: '公交', railway: '火车', taxi: '出租车' }[mode],
        ...(departureStop ? { departureStop } : {}),
        ...(arrivalStop ? { arrivalStop } : {}),
        ...(entrance ? { entrance } : {}),
        ...(exit ? { exit } : {}),
        ...(serviceNotice ? { serviceNotice } : {}),
        ...(Number.isInteger(stopCount) ? { stopCount } : {}),
        ...(distanceMeters !== undefined ? { distanceMeters } : {}),
        ...(seconds !== undefined ? { durationMinutes: Math.ceil(seconds / 60) } : {}),
      });
    }
    return steps;
  });
}

@Injectable()
export class AmapClient {
  constructor(
    private readonly config: BConfig,
    @Inject(B_FETCH) private readonly transport: Fetcher,
  ) {}

  private async request(path: string, parameters: Record<string, string>, signal?: AbortSignal) {
    if (!this.config.values.amapKey) unavailable('地图服务尚未配置');
    const url = new URL(path, 'https://restapi.amap.com');
    url.search = new URLSearchParams({
      ...parameters,
      key: this.config.values.amapKey,
      output: 'JSON',
    }).toString();
    try {
      const timeout = AbortSignal.timeout(this.config.values.externalTimeoutMs);
      const response = await this.transport(url, {
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      });
      if (!response.ok) unavailable();
      const data = record(await response.json());
      if (data.status !== '1' || (data.infocode !== undefined && data.infocode !== '10000'))
        unavailable();
      return data;
    } catch {
      unavailable();
    }
  }
  async route(
    from: Coordinates,
    to: Coordinates,
    mode: TransportMode,
    cityCode?: string,
    signal?: AbortSignal,
  ): Promise<number> {
    return (await this.routeDetails(from, to, mode, cityCode, signal)).durationMinutes;
  }

  async routeDetails(
    from: Coordinates,
    to: Coordinates,
    mode: TransportMode,
    cityCode?: string,
    signal?: AbortSignal,
    includePaths = false,
  ) {
    const paths = {
      walking: '/v5/direction/walking',
      driving: '/v5/direction/driving',
      transit: '/v5/direction/transit/integrated',
    };
    let city1 = cityCode,
      city2 = cityCode;
    if (mode === 'transit' && !cityCode) {
      city1 = (await this.reverse(from, signal)).cityCode;
      city2 = (await this.reverse(to, signal)).cityCode;
      if (!city1 || !city2) unavailable('无法确定公交路线所在城市');
    }
    const data = await this.request(
      paths[mode],
      {
        origin: point(from),
        destination: point(to),
        show_fields: includePaths ? 'cost,polyline' : 'cost',
        ...(mode === 'transit' ? { city1: city1!, city2: city2! } : {}),
      },
      signal,
    );
    const route = record(data.route);
    const choices = mode === 'transit' ? route.transits : route.paths;
    const first = Array.isArray(choices) ? record(choices[0]) : {};
    const raw = record(first.cost).duration;
    if ((typeof raw !== 'string' && typeof raw !== 'number') || String(raw).trim() === '')
      unavailable('地图服务未返回有效路线耗时');
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 7 * 86400)
      unavailable('地图服务未返回有效路线耗时');
    return {
      durationMinutes: Math.ceil(seconds / 60),
      ...(includePaths ? { paths: routePaths(first, mode) } : {}),
      ...(includePaths && mode === 'transit' ? { transitSteps: transitSteps(first) } : {}),
    };
  }
  async reverse(p: Coordinates, signal?: AbortSignal) {
    const data = await this.request(
      '/v3/geocode/regeo',
      { location: point(p), extensions: 'base' },
      signal,
    );
    const result = record(data.regeocode),
      component = record(result.addressComponent);
    const placeName = nonempty(result.formatted_address);
    if (!placeName) unavailable('无法解析地点名称');
    const adcode = nonempty(component.adcode);
    const cityCode = nonempty(component.citycode);
    return {
      placeName,
      adcode: adcode && /^\d{6}$/.test(adcode) ? adcode : undefined,
      cityCode: cityCode && /^\d{3,4}$/.test(cityCode) ? cityCode : undefined,
    };
  }
  async convertGps(longitude: number, latitude: number): Promise<Coordinates> {
    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      Math.abs(longitude) > 180 ||
      Math.abs(latitude) > 90
    )
      unavailable('原始定位坐标不合法');
    const data = await this.request('/v3/assistant/coordinate/convert', {
      locations: `${longitude.toFixed(6)},${latitude.toFixed(6)}`,
      coordsys: 'gps',
    });
    if (typeof data.locations !== 'string') unavailable('坐标转换失败');
    const pair = data.locations.split(',');
    const lng = Number(pair[0]),
      lat = Number(pair[1]);
    if (
      pair.length !== 2 ||
      pair.some((v) => !v.trim()) ||
      !Number.isFinite(lng) ||
      !Number.isFinite(lat) ||
      Math.abs(lng) > 180 ||
      Math.abs(lat) > 90
    )
      unavailable('坐标转换失败');
    return { longitude: lng, latitude: lat, coordinateSystem: 'GCJ-02' };
  }
}
