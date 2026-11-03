const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
const { URL } = require('node:url');
const { Pool } = require('pg');
const { runner } = require('node-pg-migrate');
const catalog = require('@travel/shared/beijing-catalog.json');
const { generatePlan } = require('@travel/shared/recommendation-engine');
require('dotenv').config({ path: resolve(__dirname, '../../../.env'), quiet: true });
// 只在本次创建的独立临时库验证；不会对项目库执行 down 或清空操作。
async function verify() {
  const source = new URL(process.env.DATABASE_URL);
  const name = `travel_migration_${randomBytes(8).toString('hex')}`;
  if (!/^travel_migration_[0-9a-f]{16}$/.test(name)) throw new Error('Unexpected database name');
  const admin = new Pool({ connectionString: source.toString() });
  const target = new URL(source);
  target.pathname = '/' + name;
  const testDb = new Pool({ connectionString: target.toString() });
  let created = false;
  const options = {
    databaseUrl: target.toString(),
    dir: resolve(__dirname, '../migrations'),
    migrationsTable: 'pgmigrations',
    direction: 'up',
    logger: { info() {}, warn() {}, error() {} },
  };
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await runner(options);
    assert.equal((await testDb.query('SELECT count(*) FROM places')).rows[0].count, '18');
    console.log('PASS: 空临时库完整执行全部迁移，导入18个景点');
    await runner({ ...options, direction: 'down', count: 1 });
    const owner = randomUUID(),
      id = randomUUID();
    const input = {
      cityId: catalog.city.id,
      startDate: '2026-11-10',
      endDate: '2026-11-12',
      themes: ['history'],
      pace: 'standard',
      transportMode: 'transit',
      selectedPlaceIds: catalog.places.slice(0, 2).map((p) => p.id),
    };
    const plan = generatePlan(catalog.places, input);
    await testDb.query('INSERT INTO users(id,email) VALUES($1,$2)', [
      owner,
      'migration@example.invalid',
    ]);
    await testDb.query(
      `INSERT INTO trips(id,owner_id,title,city_id,start_date,end_date,revision,status,themes,pace,transport_mode,selected_place_ids,days)
      VALUES($1,$2,$3,$4,$5,$6,7,'planned',$7::jsonb,$8,$9,$10::jsonb,$11::jsonb)`,
      [
        id,
        owner,
        '迁移前已保存行程',
        input.cityId,
        input.startDate,
        input.endDate,
        JSON.stringify(input.themes),
        input.pace,
        input.transportMode,
        JSON.stringify(input.selectedPlaceIds),
        JSON.stringify(plan.days),
      ],
    );
    await runner(options);
    let read = await testDb.query(
      'SELECT title,revision,selected_place_ids,days FROM trip_resources WHERE id=$1',
      [id],
    );
    assert.equal(read.rows[0].title, '迁移前已保存行程');
    assert.equal(read.rows[0].revision, 7);
    assert.deepEqual(read.rows[0].selected_place_ids, input.selectedPlaceIds);
    assert.deepEqual(read.rows[0].days, plan.days);
    console.log('PASS: 旧库已有名称、版本、选择和正式安排无损迁移到独立表');
    await runner({ ...options, direction: 'down', count: 1 });
    read = await testDb.query('SELECT selected_place_ids,days FROM trips WHERE id=$1', [id]);
    assert.deepEqual(read.rows[0].days, plan.days);
    await runner(options);
    assert.deepEqual(
      (await testDb.query('SELECT days FROM trip_resources WHERE id=$1', [id])).rows[0].days,
      plan.days,
    );
    console.log('PASS: 新迁移回滚与再次升级均保持安排一致');
  } finally {
    await testDb.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
}
verify().catch(() => {
  console.error('Migration verification failed');
  process.exitCode = 1;
});
