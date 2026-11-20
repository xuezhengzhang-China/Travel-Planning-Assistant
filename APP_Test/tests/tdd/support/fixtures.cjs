// Contract examples only. No business implementation is imported into expected values.
const provinceId = "20000000-0000-4000-8000-000000000001";
const cityId = "20000000-0000-4000-8000-000000000002";
const userA = "10000000-0000-4000-8000-000000000001";
const userB = "10000000-0000-4000-8000-000000000002";
const fixedNow = "2026-11-17T01:00:00.000Z";
function id(index) {
  return `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
function fixtures() {
  const places = [
    {
      id: id(1),
      name: "西湖",
      categories: ["nature", "landmark"],
      longitude: 120.148,
      latitude: 30.245,
      duration: 90,
    },
    {
      id: id(2),
      name: "灵隐",
      categories: ["history", "nature"],
      longitude: 120.102,
      latitude: 30.242,
      duration: 120,
    },
    {
      id: id(3),
      name: "良渚",
      categories: ["history", "art"],
      longitude: 120.028,
      latitude: 30.381,
      duration: 120,
    },
  ].map((p) => ({
    id: p.id,
    cityId,
    name: p.name,
    categories: p.categories,
    address: "契约测试地址",
    coordinates: {
      longitude: p.longitude,
      latitude: p.latitude,
      coordinateSystem: "GCJ-02",
    },
    suggestedDurationMinutes: p.duration,
    description: "测试资料",
    openingHoursText: null,
    source: "fixture",
    updatedAt: fixedNow,
  }));
  return {
    destinations: [
      {
        id: provinceId,
        name: "浙江省",
        level: "province",
        parentId: null,
        adcode: "330000",
        timeZone: "Asia/Shanghai",
      },
      {
        id: cityId,
        name: "杭州市",
        level: "city",
        parentId: provinceId,
        adcode: "330100",
        timeZone: "Asia/Shanghai",
      },
    ],
    places,
    input: {
      cityId,
      startDate: "2026-11-01",
      endDate: "2026-11-02",
      themes: ["history", "nature"],
      pace: "standard",
      transportMode: "walking",
      selectedPlaceIds: places.map((p) => p.id),
    },
  };
}
// These values are copied from the team's contract, not from PACE_POLICY under test.
const policies = {
  relaxed: { start: 600, end: 1080, rest: 30, count: 2 },
  standard: { start: 540, end: 1080, rest: 15, count: 3 },
  intensive: { start: 480, end: 1080, rest: 10, count: 4 },
};
module.exports = {
  fixtures,
  policies,
  id,
  provinceId,
  cityId,
  userA,
  userB,
  fixedNow,
};
