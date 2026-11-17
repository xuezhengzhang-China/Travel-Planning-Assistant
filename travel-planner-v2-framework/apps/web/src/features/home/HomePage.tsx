import { useCallback, useEffect, useState } from 'react';
import type { Destination, PageResult, Place } from '@travel/shared';
import { ApiError, type ApiClient } from '../../lib/api-client';
import { wgs84ToGcj02 } from '../../lib/coords';
import CityPostcard from './CityPostcard';
import './home.css';

const THEME_LABELS: Record<string, string> = {
  history: '历史文化',
  nature: '园林自然',
  landmark: '城市地标',
  art: '艺术设计',
  family: '亲子体验',
  local: '老街与在地体验',
};

function homeErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'UNAUTHENTICATED' || error.status === 401) return '登录已过期，请重新登录。';
    return error.message;
  }
  return error instanceof Error ? error.message : '目的地加载失败，请重试。';
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

function generateReply(input: string, cityName: string | null, places: Place[]): string {
  const question = input.trim();
  if (/你好|您好|hi|hello|嗨/i.test(question)) {
    return '你好呀！可以问我「景点推荐」或「美食推荐」，也可以点上方「定位当前位置」。';
  }
  if (/景点|玩|去哪|旅游|推荐.*地方|有什么好/.test(question)) {
    if (!cityName) return '先点上方「定位当前位置」或选一座城市，我才能推荐当地景点哦。';
    if (places.length === 0) return `${cityName} 暂时还没有录入景点，等数据补齐就能推荐啦。`;
    const names = places.map((place) => `· ${place.name}`).join('\n');
    return `为你推荐 ${cityName} 的 ${places.length} 个景点：\n${names}`;
  }
  if (/美食|吃|餐厅|小吃|特产/.test(question)) {
    return '美食推荐需要接入本地生活数据，目前还没有；先试试「景点推荐」吧。';
  }
  if (/天气|行李|带什么/.test(question)) {
    return '天气和行李清单可以在「行程」页的行程详情里查看（出发提醒与行李清单）。';
  }
  return '我可以简单回答「景点推荐」「美食推荐」。试试问一句「有什么景点推荐？」';
}

export interface HomePageProps {
  client: ApiClient;
}

/** 旅行助手首页：定位当前位置 + 城市目录 + 景点探索 + 旅行灵感对话。 */
export default function HomePage({ client }: HomePageProps) {
  const [cities, setCities] = useState<Destination[]>([]);
  const [selectedCity, setSelectedCity] = useState<Destination | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationMsg, setLocationMsg] = useState('');
  const [locatedCity, setLocatedCity] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');

  async function locate() {
    if (!navigator.geolocation) {
      setLocationMsg('浏览器不支持定位。');
      return;
    }
    setLocationMsg('正在定位…');
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const gcj = wgs84ToGcj02(coords.longitude, coords.latitude);
        try {
          const result = await client.request<{
            placeName: string;
            cityId: string | null;
            cityAdcode: string | null;
            warnings: unknown[];
          }>('/locations/reverse', {
            body: {
              coordinates: {
                longitude: gcj.longitude,
                latitude: gcj.latitude,
                coordinateSystem: 'GCJ-02',
              },
            },
          });
          if (result.cityId) {
            const matched = cities.find((c) => c.id === result.cityId);
            const name = matched?.name ?? result.placeName;
            setLocatedCity(name);
            setLocationMsg(`已定位到：${name}。`);
            if (matched) openCity(matched);
            else setLocationMsg(`已定位到：${name}（该城市暂不在目录中）。`);
          } else {
            setLocatedCity(result.placeName || null);
            setLocationMsg(
              `当前位置：${coords.longitude.toFixed(4)}, ${coords.latitude.toFixed(4)}（未能确认所在城市）。`,
            );
          }
        } catch {
          setLocationMsg(
            `当前位置：${coords.longitude.toFixed(4)}, ${coords.latitude.toFixed(4)}。`,
          );
        }
      },
      () => setLocationMsg('定位失败，请允许定位权限。'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    client
      .request<PageResult<Destination>>('/destinations?level=city&pageSize=50')
      .then((page) => {
        if (active) setCities(page.items);
      })
      .catch((failure: unknown) => {
        if (active) setError(homeErrorMessage(failure));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client]);

  const openCity = useCallback(
    (city: Destination) => {
      setSelectedCity(city);
      setPlaces([]);
      setPlacesLoading(true);
      client
        .request<PageResult<Place>>(`/places?cityId=${encodeURIComponent(city.id)}&pageSize=20`)
        .then((page) => setPlaces(page.items))
        .catch(() => setPlaces([]))
        .finally(() => setPlacesLoading(false));
    },
    [client],
  );

  function sendChat() {
    const text = chatInput.trim();
    if (!text) return;
    const cityName = locatedCity ?? selectedCity?.name ?? null;
    const reply = generateReply(text, cityName, places);
    setChatMessages((current) => [
      ...current,
      { role: 'user', text },
      { role: 'assistant', text: reply },
    ]);
    setChatInput('');
  }

  return (
    <section className="home-page">
      <div className="greeting">
        <p className="eyebrow">YOUR NEXT JOURNEY STARTS HERE</p>
        <h1>
          去遇见，
          <br />
          世界的另一面。
        </h1>
        <p className="subheading">每一段旅程，都值得认真期待。</p>
        <button type="button" className="locate-button" onClick={() => void locate()}>
          定位当前位置
        </button>
        {locatedCity && (
          <p className="located-city">
            <span aria-hidden="true">📍</span> 当前所在：{locatedCity}
          </p>
        )}
        {locationMsg && <p className="field-hint">{locationMsg}</p>}
      </div>

      {error && (
        <p role="alert" className="profile-alert">
          {error}
        </p>
      )}

      <section className="city-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">DESTINATIONS</p>
            <h2>选一座城市出发</h2>
          </div>
        </div>

        {loading ? (
          <p className="footprint-page-summary">正在读取目的地…</p>
        ) : (
          <div className="city-grid">
            {cities.map((city) => (
              <button
                key={city.id}
                type="button"
                className="city-card-button"
                onClick={() => openCity(city)}
                aria-pressed={selectedCity?.id === city.id}
              >
                <CityPostcard name={city.name} />
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedCity && (
        <section className="city-places">
          <div className="section-heading">
            <div>
              <p className="eyebrow">PLACES TO EXPLORE</p>
              <h2>{selectedCity.name} · 推荐去处</h2>
            </div>
            <button type="button" className="more-text" onClick={() => setSelectedCity(null)}>
              收起 ↑
            </button>
          </div>

          {placesLoading ? (
            <p className="footprint-page-summary">正在读取景点…</p>
          ) : places.length === 0 ? (
            <p className="field-hint">这个城市暂时还没有录入景点。</p>
          ) : (
            <ul className="place-list">
              {places.map((place) => (
                <li key={place.id} className="place-item">
                  <strong>{place.name}</strong>
                  {place.district && <small>{place.district}</small>}
                  {place.categories?.length > 0 && (
                    <span className="place-themes">
                      {place.categories
                        .map((category) => THEME_LABELS[category] ?? category)
                        .join(' · ')}
                    </span>
                  )}
                  {place.address && <p>{place.address}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="inspiration-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">GET INSPIRED</p>
            <h2>旅行灵感</h2>
          </div>
        </div>

        <div className="chat-panel" aria-label="旅行灵感对话">
          <div className="chat-messages">
            {chatMessages.length === 0 ? (
              <p className="chat-hint">问我「景点推荐」「美食推荐」，聊聊想去的地方。</p>
            ) : (
              chatMessages.map((message, index) => (
                <p
                  key={index}
                  className={`chat-message ${message.role === 'user' ? 'is-user' : 'is-assistant'}`}
                >
                  {message.text}
                </p>
              ))
            )}
          </div>
          <div className="chat-input-row">
            <input
              type="text"
              value={chatInput}
              placeholder="例如：有什么景点推荐？"
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') sendChat();
              }}
            />
            <button type="button" onClick={sendChat}>
              发送
            </button>
          </div>
        </div>
      </section>
    </section>
  );
}
