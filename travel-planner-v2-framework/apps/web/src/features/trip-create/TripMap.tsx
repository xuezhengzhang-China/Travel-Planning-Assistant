import { useEffect, useRef, useState } from 'react';
import { isMapConfigured, loadAmap } from '../footprints/map-adapter';

type Point = [number, number];
type Amap = Awaited<ReturnType<typeof loadAmap>>;

export interface TripPin {
  id: string;
  number: number;
  label: string;
  position: Point;
  color: string;
}

export interface TripLine {
  id: string;
  color: string;
  paths: Point[][];
}

export default function TripMap({
  pins,
  lines,
  selected,
  selectedLine,
  onSelect,
  onSelectLine,
  onOverview,
}: {
  pins: TripPin[];
  lines: TripLine[];
  selected: string | null;
  selectedLine: string | null;
  onSelect: (id: string, trigger: HTMLButtonElement) => void;
  onSelectLine: (id: string) => void;
  onOverview: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const liveMap = useRef<InstanceType<Amap['Map']> | null>(null);
  const labels = useRef(new Map<string, HTMLButtonElement>());
  const markers = useRef<InstanceType<Amap['Marker']>[]>([]);
  const polylines = useRef<{ id: string; overlay: InstanceType<Amap['Polyline']> }[]>([]);
  const [instance, setInstance] = useState<{ sdk: Amap; map: InstanceType<Amap['Map']> } | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [overviewRequest, setOverviewRequest] = useState(0);
  const configured = isMapConfigured();
  const hasActiveLine = lines.some(({ id }) => id === selectedLine);

  useEffect(() => {
    const element = container.current;
    if (!configured || !element) return;
    let active = true;
    void loadAmap()
      .then((sdk) => {
        if (!active) return;
        const map = new sdk.Map(element, { viewMode: '2D', zoom: 12, resizeEnable: true });
        liveMap.current = map;
        setInstance({ sdk, map });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      liveMap.current?.destroy();
      liveMap.current = null;
    };
  }, [attempt, configured]);

  useEffect(() => {
    if (!instance || instance.map !== liveMap.current) return;
    const { sdk, map } = instance;
    const overlays = pins.map(({ id, number, label, position, color }) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'trip-map-pin';
      element.style.backgroundColor = color;
      element.textContent = String(number);
      element.title = label;
      element.setAttribute('aria-label', label);
      element.addEventListener('click', () => onSelect(id, element));
      labels.current.set(id, element);
      return new sdk.Marker({ position, content: element, anchor: 'center', map });
    });
    markers.current = overlays;
    return () => {
      labels.current.clear();
      markers.current = [];
      if (map === liveMap.current) overlays.forEach((marker) => marker.setMap(null));
    };
  }, [instance, pins, onSelect]);

  useEffect(() => {
    if (!instance || instance.map !== liveMap.current) return;
    const { sdk, map } = instance;
    const overlays = lines.flatMap(({ id, paths, color }) =>
      paths.map((path) => {
        const highlighted = selectedLine === id;
        const overlay = new sdk.Polyline({
          path,
          map,
          strokeColor: highlighted ? '#bd5616' : color,
          strokeWeight: highlighted ? 8 : 5,
          strokeOpacity: selectedLine && !highlighted ? 0.35 : 0.9,
          zIndex: highlighted ? 60 : 50,
          cursor: 'pointer',
        });
        overlay.on('click', () => onSelectLine(id));
        return { id, overlay };
      }),
    );
    polylines.current = overlays;
    return () => {
      polylines.current = [];
      if (map === liveMap.current) overlays.forEach(({ overlay }) => overlay.setMap(null));
    };
  }, [instance, lines, selectedLine, onSelectLine]);

  useEffect(() => {
    if (!instance || instance.map !== liveMap.current) return;
    for (const [id, element] of labels.current)
      element.setAttribute('aria-pressed', String(id === selected));
  }, [instance, pins, selected]);

  useEffect(() => {
    if (!instance || instance.map !== liveMap.current) return;
    const pin = pins.find((item) => item.id === selected);
    if (pin) {
      instance.map.setZoomAndCenter(15, pin.position, true);
      return;
    }
    if (selectedLine) {
      if (hasActiveLine) {
        const overlays = polylines.current
          .filter(({ id }) => id === selectedLine)
          .map(({ overlay }) => overlay);
        instance.map.setFitView(overlays, true, [45, 45, 45, 45], 16);
      }
      return;
    }
    if (pins.length > 1) {
      instance.map.setFitView(
        [...markers.current, ...polylines.current.map(({ overlay }) => overlay)],
        true,
        [48, 48, 48, 48],
        16,
      );
    } else if (pins[0]) {
      instance.map.setZoomAndCenter(15, pins[0].position, true);
    }
  }, [instance, pins, hasActiveLine, selected, selectedLine, overviewRequest]);

  if (!configured) return <p className="trip-map-status">配置高德浏览器 Key 后可查看底图。</p>;
  return (
    <div className="trip-map-shell">
      <div
        ref={container}
        className="trip-map-canvas"
        role="region"
        aria-label="行程路线地图"
        hidden={failed}
      />
      {instance && !failed && (
        <button
          type="button"
          className="trip-map-overview"
          onClick={() => {
            onOverview();
            setOverviewRequest((value) => value + 1);
          }}
        >
          {pins.length === 1 ? '回到景点' : '路线全览'}
        </button>
      )}
      {failed && (
        <div className="trip-map-status" role="alert">
          <p>高德底图暂时无法加载。</p>
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              setAttempt((value) => value + 1);
            }}
          >
            重试底图
          </button>
        </div>
      )}
      {!instance && !failed && (
        <p className="trip-map-loading" role="status">
          正在加载高德底图…
        </p>
      )}
    </div>
  );
}
