export type InterestId = 'culture' | 'nature' | 'landmarks' | 'art' | 'family' | 'local';
export type PaceId = 'relaxed' | 'balanced' | 'full';

export type TripPreferences = {
  interests: InterestId[];
  pace: PaceId;
};

export const DEFAULT_TRIP_PREFERENCES: TripPreferences = {
  interests: [],
  pace: 'balanced',
};

export const TRIP_INTERESTS: Array<{ id: InterestId; label: string; categories: string[]; keywords: string[] }> = [
  { id: 'culture', label: '历史文化', categories: ['历史古迹', '博物馆', '宗教文化'], keywords: ['历史', '博物馆', '寺', '宫', '遗址', '建筑'] },
  { id: 'nature', label: '园林自然', categories: ['园林公园', '长城与自然'], keywords: ['公园', '园林', '湖', '山', '长城', '自然'] },
  { id: 'landmarks', label: '城市地标', categories: ['城市地标'], keywords: ['地标', '广场', '鸟巢', '水立方'] },
  { id: 'art', label: '艺术设计', categories: ['艺术街区'], keywords: ['艺术', '画廊', '展览', '设计'] },
  { id: 'family', label: '亲子体验', categories: ['亲子游览'], keywords: ['动物园', '亲子', '儿童'] },
  { id: 'local', label: '老街与在地体验', categories: ['城市街区'], keywords: ['老街', '胡同', '老字号', '街区'] },
];

export const PACE_OPTIONS: Array<{
  id: PaceId;
  label: string;
  description: string;
  startTime: string;
  breakMinutes: number;
  placesPerDay: number;
}> = [
  { id: 'relaxed', label: '轻松慢游', description: '晚些出发，景点间留出更多休息时间', startTime: '10:00', breakMinutes: 30, placesPerDay: 2 },
  { id: 'balanced', label: '经典节奏', description: '游玩与休息均衡，适合大多数行程', startTime: '09:00', breakMinutes: 15, placesPerDay: 3 },
  { id: 'full', label: '紧凑充实', description: '较早出发，适合希望多看一些景点', startTime: '08:00', breakMinutes: 10, placesPerDay: 4 },
];

export function rankAttractions<T extends {
  category?: string;
  description?: string;
  name?: string;
  suggested_duration_minutes: number;
}>(attractions: T[], preferences: TripPreferences): Array<T & { recommendationReason: string; recommendationScore: number }> {
  return attractions
    .map((attraction, index) => {
      const text = `${attraction.name || ''} ${attraction.category || ''} ${attraction.description || ''}`;
      const matching = TRIP_INTERESTS.filter(
        (interest) =>
          preferences.interests.includes(interest.id) &&
          (interest.categories.includes(attraction.category || '') || interest.keywords.some((keyword) => text.includes(keyword)))
      );
      const duration = attraction.suggested_duration_minutes || 90;
      const pace = PACE_OPTIONS.find((item) => item.id === preferences.pace) || PACE_OPTIONS[1];
      let score = matching.length * 10;
      if (pace.id === 'relaxed') score += duration <= 120 ? 2 : duration >= 210 ? -1 : 0;
      if (pace.id === 'balanced') score += duration >= 90 && duration <= 210 ? 1 : 0;
      if (pace.id === 'full') score += duration >= 150 ? 2 : duration <= 75 ? -1 : 0;

      const recommendationReason = matching.length
        ? `匹配你的${matching.map((item) => `「${item.label}」`).join('、')}偏好 · ${attraction.category || '特色景点'}`
        : preferences.interests.length
          ? `补充不同类型体验 · ${attraction.category || '北京景点'} · 建议游玩约 ${duration} 分钟`
          : `景点目录收录 · ${attraction.category || '特色景点'} · 建议游玩约 ${duration} 分钟`;

      return { ...attraction, recommendationReason, recommendationScore: score, originalIndex: index };
    })
    .sort((a, b) => b.recommendationScore - a.recommendationScore || a.originalIndex - b.originalIndex)
    .map((item): T & { recommendationReason: string; recommendationScore: number } => {
      const { originalIndex: _originalIndex, ...attraction } = item;
      return attraction as T & { recommendationReason: string; recommendationScore: number };
    });
}
