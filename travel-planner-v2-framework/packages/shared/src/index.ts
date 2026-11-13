export type * from './places.js';
export type * from './recommendations.js';

export interface ApiHealth {
  status: 'ok';
  service: 'travel-planner-api';
}

export interface ApiReady {
  status: 'ready';
  database: 'ok';
}

export interface ApiNotReady {
  status: 'unavailable';
  database: 'not-ready';
}

export type {
  CoordinateSystem,
  CreateFootprintInput,
  FootprintEntry,
  FootprintListPage,
  FootprintMapCity,
  FootprintMapData,
  FootprintMapLocation,
  FootprintMapProvince,
  FootprintMedia,
  FootprintMediaKind,
  FootprintPlaceSearchResult,
} from './footprints.js';

export type { CreateJournalInput, Journal, JournalListPage } from './journals.js';
