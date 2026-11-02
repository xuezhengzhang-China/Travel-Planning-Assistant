const test = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { getMigrationStatus } = require('../scripts/migration-status.cjs');

const directory = resolve(__dirname, '../migrations');
const name = '202610240001_initial_schema';

test('uninitialized database shows pending migrations using only a read query', async () => {
  const queries = [];
  const rows = await getMigrationStatus(
    {
      async query(text, values) {
        queries.push(text);
        assert.deepEqual(values, ['public.pgmigrations']);
        return { rows: [{ relation: null }] };
      },
    },
    directory,
  );
  assert.deepEqual(rows, [{ name, status: 'pending' }]);
  assert.equal(queries.length, 1);
  assert.ok(queries.every((text) => text.startsWith('SELECT ')));
});

test('status identifies applied migrations and missing local files without modifying the database', async () => {
  const queries = [];
  const rows = await getMigrationStatus(
    {
      async query(text) {
        queries.push(text);
        return text.includes('to_regclass')
          ? { rows: [{ relation: 'pgmigrations' }] }
          : { rows: [{ name }, { name: 'removed_migration' }] };
      },
    },
    directory,
  );
  assert.deepEqual(rows, [
    { name, status: 'applied' },
    { name: 'removed_migration', status: 'missing-file' },
  ]);
  assert.ok(queries.every((text) => text.startsWith('SELECT ')));
});
