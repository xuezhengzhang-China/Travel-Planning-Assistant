const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { config } = require('dotenv');

function testDatabaseUrl(value) {
  if (!value) throw new Error('TEST_DATABASE_URL is required');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid TEST_DATABASE_URL');
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^[a-z0-9_]+_test$/.test(database)) {
    throw new Error('TEST_DATABASE_URL must use a dedicated database ending in _test');
  }
  return value;
}
module.exports = { testDatabaseUrl };
if (require.main === module) {
  config({ path: resolve(__dirname, '../../../.env') });
  try {
    testDatabaseUrl(process.env.TEST_DATABASE_URL);
    const result = spawnSync(
      process.execPath,
      ['--test', resolve(__dirname, '../tests/integration/b.test.cjs')],
      {
        stdio: 'inherit',
        env: process.env,
      },
    );
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
