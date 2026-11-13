const test = require('node:test'),
  assert = require('node:assert/strict');
const catalog = require('@travel/shared/beijing-catalog.json');
const {
  rankPlaces,
  generatePlan,
  scheduleGroups,
  validateSchedule,
} = require('@travel/shared/recommendation-engine');
const { RecommendationsService } = require('../dist/recommendations/c-recommendations.service');
const { CuratedBeijingCatalog } = require('../dist/trips/trip-catalog');
const { TripsService } = require('../dist/trips/trips.service');
const { ApiError } = require('../dist/common/api-error');
const places = catalog.places;
const input = (ids = [places[0].id, places[4].id]) => ({
  cityId: catalog.city.id,
  startDate: '2026-11-10',
  endDate: '2026-11-12',
  themes: ['history'],
  pace: 'standard',
  transportMode: 'transit',
  selectedPlaceIds: ids,
});
function context() {
  let time = new Date('2026-10-30T05:00:00Z');
  const saved = new Map();
  const repository = {
    async save(owner, p) {
      saved.set(p.proposalId, { owner, p: structuredClone(p) });
    },
    async getOwned(id, owner) {
      const record = saved.get(id);
      return record?.owner === owner ? structuredClone(record.p) : null;
    },
  };
  const service = new RecommendationsService(repository, new CuratedBeijingCatalog(), {
    now: () => time,
  });
  return {
    service,
    advance() {
      time = new Date(time.getTime() + 31 * 60000);
    },
    saved,
  };
}
test('兴趣匹配排序稳定，每个景点都有可解释理由', () => {
  const ranked = rankPlaces(places, {
    cityId: catalog.city.id,
    themes: ['family'],
    pace: 'standard',
  });
  assert.equal(ranked.length, 18);
  assert.ok(
    ranked
      .slice(0, 2)
      .every((r) => places.find((p) => p.id === r.placeId).categories.includes('family')),
  );
  assert.ok(ranked.every((r) => r.reasons.length));
  assert.deepEqual(
    ranked,
    rankPlaces(places, { cityId: catalog.city.id, themes: ['family'], pace: 'standard' }),
  );
});
test('生成覆盖所有日期、景点不重不漏，远郊单独一天', () => {
  const plan = generatePlan(places, input());
  assert.equal(plan.days.length, 3);
  assert.deepEqual(plan.unassignedPlaceIds, []);
  assert.equal(new Set(plan.days.flatMap((d) => d.items.map((i) => i.placeId))).size, 2);
  for (const day of plan.days)
    if (day.items.some((i) => i.placeId === places[4].id)) assert.equal(day.items.length, 1);
  assert.doesNotThrow(() => validateSchedule(places, input(), plan.days));
  assert.ok(plan.warnings.some((w) => w.code === 'RULE_ESTIMATES'));
  assert.ok(
    plan.days
      .flatMap((d) => d.items)
      .every((i) => i.travelTimeSource === 'none' || i.travelTimeSource === 'estimate'),
  );
});
test('容量不足明确列出未安排项，已安排与未安排合并恰好等于输入', () => {
  const data = { ...input(places.map((p) => p.id)), endDate: '2026-11-10', pace: 'relaxed' };
  const plan = generatePlan(places, data);
  assert.ok(plan.unassignedPlaceIds.length > 0);
  const all = [
    ...plan.days.flatMap((d) => d.items.map((i) => i.placeId)),
    ...plan.unassignedPlaceIds,
  ];
  assert.equal(all.length, 18);
  assert.equal(new Set(all).size, 18);
  assert.deepEqual([...all].sort(), [...data.selectedPlaceIds].sort());
});
test('手动安排拒绝超预算、重复、时间重叠和漏景点', () => {
  const data = input([places[0].id, places[1].id]);
  const plan = generatePlan(places, data);
  assert.doesNotThrow(() => validateSchedule(places, data, plan.days));
  const overlap = structuredClone(plan.days);
  const occupied = overlap.find((d) => d.items.length >= 2);
  assert.ok(occupied, '同区景点应优先分在一起');
  occupied.items[1].startTime = occupied.items[0].startTime;
  assert.throws(() => validateSchedule(places, data, overlap));
  const duplicate = structuredClone(plan.days);
  const day = duplicate.find((d) => d.items.length);
  day.items.push({ ...day.items[0], position: day.items.length });
  assert.throws(() => validateSchedule(places, data, duplicate));
  const missing = structuredClone(plan.days);
  missing.find((d) => d.items.length).items.pop();
  assert.throws(() => validateSchedule(places, data, missing));
  assert.ok(
    scheduleGroups(
      places,
      {
        ...data,
        selectedPlaceIds: [places[0].id, places[2].id],
        endDate: data.startDate,
        pace: 'relaxed',
      },
      [{ date: data.startDate, placeIds: [places[0].id, places[2].id] }],
    ).unassignedPlaceIds.length,
  );
});
test('服务端保存方案且按用户和有效期读取，拒绝未知景点', async () => {
  const ctx = context(),
    proposal = await ctx.service.generate('owner', input());
  assert.equal(
    (await ctx.service.getOwnedProposal(proposal.proposalId, 'owner')).proposalId,
    proposal.proposalId,
  );
  await assert.rejects(
    ctx.service.getOwnedProposal(proposal.proposalId, 'other'),
    (e) => e.code === 'NOT_FOUND',
  );
  ctx.advance();
  await assert.rejects(
    ctx.service.getOwnedProposal(proposal.proposalId, 'owner'),
    (e) => e.code === 'PROPOSAL_EXPIRED',
  );
  await assert.rejects(
    ctx.service.generate('owner', input(['11000000-0000-4000-8001-999999999999'])),
    (e) => e.code === 'VALIDATION_ERROR',
  );
});
function tripService(ctx, data) {
  let value = {
    id: 'id',
    ownerId: 'owner',
    title: '北京',
    revision: 3,
    status: 'draft',
    planningInput: data,
    days: [],
    createdAt: 'now',
    updatedAt: 'now',
  };
  const repository = {
    async mutate(owner, id, revision, change) {
      if (owner !== value.ownerId) throw new ApiError('NOT_FOUND', 'missing', 404);
      if (revision !== value.revision) throw new ApiError('REVISION_CONFLICT', 'conflict', 409);
      const next = await change(structuredClone(value));
      value = { ...next, revision: value.revision + 1 };
      return structuredClone(value);
    },
  };
  return {
    service: new TripsService(repository, new CuratedBeijingCatalog(), ctx.service),
    value: () => value,
  };
}
test('确认可信方案成为planned，重复确认不覆盖，手动更新校验通过', async () => {
  const ctx = context(),
    data = input(),
    p = await ctx.service.generate('owner', data),
    t = tripService(ctx, data);
  const planned = await t.service.applyProposal('owner', 'id', 3, p.proposalId);
  assert.equal(planned.status, 'planned');
  assert.equal(planned.revision, 4);
  await assert.rejects(
    t.service.applyProposal('owner', 'id', 4, p.proposalId),
    (e) => e.code === 'SCHEDULE_RESET_REQUIRED',
  );
  const edited = await t.service.updateSchedule('owner', 'id', 4, planned.days);
  assert.equal(edited.revision, 5);
});
test('输入不匹配、未分配、他人或过期方案均不修改草稿', async () => {
  const ctx = context(),
    data = input(),
    p = await ctx.service.generate('owner', data);
  const changed = tripService(ctx, { ...data, pace: 'relaxed' });
  await assert.rejects(
    changed.service.applyProposal('owner', 'id', 3, p.proposalId),
    (e) => e.code === 'PROPOSAL_INPUT_MISMATCH',
  );
  assert.equal(changed.value().revision, 3);
  const over = { ...input(places.map((p) => p.id)), endDate: data.startDate };
  const op = await ctx.service.generate('owner', over),
    t = tripService(ctx, over);
  await assert.rejects(
    t.service.applyProposal('owner', 'id', 3, op.proposalId),
    (e) => e.code === 'UNASSIGNED_PLACES',
  );
  assert.equal(t.value().status, 'draft');
  const valid = tripService(ctx, data);
  ctx.advance();
  await assert.rejects(
    valid.service.applyProposal('owner', 'id', 3, p.proposalId),
    (e) => e.code === 'PROPOSAL_EXPIRED',
  );
});
