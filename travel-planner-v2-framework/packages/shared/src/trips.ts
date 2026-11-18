export type Theme = 'history' | 'nature' | 'landmark' | 'art' | 'family' | 'local';
export type TripPace = 'relaxed' | 'standard' | 'intensive';
export type TransportMode = 'walking' | 'transit' | 'driving';
export interface DraftPlanningInput {
  cityId: string;
  startDate: string | null;
  endDate: string | null;
  themes: Theme[];
  pace: TripPace;
  transportMode: TransportMode;
  selectedPlaceIds: string[];
}
export interface ScheduleItem {
  placeId: string;
  position: number;
  startTime: string;
  durationMinutes: number;
  travelMinutesFromPrevious: number;
  travelTimeSource: 'none' | 'provider' | 'estimate';
  reason: string;
}
export interface ScheduleDay {
  date: string;
  items: ScheduleItem[];
}
export interface Trip {
  id: string;
  ownerId: string;
  title: string;
  revision: number;
  status: 'draft' | 'planned';
  planningInput: DraftPlanningInput;
  days: ScheduleDay[];
  createdAt: string;
  updatedAt: string;
}
export interface CreateTripRequest {
  title: string;
  cityId: string;
}
export interface UpdateTripRequest {
  expectedRevision: number;
  title?: string;
  planningInput?: Partial<Omit<DraftPlanningInput, 'selectedPlaceIds'>>;
  acknowledgeScheduleReset?: boolean;
}
export interface UpdateTripSelectionsRequest {
  expectedRevision: number;
  placeIds: string[];
  acknowledgeScheduleReset?: boolean;
}
export interface TripList {
  items: Trip[];
  page: number;
  pageSize: number;
  total: number;
}
