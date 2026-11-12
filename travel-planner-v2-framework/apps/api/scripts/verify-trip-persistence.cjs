const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { resolve } = require('node:path');
const { setTimeout, clearTimeout } = require('node:timers');
const { Pool } = require('pg');
require('dotenv').config({ path: resolve(__dirname, '../../../.env'), quiet: true });

// 显式运行的真实数据库检查；只创建并清理本次验证账户，不清空业务表。
async function worker() {
  const { createApp } = require('../dist/app');
  const app = await createApp({ logger: false });
  await app.listen(0, '127.0.0.1');
  process.send({ url: await app.getUrl(), pid: process.pid });
  process.on('message', async (message) => {
    if (message === 'stop') {
      await app.close();
      process.exit(0);
    }
  });
}
async function verify() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const { BEIJING_CITY_ID } = require('../dist/trips/trip-catalog');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
  });
  const createdUsers = [];
  const createdEmails = [];
  const secret = randomBytes(48).toString('base64url');
  const runId = randomBytes(8).toString('hex');
  let child;
  const starts = [];
  async function start() {
    child = fork(resolve(__dirname, 'verify-trip-persistence.cjs'), ['--worker'], {
      env: { ...process.env, AUTH_TOKEN_SECRET: secret },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    // 不输出环境变量、密码、令牌或数据库连接串。
    child.stderr.resume();
    const current = child;
    const info = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        current.kill();
        reject(new Error('API startup timeout'));
      }, 20000);
      current.once('message', (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      current.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`API exited during startup (${code})`));
      });
    });
    starts.push(info.pid);
    return info.url;
  }
  async function stop() {
    if (!child) return;
    const current = child;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        current.kill();
        reject(new Error('API shutdown timeout'));
      }, 10000);
      current.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error('API shutdown failed'));
      });
      current.send('stop');
    });
    child = undefined;
  }
  async function request(base, path, method = 'GET', body, token, expected = 200) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(response.status, expected, `${method} ${path} HTTP status`);
    return response.json();
  }
  try {
    await pool.query('SELECT 1');
    let base = await start();
    await request(base, '/ready');
    const credentials = {
      email: `persistence-${runId}@example.invalid`,
      password: randomBytes(24).toString('base64url'),
      displayName: '草稿持久化验证',
    };
    const user = await request(base, '/auth/register', 'POST', credentials, undefined, 201);
    createdUsers.push(user.user.id);
    createdEmails.push(credentials.email);
    const login = await request(base, '/auth/login', 'POST', {
      email: credentials.email,
      password: credentials.password,
    });
    const token = login.accessToken;
    let trip = await request(
      base,
      '/trips',
      'POST',
      { title: '北京草稿真实重启验证', cityId: BEIJING_CITY_ID },
      token,
      201,
    );
    const dates = {
      startDate: '2026-11-10',
      endDate: '2026-11-12',
      themes: ['art', 'family', 'history', 'landmark', 'local', 'nature'],
      pace: 'relaxed',
      transportMode: 'transit',
    };
    trip = await request(
      base,
      `/trips/${trip.id}`,
      'PATCH',
      { expectedRevision: trip.revision, planningInput: dates },
      token,
    );
    const placeIds = [1, 5].map((i) => `11000000-0000-4000-8001-${String(i).padStart(12, '0')}`);
    trip = await request(
      base,
      `/trips/${trip.id}/selections`,
      'PUT',
      { expectedRevision: trip.revision, placeIds },
      token,
    );
    assert.equal(trip.revision, 3);
    assert.equal(trip.status, 'draft');
    assert.deepEqual(trip.planningInput.themes, dates.themes);
    assert.deepEqual(trip.planningInput.selectedPlaceIds, placeIds);
    const db = await pool.query(
      'SELECT revision, themes, selected_place_ids FROM trip_resources WHERE id=$1 AND owner_id=$2',
      [trip.id, user.user.id],
    );
    assert.equal(db.rows[0].revision, 3);
    assert.deepEqual(db.rows[0].themes, dates.themes);
    assert.deepEqual(db.rows[0].selected_place_ids, placeIds);
    console.log('PASS: 真实账户鉴权、草稿创建、日期/六类偏好/景点保存，SQL确认 revision=3');
    const ranked = await request(
      base,
      '/recommendations/places',
      'POST',
      { cityId: BEIJING_CITY_ID, themes: ['family'], pace: 'standard' },
      token,
    );
    assert.equal(ranked.items.length, 18);
    const proposal = await request(
      base,
      '/recommendations/itinerary',
      'POST',
      trip.planningInput,
      token,
    );
    assert.equal(proposal.source, 'rule');
    assert.deepEqual(proposal.unassignedPlaceIds, []);
    console.log('PASS: 真实推荐接口生成规则方案，已写入 PostgreSQL');
    const before = await request(base, `/trips/${trip.id}`, 'GET', undefined, token);
    await stop();
    base = await start();
    assert.notEqual(starts[0], starts[1]);
    const after = await request(base, `/trips/${trip.id}`, 'GET', undefined, token);
    assert.deepEqual(after, before);
    const list = await request(base, '/trips?page=1&pageSize=20', 'GET', undefined, token);
    assert.ok(list.items.some((item) => item.id === trip.id));
    const conflict = await request(
      base,
      `/trips/${trip.id}`,
      'PATCH',
      { expectedRevision: 1, title: '不应覆盖' },
      token,
      409,
    );
    assert.equal(conflict.code, 'REVISION_CONFLICT');
    console.log(
      'PASS: API真实进程退出并重启，新进程读取内容与重启前完全一致，列表可恢复，旧版本写入被拒绝',
    );
    const restoredProposal = await request(
      base,
      '/recommendations/' + proposal.proposalId,
      'GET',
      undefined,
      token,
    );
    assert.deepEqual(restoredProposal, proposal);
    let planned = await request(
      base,
      '/trips/' + trip.id + '/apply-proposal',
      'POST',
      { expectedRevision: after.revision, proposalId: proposal.proposalId },
      token,
    );
    assert.equal(planned.status, 'planned');
    assert.equal(planned.revision, 4);
    const editedDays = structuredClone(planned.days);
    for (const day of editedDays)
      for (const item of day.items) {
        const [h, m] = item.startTime.split(':').map(Number);
        const minutes = h * 60 + m + 10;
        item.startTime =
          String(Math.floor(minutes / 60)).padStart(2, '0') +
          ':' +
          String(minutes % 60).padStart(2, '0');
      }
    planned = await request(
      base,
      '/trips/' + trip.id + '/schedule',
      'PUT',
      { expectedRevision: planned.revision, days: editedDays },
      token,
    );
    assert.equal(planned.revision, 5);
    const persisted = await pool.query('SELECT status,days FROM trip_resources WHERE id=$1', [
      trip.id,
    ]);
    assert.equal(persisted.rows[0].status, 'planned');
    assert.deepEqual(persisted.rows[0].days, editedDays);
    await stop();
    base = await start();
    assert.notEqual(starts[1], starts[2]);
    assert.deepEqual(await request(base, '/trips/' + trip.id, 'GET', undefined, token), planned);
    console.log('PASS: 方案跨重启恢复→确认为planned→手动调整时间→再次重启读取一致，最终revision=5');
    const catalogPage = await request(
      base,
      `/places?cityId=${BEIJING_CITY_ID}&pageSize=100`,
      'GET',
      undefined,
      token,
    );
    assert.equal(catalogPage.total, 18);
    assert.equal(catalogPage.items[0].coordinates, null);
    if (!process.env.AMAP_WEB_SERVICE_KEY?.trim()) {
      const point = { longitude: 116.4, latitude: 39.9, coordinateSystem: 'GCJ-02' };
      const unavailable = await request(
        base,
        '/routes/preview',
        'POST',
        { from: point, to: point, transportMode: 'walking' },
        token,
        503,
      );
      assert.equal(unavailable.code, 'DEPENDENCY_UNAVAILABLE');
    }
    const rows = await pool.query(
      'SELECT (SELECT count(*) FROM trip_selections WHERE trip_id=$1) AS selections,(SELECT count(*) FROM trip_days WHERE trip_id=$1) AS days,(SELECT count(*) FROM trip_items WHERE trip_id=$1) AS items',
      [trip.id],
    );
    assert.deepEqual(rows.rows[0], { selections: '2', days: '3', items: '2' });
    const { PostgresTripRepository } = require('../dist/trips/trip.repository');
    const { DatabaseService } = require('../dist/database/database.service');
    const repository = new PostgresTripRepository(new DatabaseService(pool));
    await assert.rejects(
      repository.mutate(user.user.id, trip.id, planned.revision, async (current) => ({
        ...current,
        title: 'rollback-probe',
        planningInput: {
          ...current.planningInput,
          selectedPlaceIds: [
            ...current.planningInput.selectedPlaceIds,
            current.planningInput.selectedPlaceIds[0],
          ],
        },
      })),
    );
    assert.deepEqual(await request(base, '/trips/' + trip.id, 'GET', undefined, token), planned);
    console.log('PASS: 关系表完整保存；写入第二条重复选择失败时，名称、版本和原安排全部回滚');
    const concurrent = await Promise.all(
      ['a', 'b'].map((title) =>
        fetch(base + '/api/trips/' + trip.id, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedRevision: planned.revision, title }),
        }),
      ),
    );
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
    planned = await request(base, '/trips/' + trip.id, 'GET', undefined, token);
    const secondCredentials = {
      email: `persistence-other-${runId}@example.invalid`,
      password: randomBytes(24).toString('base64url'),
      displayName: '权限验证',
    };
    const second = await request(base, '/auth/register', 'POST', secondCredentials, undefined, 201);
    createdUsers.push(second.user.id);
    createdEmails.push(secondCredentials.email);
    const secondLogin = await request(base, '/auth/login', 'POST', {
      email: secondCredentials.email,
      password: secondCredentials.password,
    });
    await request(base, '/trips/' + trip.id, 'GET', undefined, secondLogin.accessToken, 404);
    await request(
      base,
      `/trips/${trip.id}?expectedRevision=${planned.revision}`,
      'DELETE',
      undefined,
      secondLogin.accessToken,
      404,
    );
    await request(base, `/trips/${trip.id}?expectedRevision=1`, 'DELETE', undefined, token, 409);
    const deleted = await fetch(
      `${base}/api/trips/${trip.id}?expectedRevision=${planned.revision}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    );
    assert.equal(deleted.status, 204);
    await request(base, '/trips/' + trip.id, 'GET', undefined, token, 404);
    const left = await pool.query(
      'SELECT (SELECT count(*) FROM trip_selections WHERE trip_id=$1)+(SELECT count(*) FROM trip_days WHERE trip_id=$1)+(SELECT count(*) FROM trip_items WHERE trip_id=$1) AS total',
      [trip.id],
    );
    assert.equal(left.rows[0].total, '0');
    console.log('PASS: 相同版本并发写入仅一个成功；旧版本删除被拒绝；删除行程级联清理选择和安排');

    console.log(
      JSON.stringify(
        {
          result: 'passed',
          restart: 'distinct-node-processes',
          draftRevision: after.revision,
          plannedRevision: planned.revision,
          themeCount: after.planningInput.themes.length,
          placeCount: after.planningInput.selectedPlaceIds.length,
        },
        null,
        2,
      ),
    );
  } finally {
    if (child) await stop();
    if (createdUsers.length)
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[]) AND email=ANY($2::text[])', [
        createdUsers,
        createdEmails,
      ]);
    await pool.end();
    console.log('验证账户及其草稿已清理，项目数据库与容器保留。');
  }
}
(process.argv.includes('--worker') ? worker() : verify()).catch((error) => {
  console.error(`Persistence verification failed: ${error.message}`);
  process.exitCode = 1;
});
