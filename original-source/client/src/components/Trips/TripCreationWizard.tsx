import type { AttractionGuide, TripCreateRequest } from '@trek/shared';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  MapPin,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { accommodationsApi, assignmentsApi, daysApi, mapsApi, placesApi, reservationsApi } from '../../api/client';
import Modal from '../shared/Modal';
import { useToast } from '../shared/Toast';
import { estimateTravelMinutes, findCandidatePoiOrders, optimizePoiOrder, scheduleDay, type PlannerPoi } from './tripSchedule';
import {
  DEFAULT_TRIP_PREFERENCES,
  PACE_OPTIONS,
  TRIP_INTERESTS,
  rankAttractions,
  type InterestId,
  type TripPreferences,
} from './tripPreferences';

type Poi = {
  id: string;
  name?: string;
  address?: string;
  lat?: number;
  lng?: number;
  category?: string;
  district?: string;
  description?: string;
  suggested_duration_minutes: number;
  source_url: string;
  opening_hours?: PlannerPoi['opening_hours'];
  reservation_required?: boolean;
  reservation_url?: string | null;
  hours_source_url?: string;
  data_verified_at?: string;
};

type Hotel = { id: string; name: string; address: string; lat: number; lng: number; distanceKm: number };

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: TripCreateRequest) => Promise<{ trip?: { id: number } } | void>;
  onOpenTrip: (id: number) => void;
}

const inputClass =
  'w-full rounded-xl border border-edge bg-surface-input px-3.5 py-3 text-content outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';
const preferenceStorageKey = 'tt.trip-planner.preferences.v1';
const CURATED_CITIES = [
  { name: '北京', count: 18 },
  { name: '上海', count: 4 },
  { name: '成都', count: 4 },
  { name: '西安', count: 4 },
  { name: '杭州', count: 4 },
];

function loadTripPreferences(): TripPreferences {
  if (typeof window === 'undefined') return DEFAULT_TRIP_PREFERENCES;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(preferenceStorageKey) || 'null') as Partial<TripPreferences> | null;
    const interestIds = new Set(TRIP_INTERESTS.map((interest) => interest.id));
    const paceIds = new Set(PACE_OPTIONS.map((option) => option.id));
    return {
      interests: Array.isArray(parsed?.interests)
        ? parsed.interests.filter((id): id is InterestId => typeof id === 'string' && interestIds.has(id as InterestId))
        : DEFAULT_TRIP_PREFERENCES.interests,
      pace: paceIds.has(parsed?.pace as TripPreferences['pace']) ? (parsed!.pace as TripPreferences['pace']) : DEFAULT_TRIP_PREFERENCES.pace,
    };
  } catch {
    return DEFAULT_TRIP_PREFERENCES;
  }
}

function formatGuide(guide: AttractionGuide): string {
  return [
    guide.introduction,
    guide.visitPlan.length ? `游玩建议：\n${guide.visitPlan.map((item, index) => `${index + 1}. ${item}`).join('\n')}` : '',
    guide.foods.length ? `周边美食：\n${guide.foods.map((item) => `• ${item.name}：${item.reason}`).join('\n')}` : '',
    guide.facilities.length ? `设施建议：\n${guide.facilities.map((item) => `• ${item}`).join('\n')}` : '',
    guide.practicalTips.length ? `实用提示：\n${guide.practicalTips.map((item) => `• ${item}`).join('\n')}` : '',
    guide.verificationNote,
  ].filter(Boolean).join('\n\n');
}

function AttractionPhoto({ poi, photoKey, onPhoto }: { poi: Poi; photoKey: string; onPhoto: (key: string, url: string) => void }) {
  const [url, setUrl] = useState('');
  const [credit, setCredit] = useState('');
  useEffect(() => {
    if (!Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) return;
    let active = true;
    mapsApi.placePhoto(`coords:${poi.lat}:${poi.lng}`, poi.lat, poi.lng, poi.name || '').then((result) => {
      if (active && result.photoUrl) {
        setUrl(result.photoUrl);
        setCredit(result.attribution || '景点图片');
        onPhoto(photoKey, result.photoUrl);
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [poi.lat, poi.lng, poi.name, photoKey, onPhoto]);

  return (
    <div className="relative h-24 w-28 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-accent/20 via-surface-hover to-surface-secondary">
      {url ? <img src={url} alt={`${poi.name || '景点'}图片`} loading="lazy" className="h-full w-full object-cover" /> : (
        <div className="flex h-full flex-col items-center justify-center gap-1 text-accent/80">
          <MapPin size={22} /><span className="max-w-full truncate px-1 text-[10px]">{poi.category || '景点'}</span>
        </div>
      )}
      {url && <span className="absolute bottom-1 right-1 max-w-[90%] truncate rounded bg-black/55 px-1.5 py-0.5 text-[9px] text-white">{credit}</span>}
    </div>
  );
}

function toLiveAttractions(city: string, places: Record<string, unknown>[]): Poi[] {
  return places
    .filter((place) =>
      typeof place.name === 'string' && place.name.trim() &&
      typeof place.lat === 'number' && Number.isFinite(place.lat) &&
      typeof place.lng === 'number' && Number.isFinite(place.lng)
    )
    .map((place) => {
      const lat = place.lat as number;
      const lng = place.lng as number;
      const name = String(place.name);
      return {
        id: `live-${city}-${lat}-${lng}-${name}`,
        name,
        address: typeof place.address === 'string' ? place.address : city,
        lat,
        lng,
        category: Array.isArray(place.types) ? String(place.types[0] || '景点') : String(place.amap_type || '景点'),
        district: '',
        description: '来自地图服务的地点搜索结果。开放时间、预约要求及门票信息请在景区官方渠道核实。',
        suggested_duration_minutes: 90,
        source_url: '',
        opening_hours: { status: 'variable', periods: [], note: '开放时间和预约要求请以景区官方公告为准。' },
        reservation_url: null,
      };
    });
}

/** City, dates and POIs are saved into the existing trip and day-plan model. */
export default function TripCreationWizard({ isOpen, onClose, onCreate, onOpenTrip }: Props) {
  const [step, setStep] = useState(0);
  const [city, setCity] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Poi[]>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [selected, setSelected] = useState<Poi[]>([]);
  const [hotelResults, setHotelResults] = useState<Hotel[]>([]);
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [hotelSearching, setHotelSearching] = useState(false);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [guideTarget, setGuideTarget] = useState<string | null>(null);
  const [xhsUrl, setXhsUrl] = useState('');
  const [xhsExcerpt, setXhsExcerpt] = useState('');
  const [guides, setGuides] = useState<Record<string, AttractionGuide>>({});
  const [guideBusy, setGuideBusy] = useState(false);
  const [transportMode, setTransportMode] = useState<'walking' | 'driving'>('walking');
  const [preferences, setPreferences] = useState<TripPreferences>(loadTripPreferences);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const handlePhoto = useCallback((key: string, url: string) => {
    setPhotos((current) => current[key] ? current : { ...current, [key]: url });
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(preferenceStorageKey, JSON.stringify(preferences));
    } catch {
      // Preference persistence is optional; planning remains usable if storage is blocked.
    }
  }, [preferences]);

  useEffect(() => {
    if (!isOpen || step !== 3 || catalogLoaded || !city) return;
    let active = true;
    setBusy(true);
    setError('');
    mapsApi
      .attractions(city)
      .then(async (data) => {
        if (!active) return;
        const curated = data.attractions || [];
        if (curated.length) {
          setResults(curated);
        } else {
          const live = await mapsApi.search(`${city} 旅游景点`, 'zh-CN');
          if (!active) return;
          setResults(toLiveAttractions(city, live.places));
        }
        setCatalogLoaded(true);
      })
      .catch(() => {
        if (active) setError('Could not load the attraction catalogue. Please try again.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen, step, city, catalogLoaded]);

  const reset = () => {
    setStep(0);
    setCity('');
    setStart('');
    setEnd('');
    setQuery('');
    setResults([]);
    setCatalogLoaded(false);
    setSelected([]);
    setHotelResults([]);
    setHotel(null);
    setHotelSearching(false);
    setPhotos({});
    setGuideTarget(null);
    setXhsUrl('');
    setXhsExcerpt('');
    setGuides({});
    setGuideBusy(false);
    setTransportMode('walking');
    setBusy(false);
    setError('');
  };

  const poiKey = (poi: Poi) => poi.id || `${poi.name}-${poi.lat}-${poi.lng}`;
  const generateGuide = async (poi: Poi) => {
    const key = poiKey(poi);
    setGuideBusy(true);
    setError('');
    try {
      const guide = await mapsApi.attractionGuide({
        city,
        name: poi.name || '景点',
        category: poi.category,
        address: poi.address,
        description: poi.description,
        xhsUrl: xhsUrl.trim(),
        xhsExcerpt: xhsExcerpt.trim(),
      });
      setGuides((current) => ({ ...current, [key]: guide }));
      toast.success(`已生成${poi.name}游玩攻略`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '攻略生成失败，请检查 AI 配置后重试。');
    } finally {
      setGuideBusy(false);
    }
  };
  const close = () => {
    reset();
    onClose();
  };

  const search = async () => {
    const term = query.trim();
    setQuery(term);
    if (!term || !results.some((poi) => !poi.source_url)) return;
    setBusy(true);
    setError('');
    try {
      const live = await mapsApi.search(`${city} ${term}`, 'zh-CN');
      const matches = toLiveAttractions(city, live.places);
      setResults((current) => {
        const byId = new Map(current.map((poi) => [poi.id, poi]));
        matches.forEach((poi) => byId.set(poi.id, poi));
        return [...byId.values()];
      });
    } catch {
      setError('地图景点搜索暂不可用，请检查地图数据源配置或网络连接。');
    } finally {
      setBusy(false);
    }
  };
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const hoursLabel = (poi: Poi) => {
    const hours = poi.opening_hours;
    if (!hours || hours.status === 'variable' || !hours.periods?.length)
      return hours?.note || '开放时间以现场及官方公告为准';
    return hours.periods
      .map((period) => `${period.from}–${period.to} ${period.open}–${period.close}（停止入场 ${period.lastEntry}）`)
      .join('；');
  };
  const visibleResults = results.filter(
    (poi) =>
      !normalizedQuery ||
      [poi.name, poi.address, poi.category, poi.district, poi.description].some((value) =>
        value?.toLocaleLowerCase().includes(normalizedQuery)
      )
  );
  const recommendedResults = rankAttractions(visibleResults, preferences);
  const paceOption = PACE_OPTIONS.find((option) => option.id === preferences.pace) || PACE_OPTIONS[1];
  const tripDayCount = start && end
    ? Math.max(1, Math.round((new Date(`${end}T12:00:00`).getTime() - new Date(`${start}T12:00:00`).getTime()) / 86400000) + 1)
    : 1;
  const placesPerDay = Math.ceil(selected.length / tripDayCount);

  const togglePoi = (poi: Poi) => {
    setHotel(null);
    setSelected((current) => {
      const exists = current.some((item) => item.name === poi.name && item.lat === poi.lat && item.lng === poi.lng);
      return exists
        ? current.filter((item) => !(item.name === poi.name && item.lat === poi.lat && item.lng === poi.lng))
        : [...current, poi];
    });
  };

  const searchHotels = async () => {
    if (!city || !selected.length) return;
    setHotelSearching(true);
    setError('');
    try {
      const response = await mapsApi.search(`${city} 酒店`, 'zh-CN', 'amap');
      const attractions = selected.filter((poi): poi is Poi & { lat: number; lng: number } =>
        Number.isFinite(poi.lat) && Number.isFinite(poi.lng)
      );
      const mapped = response.places
        .filter((place) => typeof place.name === 'string' && Number.isFinite(place.lat) && Number.isFinite(place.lng))
        .map((place, index) => {
          const lat = Number(place.lat);
          const lng = Number(place.lng);
          const avgKm = attractions.length
            ? attractions.reduce((sum, attraction) => sum + distanceKm({ lat, lng }, attraction), 0) / attractions.length
            : 0;
          return {
            id: String(place.amap_id || place.google_place_id || `${place.name}-${lat}-${lng}-${index}`),
            name: String(place.name),
            address: typeof place.address === 'string' ? place.address : city,
            lat,
            lng,
            distanceKm: avgKm,
          };
        })
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 8);
      setHotelResults(mapped);
      setHotel((current) => current && mapped.some((item) => item.id === current.id) ? current : null);
      if (!mapped.length) setError('暂未找到带有地图坐标的酒店结果。请检查地图服务配置，或稍后在行程内添加住宿。');
    } catch {
      setError('酒店搜索暂不可用。请检查地图数据源配置，或稍后在行程内添加住宿。');
    } finally {
      setHotelSearching(false);
    }
  };

  const create = async () => {
    setBusy(true);
    setError('');
    let tripId: number | undefined;
    try {
      const dateCount = Math.max(
        1,
        Math.round((new Date(`${end}T12:00:00`).getTime() - new Date(`${start}T12:00:00`).getTime()) / 86400000) + 1
      );
      const grouped: Poi[][] = Array.from({ length: dateCount }, () => []);
      const perDay = Math.max(1, Math.ceil(selected.length / dateCount));
      const cityOrder = optimizePoiOrder(selected as PlannerPoi[]) as Poi[];
      cityOrder.forEach((poi, index) => grouped[Math.min(Math.floor(index / perDay), dateCount - 1)].push(poi));
      const dates = Array.from({ length: dateCount }, (_, index) => {
        const date = new Date(`${start}T12:00:00`);
        date.setDate(date.getDate() + index);
        return date.toISOString().slice(0, 10);
      });
      let routeEstimated = false;
      const planned = await Promise.all(grouped.map(async (dayPois, dayIndex) => {
        // The selected attractions may be fewer than the trip days. Keep those
        // dates empty rather than passing an empty list into the scheduler and
        // later reading `.time` from a nonexistent final stop.
        if (dayPois.length === 0) return { date: dates[dayIndex], stops: [] };

        const candidates = findCandidatePoiOrders(
          dates[dayIndex], dayPois as PlannerPoi[], transportMode, paceOption.startTime, paceOption.breakMinutes, 3
        ) as Poi[][];
        const feasible: { plan: ReturnType<typeof scheduleDay>; estimated: boolean; score: number }[] = [];
        let lastError: unknown;
        for (const pois of candidates) {
          const plannerPois = pois as PlannerPoi[];
          let legs: number[] = [];
          let estimated = false;
          if (pois.length > 1) {
            try {
              const route = await mapsApi.amapRoute(transportMode, pois.map((poi) => ({ lat: poi.lat ?? 39.9, lng: poi.lng ?? 116.4 })));
              legs = route.legs.map((leg) => Math.ceil(leg.duration / 60));
              if (legs.length !== pois.length - 1) throw new Error('Incomplete route legs');
            } catch {
              estimated = true;
              legs = plannerPois.slice(1).map((poi, index) => estimateTravelMinutes(plannerPois[index], poi, transportMode));
            }
          }
          try {
            const plan = scheduleDay(dates[dayIndex], plannerPois, legs, transportMode, paceOption.startTime, paceOption.breakMinutes);
            const finalStop = plan.stops[plan.stops.length - 1];
            if (!finalStop) continue;
            const [hours, minutes] = finalStop.time.split(':').map(Number);
            feasible.push({ plan, estimated, score: hours * 60 + minutes + finalStop.duration + legs.reduce((sum, value) => sum + value, 0) * 0.15 });
          } catch (error) {
            lastError = error;
          }
        }
        if (!feasible.length) throw lastError instanceof Error ? lastError : new Error('所选景点无法排入该日，请调整景点或预约时间。');
        feasible.sort((a, b) => a.score - b.score);
        if (feasible[0].estimated) routeEstimated = true;
        return feasible[0].plan;
      }));
      const response = await onCreate({
        title: `${city} Trip`,
        description: `Destination: ${city}`,
        start_date: start,
        end_date: end,
        currency: 'CNY',
      });
      tripId = response && 'trip' in response ? response.trip?.id : undefined;
      if (!tripId) throw new Error('Trip was created but its ID could not be read.');

      const { days = [] } = await daysApi.list(tripId);
      const orderedDays = days.slice().sort((a, b) => a.day_number - b.day_number);
      if (hotel && orderedDays.length) {
        const hotelPlace = await placesApi.create(tripId, {
          name: hotel.name,
          address: hotel.address,
          description: `根据已选景点到酒店的直线距离排序推荐，平均约 ${hotel.distanceKm.toFixed(1)} 公里。距离仅用于选址参考。`,
          lat: hotel.lat,
          lng: hotel.lng,
          stop_type: 'hotel',
        });
        await accommodationsApi.create(tripId, {
          place_id: hotelPlace.place.id,
          start_day_id: orderedDays[0].id,
          end_day_id: orderedDays[orderedDays.length - 1].id,
        });
      }
      let ticketReminderCount = 0;
      for (const [dayIndex, dayPlan] of planned.entries()) {
        const day = orderedDays[dayIndex];
        for (const stop of dayPlan.stops) {
          const poi = stop.poi as Poi;
          const place = await placesApi.create(tripId, {
            name: String(poi.name || 'Unnamed attraction'),
            address: String(poi.address || ''),
            description: `${String(poi.description || '')}${guides[poiKey(poi)] ? `\n\n【AI 游玩攻略】\n${formatGuide(guides[poiKey(poi)])}` : ''}${stop.travelMinutes ? `\n建议${transportMode === 'walking' ? '步行' : '驾车'}约 ${stop.travelMinutes} 分钟抵达${routeEstimated ? '（距离估算）' : '（路线规划）'}。` : ''}${poi.opening_hours?.note ? `\n开放提示：${poi.opening_hours.note}` : ''}`,
            image_url: photos[poiKey(poi)] || null,
            lat: poi.lat ?? null,
            lng: poi.lng ?? null,
            duration_minutes: stop.duration,
            place_time: stop.time,
            transport_mode: transportMode,
          });
          if (day) await assignmentsApi.create(tripId, day.id, { place_id: place.place.id });
          if (poi.reservation_required && day) {
            await reservationsApi.create(tripId, {
              title: `门票预约：${poi.name || '景点'}`,
              type: 'event',
              status: 'pending',
              url: poi.reservation_url || poi.source_url,
              location: poi.address || '',
              day_id: day.id,
              place_id: place.place.id,
              notes: '待完成：请通过官方渠道预约门票；预约成功后在此更新状态并补充预约信息。',
            });
            ticketReminderCount += 1;
          }
        }
      }

      toast.success(
        `已生成 ${selected.length} 个景点的行程${hotel ? `；已添加住宿 ${hotel.name}，每天路线将从酒店开始并返回` : ''}${ticketReminderCount ? `；已添加 ${ticketReminderCount} 条待预约门票` : ''}${routeEstimated ? '；路线服务不可用，部分交通时间为估算值' : ''}`
      );
      reset();
      onClose();
      onOpenTrip(tripId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Trip creation failed.';
      if (tripId) {
        toast.error(`${message} The trip was created; opening it so you can continue editing.`);
        reset();
        onClose();
        onOpenTrip(tripId);
      } else setError(message);
    } finally {
      setBusy(false);
    }
  };

  const steps = ['City', 'Dates', 'Preferences', 'Attractions'];
  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Create a trip"
      size="xl"
      footer={
        <div className="flex w-full items-center justify-between">
          <button
            type="button"
            onClick={() => (step ? setStep(step - 1) : close())}
            className="rounded-xl px-4 py-2 text-content-secondary hover:bg-surface-hover"
          >
            {step ? (
              <>
                <ChevronLeft size={16} className="mr-1 inline" />
                Back
              </>
            ) : (
              'Cancel'
            )}
          </button>
          {step < 3 ? (
            <button
              type="button"
              disabled={(step === 0 && !city.trim()) || (step === 1 && (!start || !end || end < start))}
              onClick={() => {
                setError('');
                setStep(step + 1);
              }}
              className="flex items-center rounded-xl bg-accent px-5 py-2.5 font-semibold text-accent-text disabled:opacity-40"
            >
              Next <ChevronRight size={16} className="ml-1" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void create()}
              disabled={busy || selected.length === 0}
              className="flex items-center rounded-xl bg-accent px-5 py-2.5 font-semibold text-accent-text disabled:opacity-40"
            >
              {busy ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Check size={16} className="mr-2" />}
              Generate itinerary
            </button>
          )}
        </div>
      }
    >
      <div className="mb-6 flex items-center gap-2 text-xs text-content-faint">
        {steps.map((label, index) => (
          <div key={label} className={`flex flex-1 items-center gap-2 ${index <= step ? 'text-accent' : ''}`}>
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full ${index <= step ? 'bg-accent text-accent-text' : 'bg-surface-hover'}`}
            >
              {index < step ? <Check size={14} /> : index + 1}
            </span>
            <span>{label}</span>
            {index < 3 && <span className="ml-auto h-px flex-1 bg-edge" />}
          </div>
        ))}
      </div>

      {step === 0 && (
        <section className="space-y-4">
          <div>
            <h3 className="mb-1 text-lg font-semibold text-content">Where do you want to go?</h3>
            <p className="text-sm text-content-secondary">Choose a destination city to search for attractions.</p>
          </div>
          <label className="block text-sm font-medium text-content" htmlFor="trip-city">目的地城市</label>
          <input
            id="trip-city"
            className={inputClass}
            value={city}
            onChange={(event) => {
              const nextCity = event.target.value;
              if (nextCity !== city) {
                setCatalogLoaded(false);
                setResults([]);
                setSelected([]);
                setHotelResults([]);
                setHotel(null);
              }
              setCity(nextCity);
            }}
            placeholder="例如：北京、上海、成都"
            list="trip-city-suggestions"
            maxLength={40}
          />
          <datalist id="trip-city-suggestions">
            {['北京', '上海', '杭州', '成都', '西安', '广州', '深圳', '南京', '重庆', '厦门'].map((name) => <option key={name} value={name} />)}
          </datalist>
          <div className="flex flex-wrap gap-2">
            {CURATED_CITIES.map(({ name, count }) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setCity(name);
                  setCatalogLoaded(false);
                  setResults([]);
                  setSelected([]);
                  setHotelResults([]);
                  setHotel(null);
                }}
                className={`rounded-full border px-3 py-1.5 text-xs ${city === name ? 'border-accent bg-accent/10 text-accent' : 'border-edge bg-surface-card text-content-secondary'}`}
              >
                {name} · {count} 个精选
              </button>
            ))}
          </div>
          <p className="text-xs text-content-faint">北京、上海、成都、西安和杭州提供来源可追溯的精选目录；开放时段和预约规则会变化，路线会结合当前可用的地图交通时长规划。</p>
        </section>
      )}

      {step === 1 && (
        <section className="space-y-4">
          <div>
            <h3 className="mb-1 text-lg font-semibold text-content">When are you travelling?</h3>
            <p className="text-sm text-content-secondary">The planner creates one day for each date in your range.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-content">
              <CalendarDays size={15} className="mr-1 inline" />
              Departure date
              <input
                type="date"
                className={`${inputClass} mt-2`}
                value={start}
                onChange={(event) => {
                  setStart(event.target.value);
                  if (!end || end < event.target.value) setEnd(event.target.value);
                }}
              />
            </label>
            <label className="text-sm font-medium text-content">
              <CalendarDays size={15} className="mr-1 inline" />
              Return date
              <input
                type="date"
                min={start}
                className={`${inputClass} mt-2`}
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </label>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-5">
          <div>
            <h3 className="mb-1 text-lg font-semibold text-content">按你的喜好规划</h3>
            <p className="text-sm text-content-secondary">选择感兴趣的主题和出行节奏，景点列表会优先展示匹配项，并说明推荐依据。</p>
          </div>
          <div>
            <div className="mb-2 text-sm font-semibold text-content">感兴趣的主题 <span className="font-normal text-content-faint">可多选</span></div>
            <div className="flex flex-wrap gap-2">
              {TRIP_INTERESTS.map((interest) => {
                const checked = preferences.interests.includes(interest.id);
                return (
                  <button
                    key={interest.id}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => setPreferences((current) => ({
                      ...current,
                      interests: checked
                        ? current.interests.filter((item) => item !== interest.id)
                        : [...current.interests, interest.id],
                    }))}
                    className={`rounded-full border px-3.5 py-2 text-sm transition-colors ${checked ? 'border-accent bg-accent/10 text-accent' : 'border-edge text-content-secondary hover:bg-surface-hover'}`}
                  >
                    {checked && <Check size={14} className="mr-1 inline" />}{interest.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-2 text-sm font-semibold text-content">出行节奏</div>
            <div className="grid gap-2 sm:grid-cols-3">
              {PACE_OPTIONS.map((option) => {
                const checked = preferences.pace === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => setPreferences((current) => ({ ...current, pace: option.id }))}
                    className={`rounded-xl border p-3 text-left transition-colors ${checked ? 'border-accent bg-accent/5 ring-2 ring-accent/15' : 'border-edge hover:bg-surface-hover'}`}
                  >
                    <span className="block text-sm font-semibold text-content">{option.label}</span>
                    <span className="mt-1 block text-xs leading-5 text-content-secondary">{option.description}</span>
                    <span className="mt-2 block text-xs text-content-faint">{option.startTime} 出发 · 景点间休息 {option.breakMinutes} 分钟 · 建议每天 {option.placesPerDay} 处</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-xl bg-surface-secondary p-3 text-xs leading-5 text-content-secondary">
            <Sparkles size={15} className="mt-0.5 shrink-0 text-accent" />
            <span>偏好会保存在当前浏览器。推荐依据是景点类别、介绍和建议游玩时长，不代表实时热度或个性化评价。</span>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4">
          <div>
            <h3 className="mb-1 text-lg font-semibold text-content">为 {city} 选择景点</h3>
            <p className="text-sm text-content-secondary">
              推荐项按偏好排序；每天先按地理距离整理顺序，再查询分段交通路线。景点会在 {tripDayCount} 天内均匀安排。
            </p>
          </div>
          <div className="flex gap-2">
            <input
              className={inputClass}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search attraction name, category or district"
              onKeyDown={(event) => event.key === 'Enter' && search()}
            />
            <button
              type="button"
              onClick={search}
              disabled={busy}
              className="flex shrink-0 items-center rounded-xl bg-accent px-4 text-accent-text disabled:opacity-40"
            >
              <Search size={17} />
              <span className="ml-2">Search</span>
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-[1fr_0.8fr]">
            <div className="max-h-72 space-y-2 overflow-auto">
              {recommendedResults.map((poi, index) => {
                const chosen = selected.some(
                  (item) => item.name === poi.name && item.lat === poi.lat && item.lng === poi.lng
                );
                return (
                  <div
                    key={poi.id || `${poi.name}-${index}`}
                    className={`overflow-hidden rounded-xl border ${chosen ? 'bg-accent/5 border-accent' : 'border-edge'}`}
                  >
                    <button
                      type="button"
                      onClick={() => togglePoi(poi)}
                      className="flex w-full items-start gap-3 p-3 text-left hover:bg-surface-hover"
                    >
                      <AttractionPhoto poi={poi} photoKey={poiKey(poi)} onPhoto={handlePhoto} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-content">
                          {poi.name || 'Unnamed attraction'}{' '}
                          <span className="text-xs font-normal text-content-faint">
                            {poi.category} · {poi.district}
                          </span>
                        </span>
                        <span className="mt-1 block text-xs text-content-secondary">{poi.description}</span>
                        <span className="mt-1 block text-xs text-content-faint">
                          {poi.address} · 建议游玩 {poi.suggested_duration_minutes} 分钟
                        </span>
                        <span className="mt-1 flex items-start gap-1 text-xs font-medium text-accent">
                          <Sparkles size={13} className="mt-0.5 shrink-0" />{poi.recommendationReason}
                        </span>
                        <span className="mt-1 block text-xs text-content-secondary">开放：{hoursLabel(poi)}</span>
                      </span>
                      {chosen ? (
                        <Check size={16} className="text-accent" />
                      ) : (
                        <Plus size={16} className="text-content-faint" />
                      )}
                    </button>
                    {poi.reservation_required && (
                      <div className="border-edge/70 flex items-center justify-between border-t px-3 py-2">
                        <span className="text-xs font-medium text-amber-700">需要提前预约门票</span>
                        <a
                          href={poi.reservation_url || poi.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                        >
                          官方预约入口 <ExternalLink size={13} />
                        </a>
                      </div>
                    )}
                  </div>
                );
              })}
              {!visibleResults.length && (
                <div className="rounded-xl border border-dashed border-edge p-6 text-center text-sm text-content-faint">
                  {busy
                    ? `正在搜索 ${city} 景点…`
                    : results.length
                      ? 'No attractions match. Try another search.'
                      : 'No attractions are available for this city yet.'}
                </div>
              )}
            </div>
            <div className="rounded-xl bg-surface-secondary p-3">
              <div className="mb-2 font-semibold text-content">Selected ({selected.length})</div>
              <label className="mb-3 block text-xs font-medium text-content-secondary">
                出行方式
                <select
                  className={`${inputClass} mt-1 py-2`}
                  value={transportMode}
                  onChange={(event) => setTransportMode(event.target.value as 'walking' | 'driving')}
                >
                  <option value="walking">步行</option>
                  <option value="driving">驾车</option>
                </select>
              </label>
              <p className="-mt-2 mb-3 text-xs leading-5 text-content-faint">配置高德路线服务时显示路线服务提供的分段时长；否则使用距离估算。</p>
              {selected.length ? (
                <>
                  <p className={`mb-2 text-xs ${placesPerDay > paceOption.placesPerDay ? 'text-amber-700' : 'text-content-faint'}`}>
                    约每天 {placesPerDay} 处 · {paceOption.label}建议每天 {paceOption.placesPerDay} 处
                    {placesPerDay > paceOption.placesPerDay ? '，当前选择较紧凑' : ''}
                  </p>
                  <div className="max-h-60 space-y-2 overflow-auto">
                    {selected.map((poi, index) => (
                      <div key={poi.id || `${poi.name}-${index}`} className="rounded-lg border border-edge bg-surface-card p-2">
                        <div className="flex items-center gap-2 text-sm">
                          <AttractionPhoto poi={poi} photoKey={poiKey(poi)} onPhoto={handlePhoto} />
                          <span className="min-w-0 flex-1 text-content">
                            <span className="block truncate">{index + 1}. {poi.name}</span>
                            <span className="text-xs text-content-faint">{poi.suggested_duration_minutes} min</span>
                            <button type="button" onClick={() => { setGuideTarget(guideTarget === poiKey(poi) ? null : poiKey(poi)); setXhsUrl(''); setXhsExcerpt(''); }} className="mt-1 block text-xs font-medium text-accent hover:underline">
                              <Sparkles size={12} className="mr-1 inline" />{guides[poiKey(poi)] ? '查看/更新攻略' : '生成 AI 攻略'}
                            </button>
                          </span>
                          <button type="button" aria-label={`Remove ${poi.name}`} onClick={() => togglePoi(poi)} className="self-start text-content-faint hover:text-red-500"><X size={15} /></button>
                        </div>
                        {guideTarget === poiKey(poi) && (
                          <div className="mt-3 space-y-2 border-t border-edge pt-3">
                            <p className="text-xs leading-5 text-content-secondary">粘贴你有权使用的小红书笔记链接或短摘录，AI 会结合景点资料整理游玩路线、美食、设施与实用提示。系统不会自动抓取笔记。</p>
                            <input className={`${inputClass} py-2 text-xs`} value={xhsUrl} onChange={(event) => setXhsUrl(event.target.value)} placeholder="小红书笔记链接（可选）" />
                            <textarea className={`${inputClass} min-h-20 py-2 text-xs`} maxLength={12000} value={xhsExcerpt} onChange={(event) => setXhsExcerpt(event.target.value)} placeholder="粘贴笔记中的简短摘录（可选）" />
                            <button type="button" disabled={guideBusy} onClick={() => void generateGuide(poi)} className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-text disabled:opacity-50">
                              {guideBusy ? <Loader2 size={13} className="mr-1 inline animate-spin" /> : <Sparkles size={13} className="mr-1 inline" />}{guideBusy ? '正在生成…' : '生成景点攻略'}
                            </button>
                            {guides[poiKey(poi)] && <div className="max-h-44 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-secondary p-2 text-xs leading-5 text-content-secondary">{formatGuide(guides[poiKey(poi)])}</div>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-content-faint">Choose at least one attraction to generate the itinerary.</p>
              )}
              <div className="mt-4 border-t border-edge pt-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-content">推荐住宿（可选）</div>
                  <button
                    type="button"
                    onClick={() => void searchHotels()}
                    disabled={!selected.length || hotelSearching}
                    className="rounded-lg border border-edge px-2.5 py-1.5 text-xs font-medium text-content disabled:opacity-40"
                  >
                    {hotelSearching ? <Loader2 size={13} className="mr-1 inline animate-spin" /> : <Search size={13} className="mr-1 inline" />}
                    搜索酒店
                  </button>
                </div>
                <p className="mt-1 text-xs leading-5 text-content-faint">按酒店到所选景点的平均直线距离排序；选择后会作为全程住宿，每天路线从酒店出发并返回。距离不是驾车/步行路线距离。</p>
                {hotel && (
                  <div className="mt-2 rounded-lg border border-accent bg-accent/5 p-2 text-sm">
                    <div className="font-medium text-content">已选：{hotel.name}</div>
                    <div className="text-xs text-content-secondary">{hotel.address} · 平均直线距离 {hotel.distanceKm.toFixed(1)} km</div>
                  </div>
                )}
                {hotelResults.length > 0 && (
                  <div className="mt-2 max-h-40 space-y-1 overflow-auto">
                    {hotelResults.map((item) => (
                      <button key={item.id} type="button" onClick={() => setHotel(item)} className={`w-full rounded-lg border p-2 text-left ${hotel?.id === item.id ? 'border-accent bg-accent/5' : 'border-edge bg-surface-card'}`}>
                        <span className="block truncate text-sm font-medium text-content">{item.name}</span>
                        <span className="block truncate text-xs text-content-faint">{item.address} · 平均 {item.distanceKm.toFixed(1)} km</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </Modal>
  );
}
