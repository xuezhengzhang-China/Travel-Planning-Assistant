/**
 * 城市名片组件（源自 liuyan 分支 V1 的 CityPostcard）。
 *
 * 按城市名匹配一组内置的符号 / 标语 / 渐变底色；未匹配的城市用通用卡片。
 * 输入是 v2 `Destination` 的 `name`（如「杭州市」「北京」），组件会去掉
 * 「市/省/特别行政区」等后缀再匹配。
 */

interface CityPostcardStyle {
  symbol: string;
  tagline: string;
  detail: string;
  background: string;
}

const cityPostcards: Record<string, CityPostcardStyle> = {
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

function getCityPostcard(destination: string): { name: string } & CityPostcardStyle {
  const city = destination.trim().replace(/[市省特别行政区]/g, '');
  const cityName = Object.keys(cityPostcards).find(
    (name) => city.includes(name) || name.includes(city),
  );
  if (cityName) return { name: cityName, ...cityPostcards[cityName] };
  return {
    name: destination || '未知目的地',
    symbol: '✈️',
    tagline: `${destination || '下一站'} · 自在漫游`,
    detail: '把当地街巷与沿途风景，慢慢写进旅程。',
    background: 'linear-gradient(135deg, #c5d5cb, #e8eee4)',
  };
}

export interface CityPostcardProps {
  /** 城市名（`Destination.name`）。 */
  name: string;
  compact?: boolean;
}

export default function CityPostcard({ name, compact = false }: CityPostcardProps) {
  const city = getCityPostcard(name);

  return (
    <div
      className={compact ? 'city-postcard city-postcard-compact' : 'city-postcard'}
      style={{ background: city.background }}
    >
      <div className="city-postcard-symbol">{city.symbol}</div>
      {!compact && (
        <div>
          <div className="city-postcard-name">{city.name}</div>
          <div className="city-postcard-tagline">{city.tagline}</div>
          <div className="city-postcard-detail">{city.detail}</div>
        </div>
      )}
    </div>
  );
}
