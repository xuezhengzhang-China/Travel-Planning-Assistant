import { rankPlaces, generatePlan, scheduleGroups } from '@travel/shared/recommendation-engine';
import type { PlanningInput, Proposal, ScheduleDay } from '@travel/shared';
import { toDraftPlanningInput } from './trip-draft-client';
import { tripErrorMessage } from './trip-errors';
import { useEffect, useRef, useState } from 'react';
import { beijing, listPlaces, type Attraction } from '../../data/beijing';
import {
  dateError,
  dateRange,
  movePlace,
  paceOptions,
  reorderPlace,
  type LocalTrip,
  type PlanningDraft,
} from '../../data/planner';
import { loadPlanner, savePlanner, themes, type PlannerState } from '../../data/planner-storage';
import './trip-create.css';
import { APP_NAME } from './branding';

const defaultPlaces = listPlaces(beijing.id);
const steps = ['目的地', '旅行日期', '旅行偏好', '挑选景点'];
const transports = { walking: '步行', transit: '公共交通', driving: '自驾' };
function Icon({
  name,
  size = 20,
}: {
  name: 'arrow' | 'pin' | 'check' | 'close' | 'calendar' | 'search';
  size?: number;
}) {
  const paths = {
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    check: 'm5 12 4 4L19 6',
    close: 'm6 6 12 12M6 18 18 6',
    calendar: 'M8 2v4m8-4v4M3 10h18M3 4h18v18H3Z',
    search: 'm21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export interface TripCreateResult {
  cityId: string;
  planningInput: {
    startDate: string;
    endDate: string;
    themes: string[];
    pace: PlanningDraft['pace'];
    transportMode: PlanningDraft['transport'];
    selectedPlaceIds: string[];
  };
  trip: LocalTrip;
}
export interface TripDraftStorage {
  load: () => PlannerState;
  save: (state: PlannerState) => boolean;
}
export interface NewTripPageProps {
  onBack: () => void;
  onSaveDraft?: (input: { title: string; draft: PlanningDraft }) => void | Promise<void>;
  onGenerateProposal?: (draft: PlanningDraft) => Promise<Proposal>;
  onComplete?: (result: TripCreateResult) => void | Promise<void>;
  initialState?: PlannerState;
  initialView?: 'wizard' | 'trip';
  storage?: TripDraftStorage;
  initialSchedule?: ScheduleDay[];
  initialTitle?: string;
  pageTitle?: string;
  catalogPlaces?: Attraction[];
  city?: { id: string; name: string };
  resetControl?: { allowed: boolean; onChange: (allowed: boolean) => void };
}
const browserDraftStorage: TripDraftStorage = { load: loadPlanner, save: savePlanner };
export default function NewTripPage({
  onBack,
  onSaveDraft,
  onGenerateProposal,
  onComplete,
  initialState,
  initialView = 'wizard',
  storage = browserDraftStorage,
  initialSchedule,
  initialTitle = '我的旅行',
  pageTitle = '新建行程',
  catalogPlaces = defaultPlaces,
  city = beijing,
  resetControl,
}: NewTripPageProps) {
  const places = catalogPlaces;
  const byId = new Map(places.map((place) => [place.id, place]));
  const [initial] = useState(() => initialState ?? storage.load());
  const [draft, setDraft] = useState(initial.draft);
  const [trip, setTrip] = useState<LocalTrip | null>(initial.trip);
  const [view, setView] = useState<'wizard' | 'trip'>(
    initialView === 'trip' && initial.trip ? 'trip' : 'wizard',
  );
  const [step, setStep] = useState(0);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [titleError, setTitleError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaveMessage, setDraftSaveMessage] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const inputRevision = useRef(0);
  useEffect(() => {
    try {
      setSaved(storage.save({ draft, trip }));
    } catch {
      setSaved(false);
    }
    setSubmitSuccess(false);
  }, [draft, trip, storage]);
  useEffect(() => {
    heading.current?.focus();
  }, [step, view]);
  const dates = dateRange(draft.startDate, draft.endDate);
  async function saveRemoteDraft() {
    if (!onSaveDraft || savingDraft) return;
    setSavingDraft(true);
    setDraftSaveMessage('');
    try {
      await onSaveDraft({
        title: trip?.title.trim() || initialTitle,
        draft: structuredClone(draft),
      });
      setDraftSaveMessage('此次草稿快照已保存到服务器。');
    } catch (error) {
      setDraftSaveMessage(tripErrorMessage(error));
    } finally {
      setSavingDraft(false);
    }
  }
  const pace = paceOptions.find((option) => option.value === draft.pace)!;
  const selected = draft.selectedPlaceIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const totalMinutes = selected.reduce((sum, place) => sum + place.suggestedDurationMinutes, 0);
  const input = {
    ...toDraftPlanningInput(draft),
    startDate: draft.startDate,
    endDate: draft.endDate,
    selectedPlaceIds: draft.selectedPlaceIds,
  } as PlanningInput;
  const rankings = rankPlaces(places, input);
  const rankMap = new Map(rankings.map((item) => [item.placeId, item]));
  const visible = places
    .filter(
      (place) =>
        (category === '全部' || category === place.category) &&
        `${place.name}${place.category}${place.district}${place.address}`.includes(query.trim()),
    )
    .sort(
      (a, b) =>
        (rankMap.get(b.id)?.score ?? 0) - (rankMap.get(a.id)?.score ?? 0) ||
        a.id.localeCompare(b.id),
    );
  function suggestPlaces() {
    if (!dates.length) {
      setError('请先选择有效日期。');
      return;
    }
    const ids = [...draft.selectedPlaceIds];
    for (const candidate of rankings) {
      if (ids.includes(candidate.placeId)) continue;
      const trial = generatePlan(places, {
        ...input,
        selectedPlaceIds: [...ids, candidate.placeId],
      });
      if (!trial.unassignedPlaceIds.length) ids.push(candidate.placeId);
    }
    patch({ selectedPlaceIds: ids });
  }
  function patch(value: Partial<PlanningDraft>) {
    inputRevision.current += 1;
    setDraft((previous) => ({ ...previous, ...value }));
    setError('');
  }
  function toggle(id: string) {
    patch({
      selectedPlaceIds: draft.selectedPlaceIds.includes(id)
        ? draft.selectedPlaceIds.filter((value) => value !== id)
        : [...draft.selectedPlaceIds, id],
    });
  }
  function navigate(next: number) {
    setError('');
    setStep(next);
  }
  async function next() {
    if (generating) return;
    if (step === 1) {
      const message = dateError(draft.startDate, draft.endDate);
      if (message) {
        setError(message);
        return;
      }
    }
    if (step < 3) {
      navigate(step + 1);
      return;
    }
    const message = dateError(draft.startDate, draft.endDate);
    if (message) {
      setError(message);
      return;
    }
    if (!selected.length) {
      setError('请至少选择一个景点，再生成行程。');
      return;
    }
    setGenerating(true);
    setError('');
    const generatingRevision = inputRevision.current;
    try {
      const plan = onGenerateProposal
        ? await onGenerateProposal(structuredClone(draft))
        : generatePlan(places, input);
      if (generatingRevision !== inputRevision.current) {
        setError('规划条件已变化，请按最新选择重新生成。');
        return;
      }
      if (plan.unassignedPlaceIds.length) {
        setError(
          '以下景点无法放入当前日期与节奏：' +
            plan.unassignedPlaceIds.map((id) => byId.get(id)?.name ?? id).join('、') +
            '。请增加天数、调整节奏或减少景点。',
        );
        return;
      }
      setTrip({
        title: trip?.title ?? initialTitle,
        themes: [...draft.themes],
        pace: draft.pace,
        transport: draft.transport,
        days: plan.days.map((day) => ({
          date: day.date,
          placeIds: day.items.map((item) => item.placeId),
        })),
        updatedAt: new Date().toISOString(),
      });
      setView('trip');
    } catch (error) {
      setError(tripErrorMessage(error));
    } finally {
      setGenerating(false);
    }
  }
  function changeDays(days: LocalTrip['days']) {
    setTrip((previous) =>
      previous ? { ...previous, days, updatedAt: new Date().toISOString() } : null,
    );
  }
  function leave() {
    onBack();
  }
  async function complete() {
    if (!trip || submitting) return;
    if (!trip.title.trim()) {
      setSubmitError('请填写行程名称。');
      return;
    }
    if (!trip.days.some((day) => day.placeIds.length)) {
      setSubmitError('请至少保留一个景点。');
      return;
    }
    if (tripPlan?.unassignedPlaceIds.length) {
      setSubmitError('编辑后的安排超出每日容量，请移动或减少景点后保存。');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    setSubmitSuccess(false);
    try {
      if (onComplete)
        await onComplete({
          cityId: city.id,
          planningInput: {
            startDate: trip.days[0]!.date,
            endDate: trip.days.at(-1)!.date,
            themes: trip.themes,
            pace: trip.pace,
            transportMode: trip.transport,
            selectedPlaceIds: trip.days.flatMap((day) => day.placeIds),
          },
          trip,
        });
      else if (!storage.save({ draft, trip })) throw new Error('Local save failed');
      setSubmitSuccess(true);
      if (onComplete) onBack();
    } catch (error) {
      setSubmitError(tripErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }
  const tripPlan = trip
    ? scheduleGroups(
        places,
        {
          ...toDraftPlanningInput({
            ...draft,
            ...trip,
            startDate: trip.days[0]?.date ?? '',
            endDate: trip.days.at(-1)?.date ?? '',
            selectedPlaceIds: trip.days.flatMap((day) => day.placeIds),
          }),
          startDate: trip.days[0]?.date ?? '',
          endDate: trip.days.at(-1)?.date ?? '',
          selectedPlaceIds: trip.days.flatMap((day) => day.placeIds),
        } as PlanningInput,
        trip.days,
      )
    : null;
  const timing = new Map(
    (initialSchedule &&
    initial.trip &&
    trip &&
    JSON.stringify(initial.trip.days) === JSON.stringify(trip.days) &&
    initial.trip.pace === trip.pace &&
    initial.trip.transport === trip.transport
      ? initialSchedule
      : tripPlan?.days
    )?.flatMap((day) => day.items.map((item) => [item.placeId, item] as const)) ?? [],
  );
  const allocated = new Set(trip?.days.flatMap((day) => day.placeIds) ?? []);
  const tripPace = paceOptions.find((option) => option.value === trip?.pace) ?? pace;
  return (
    <div className="trip-create-page">
      <main
        className="page"
        inert={submitting || savingDraft || generating}
        aria-busy={submitting || savingDraft || generating}
      >
        {resetControl && (
          <label className="notice reset-control">
            <input
              type="checkbox"
              checked={resetControl.allowed}
              onChange={(event) => resetControl.onChange(event.target.checked)}
            />
            允许重新规划：更改日期、偏好或景点时，保存会替换原每日安排。仅调整顺序无需勾选。
          </label>
        )}
        {view === 'trip' && (
          <header className="page-nav">
            <button className="icon-button page-return" aria-label="返回行程列表" onClick={leave}>
              <span aria-hidden="true">‹</span>
            </button>
            <div>
              <span className="page-context">{APP_NAME} / 行程</span>
              <h1>{pageTitle}</h1>
            </div>
            <span className="page-badge">
              {city.name} · {places.length} 个景点
            </span>
          </header>
        )}

        {view === 'wizard' ? (
          <section className="planner" aria-label={`创建${city.name}行程`}>
            <div className="wizard-main">
              <header className="wizard-header">
                <div>
                  <small className="wizard-brand">{APP_NAME} · PLAN YOUR JOURNEY</small>
                  <span>{pageTitle}</span>
                </div>
                <button className="icon-button" aria-label="关闭创建流程并保留草稿" onClick={leave}>
                  <Icon name="close" />
                </button>
              </header>
              <nav className="wizard-steps" aria-label="创建步骤">
                <ol className="step-list">
                  {steps.map((label, index) => (
                    <li
                      key={label}
                      className={`${index === step ? 'current' : ''} ${index < step ? 'complete' : ''}`}
                      aria-current={index === step ? 'step' : undefined}
                    >
                      <span className="step-number">
                        {index < step ? <Icon name="check" size={16} /> : index + 1}
                      </span>
                      <div>{label}</div>
                    </li>
                  ))}
                </ol>
              </nav>
              <div className="wizard-body">
                <h2 ref={heading} tabIndex={-1}>
                  {['想去哪里？', '什么时候出发？', '这次，想怎样旅行？', '挑几处心动的风景'][step]}
                </h2>
                <p className="lead">
                  {
                    [
                      '选择城市，查看当地可加入行程的景点。',
                      '按日期建立每日安排，包含出发和返程当天。',
                      '选择兴趣与节奏，让景点清单更贴近你的期待。',
                      '按兴趣优先展示匹配项，你也可以自由探索全部景点。',
                    ][step]
                  }
                </p>
                {step === 0 && (
                  <>
                    <label className="field-label" htmlFor="city">
                      目的地城市
                    </label>
                    <div className="city-field">
                      <Icon name="pin" />
                      <select id="city" value={beijing.id} onChange={() => {}}>
                        <option value={city.id}>{city.name}</option>
                      </select>
                      <span className="pill">{places.length} 个景点</span>
                    </div>
                    <p className="city-choice">
                      <Icon name="check" size={15} />
                      {city.name} · {places.length} 个精选景点
                    </p>
                    <div className="notice">
                      景点地址与行政区来自当前城市目录，可在详情中核对来源。
                    </div>
                  </>
                )}
                {step === 1 && (
                  <>
                    <div className="date-fields">
                      <label className="field-label">
                        <span>
                          <Icon name="calendar" size={18} /> 出发日期
                        </span>
                        <input
                          type="date"
                          value={draft.startDate}
                          aria-invalid={!!error}
                          aria-describedby={error ? 'wizard-error' : undefined}
                          onChange={(event) => patch({ startDate: event.target.value })}
                          onInput={(event) => patch({ startDate: event.currentTarget.value })}
                        />
                      </label>
                      <label className="field-label">
                        <span>
                          <Icon name="calendar" size={18} /> 返程日期
                        </span>
                        <input
                          type="date"
                          value={draft.endDate}
                          min={draft.startDate || undefined}
                          aria-invalid={!!error}
                          aria-describedby={error ? 'wizard-error' : undefined}
                          onChange={(event) => patch({ endDate: event.target.value })}
                          onInput={(event) => patch({ endDate: event.currentTarget.value })}
                        />
                      </label>
                    </div>
                    <div className="date-summary">
                      <span className="summary-number">
                        {dates.length ? String(dates.length).padStart(2, '0') : '—'}
                      </span>
                      <div>
                        <strong>
                          {dates.length ? `天，留给${city.name}和自己` : '选一个适合出发的日子'}
                        </strong>
                        <p>包含出发及返程当天，单次最多 30 天。</p>
                      </div>
                    </div>
                    <div className="notice">
                      生成后会为日期范围中的每一天建立安排；你可以随时移动、增减景点。
                    </div>
                  </>
                )}
                {step === 2 && (
                  <>
                    <fieldset>
                      <legend>
                        你感兴趣的主题 <small>可多选，也可以暂不选择</small>
                      </legend>
                      <div className="theme-options">
                        {themes.map((theme) => (
                          <button
                            key={theme}
                            className={draft.themes.includes(theme) ? 'theme selected' : 'theme'}
                            aria-pressed={draft.themes.includes(theme)}
                            onClick={() =>
                              patch({
                                themes: draft.themes.includes(theme)
                                  ? draft.themes.filter((value) => value !== theme)
                                  : [...draft.themes, theme],
                              })
                            }
                          >
                            {draft.themes.includes(theme) && <Icon name="check" size={16} />}
                            {theme}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend>喜欢怎样的旅行节奏？</legend>
                      <div className="pace-options" role="group" aria-label="旅行节奏">
                        {paceOptions.map((option) => (
                          <button
                            key={option.value}
                            aria-pressed={draft.pace === option.value}
                            className={`pace-card ${draft.pace === option.value ? 'selected' : ''}`}
                            onClick={() => patch({ pace: option.value })}
                          >
                            <strong>{option.name}</strong>
                            <span>{option.description}</span>
                            <small>建议每天约 {option.count} 处</small>
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    <div className="notice">
                      主题影响景点推荐与排序；节奏决定每日数量、出发时间和时间预算。交通预留不代表实时路线。
                    </div>
                  </>
                )}
                {step === 3 && (
                  <>
                    <div className="search">
                      <Icon name="search" />
                      <input
                        type="search"
                        aria-label="搜索景点、分类或行政区"
                        placeholder="搜索景点、分类或行政区…"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                      <span>{visible.length} 个</span>
                    </div>
                    <div className="recommend-actions">
                      <button className="secondary" onClick={suggestPlaces}>
                        按兴趣与天数补充推荐景点
                      </button>
                      <span className="subtle">会保留你已选的景点</span>
                    </div>
                    <div className="filter-row">
                      {['全部', ...new Set(places.map((place) => place.category))].map((value) => (
                        <button
                          key={value}
                          aria-pressed={category === value}
                          className={category === value ? 'filter active' : 'filter'}
                          onClick={() => setCategory(value)}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                    <div className="attraction-layout">
                      <div
                        className="attraction-list"
                        role="region"
                        aria-label="景点列表"
                        tabIndex={0}
                      >
                        {visible.map((place) => (
                          <article
                            className={`attraction ${draft.selectedPlaceIds.includes(place.id) ? 'selected' : ''}`}
                            key={place.id}
                          >
                            <div className="attraction-top">
                              <div>
                                <span className="category-label">
                                  {place.category} · {place.district}
                                </span>
                                <h3>{place.name}</h3>
                              </div>
                              <button
                                className="pick-button"
                                aria-pressed={draft.selectedPlaceIds.includes(place.id)}
                                aria-label={`${draft.selectedPlaceIds.includes(place.id) ? '移除' : '选择'}${place.name}`}
                                onClick={() => toggle(place.id)}
                              >
                                {draft.selectedPlaceIds.includes(place.id) ? (
                                  <Icon name="check" size={18} />
                                ) : (
                                  '+'
                                )}
                              </button>
                            </div>
                            <p className="address">{place.address}</p>
                            <p className="match">{rankMap.get(place.id)?.reasons.join('；')}</p>
                            <div className="attraction-meta">
                              <span>建议 {place.suggestedDurationMinutes} 分钟</span>
                              <a href={place.sourceUrl} target="_blank" rel="noreferrer">
                                官方资料 ↗
                              </a>
                            </div>
                          </article>
                        ))}
                        {!visible.length && (
                          <div className="empty">
                            <h3>暂时没有匹配的景点</h3>
                            <p>换个关键词，或看看全部景点。</p>
                            <button
                              className="secondary"
                              onClick={() => {
                                setQuery('');
                                setCategory('全部');
                              }}
                            >
                              重置筛选
                            </button>
                          </div>
                        )}
                      </div>
                      <aside className="wish-panel">
                        <h3>
                          想去清单 <span>{selected.length}</span>
                        </h3>
                        <label className="field-label" htmlFor="transport">
                          出行方式
                          <select
                            id="transport"
                            value={draft.transport}
                            onChange={(event) =>
                              patch({ transport: event.target.value as PlanningDraft['transport'] })
                            }
                          >
                            {Object.entries(transports).map(([value, name]) => (
                              <option key={value} value={value}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <p className="subtle">
                          {dates.length} 天 · {pace.name}
                          <br />
                          已选景点游玩合计约 {Math.round((totalMinutes / 60) * 10) / 10} 小时
                        </p>
                        {selected.length ? (
                          <>
                            <ol className="wish-list">
                              {selected.map((place) => (
                                <li key={place.id}>
                                  <span>
                                    {place.name}
                                    <small>{place.suggestedDurationMinutes} 分钟</small>
                                  </span>
                                  <button
                                    className="icon-button"
                                    aria-label={`从清单移除${place.name}`}
                                    onClick={() => toggle(place.id)}
                                  >
                                    <Icon name="close" size={15} />
                                  </button>
                                </li>
                              ))}
                            </ol>
                            <button
                              className="text-button"
                              onClick={() => patch({ selectedPlaceIds: [] })}
                            >
                              清空选择
                            </button>
                          </>
                        ) : (
                          <div className="empty compact">
                            你的清单，等待第一份心动。
                            <br />
                            点击景点右侧的 + 添加。
                          </div>
                        )}
                        <p className="subtle">
                          按兴趣、行政区与每日容量安排；远郊长城单独安排一天，交通为规则预留。
                        </p>
                        {(selected.length > dates.length * pace.count ||
                          totalMinutes > dates.length * pace.minutes) && (
                          <p className="warning">当前安排可能较满，建议减少景点或增加天数。</p>
                        )}
                      </aside>
                    </div>
                    <p className="source-note">
                      名称与地址来源于官方名录，部分资料较早；游玩时长为规划估计。出行前请核实开放、预约与入口信息。资料核对：2026-10-30。
                    </p>
                  </>
                )}
                {trip && (
                  <p className="notice">重新生成会替换当前每日安排；关闭向导可保留原安排。</p>
                )}
                {error && (
                  <p id="wizard-error" className="error" role="alert">
                    {error}
                  </p>
                )}
                {draftSaveMessage && (
                  <p className="notice" role="status">
                    {draftSaveMessage}
                  </p>
                )}
              </div>
              <footer className="wizard-footer">
                <button
                  className="back-button"
                  onClick={() => (step === 0 ? leave() : navigate(step - 1))}
                >
                  {step === 0 ? '稍后再说' : '← 上一步'}
                </button>
                <span className={saved ? 'save-status' : 'save-status error'} role="status">
                  {saved ? '草稿已保存至本浏览器' : '本地保存失败，请勿关闭页面'}
                </span>
                {onSaveDraft && (
                  <button
                    className="secondary"
                    disabled={savingDraft}
                    onClick={() => void saveRemoteDraft()}
                  >
                    {savingDraft ? '保存中…' : '保存草稿'}
                  </button>
                )}
                <button className="primary" disabled={generating} onClick={() => void next()}>
                  {step === 3 ? (
                    <>
                      <Icon name="check" size={18} />
                      {generating ? '正在生成…' : '生成推荐行程'}
                    </>
                  ) : (
                    <>
                      下一步
                      <Icon name="arrow" size={18} />
                    </>
                  )}
                </button>
              </footer>
            </div>
          </section>
        ) : (
          trip && (
            <section className="trip-view">
              <header className="trip-header">
                <div>
                  <p className="eyebrow">{APP_NAME} · YOUR JOURNEY</p>
                  <h2 ref={heading} tabIndex={-1}>
                    旅程已展开，留点空间给变化。
                  </h2>
                  <p>
                    {trip.days[0]?.date} — {trip.days.at(-1)?.date} · {trip.days.length} 天 ·{' '}
                    {transports[trip.transport]}
                  </p>
                </div>
                <button
                  className="secondary"
                  onClick={() => {
                    navigate(0);
                    setView('wizard');
                  }}
                >
                  修改规划条件
                </button>
              </header>
              <label className="field-label title-field">
                行程名称
                <input
                  value={trip.title}
                  maxLength={80}
                  onChange={(event) => {
                    setTrip({
                      ...trip,
                      title: event.target.value,
                      updatedAt: new Date().toISOString(),
                    });
                    setTitleError('');
                  }}
                  onBlur={() => {
                    if (!trip.title.trim()) {
                      setTrip({
                        ...trip,
                        title: `我的${city.name}之旅`,
                        updatedAt: new Date().toISOString(),
                      });
                      setTitleError('名称不能为空，已恢复默认名称。');
                    }
                  }}
                />
              </label>
              {titleError && <p role="status">{titleError}</p>}
              <div className="notice">
                可移动日期、调整顺序和增减景点；参考时间会随修改重新计算。
                {onComplete ? '点击保存行程后同步到服务器。' : '更改保存在当前浏览器。'}
              </div>
              <div className="recommendation-warnings">
                {tripPlan?.warnings.map((warning) => (
                  <p className="notice" key={warning.code}>
                    {warning.message}
                  </p>
                ))}
                {tripPlan?.unassignedPlaceIds.length ? (
                  <p className="warning" role="alert">
                    待调整景点：
                    {tripPlan.unassignedPlaceIds.map((id) => byId.get(id)?.name).join('、')}
                  </p>
                ) : null}
              </div>
              <div className="days-grid">
                {trip.days.map((day, dayIndex) => {
                  const minutes = day.placeIds.reduce(
                    (sum, id) => sum + (byId.get(id)?.suggestedDurationMinutes ?? 0),
                    0,
                  );
                  return (
                    <section className="day-card" key={day.date}>
                      <header>
                        <div>
                          <span className="eyebrow">
                            DAY {String(dayIndex + 1).padStart(2, '0')}
                          </span>
                          <h3>{day.date}</h3>
                        </div>
                        <span className="pill">
                          {day.placeIds.length} 处 · {minutes} 分钟
                        </span>
                      </header>
                      {(day.placeIds.length > tripPace.count || minutes > tripPace.minutes) && (
                        <p className="warning">这一天比较满，可将部分景点移到其他日期。</p>
                      )}
                      <ol className="schedule-list">
                        {day.placeIds.map((id, index) => {
                          const place = byId.get(id)!;
                          return (
                            <li key={id}>
                              <div className="schedule-name">
                                <strong>{place.name}</strong>
                                <span>
                                  {timing.get(id)?.startTime ?? '待调整'} · {place.district} ·{' '}
                                  {place.suggestedDurationMinutes} 分钟
                                </span>
                              </div>
                              <div className="schedule-actions">
                                <select
                                  aria-label={`移动${place.name}到日期`}
                                  value={day.date}
                                  onChange={(event) =>
                                    changeDays(movePlace(trip.days, id, event.target.value))
                                  }
                                >
                                  {trip.days.map((target) => (
                                    <option key={target.date} value={target.date}>
                                      {target.date}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  aria-label={`上移${place.name}`}
                                  disabled={index === 0}
                                  onClick={() => changeDays(reorderPlace(trip.days, id, -1))}
                                >
                                  ↑
                                </button>
                                <button
                                  aria-label={`下移${place.name}`}
                                  disabled={index === day.placeIds.length - 1}
                                  onClick={() => changeDays(reorderPlace(trip.days, id, 1))}
                                >
                                  ↓
                                </button>
                                <button
                                  aria-label={`删除${place.name}`}
                                  onClick={() => {
                                    changeDays(
                                      trip.days.map((value) => ({
                                        ...value,
                                        placeIds: value.placeIds.filter(
                                          (placeId) => placeId !== id,
                                        ),
                                      })),
                                    );
                                    patch({
                                      selectedPlaceIds: draft.selectedPlaceIds.filter(
                                        (value) => value !== id,
                                      ),
                                    });
                                  }}
                                >
                                  移除
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                      {!day.placeIds.length && (
                        <p className="empty compact">留白的一天，也可以很精彩。</p>
                      )}
                      <select
                        className="add-place"
                        aria-label={`为${day.date}添加景点`}
                        value=""
                        disabled={allocated.size === places.length}
                        onChange={(event) => {
                          const id = event.target.value;
                          if (!byId.has(id)) return;
                          changeDays(
                            trip.days.map((value) =>
                              value.date === day.date
                                ? { ...value, placeIds: [...value.placeIds, id] }
                                : value,
                            ),
                          );
                          patch({
                            selectedPlaceIds: [...new Set([...draft.selectedPlaceIds, id])],
                          });
                        }}
                      >
                        <option value="">
                          {allocated.size === places.length ? '全部景点已安排' : '＋ 添加一个景点'}
                        </option>
                        {places
                          .filter((place) => !allocated.has(place.id))
                          .map((place) => (
                            <option key={place.id} value={place.id}>
                              {place.name}
                            </option>
                          ))}
                      </select>
                    </section>
                  );
                })}
              </div>
              <div className="submit-feedback" aria-live="polite">
                {submitError && (
                  <p className="error" role="alert">
                    {submitError}
                  </p>
                )}
                {submitSuccess && (
                  <p className="notice">
                    {onComplete ? '行程已提交完成。' : '行程已保存在本浏览器。'}
                  </p>
                )}
              </div>
              <div className="trip-footer">
                <span className={saved ? 'save-status' : 'error'} role="status">
                  {saved
                    ? onComplete
                      ? '✓ 编辑内容已暂存，点击保存后同步服务器'
                      : '✓ 更改已保存在本浏览器 · 不跨设备同步'
                    : '暂存失败，请保留页面'}
                </span>

                <button className="primary" disabled={submitting} onClick={() => void complete()}>
                  {submitting ? '正在保存…' : onComplete ? '保存行程' : '保存至本浏览器'}
                </button>
              </div>
            </section>
          )
        )}
        <footer className="page-footer">
          <span>{APP_NAME} · 行程</span>
          <span>一起出发，记录每一程。</span>
        </footer>
      </main>
    </div>
  );
}
