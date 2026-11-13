import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(
  new URL('../src/features/trip-create/trip-draft-client.ts', import.meta.url),
  'utf8',
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const {
  createTripDraftApi,
  savePlanningDraft,
  toDraftPlanningInput,
  fromServerDraft,
  fromServerTrip,
} = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const draft = {
  cityId: '11000000-0000-4000-8000-000000000001',
  startDate: '',
  endDate: '',
  themes: ['历史文化'],
  pace: 'standard',
  transport: 'transit',
  selectedPlaceIds: ['p'],
};
test('未登录不发送请求，错误保留状态码和冲突信息', async () => {
  let requests = 0;
  const anonymous = createTripDraftApi({
    getAccessToken: () => null,
    fetcher: async () => {
      requests++;
    },
  });
  await assert.rejects(anonymous.get('id'), (e) => e.code === 'UNAUTHENTICATED');
  assert.equal(requests, 0);
  const api = createTripDraftApi({
    getAccessToken: () => 'token',
    fetcher: async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer token');
      return new Response(
        JSON.stringify({
          code: 'REVISION_CONFLICT',
          message: '冲突',
          details: { currentRevision: 4 },
        }),
        { status: 409 },
      );
    },
  });
  await assert.rejects(
    api.update('id', { expectedRevision: 2, title: '北京' }),
    (e) => e.status === 409 && e.details.currentRevision === 4,
  );
});
test('保存草稿按返回版本依次提交，不发送本地 days', async () => {
  const calls = [];
  const api = {
    async create(input) {
      calls.push(input);
      return { id: 'id', revision: 1 };
    },
    async update(id, input) {
      calls.push(input);
      return { id, revision: 2 };
    },
    async setSelections(id, input) {
      calls.push(input);
      return { id, revision: 3 };
    },
  };
  const saved = await savePlanningDraft(api, draft, '北京');
  assert.equal(saved.revision, 3);
  assert.deepEqual(calls[1].planningInput.themes, ['history']);
  assert.equal(calls[1].planningInput.startDate, null);
  assert.equal(calls[1].expectedRevision, 1);
  assert.equal(calls[2].expectedRevision, 2);
  assert.ok(!('days' in calls[1]));
});
test('部分失败携带已创建的 ID 与版本供恢复，不自动重新创建', async () => {
  let creations = 0;
  const api = {
    async create() {
      creations++;
      return { id: 'saved-id', revision: 1 };
    },
    async update(id) {
      return { id, revision: 2 };
    },
    async setSelections() {
      throw new Error('network');
    },
  };
  await assert.rejects(
    savePlanningDraft(api, draft, '北京'),
    (e) =>
      e.phase === 'selections' &&
      e.lastSavedTrip.id === 'saved-id' &&
      e.lastSavedTrip.revision === 2,
  );
  assert.equal(creations, 1);
});
test('服务器草稿可转回表单；planned 不会被静默转换或丢失安排', () => {
  const trip = {
    id: 'id',
    status: 'draft',
    planningInput: { ...toDraftPlanningInput(draft), selectedPlaceIds: ['p'] },
  };
  assert.deepEqual(fromServerDraft(trip).draft.themes, ['历史文化']);
  assert.throws(() => fromServerDraft({ ...trip, status: 'planned' }));
});

test('六类主题保存读取均保持一致，不丢失艺术及在地体验', () => {
  const labels = ['历史文化', '园林自然', '城市地标', '艺术设计', '亲子体验', '老街与在地体验'];
  for (const label of labels) {
    const planningInput = {
      ...toDraftPlanningInput({ ...draft, themes: [label] }),
      selectedPlaceIds: [],
    };
    assert.deepEqual(fromServerDraft({ status: 'draft', planningInput }).draft.themes, [label]);
  }
});

test('恢复已规划行程保留日期、每日顺序、名称并复制数组', () => {
  const resource = {
    status: 'planned',
    title: '已保存的北京行程',
    updatedAt: '2026-11-02T01:00:00Z',
    planningInput: {
      ...toDraftPlanningInput(draft),
      startDate: '2026-11-10',
      endDate: '2026-11-10',
      selectedPlaceIds: ['p', 'q'],
    },
    days: [{ date: '2026-11-10', items: [{ placeId: 'q' }, { placeId: 'p' }] }],
  };
  const state = fromServerTrip(resource);
  assert.equal(state.trip.title, resource.title);
  assert.deepEqual(state.trip.days[0].placeIds, ['q', 'p']);
  state.draft.selectedPlaceIds.pop();
  assert.equal(resource.planningInput.selectedPlaceIds.length, 2);
});

test('删除带版本参数并接受204空响应；景点目录读完分页', async () => {
  const calls = [];
  const api = createTripDraftApi({
    getAccessToken: () => 'token',
    fetcher: async (url, options) => {
      calls.push({ url, options });
      if (options.method === 'DELETE') return new Response(null, { status: 204 });
      const second = url.includes('page=2&');
      return new Response(
        JSON.stringify({
          items: [{ id: second ? 'b' : 'a' }],
          total: 2,
          page: second ? 2 : 1,
          pageSize: 100,
        }),
      );
    },
  });
  assert.equal(await api.remove('id', 8), undefined);
  assert.equal(calls[0].url, '/api/trips/id?expectedRevision=8');
  assert.deepEqual(
    (await api.getPlaces('city')).map((p) => p.id),
    ['a', 'b'],
  );
});
