
import { useEffect, useState } from 'react';
import { getApiHealth } from './lib/api';
import TravelJournal from './TravelJournal';
import FootprintMap from './FootprintMap';
import FoldSection from './FoldSection';
import DestinationPicker from './DestinationPicker';
import type { Destination } from './destinations';
import TripPreparation, { ReminderNotifier, TripReminderSummary } from './TripPreparation';

type Tab = 'home' | 'trips' | 'footprints' | 'profile';

// 一条旅行记录的数据结构
type Trip = {
  id: number;
  destination: string;
  destinationRegion?: Destination;
  startDate: string;
  endDate: string;
  theme: string[];
  pace: string;
  transport: string[];
  recommendedSpots: string[];
  spots: string;
  createdAt: string;
  updatedAt: string;
};

// 不同城市的经典推荐景点
const recommendedSpotsByCity: Record<string, string[]> = {
  北京: ['故宫博物院', '天安门广场', '八达岭长城', '颐和园', '天坛公园', '圆明园', '恭王府', '鸟巢/水立方'],
  成都: ['大熊猫繁育研究基地', '宽窄巷子', '锦里古街', '武侯祠', '杜甫草堂', '都江堰', '青城山', '春熙路'],
  杭州: ['西湖', '灵隐寺', '西溪国家湿地公园', '雷峰塔', '断桥残雪', '宋城', '千岛湖', '河坊街'],
  上海: ['外滩', '东方明珠', '豫园', '上海迪士尼乐园', '武康路', '南京路步行街', '上海博物馆', '朱家角古镇'],
  西安: ['秦始皇兵马俑博物馆', '西安城墙', '大雁塔', '陕西历史博物馆', '大唐不夜城', '钟鼓楼', '华清宫', '回民街'],
  重庆: ['洪崖洞', '解放碑', '长江索道', '李子坝轻轨站', '磁器口古镇', '武隆天生三桥', '鹅岭二厂', '南山一棵树'],
  南京: ['中山陵', '夫子庙', '秦淮河', '明孝陵', '总统府', '南京博物院', '玄武湖', '鸡鸣寺'],
  苏州: ['拙政园', '留园', '虎丘', '平江路', '山塘街', '寒山寺', '苏州博物馆', '金鸡湖'],
  广州: ['广州塔', '陈家祠', '沙面', '白云山', '永庆坊', '长隆旅游度假区', '北京路步行街', '广东省博物馆'],
  深圳: ['世界之窗', '深圳湾公园', '莲花山公园', '大梅沙海滨公园', '华侨城创意文化园', '甘坑古镇', '东门老街', '深圳博物馆'],
  厦门: ['鼓浪屿', '厦门大学', '南普陀寺', '环岛路', '沙坡尾', '曾厝垵', '集美学村', '园林植物园'],
};

// 兼容旧数据，并将字符串转换为数组
function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/[、，,；;\n]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

// 城市名片配置
const cityPostcards: Record<
  string,
  {
    symbol: string;
    tagline: string;
    detail: string;
    background: string;
  }
> = {
  北京: {
    symbol: '🏯',
    tagline: '古都风华 · 城市漫游',
    detail: '在胡同与城墙之间，遇见历史。',
    background: 'linear-gradient(135deg, #d9b99b, #f3e5d2)',
  },
  成都: {
    symbol: '🐼',
    tagline: '烟火成都 · 慢享生活',
    detail: '一半是热辣烟火，一半是悠闲时光。',
    background: 'linear-gradient(135deg, #a9c9a4, #e3edcf)',
  },
  杭州: {
    symbol: '🌿',
    tagline: '诗意杭州 · 湖山之间',
    detail: '循着湖光山色，走进江南春意。',
    background: 'linear-gradient(135deg, #a9d2c0, #e4eee0)',
  },
  上海: {
    symbol: '🏙️',
    tagline: '摩登上海 · 流光之城',
    detail: '在城市天际线中，感受现代与经典。',
    background: 'linear-gradient(135deg, #a8c5d9, #e4eaf0)',
  },
  西安: {
    symbol: '🏮',
    tagline: '长安古韵 · 穿越千年',
    detail: '走过城墙街巷，触摸盛世长安。',
    background: 'linear-gradient(135deg, #d9b17e, #f4e5c5)',
  },
  重庆: {
    symbol: '🌉',
    tagline: '山城重庆 · 立体江湖',
    detail: '穿行山城街巷，邂逅两江夜色。',
    background: 'linear-gradient(135deg, #d7a69b, #f0ded2)',
  },
  南京: {
    symbol: '🍂',
    tagline: '金陵旧梦 · 六朝烟雨',
    detail: '在梧桐树影中，感受古都温柔。',
    background: 'linear-gradient(135deg, #c6b69c, #eee5d6)',
  },
  苏州: {
    symbol: '🏡',
    tagline: '水巷江南 · 园林雅韵',
    detail: '小桥流水之间，遇见诗意生活。',
    background: 'linear-gradient(135deg, #a9c9b9, #e2eee3)',
  },
  广州: {
    symbol: '🌺',
    tagline: '活力广州 · 岭南风情',
    detail: '从早茶到骑楼，感受岭南烟火。',
    background: 'linear-gradient(135deg, #e5c39c, #f5e8d2)',
  },
  深圳: {
    symbol: '🌆',
    tagline: '年轻深圳 · 创意之都',
    detail: '在海风与城市活力中探索未来。',
    background: 'linear-gradient(135deg, #9fc6d2, #e0edf0)',
  },
  厦门: {
    symbol: '🌊',
    tagline: '海上花园 · 岛屿慢游',
    detail: '沿着海岸线，收藏一段悠闲时光。',
    background: 'linear-gradient(135deg, #9bcbd0, #e0eeee)',
  },
};

// 根据目的地匹配城市
function getCityPostcard(destination: string) {
  const city = destination.trim().replace(/[市省特别行政区]/g, '');

  const cityName = Object.keys(cityPostcards).find(
    (name) => city.includes(name) || name.includes(city)
  );

  if (cityName) {
    return {
      name: cityName,
      ...cityPostcards[cityName],
    };
  }

  return {
    name: destination || '未知目的地',
    symbol: '✈️',
    tagline: `${destination || '下一站'} · 自在漫游`,
    detail: '把当地街巷与沿途风景，慢慢写进旅程。',
    background: 'linear-gradient(135deg, #c5d5cb, #e8eee4)',
  };
}

// 城市名片组件
function CityPostcard({
  destination,
  compact = false,
}: {
  destination: string;
  compact?: boolean;
}) {
  const city = getCityPostcard(destination);

  return (
    <div
      style={{
        background: city.background,
        borderRadius: compact ? '14px' : '22px',
        minWidth: compact ? '76px' : undefined,
        width: compact ? '76px' : '100%',
        height: compact ? '76px' : '180px',
        padding: compact ? '8px' : '20px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          fontSize: compact ? '28px' : '48px',
          textAlign: compact ? 'center' : 'left',
        }}
      >
        {city.symbol}
      </div>

      {!compact && (
        <div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 700,
              color: '#39483e',
              marginBottom: '6px',
            }}
          >
            {city.name}
          </div>
          <div
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: '#53665a',
              marginBottom: '5px',
            }}
          >
            {city.tagline}
          </div>
          <div style={{ fontSize: '12px', color: '#65756a' }}>
            {city.detail}
          </div>
        </div>
      )}
    </div>
  );
}

const tabs: { id: Tab; icon: string; label: string }[] = [
  { id: 'home', icon: '⌂', label: '旅行助手' },
  { id: 'trips', icon: '▤', label: '行程' },
  { id: 'footprints', icon: '◎', label: '足迹' },
  { id: 'profile', icon: '♡', label: '我的' },
];

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [question, setQuestion] = useState('');
  const [notice, setNotice] = useState('');
  // 行程规划状态
  const [planningStep, setPlanningStep] = useState<number | null>(null);
  // 已创建的行程
  const [trips, setTrips] = useState<Trip[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('wander-trips-v1') || '[]');
      return Array.isArray(saved) ? saved.filter((trip): trip is Trip => trip && typeof trip.id === 'number' && typeof trip.destination === 'string' && typeof trip.startDate === 'string' && typeof trip.endDate === 'string' && Array.isArray(trip.transport) && Array.isArray(trip.theme)).map(trip => ({ ...trip, spots: trip.spots || '', pace: trip.pace || '适中', recommendedSpots: normalizeList(trip.recommendedSpots) })) : [];
    } catch { return []; }
  });
  // 当前正在查看的行程
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  // 当前正在编辑的行程
  const [editingTripId, setEditingTripId] = useState<number | null>(null);
  const [destination, setDestination] = useState('');
  const [destinationRegion, setDestinationRegion] = useState<Destination | undefined>();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [tripTheme, setTripTheme] = useState<string[]>(['城市漫步']);
  const [tripPace, setTripPace] = useState('适中');
  const [transport, setTransport] = useState<string[]>(['公共交通']);
  const [recommendedSpots, setRecommendedSpots] = useState<string[]>([]);
  const [spots, setSpots] = useState('');
  useEffect(() => {
    try { localStorage.setItem('wander-trips-v1', JSON.stringify(trips)); }
    catch { setNotice('行程暂未保存到浏览器，请检查存储空间。'); }
  }, [trips]);

  // 最近编辑的行程排在最前面
  const sortedTrips = [...trips].sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() -
      new Date(a.updatedAt).getTime()
  );

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function check() {
      try {
        await getApiHealth(controller.signal);
        if (!controller.signal.aborted) setApiStatus('online');
      } catch {
        if (!controller.signal.aborted) setApiStatus('offline');
      } finally {
        if (!controller.signal.aborted) {
          timer = setTimeout(check, 10000);
        }
      }
    }

    void check();

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2200);
  }

  function submitQuestion() {
    if (!question.trim()) {
      showNotice('先写下你想了解的问题吧');
      return;
    }
    showNotice('AI 对话功能将在后续版本接入');
    setQuestion('');
  }

  // 开始规划
  function startPlanning() {
    setDestinationRegion(undefined);
    // 新建行程时，先清空表单
    setDestination('');
    setStartDate('');
    setEndDate('');
    setTripTheme(['城市漫步']);
    setTripPace('适中');
    setTransport(['公共交通']);
    setRecommendedSpots([]);
    setSpots('');

    setSelectedTripId(null);
    setEditingTripId(null);
    setPlanningStep(1);
  }

  // 下一步
  function nextPlanningStep() {
    if (planningStep === 1 && !destination.trim()) {
      showNotice('请先填写旅行目的地');
      return;
    }

    if (planningStep === 2) {
      if (!startDate || !endDate) {
        showNotice('请选择旅行日期');
        return;
      }

      if (endDate < startDate) {
        showNotice('返程日期不能早于出发日期');
        return;
      }
    }

    setPlanningStep((step) => step === null ? 1 : Math.min(step + 1, 5));
  }

  // 上一步
  function previousPlanningStep() {
    if (planningStep === 1) {
      setPlanningStep(null);
    } else {
      setPlanningStep((step) => step === null ? null : step - 1);
    }
  }

  // 完成规划
  function finishPlanning() {
    const now = new Date().toISOString();

    // 找到正在编辑的原行程
    const existingTrip = trips.find(
      (trip) => trip.id === editingTripId
    );

    const tripData: Trip = {
      id: editingTripId ?? Date.now(),
      destination,
      destinationRegion,
      startDate,
      endDate,
      theme: tripTheme,
      pace: tripPace,
      transport,
      recommendedSpots,
      spots,

      // 编辑时保留原创建时间，新建时记录当前时间
      createdAt: existingTrip?.createdAt ?? now,

      // 每次保存都更新修改时间
      updatedAt: now,
    };

    if (editingTripId !== null) {
      setTrips((previousTrips) =>
        previousTrips.map((trip) =>
          trip.id === editingTripId ? tripData : trip
        )
      );

      showNotice('行程修改成功！');
    } else {
      setTrips((previousTrips) => [
        ...previousTrips,
        tripData,
      ]);

      showNotice(`${destination}行程创建成功！`);
    }

    setPlanningStep(null);
    setSelectedTripId(null);
    setEditingTripId(null);

    setDestination('');
    setStartDate('');
    setEndDate('');
    setTripTheme(['城市漫步']);
    setTripPace('适中');
    setTransport(['公共交通']);
    setRecommendedSpots([]);
    setSpots('');
  }

  // 查看行程详情
  function openTrip(tripId: number) {
    setSelectedTripId(tripId);
  }

  // 编辑已有行程
  function editTrip(trip: Trip) {
    setDestinationRegion(trip.destinationRegion);
    setDestination(trip.destination);
    setStartDate(trip.startDate);
    setEndDate(trip.endDate);
    setTripTheme(normalizeList(trip.theme));
    setTripPace(trip.pace);
    setTransport(normalizeList(trip.transport));
    setRecommendedSpots(normalizeList(trip.recommendedSpots));
    setSpots(trip.spots);

    setEditingTripId(trip.id);
    setSelectedTripId(null);
    setPlanningStep(1);
  }

  // 删除行程
  function deleteTrip(tripId: number) {
    setTrips((previousTrips) =>
      previousTrips.filter((trip) => trip.id !== tripId)
    );

    setSelectedTripId(null);
    showNotice('行程已删除');
  }

  return (
    <div className="app-shell">
      <ReminderNotifier trips={trips} />
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">✳</span>
          <span>漫游 <small>WANDER</small></span>
        </div>
        <div className={`connection ${apiStatus}`}>
          <span className="connection-dot" />
          {apiStatus === 'online'
            ? '服务已连接'
            : apiStatus === 'checking'
              ? '连接检查中'
              : '演示模式'}
        </div>
      </header>

      <main className="page-content">
        {activeTab === 'home' && (
          <section className="home-page">
            <div className="greeting">
              <p className="eyebrow">YOUR NEXT JOURNEY STARTS HERE</p>
              <h1>去遇见，<br />世界的另一面。</h1>
              <p className="subheading">每一段旅程，都值得认真期待。</p>
            </div>

            <div className="location-row">
              <div>
                <span className="muted-label">当前探索目的地</span>
                <h2>北京 <span className="location-arrow">⌄</span></h2>
              </div>
              <div className="weather">
                <span>☀</span>
                <div><strong>晴朗</strong><small>适合出门走走</small></div>
              </div>
            </div>

            <section className="map-card">
              <div className="map-art">
                <div className="map-water" />
                <div className="map-road road-one" />
                <div className="map-road road-two" />
                <div className="map-road road-three" />
                <div className="map-park park-one" />
                <div className="map-park park-two" />
                <div className="map-pin pin-one">♥</div>
                <div className="map-pin pin-two">✦</div>
                <div className="map-current"><span /></div>
                <div className="map-label label-one">附近景点</div>
                <div className="map-label label-two">城市漫步</div>
                <div className="map-caption">EXPLORE NEAR YOU</div>
              </div>
              <div className="map-card-footer">
                <div><strong>发现身边的风景</strong><small>探索附近值得去的地方</small></div>
                <button className="round-button" onClick={() => showNotice('地图服务将在后续版本接入')}>↗</button>
              </div>
            </section>

            <section className="assistant-section">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">TRAVEL ASSISTANT</p>
                  <h2>今天想去哪里？</h2>
                </div>
                <span className="assistant-flower">✳</span>
              </div>
              <div className="suggestions">
                {['周末适合去哪里玩？', '帮我规划三天旅行', '推荐一些小众景点'].map((item) => (
                  <button key={item} className="suggestion-chip" onClick={() => setQuestion(item)}>
                    {item} <span>↗</span>
                  </button>
                ))}
              </div>
              <div className="chat-input">
                <input
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') submitQuestion();
                  }}
                  placeholder="告诉我你的旅行想法..."
                />
                <button onClick={submitQuestion} aria-label="发送问题">↑</button>
              </div>
              <p className="input-hint">让灵感成为下一段旅程的起点</p>
            </section>

            <section className="inspiration-section">
              <div className="section-heading">
                <div><p className="eyebrow">GET INSPIRED</p><h2>旅行灵感</h2></div>
                <span className="more-text">探索更多 ↗</span>
              </div>
              <div className="inspiration-card">
                <div className="inspiration-icon">☘</div>
                <div><strong>慢下来，感受一座城市</strong><p>不赶时间，也是一种旅行方式。</p></div>
              </div>
            </section>
          </section>
        )}

        
        {activeTab === 'trips' && (
          <section className="sub-page">
            {selectedTripId !== null ? (
              (() => {
                const trip = trips.find((item) => item.id === selectedTripId);

                if (!trip) return null;

                return (
                  <div className="trip-detail">
                    <button
                      className="planner-back"
                      onClick={() => setSelectedTripId(null)}
                    >
                      ← 返回行程列表
                    </button>

                    <p className="eyebrow">TRIP DETAILS</p>
                    <h1>{trip.destination}之旅</h1>
                    <p className="planner-subtitle">
                      期待每一次出发，也珍藏每一次抵达。
                    </p>

                    <CityPostcard destination={trip.destination} />

                    <FoldSection title="行程信息" hint="日期 / 偏好 / 景点"><div className="trip-detail-card">
                      <div className="detail-destination">
                        <span>旅行目的地</span>
                        <h2>{trip.destination}</h2>
                      </div>

                      <div className="detail-item">
                        <span>旅行日期</span>
                        <strong>{trip.startDate} 至 {trip.endDate}</strong>
                      </div>

                      <div className="detail-item">
                        <span>旅行主题</span>
                        <strong>{trip.theme.join('、')}</strong>
                      </div>

                      <div className="detail-item">
                        <span>旅行节奏</span>
                        <strong>{trip.pace}</strong>
                      </div>

                      <div className="detail-item">
                        <span>交通方式</span>
                        <strong>{trip.transport.join('、')}</strong>
                      </div>

                      <div className="detail-item">
                        <span>心愿景点</span>
                        <strong>{trip.spots.trim() || '暂未填写'}</strong>
                      </div>

                      <p className="trip-created">
                        创建于 {trip.createdAt}
                      </p>
                    </div></FoldSection>
                    <TripPreparation key={`${trip.id}-${trip.updatedAt}`} trip={trip} />

                    <div className="planner-actions">
                      <button
                        className="secondary-button"
                        onClick={() => deleteTrip(trip.id)}
                      >
                        删除行程
                      </button>

                      <button
                        className="primary-button"
                        onClick={() => editTrip(trip)}
                      >
                        编辑行程
                      </button>
                    </div>
                  </div>
                );
              })()
            ) : planningStep === null ? (
              <>
                <p className="eyebrow">YOUR JOURNEYS</p>

                <div className="sub-page-title">
                  <div>
                    <h1>我的行程</h1>
                    <p>把期待，变成一场真实的出发。</p>
                  </div>

                  <button className="primary-button" onClick={startPlanning}>
                    ＋ 新建
                  </button>
                </div>

                <TripReminderSummary trips={trips} onOpen={openTrip} />
                {trips.length === 0 ? (
                  <>
                    <div className="empty-card">
                      <div className="empty-illustration">✈</div>
                      <h2>下一段旅程，正在等待你</h2>
                      <p>
                        规划目的地、旅行日期和喜欢的景点，
                        <br />
                        让我们一起制定专属路线。
                      </p>
                    </div>

                    <div className="tip-card">
                      <span>✦</span>
                      <div>
                        <strong>一点小建议</strong>
                        <p>提前规划行程，也别忘了给旅途留一些自由时间。</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <FoldSection title="我的旅行计划" hint={`${trips.length} 段旅程`}><div className="trip-list">

                    {sortedTrips.map((trip) => (
                      <button
                        key={trip.id}
                        className="trip-list-card"
                        onClick={() => openTrip(trip.id)}
                      >
                        <CityPostcard
                          destination={trip.destination}
                          compact
                        />

                        <div className="trip-list-info">
                          <strong>{trip.destination}之旅</strong>
                          <span>{trip.startDate} — {trip.endDate}</span>
                          <small>{trip.theme} · {trip.pace} · {trip.transport}</small>
                        </div>

                        <span className="trip-list-arrow">›</span>
                      </button>
                    ))}
                  </div></FoldSection>
                )}
              </>
            ) : (
              <>
                <button className="planner-back" onClick={previousPlanningStep}>
                  ← 返回
                </button>

                <div className="planner-heading">
                  <p>PLAN YOUR JOURNEY</p>
                  <h1>
                    {planningStep === 1 && '想去哪里？'}
                    {planningStep === 2 && '什么时候出发？'}
                    {planningStep === 3 && '选择旅行偏好'}
                    {planningStep === 4 && '有什么想去的地方？'}
                    {planningStep === 5 && '你的旅行方案'}
                  </h1>
                  <p className="planner-subtitle">
                    {planningStep === 5
                      ? '确认一下旅行信息，准备开启新的旅程。'
                      : '一点一点填写，让我们一起规划这段旅程。'}
                  </p>
                </div>

                <div className="planner-progress">
                  {[1, 2, 3, 4].map((step) => (
                    <div
                      key={step}
                      className={planningStep >= step ? 'progress-active' : ''}
                    />
                  ))}
                </div>

                <div className="planner-card">
                  {planningStep === 1 && (
                    <div className="planner-field">
                      <DestinationPicker value={destination} onChange={(name, region) => { setDestination(name); setDestinationRegion(region); setRecommendedSpots([]); }} />
                    </div>
                  )}

                  {planningStep === 2 && (
                    <div className="planner-field">
                      <label>出发日期</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                      />

                      <label>返程日期</label>
                      <input
                        type="date"
                        value={endDate}
                        min={startDate || undefined}
                        onChange={(e) => setEndDate(e.target.value)}
                      />
                      <p className="field-hint">
                        选择你的旅行时间，我们会据此安排路线。
                      </p>
                    </div>
                  )}

                  {planningStep === 3 && (
                    <div className="planner-field">
                      <label>你喜欢什么样的旅行？（可多选）</label>

                      <div className="choice-grid">
                        {['城市漫步', '自然风光', '历史文化', '美食探索', '休闲度假', '户外探险'].map((item) => (
                          <button
                            key={item}
                            type="button"
                            className={tripTheme.includes(item) ? 'choice-active' : 'choice-button'}
                            onClick={() =>
                              setTripTheme((current) =>
                                current.includes(item)
                                  ? current.filter((value) => value !== item)
                                  : [...current, item]
                              )
                            }
                          >
                            {tripTheme.includes(item) ? '✓ ' : ''}{item}
                          </button>
                        ))}
                      </div>

                      <label>旅行节奏（单选）</label>

                      <div className="choice-grid">
                        {['轻松', '适中', '紧凑'].map((item) => (
                          <button
                            key={item}
                            type="button"
                            className={tripPace === item ? 'choice-active' : 'choice-button'}
                            onClick={() => setTripPace(item)}
                          >
                            {item}
                          </button>
                        ))}
                      </div>

                      <label>主要交通方式（可多选）</label>

                      <div className="choice-grid">
                        {['公共交通', '火车/高铁', '飞机', '自驾', '步行', '混合出行'].map((item) => (
                          <button
                            key={item}
                            type="button"
                            className={transport.includes(item) ? 'choice-active' : 'choice-button'}
                            onClick={() =>
                              setTransport((current) =>
                                current.includes(item)
                                  ? current.filter((value) => value !== item)
                                  : [...current, item]
                              )
                            }
                          >
                            {transport.includes(item) ? '✓ ' : ''}{item}
                          </button>
                        ))}
                      </div>

                      <p className="field-hint">
                        旅行主题和交通方式可以多选，再次点击已选项即可取消。
                      </p>
                    </div>
                  )}

                  {planningStep === 4 && (
                    <div className="planner-field">
                      <label>经典推荐景点（可多选）</label>

                      <p className="field-hint">
                        根据你的目的地，为你推荐一些经典景点。
                      </p>

                      {(() => {
                        const city = destination.trim().replace(/[市省特别行政区]/g, '');

                        const cityKey = Object.keys(recommendedSpotsByCity).find(
                          (name) => city.includes(name) || name.includes(city)
                        );

                        const options = cityKey
                          ? recommendedSpotsByCity[cityKey]
                          : [];

                        return options.length > 0 ? (
                          <div className="choice-grid">
                            {options.map((item) => (
                              <button
                                key={item}
                                type="button"
                                className={
                                  recommendedSpots.includes(item)
                                    ? 'choice-active'
                                    : 'choice-button'
                                }
                                onClick={() =>
                                  setRecommendedSpots((current) =>
                                    current.includes(item)
                                      ? current.filter((value) => value !== item)
                                      : [...current, item]
                                  )
                                }
                              >
                                {recommendedSpots.includes(item) ? '✓ ' : ''}{item}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="field-hint">
                            暂未配置这个目的地的推荐景点，你可以在下方手动添加。
                          </p>
                        );
                      })()}

                      <label>自定义想去的地方</label>

                      <textarea
                        value={spots}
                        onChange={(e) => setSpots(e.target.value)}
                        placeholder={`例如：朋友推荐的小店、某个展览、当地人常去的街区……
                    可以填写多个地点，用逗号或换行分隔。`}
                      />

                      <p className="field-hint">
                        推荐景点和手动添加的地点可以同时选择。
                      </p>
                    </div>
                  )}

                  {planningStep === 5 && (
                    <div className="trip-preview">
                      <div className="preview-destination">
                        <span>旅行目的地</span>
                        <h2>{destination}</h2>
                      </div>

                      <div className="preview-row">
                        <span>旅行日期</span>
                        <strong>{startDate} 至 {endDate}</strong>
                      </div>

                      <div className="preview-row">
                        <span>旅行主题</span>
                        <strong>{tripTheme.join('、') || '暂未选择'}</strong>
                      </div>

                      <div className="preview-row">
                        <span>旅行节奏</span>
                        <strong>{tripPace}</strong>
                      </div>

                      <div className="preview-row">
                        <span>交通方式</span>
                        <strong>{transport.join('、') || '暂未选择'}</strong>
                      </div>

                      <div className="preview-row">
                        <span>心愿景点</span>
                        <strong>
                          {[...recommendedSpots, ...normalizeList(spots)].join('、') || '交给我们推荐'}
                        </strong>
                      </div>
                    </div>
                  )}
                </div>

                <div className="planner-actions">
                  {planningStep > 1 && (
                    <button
                      className="secondary-button"
                      onClick={previousPlanningStep}
                    >
                      上一步
                    </button>
                  )}

                  {planningStep < 5 ? (
                    <button
                      className="primary-button"
                      onClick={nextPlanningStep}
                    >
                      下一步 →
                    </button>
                  ) : (
                    <button
                      className="primary-button"
                      onClick={finishPlanning}
                    >
                      确认创建
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        )}


        {activeTab === 'footprints' && (
          <section className="sub-page">
            <p className="eyebrow">YOUR TRAVEL MEMORIES</p>
            <div className="sub-page-title"><div><h1>旅行足迹</h1><p>走过的地方，都是生活的礼物。</p></div></div>
            <FoldSection title="旅行地图与足迹" hint="点亮 / 区划 / 回忆"><FootprintMap /></FoldSection>
            <FoldSection title="旅行手账" hint="文字 / 照片 / 视频"><TravelJournal /></FoldSection>
          </section>
        )}

        {activeTab === 'profile' && (
          <section className="sub-page">
            <p className="eyebrow">YOUR SPACE</p>
            <h1 className="profile-title">我的</h1>
            <div className="profile-card">
              <div className="avatar">✿</div>
              <div><h2>旅行者</h2><p>给生活一点探索的勇气</p></div>
              <span className="profile-edit">编辑资料　›</span>
            </div>
            <div className="profile-stats">
              <div><strong>0</strong><span>旅行</span></div>
              <div><strong>0</strong><span>足迹</span></div>
              <div><strong>0</strong><span>收藏</span></div>
            </div>
            <div className="settings-card">
              <h3>偏好设置</h3>
              <button onClick={() => showNotice('个人资料功能即将开放')}><span>♙</span>个人资料<i>›</i></button>
              <button onClick={() => showNotice('账号管理功能即将开放')}><span>⌑</span>账号管理<i>›</i></button>
              <button onClick={() => showNotice('字体设置功能即将开放')}><span>文</span>字体与字号<i>›</i></button>
              <button onClick={() => showNotice('主题设置功能即将开放')}><span>☼</span>主题颜色<i>›</i></button>
            </div>
            <p className="profile-version">WANDER · TRAVEL PLANNER</p>
          </section>
        )}
      </main>

      <nav className="bottom-nav">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`nav-item ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="nav-icon">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

export default App;
