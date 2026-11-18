import { beijing, listPlaces } from './beijing';
const KEY = 'travel-planner:beijing-selection:v1';
export interface SelectionDraft {
  cityId: string;
  selectedPlaceIds: string[];
}
export function loadSelection(): SelectionDraft {
  const empty = { cityId: beijing.id, selectedPlaceIds: [] };
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('cityId' in raw) ||
      raw.cityId !== beijing.id ||
      !('selectedPlaceIds' in raw) ||
      !Array.isArray(raw.selectedPlaceIds)
    )
      return empty;
    const valid = new Set(listPlaces(beijing.id).map((place) => place.id));
    return {
      cityId: beijing.id,
      selectedPlaceIds: [
        ...new Set(
          raw.selectedPlaceIds.filter(
            (id): id is string => typeof id === 'string' && valid.has(id),
          ),
        ),
      ],
    };
  } catch {
    return empty;
  }
}
