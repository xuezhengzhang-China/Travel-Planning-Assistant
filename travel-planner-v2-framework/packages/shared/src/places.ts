import type { RecommendationPlace } from './recommendations.js';
export interface Coordinates {
  longitude: number;
  latitude: number;
  coordinateSystem: 'GCJ-02';
}
export interface Destination {
  id: string;
  name: string;
  adcode: string;
  level: 'province' | 'city';
  parentId: string | null;
}
export interface Place extends RecommendationPlace {
  address: string;
  category: string;
  sourceUrl: string;
  verifiedAt: string;
  source: 'curated';
  coordinates: Coordinates | null;
  openingHours: string | null;
}
export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
