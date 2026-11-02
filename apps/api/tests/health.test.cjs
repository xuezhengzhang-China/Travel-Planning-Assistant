const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:net');
const { createApp } = require('../dist/app.js');
const { HealthController } = require('../dist/health/health.controller.js');
const { DatabaseService } = require('../dist/database/database.service.js');

test('HTTP health endpoints use injected database service and report unavailable as 503', async () => {
  const blocker = createServer((socket) => socket.destroy());
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const databasePort = blocker.address().port;
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `postgresql://test:test@127.0.0.1:${databasePort}/test`;
  let app;
  try {
    assert.deepEqual(Reflect.getMetadata('design:paramtypes', HealthController), [DatabaseService]);
    app = await createApp({ logger: false });
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const alive = await fetch(`${base}/api/health`);
    assert.equal(alive.status, 200);
    assert.deepEqual(await alive.json(), { status: 'ok', service: 'travel-planner-api' });
    const unavailable = await fetch(`${base}/api/ready`);
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { status: 'unavailable', database: 'not-ready' });
    app.get(DatabaseService).isReady = async () => true;
    const available = await fetch(`${base}/api/ready`);
    assert.equal(available.status, 200);
    assert.deepEqual(await available.json(), { status: 'ready', database: 'ok' });
  } finally {
    if (app) await app.close();
    await new Promise((resolve) => blocker.close(resolve));
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});
