import { beijing, listPlaces } from './beijing';
import { loadSelection } from './selection';
import { dateRange, type PlanningDraft, type LocalTrip } from './planner';
const KEY = 'travel-planner:beijing-planner:v2';
const validIds = new Set(listPlaces(beijing.id).map((place) => place.id));
export const themes = [
  '历史文化',
  '园林自然',
  '城市地标',
  '艺术设计',
  '亲子体验',
  '老街与在地体验',
];
// 旧版将长城单列为主题；迁移到既有 history 主题，景点分类仍保留长城筛选。
export function normalizeThemes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const labels = value.map((theme) => (theme === '长城古迹' ? '历史文化' : theme));
  return themes.filter((theme) => labels.includes(theme));
}
export interface PlannerState {
  draft: PlanningDraft;
  trip: LocalTrip | null;
}
function ids(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && validIds.has(id)))]
    : [];
}
export function loadPlanner(): PlannerState {
  const fallback: PlannerState = {
    draft: {
      cityId: beijing.id,
      startDate: '',
      endDate: '',
      themes: [],
      pace: 'standard',
      transport: 'transit',
      selectedPlaceIds: loadSelection().selectedPlaceIds,
    },
    trip: null,
  };
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('draft' in raw) ||
      !raw.draft ||
      typeof raw.draft !== 'object'
    )
      return fallback;
    const d = raw.draft as Record<string, unknown>;
    if (d.cityId !== beijing.id) return fallback;
    const draft: PlanningDraft = {
      cityId: beijing.id,
      startDate: typeof d.startDate === 'string' ? d.startDate : '',
      endDate: typeof d.endDate === 'string' ? d.endDate : '',
      themes: normalizeThemes(d.themes),
      pace: d.pace === 'relaxed' || d.pace === 'intensive' ? d.pace : 'standard',
      transport: d.transport === 'walking' || d.transport === 'driving' ? d.transport : 'transit',
      selectedPlaceIds: ids(d.selectedPlaceIds),
    };
    let trip: LocalTrip | null = null;
    if ('trip' in raw && raw.trip && typeof raw.trip === 'object') {
      const t = raw.trip as Record<string, unknown>;
      const storedDays = Array.isArray(t.days) ? t.days : [];
      const first = storedDays[0] as { date?: unknown } | undefined;
      const last = storedDays.at(-1) as { date?: unknown } | undefined;
      const dates = dateRange(
        typeof first?.date === 'string' ? first.date : '',
        typeof last?.date === 'string' ? last.date : '',
      );
      if (
        typeof t.title === 'string' &&
        t.title.trim() &&
        Array.isArray(t.days) &&
        dates.length === t.days.length &&
        dates.length > 0
      ) {
        const seen = new Set<string>();
        const days = t.days.map((value: unknown, index: number) => {
          if (
            !value ||
            typeof value !== 'object' ||
            !('date' in value) ||
            value.date !== dates[index] ||
            !('placeIds' in value)
          )
            throw new Error('Invalid day');
          const placeIds = ids(value.placeIds).filter((id) => {
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          });
          return { date: dates[index]!, placeIds };
        });
        if (typeof t.updatedAt === 'string' && Number.isFinite(Date.parse(t.updatedAt)))
          trip = {
            title: t.title.slice(0, 80),
            themes: Array.isArray(t.themes) ? normalizeThemes(t.themes) : draft.themes,
            days,
            updatedAt: t.updatedAt,
            pace: t.pace === 'relaxed' || t.pace === 'intensive' ? t.pace : 'standard',
            transport:
              t.transport === 'walking' || t.transport === 'driving' ? t.transport : 'transit',
          };
      }
    }
    return { draft, trip };
  } catch {
    return fallback;
  }
}
export function savePlanner(state: PlannerState): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
