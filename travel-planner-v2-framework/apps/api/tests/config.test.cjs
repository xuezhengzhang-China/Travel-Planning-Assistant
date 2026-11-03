const test = require('node:test');
const assert = require('node:assert/strict');
const { readConfig } = require('../dist/config/config.service.js');

const database = { DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test' };

test('configuration has explicit defaults and trims CORS origins', () => {
  const config = readConfig({
    ...database,
    CORS_ORIGIN: ' http://localhost:5173, https://example.com ',
  });
  assert.equal(config.port, 3000);
  assert.deepEqual(config.corsOrigins, ['http://localhost:5173', 'https://example.com']);
  assert.equal(config.databaseConnectionTimeoutMs, 2000);
  assert.equal(config.databaseQueryTimeoutMs, 10000);
});

test('missing or invalid database URL is rejected without echoing credentials', () => {
  assert.throws(() => readConfig({}), /DATABASE_URL is required/);
  assert.throws(() => readConfig({ DATABASE_URL: 'https://secret@example.com/db' }), {
    message: 'DATABASE_URL must be a PostgreSQL URL',
  });
});

test('invalid numeric configuration and CORS origins are rejected', () => {
  for (const PORT of ['0', '-1', '3000oops', '65536', '2.5', '']) {
    assert.throws(() => readConfig({ ...database, PORT }));
  }
  for (const CORS_ORIGIN of ['', '*', 'http://localhost:5173/path', 'file:///tmp']) {
    assert.throws(() => readConfig({ ...database, CORS_ORIGIN }));
  }
  assert.throws(() => readConfig({ ...database, DB_QUERY_TIMEOUT_MS: '0' }));
  assert.throws(() => readConfig({ ...database, DB_CONNECTION_TIMEOUT_MS: '60001' }));
});
