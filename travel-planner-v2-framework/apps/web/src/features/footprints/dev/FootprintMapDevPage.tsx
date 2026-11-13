import { useMemo, useState } from 'react';
import type { Coordinates, FootprintMapCity, FootprintMapLocation } from '@travel/shared';
import FootprintMap from '../FootprintMap';
import './footprint-map-dev.css';

/**
 * D 的固定数据宿主页，仅开发使用：用来在 A 接手页面前验证地图组件的
 * 数据、选中、坐标拾取与各种异常状态。不请求真实 API，也不写入任何数据。
 */
const fixedCities: FootprintMapCity[] = [
  {
    cityAdcode: '110100',
    cityName: '北京市',
    provinceAdcode: '110000',
    provinceName: '北京市',
    locationCount: 1,
    checkInCount: 2,
  },
  {
    cityAdcode: '310100',
    cityName: '上海市',
    provinceAdcode: '310000',
    provinceName: '上海市',
    locationCount: 2,
    checkInCount: 3,
  },
  {
    cityAdcode: '330100',
    cityName: '杭州市',
    provinceAdcode: '330000',
    provinceName: '浙江省',
    locationCount: 1,
    checkInCount: 1,
  },
  {
    cityAdcode: '510100',
    cityName: '成都市',
    provinceAdcode: '510000',
    provinceName: '四川省',
    locationCount: 1,
    checkInCount: 1,
  },
  {
    cityAdcode: '440100',
    cityName: '广州市',
    provinceAdcode: '440000',
    provinceName: '广东省',
    locationCount: 1,
    checkInCount: 1,
  },
];

const fixedMarkers: FootprintMapLocation[] = [
  {
    locationId: 'loc-beijing-palace',
    poiId: 'B000A8UIN8',
    placeName: '故宫博物院',
    longitude: 116.3972,
    latitude: 39.9163,
    coordinateSystem: 'GCJ-02',
    provinceAdcode: '110000',
    provinceName: '北京市',
    cityAdcode: '110100',
    cityName: '北京市',
    checkInCount: 2,
  },
  {
    locationId: 'loc-shanghai-bund',
    poiId: 'B000A8UIN9',
    placeName: '外滩',
    longitude: 121.4909,
    latitude: 31.2397,
    coordinateSystem: 'GCJ-02',
    provinceAdcode: '310000',
    provinceName: '上海市',
    cityAdcode: '310100',
    cityName: '上海市',
    checkInCount: 2,
  },
  {
    locationId: 'loc-hangzhou-westlake',
    poiId: 'B000A8UINA',
    placeName: '西湖',
    longitude: 120.1499,
    latitude: 30.247,
    coordinateSystem: 'GCJ-02',
    provinceAdcode: '330000',
    provinceName: '浙江省',
    cityAdcode: '330100',
    cityName: '杭州市',
    checkInCount: 1,
  },
  {
    locationId: 'loc-chengdu-kuanzhai',
    poiId: 'B000A8UINB',
    placeName: '宽窄巷子',
    longitude: 104.0555,
    latitude: 30.6636,
    coordinateSystem: 'GCJ-02',
    provinceAdcode: '510000',
    provinceName: '四川省',
    cityAdcode: '510100',
    cityName: '成都市',
    checkInCount: 1,
  },
  {
    locationId: 'loc-guangzhou-tower',
    poiId: 'B000A8UINC',
    placeName: '广州塔',
    longitude: 113.3245,
    latitude: 23.1066,
    coordinateSystem: 'GCJ-02',
    provinceAdcode: '440000',
    provinceName: '广东省',
    cityAdcode: '440100',
    cityName: '广州市',
    checkInCount: 1,
  },
  // 只有原始坐标、没有服务端转换结果的位置：验证“不画到底图但仍保留记录”。
  {
    locationId: 'loc-unknown-wgs84',
    poiId: null,
    placeName: null,
    longitude: 103.8236,
    latitude: 36.0581,
    coordinateSystem: 'WGS-84',
    provinceAdcode: null,
    provinceName: null,
    cityAdcode: null,
    cityName: null,
    checkInCount: 1,
  },
];

type DemoState = 'normal' | 'loading' | 'error' | 'empty';

const demoStateLabels: Record<DemoState, string> = {
  normal: '正常数据',
  loading: '加载中',
  error: '请求失败',
  empty: '空数据',
};

/** 允许用 URL 参数直接打开某个状态，方便截图与回归：?state=error&sdk=off&select=loc-… */
function initialSearch(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function initialDemoState(): DemoState {
  const value = initialSearch().get('state');
  return value === 'loading' || value === 'error' || value === 'empty' ? value : 'normal';
}

export default function FootprintMapDevPage() {
  const [demoState, setDemoState] = useState<DemoState>(initialDemoState);
  const [disableSdk, setDisableSdk] = useState(() => initialSearch().get('sdk') === 'off');
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    initialSearch().get('select'),
  );
  const [log, setLog] = useState<string[]>([]);

  const markers = useMemo(() => (demoState === 'empty' ? [] : fixedMarkers), [demoState]);
  const litCities = demoState === 'empty' ? [] : fixedCities;

  function appendLog(message: string) {
    setLog((entries) =>
      [
        `${new Date().toLocaleTimeString('zh-CN', { hour12: false })} · ${message}`,
        ...entries,
      ].slice(0, 8),
    );
  }

  function handleSelect(locationId: string) {
    setSelectedId(locationId);
    const location = fixedMarkers.find((item) => item.locationId === locationId);
    appendLog(`选中位置：${location?.placeName ?? locationId}`);
  }

  function handlePick(coordinates: Coordinates) {
    appendLog(
      `拾取坐标：${coordinates.longitude.toFixed(5)}, ${coordinates.latitude.toFixed(5)}（${coordinates.coordinateSystem}）`,
    );
  }

  return (
    <div className="dev-shell">
      <header className="dev-header">
        <p className="dev-eyebrow">D · FOOTPRINT MAP DEV HOST</p>
        <h1>足迹地图组件开发页</h1>
        <p>
          固定数据，只验证组件本身：数据渲染、选中回调、坐标拾取、加载/错误/空态与地图 SDK
          不可用时的降级。真实接口在 A 的页面里接入。
        </p>
      </header>

      <section className="dev-controls" aria-label="演示状态开关">
        <fieldset>
          <legend>数据状态</legend>
          {(Object.keys(demoStateLabels) as DemoState[]).map((state) => (
            <label key={state}>
              <input
                type="radio"
                name="demo-state"
                checked={demoState === state}
                onChange={() => {
                  setDemoState(state);
                  appendLog(`切换到数据状态：${demoStateLabels[state]}`);
                }}
              />
              {demoStateLabels[state]}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>地图 SDK</legend>
          <label>
            <input
              type="checkbox"
              checked={disableSdk}
              onChange={(event) => {
                setDisableSdk(event.target.checked);
                appendLog(event.target.checked ? '禁用地图 SDK' : '启用地图 SDK');
              }}
            />
            禁用地图 SDK（验证降级）
          </label>
        </fieldset>
        <button type="button" onClick={() => setSelectedId(null)}>
          清除选中
        </button>
      </section>

      <FootprintMap
        markers={markers}
        litCities={litCities}
        selectedVisitedPlaceId={selectedId}
        loading={demoState === 'loading'}
        errorMessage={demoState === 'error' ? '示例错误：地图数据请求失败，请稍后重试。' : null}
        onSelectVisitedPlace={handleSelect}
        onPickLocation={handlePick}
        disableMapSdk={disableSdk}
      />

      <section className="dev-log" aria-labelledby="dev-log-title">
        <h2 id="dev-log-title">回调记录</h2>
        {log.length === 0 ? (
          <p>还没有回调；点击上面的标记或地图空白处试试。</p>
        ) : (
          <ol>
            {log.map((entry, index) => (
              <li key={`${entry}-${index}`}>{entry}</li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
