const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { fixture, fixedPlan, serviceFixture } = require('./helpers/b.cjs');
const { planningInput } = require('../dist/b/validation.js');
const { PACE_POLICY } = require('../dist/recommendations/rule-planner.js');

test('120 selections across 30 days obey every pace, conserve selections and leave input unchanged', () => {
  const places = Array.from({ length: 120 }, (_, i) => ({
    ...structuredClone(fixture.places[0]),
    id: `30000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    suggestedDurationMinutes: 1 + ((i * 37) % 160),
  }));
  for (const pace of ['relaxed', 'standard', 'intensive']) {
    const input = {
      ...fixture.requests.recommendationRequest,
      endDate: '2026-11-30',
      pace,
      selectedPlaceIds: places.map((p) => p.id),
    };
    const snapshot = structuredClone({ input, places });
    const result = fixedPlan(input, places);
    assert.equal(result.days.length, 30);
    const assigned = result.days.flatMap((d) => d.items.map((p) => p.placeId));
    assert.deepEqual(
      [...assigned, ...result.unassignedPlaceIds].sort(),
      [...input.selectedPlaceIds].sort(),
    );
    assert.equal(new Set(assigned).size, assigned.length);
    for (const day of result.days) {
      assert.ok(day.items.length <= PACE_POLICY[pace].maxPlaces);
      let earliest = PACE_POLICY[pace].start;
      for (const [index, item] of day.items.entries()) {
        const [h, m] = item.startTime.split(':').map(Number);
        const start = h * 60 + m;
        assert.ok(
          start >= earliest + (index ? PACE_POLICY[pace].rest + item.travelMinutesFromPrevious : 0),
        );
        assert.ok(start + item.durationMinutes <= PACE_POLICY[pace].end);
        earliest = start + item.durationMinutes;
      }
    }
    assert.deepEqual({ input, places }, snapshot);
    assert.deepEqual(fixedPlan(input, places), result);
    assert.throws(() =>
      planningInput({
        ...input,
        selectedPlaceIds: [...input.selectedPlaceIds, fixture.actors.other.userId],
      }),
    );
  }
});

test('all paces fit an exact end-of-day visit and reject a one-minute overflow', () => {
  for (const pace of ['relaxed', 'standard', 'intensive']) {
    const policy = PACE_POLICY[pace];
    const input = {
      ...fixture.requests.recommendationRequest,
      pace,
      endDate: '2026-11-01',
      selectedPlaceIds: [fixture.places[0].id],
    };
    const place = { ...fixture.places[0], suggestedDurationMinutes: policy.end - policy.start };
    assert.equal(fixedPlan(input, [place]).unassignedPlaceIds.length, 0);
    place.suggestedDurationMinutes++;
    assert.deepEqual(fixedPlan(input, [place]).unassignedPlaceIds, input.selectedPlaceIds);
  }
});

test('total generation deadline prevents saving a calculation completed too late', async () => {
  const { service, config, geo, proposals } = serviceFixture();
  config.values.generationTimeoutMs = 5;
  geo.route = async () => {
    await delay(30);
    return { durationMinutes: 1, source: 'provider', warnings: [] };
  };
  await assert.rejects(
    service.generate(fixture.requests.recommendationRequest, fixture.actors.primary.userId),
    (e) => e.getStatus() === 503,
  );
  assert.equal(proposals.data.size, 0);
});

test('candidate planning reuses directed route lookups without treating reverse routes as identical', async () => {
  const { service, advisor, geo } = serviceFixture();
  const calls = [];
  geo.route = async (from, to) => {
    calls.push(`${from.longitude}>${to.longitude}`);
    return { durationMinutes: 45, source: 'provider', warnings: [] };
  };
  advisor.suggest = async () => ({
    order: [...fixture.requests.recommendationRequest.selectedPlaceIds].reverse(),
  });
  await service.generate(fixture.requests.recommendationRequest, fixture.actors.primary.userId);
  assert.equal(new Set(calls).size, calls.length);
  assert.ok(calls.includes('120.148>120.102'));
  assert.ok(calls.includes('120.102>120.148'));
});
