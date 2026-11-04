import { HttpException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BConfig } from '../b/config';
import { notFound, unavailable } from '../b/errors';
import type { Proposal, RoutePreview } from '../b/types';
import { planningInput, uuid } from '../b/validation';
import { PlacesService } from '../places/places.service';
import { GeoService, walkingEstimate } from '../integrations/amap/geo.service';
import { ProposalsRepository } from './proposals.repository';
import { planRule, RouteNeeded, routeKey } from './rule-planner';
import { LlmAdvisor } from '../integrations/llm/llm.advisor';

export const B_CLOCK = Symbol('B_CLOCK');
export const B_ID_GENERATOR = Symbol('B_ID_GENERATOR');
export const PROPOSAL_READER = Symbol('PROPOSAL_READER');
export interface ProposalReader {
  getOwnedProposal(proposalId: string, userId: string): Promise<Proposal>;
}
export const systemId = () => randomUUID();

@Injectable()
export class RecommendationsService implements ProposalReader {
  constructor(
    private readonly places: PlacesService,
    private readonly geo: GeoService,
    private readonly proposals: ProposalsRepository,
    private readonly config: BConfig,
    @Inject(B_CLOCK) private readonly now: () => Date,
    @Inject(B_ID_GENERATOR) private readonly id: () => string,
    private readonly advisor: LlmAdvisor,
  ) {}

  async generate(value: unknown, userId: string): Promise<Proposal> {
    const input = planningInput(value);
    uuid(userId);
    const selected = await this.places.getSelectedPlaces(input.cityId, input.selectedPlaceIds);
    const cityCode =
      input.transportMode === 'transit'
        ? await this.places.getRouteCityCode(input.cityId)
        : undefined;
    const routes = new Map<string, RoutePreview | null>();
    const signal = AbortSignal.timeout(this.config.values.generationTimeoutMs);
    let calls = 0;
    const compute = async (candidate: typeof input) => {
      for (;;) {
        if (signal.aborted) unavailable('推荐计算超时，请减少景点后重试');
        try {
          return planRule(candidate, selected, routes);
        } catch (error) {
          if (!(error instanceof RouteNeeded)) throw error;
          let route: RoutePreview | null;
          if (calls >= this.config.values.maxRouteCalls) {
            const estimate =
              input.transportMode === 'walking'
                ? walkingEstimate(error.from.coordinates, error.to.coordinates)
                : null;
            route = estimate;
          } else {
            calls++;
            try {
              route = await this.geo.route(
                error.from.coordinates,
                error.to.coordinates,
                input.transportMode,
                cityCode,
                signal,
              );
            } catch (failure) {
              if (!(failure instanceof HttpException) || failure.getStatus() !== 503) throw failure;
              route = null;
            }
          }
          routes.set(routeKey(error.from.id, error.to.id), route);
        }
      }
    };
    let planned = await compute(input);
    let source: Proposal['source'] = 'rule';
    const suggestion = await this.advisor.suggest(input, selected, signal);
    if (suggestion.warning) planned.warnings.push(suggestion.warning);
    if (
      suggestion.order &&
      suggestion.order.some((id, index) => id !== input.selectedPlaceIds[index])
    ) {
      try {
        const candidate = await compute({ ...input, selectedPlaceIds: suggestion.order });
        const travel = (plan: typeof planned) =>
          plan.days
            .flatMap((d) => d.items)
            .reduce((sum, item) => sum + item.travelMinutesFromPrevious, 0);
        if (
          candidate.unassignedPlaceIds.length < planned.unassignedPlaceIds.length ||
          (candidate.unassignedPlaceIds.length === planned.unassignedPlaceIds.length &&
            travel(candidate) < travel(planned))
        ) {
          planned = candidate;
          source = 'llm-assisted';
        }
      } catch {
        planned.warnings.push({
          code: 'MODEL_FALLBACK',
          message: '模型建议无法生成更可靠的安排，已保留规则方案。',
        });
      }
    }
    const generated = this.now();
    const proposal: Proposal = {
      proposalId: this.id(),
      inputSnapshot: structuredClone(input),
      generatedAt: generated.toISOString(),
      expiresAt: new Date(
        generated.getTime() + this.config.values.proposalTtlMinutes * 60000,
      ).toISOString(),
      ...planned,
      source,
    };
    await this.proposals.save(userId, proposal);
    return proposal;
  }
  async getOwnedProposal(proposalId: string, userId: string): Promise<Proposal> {
    const proposal = await this.proposals.getOwned(uuid(proposalId), uuid(userId));
    if (!proposal) notFound();
    // C checks expiry only after ownership, and rechecks at final trip commit.
    return structuredClone(proposal);
  }
}
export function isProposalExpired(proposal: Proposal, now: Date): boolean {
  return now.getTime() >= Date.parse(proposal.expiresAt);
}
