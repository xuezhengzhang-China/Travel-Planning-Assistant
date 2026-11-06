const test = require('node:test');
const assert = require('node:assert/strict');
const { serviceFixture, fixture } = require('./helpers/b.cjs');
const { testDatabaseUrl } = require('../scripts/test-integration-b.cjs');
test('place service validates filters, pagination, city and detail IDs', async () => {
  const { places } = serviceFixture();
  const response = await places.places({
    cityId: fixture.destinations[1].id,
    themes: 'art',
    page: '1',
    pageSize: '1',
  });
  assert.equal(response.items[0].id, fixture.places[2].id);
  assert.equal(response.total, 3);
  assert.equal(
    (await places.places({ cityId: fixture.destinations[1].id, category: 'history' })).total,
    2,
  );
  for (const change of [
    { page: '0' },
    { pageSize: '101' },
    { page: ['1', '2'] },
    { themes: 'unknown' },
    { category: 'xxx' },
    { keyword: ['a', 'b'] },
    { unknown: 'x' },
  ])
    await assert.rejects(places.places({ cityId: fixture.destinations[1].id, ...change }));
  await assert.rejects(places.getPlace(fixture.actors.other.userId), (e) => e.getStatus() === 404);
  await assert.rejects(places.getCity(fixture.destinations[0].id), (e) => e.getStatus() === 400);
  await assert.rejects(
    places.getSelectedPlaces(fixture.destinations[1].id, [
      fixture.places[0].id,
      fixture.places[0].id,
    ]),
    (e) => e.getStatus() === 400,
  );
});
test('integration runner rejects development and malformed database targets', () => {
  for (const value of [
    '',
    'not-a-url',
    'postgresql://localhost/travel_planner',
    'https://localhost/b_test',
    'postgresql://localhost/production-test',
  ])
    assert.throws(() => testDatabaseUrl(value));
  assert.equal(
    testDatabaseUrl('postgresql://localhost/travel_planner_b_test'),
    'postgresql://localhost/travel_planner_b_test',
  );
});
