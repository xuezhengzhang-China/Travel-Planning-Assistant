import type { BPlaces, BRecommendations } from '@travel/shared' with {
  'resolution-mode': 'import',
};

export type Theme = BPlaces.Theme;
export type TransportMode = BPlaces.TransportMode;
export type Coordinates = BPlaces.Coordinates;
export type Destination = BPlaces.Destination;
export type Place = BPlaces.Place;
export type Page<T> = BPlaces.Page<T>;
export type ApiError = BPlaces.ApiError;
export type TravelWarning = BPlaces.TravelWarning;
export type RoutePreview = BPlaces.RoutePreview;
export type ReverseLocation = BPlaces.ReverseLocation;
export type Pace = BRecommendations.Pace;
export type PlanningInput = BRecommendations.PlanningInput;
export type ScheduleItem = BRecommendations.ScheduleItem;
export type ScheduleDay = BRecommendations.ScheduleDay;
export type RecommendationWarning = BRecommendations.RecommendationWarning;
export type Proposal = BRecommendations.Proposal;
