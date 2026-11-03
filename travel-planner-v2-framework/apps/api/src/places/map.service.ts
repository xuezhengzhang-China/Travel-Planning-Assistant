import { Inject, Injectable } from '@nestjs/common';
import type { Coordinates, TransportMode } from '@travel/shared' with {
  'resolution-mode': 'import',
};
import { ConfigService } from '../config/config.service';
import { DatabaseService } from '../database/database.service';
import { ApiError } from '../common/api-error';
export const MAP_FETCH = Symbol('MAP_FETCH');
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
const pair = (c: Coordinates) => `${c.longitude.toFixed(6)},${c.latitude.toFixed(6)}`;
const unavailable = () =>
  new ApiError('DEPENDENCY_UNAVAILABLE', '地图服务暂不可用，请检查服务端 Key、权限或稍后重试', 503);
@Injectable()
export class MapService {
  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
    @Inject(MAP_FETCH) private readonly fetcher: typeof fetch,
  ) {}
  private async request(path: string, params: Record<string, string>) {
    const key = this.config.values.amapWebServiceKey;
    if (!key)
      throw new ApiError(
        'DEPENDENCY_UNAVAILABLE',
        '尚未配置高德服务端 Key，无法查询真实路线或解析城市',
        503,
      );
    try {
      const url = new URL(`https://restapi.amap.com/v3/${path}`);
      url.search = new URLSearchParams({ ...params, key, output: 'JSON' }).toString();
      const response = await this.fetcher(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw unavailable();
      const data = object(await response.json());
      if (data.status !== '1') throw unavailable();
      return data;
    } catch {
      throw unavailable();
    }
  }
  private async geocode(coordinates: Coordinates) {
    const data = await this.request('geocode/regeo', {
      location: pair(coordinates),
      extensions: 'base',
      radius: '100',
    });
    const result = object(data.regeocode),
      component = object(result.addressComponent);
    if (typeof result.formatted_address !== 'string' || !result.formatted_address.trim())
      throw unavailable();
    return {
      placeName: result.formatted_address,
      adcode: typeof component.adcode === 'string' ? component.adcode : '',
      citycode: typeof component.citycode === 'string' ? component.citycode : '',
    };
  }
  async reverse(coordinates: Coordinates) {
    const result = await this.geocode(coordinates);
    if (!/^\d{6}$/.test(result.adcode)) throw unavailable();
    const cityAdcode = ['11', '12', '31', '50'].includes(result.adcode.slice(0, 2))
      ? result.adcode.slice(0, 2) + '0000'
      : result.adcode.slice(0, 4) + '00';
    const found = await this.db.query<{ id: string; adcode: string }>(
      'SELECT id,adcode FROM destinations WHERE adcode=$1 AND level=$2',
      [cityAdcode, 'city'],
    );
    return {
      placeName: result.placeName,
      cityId: found.rows[0]?.id ?? null,
      cityAdcode: found.rows[0]?.adcode ?? null,
      warnings: found.rows.length
        ? []
        : [{ code: 'CITY_NOT_IN_CATALOG', message: '解析到的城市尚未收录，未关联城市。' }],
    };
  }
  async preview(from: Coordinates, to: Coordinates, transportMode: TransportMode) {
    const params: Record<string, string> = { origin: pair(from), destination: pair(to) };
    let data: Record<string, unknown>;
    if (transportMode === 'transit') {
      const [a, b] = await Promise.all([this.geocode(from), this.geocode(to)]);
      if (!a.citycode || !b.citycode) throw unavailable();
      data = await this.request('direction/transit/integrated', {
        ...params,
        city: a.citycode,
        cityd: b.citycode,
      });
    } else data = await this.request(`direction/${transportMode}`, params);
    const route = object(data.route),
      paths = transportMode === 'transit' ? route.transits : route.paths;
    const durations = Array.isArray(paths)
      ? paths
          .map((path) => Number(object(path).duration))
          .filter((v) => Number.isFinite(v) && v > 0 && v <= 604800)
      : [];
    if (!durations.length) throw unavailable();
    return {
      durationMinutes: Math.ceil(Math.min(...durations) / 60),
      source: 'provider' as const,
      warnings: [
        { code: 'ROUTE_TIME_ESTIMATE', message: '路线服务返回预计耗时，实际出行可能变化。' },
      ],
    };
  }
}
