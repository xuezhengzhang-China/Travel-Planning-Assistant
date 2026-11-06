export type Theme = 'history' | 'nature' | 'landmark' | 'art' | 'family' | 'local';
export type TransportMode = 'walking' | 'driving' | 'transit';
export interface Coordinates {
  longitude: number;
  latitude: number;
  coordinateSystem: 'GCJ-02';
}
export interface Destination {
  id: string;
  name: string;
  level: 'province' | 'city';
  parentId: string | null;
  adcode: string;
  timeZone: string;
}
export interface Place {
  id: string;
  cityId: string;
  name: string;
  categories: Theme[];
  address: string;
  coordinates: Coordinates;
  suggestedDurationMinutes: number;
  description: string;
  openingHoursText: string | null;
  source: 'fixture' | 'curated' | 'provider';
  updatedAt: string;
}
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
export interface TravelWarning {
  code: string;
  message: string;
  placeIds?: string[];
}
export interface RoutePreview {
  durationMinutes: number;
  source: 'provider' | 'estimate';
  warnings: TravelWarning[];
}
export interface ReverseLocation {
  placeName: string;
  cityId: string | null;
  cityAdcode: string | null;
  warnings: TravelWarning[];
}
