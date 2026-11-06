const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, fixedPlan, serviceFixture } = require('./helpers/b.cjs');
const { calendarDates, planningInput } = require('../dist/b/validation.js');
const { validateSchedule } = require('../dist/recommendations/rule-planner.js');
const { isProposalExpired } = require('../dist/recommendations/recommendations.service.js');

test('calendar dates include both ends, leap days, year boundaries and enforce 1-30 days', () => {
  assert.deepEqual(calendarDates('2028-02-28', '2028-03-01'), [
    '2028-02-28',
    '2028-02-29',
    '2028-03-01',
  ]);
  assert.deepEqual(calendarDates('2026-12-31', '2027-01-01'), ['2026-12-31', '2027-01-01']);
  assert.equal(calendarDates('2026-11-01', '2026-11-01').length, 1);
  assert.equal(calendarDates('2026-11-01', '2026-11-30').length, 30);
  for (const pair of [
    ['2027-02-29', '2027-03-01'],
    ['2026-02-30', '2026-03-01'],
    ['2026-11-02', '2026-11-01'],
    ['2026-11-01', '2026-12-01'],
    ['2026-1-1', '2026-01-02'],
  ])
    assert.throws(() => calendarDates(...pair));
});
test('planning rejects duplicate/empty/too many selections, enums and unknown fields', () => {
  const base = fixture.requests.recommendationRequest;
  for (const change of [
    { selectedPlaceIds: [] },
    { selectedPlaceIds: [base.selectedPlaceIds[0], base.selectedPlaceIds[0]] },
    { pace: 'fast' },
    { themes: ['unknown'] },
    { transportMode: 'flying' },
    { ownerId: fixture.actors.other.userId },
    { cityId: 'bad' },
  ])
    assert.throws(() => planningInput({ ...base, ...change }));
  assert.deepEqual(planningInput({ ...base, themes: ['nature', 'history', 'nature'] }).themes, [
    'history',
    'nature',
  ]);
});
test('rule planner is deterministic and every selection is assigned or reported exactly once', () => {
  const input = fixture.requests.recommendationRequest;
  const result = fixedPlan();
  assert.deepEqual(result, fixedPlan());
  assert.equal(result.days.length, 2);
  const ids = [
    ...result.days.flatMap((d) => d.items.map((p) => p.placeId)),
    ...result.unassignedPlaceIds,
  ];
  assert.deepEqual(ids.sort(), [...input.selectedPlaceIds].sort());
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(result.warnings.some((w) => w.code === 'OPENING_HOURS_UNVERIFIED'));
});
test('long unplaceable item does not block later places, empty days remain present', () => {
  const places = structuredClone(fixture.places);
  places[0].suggestedDurationMinutes = 999;
  const input = { ...fixture.requests.recommendationRequest, pace: 'relaxed' };
  const result = fixedPlan(input, places);
  assert.deepEqual(result.unassignedPlaceIds, [places[0].id]);
  assert.equal(result.days[0].items.length, 2);
  assert.equal(result.days[1].items.length, 0);
  assert.equal(result.days[0].items[0].travelTimeSource, 'none');
});
test('daily count, exact budget, rest and transport are enforced for each pace', () => {
  for (const [pace, start, rest, limit] of [
    ['relaxed', 600, 30, 2],
    ['standard', 540, 15, 3],
    ['intensive', 480, 10, 4],
  ]) {
    const p = fixture.places[0];
    const places = Array.from({ length: 5 }, (_, i) => ({
      ...p,
      id: `30000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      suggestedDurationMinutes: 1,
    }));
    const input = {
      ...fixture.requests.recommendationRequest,
      endDate: '2026-11-01',
      pace,
      selectedPlaceIds: places.map((x) => x.id),
    };
    const result = fixedPlan(input, places);
    assert.equal(result.days[0].items.length, limit);
    const second = result.days[0].items[1];
    const expected = start + 1 + rest + 45;
    assert.equal(
      second.startTime,
      `${String(Math.floor(expected / 60)).padStart(2, '0')}:${String(expected % 60).padStart(2, '0')}`,
    );
    const one = { ...places[0], suggestedDurationMinutes: 1080 - start };
    assert.equal(
      fixedPlan({ ...input, selectedPlaceIds: [one.id] }, [one]).unassignedPlaceIds.length,
      0,
    );
    one.suggestedDurationMinutes++;
    assert.deepEqual(
      fixedPlan({ ...input, selectedPlaceIds: [one.id] }, [one]).unassignedPlaceIds,
      [one.id],
    );
  }
});
test('schedule validator rejects overlap, fabricated IDs, duplicate and incomplete schedules', () => {
  const input = fixture.requests.recommendationRequest;
  const original = fixedPlan();
  for (const mutate of [
    (d) => {
      d[0].items[1].startTime = '09:01';
    },
    (d) => {
      d[0].items[0].placeId = fixture.actors.other.userId;
    },
    (d) => {
      d[0].items[1].placeId = d[0].items[0].placeId;
    },
    (d) => {
      d.pop();
    },
    (d) => {
      d[0].items[0].travelTimeSource = 'provider';
    },
  ]) {
    const days = structuredClone(original.days);
    mutate(days);
    assert.throws(() => validateSchedule(input, fixture.places, days, original.unassignedPlaceIds));
  }
});
test('service saves normalized immutable owned proposals with fixed time and expiry boundary', async () => {
  const { service, proposals } = serviceFixture();
  const proposal = await service.generate(
    fixture.requests.recommendationRequest,
    fixture.actors.primary.userId,
  );
  assert.equal(proposals.data.size, 1);
  assert.equal(Date.parse(proposal.expiresAt) - Date.parse(proposal.generatedAt), 1800000);
  assert.equal(isProposalExpired(proposal, new Date(Date.parse(proposal.expiresAt) - 1)), false);
  assert.equal(isProposalExpired(proposal, new Date(proposal.expiresAt)), true);
  proposal.days[0].items.length = 0;
  const reread = await service.getOwnedProposal(proposal.proposalId, fixture.actors.primary.userId);
  assert.ok(reread.days[0].items.length);
  await assert.rejects(
    service.getOwnedProposal(proposal.proposalId, fixture.actors.other.userId),
    (e) => e.getStatus() === 404,
  );
});
test('unknown/cross-city places are rejected before saving or routing', async () => {
  const { service, catalog, proposals } = serviceFixture();
  catalog.data.places[0].cityId = fixture.destinations[0].id;
  await assert.rejects(
    service.generate(fixture.requests.recommendationRequest, fixture.actors.primary.userId),
    (e) => e.getStatus() === 400,
  );
  assert.equal(proposals.data.size, 0);
});
test('route budget exhaustion cannot fake driving estimates or persist an incomplete calculation', async () => {
  const { service, config, geo, proposals } = serviceFixture();
  config.values.maxRouteCalls = 1;
  let calls = 0;
  geo.route = async () => {
    calls++;
    return { durationMinutes: 1, source: 'provider', warnings: [] };
  };
  await assert.rejects(
    service.generate(
      {
        ...fixture.requests.recommendationRequest,
        endDate: '2026-11-01',
        transportMode: 'driving',
      },
      fixture.actors.primary.userId,
    ),
    (e) => e.getStatus() === 503,
  );
  assert.equal(calls, 1);
  assert.equal(proposals.data.size, 0);
});

test('no-key demo can separate distant stops into different days without inventing travel time', async () => {
  const { service, geo, places } = serviceFixture();
  const { AmapClient } = require('../dist/integrations/amap/amap.client.js');
  const { GeoService } = require('../dist/integrations/amap/geo.service.js');
  const { readBConfig } = require('../dist/b/config.js');
  const actual = new GeoService(
    new AmapClient({ values: readBConfig({}) }, async () => {
      throw new Error('No network');
    }),
    places,
  );
  geo.route = actual.route.bind(actual);
  const proposal = await service.generate(
    fixture.requests.recommendationRequest,
    fixture.actors.primary.userId,
  );
  assert.deepEqual(
    proposal.days.map((d) => d.items.length),
    [2, 1],
  );
  assert.equal(proposal.unassignedPlaceIds.length, 0);
  assert.equal(proposal.days[1].items[0].travelTimeSource, 'none');
  assert.ok(proposal.warnings.some((w) => w.code === 'ROUTE_UNAVAILABLE_SEPARATED'));
});
