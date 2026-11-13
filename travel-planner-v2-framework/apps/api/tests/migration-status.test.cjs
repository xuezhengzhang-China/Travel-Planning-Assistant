const test = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { readdirSync } = require('node:fs');
const { getMigrationStatus } = require('../scripts/migration-status.cjs');

const directory = resolve(__dirname, '../migrations');
const name = '202610240001_initial_schema';
const footprintMigrations = [
  '202611030001_footprint_entries',
  '202611030002_footprint_location_details',
  '202611030003_footprint_media_cleanup',
];
const names = readdirSync(directory)
  .filter((file) => file.endsWith('.js'))
  .map((file) => file.slice(0, -3))
  .sort();

// 足迹相关迁移必须在迁移目录中存在，否则地图与足迹接口会在真实库上失效。
for (const migration of footprintMigrations) {
  assert.ok(names.includes(migration), `missing migration ${migration}`);
}

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
  assert.deepEqual(
    rows,
    names.map((migration) => ({ name: migration, status: 'pending' })),
  );
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
    ...names.map((migration) => ({
      name: migration,
      status: migration === name ? 'applied' : 'pending',
    })),
    { name: 'removed_migration', status: 'missing-file' },
  ]);
  assert.ok(queries.every((text) => text.startsWith('SELECT ')));
});
