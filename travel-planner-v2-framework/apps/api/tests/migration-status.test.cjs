const test = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { getMigrationStatus } = require('../scripts/migration-status.cjs');

const directory = resolve(__dirname, '../migrations');
const name = '202610240001_initial_schema';
const footprintMigration = '202611030001_footprint_entries';
const footprintLocationMigration = '202611030002_footprint_location_details';
const footprintCleanupMigration = '202611030003_footprint_media_cleanup';

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
  assert.deepEqual(rows, [
    { name, status: 'pending' },
    { name: footprintMigration, status: 'pending' },
    { name: footprintLocationMigration, status: 'pending' },
    { name: footprintCleanupMigration, status: 'pending' },
  ]);
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
    { name: footprintMigration, status: 'pending' },
    { name: footprintLocationMigration, status: 'pending' },
    { name: footprintCleanupMigration, status: 'pending' },
    { name: 'removed_migration', status: 'missing-file' },
  ]);
  assert.ok(queries.every((text) => text.startsWith('SELECT ')));
});
