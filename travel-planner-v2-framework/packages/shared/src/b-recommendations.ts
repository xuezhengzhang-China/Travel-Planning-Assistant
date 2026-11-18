import type { Theme, TransportMode, TravelWarning } from './b-places.js';
export type Pace = 'relaxed' | 'standard' | 'intensive';
export interface PlanningInput {
  cityId: string;
  startDate: string;
  endDate: string;
  themes: Theme[];
  pace: Pace;
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
export type RecommendationWarning = TravelWarning;
export interface Proposal {
  proposalId: string;
  inputSnapshot: PlanningInput;
  generatedAt: string;
  expiresAt: string;
  days: ScheduleDay[];
  unassignedPlaceIds: string[];
  warnings: RecommendationWarning[];
  source: 'rule' | 'llm-assisted';
}
