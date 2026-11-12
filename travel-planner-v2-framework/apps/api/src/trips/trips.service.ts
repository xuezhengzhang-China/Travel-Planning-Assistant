import { validateSchedule } from '@travel/shared/recommendation-engine';
import { ProposalReader } from '../recommendations/proposal.repository';
import type { PlanningInput, ScheduleDay } from '@travel/shared' with {
  'resolution-mode': 'import',
};
import { Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { TripCatalog } from './trip-catalog';
import { TripRepository } from './trip.repository';
import type {
  Trip,
  CreateTripRequest,
  UpdateTripRequest,
  UpdateTripSelectionsRequest,
} from '@travel/shared' with { 'resolution-mode': 'import' };
@Injectable()
export class TripsService {
  constructor(
    private readonly repository: TripRepository,
    private readonly catalog: TripCatalog,
    private readonly proposals: ProposalReader,
  ) {}
  async create(ownerId: string, input: CreateTripRequest) {
    await this.catalog.assertCityExists(input.cityId);
    return this.repository.create(ownerId, input);
  }
  get(ownerId: string, id: string) {
    return this.repository.get(ownerId, id);
  }
  list(ownerId: string, page: number, pageSize: number) {
    return this.repository.list(ownerId, page, pageSize);
  }
  remove(ownerId: string, id: string, revision: number) {
    return this.repository.remove(ownerId, id, revision);
  }
  update(ownerId: string, id: string, input: UpdateTripRequest) {
    return this.repository.mutate(ownerId, id, input.expectedRevision, async (current) => {
      const next = structuredClone(current);
      if (input.title !== undefined) next.title = input.title;
      if (input.planningInput) {
        const cityId = input.planningInput.cityId ?? current.planningInput.cityId;
        await this.catalog.assertCityExists(cityId);
        next.planningInput = { ...current.planningInput, ...input.planningInput };
        if (cityId !== current.planningInput.cityId) next.planningInput.selectedPlaceIds = [];
      }
      return this.resetIfChanged(current, next, input.acknowledgeScheduleReset);
    });
  }
  selections(ownerId: string, id: string, input: UpdateTripSelectionsRequest) {
    return this.repository.mutate(ownerId, id, input.expectedRevision, async (current) => {
      await this.catalog.assertPlacesBelongToCity(current.planningInput.cityId, input.placeIds);
      const next = structuredClone(current);
      next.planningInput.selectedPlaceIds = [...input.placeIds];
      return this.resetIfChanged(current, next, input.acknowledgeScheduleReset);
    });
  }
  applyProposal(ownerId: string, id: string, expectedRevision: number, proposalId: string) {
    return this.repository.mutate(ownerId, id, expectedRevision, async (current) => {
      if (current.status !== 'draft')
        throw new ApiError('SCHEDULE_RESET_REQUIRED', '请先明确重置已有安排', 409);
      const proposal = await this.proposals.getOwnedProposal(proposalId, ownerId);
      const key = (p: Trip['planningInput']) =>
        JSON.stringify([
          p.cityId,
          p.startDate,
          p.endDate,
          [...p.themes].sort(),
          p.pace,
          p.transportMode,
          p.selectedPlaceIds,
        ]);
      if (key(current.planningInput) !== key(proposal.inputSnapshot))
        throw new ApiError('PROPOSAL_INPUT_MISMATCH', '方案输入与当前草稿不一致，请重新生成', 409);
      if (proposal.unassignedPlaceIds.length)
        throw new ApiError('UNASSIGNED_PLACES', '仍有未安排景点，请增加天数或减少景点', 422, {
          placeIds: proposal.unassignedPlaceIds,
        });
      await this.checkSchedule(current, proposal.days);
      // 目录校验可能耗时，在实际写入前再次核对方案有效期。
      await this.proposals.getOwnedProposal(proposalId, ownerId);
      return { ...current, status: 'planned', days: structuredClone(proposal.days) };
    });
  }
  updateSchedule(ownerId: string, id: string, expectedRevision: number, days: ScheduleDay[]) {
    return this.repository.mutate(ownerId, id, expectedRevision, async (current) => {
      if (current.status !== 'planned')
        throw new ApiError('INVALID_SCHEDULE', '请先确认推荐方案', 422);
      if (days.some((day) => day.items.some((item) => item.travelTimeSource === 'provider')))
        throw new ApiError('INVALID_SCHEDULE', '当前未接路线服务，不能标记为实时交通', 422);
      await this.checkSchedule(current, days);
      return { ...current, days: structuredClone(days) };
    });
  }
  private async checkSchedule(current: Trip, days: ScheduleDay[]) {
    if (!current.planningInput.startDate || !current.planningInput.endDate)
      throw new ApiError('INVALID_SCHEDULE', '缺少完整日期', 422);
    const places = await this.catalog.getCityPlaces(current.planningInput.cityId);
    try {
      validateSchedule(places, current.planningInput as PlanningInput, days);
    } catch {
      throw new ApiError(
        'INVALID_SCHEDULE',
        '安排需覆盖所有已选景点、日期，且顺序/交通/时长满足规则预算',
        422,
      );
    }
  }
  private resetIfChanged(current: Trip, next: Trip, acknowledged?: boolean): Trip {
    const normalize = (trip: Trip) => ({
      ...trip.planningInput,
      themes: [...trip.planningInput.themes].sort(),
    });
    const changed = JSON.stringify(normalize(current)) !== JSON.stringify(normalize(next));
    if (changed && current.status === 'planned') {
      if (!acknowledged)
        throw new ApiError(
          'SCHEDULE_RESET_REQUIRED',
          '修改规划条件将清空每日安排，请明确确认',
          409,
        );
      next.days = [];
      next.status = 'draft';
    }
    return next;
  }
}
