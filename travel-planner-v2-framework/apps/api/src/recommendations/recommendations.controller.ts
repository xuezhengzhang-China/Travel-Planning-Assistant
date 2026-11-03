import { Body, Controller, Get, Param, Post, HttpCode, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JsonBodyPipe, rejectUnknownFields } from '../common/json-body.pipe';
import { ApiError } from '../common/api-error';
import { createInput, patchInput, selectionsInput, uuid } from '../trips/trip-validation';
import type { PlanningInput, PlaceRecommendationInput } from '@travel/shared' with {
  'resolution-mode': 'import',
};
import { RecommendationsService } from './recommendations.service';
export function recommendationInput(body: Record<string, unknown>): PlanningInput {
  rejectUnknownFields(body, [
    'cityId',
    'startDate',
    'endDate',
    'themes',
    'pace',
    'transportMode',
    'selectedPlaceIds',
  ]);
  for (const key of [
    'cityId',
    'startDate',
    'endDate',
    'themes',
    'pace',
    'transportMode',
    'selectedPlaceIds',
  ])
    if (!(key in body)) throw new ApiError('VALIDATION_ERROR', `缺少${key}`, 400);
  const { selectedPlaceIds, ...planning } = body;
  const parsed = patchInput({ expectedRevision: 1, planningInput: planning }).planningInput!;
  const selected = selectionsInput({ expectedRevision: 1, placeIds: selectedPlaceIds }).placeIds;
  if (!parsed.startDate || !parsed.endDate || !selected.length)
    throw new ApiError('VALIDATION_ERROR', '生成方案需要完整日期和至少一个景点', 400);
  return { ...parsed, selectedPlaceIds: selected } as PlanningInput;
}
@Controller('recommendations')
@UseGuards(AuthGuard)
export class RecommendationsController {
  constructor(private readonly service: RecommendationsService) {}
  @Post('places')
  @HttpCode(200)
  places(@Body(new JsonBodyPipe()) body: Record<string, unknown>) {
    rejectUnknownFields(body, ['cityId', 'themes', 'pace']);
    const city = createInput({ title: '推荐', cityId: body.cityId });
    const p = patchInput({
      expectedRevision: 1,
      planningInput: {
        themes: body.themes === undefined ? [] : body.themes,
        pace: body.pace === undefined ? 'standard' : body.pace,
      },
    }).planningInput!;
    return this.service.recommendPlaces({
      cityId: city.cityId,
      themes: p.themes!,
      pace: p.pace!,
    } as PlaceRecommendationInput);
  }
  @Post('itinerary')
  @HttpCode(200)
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new JsonBodyPipe()) body: Record<string, unknown>,
  ) {
    return this.service.generate(user.userId, recommendationInput(body));
  }
  @Get(':id') get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.getOwnedProposal(uuid(id, 'id'), user.userId);
  }
}
