import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicUser, Trip, TripList, Place, Destination } from '@travel/shared';
import { dateRange } from '../../data/planner';
import { normalizeThemes } from '../../data/planner-storage';
import type { PlannerState } from '../../data/planner-storage';
import NewTripPage, { type TripDraftStorage } from './NewTripPage';
import { createRecommendationFlow } from './recommendation-flow';
import { createTripDraftApi, fromServerTrip, type TripDraftApi } from './trip-draft-client';
import { tripErrorMessage } from './trip-errors';
import './trip-workspace.css';
import { APP_NAME } from './branding';
import { notifyHost, tripEntryKey, type TripEntry, type TripHostEvents } from './host-integration';

// 正式软件只需注入当前用户和取 token 的函数；登录页、导航仍由宿主负责。
export interface TripWorkspaceProps extends TripHostEvents {
  user: PublicUser;
  getAccessToken: () => string | null | Promise<string | null>;
  onSignOut?: () => void;
  api?: TripDraftApi;
  embedded?: boolean;
  entry?: TripEntry;
}
function emptyState(cityId: string): PlannerState {
  return {
    draft: {
      cityId,
      startDate: '',
      endDate: '',
      themes: [],
      pace: 'standard',
      transport: 'transit',
      selectedPlaceIds: [],
    },
    trip: null,
  };
}
function validCachedState(value: PlannerState, places: Place[], cityId: string): boolean {
  const ids = new Set(places.map((place) => place.id));
  const validIds = (value: unknown): value is string[] =>
    Array.isArray(value) &&
    new Set(value).size === value.length &&
    value.every((id) => ids.has(id));
  const draft = value?.draft;
  if (
    !draft ||
    draft.cityId !== cityId ||
    typeof draft.startDate !== 'string' ||
    typeof draft.endDate !== 'string' ||
    !validIds(draft.selectedPlaceIds) ||
    !['relaxed', 'standard', 'intensive'].includes(draft.pace) ||
    !['walking', 'transit', 'driving'].includes(draft.transport) ||
    !Array.isArray(draft.themes) ||
    normalizeThemes(draft.themes).length !== draft.themes.length
  )
    return false;
  const trip = value.trip;
  if (trip === null) return true;
  if (
    !trip ||
    typeof trip.title !== 'string' ||
    !Array.isArray(trip.days) ||
    !trip.days.length ||
    !['relaxed', 'standard', 'intensive'].includes(trip.pace) ||
    !['walking', 'transit', 'driving'].includes(trip.transport) ||
    !Array.isArray(trip.themes) ||
    normalizeThemes(trip.themes).length !== trip.themes.length
  )
    return false;
  const dates = dateRange(trip.days[0]?.date ?? '', trip.days.at(-1)?.date ?? '');
  return (
    trip.days.length === dates.length &&
    trip.days.every((day, i) => day.date === dates[i] && validIds(day.placeIds)) &&
    validIds(trip.days.flatMap((day) => day.placeIds))
  );
}

function TripEditor({
  api,
  resource,
  ownerId,
  onBack,
  places,
  city,
  events,
}: {
  api: TripDraftApi;
  resource: Trip | null;
  ownerId: string;
  onBack: () => void;
  places: Place[];
  city: Destination;
  events: TripHostEvents;
}) {
  const [allowReset, setAllowReset] = useState(false);
  const allowed = useRef(false);
  const [flow] = useState(() =>
    createRecommendationFlow(api, resource, {
      acknowledgeScheduleReset: () => allowed.current,
      places,
    }),
  );
  const [initial] = useState(() => {
    const serverState = resource ? fromServerTrip(resource) : emptyState(city.id);
    // 仅恢复同一用户、同一资源和同一版本的未提交输入，不覆盖较新的服务端版本。
    try {
      const cached = JSON.parse(
        sessionStorage.getItem(`travel:editing:${ownerId}:${resource?.id ?? 'new'}`) ?? 'null',
      );
      if (
        cached &&
        cached.revision === (resource?.revision ?? null) &&
        validCachedState(cached.state, places, city.id)
      )
        return cached.state as PlannerState;
    } catch {
      /* 缓存不可用时读取服务端。 */
    }
    return serverState;
  });
  const lastState = useRef(initial);
  const [storage] = useState<TripDraftStorage>(() => ({
    load: () => initial,
    save: (state) => {
      lastState.current = state;
      try {
        const current = flow.getCurrentTrip();
        const cached = JSON.stringify({ revision: current?.revision ?? null, state });
        sessionStorage.setItem(`travel:editing:${ownerId}:${current?.id ?? 'new'}`, cached);
        // 创建成功后不让“新建”缓存再次创建同一份行程。
        if (current) sessionStorage.removeItem(`travel:editing:${ownerId}:new`);
        return true;
      } catch {
        return false;
      }
    },
  }));
  return (
    <NewTripPage
      catalogPlaces={places}
      city={{ id: city.id, name: city.name }}
      initialState={initial}
      initialTitle={resource?.title}
      pageTitle={resource ? '编辑行程' : '新建行程'}
      initialView={initial.trip ? 'trip' : 'wizard'}
      initialSchedule={
        resource &&
        initial.trip &&
        initial.trip.pace === resource.planningInput.pace &&
        initial.trip.transport === resource.planningInput.transportMode &&
        JSON.stringify(initial.trip.days) ===
          JSON.stringify(
            resource.days.map((day) => ({
              date: day.date,
              placeIds: day.items.map((item) => item.placeId),
            })),
          )
          ? resource.days
          : undefined
      }
      storage={storage}
      onBack={onBack}
      resetControl={
        resource?.status === 'planned'
          ? {
              allowed: allowReset,
              onChange: (value) => {
                allowed.current = value;
                setAllowReset(value);
              },
            }
          : undefined
      }
      onSaveDraft={async (input) => {
        try {
          await flow.onSaveDraft(input);
          notifyHost(events.onDraftSaved, flow.getCurrentTrip()!);
        } finally {
          storage.save(lastState.current);
        }
      }}
      onGenerateProposal={async (draft) => {
        try {
          const proposal = await flow.onGenerateProposal(draft);
          notifyHost(events.onDraftSaved, flow.getCurrentTrip()!);
          return proposal;
        } finally {
          storage.save(lastState.current);
        }
      }}
      onComplete={async (result) => {
        try {
          await flow.onComplete(result);
        } catch (error) {
          storage.save(lastState.current);
          throw error;
        }
        const id = flow.getCurrentTrip()!.id;
        notifyHost(events.onSaved, flow.getCurrentTrip()!);
        try {
          sessionStorage.removeItem(`travel:editing:${ownerId}:${id}`);
          sessionStorage.removeItem(`travel:editing:${ownerId}:new`);
        } catch {
          /* 服务端已保存成功，不把缓存清理失败报告为保存失败。 */
        }
      }}
    />
  );
}

export default function TripWorkspace({
  user,
  getAccessToken,
  onSignOut,
  api: suppliedApi,
  embedded = false,
  entry,
  onNavigate,
  onSaved,
  onDraftSaved,
  onDeleted,
}: TripWorkspaceProps) {
  const api = useMemo(
    () => suppliedApi ?? createTripDraftApi({ getAccessToken }),
    [suppliedApi, getAccessToken],
  );
  const [list, setList] = useState<TripList | null>(null);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [city, setCity] = useState<Destination | null>(null);
  const [cityError, setCityError] = useState('');
  const [deletion, setDeletion] = useState<Trip | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [editor, setEditor] = useState<{ resource: Trip | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [entryRetry, setEntryRetry] = useState(0);
  const requestId = useRef(0);
  const requestedEntry = useRef('list');
  const externalEntryKey = entry ? tripEntryKey(entry) : null;
  useEffect(() => {
    let active = true;
    api
      .listCities()
      .then((cities) => {
        if (!active) return;
        if (cities[0]) setCity(cities[0]);
        else setCityError('当前没有可用的城市目录，请先运行 npm run db:seed:b');
      })
      .catch((error) => {
        if (active) setCityError(tripErrorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [api]);
  useEffect(() => {
    if (!externalEntryKey || externalEntryKey === requestedEntry.current) return;
    if (!city) return;
    requestedEntry.current = externalEntryKey;
    const request = ++requestId.current;
    let active = true;
    let finished = false;
    setError('');
    setDeletion(null);
    if (externalEntryKey === 'list') {
      setEditor(null);
      setRefresh((v) => v + 1);
      setOpening(false);
      return;
    }
    setOpening(true);
    setEditor(null);
    const tripId = externalEntryKey.startsWith('edit:') ? externalEntryKey.slice(5) : null;
    Promise.all([api.getPlaces(city.id), tripId ? api.get(tripId) : Promise.resolve(null)])
      .then(([catalog, resource]) => {
        if (!active || request !== requestId.current) return;
        if (resource) {
          fromServerTrip(resource);
          if (
            resource.planningInput.selectedPlaceIds.some((id) => !catalog.some((p) => p.id === id))
          )
            throw new Error('行程景点与当前目录不一致，请核对资料');
        }
        setPlaces(catalog);
        setEditor({ resource });
      })
      .catch((error) => {
        if (active && request === requestId.current) setError(tripErrorMessage(error));
      })
      .finally(() => {
        finished = true;
        if (active && request === requestId.current) setOpening(false);
      });
    return () => {
      active = false;
      // StrictMode会清理并重新执行挂载效果；未完成的请求必须允许下一次效果重试。
      if (!finished && requestedEntry.current === externalEntryKey) requestedEntry.current = '';
    };
  }, [externalEntryKey, api, entryRetry, city]);
  useEffect(() => {
    if (editor || opening || !city) return;
    let active = true;
    setLoading(true);
    setListError('');
    Promise.all([api.list(page), api.getPlaces(city.id)])
      .then(([data, catalog]) => {
        if (active) {
          setList(data);
          setPlaces(catalog);
          if (page > 1 && !data.items.length)
            setPage(Math.max(1, Math.ceil(data.total / data.pageSize)));
        }
      })
      .catch((error) => {
        if (active) setListError(tripErrorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, page, refresh, editor, opening, city]);
  const back = useCallback(() => {
    requestId.current++;
    setEditor(null);
    setError('');
    setOpening(false);
    setRefresh((value) => value + 1);
    requestedEntry.current = 'list';
    notifyHost(onNavigate, { view: 'list' });
  }, [onNavigate]);
  async function open(id: string) {
    const request = ++requestId.current;
    setOpening(true);
    setError('');
    try {
      const resource = await api.get(id);
      fromServerTrip(resource); // 不支持的城市应在列表提示，不让编辑器崩溃。
      if (resource.planningInput.selectedPlaceIds.some((id) => !places?.some((p) => p.id === id)))
        throw new Error('行程包含当前目录中不存在的景点，请先与景点数据负责人核对。');
      if (request === requestId.current) {
        setEditor({ resource });
        requestedEntry.current = `edit:${id}`;
        notifyHost(onNavigate, { view: 'edit', tripId: id });
      }
    } catch (error) {
      if (request === requestId.current) setError(tripErrorMessage(error));
    } finally {
      if (request === requestId.current) setOpening(false);
    }
  }
  async function remove() {
    if (!deletion || deleting) return;
    setDeleting(true);
    setError('');
    try {
      await api.remove(deletion.id, deletion.revision);
      notifyHost(onDeleted, deletion);
      try {
        sessionStorage.removeItem(`travel:editing:${user.id}:${deletion.id}`);
      } catch {
        /* 删除成功不依赖缓存。 */
      }
      setDeletion(null);
      setRefresh((v) => v + 1);
    } catch (error) {
      setError(tripErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  }
  if (opening)
    return (
      <section className={`suixin-trips${embedded ? ' is-embedded' : ''}`}>
        <main className="trip-workspace">
          <p role="status">正在打开行程…</p>
          <button
            onClick={() => {
              setOpening(false);
              back();
            }}
          >
            返回行程列表
          </button>
        </main>
      </section>
    );
  if (editor && places && city)
    return (
      <section className={`suixin-trips${embedded ? ' is-embedded' : ''}`}>
        <TripEditor
          key={editor.resource?.id ?? 'new'}
          api={api}
          resource={editor.resource}
          ownerId={user.id}
          onBack={back}
          places={places}
          city={city}
          events={{ onSaved, onDraftSaved }}
        />
      </section>
    );
  return (
    <section className={`suixin-trips${embedded ? ' is-embedded' : ''}`}>
      <main className="trip-workspace">
        <header>
          <div>
            <p className="workspace-brand">{APP_NAME}</p>
            <p className="workspace-eyebrow">YOUR JOURNEYS</p>
            <h1>我的行程</h1>
          </div>
          <div className="workspace-actions">
            <span>{user.displayName ?? user.email}</span>
            {onSignOut && <button onClick={onSignOut}>退出登录</button>}
          </div>
        </header>
        <div className="workspace-toolbar">
          <p>从一座城市开始，记录每一程。</p>
          <button
            className="workspace-primary"
            disabled={opening || loading || !places || !city || !!deletion}
            onClick={() => {
              requestedEntry.current = 'new';
              setEditor({ resource: null });
              notifyHost(onNavigate, { view: 'new' });
            }}
          >
            ＋ 新建行程
          </button>
        </div>
        {(error || listError || cityError) && (
          <p role="alert" className="workspace-error">
            {[error, listError, cityError].filter(Boolean).join(' ')}
            <button
              disabled={deleting}
              onClick={() => {
                if (error && externalEntryKey && externalEntryKey !== 'list') {
                  requestedEntry.current = '';
                  setEntryRetry((value) => value + 1);
                } else setRefresh((value) => value + 1);
              }}
            >
              {error && externalEntryKey && externalEntryKey !== 'list'
                ? '重试打开行程'
                : '重新读取列表'}
            </button>
          </p>
        )}
        {deletion && (
          <section role="region" aria-labelledby="delete-heading" className="workspace-delete">
            <h2 id="delete-heading">删除“{deletion.title}”？</h2>
            <p>将删除这份行程的选择和每日安排，无法恢复。真实到访记录和手账不会删除。</p>
            <button disabled={deleting} onClick={() => setDeletion(null)}>
              取消
            </button>
            <button className="workspace-danger" disabled={deleting} onClick={() => void remove()}>
              {deleting ? '正在删除…' : '确认删除行程'}
            </button>
          </section>
        )}
        {loading ? (
          <p role="status">正在读取行程…</p>
        ) : (
          <>
            {list?.items.length === 0 && (
              <section className="workspace-empty">还没有行程，创建你的第一份旅行计划。</section>
            )}
            <div className="workspace-list">
              {list?.items.map((trip) => (
                <article key={trip.id} className={`workspace-trip ${trip.status}`}>
                  <span className="workspace-status">
                    {trip.status === 'draft' ? '草稿' : '已规划'} ·{' '}
                    {trip.planningInput.cityId === city?.id ? city?.name : '其他城市'}
                  </span>
                  <h2>{trip.title}</h2>
                  <p>
                    {trip.planningInput.startDate ?? '日期待定'}
                    {trip.planningInput.endDate ? ` — ${trip.planningInput.endDate}` : ''}
                  </p>
                  <span>{trip.planningInput.selectedPlaceIds.length} 个景点</span>
                  <div className="workspace-card-actions">
                    <button
                      disabled={opening || !!deletion}
                      onClick={() => setDeletion(trip)}
                      aria-label={`删除行程${trip.title}`}
                    >
                      删除
                    </button>
                    <button
                      disabled={opening || !places || !!deletion}
                      className="workspace-edit"
                      onClick={() => void open(trip.id)}
                      aria-label={`继续编辑${trip.title}`}
                    >
                      继续编辑 →
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {list && list.total > list.pageSize && (
              <nav className="workspace-pagination" aria-label="行程分页">
                <button disabled={page === 1 || opening} onClick={() => setPage(page - 1)}>
                  上一页
                </button>
                <span>
                  第 {page} 页 / 共 {Math.ceil(list.total / list.pageSize)} 页
                </span>
                <button
                  disabled={page * list.pageSize >= list.total || opening}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </button>
              </nav>
            )}
          </>
        )}
      </main>
    </section>
  );
}
