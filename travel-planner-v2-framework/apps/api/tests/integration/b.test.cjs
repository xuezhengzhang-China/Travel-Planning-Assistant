require('reflect-metadata');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
const { Client } = require('pg');
const { runner } = require('node-pg-migrate');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { seedB } = require('../../scripts/seed-b.cjs');
const { testDatabaseUrl } = require('../../scripts/test-integration-b.cjs');
const { BModule } = require('../../dist/b/b.module.js');
const { B_AUTHENTICATOR } = require('../../dist/b/identity.js');
const { BConfig, readBConfig } = require('../../dist/b/config.js');
const { PlacesService } = require('../../dist/places/places.service.js');
const { AmapClient } = require('../../dist/integrations/amap/amap.client.js');
const {
  PROPOSAL_READER,
  RecommendationsService,
} = require('../../dist/recommendations/recommendations.service.js');
const fixture = require('../../../../docs/examples/demo-scenario.json');

test('real PostgreSQL: migrations, idempotent seed, directory SQL, HTTP persistence and reconnect ownership', async (t) => {
  const url = new URL(testDatabaseUrl(process.env.TEST_DATABASE_URL));
  const schema = `b_it_${randomUUID().replaceAll('-', '')}`;
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  const oldDatabase = process.env.DATABASE_URL;
  let app;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}", public`);
    const migrationOptions = {
      dbClient: admin,
      dir: resolve(__dirname, '../../migrations'),
      direction: 'up',
      schema,
      migrationsSchema: schema,
      migrationsTable: 'pgmigrations',
      log: () => {},
    };
    await t.test('upgrade an original-schema database via forward migrations', async () => {
      await runner({ ...migrationOptions, count: 1 });
      assert.ok((await admin.query("SELECT to_regclass('users') AS name")).rows[0].name);
      assert.equal((await admin.query("SELECT to_regclass('places') AS name")).rows[0].name, null);
      await runner(migrationOptions);
      assert.equal((await admin.query('SELECT count(*) FROM pgmigrations')).rows[0].count, '7');
      await runner(migrationOptions);
    });
    await t.test('seed twice without duplicates and keep user creation separate', async () => {
      await seedB(admin);
      await seedB(admin);
      assert.equal((await admin.query('SELECT count(*) FROM places')).rows[0].count, '3');
      assert.equal((await admin.query('SELECT count(*) FROM destinations')).rows[0].count, '2');
      assert.equal((await admin.query('SELECT count(*) FROM users')).rows[0].count, '0');
      for (const [name, actor] of Object.entries(fixture.actors))
        await admin.query('INSERT INTO users (id,email) VALUES ($1,$2)', [
          actor.userId,
          `${name}@b-test.invalid`,
        ]);
    });
    url.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    class TestRoot {}
    Module({
      imports: [
        BModule.register({
          providers: [
            { provide: BConfig, useValue: { values: readBConfig({}) } },
            {
              provide: B_AUTHENTICATOR,
              useValue: {
                authenticate: async (header) =>
                  header === 'Bearer integration-only' ? fixture.actors.primary : null,
              },
            },
            {
              provide: AmapClient,
              useValue: {
                route: async () => 45,
                reverse: async () => ({
                  placeName: '测试地点',
                  adcode: '330106',
                  cityCode: '0571',
                }),
              },
            },
          ],
        }),
      ],
    })(TestRoot);
    const start = async () => {
      const server = await NestFactory.create(TestRoot, { logger: false });
      server.setGlobalPrefix('api');
      await server.listen(0, '127.0.0.1');
      return server;
    };
    app = await start();
    await t.test(
      'real directory filtering and stable ranking happen before pagination',
      async () => {
        const places = app.get(PlacesService);
        const result = await places.places({
          cityId: fixture.destinations[1].id,
          themes: 'art',
          pageSize: '1',
        });
        assert.equal(result.items[0].id, fixture.places[2].id);
        assert.equal(result.total, 3);
        assert.equal(
          (await places.places({ cityId: fixture.destinations[1].id, category: 'history' })).total,
          2,
        );
        assert.equal(
          (await places.places({ cityId: fixture.destinations[1].id, keyword: "%' OR 1=1 --" }))
            .total,
          0,
        );
        const empty = await places.places({ cityId: fixture.destinations[1].id, page: '100' });
        assert.deepEqual(empty.items, []);
        assert.equal(empty.total, 3);
        assert.equal((await places.cityForAdminCode('330106')).adcode, '330100');
        assert.equal(await places.cityForAdminCode('110108'), null);
        assert.equal(await places.getRouteCityCode(fixture.destinations[1].id), '0571');
        assert.equal(
          (await places.destinations({ level: 'city', parentId: fixture.destinations[0].id }))
            .total,
          1,
        );
      },
    );
    let saved;
    await t.test(
      'authenticated HTTP proposal generation persists without touching formal trips',
      async () => {
        const response = await fetch(`${await app.getUrl()}/api/recommendations/itinerary`, {
          method: 'POST',
          headers: { authorization: 'Bearer integration-only', 'content-type': 'application/json' },
          body: JSON.stringify(fixture.requests.recommendationRequest),
        });
        assert.equal(response.status, 200);
        saved = await response.json();
        assert.equal(saved.days.length, 2);
        assert.equal(
          (await admin.query('SELECT count(*) FROM recommendation_proposals')).rows[0].count,
          '1',
        );
        assert.equal((await admin.query('SELECT count(*) FROM trips')).rows[0].count, '0');
      },
    );
    await app.close();
    app = await start();
    await t.test('new app/pool reads saved proposals; cross-user reads return 404', async () => {
      const reader = app.get(PROPOSAL_READER);
      assert.deepEqual(
        await reader.getOwnedProposal(saved.proposalId, fixture.actors.primary.userId),
        saved,
      );
      await assert.rejects(
        reader.getOwnedProposal(saved.proposalId, fixture.actors.other.userId),
        (e) => e.getStatus() === 404,
      );
      const before = (await admin.query('SELECT count(*) FROM recommendation_proposals')).rows[0]
        .count;
      await assert.rejects(
        app.get(RecommendationsService).generate(
          {
            ...fixture.requests.recommendationRequest,
            selectedPlaceIds: [fixture.actors.other.userId],
          },
          fixture.actors.primary.userId,
        ),
      );
      assert.equal(
        (await admin.query('SELECT count(*) FROM recommendation_proposals')).rows[0].count,
        before,
      );
    });
    await t.test(
      'no-key HTTP generation uses real B geo fallback and persists a two-day demo',
      async () => {
        class NoKeyRoot {}
        Module({
          imports: [
            BModule.register({
              providers: [
                { provide: BConfig, useValue: { values: readBConfig({}) } },
                {
                  provide: B_AUTHENTICATOR,
                  useValue: {
                    authenticate: async (header) =>
                      header === 'Bearer integration-only' ? fixture.actors.primary : null,
                  },
                },
              ],
            }),
          ],
        })(NoKeyRoot);
        const noKeyApp = await NestFactory.create(NoKeyRoot, { logger: false });
        noKeyApp.setGlobalPrefix('api');
        await noKeyApp.listen(0, '127.0.0.1');
        try {
          const response = await fetch(`${await noKeyApp.getUrl()}/api/recommendations/itinerary`, {
            method: 'POST',
            headers: {
              authorization: 'Bearer integration-only',
              'content-type': 'application/json',
            },
            body: JSON.stringify(fixture.requests.recommendationRequest),
          });
          assert.equal(response.status, 200);
          const result = await response.json();
          assert.deepEqual(
            result.days.map((d) => d.items.length),
            [2, 1],
          );
          assert.equal(result.unassignedPlaceIds.length, 0);
          assert.ok(result.warnings.some((w) => w.code === 'ROUTE_ESTIMATED'));
          assert.ok(result.warnings.some((w) => w.code === 'ROUTE_UNAVAILABLE_SEPARATED'));
          assert.deepEqual(
            await noKeyApp
              .get(PROPOSAL_READER)
              .getOwnedProposal(result.proposalId, fixture.actors.primary.userId),
            result,
          );
        } finally {
          await noKeyApp.close();
        }
      },
    );
    await t.test(
      'database constraints enforce real foreign keys and owner deletion cascades',
      async () => {
        await assert.rejects(
          admin.query('UPDATE places SET city_id=$1 WHERE id=$2', [
            randomUUID(),
            fixture.places[0].id,
          ]),
        );
        await admin.query('DELETE FROM users WHERE id=$1', [fixture.actors.primary.userId]);
        assert.equal(
          (await admin.query('SELECT count(*) FROM recommendation_proposals')).rows[0].count,
          '0',
        );
      },
    );
  } finally {
    if (app) await app.close();
    if (oldDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = oldDatabase;
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
