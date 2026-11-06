require('reflect-metadata');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { BModule } = require('../dist/b/b.module.js');
const { B_AUTHENTICATOR } = require('../dist/b/identity.js');
const { BConfig, readBConfig } = require('../dist/b/config.js');
const { B_CLOCK, B_ID_GENERATOR } = require('../dist/recommendations/recommendations.service.js');
const { PlacesRepository } = require('../dist/places/places.repository.js');
const { ProposalsRepository } = require('../dist/recommendations/proposals.repository.js');
const { AmapClient } = require('../dist/integrations/amap/amap.client.js');
const { fixture, memoryCatalog, memoryProposals } = require('./helpers/b.cjs');

async function httpFixture(providers) {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
  class Root {}
  Module({
    imports: [
      BModule.register({
        providers: [{ provide: BConfig, useValue: { values: readBConfig({}) } }, ...providers],
      }),
    ],
  })(Root);
  const app = await NestFactory.create(Root, { logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  return {
    app,
    base: await app.getUrl(),
    close: async () => {
      await app.close();
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    },
  };
}
test('default production identity provider rejects all six endpoints including self-declared headers', async () => {
  const f = await httpFixture([]);
  try {
    for (const [method, path] of [
      ['GET', 'destinations'],
      ['GET', 'places'],
      ['GET', 'places/x'],
      ['POST', 'routes/preview'],
      ['POST', 'locations/reverse'],
      ['POST', 'recommendations/itinerary'],
    ]) {
      const response = await fetch(`${f.base}/api/${path}`, {
        method,
        headers: { 'x-user-id': fixture.actors.primary.userId, authorization: 'Bearer forged' },
      });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).code, 'UNAUTHENTICATED');
    }
  } finally {
    await f.close();
  }
});
test('HTTP B endpoints honor contracts with test-only verified identity and repository/external doubles', async () => {
  const catalog = memoryCatalog(),
    proposals = memoryProposals();
  const f = await httpFixture([
    {
      provide: B_AUTHENTICATOR,
      useValue: {
        authenticate: async (header) =>
          header === 'Bearer test-only' ? fixture.actors.primary : null,
      },
    },
    { provide: PlacesRepository, useValue: catalog },
    { provide: ProposalsRepository, useValue: proposals },
    {
      provide: AmapClient,
      useValue: {
        route: async () => 40,
        reverse: async () => ({ placeName: '测试地点', adcode: '330106' }),
      },
    },
    { provide: B_CLOCK, useValue: () => new Date(fixture.fixedNow) },
    { provide: B_ID_GENERATOR, useValue: () => fixture.responses.proposal.proposalId },
  ]);
  const headers = { authorization: 'Bearer test-only', 'content-type': 'application/json' };
  const post = (path, body) =>
    fetch(`${f.base}/api/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  try {
    const destinations = await fetch(`${f.base}/api/destinations?level=city`, { headers });
    assert.equal(destinations.status, 200);
    assert.equal((await destinations.json()).total, 1);
    const list = await fetch(
      `${f.base}/api/places?cityId=${fixture.destinations[1].id}&themes=art&pageSize=1`,
      { headers },
    );
    assert.equal(list.status, 200);
    assert.equal((await list.json()).items[0].id, fixture.places[2].id);
    const detail = await fetch(`${f.base}/api/places/${fixture.places[0].id}`, { headers });
    assert.equal(detail.status, 200);
    const route = await post('routes/preview', {
      from: fixture.places[0].coordinates,
      to: fixture.places[1].coordinates,
      transportMode: 'walking',
    });
    assert.equal(route.status, 200);
    assert.equal((await route.json()).durationMinutes, 40);
    const reverse = await post('locations/reverse', { coordinates: fixture.places[0].coordinates });
    assert.equal(reverse.status, 200);
    assert.equal((await reverse.json()).cityAdcode, '330100');
    const proposal = await post(
      'recommendations/itinerary',
      fixture.requests.recommendationRequest,
    );
    assert.equal(proposal.status, 200);
    assert.equal((await proposal.json()).days.length, 2);
    assert.equal(proposals.data.size, 1);
    for (const body of [
      { ...fixture.requests.recommendationRequest, ownerId: fixture.actors.other.userId },
      { ...fixture.requests.recommendationRequest, startDate: '2026-02-30' },
    ]) {
      const response = await post('recommendations/itinerary', body);
      assert.equal(response.status, 400);
      assert.ok((await response.json()).code);
    }
    catalog.places = async () => {
      throw new Error('secret SQL password');
    };
    const failure = await fetch(`${f.base}/api/places?cityId=${fixture.destinations[1].id}`, {
      headers,
    });
    assert.equal(failure.status, 500);
    assert.equal((await failure.json()).message, '服务暂不可用');
  } finally {
    await f.close();
  }
});
