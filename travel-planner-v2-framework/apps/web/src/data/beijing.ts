import catalog from '@travel/shared/beijing-catalog.json';
export interface City {
  id: string;
  name: string;
  adcode: string;
}
export interface Attraction {
  id: string;
  cityId: string;
  name: string;
  district: string;
  address: string;
  category: string;
  categories: import('@travel/shared').Theme[];
  excursion: boolean;
  suggestedDurationMinutes: number;
  sourceUrl: string;
  verifiedAt: string;
  source: 'curated';
}
export const beijing: City = catalog.city;
export function listCities(): City[] {
  return [beijing];
}
export function listPlaces(cityId: string): Attraction[] {
  return catalog.places.filter((place) => place.cityId === cityId) as Attraction[];
}
