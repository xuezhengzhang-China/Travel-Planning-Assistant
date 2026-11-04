import { Injectable } from '@nestjs/common';
import { invalid, notFound } from '../b/errors';
import { enumeration, object, pagination, text, THEMES, uuid } from '../b/validation';
import { PlacesRepository } from './places.repository';

@Injectable()
export class PlacesService {
  constructor(private readonly repository: PlacesRepository) {}

  destinations(value: unknown) {
    const q = object(value, ['level', 'parentId', 'keyword', 'page', 'pageSize']);
    return this.repository.destinations({
      ...pagination(q),
      level: q.level === undefined ? undefined : enumeration(q.level, ['province', 'city']),
      parentId: q.parentId === undefined ? undefined : uuid(q.parentId),
      keyword: q.keyword === undefined ? undefined : text(q.keyword),
    });
  }
  async places(value: unknown) {
    const q = object(value, ['cityId', 'keyword', 'category', 'themes', 'page', 'pageSize']);
    const cityId = uuid(q.cityId);
    await this.getCity(cityId);
    const themes =
      q.themes === undefined
        ? []
        : text(q.themes)
            .split(',')
            .map((v) => enumeration(v, THEMES));
    return this.repository.places({
      ...pagination(q),
      cityId,
      themes: [...new Set(themes)],
      keyword: q.keyword === undefined ? undefined : text(q.keyword),
      category: q.category === undefined ? undefined : enumeration(q.category, THEMES),
    });
  }
  async getCity(id: string) {
    const city = await this.repository.getCity(uuid(id));
    if (!city) invalid('城市不存在或暂不支持');
    return city;
  }
  async getPlace(id: string) {
    const places = await this.repository.getPlaces([uuid(id)]);
    if (!places[0]) notFound();
    return places[0];
  }
  async getSelectedPlaces(cityId: string, ids: string[]) {
    cityId = uuid(cityId);
    ids = ids.map(uuid);
    if (ids.length > 120 || new Set(ids).size !== ids.length) invalid('已选景点过多或重复');
    await this.getCity(cityId);
    const result = await this.repository.getPlaces(ids);
    const byId = new Map(result.map((p) => [p.id, p]));
    return ids.map((id) => {
      const place = byId.get(id);
      if (!place || place.cityId !== cityId) invalid('已选景点不存在或不属于所选城市');
      return place;
    });
  }
  cityForAdminCode(adcode: string) {
    return this.repository.cityForAdminCode(adcode);
  }
  getRouteCityCode(cityId: string) {
    return this.repository.getRouteCityCode(uuid(cityId));
  }
}
