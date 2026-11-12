const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('@travel/shared/beijing-catalog.json');
const { PlacesService } = require('../dist/places/c-places.service');
const { PlacesController } = require('../dist/places/places.controller');
const { MapService } = require('../dist/places/map.service');
const { coordinates } = require('../dist/places/map.controller');
const { paceSettings, generatePlan } = require('@travel/shared/recommendation-engine');
const point = { longitude: 116.4, latitude: 39.9, coordinateSystem: 'GCJ-02' };
const db = {
  query: async (sql) => ({
    rows: sql.includes('SELECT data')
      ? catalog.places.map((data) => ({ data }))
      : [{ id: catalog.city.id, adcode: '110000' }],
  }),
};
test('数据库景点先搜索和排序再分页，返回来源且不伪造坐标', async () => {
  const service = new PlacesService(db);
  const result = await service.places({
    cityId: catalog.city.id,
    themes: ['family'],
    pace: 'standard',
    page: 1,
    pageSize: 1,
  });
  assert.equal(result.total, 18);
  assert.equal(result.items.length, 1);
  assert.ok(result.items[0].categories.includes('family'));
  assert.equal(result.items[0].coordinates, null);
  assert.ok(result.items[0].sourceUrl);
  const filtered = await service.places({
    cityId: catalog.city.id,
    themes: [],
    pace: 'standard',
    keyword: '长城',
    page: 1,
    pageSize: 2,
  });
  assert.equal(filtered.total, 3);
  assert.equal(filtered.items.length, 2);
});
test('景点查询拒绝未知字段、非法主题、城市和坐标格式', () => {
  const controller = new PlacesController(new PlacesService(db));
  assert.throws(() => controller.list({ cityId: catalog.city.id, themes: 'invented' }));
  assert.throws(() => controller.list({ cityId: catalog.city.id, ownerId: 'fake' }));
  assert.throws(() => controller.list({ cityId: '110000' }));
  assert.throws(() => coordinates({ ...point, coordinateSystem: 'WGS84' }));
  assert.throws(() => coordinates({ ...point, longitude: Infinity }));
});
test('无Key不调用外部服务；上游错误与异常不泄露Key或URL', async () => {
  let calls = 0;
  const service = new MapService({ values: { amapWebServiceKey: '' } }, db, async () => {
    calls++;
  });
  await assert.rejects(
    service.preview(point, point, 'walking'),
    (e) => e.code === 'DEPENDENCY_UNAVAILABLE',
  );
  assert.equal(calls, 0);
  const failed = new MapService({ values: { amapWebServiceKey: 'test-secret' } }, db, async () => {
    throw new Error('test-secret');
  });
  await assert.rejects(
    failed.reverse(point),
    (e) => e.code === 'DEPENDENCY_UNAVAILABLE' && !e.message.includes('test-secret'),
  );
});
test('路线秒数向上转换为分钟；非法时长或空路线不伪装成功', async () => {
  const service = new MapService(
    { values: { amapWebServiceKey: 'test-key' } },
    db,
    async (url, options) => {
      assert.equal(url.origin, 'https://restapi.amap.com');
      assert.ok(options.signal);
      return {
        ok: true,
        json: async () => ({ status: '1', route: { paths: [{ duration: '601' }] } }),
      };
    },
  );
  const result = await service.preview(point, point, 'walking');
  assert.equal(result.durationMinutes, 11);
  assert.equal(result.source, 'provider');
  const empty = new MapService({ values: { amapWebServiceKey: 'test-key' } }, db, async () => ({
    ok: true,
    json: async () => ({ status: '1', route: { paths: [] } }),
  }));
  await assert.rejects(
    empty.preview(point, point, 'driving'),
    (e) => e.code === 'DEPENDENCY_UNAVAILABLE',
  );
});
test('公交通过解析城市编码查询；逆地理编码只关联数据库城市', async () => {
  const calls = [];
  const service = new MapService({ values: { amapWebServiceKey: 'test-key' } }, db, async (url) => {
    calls.push(url);
    return {
      ok: true,
      json: async () =>
        url.pathname.includes('regeo')
          ? {
              status: '1',
              regeocode: {
                formatted_address: '北京市测试位置',
                addressComponent: { adcode: '110101', citycode: '010' },
              },
            }
          : { status: '1', route: { transits: [{ duration: '3600' }] } },
    };
  });
  assert.equal((await service.preview(point, point, 'transit')).durationMinutes, 60);
  assert.equal(calls[2].searchParams.get('city'), '010');
  assert.equal((await service.reverse(point)).cityId, catalog.city.id);
});
test('统一排程参数与文档一致，所有节奏最晚18点结束并提示开放时间未核实', () => {
  assert.deepEqual(paceSettings.standard, { start: 540, budget: 540, count: 3, rest: 15 });
  for (const [pace, setting] of Object.entries(paceSettings)) {
    assert.equal(setting.start + setting.budget, 1080);
    const plan = generatePlan(catalog.places, {
      cityId: catalog.city.id,
      startDate: '2026-11-10',
      endDate: '2026-11-10',
      themes: [],
      pace,
      transportMode: 'transit',
      selectedPlaceIds: [catalog.places[0].id],
    });
    assert.ok(plan.warnings.some((w) => w.code === 'OPENING_HOURS_UNVERIFIED'));
  }
});
