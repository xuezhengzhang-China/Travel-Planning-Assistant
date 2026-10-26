const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseService } = require('../dist/database/database.service.js');

function fixture(failRollback = false) {
  const queries = [];
  const releases = [];
  const client = {
    async query(text, values) {
      queries.push({ text, values });
      if (text === 'ROLLBACK' && failRollback) throw new Error('Connection lost');
      return { rows: [{ id: 'one' }] };
    },
    release(discard) {
      releases.push(discard);
    },
  };
  const service = new DatabaseService({
    connect: async () => client,
    query: client.query,
    end: async () => queries.push({ text: 'END' }),
  });
  return { service, queries, releases };
}

test('query forwards SQL parameters separately from SQL text', async () => {
  const { service, queries } = fixture();
  const value = "quoted ' value";
  const result = await service.query('SELECT $1 AS id', [value]);
  assert.deepEqual(queries, [{ text: 'SELECT $1 AS id', values: [value] }]);
  assert.equal(result.rows[0].id, 'one');
});

test('transaction uses one connection, commits and releases it', async () => {
  const { service, queries, releases } = fixture();
  const result = await service.transaction(async (client) => {
    await client.query('INSERT test', ['value']);
    return 42;
  });
  assert.equal(result, 42);
  assert.deepEqual(
    queries.map((q) => q.text),
    ['BEGIN', 'INSERT test', 'COMMIT'],
  );
  assert.deepEqual(releases, [false]);
});

test('transaction rolls back and preserves the original failure', async () => {
  const { service, queries, releases } = fixture();
  const failure = new Error('Business write failed');
  await assert.rejects(
    service.transaction(async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(
    queries.map((q) => q.text),
    ['BEGIN', 'ROLLBACK'],
  );
  assert.deepEqual(releases, [false]);
});

test('failed rollback discards the connection and preserves the business error', async () => {
  const { service, releases } = fixture(true);
  const failure = new Error('Business write failed');
  await assert.rejects(
    service.transaction(async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(releases, [true]);
});

test('readiness failure returns false; module shutdown ends the pool', async () => {
  let ended = false;
  const service = new DatabaseService({
    query: async (query) => {
      assert.equal(query.query_timeout, 2000);
      throw new Error('Database unavailable');
    },
    end: async () => {
      ended = true;
    },
  });
  assert.equal(await service.isReady(), false);
  await service.onModuleDestroy();
  assert.equal(ended, true);
});
