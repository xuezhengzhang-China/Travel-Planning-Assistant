// Acceptance-only composition: isolated test schema and injected test identities.
// Production AppModule never imports this file or trusts these bearer values.
require('reflect-metadata');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createServer } = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { Client } = require('pg');
const { runner } = require('node-pg-migrate');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const root = path.resolve(__dirname, '../../../..');
require('dotenv').config({ path: path.join(root, '.env') });
const { testDatabaseUrl } = require('../test-integration-b.cjs');
const { seedB } = require('../seed-b.cjs');
const { BModule } = require('../../dist/b/b.module.js');
const { B_AUTHENTICATOR } = require('../../dist/b/identity.js');
const { BConfig, readBConfig } = require('../../dist/b/config.js');
const { B_FETCH, AmapClient } = require('../../dist/integrations/amap/amap.client.js');
const {
  PROPOSAL_READER,
  isProposalExpired,
} = require('../../dist/recommendations/recommendations.service.js');
const { validateModelOrder } = require('../../dist/integrations/llm/llm.advisor.js');
const fixture = require('../../../../docs/examples/demo-scenario.json');
const output = process.env.B_ACCEPTANCE_OUTPUT && path.resolve(process.env.B_ACCEPTANCE_OUTPUT);
const cases = [],
  httpEvidence = [],
  mapEvidence = [],
  modelEvidence = [];
const input = fixture.requests.recommendationRequest;
const city = fixture.destinations[1].id;
const [p1, p2, p3] = fixture.places;
const good = 'Bearer acceptance-injected-primary';
const other = 'Bearer acceptance-injected-other';
const startedAt = new Date().toISOString();
let app, admin, mapServer;
let mode = 'ok',
  adcode = '330106',
  calls = 0;
let settings;
const previousDatabase = process.env.DATABASE_URL;
const schema = `b_full_${randomUUID().replaceAll('-', '')}`;

function save(name, value) {
  if (output) {
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
  }
}
async function check(id, name, action, kind = 'controlled-http-real-db') {
  const begin = Date.now();
  try {
    await action();
    cases.push({ id, name, kind, status: 'passed', elapsedMs: Date.now() - begin });
    console.log(`PASS ${id}: ${name}`);
  } catch (error) {
    cases.push({
      id,
      name,
      kind,
      status: 'failed',
      elapsedMs: Date.now() - begin,
      error: error.message,
    });
    console.error(`FAIL ${id}: ${name}: ${error.message}`);
  }
}
async function request(method, endpoint, body, expected = 200, authorization = good) {
  const response = await fetch(`${await app.getUrl()}/api${endpoint}`, {
    method,
    headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  httpEvidence.push({
    caseId: currentCase,
    method,
    endpoint,
    identity:
      authorization === good
        ? 'injected-primary'
        : authorization === other
          ? 'injected-other'
          : 'anonymous-or-forged',
    request: body,
    status: response.status,
    response: result,
  });
  assert.equal(response.status, expected, JSON.stringify(result));
  if (expected >= 400) {
    assert.equal(typeof result.code, 'string');
    assert.equal(typeof result.message, 'string');
    assert.ok(!JSON.stringify(result).includes('contract-fixture-key'));
    assert.ok(!JSON.stringify(result).includes('SELECT '));
  }
  return result;
}
let currentCase;
async function scenario(id, title, action, kind) {
  currentCase = id;
  await check(id, title, action, kind);
}
async function count() {
  return Number((await admin.query('SELECT count(*) FROM recommendation_proposals')).rows[0].count);
}
const route = (transportMode = 'walking', to = p2.coordinates) => ({
  from: p1.coordinates,
  to,
  transportMode,
});

async function main() {
  const url = new URL(testDatabaseUrl(process.env.TEST_DATABASE_URL));
  admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(`SET search_path TO "${schema}", public`);
  await runner({
    dbClient: admin,
    dir: path.join(root, 'apps/api/migrations'),
    direction: 'up',
    schema,
    migrationsSchema: schema,
    migrationsTable: 'pgmigrations',
    log: () => {},
  });
  await seedB(admin);
  await scenario(
    'SEED-ATOMIC',
    'seed preserves curated places and rolls back all changes on an insert/update error',
    async () => {
      await admin.query("UPDATE places SET source='curated',name='人工维护名称' WHERE id=$1", [
        p1.id,
      ]);
      await seedB(admin);
      assert.equal(
        (await admin.query('SELECT name FROM places WHERE id=$1', [p1.id])).rows[0].name,
        '人工维护名称',
      );
      await admin.query("UPDATE destinations SET name='事务前名称' WHERE id=$1", [
        fixture.destinations[0].id,
      ]);
      await admin.query(
        "CREATE FUNCTION fail_seed_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'seed rollback acceptance'; END $$",
      );
      await admin.query(
        'CREATE TRIGGER seed_failure BEFORE INSERT OR UPDATE ON places FOR EACH ROW EXECUTE FUNCTION fail_seed_update()',
      );
      try {
        await assert.rejects(seedB(admin));
        assert.equal(
          (
            await admin.query('SELECT name FROM destinations WHERE id=$1', [
              fixture.destinations[0].id,
            ])
          ).rows[0].name,
          '事务前名称',
        );
      } finally {
        await admin.query('DROP TRIGGER seed_failure ON places');
        await admin.query("UPDATE places SET source='fixture' WHERE id=$1", [p1.id]);
        await seedB(admin);
      }
    },
  );
  for (const [name, actor] of Object.entries(fixture.actors))
    await admin.query('INSERT INTO users(id,email) VALUES($1,$2)', [
      actor.userId,
      `${name}@full-test.invalid`,
    ]);
  url.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = url.toString();
  mapServer = createServer(async (req, res) => {
    calls++;
    const u = new URL(req.url, 'http://fixture.invalid');
    u.searchParams.delete('key');
    mapEvidence.push({
      caseId: currentCase,
      path: u.pathname,
      parameters: Object.fromEntries(u.searchParams),
      mode,
      service: 'controlled HTTP fixture, not AMap',
    });
    res.setHeader('content-type', 'application/json');
    if (mode === 'slow') await delay(100);
    if (mode === 'http') {
      res.writeHead(503);
      return res.end('{}');
    }
    if (mode === 'json') return res.end('not-json');
    if (mode === 'business')
      return res.end(
        JSON.stringify({ status: '0', infocode: '10001', info: 'contract-fixture-key' }),
      );
    if (u.pathname.includes('coordinate/convert'))
      return res.end(JSON.stringify({ status: '1', locations: '120.148,30.245' }));
    if (u.pathname.includes('regeo'))
      return res.end(
        JSON.stringify({
          status: '1',
          regeocode: {
            formatted_address: '合同测试地址',
            addressComponent: { city: [], citycode: '0571', adcode },
          },
        }),
      );
    const duration = mode === 'duration' ? 'NaN' : '2701';
    res.end(
      JSON.stringify({
        status: '1',
        infocode: '10000',
        route: { paths: [{ cost: { duration } }], transits: [{ cost: { duration } }] },
      }),
    );
  });
  await new Promise((resolve) => mapServer.listen(0, '127.0.0.1', resolve));
  const mapBase = `http://127.0.0.1:${mapServer.address().port}`;
  settings = { values: readBConfig({ AMAP_WEB_SERVICE_KEY: 'contract-fixture-key' }) };
  const transport = async (value, options) => {
    const address = new URL(value);
    if (address.hostname === 'restapi.amap.com')
      return fetch(new URL(address.pathname + address.search, mapBase), options);
    const body = options?.body && JSON.parse(options.body);
    const started = Date.now();
    const record = {
      caseId: currentCase,
      endpoint: address.toString(),
      request: body,
    };
    modelEvidence.push(record);
    try {
      const response = await fetch(value, options);
      record.httpStatus = response.status;
      record.response = await response.clone().json();
      return response;
    } catch (error) {
      record.errorType = error.name;
      throw error;
    } finally {
      record.elapsedMs = Date.now() - started;
    }
  };
  class FullRoot {}
  Module({
    imports: [
      BModule.register({
        providers: [
          { provide: BConfig, useValue: settings },
          { provide: B_FETCH, useValue: transport },
          {
            provide: B_AUTHENTICATOR,
            useValue: {
              authenticate: async (header) =>
                header === good
                  ? fixture.actors.primary
                  : header === other
                    ? fixture.actors.other
                    : null,
            },
          },
        ],
      }),
    ],
  })(FullRoot);
  const start = async () => {
    const server = await NestFactory.create(FullRoot, { logger: false });
    server.setGlobalPrefix('api');
    await server.listen(0, '127.0.0.1');
    return server;
  };
  app = await start();
  for (const [i, endpoint] of [
    '/destinations',
    `/places?cityId=${city}`,
    `/places/${p1.id}`,
    '/routes/preview',
    '/locations/reverse',
    '/recommendations/itinerary',
  ].entries()) {
    const post = i >= 3;
    for (const [label, auth] of [
      ['anonymous', ''],
      ['forged', 'Bearer forged'],
    ])
      await scenario(`AUTH-${i + 1}-${label}`, `${endpoint}: ${label} rejected`, () =>
        request(post ? 'POST' : 'GET', endpoint, post ? {} : undefined, 401, auth),
      );
  }
  await scenario(
    'CAT-01',
    'province/city/parent/keyword filters and empty page total',
    async () => {
      assert.equal(
        (await request('GET', '/destinations?level=province')).items[0].id,
        fixture.destinations[0].id,
      );
      assert.equal(
        (
          await request(
            'GET',
            `/destinations?level=city&parentId=${fixture.destinations[0].id}&keyword=${encodeURIComponent('杭州')}`,
          )
        ).total,
        1,
      );
      const empty = await request('GET', '/destinations?page=999');
      assert.equal(empty.total, 2);
      assert.deepEqual(empty.items, []);
    },
  );
  await scenario(
    'CAT-02',
    'SQL filtering/ranking before pagination, stable tie and literal search',
    async () => {
      const a = await request(
        'GET',
        `/places?cityId=${city}&category=history&themes=art&pageSize=1`,
      );
      assert.equal(a.total, 2);
      assert.equal(a.items[0].id, p3.id);
      const b = await request(
        'GET',
        `/places?cityId=${city}&category=history&themes=art&pageSize=1&page=2`,
      );
      assert.equal(b.items[0].id, p2.id);
      assert.equal(
        (
          await request(
            'GET',
            `/places?cityId=${city}&keyword=${encodeURIComponent("%' OR 1=1 --")}`,
          )
        ).total,
        0,
      );
      assert.deepEqual((await request('GET', `/places?cityId=${city}&page=999`)).items, []);
      assert.equal(
        (await request('GET', `/places?cityId=${city}&keyword=${encodeURIComponent('西湖')}`))
          .total,
        1,
      );
    },
  );
  await scenario('CAT-03', 'complete detail and 404 for unknown place', async () => {
    const detail = await request('GET', `/places/${p1.id}`);
    assert.equal(detail.coordinates.coordinateSystem, 'GCJ-02');
    assert.equal(detail.source, 'fixture');
    assert.equal(detail.suggestedDurationMinutes, 90);
    await request('GET', `/places/${randomUUID()}`, undefined, 404);
  });
  const invalidQueries = [
    '/destinations?level=district',
    '/destinations?parentId=x',
    '/destinations?keyword=',
    '/destinations?page=0',
    '/destinations?page=-1',
    '/destinations?page=1.5',
    '/destinations?page=100001',
    '/destinations?pageSize=101',
    '/destinations?page=1&page=2',
    '/destinations?ownerId=spoof',
    '/places',
    '/places?cityId=bad',
    `/places?cityId=${fixture.destinations[0].id}`,
    `/places?cityId=${randomUUID()}`,
    `/places?cityId=${city}&category=unknown`,
    `/places?cityId=${city}&themes=unknown`,
    `/places?cityId=${city}&themes=nature,,art`,
    `/places?cityId=${city}&pageSize=0`,
    '/places/not-a-uuid',
  ];
  for (const [i, query] of invalidQueries.entries())
    await scenario(`VALID-Q-${i + 1}`, `invalid query: ${query}`, () =>
      request('GET', query, undefined, 400),
    );
  for (const transportMode of ['walking', 'driving', 'transit'])
    await scenario(
      `MAP-${transportMode}`,
      `${transportMode}: real adapter HTTP seconds rounded upward`,
      async () => {
        const result = await request('POST', '/routes/preview', route(transportMode));
        assert.deepEqual(result, { durationMinutes: 46, source: 'provider', warnings: [] });
        if (transportMode === 'transit') {
          const call = mapEvidence.at(-1);
          assert.equal(call.parameters.city1, '0571');
          assert.equal(call.parameters.city2, '0571');
        }
      },
    );
  await scenario(
    'MAP-REVERSE',
    'district maps exactly to platform city; city-name array accepted',
    async () => {
      const result = await request('POST', '/locations/reverse', { coordinates: p1.coordinates });
      assert.equal(result.cityId, city);
      assert.equal(result.cityAdcode, '330100');
    },
  );
  await scenario('MAP-UNKNOWN-CITY', 'unmapped district never guessed from prefix', async () => {
    adcode = '330199';
    try {
      const result = await request('POST', '/locations/reverse', { coordinates: p1.coordinates });
      assert.equal(result.cityId, null);
      assert.equal(result.cityAdcode, null);
      assert.equal(result.warnings[0].code, 'CITY_UNCONFIRMED');
    } finally {
      adcode = '330106';
    }
  });
  await scenario('MAP-GPS', 'internal GPS conversion consumes provider response', async () => {
    assert.deepEqual(await app.get(AmapClient).convertGps(120.14, 30.24), {
      longitude: 120.148,
      latitude: 30.245,
      coordinateSystem: 'GCJ-02',
    });
  });
  for (const fault of ['http', 'business', 'json', 'duration', 'slow'])
    await scenario(
      `MAP-FAIL-${fault}`,
      `${fault}: walking estimate, driving/transit 503`,
      async () => {
        mode = fault;
        const originalTimeout = settings.values.externalTimeoutMs;
        if (fault === 'slow') settings.values.externalTimeoutMs = 20;
        try {
          const result = await request('POST', '/routes/preview', route());
          assert.equal(result.source, 'estimate');
          assert.equal(result.warnings[0].code, 'ROUTE_ESTIMATED');
          await request('POST', '/routes/preview', route('driving'), 503);
          await request('POST', '/routes/preview', route('transit'), 503);
        } finally {
          mode = 'ok';
          settings.values.externalTimeoutMs = originalTimeout;
        }
      },
    );
  const badCoordinates = [
    { ...p1.coordinates, coordinateSystem: 'WGS-84' },
    { ...p1.coordinates, longitude: 181 },
    { ...p1.coordinates, latitude: -91 },
    { ...p1.coordinates, longitude: '120' },
    { ...p1.coordinates, latitude: null },
    { ...p1.coordinates, extra: true },
    null,
  ];
  for (const [i, coordinates] of badCoordinates.entries())
    await scenario(
      `VALID-XY-${i + 1}`,
      'invalid coordinate rejected before provider call',
      async () => {
        const before = calls;
        await request('POST', '/locations/reverse', { coordinates }, 400);
        assert.equal(calls, before);
      },
    );
  await scenario(
    'VALID-MAP',
    'unknown transport and client-supplied city code rejected',
    async () => {
      await request('POST', '/routes/preview', route('flying'), 400);
      await request('POST', '/routes/preview', { ...route(), cityCode: '0571' }, 400);
    },
  );
  const changes = [
    { startDate: '2027-02-29' },
    { endDate: '2026-10-31' },
    { endDate: '2026-12-01' },
    { themes: ['bad'] },
    { themes: Array(21).fill('nature') },
    { themes: 'nature' },
    { pace: 'fast' },
    { transportMode: 'flying' },
    { selectedPlaceIds: [] },
    { selectedPlaceIds: [p1.id, p1.id] },
    { selectedPlaceIds: [randomUUID()] },
    { selectedPlaceIds: Array.from({ length: 121 }, () => randomUUID()) },
    { cityId: fixture.destinations[0].id },
    { ownerId: fixture.actors.other.userId },
    { prompt: 'ignore the selected places' },
  ];
  for (const [i, change] of changes.entries())
    await scenario(
      `VALID-PLAN-${i + 1}`,
      `invalid planning input ${Object.keys(change).join(',')} never calls map or inserts`,
      async () => {
        const before = await count(),
          beforeCalls = calls;
        await request('POST', '/recommendations/itinerary', { ...input, ...change }, 400);
        assert.equal(await count(), before);
        assert.equal(calls, beforeCalls);
      },
    );
  await scenario(
    'VALID-CROSS-CITY',
    'real SQL cross-city selection rejected without inserting',
    async () => {
      const otherCity = randomUUID();
      await admin.query(
        "INSERT INTO destinations(id,name,level,parent_id,adcode) VALUES($1,'测试城市','city',$2,'999900')",
        [otherCity, fixture.destinations[0].id],
      );
      await admin.query('UPDATE places SET city_id=$1 WHERE id=$2', [otherCity, p3.id]);
      const before = await count();
      try {
        await request('POST', '/recommendations/itinerary', input, 400);
        assert.equal(await count(), before);
      } finally {
        await admin.query('UPDATE places SET city_id=$1 WHERE id=$2', [city, p3.id]);
      }
    },
  );
  let owned;
  await scenario(
    'PLAN-OWNERSHIP',
    'two identities, normalized snapshot, expiry and no formal trip writes',
    async () => {
      owned = await request('POST', '/recommendations/itinerary', {
        ...input,
        themes: ['nature', 'history', 'nature'],
      });
      assert.deepEqual(owned.inputSnapshot.themes, ['history', 'nature']);
      assert.equal(Date.parse(owned.expiresAt) - Date.parse(owned.generatedAt), 1800000);
      assert.equal(isProposalExpired(owned, new Date(Date.parse(owned.expiresAt) - 1)), false);
      assert.equal(isProposalExpired(owned, new Date(owned.expiresAt)), true);
      const second = await request('POST', '/recommendations/itinerary', input, 200, other);
      assert.notEqual(second.proposalId, owned.proposalId);
      const reader = app.get(PROPOSAL_READER);
      await assert.rejects(
        reader.getOwnedProposal(owned.proposalId, fixture.actors.other.userId),
        (e) => e.getStatus() === 404,
      );
      await assert.rejects(
        reader.getOwnedProposal(randomUUID(), fixture.actors.primary.userId),
        (e) => e.getStatus() === 404,
      );
      assert.equal((await admin.query('SELECT count(*) FROM trips')).rows[0].count, '0');
    },
  );
  await scenario(
    'PLAN-RESTART',
    'restart API/pool and read identical owned persisted proposal',
    async () => {
      await app.close();
      app = await start();
      assert.deepEqual(
        await app
          .get(PROPOSAL_READER)
          .getOwnedProposal(owned.proposalId, fixture.actors.primary.userId),
        owned,
      );
      const changed = await app
        .get(PROPOSAL_READER)
        .getOwnedProposal(owned.proposalId, fixture.actors.primary.userId);
      changed.days.length = 0;
      assert.deepEqual(
        await app
          .get(PROPOSAL_READER)
          .getOwnedProposal(owned.proposalId, fixture.actors.primary.userId),
        owned,
      );
    },
  );
  await scenario(
    'PLAN-OVERFLOW',
    'one-day relaxed pace returns explicit unassigned IDs',
    async () => {
      const result = await request('POST', '/recommendations/itinerary', {
        ...input,
        pace: 'relaxed',
        endDate: input.startDate,
      });
      assert.equal(result.days[0].items.length, 2);
      assert.deepEqual(result.unassignedPlaceIds, [p3.id]);
      assert.ok(result.warnings.some((w) => w.code === 'UNASSIGNED_PLACES'));
    },
  );
  await scenario(
    'PLAN-NO-KEY',
    'no map key: short estimate, distant separate day, required unknown route 503',
    async () => {
      settings.values.amapKey = '';
      try {
        const result = await request('POST', '/recommendations/itinerary', input);
        assert.deepEqual(
          result.days.map((d) => d.items.length),
          [2, 1],
        );
        assert.ok(result.warnings.some((w) => w.code === 'ROUTE_UNAVAILABLE_SEPARATED'));
        await request('POST', '/routes/preview', route('walking', p3.coordinates), 503);
        await request('POST', '/locations/reverse', { coordinates: p1.coordinates }, 503);
        const before = await count();
        await request(
          'POST',
          '/recommendations/itinerary',
          { ...input, endDate: input.startDate },
          503,
        );
        assert.equal(await count(), before);
      } finally {
        settings.values.amapKey = 'contract-fixture-key';
      }
    },
  );
  await scenario(
    'PLAN-DB-FAIL',
    'database insertion failure returns sanitized 500 and no partial proposal',
    async () => {
      const before = await count();
      await admin.query(
        "CREATE FUNCTION fail_acceptance_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private sql secret'; END $$",
      );
      await admin.query(
        'CREATE TRIGGER acceptance_insert_failure BEFORE INSERT ON recommendation_proposals FOR EACH ROW EXECUTE FUNCTION fail_acceptance_insert()',
      );
      try {
        const result = await request('POST', '/recommendations/itinerary', input, 500);
        assert.equal(result.code, 'INTERNAL_ERROR');
        assert.ok(!JSON.stringify(result).includes('private sql'));
        assert.equal(await count(), before);
      } finally {
        await admin.query('DROP TRIGGER acceptance_insert_failure ON recommendation_proposals');
      }
    },
  );
  await scenario(
    'PLAN-120',
    'real SQL/HTTP accepts 120 selections across 30 days with bounded route calls',
    async () => {
      const extraIds = Array.from({ length: 117 }, () => randomUUID());
      await admin.query(
        `INSERT INTO places(id,city_id,name,categories,address,longitude,latitude,coordinate_system,suggested_duration_minutes,description,source)
      SELECT new_id,city_id,'验收景点',categories,address,longitude,latitude,coordinate_system,1,'仅隔离 schema 中的规模验收数据','fixture'
      FROM places CROSS JOIN unnest($1::uuid[]) AS new_id WHERE id=$2`,
        [extraIds, p1.id],
      );
      const selections = [...input.selectedPlaceIds, ...extraIds];
      const beforeCalls = calls;
      const result = await request('POST', '/recommendations/itinerary', {
        ...input,
        pace: 'intensive',
        endDate: '2026-11-30',
        selectedPlaceIds: selections,
      });
      assert.equal(result.days.length, 30);
      assert.equal(result.unassignedPlaceIds.length, 0);
      assert.ok(result.days.every((day) => day.items.length === 4));
      assert.deepEqual(
        result.days.flatMap((day) => day.items.map((item) => item.placeId)).sort(),
        [...selections].sort(),
      );
      assert.ok(calls - beforeCalls <= settings.values.maxRouteCalls);
      const page = await request('GET', `/places?cityId=${city}&pageSize=100`);
      assert.equal(page.total, 120);
      assert.equal(page.items.length, 100);
      await request(
        'POST',
        '/recommendations/itinerary',
        { ...input, selectedPlaceIds: [...selections, randomUUID()] },
        400,
      );
    },
  );
  if (process.env.B_ACCEPT_REAL_LLM === 'true') {
    const real = readBConfig({ ...process.env, B_LLM_ENABLED: 'true' });
    await scenario(
      'LLM-REAL-PROMPT',
      'open-source model returns a real Chinese travel answer',
      async () => {
        const prompt =
          '仅根据这些给定资料，用中文三句话介绍游玩清单：杭州西湖建议游玩90分钟，灵隐寺120分钟，良渚博物院120分钟。不要补充交通、天气、票价或营业时间。';
        const start = Date.now();
        const response = await fetch(`${real.llmBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${real.llmKey}` },
          body: JSON.stringify({
            model: real.llmModel,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 256,
            temperature: 0,
          }),
          signal: globalThis.AbortSignal.timeout(60000),
        });
        const raw = await response.json();
        modelEvidence.push({
          caseId: currentCase,
          kind: 'real open-source inference, standalone model connectivity',
          request: { prompt, model: real.llmModel },
          httpStatus: response.status,
          elapsedMs: Date.now() - start,
          response: raw,
        });
        assert.equal(response.status, 200);
        assert.ok(raw.choices[0].message.content.length > 10);
      },
      'real-open-source-model',
    );
    await scenario(
      'LLM-REAL-B',
      'real B model prompt/completion validated and proposal persisted',
      async () => {
        const previous = settings.values;
        settings.values = {
          ...real,
          amapKey: 'contract-fixture-key',
          externalTimeoutMs: 15000,
          llmTimeoutMs: 45000,
          generationTimeoutMs: 60000,
        };
        const before = await count();
        try {
          const result = await request('POST', '/recommendations/itinerary', input);
          const evidence = modelEvidence.findLast((v) => v.caseId === currentCase);
          assert.ok(evidence, 'Expected an actual model HTTP request');
          assert.equal(evidence.httpStatus, 200);
          assert.equal(evidence.response.choices[0].finish_reason, 'stop');
          const order = validateModelOrder(
            JSON.parse(evidence.response.choices[0].message.content),
            input,
          );
          evidence.validatedOrder = order;
          assert.ok(!result.warnings.some((w) => w.code === 'MODEL_FALLBACK'));
          assert.equal(await count(), before + 1);
          assert.deepEqual(
            await app
              .get(PROPOSAL_READER)
              .getOwnedProposal(result.proposalId, fixture.actors.primary.userId),
            result,
          );
          evidence.proposal = result;
        } finally {
          settings.values = previous;
        }
      },
      'real-open-source-model-with-controlled-map-real-db',
    );
    await scenario(
      'LLM-REAL-NO-KEY',
      'real model plus real no-key B fallback generates and persists the demo without map fixtures',
      async () => {
        const previous = settings.values;
        const beforeMapCalls = calls;
        settings.values = { ...real, amapKey: '', llmTimeoutMs: 45000, generationTimeoutMs: 60000 };
        try {
          const result = await request('POST', '/recommendations/itinerary', input);
          const evidence = modelEvidence.findLast((v) => v.caseId === currentCase);
          assert.equal(evidence.httpStatus, 200);
          evidence.validatedOrder = validateModelOrder(
            JSON.parse(evidence.response.choices[0].message.content),
            input,
          );
          assert.ok(!result.warnings.some((w) => w.code === 'MODEL_FALLBACK'));
          assert.equal(result.unassignedPlaceIds.length, 0);
          assert.ok(result.warnings.some((w) => w.code === 'ROUTE_ESTIMATED'));
          assert.equal(calls, beforeMapCalls);
          assert.deepEqual(
            await app
              .get(PROPOSAL_READER)
              .getOwnedProposal(result.proposalId, fixture.actors.primary.userId),
            result,
          );
          evidence.proposal = result;
        } finally {
          settings.values = previous;
        }
      },
      'real-open-source-model-no-key-geo-real-db',
    );
  } else
    cases.push({
      id: 'LLM-REAL',
      name: 'Real model inference requires B_ACCEPT_REAL_LLM=true and model settings',
      status: 'blocked',
    });
}

main()
  .catch((error) => {
    cases.push({ id: 'SETUP', status: 'failed', error: error.message });
    console.error(error.message);
  })
  .finally(async () => {
    if (app) await app.close();
    if (mapServer) {
      mapServer.closeAllConnections();
      await new Promise((resolve) => mapServer.close(resolve));
    }
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    save('full-http-evidence.json', httpEvidence);
    save('map-contract-evidence.json', mapEvidence);
    save('real-model-evidence.json', modelEvidence);
    const summary = {
      startedAt,
      finishedAt: new Date().toISOString(),
      timeZone: 'Asia/Shanghai',
      isolatedSchemaDropped: true,
      passed: cases.filter((c) => c.status === 'passed').length,
      failed: cases.filter((c) => c.status === 'failed').length,
      blocked: cases.filter((c) => c.status === 'blocked').length,
      cases,
      scope: {
        database: 'real PostgreSQL in remote Docker',
        identities: 'injected for acceptance only; not C login',
        amap: 'controlled local HTTP responses through real AMap adapter',
        model: process.env.B_ACCEPT_REAL_LLM === 'true' ? 'real configured inference' : 'disabled',
        formalTrips: 'never written',
      },
    };
    save('full-b-results.json', summary);
    console.log(
      JSON.stringify({ passed: summary.passed, failed: summary.failed, blocked: summary.blocked }),
    );
    if (summary.failed) process.exitCode = 1;
  });
