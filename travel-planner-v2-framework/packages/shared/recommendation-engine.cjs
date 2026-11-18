// 浏览器本地预览与服务端共用同一套可解释规则；无实时交通、坐标或大模型依赖。
const settings = {
  relaxed: { start: 600, budget: 480, count: 2, rest: 30 },
  standard: { start: 540, budget: 540, count: 3, rest: 15 },
  intensive: { start: 480, budget: 600, count: 4, rest: 10 },
};
const label = {
  history: '历史文化',
  nature: '园林自然',
  landmark: '城市地标',
  art: '艺术设计',
  family: '亲子体验',
  local: '老街与在地体验',
};
function dates(input) {
  const from = Date.parse(`${input.startDate}T00:00:00Z`),
    to = Date.parse(`${input.endDate}T00:00:00Z`),
    count = (to - from) / 86400000 + 1;
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 30 ||
    new Date(from).toISOString().slice(0, 10) !== input.startDate ||
    new Date(to).toISOString().slice(0, 10) !== input.endDate
  )
    throw new Error('Invalid date range');
  return Array.from({ length: count }, (_, i) =>
    new Date(from + i * 86400000).toISOString().slice(0, 10),
  );
}
function rankPlaces(places, input) {
  const cfg = settings[input.pace];
  if (!cfg) throw new Error('Invalid pace');
  return places
    .filter((p) => p.cityId === input.cityId)
    .map((p) => {
      const matchedThemes = [...new Set(input.themes.filter((t) => p.categories.includes(t)))];
      const reasons = matchedThemes.length
        ? [`匹配${matchedThemes.map((t) => `「${label[t]}」`).join('、')}兴趣`]
        : ['未匹配所选主题，可自由加入行程'];
      if (!input.themes.length) reasons[0] = '尚未设置兴趣，按目录和游玩时长提供参考';
      if (p.excursion) reasons.push('远郊景点，建议单独安排一天');
      reasons.push(`游玩时长约${p.suggestedDurationMinutes}分钟，为规划估计`);
      return {
        placeId: p.id,
        score:
          matchedThemes.length * 100 +
          (p.suggestedDurationMinutes <= cfg.budget / cfg.count ? 10 : 0),
        matchedThemes,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score || a.placeId.localeCompare(b.placeId));
}
function transfer(a, b, mode) {
  if (!a) return 0;
  // 仅为行政区级预留假设，不能解读为已查询的距离或路线。
  const same = a.district === b.district;
  return mode === 'walking'
    ? same
      ? 30
      : 90
    : mode === 'driving'
      ? same
        ? 20
        : 45
      : same
        ? 25
        : 60;
}
function warnings(places, input, unassigned) {
  const result = [
    {
      code: 'RULE_ESTIMATES',
      message:
        '规则规划：按行政区分组；交通预留为固定假设，首站未含住宿出发交通，未查询实时路线、开放时间或预约。',
    },
  ];
  result.push({
    code: 'OPENING_HOURS_UNVERIFIED',
    message: '开放时间、闭馆日与预约规则尚未结构化核实，请出行前确认。',
  });
  if (input.selectedPlaceIds.some((id) => places.find((p) => p.id === id)?.excursion))
    result.push({
      code: 'EXCURSION_DAY',
      message: '长城等远郊景点单独安排一天，住宿往返交通尚未计算，请额外预留时间。',
    });
  if (unassigned.length)
    result.push({
      code: 'CAPACITY_EXCEEDED',
      message: '部分景点超出当前日期和节奏容量，请增加天数或减少景点后重新生成。',
      placeIds: unassigned,
    });
  return result;
}
function pack(groups, places, input) {
  const map = new Map(places.map((p) => [p.id, p])),
    cfg = settings[input.pace];
  const selected = new Set(input.selectedPlaceIds),
    used = new Set(),
    unassigned = [];
  const days = groups.map((group) => {
    let elapsed = 0,
      last = null;
    const items = [];
    for (const id of group.placeIds) {
      const p = map.get(id);
      if (!p || p.cityId !== input.cityId || !selected.has(id) || used.has(id))
        throw new Error('Invalid or duplicate place');
      used.add(id);
      const travel = transfer(last, p, input.transportMode),
        gap = items.length ? cfg.rest : 0;
      const end = elapsed + travel + gap + p.suggestedDurationMinutes;
      if (
        items.length >= cfg.count ||
        end > cfg.budget ||
        (p.excursion && items.length) ||
        last?.excursion
      ) {
        unassigned.push(id);
        continue;
      }
      const start = cfg.start + elapsed + travel + gap;
      const matched = p.categories.filter((t) => input.themes.includes(t));
      items.push({
        placeId: id,
        position: items.length,
        startTime: `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`,
        durationMinutes: p.suggestedDurationMinutes,
        travelMinutesFromPrevious: travel,
        travelTimeSource: items.length ? 'estimate' : 'none',
        reason: `${matched.length ? '匹配' + matched.map((t) => label[t]).join('、') + '；' : ''}${p.district}；${p.excursion ? '远郊单日安排' : '按行政区与每日容量安排'}，交通与休息按规则预留`,
      });
      elapsed = end;
      last = p;
    }
    return { date: group.date, items };
  });
  for (const id of input.selectedPlaceIds) if (!used.has(id)) unassigned.push(id);
  return {
    days,
    unassignedPlaceIds: unassigned,
    warnings: warnings(places, input, unassigned),
    source: 'rule',
  };
}
function scheduleGroups(places, input, groups) {
  const expected = dates(input);
  if (groups.length !== expected.length || groups.some((g, i) => g.date !== expected[i]))
    throw new Error('Invalid schedule dates');
  return pack(groups, places, input);
}
function generatePlan(places, input) {
  const ds = dates(input),
    map = new Map(places.filter((p) => p.cityId === input.cityId).map((p) => [p.id, p]));
  if (
    new Set(input.selectedPlaceIds).size !== input.selectedPlaceIds.length ||
    input.selectedPlaceIds.some((id) => !map.has(id))
  )
    throw new Error('Invalid selections');
  const rankings = new Map(rankPlaces(places, input).map((r) => [r.placeId, r.score]));
  const groups = ds.map((date) => ({ date, placeIds: [] }));
  const candidates = input.selectedPlaceIds
    .map((id) => map.get(id))
    .sort(
      (a, b) =>
        Number(b.excursion) - Number(a.excursion) ||
        rankings.get(b.id) - rankings.get(a.id) ||
        a.district.localeCompare(b.district) ||
        input.selectedPlaceIds.indexOf(a.id) - input.selectedPlaceIds.indexOf(b.id),
    );
  for (const place of candidates) {
    const options = groups
      .map((g, i) => ({
        g,
        i,
        load: g.placeIds.reduce((sum, id) => sum + map.get(id).suggestedDurationMinutes, 0),
      }))
      .sort((a, b) => {
        const cost = (o) =>
          o.load -
          (o.g.placeIds.some((id) => map.get(id).district === place.district)
            ? settings[input.pace].budget
            : 0);
        return cost(a) - cost(b) || a.i - b.i;
      });
    for (const { g } of options) {
      const trial = pack([{ date: g.date, placeIds: [...g.placeIds, place.id] }], places, {
        ...input,
        selectedPlaceIds: [...g.placeIds, place.id],
      });
      if (!trial.unassignedPlaceIds.length) {
        g.placeIds.push(place.id);
        break;
      }
    }
  }
  return pack(groups, places, input);
}
function validateSchedule(places, input, days) {
  const expected = dates(input),
    cfg = settings[input.pace],
    selected = new Set(input.selectedPlaceIds),
    seen = new Set();
  if (days.length !== expected.length) throw new Error('日期不完整');
  for (let d = 0; d < days.length; d++) {
    const day = days[d];
    if (day.date !== expected[d] || !Array.isArray(day.items) || day.items.length > cfg.count)
      throw new Error('每日安排不合法');
    let previousEnd = cfg.start;
    let previousPlace = null;
    for (let i = 0; i < day.items.length; i++) {
      const item = day.items[i],
        p = places.find((p) => p.id === item.placeId && p.cityId === input.cityId);
      if (
        !p ||
        !selected.has(item.placeId) ||
        seen.has(item.placeId) ||
        item.position !== i ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.startTime) ||
        !Number.isInteger(item.durationMinutes) ||
        item.durationMinutes < p.suggestedDurationMinutes ||
        !Number.isInteger(item.travelMinutesFromPrevious) ||
        item.travelMinutesFromPrevious < 0 ||
        typeof item.reason !== 'string' ||
        item.reason.length > 500
      )
        throw new Error('景点、顺序或时长不合法');
      if (
        (i === 0 && (item.travelMinutesFromPrevious !== 0 || item.travelTimeSource !== 'none')) ||
        (i > 0 &&
          (!['estimate', 'provider'].includes(item.travelTimeSource) ||
            item.travelMinutesFromPrevious < transfer(previousPlace, p, input.transportMode)))
      )
        throw new Error('交通段不合法');
      if (p.excursion && day.items.length > 1) throw new Error('远郊景点需单独一天');
      const [h, m] = item.startTime.split(':').map(Number),
        start = h * 60 + m,
        end = start + item.durationMinutes;
      if (
        start < previousEnd + item.travelMinutesFromPrevious + (i ? cfg.rest : 0) ||
        end > cfg.start + cfg.budget
      )
        throw new Error('时间重叠或超出每日预算');
      seen.add(item.placeId);
      previousEnd = end;
      previousPlace = p;
    }
  }
  if (seen.size !== selected.size) throw new Error('景点安排不完整');
}
module.exports = {
  rankPlaces,
  generatePlan,
  scheduleGroups,
  validateSchedule,
  paceSettings: settings,
};
