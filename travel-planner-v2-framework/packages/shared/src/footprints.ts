export type CoordinateSystem = 'GCJ-02' | 'WGS-84';
export type FootprintMediaKind = 'photo' | 'video';

export interface FootprintMedia {
  id: string;
  kind: FootprintMediaKind;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface FootprintEntry {
  id: string;
  text: string | null;
  placeName: string | null;
  placeAddress: string | null;
  poiId: string | null;
  longitude: number;
  latitude: number;
  coordinateSystem: CoordinateSystem;
  mapLongitude: number | null;
  mapLatitude: number | null;
  provinceName: string | null;
  provinceAdcode: string | null;
  cityName: string | null;
  cityAdcode: string | null;
  recordedOn: string;
  /** 该足迹附带的媒体（图片/视频），按 position 排序，最多 100 个。 */
  media: FootprintMedia[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateFootprintInput {
  text?: string;
  poiId?: string;
  longitude: number;
  latitude: number;
  coordinateSystem: CoordinateSystem;
  recordedOn: string;
}

export interface FootprintListPage {
  items: FootprintEntry[];
  page: number;
  pageSize: number;
  total: number;
}

export interface FootprintPlaceSearchResult {
  poiId: string;
  name: string;
  address: string;
  longitude: number;
  latitude: number;
  provinceName: string | null;
  provinceAdcode: string | null;
  cityName: string | null;
  cityAdcode: string | null;
  coordinateSystem: 'GCJ-02';
}

export interface FootprintMapLocation {
  locationId: string;
  poiId: string | null;
  placeName: string | null;
  longitude: number;
  latitude: number;
  coordinateSystem: CoordinateSystem;
  provinceAdcode: string | null;
  provinceName: string | null;
  cityAdcode: string | null;
  cityName: string | null;
  checkInCount: number;
}

export interface FootprintMapProvince {
  provinceAdcode: string;
  provinceName: string;
  cityCount: number;
  locationCount: number;
  checkInCount: number;
}

export interface FootprintMapCity {
  cityAdcode: string;
  cityName: string;
  provinceAdcode: string;
  provinceName: string;
  locationCount: number;
  checkInCount: number;
}

export interface FootprintMapData {
  summary: {
    provinceCount: number;
    cityCount: number;
    locationCount: number;
    checkInCount: number;
  };
  provinces: FootprintMapProvince[];
  cities: FootprintMapCity[];
  locations: FootprintMapLocation[];
}

/** 手账图片的元数据；文件本体走认证的 GET /media/:id，不在 JSON 里暴露路径。 */
export interface MediaAsset {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}
