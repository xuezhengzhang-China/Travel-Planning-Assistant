export type * as BPlaces from './b-places.js';
export type * as BRecommendations from './b-recommendations.js';

export interface ApiHealth {
  status: 'ok';
  service: 'travel-planner-api';
}
export type { Coordinates, Destination, Place, PageResult } from './places.js';

export interface ApiReady {
  status: 'ready';
  database: 'ok';
}

export interface ApiNotReady {
  status: 'unavailable';
  database: 'not-ready';
}

export type {
  ApiErrorResponse,
  LoginRequest,
  LoginResponse,
  PublicUser,
  RegisterRequest,
  RegisterResponse,
} from './auth.js';

export type {
  Theme,
  TripPace,
  TransportMode,
  DraftPlanningInput,
  ScheduleItem,
  ScheduleDay,
  Trip,
  CreateTripRequest,
  UpdateTripRequest,
  UpdateTripSelectionsRequest,
  TripList,
} from './trips.js';

export type {
  PlanningInput,
  RecommendationWarning,
  RecommendationPlace,
  RankedPlace,
  PlaceRecommendationInput,
  RecommendationPlan,
  Proposal,
} from './recommendations.js';

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
