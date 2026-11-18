import { useId, useRef, useState, type FormEvent } from 'react';
import type { BPlaces, TransportMode, Trip } from '@travel/shared';
import TripTransitSteps from './TripTransitSteps';
import './trip-tools.css';

const tools = [
  {
    id: 'stay',
    label: '住宿',
    title: '住宿信息',
    icon: 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6',
  },
  {
    id: 'traffic',
    label: '交通',
    title: '交通信息',
    icon: 'M5 17V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v10H5zM5 12h14m-12 5v3m10-3v3M8 15h.01M16 15h.01',
  },
  {
    id: 'guide',
    label: '攻略',
    title: '出行攻略',
    icon: 'M4 5h5a3 3 0 0 1 3 3v12a4 4 0 0 0-3-2H4zM20 5h-5a3 3 0 0 0-3 3v12a4 4 0 0 1 3-2h5z',
  },
  {
    id: 'share',
    label: '分享',
    title: '分享行程',
    icon: 'M12 16V3m-4 4 4-4 4 4M6 11H4v9h16v-9h-2',
  },
  {
    id: 'packing',
    label: '行李',
    title: '行李清单',
    icon: 'M9 7V4h6v3M5 7h14v13H5zM8 10v7m8-7v7m-9 3v1m10-1v1',
  },
] as const;

type ToolId = (typeof tools)[number]['id'];
interface PackingItem {
  id: string;
  label: string;
  packed: boolean;
}
interface TripNotes {
  stay: { name: string; address: string };
  packing: PackingItem[];
}
interface TrafficLeg {
  id: string;
  label: string;
  duration: string;
  lines: string;
  transitSteps?: BPlaces.TransitStep[];
  navigation: string | null;
}
interface SharedDay {
  date: string;
  stops: { startTime: string; place?: { name: string } }[];
}

function readNotes(key: string): TripNotes {
  const empty = { stay: { name: '', address: '' }, packing: [] };
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<TripNotes> | null;
    return {
      stay: {
        name: typeof value?.stay?.name === 'string' ? value.stay.name : '',
        address: typeof value?.stay?.address === 'string' ? value.stay.address : '',
      },
      packing: Array.isArray(value?.packing)
        ? value.packing.filter(
            (item) =>
              typeof item?.id === 'string' &&
              typeof item.label === 'string' &&
              typeof item.packed === 'boolean',
          )
        : [],
    };
  } catch {
    return empty;
  }
}

function guideUrl(keyword: string) {
  return `https://www.xiaohongshu.com/search_result?${new URLSearchParams({ keyword })}`;
}

export default function TripTools({
  trip,
  cityName,
  guidePlace,
  days,
  trafficScope,
  trafficSummary,
  trafficLegs,
  transportMode,
  onSelectLeg,
  onEdit,
  editDisabled,
}: {
  trip: Trip;
  cityName?: string;
  guidePlace?: string;
  days: SharedDay[];
  trafficScope: string;
  trafficSummary: string;
  trafficLegs: TrafficLeg[];
  transportMode: TransportMode;
  onSelectLeg: (id: string) => void;
  onEdit: () => void;
  editDisabled: boolean;
}) {
  const panelId = useId();
  const buttons = useRef(new Map<ToolId, HTMLButtonElement>());
  const shareField = useRef<HTMLTextAreaElement>(null);
  const key = `suixin:trip-tools:${trip.ownerId}:${trip.id}`;
  const [notes, setNotes] = useState(() => readNotes(key));
  const [stay, setStay] = useState(notes.stay);
  const [packingInput, setPackingInput] = useState('');
  const [active, setActive] = useState<ToolId | null>(null);
  const [feedback, setFeedback] = useState('');

  function closePanel() {
    if (active) buttons.current.get(active)?.focus();
    setActive(null);
    setFeedback('');
  }
  function saveNotes(update: (current: TripNotes) => TripNotes, message = '') {
    try {
      const next = update(readNotes(key));
      localStorage.setItem(key, JSON.stringify(next));
      setNotes(next);
      setFeedback(message);
      return true;
    } catch {
      setFeedback('浏览器暂时无法保存，请重试。');
      return false;
    }
  }
  function saveStay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = { name: stay.name.trim(), address: stay.address.trim() };
    if (saveNotes((current) => ({ ...current, stay: value }), '已保存住宿信息')) setStay(value);
  }
  function addPackingItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = packingInput.trim();
    if (!label) return;
    const item = { id: crypto.randomUUID(), label, packed: false };
    if (saveNotes((current) => ({ ...current, packing: [...current.packing, item] })))
      setPackingInput('');
  }
  const [startDate, endDate] = [trip.planningInput.startDate, trip.planningInput.endDate];
  const shareText = [
    trip.title,
    [cityName, [...new Set([startDate, endDate].filter(Boolean))].join(' 至 ')]
      .filter(Boolean)
      .join(' · '),
    ...days.flatMap((day, index) => [
      '',
      `第 ${index + 1} 天 · ${day.date}`,
      ...(day.stops.length
        ? day.stops.map(({ startTime, place }) => `${startTime} ${place?.name ?? '景点资料不可用'}`)
        : ['自由安排']),
    ]),
  ].join('\n');

  async function copyTrip() {
    try {
      await navigator.clipboard.writeText(shareText);
      setFeedback('已复制行程');
    } catch {
      shareField.current?.focus();
      shareField.current?.select();
      setFeedback('请复制已选中的行程文字。');
    }
  }

  return (
    <aside
      className="trip-detail-tools"
      onKeyDown={(event) => {
        if (active && event.key === 'Escape') {
          event.preventDefault();
          closePanel();
        }
      }}
    >
      <nav className="trip-tools-rail" aria-label="行程工具">
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            ref={(element) => {
              if (element) buttons.current.set(tool.id, element);
              else buttons.current.delete(tool.id);
            }}
            aria-expanded={active === tool.id}
            aria-controls={active === tool.id ? panelId : undefined}
            onClick={() => {
              if (active === tool.id) closePanel();
              else {
                setActive(tool.id);
                setFeedback('');
              }
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={tool.icon} />
            </svg>
            {tool.label}
          </button>
        ))}
      </nav>
      {active && (
        <section className="trip-tools-panel" id={panelId} aria-labelledby={`${panelId}-title`}>
          <header className="trip-tools-heading">
            <h2 id={`${panelId}-title`}>{tools.find((tool) => tool.id === active)?.title}</h2>
            <button type="button" aria-label="关闭工具面板" onClick={closePanel}>
              ×
            </button>
          </header>
          {active === 'stay' && (
            <form className="trip-tools-form" onSubmit={saveStay}>
              <label>
                住宿名称
                <input
                  maxLength={100}
                  value={stay.name}
                  onChange={(event) => setStay({ ...stay, name: event.target.value })}
                />
              </label>
              <label>
                住宿地址
                <input
                  maxLength={200}
                  value={stay.address}
                  onChange={(event) => setStay({ ...stay, address: event.target.value })}
                />
              </label>
              <button type="submit" className="workspace-primary">
                保存住宿
              </button>
              <p className="trip-tool-note">住宿信息保存在当前浏览器。</p>
            </form>
          )}
          {active === 'traffic' && (
            <div className="trip-tools-form">
              <p className="trip-tool-note">{trafficScope}</p>
              <p className="trip-tool-total">{trafficSummary}</p>
              {trafficLegs.length > 0 && (
                <ul className="trip-tool-list">
                  {trafficLegs.map(({ id, label, duration, lines, transitSteps, navigation }) => (
                    <li key={id}>
                      <button
                        type="button"
                        className="trip-tool-leg"
                        onClick={() => {
                          onSelectLeg(id);
                          closePanel();
                        }}
                      >
                        <span>{label}</span>
                        <small>{duration}</small>
                      </button>
                      {lines && <p className="trip-tool-line-names">{lines}</p>}
                      {transportMode === 'transit' && (
                        <details className="trip-tool-transit">
                          <summary>乘车详情</summary>
                          <TripTransitSteps steps={transitSteps} />
                        </details>
                      )}
                      {navigation && (
                        <a
                          className="trip-tool-route-link"
                          href={navigation}
                          target="_blank"
                          rel="noreferrer"
                        >
                          在高德查看{transportMode === 'transit' ? '公交' : ''}路线 ↗
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={onEdit} disabled={editDisabled}>
                编辑交通方式
              </button>
            </div>
          )}
          {active === 'guide' && (
            <div className="trip-tools-form">
              <a
                className="trip-tool-link"
                href={guideUrl(`${cityName ?? '国内'}旅行攻略`)}
                target="_blank"
                rel="noreferrer"
              >
                {cityName ? `${cityName}旅行攻略` : '旅行攻略'} <span aria-hidden="true">↗</span>
              </a>
              {guidePlace && (
                <a
                  className="trip-tool-link"
                  href={guideUrl(`${guidePlace}游玩攻略`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {guidePlace}游玩攻略 <span aria-hidden="true">↗</span>
                </a>
              )}
              <p className="trip-tool-note">在小红书打开搜索结果。</p>
            </div>
          )}
          {active === 'share' && (
            <div className="trip-tools-form">
              <label>
                可复制的已保存行程
                <textarea ref={shareField} readOnly rows={7} value={shareText} />
              </label>
              <button type="button" className="workspace-primary" onClick={() => void copyTrip()}>
                复制行程
              </button>
            </div>
          )}
          {active === 'packing' && (
            <div className="trip-tools-form">
              <form className="trip-packing-add" onSubmit={addPackingItem}>
                <input
                  aria-label="行李物品"
                  placeholder="添加物品"
                  maxLength={100}
                  value={packingInput}
                  onChange={(event) => setPackingInput(event.target.value)}
                />
                <button type="submit" disabled={!packingInput.trim()}>
                  添加
                </button>
              </form>
              {notes.packing.length > 0 && (
                <>
                  <p className="trip-tool-note">
                    已打包 {notes.packing.filter((item) => item.packed).length} /{' '}
                    {notes.packing.length} 件
                  </p>
                  <ul className="trip-tool-list">
                    {notes.packing.map((item) => (
                      <li className="trip-packing-item" key={item.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={item.packed}
                            onChange={(event) => {
                              saveNotes((current) => ({
                                ...current,
                                packing: current.packing.map((entry) =>
                                  entry.id === item.id
                                    ? { ...entry, packed: event.target.checked }
                                    : entry,
                                ),
                              }));
                            }}
                          />
                          <span>{item.label}</span>
                        </label>
                        <button
                          type="button"
                          aria-label={`移除${item.label}`}
                          onClick={() => {
                            saveNotes((current) => ({
                              ...current,
                              packing: current.packing.filter((entry) => entry.id !== item.id),
                            }));
                          }}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="trip-tool-note">清单保存在当前浏览器。</p>
            </div>
          )}
          {feedback && (
            <p className="trip-tools-feedback" role="status">
              {feedback}
            </p>
          )}
        </section>
      )}
    </aside>
  );
}
