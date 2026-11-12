import { scheduleGroups } from '@travel/shared/recommendation-engine';
import type { PlanningInput, Trip, RecommendationPlace } from '@travel/shared';
import { listPlaces, beijing } from '../../data/beijing';
import type { PlanningDraft } from '../../data/planner';
import type { TripCreateResult } from './NewTripPage';
import {
  DraftSaveError,
  savePlanningDraft,
  toDraftPlanningInput,
  type TripDraftApi,
} from './trip-draft-client';

// A 注入真实 token 客户端后，可将返回的三个回调直接传给 NewTripPage。
// 闭包保存每次成功返回的资源和版本；异常不自动重建、不覆盖并发修改。
export function createRecommendationFlow(
  api: TripDraftApi,
  initialTrip: Trip | null = null,
  options: { acknowledgeScheduleReset?: () => boolean; places?: RecommendationPlace[] } = {},
) {
  let current = initialTrip;
  let pendingSchedule = false;
  let busy = false;
  async function exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (busy) throw new Error('上一项保存或生成尚未完成，请稍候');
    busy = true;
    try {
      return await action();
    } finally {
      busy = false;
    }
  }
  async function save({ title, draft }: { title: string; draft: PlanningDraft }) {
    try {
      current = await savePlanningDraft(
        api,
        draft,
        title,
        current ?? undefined,
        options.acknowledgeScheduleReset?.() ?? false,
      );
    } catch (error) {
      if (error instanceof DraftSaveError && error.lastSavedTrip) current = error.lastSavedTrip;
      throw error;
    }
  }
  async function generate(draft: PlanningDraft) {
    await save({ title: current?.title ?? '我的北京之旅', draft });
    return api.generateProposal({
      ...toDraftPlanningInput(draft),
      startDate: draft.startDate,
      endDate: draft.endDate,
      selectedPlaceIds: draft.selectedPlaceIds,
    });
  }
  async function complete(result: TripCreateResult) {
    let draftSaved = false;
    const draft: PlanningDraft = {
      cityId: result.cityId,
      ...result.planningInput,
      transport: result.planningInput.transportMode,
    };
    const input: PlanningInput = {
      ...toDraftPlanningInput(draft),
      startDate: draft.startDate,
      endDate: draft.endDate,
      selectedPlaceIds: draft.selectedPlaceIds,
    };
    const plan = scheduleGroups(options.places ?? listPlaces(beijing.id), input, result.trip.days);
    if (plan.unassignedPlaceIds.length) throw new Error('当前安排超出容量，请调整后再保存');
    // 已 planned 只允许修改同一输入的每日安排；变更规划条件需先按契约明确重置。
    if (current?.status === 'planned') {
      const key = (p: Trip['planningInput']) =>
        JSON.stringify([
          p.cityId,
          p.startDate,
          p.endDate,
          [...p.themes].sort(),
          p.pace,
          p.transportMode,
          [...p.selectedPlaceIds].sort(),
        ]);
      if (key(current.planningInput) !== key(input)) {
        if (!options.acknowledgeScheduleReset?.())
          throw new Error('更改日期、偏好或景点前，请勾选允许重新规划');
        await save({ title: result.trip.title, draft });
        draftSaved = true;
      }
    }
    if (current?.status === 'planned') {
      if (current.title !== result.trip.title)
        current = await api.update(current.id, {
          expectedRevision: current.revision,
          title: result.trip.title,
        });
    } else {
      if (!draftSaved) await save({ title: result.trip.title, draft });
      const proposal = await api.generateProposal(input);
      if (proposal.unassignedPlaceIds.length) throw new Error('服务端仍有未安排景点，请重新调整');
      current = await api.applyProposal(current!.id, current!.revision, proposal.proposalId);
      pendingSchedule = true;
    }
    // 读取后仅改标题或直接保存时保留原有时间，不重新计算已保存的安排。
    if (
      !pendingSchedule &&
      JSON.stringify(
        current.days.map((day) => ({
          date: day.date,
          placeIds: day.items.map((item) => item.placeId),
        })),
      ) === JSON.stringify(result.trip.days)
    )
      return;
    current = await api.updateSchedule(current.id, current.revision, plan.days);
    pendingSchedule = false;
  }
  return {
    onSaveDraft: (input: Parameters<typeof save>[0]) => exclusive(() => save(input)),
    onGenerateProposal: (draft: PlanningDraft) => exclusive(() => generate(draft)),
    onComplete: (result: TripCreateResult) => exclusive(() => complete(result)),
    getCurrentTrip: () => current,
  };
}
