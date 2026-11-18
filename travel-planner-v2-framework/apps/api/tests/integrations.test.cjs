const test = require('node:test');
const assert = require('node:assert/strict');
const { AmapClient } = require('../dist/integrations/amap/amap.client.js');
const { GeoService, walkingEstimate } = require('../dist/integrations/amap/geo.service.js');
const { readBConfig } = require('../dist/b/config.js');
const { coordinates } = require('../dist/b/validation.js');
const { fixture, serviceFixture } = require('./helpers/b.cjs');
const from = fixture.places[0].coordinates,
  to = fixture.places[1].coordinates;
function clientWith(payload, options = {}) {
  const calls = [];
  const config = { values: readBConfig({ AMAP_WEB_SERVICE_KEY: 'private-test-key', ...options }) };
  const client = new AmapClient(config, async (url) => {
    calls.push(new URL(url));
    return { ok: true, json: async () => payload };
  });
  return { client, calls };
}
test('walking/driving/transit select v5 endpoints and explicitly request duration cost', async () => {
  for (const mode of ['walking', 'driving', 'transit']) {
    const path = { cost: { duration: '61' } };
    const { client, calls } = clientWith({
      status: '1',
      infocode: '10000',
      route: mode === 'transit' ? { transits: [path] } : { paths: [path] },
    });
    assert.equal(await client.route(from, to, mode, '0571'), 2);
    assert.equal(calls[0].searchParams.get('show_fields'), 'cost');
    assert.ok(calls[0].pathname.includes(mode === 'transit' ? 'transit/integrated' : mode));
    if (mode === 'transit') assert.equal(calls[0].searchParams.get('city1'), '0571');
  }
});
test('public transit preview derives both cities and avoids silently guessing city codes', async () => {
  const { client, calls } = clientWith({
    status: '1',
    regeocode: {
      formatted_address: '测试地点',
      addressComponent: { adcode: '330106', citycode: '0571' },
    },
  });
  await assert.rejects(client.route(from, to, 'transit'), (e) => e.getStatus() === 503);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].searchParams.get('city1'), '0571');
  assert.equal(calls[2].searchParams.get('city2'), '0571');
});
test('route preview preserves provider paths as separate validated segments', async () => {
  const { client, calls } = clientWith({
    status: '1',
    route: {
      transits: [
        {
          cost: { duration: '61' },
          segments: [
            {
              walking: {
                steps: [
                  { polyline: { polyline: '116.39,39.91;116.4,39.92' } },
                  { polyline: ';116.42,39.93' },
                ],
              },
              bus: { buslines: [{ polyline: { polyline: '116.42,39.94;116.43,39.95' } }] },
            },
          ],
        },
      ],
    },
  });
  const route = await new GeoService(client, {}).route(from, to, 'transit', '010', undefined, true);
  assert.equal(calls[0].searchParams.get('show_fields'), 'cost,polyline');
  assert.deepEqual(route, {
    durationMinutes: 2,
    source: 'provider',
    warnings: [],
    transitSteps: [],
    paths: [
      [
        [116.39, 39.91],
        [116.4, 39.92],
      ],
      [
        [116.42, 39.94],
        [116.43, 39.95],
      ],
    ],
  });
});
test('business errors, missing/invalid duration, empty paths and malformed JSON never become zero-minute routes', async () => {
  for (const payload of [
    null,
    { status: '0', info: 'secret' },
    { status: '1', route: { paths: [] } },
    ...['', 'NaN', '-1', '0', [], null].map((duration) => ({
      status: '1',
      route: { paths: [{ cost: { duration } }] },
    })),
  ]) {
    const { client } = clientWith(payload);
    await assert.rejects(
      client.route(from, to, 'walking'),
      (e) => e.getStatus() === 503 && !JSON.stringify(e.getResponse()).includes('private-test-key'),
    );
  }
  const config = { values: readBConfig({ AMAP_WEB_SERVICE_KEY: 'secret' }) };
  for (const transport of [
    async () => {
      throw new Error('timeout with secret');
    },
    async () => ({ ok: false }),
    async () => ({
      ok: true,
      json: async () => {
        throw new Error('bad JSON');
      },
    }),
  ]) {
    await assert.rejects(
      new AmapClient(config, transport).route(from, to, 'driving'),
      (e) => e.getStatus() === 503,
    );
  }
});

test('transit preview keeps the selected bus line and its stations in the same order as walking and transfers', async () => {
  const { client } = clientWith({
    status: '1',
    route: {
      transits: [
        {
          cost: { duration: '1200' },
          segments: [
            {
              walking: { distance: '310', cost: { duration: '240' } },
              bus: {
                buslines: [
                  {
                    name: '地铁5号线(宋家庄--天通苑北)',
                    departure_stop: { name: '天坛东门', entrance: { name: 'C东南口' } },
                    arrival_stop: { name: '雍和宫', exit: { name: 'A西北口' } },
                    bus_time_tips: '测试运营提示',
                    via_num: '6',
                    distance: '7500',
                    cost: { duration: '660' },
                  },
                  { name: '另一条备选线路', departure_stop: { name: '其他站' } },
                ],
              },
            },
            {
              walking: { distance: '200', duration: '180' },
              bus: {
                buslines: [
                  {
                    name: '公交示例线路',
                    departure_stop: { name: '换乘站' },
                    arrival_stop: { name: '终点站' },
                    via_num: '0',
                  },
                ],
              },
            },
            { walking: { distance: '100' }, bus: { buslines: [] } },
            { walking: [], bus: { buslines: [{ name: [], via_num: '-1' }] } },
          ],
        },
      ],
    },
  });
  const result = await client.routeDetails(from, to, 'transit', '010', undefined, true);
  assert.deepEqual(result.transitSteps, [
    { mode: 'walking', name: '步行', distanceMeters: 310, durationMinutes: 4 },
    {
      mode: 'bus',
      name: '地铁5号线(宋家庄--天通苑北)',
      departureStop: '天坛东门',
      arrivalStop: '雍和宫',
      entrance: 'C东南口',
      exit: 'A西北口',
      serviceNotice: '测试运营提示',
      stopCount: 6,
      distanceMeters: 7500,
      durationMinutes: 11,
    },
    { mode: 'walking', name: '步行', distanceMeters: 200, durationMinutes: 3 },
    {
      mode: 'bus',
      name: '公交示例线路',
      departureStop: '换乘站',
      arrivalStop: '终点站',
      stopCount: 0,
    },
    { mode: 'walking', name: '步行', distanceMeters: 100 },
  ]);
  assert.equal(result.durationMinutes, 20);
});
test('no-key short walking estimates are explicit; driving, transit and far walking fail closed', async () => {
  const { places } = serviceFixture();
  const client = new AmapClient({ values: readBConfig({}) }, async () => {
    throw new Error('must not fetch');
  });
  const geo = new GeoService(client, places);
  const result = await geo.route(from, to, 'walking');
  assert.equal(result.source, 'estimate');
  assert.ok(result.durationMinutes > 0);
  assert.equal(result.warnings[0].code, 'ROUTE_ESTIMATED');
  for (const mode of ['driving', 'transit'])
    await assert.rejects(geo.route(from, to, mode), (e) => e.getStatus() === 503);
  await assert.rejects(
    geo.route(from, fixture.places[2].coordinates, 'walking'),
    (e) => e.getStatus() === 503,
  );
  assert.equal(walkingEstimate(from, fixture.places[2].coordinates), null);
});
test('reverse lookup maps district to platform city, unknown city stays null, empty city arrays are tolerated', async () => {
  const { places } = serviceFixture();
  for (const [adcode, expected] of [
    ['330106', fixture.destinations[1].id],
    ['110108', null],
    ['', null],
  ]) {
    const { client } = clientWith({
      status: '1',
      regeocode: { formatted_address: '测试地点', addressComponent: { adcode, city: [] } },
    });
    const result = await new GeoService(client, places).reverse(from);
    assert.equal(result.cityId, expected);
    assert.equal(result.cityAdcode, expected ? '330100' : null);
    assert.equal(result.warnings.length, expected ? 0 : 1);
  }
});
test('GPS conversion calls actual conversion semantics and validates output coordinates', async () => {
  const { client, calls } = clientWith({ status: '1', locations: '120.123456,30.123456' });
  assert.deepEqual(await client.convertGps(120, 30), {
    longitude: 120.123456,
    latitude: 30.123456,
    coordinateSystem: 'GCJ-02',
  });
  assert.equal(calls[0].searchParams.get('coordsys'), 'gps');
  for (const value of ['999,30', '120,', '120,30;120,30', 'not-coordinates']) {
    await assert.rejects(clientWith({ status: '1', locations: value }).client.convertGps(120, 30));
  }
  assert.throws(() => coordinates({ ...from, coordinateSystem: 'WGS84' }));
});
test('B config validates timeouts, caps and TTL without requiring optional API keys', () => {
  assert.equal(readBConfig({}).proposalTtlMinutes, 30);
  for (const env of [
    { B_EXTERNAL_TIMEOUT_MS: '0' },
    { B_MAX_ROUTE_CALLS: '121' },
    { B_GENERATION_TIMEOUT_MS: 'NaN' },
    { B_PROPOSAL_TTL_MINUTES: '-1' },
  ])
    assert.throws(() => readBConfig(env));
});
