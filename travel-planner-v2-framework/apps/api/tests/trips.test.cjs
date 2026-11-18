const test = require('node:test');
const assert = require('node:assert/strict');
const { TripsService } = require('../dist/trips/trips.service');
const { TripRepository, PostgresTripRepository } = require('../dist/trips/trip.repository');
const { CuratedBeijingCatalog, BEIJING_CITY_ID } = require('../dist/trips/trip-catalog');
const {
  createInput,
  patchInput,
  selectionsInput,
  pagination,
} = require('../dist/trips/trip-validation');
const { ApiError } = require('../dist/common/api-error');
const ID = '11000000-0000-4000-8002-000000000001';
const placeId = '11000000-0000-4000-8001-000000000001';
function trip() {
  return {
    id: ID,
    ownerId: 'owner',
    title: '北京草稿',
    revision: 1,
    status: 'draft',
    planningInput: {
      cityId: BEIJING_CITY_ID,
      startDate: null,
      endDate: null,
      themes: [],
      pace: 'standard',
      transportMode: 'walking',
      selectedPlaceIds: [],
    },
    days: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
function memory() {
  let value = null,
    tail = Promise.resolve();
  const repo = {
    async create(owner, input) {
      value = { ...trip(), ownerId: owner, title: input.title };
      return structuredClone(value);
    },
    async get(owner, id) {
      if (!value || value.ownerId !== owner || value.id !== id)
        throw new ApiError('NOT_FOUND', '行程不存在', 404);
      return structuredClone(value);
    },
    async list(owner, page, pageSize) {
      return {
        items: value?.ownerId === owner ? [structuredClone(value)] : [],
        page,
        pageSize,
        total: value?.ownerId === owner ? 1 : 0,
      };
    },
    mutate(owner, id, revision, change) {
      const operation = tail.then(async () => {
        const current = await repo.get(owner, id);
        if (current.revision !== revision)
          throw new ApiError('REVISION_CONFLICT', '冲突', 409, {
            currentRevision: current.revision,
          });
        const next = await change(current);
        value = { ...next, revision: current.revision + 1 };
        return structuredClone(value);
      });
      tail = operation.catch(() => {});
      return operation;
    },
    seed(next) {
      value = next;
    },
    async remove(owner, id, revision) {
      await repo.mutate(owner, id, revision, async (current) => current);
      value = null;
    },
  };
  return repo;
}
test('确认高德方案使用推荐规则校验，允许短于手动排程估算的路段', async () => {
  const repo = memory();
  const catalog = new CuratedBeijingCatalog();
  const current = trip();
  const [first, second] = await catalog.getCityPlaces(BEIJING_CITY_ID);
  const date = '2026-11-20';
  Object.assign(current.planningInput, {
    startDate: date,
    endDate: date,
    selectedPlaceIds: [first.id, second.id],
  });
  repo.seed(current);
  const days = [
    {
      date,
      items: [
        {
          placeId: first.id,
          position: 0,
          startTime: '09:00',
          durationMinutes: first.suggestedDurationMinutes,
          travelMinutesFromPrevious: 0,
          travelTimeSource: 'none',
          reason: '',
        },
        {
          placeId: second.id,
          position: 1,
          startTime: '13:16',
          durationMinutes: second.suggestedDurationMinutes,
          travelMinutesFromPrevious: 1,
          travelTimeSource: 'provider',
          reason: '',
        },
      ],
    },
  ];
  const service = new TripsService(repo, catalog, {
    getOwnedProposal: async () => ({
      inputSnapshot: current.planningInput,
      days,
      unassignedPlaceIds: [],
    }),
  });
  const saved = await service.applyProposal('owner', ID, 1, 'proposal');
  assert.equal(saved.status, 'planned');
  assert.deepEqual(saved.days, days);
  await assert.rejects(
    service.updateSchedule('owner', ID, saved.revision, days),
    (error) => error.code === 'INVALID_SCHEDULE',
  );
});
test('拒绝伪造 owner、未知字段、错误日期、重复景点和过大分页', () => {
  assert.throws(() => createInput({ title: '北京', cityId: BEIJING_CITY_ID, ownerId: 'other' }));
  for (const input of [
    { startDate: '2026-02-29', endDate: '2026-03-01' },
    { startDate: '2026-01-01', endDate: '2026-01-31' },
    { startDate: null },
    { selectedPlaceIds: [] },
  ])
    assert.throws(() => patchInput({ expectedRevision: 1, planningInput: input }));
  assert.doesNotThrow(() =>
    patchInput({
      expectedRevision: 1,
      planningInput: { startDate: '2028-02-29', endDate: '2028-03-01' },
    }),
  );
  assert.throws(() => selectionsInput({ expectedRevision: 1, placeIds: [placeId, placeId] }));
  assert.throws(() => pagination('1', '101'));
});

test('跨天移动保留其他日期的已确认路线，同时拒绝重复景点和修改其他日期的高德耗时', async () => {
  const repo = memory();
  const catalog = new CuratedBeijingCatalog();
  const [first, second, third] = await catalog.getCityPlaces(BEIJING_CITY_ID);
  const current = trip();
  const [monday, tuesday, wednesday] = ['2026-11-23', '2026-11-24', '2026-11-25'];
  Object.assign(current.planningInput, {
    startDate: monday,
    endDate: wednesday,
    selectedPlaceIds: [first.id, second.id, third.id],
  });
  function firstStop(place) {
    return {
      placeId: place.id,
      position: 0,
      startTime: '09:00',
      durationMinutes: place.suggestedDurationMinutes,
      travelMinutesFromPrevious: 0,
      travelTimeSource: 'none',
      reason: '',
    };
  }
  const unchanged = {
    date: monday,
    items: [
      firstStop(first),
      {
        ...firstStop(second),
        position: 1,
        startTime: '13:16',
        travelMinutesFromPrevious: 1,
        travelTimeSource: 'provider',
      },
    ],
  };
  current.status = 'planned';
  current.days = [
    unchanged,
    { date: tuesday, items: [firstStop(third)] },
    { date: wednesday, items: [] },
  ];
  repo.seed(current);
  const service = new TripsService(repo, catalog, {});
  const moved = [
    unchanged,
    { date: tuesday, items: [] },
    { date: wednesday, items: [firstStop(third)] },
  ];
  const duplicate = [unchanged, current.days[1], moved[2]];
  await assert.rejects(
    service.updateSchedule('owner', ID, 1, duplicate),
    (error) => error.code === 'INVALID_SCHEDULE',
  );
  const invented = structuredClone(moved);
  invented[0].items[1].travelMinutesFromPrevious = 2;
  await assert.rejects(
    service.updateSchedule('owner', ID, 1, invented),
    (error) => error.code === 'INVALID_SCHEDULE',
  );
  const saved = await service.updateSchedule('owner', ID, 1, moved);
  assert.deepEqual(saved.days, moved);
  assert.equal(saved.revision, 2);
});
test('草稿保存日期偏好与选择，可重新读取且保持 draft', async () => {
  const repo = memory(),
    service = new TripsService(repo, new CuratedBeijingCatalog());
  const created = await service.create('owner', { title: '北京草稿', cityId: BEIJING_CITY_ID });
  const updated = await service.update(
    'owner',
    created.id,
    patchInput({
      expectedRevision: 1,
      planningInput: {
        startDate: '2026-11-01',
        endDate: '2026-11-03',
        themes: ['nature', 'history'],
        pace: 'relaxed',
        transportMode: 'transit',
      },
    }),
  );
  const selected = await service.selections(
    'owner',
    updated.id,
    selectionsInput({ expectedRevision: 2, placeIds: [placeId] }),
  );
  assert.equal(selected.revision, 3);
  assert.equal(selected.status, 'draft');
  assert.deepEqual(selected.days, []);
  assert.deepEqual((await service.get('owner', ID)).planningInput.selectedPlaceIds, [placeId]);
  await assert.rejects(service.get('other', ID), (error) => error.code === 'NOT_FOUND');
  await assert.rejects(
    service.selections('owner', ID, { expectedRevision: 3, placeIds: [ID] }),
    (error) => error.code === 'VALIDATION_ERROR',
  );
  assert.equal((await service.get('owner', ID)).revision, 3);
});
test('相同版本并发写只接受一次，过期版本不覆盖已保存内容', async () => {
  const repo = memory();
  repo.seed(trip());
  const service = new TripsService(repo, new CuratedBeijingCatalog());
  const results = await Promise.allSettled([
    service.update('owner', ID, { expectedRevision: 1, title: '甲' }),
    service.update('owner', ID, { expectedRevision: 1, title: '乙' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  assert.equal((await service.get('owner', ID)).revision, 2);
});
test('planned 改标题保留安排；条件变化需明确重置', async () => {
  const repo = memory(),
    value = trip();
  value.status = 'planned';
  value.days = [{ date: '2026-11-01', items: [] }];
  repo.seed(value);
  const service = new TripsService(repo, new CuratedBeijingCatalog());
  assert.equal(
    (await service.update('owner', ID, { expectedRevision: 1, title: '新标题' })).status,
    'planned',
  );
  await assert.rejects(
    service.update('owner', ID, { expectedRevision: 2, planningInput: { pace: 'intensive' } }),
    (e) => e.code === 'SCHEDULE_RESET_REQUIRED',
  );
  const reset = await service.update('owner', ID, {
    expectedRevision: 2,
    planningInput: { pace: 'intensive' },
    acknowledgeScheduleReset: true,
  });
  assert.equal(reset.status, 'draft');
  assert.deepEqual(reset.days, []);
});
test('Postgres 仓库在事务内锁定行并带版本条件更新', async () => {
  const value = trip();
  const row = {
    id: ID,
    owner_id: 'owner',
    title: value.title,
    city_id: BEIJING_CITY_ID,
    revision: 1,
    status: 'draft',
    start_date: null,
    end_date: null,
    themes: [],
    pace: 'standard',
    transport_mode: 'walking',
    selected_place_ids: [],
    days: [],
    created_at: new Date(),
    updated_at: new Date(),
  };
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [sql.startsWith('UPDATE') ? { ...row, title: '更新', revision: 2 } : row] };
    },
  };
  const repository = new PostgresTripRepository({
    async transaction(work) {
      return work(client);
    },
  });
  const result = await repository.mutate('owner', ID, 1, async (current) => ({
    ...current,
    title: '更新',
  }));
  assert.match(queries[0].sql, /FOR UPDATE/);
  const update = queries.find((q) => q.sql.startsWith('UPDATE'));
  assert.match(update.sql, /owner_id=\$1 AND id=\$2 AND revision=\$3/);
  assert.deepEqual(update.params.slice(0, 4), ['owner', ID, 1, '更新']);
  assert.equal(result.revision, 2);
  queries.length = 0;
  await assert.rejects(
    repository.mutate('owner', ID, 8, async (current) => current),
    (e) => e.code === 'REVISION_CONFLICT',
  );
  assert.equal(queries.length, 1);
});
test('HTTP 接入鉴权、校验、创建、保存、读取、分页和错误格式', async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
  const { createApp } = require('../dist/app');
  const { AuthService } = require('../dist/auth/auth.service');
  let app;
  try {
    app = await createApp({ logger: false });
    app.get(AuthService).verifyAccessToken = async (token) =>
      token === 'owner-token' ? 'owner' : token === 'other-token' ? 'other' : null;
    const repo = memory(),
      actual = app.get(TripRepository);
    for (const name of ['create', 'get', 'list', 'mutate', 'remove']) actual[name] = repo[name];
    const { TripCatalog } = require('../dist/trips/trip-catalog');
    const actualCatalog = app.get(TripCatalog),
      fakeCatalog = new CuratedBeijingCatalog();
    for (const name of ['assertCityExists', 'getCityPlaces', 'assertPlacesBelongToCity'])
      actualCatalog[name] = fakeCatalog[name].bind(fakeCatalog);
    await app.listen(0, '127.0.0.1');
    const base = `${await app.getUrl()}/api`;
    async function request(path, method = 'GET', body, token = 'owner-token') {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        body: response.status === 204 ? null : await response.json(),
      };
    }
    assert.equal((await request('/trips', 'GET', undefined, '')).status, 401);
    assert.equal((await request('/trips', 'GET', undefined, 'unknown-token')).status, 401);
    assert.equal((await request('/places', 'GET', undefined, '')).status, 401);
    assert.equal((await request('/places', 'GET', undefined, 'owner-token')).status, 400);
    const created = await request('/trips', 'POST', { title: '北京草稿', cityId: BEIJING_CITY_ID });
    assert.equal(created.status, 201);
    assert.equal(created.body.revision, 1);
    const patch = await request(`/trips/${ID}`, 'PATCH', {
      expectedRevision: 1,
      planningInput: { startDate: '2026-11-01', endDate: '2026-11-02' },
    });
    assert.equal(patch.status, 200);
    const selected = await request(`/trips/${ID}/selections`, 'PUT', {
      expectedRevision: 2,
      placeIds: [placeId],
    });
    assert.equal(selected.body.revision, 3);
    const get = await request(`/trips/${ID}`);
    assert.deepEqual(get.body.planningInput.selectedPlaceIds, [placeId]);
    const denied = await request(`/trips/${ID}`, 'GET', undefined, 'other-token');
    assert.equal(denied.status, 404);
    const conflict = await request(`/trips/${ID}`, 'PATCH', {
      expectedRevision: 1,
      title: '旧版本',
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, 'REVISION_CONFLICT');
    assert.equal((await request('/trips')).body.total, 1);
    assert.equal((await request('/trips/not-a-uuid')).status, 400);
    assert.equal(
      (
        await request(`/trips/${ID}`, 'PATCH', {
          expectedRevision: 3,
          planningInput: { startDate: '2026-02-30', endDate: '2026-03-01' },
        })
      ).status,
      400,
    );
    assert.equal(
      (await request(`/trips/${ID}?expectedRevision=3`, 'DELETE', undefined, 'other-token')).status,
      404,
    );
    assert.equal((await request(`/trips/${ID}?expectedRevision=1`, 'DELETE')).status, 409);
    assert.equal((await request(`/trips/${ID}?expectedRevision=3`, 'DELETE')).status, 204);
    assert.equal((await request(`/trips/${ID}`)).status, 404);
  } finally {
    if (app) await app.close();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test('临时后端目录与前端 18 个景点资源 ID 一致', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ts = require('typescript');
  const source = fs.readFileSync(path.resolve(__dirname, '../../web/src/data/beijing.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const frontend = { exports: {} };
  new Function('exports', 'module', 'require', compiled)(frontend.exports, frontend, require);
  const city = frontend.exports.beijing;
  const places = frontend.exports.listPlaces(city.id);
  assert.equal(city.id, BEIJING_CITY_ID);
  assert.equal(places.length, 18);
  await new CuratedBeijingCatalog().assertPlacesBelongToCity(
    city.id,
    places.map((place) => place.id),
  );
});
