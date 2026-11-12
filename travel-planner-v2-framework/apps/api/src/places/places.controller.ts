import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { Theme } from '@travel/shared' with { 'resolution-mode': 'import' };
import { AuthGuard } from '../auth/auth.guard';
import { ApiError } from '../common/api-error';
import { rejectUnknownFields } from '../common/json-body.pipe';
import { pagination, uuid } from '../trips/trip-validation';
import { PlacesService } from './c-places.service';
const themes = ['history', 'nature', 'landmark', 'art', 'family', 'local'];
function optionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 100)
    throw new ApiError('VALIDATION_ERROR', '查询参数不合法', 400);
  return value.trim() || undefined;
}
@Controller()
@UseGuards(AuthGuard)
export class PlacesController {
  constructor(private readonly places: PlacesService) {}
  @Get('destinations')
  destinations(@Query() query: Record<string, unknown>) {
    rejectUnknownFields(query, ['level', 'parentId', 'keyword', 'page', 'pageSize']);
    const level = optionalText(query.level);
    if (level && !['province', 'city'].includes(level))
      throw new ApiError('VALIDATION_ERROR', '目的地级别不合法', 400);
    return this.places.destinations({
      level,
      parentId: query.parentId === undefined ? undefined : uuid(query.parentId, 'parentId'),
      keyword: optionalText(query.keyword),
      ...pagination(query.page as string, query.pageSize as string),
    });
  }
  @Get('places')
  list(@Query() query: Record<string, unknown>) {
    rejectUnknownFields(query, ['cityId', 'keyword', 'category', 'themes', 'page', 'pageSize']);
    const selectedThemes = optionalText(query.themes)?.split(',') ?? [];
    if (selectedThemes.some((t) => !themes.includes(t)))
      throw new ApiError('VALIDATION_ERROR', '主题不合法', 400);
    return this.places.places({
      cityId: uuid(query.cityId, 'cityId'),
      keyword: optionalText(query.keyword),
      category: optionalText(query.category),
      themes: [...new Set(selectedThemes)] as Theme[],
      pace: 'standard',
      ...pagination(query.page as string, query.pageSize as string),
    });
  }
  @Get('places/:id')
  get(@Param('id') id: string) {
    return this.places.place(uuid(id, 'id'));
  }
}
