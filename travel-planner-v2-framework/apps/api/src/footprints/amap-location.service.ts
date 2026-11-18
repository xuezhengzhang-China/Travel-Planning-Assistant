import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { FootprintPlaceSearchResult } from '@travel/shared' with {
  'resolution-mode': 'import',
};
import { ConfigService } from '../config/config.service';

interface AmapResponse {
  status?: string;
  info?: string;
  pois?: AmapPoi[];
  regeocode?: {
    formatted_address?: string;
    addressComponent?: AmapAddressComponent;
  };
  locations?: string;
}

interface AmapPoi {
  id?: string;
  name?: string;
  address?: string | string[];
  location?: string;
  pname?: string;
  pcode?: string;
  cityname?: string | string[];
  adcode?: string;
}

interface AmapAddressComponent {
  province?: string | string[];
  city?: string | string[];
  adcode?: string;
}

export interface ResolvedFootprintLocation {
  placeName: string | null;
  placeAddress: string | null;
  poiId: string | null;
  longitude: number;
  latitude: number;
  coordinateSystem: 'GCJ-02' | 'WGS-84';
  provinceName: string | null;
  provinceAdcode: string | null;
  cityName: string | null;
  cityAdcode: string | null;
  mapLongitude: number | null;
  mapLatitude: number | null;
}

@Injectable()
export class AmapLocationService {
  private readonly logger = new Logger(AmapLocationService.name);

  constructor(private readonly config: ConfigService) {}

  async searchPlaces(keyword: string): Promise<FootprintPlaceSearchResult[]> {
    const key = this.requireKey();
    const url = new URL('https://restapi.amap.com/v5/place/text');
    url.searchParams.set('key', key);
    url.searchParams.set('keywords', keyword);
    url.searchParams.set('page_size', '10');
    url.searchParams.set('page_num', '1');
    const response = await this.request(url);
    return (response.pois ?? [])
      .map((poi) => this.toSearchResult(poi))
      .filter((result): result is FootprintPlaceSearchResult => result !== null);
  }

  async resolve(
    longitude: number,
    latitude: number,
    coordinateSystem: 'GCJ-02' | 'WGS-84',
    poiId: string | null,
  ): Promise<ResolvedFootprintLocation> {
    if (poiId) {
      const key = this.requireKey();
      const url = new URL('https://restapi.amap.com/v5/place/detail');
      url.searchParams.set('key', key);
      url.searchParams.set('id', poiId);
      const response = await this.request(url);
      const poi = response.pois?.[0];
      const result = poi ? this.toSearchResult(poi) : null;
      if (!result) {
        throw new BadGatewayException('AMap did not return the selected place');
      }
      return {
        placeName: result.name,
        placeAddress: result.address,
        poiId: result.poiId,
        longitude: result.longitude,
        latitude: result.latitude,
        coordinateSystem: 'GCJ-02',
        provinceName: result.provinceName,
        provinceAdcode: result.provinceAdcode,
        cityName: result.cityName,
        cityAdcode: result.cityAdcode,
        mapLongitude: result.longitude,
        mapLatitude: result.latitude,
      };
    }

    if (!this.config.values.amapWebServiceKey) {
      return {
        placeName: null,
        placeAddress: null,
        poiId: null,
        longitude,
        latitude,
        coordinateSystem,
        provinceName: null,
        provinceAdcode: null,
        cityName: null,
        cityAdcode: null,
        mapLongitude: coordinateSystem === 'GCJ-02' ? longitude : null,
        mapLatitude: coordinateSystem === 'GCJ-02' ? latitude : null,
      };
    }

    const [mapLongitude, mapLatitude] =
      coordinateSystem === 'WGS-84'
        ? await this.convertToAmap(longitude, latitude)
        : [longitude, latitude];
    const address = await this.reverseGeocode(mapLongitude, mapLatitude);
    return {
      placeName: null,
      placeAddress: address.formattedAddress,
      poiId: null,
      longitude,
      latitude,
      coordinateSystem,
      provinceName: address.provinceName,
      provinceAdcode: address.provinceAdcode,
      cityName: address.cityName,
      cityAdcode: address.cityAdcode,
      mapLongitude,
      mapLatitude,
    };
  }

  private async convertToAmap(longitude: number, latitude: number): Promise<[number, number]> {
    const url = new URL('https://restapi.amap.com/v3/assistant/coordinate/convert');
    url.searchParams.set('key', this.requireKey());
    url.searchParams.set('locations', `${longitude.toFixed(6)},${latitude.toFixed(6)}`);
    url.searchParams.set('coordsys', 'gps');
    const response = await this.request(url);
    const converted = response.locations?.split(';')[0]?.split(',').map(Number);
    if (
      !converted ||
      converted.length !== 2 ||
      !Number.isFinite(converted[0]) ||
      !Number.isFinite(converted[1])
    ) {
      throw new BadGatewayException('AMap returned an invalid converted coordinate');
    }
    return [converted[0], converted[1]];
  }

  private async reverseGeocode(
    longitude: number,
    latitude: number,
  ): Promise<{
    formattedAddress: string | null;
    provinceName: string | null;
    provinceAdcode: string | null;
    cityName: string | null;
    cityAdcode: string | null;
  }> {
    const url = new URL('https://restapi.amap.com/v3/geocode/regeo');
    url.searchParams.set('key', this.requireKey());
    url.searchParams.set('location', `${longitude},${latitude}`);
    url.searchParams.set('extensions', 'base');
    const response = await this.request(url);
    const components = response.regeocode?.addressComponent;
    const adminAdcode = components?.adcode;
    const provinceName = firstString(components?.province);
    const cityFromResponse = firstString(components?.city);
    const provinceAdcode =
      adminAdcode && /^\d{6}$/.test(adminAdcode) ? `${adminAdcode.slice(0, 2)}0000` : null;
    const cityAdcode =
      adminAdcode && /^\d{6}$/.test(adminAdcode) ? `${adminAdcode.slice(0, 4)}00` : null;
    return {
      formattedAddress: response.regeocode?.formatted_address ?? null,
      provinceName,
      provinceAdcode,
      cityName: cityFromResponse || provinceName,
      cityAdcode: cityFromResponse ? cityAdcode : provinceAdcode,
    };
  }

  private toSearchResult(poi: AmapPoi): FootprintPlaceSearchResult | null {
    if (!poi.id || !poi.name || !poi.location) return null;
    const [longitude, latitude] = poi.location.split(',').map(Number);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
    const regionAdcode = poi.adcode;
    const provinceAdcode =
      poi.pcode && /^\d{6}$/.test(poi.pcode)
        ? poi.pcode
        : regionAdcode && /^\d{6}$/.test(regionAdcode)
          ? `${regionAdcode.slice(0, 2)}0000`
          : null;
    const cityName = firstString(poi.cityname);
    return {
      poiId: poi.id,
      name: poi.name,
      address: Array.isArray(poi.address) ? poi.address.join('') : (poi.address ?? ''),
      longitude,
      latitude,
      provinceName: poi.pname ?? null,
      provinceAdcode,
      cityName: cityName || poi.pname || null,
      cityAdcode:
        regionAdcode && /^\d{6}$/.test(regionAdcode)
          ? `${regionAdcode.slice(0, 4)}00`
          : provinceAdcode,
      coordinateSystem: 'GCJ-02',
    };
  }

  private requireKey(): string {
    const key = this.config.values.amapWebServiceKey;
    if (!key) throw new ServiceUnavailableException('AMap Web Service key is not configured');
    return key;
  }

  private async request(url: URL): Promise<AmapResponse> {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    } catch (error) {
      this.logger.warn(
        `AMap request failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      throw new ServiceUnavailableException('AMap location service is unavailable');
    }
    if (!response.ok) {
      throw new ServiceUnavailableException('AMap location service is unavailable');
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new BadGatewayException('AMap returned an invalid response');
    }
    if (!isRecord(payload)) throw new BadGatewayException('AMap returned an invalid response');
    const amapPayload = payload as AmapResponse;
    if (amapPayload.status !== '1') {
      this.logger.warn(`AMap rejected a request (${amapPayload.info ?? 'unknown provider error'})`);
      throw new ServiceUnavailableException('AMap could not resolve the location');
    }
    if (amapPayload.pois !== undefined && !Array.isArray(amapPayload.pois)) {
      throw new BadGatewayException('AMap returned an invalid place list');
    }
    return amapPayload;
  }
}

function firstString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.find((item) => item.length > 0) ?? null;
  return value || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
