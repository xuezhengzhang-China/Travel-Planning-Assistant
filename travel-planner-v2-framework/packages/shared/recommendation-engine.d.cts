import type {
  PlanningInput,
  RecommendationPlace,
  RankedPlace,
  RecommendationPlan,
  PlaceRecommendationInput,
} from './src/recommendations.js' with { 'resolution-mode': 'import' };
import type { ScheduleDay } from './src/trips.js' with { 'resolution-mode': 'import' };
export const paceSettings: Record<
  'relaxed' | 'standard' | 'intensive',
  { start: number; budget: number; count: number; rest: number }
>;
export function rankPlaces(
  places: RecommendationPlace[],
  input: PlaceRecommendationInput,
): RankedPlace[];
export function generatePlan(
  places: RecommendationPlace[],
  input: PlanningInput,
): RecommendationPlan;
export function scheduleGroups(
  places: RecommendationPlace[],
  input: PlanningInput,
  groups: { date: string; placeIds: string[] }[],
): RecommendationPlan;
export function validateSchedule(
  places: RecommendationPlace[],
  input: PlanningInput,
  days: ScheduleDay[],
): void;
