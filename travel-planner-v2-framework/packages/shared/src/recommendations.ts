import type { DraftPlanningInput, ScheduleDay, Theme, TripPace } from './trips.js';
export type PlanningInput = Omit<DraftPlanningInput, 'startDate' | 'endDate'> & {
  startDate: string;
  endDate: string;
};
export interface RecommendationWarning {
  code: string;
  message: string;
  placeIds?: string[];
}
export interface RecommendationPlace {
  id: string;
  cityId: string;
  name: string;
  district: string;
  categories: Theme[];
  suggestedDurationMinutes: number;
  excursion: boolean;
}
export interface RankedPlace {
  placeId: string;
  score: number;
  matchedThemes: Theme[];
  reasons: string[];
}
export interface PlaceRecommendationInput {
  cityId: string;
  themes: Theme[];
  pace: TripPace;
}
export interface RecommendationPlan {
  days: ScheduleDay[];
  unassignedPlaceIds: string[];
  warnings: RecommendationWarning[];
  source: 'rule' | 'llm-assisted';
}
export interface Proposal extends RecommendationPlan {
  proposalId: string;
  inputSnapshot: PlanningInput;
  generatedAt: string;
  expiresAt: string;
}
