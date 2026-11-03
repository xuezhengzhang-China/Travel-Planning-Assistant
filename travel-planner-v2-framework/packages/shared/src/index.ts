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
