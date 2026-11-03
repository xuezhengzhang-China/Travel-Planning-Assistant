import { Injectable } from '@nestjs/common';
import { generatePlan, rankPlaces, validateSchedule } from '@travel/shared/recommendation-engine';
import type { PlanningInput, PlaceRecommendationInput, Proposal } from '@travel/shared' with {
  'resolution-mode': 'import',
};
import { TripCatalog } from '../trips/trip-catalog';
import { ApiError } from '../common/api-error';
import {
  ProposalReader,
  ProposalRepository,
  RecommendationClock,
  proposalId,
} from './proposal.repository';
@Injectable()
export class RecommendationsService extends ProposalReader {
  constructor(
    private readonly repository: ProposalRepository,
    private readonly catalog: TripCatalog,
    private readonly clock: RecommendationClock,
  ) {
    super();
  }
  async recommendPlaces(input: PlaceRecommendationInput) {
    await this.catalog.assertCityExists(input.cityId);
    return {
      items: rankPlaces(await this.catalog.getCityPlaces(input.cityId), input),
      source: 'rule' as const,
    };
  }
  async generate(userId: string, input: PlanningInput): Promise<Proposal> {
    await this.catalog.assertPlacesBelongToCity(input.cityId, input.selectedPlaceIds);
    const places = await this.catalog.getCityPlaces(input.cityId);
    const plan = generatePlan(places, input);
    if (!plan.unassignedPlaceIds.length) validateSchedule(places, input, plan.days);
    const now = this.clock.now();
    const proposal: Proposal = {
      ...plan,
      proposalId: proposalId(),
      inputSnapshot: structuredClone(input),
      generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
    };
    await this.repository.save(userId, proposal);
    return proposal;
  }
  override async getOwnedProposal(id: string, userId: string): Promise<Proposal> {
    const proposal = await this.repository.getOwned(id, userId);
    if (!proposal) throw new ApiError('NOT_FOUND', '推荐方案不存在', 404);
    if (Date.parse(proposal.expiresAt) <= this.clock.now().getTime())
      throw new ApiError('PROPOSAL_EXPIRED', '推荐方案已过期，请重新生成', 410);
    return proposal;
  }
}
