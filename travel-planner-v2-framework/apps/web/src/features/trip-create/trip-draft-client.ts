import type {
  Proposal,
  PlanningInput,
  PlaceRecommendationInput,
  RankedPlace,
  ScheduleDay,
  Place,
  Destination,
  PageResult,
} from '@travel/shared';
import type {
  CreateTripRequest,
  DraftPlanningInput,
  Trip,
  TripList,
  UpdateTripRequest,
  UpdateTripSelectionsRequest,
} from '@travel/shared';
import type { PlanningDraft } from '../../data/planner';
export interface TripDraftApi {
  listCities(): Promise<Destination[]>;
  getPlaces(cityId: string): Promise<Place[]>;
  remove(id: string, expectedRevision: number): Promise<void>;
  recommendPlaces(
    input: PlaceRecommendationInput,
  ): Promise<{ items: RankedPlace[]; source: 'rule' }>;
  generateProposal(input: PlanningInput): Promise<Proposal>;
  getProposal(id: string): Promise<Proposal>;
  applyProposal(id: string, expectedRevision: number, proposalId: string): Promise<Trip>;
  updateSchedule(id: string, expectedRevision: number, days: ScheduleDay[]): Promise<Trip>;

  create(input: CreateTripRequest): Promise<Trip>;
  get(id: string): Promise<Trip>;
  list(page?: number, pageSize?: number): Promise<TripList>;
  update(id: string, input: UpdateTripRequest): Promise<Trip>;
  setSelections(id: string, input: UpdateTripSelectionsRequest): Promise<Trip>;
}
export class TripApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const themeLabels: Record<string, string> = {
  history: '历史文化',
  nature: '园林自然',
  landmark: '城市地标',
  art: '艺术设计',
  family: '亲子体验',
  local: '老街与在地体验',
};

/**
 * B 的目录只提供主题编码与地址；界面需要中文分类和行政区展示字段。
 * 这里做一次展示层适配，不虚构行政区，缺省为空字符串。
 */
function enrichPlace(place: Place): Place {
  const raw = place as Place & { openingHoursText?: string | null };
  return {
    ...place,
    district: raw.district ?? '',
    category: raw.category ?? themeLabels[raw.categories?.[0] ?? ''] ?? '其他',
    sourceUrl: raw.sourceUrl ?? '',
    verifiedAt: raw.verifiedAt ?? '',
    source: 'curated',
    openingHours: raw.openingHours ?? raw.openingHoursText ?? null,
  };
}
export function createTripDraftApi(options: {
  getAccessToken: () => string | null | Promise<string | null>;
  baseUrl?: string;
  fetcher?: typeof fetch;
}): TripDraftApi {
  const fetcher = options.fetcher ?? fetch;
  const base = (options.baseUrl ?? '/api').replace(/\/$/, '');
  const resource = (id: string) => `/trips/${encodeURIComponent(id)}`;
  async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const token = await options.getAccessToken();
    if (!token) throw new TripApiError(401, 'UNAUTHENTICATED', '请先登录后保存行程');
    const response = await fetcher(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error =
        payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      throw new TripApiError(
        response.status,
        typeof error.code === 'string' ? error.code : 'HTTP_ERROR',
        typeof error.message === 'string' ? error.message : '行程请求失败',
        error.details,
      );
    }
    if (response.status === 204) return undefined as T;
    if (!payload || typeof payload !== 'object')
      throw new TripApiError(502, 'INVALID_RESPONSE', '服务器返回了无效的行程响应');
    return payload as T;
  }
  return {
    listCities: async () => {
      const result = await request<PageResult<Destination>>(
        '/destinations?level=city&page=1&pageSize=100',
      );
      return result.items;
    },
    remove: (id, expectedRevision) =>
      request<void>(`${resource(id)}?expectedRevision=${expectedRevision}`, 'DELETE'),
    getPlaces: async (cityId) => {
      const items: Place[] = [];
      for (let page = 1; ; page++) {
        const result = await request<PageResult<Place>>(
          `/places?cityId=${encodeURIComponent(cityId)}&page=${page}&pageSize=100`,
        );
        items.push(...result.items.map(enrichPlace));
        if (items.length >= result.total || !result.items.length) return items;
      }
    },
    recommendPlaces: (input) => request('/recommendations/places', 'POST', input),
    generateProposal: (input) => request('/recommendations/itinerary', 'POST', input),
    getProposal: (id) => request('/recommendations/' + encodeURIComponent(id)),
    applyProposal: (id, expectedRevision, proposalId) =>
      request(resource(id) + '/apply-proposal', 'POST', { expectedRevision, proposalId }),
    updateSchedule: (id, expectedRevision, days) =>
      request(resource(id) + '/schedule', 'PUT', { expectedRevision, days }),
    create: (input) => request('/trips', 'POST', input),
    get: (id) => request(resource(id)),
    list: (page = 1, pageSize = 20) => request(`/trips?page=${page}&pageSize=${pageSize}`),
    update: (id, input) => request(resource(id), 'PATCH', input),
    setSelections: (id, input) => request(`${resource(id)}/selections`, 'PUT', input),
  };
}
const themeMap: Record<string, DraftPlanningInput['themes'][number]> = {
  历史文化: 'history',
  园林自然: 'nature',
  城市地标: 'landmark',
  艺术设计: 'art',
  老街与在地体验: 'local',
  亲子体验: 'family',
};
export function toDraftPlanningInput(
  draft: PlanningDraft,
): Omit<DraftPlanningInput, 'selectedPlaceIds'> {
  if (draft.themes.some((theme) => !themeMap[theme])) throw new Error('无法映射景点主题');
  return {
    cityId: draft.cityId,
    startDate: draft.startDate || null,
    endDate: draft.endDate || null,
    themes: [...new Set(draft.themes.map((theme) => themeMap[theme]!))].sort(),
    pace: draft.pace,
    transportMode: draft.transport,
  };
}
export class DraftSaveError extends Error {
  constructor(
    readonly lastSavedTrip: Trip | null,
    readonly phase: 'create' | 'planning' | 'selections',
    readonly originalError: unknown,
  ) {
    super('草稿未全部保存，请保留已创建的行程 ID，重新读取后继续保存');
  }
}
// 多个 HTTP 请求不是一个事务；向调用方返回最后成功版本，避免失败后重复新建。
export async function savePlanningDraft(
  api: TripDraftApi,
  draft: PlanningDraft,
  title: string,
  existing?: Trip,
  acknowledgeScheduleReset = false,
): Promise<Trip> {
  const planningInput = toDraftPlanningInput(draft);
  let current: Trip | null = existing ?? null;
  let phase: DraftSaveError['phase'] = 'create';
  try {
    if (!current) current = await api.create({ title, cityId: draft.cityId });
    phase = 'planning';
    current = await api.update(current.id, {
      expectedRevision: current.revision,
      title,
      planningInput,
      acknowledgeScheduleReset,
    });
    phase = 'selections';
    return await api.setSelections(current.id, {
      expectedRevision: current.revision,
      placeIds: draft.selectedPlaceIds,
      acknowledgeScheduleReset,
    });
  } catch (error) {
    throw new DraftSaveError(current, phase, error);
  }
}
// 此入口仅保存输入草稿，不把本地分日结果伪装成服务端 planned 行程。

// 读取服务器 draft 后供 NewTripPage initialState 使用；revision/资源 ID 由调用方持有。
export function fromServerDraft(trip: Trip) {
  if (trip.status !== 'draft') throw new Error('请使用正式行程编辑适配器加载 planned 行程');
  return fromServerTrip(trip);
}
export function fromServerTrip(trip: Trip) {
  const reverse: Record<string, string> = {
    history: '历史文化',
    nature: '园林自然',
    landmark: '城市地标',
    family: '亲子体验',
    art: '艺术设计',
    local: '老街与在地体验',
  };
  if (trip.planningInput.cityId !== '11000000-0000-4000-8000-000000000001')
    throw new Error('当前选择页面仅支持北京');
  if (trip.planningInput.themes.some((theme) => !reverse[theme]))
    throw new Error('当前页面暂不支持此主题，请扩展主题目录后加载');
  return {
    draft: {
      cityId: trip.planningInput.cityId,
      startDate: trip.planningInput.startDate ?? '',
      endDate: trip.planningInput.endDate ?? '',
      themes: trip.planningInput.themes.map((theme) => reverse[theme]!),
      pace: trip.planningInput.pace,
      transport: trip.planningInput.transportMode,
      selectedPlaceIds: [...trip.planningInput.selectedPlaceIds],
    },
    trip:
      trip.status === 'planned'
        ? {
            title: trip.title,
            themes: trip.planningInput.themes.map((theme) => reverse[theme]!),
            pace: trip.planningInput.pace,
            transport: trip.planningInput.transportMode,
            updatedAt: trip.updatedAt,
            days: trip.days.map((day) => ({
              date: day.date,
              placeIds: day.items.map((item) => item.placeId),
            })),
          }
        : null,
  };
}
