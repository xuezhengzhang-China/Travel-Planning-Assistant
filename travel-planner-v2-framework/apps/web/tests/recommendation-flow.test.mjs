import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
const external = createRequire(import.meta.url),
  cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path).exports;
  const m = { exports: {} };
  cache.set(path, m);
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', compiled)(
    (specifier) =>
      specifier.startsWith('.')
        ? load(resolve(dirname(path), specifier + '.ts'))
        : external(specifier),
    m,
    m.exports,
  );
  return m.exports;
}
const { createRecommendationFlow } = load(
  fileURLToPath(new URL('../src/features/trip-create/recommendation-flow.ts', import.meta.url)),
);
const catalog = external('@travel/shared/beijing-catalog.json');
const { generatePlan } = external('@travel/shared/recommendation-engine');
const draft = {
  cityId: catalog.city.id,
  startDate: '2026-11-10',
  endDate: '2026-11-12',
  themes: ['历史文化'],
  pace: 'standard',
  transport: 'transit',
  selectedPlaceIds: [catalog.places[0].id, catalog.places[1].id],
};
function fixture(failSchedule = false) {
  let trip;
  let creates = 0;
  let plan;
  const update = (revision, change) => {
    assert.equal(revision, trip.revision);
    trip = { ...trip, ...change, revision: revision + 1 };
    return structuredClone(trip);
  };
  const api = {
    async create(input) {
      creates++;
      trip = {
        id: 'id',
        ownerId: 'owner',
        title: input.title,
        revision: 1,
        status: 'draft',
        planningInput: {
          cityId: input.cityId,
          startDate: null,
          endDate: null,
          themes: [],
          pace: 'standard',
          transportMode: 'walking',
          selectedPlaceIds: [],
        },
        days: [],
      };
      return structuredClone(trip);
    },
    async update(id, input) {
      return update(input.expectedRevision, {
        ...(input.title ? { title: input.title } : {}),
        ...(input.planningInput
          ? { planningInput: { ...trip.planningInput, ...input.planningInput } }
          : {}),
      });
    },
    async setSelections(id, input) {
      return update(input.expectedRevision, {
        planningInput: { ...trip.planningInput, selectedPlaceIds: input.placeIds },
      });
    },
    async generateProposal(input) {
      plan = generatePlan(catalog.places, input);
      return { ...plan, proposalId: 'proposal', inputSnapshot: input };
    },
    async applyProposal(id, revision) {
      return update(revision, { status: 'planned', days: plan.days });
    },
    async updateSchedule(id, revision, days) {
      if (failSchedule) {
        failSchedule = false;
        throw new Error('temporary failure');
      }
      return update(revision, { days });
    },
  };
  return { flow: createRecommendationFlow(api), creates: () => creates };
}
function result(proposal) {
  const days = proposal.days.map((day) => ({
    date: day.date,
    placeIds: day.items.map((item) => item.placeId).reverse(),
  }));
  return {
    cityId: draft.cityId,
    planningInput: {
      ...draft,
      transportMode: draft.transport,
      selectedPlaceIds: days.flatMap((day) => day.placeIds),
    },
    trip: {
      title: '北京推荐',
      themes: draft.themes,
      pace: draft.pace,
      transport: draft.transport,
      days,
      updatedAt: new Date().toISOString(),
    },
  };
}
test('前端回调串起草稿→方案→确认→保存人工排序，保持同一资源', async () => {
  const { flow, creates } = fixture();
  const p = await flow.onGenerateProposal(draft);
  assert.equal(flow.getCurrentTrip().revision, 3);
  const submitted = result(p);
  await flow.onComplete(submitted);
  const saved = flow.getCurrentTrip();
  assert.equal(saved.status, 'planned');
  assert.equal(saved.revision, 7);
  assert.equal(creates(), 1);
  assert.deepEqual(
    saved.days.flatMap((day) => day.items.map((item) => item.placeId)),
    submitted.trip.days.flatMap((day) => day.placeIds),
  );
});
test('确认后保存失败保留planned状态，重试仅更新日程，不重复创建或确认', async () => {
  const { flow, creates } = fixture(true);
  const p = await flow.onGenerateProposal(draft),
    submitted = result(p);
  await assert.rejects(flow.onComplete(submitted));
  assert.equal(flow.getCurrentTrip().status, 'planned');
  await flow.onComplete(submitted);
  assert.equal(creates(), 1);
  assert.equal(flow.getCurrentTrip().revision, 7);
});

test('读取已规划行程后改名保存，不重算服务器参考时间', async () => {
  const setup = fixture();
  const p = await setup.flow.onGenerateProposal(draft);
  const submitted = result(p);
  await setup.flow.onComplete(submitted);
  const existing = setup.flow.getCurrentTrip();
  existing.days[0].items.forEach((item) => {
    item.startTime = '11:30';
  });
  const api = {
    async update(id, input) {
      assert.equal(input.expectedRevision, existing.revision);
      return { ...existing, title: input.title, revision: existing.revision + 1 };
    },
    async updateSchedule() {
      assert.fail('改名不应覆盖原每日安排');
    },
  };
  const flow = createRecommendationFlow(api, existing);
  await flow.onComplete({ ...submitted, trip: { ...submitted.trip, title: '新标题' } });
  assert.equal(flow.getCurrentTrip().title, '新标题');
  assert.deepEqual(flow.getCurrentTrip().days, existing.days);
});

test('未确认重排时，增减已规划景点不会发出修改请求', async () => {
  const setup = fixture();
  const p = await setup.flow.onGenerateProposal(draft);
  const submitted = result(p);
  await setup.flow.onComplete(submitted);
  const existing = setup.flow.getCurrentTrip();
  const reduced = structuredClone(submitted);
  const removed = reduced.trip.days.flatMap((day) => day.placeIds)[0];
  reduced.trip.days.forEach((day) => {
    day.placeIds = day.placeIds.filter((id) => id !== removed);
  });
  reduced.planningInput.selectedPlaceIds = reduced.planningInput.selectedPlaceIds.filter(
    (id) => id !== removed,
  );
  const flow = createRecommendationFlow({}, existing);
  await assert.rejects(flow.onComplete(reduced), /勾选允许重新规划/);
  assert.equal(flow.getCurrentTrip().revision, existing.revision);
});

test('并发点击保存或推荐时只允许一项请求运行', async () => {
  let resolveCreate;
  const flow = createRecommendationFlow({
    create: () =>
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    update: async () => {
      throw new Error('stop');
    },
  });
  const saving = flow.onSaveDraft({ title: '北京', draft });
  await assert.rejects(flow.onGenerateProposal(draft), /尚未完成/);
  resolveCreate({ id: 'created', revision: 1 });
  await assert.rejects(saving);
  assert.equal(flow.getCurrentTrip().id, 'created');
});
