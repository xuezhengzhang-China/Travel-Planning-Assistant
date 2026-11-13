const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const shanghai = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
async function smoke() {
  const { createApp } = require('../dist/app');
  const app = await createApp({ logger: false });
  const checks = [];
  try {
    await app.listen(0, '127.0.0.1');
    const base = (await app.getUrl()) + '/api';
    for (const url of ['/health', '/ready']) {
      const response = await fetch(base + url);
      assert.equal(response.status, 200, url);
      checks.push({ method: 'GET', path: url, status: response.status });
    }
    const id = '11000000-0000-4000-8002-000000000001';
    const routes = [
      ['GET', '/destinations'],
      ['GET', '/places?cityId=11000000-0000-4000-8000-000000000001'],
      ['GET', '/places/' + id],
      ['POST', '/routes/preview'],
      ['POST', '/locations/reverse'],
      ['POST', '/recommendations/places'],
      ['POST', '/recommendations/itinerary'],
      ['GET', '/recommendations/' + id],
      ['POST', '/trips'],
      ['GET', '/trips'],
      ['GET', '/trips/' + id],
      ['PATCH', '/trips/' + id],
      ['PUT', '/trips/' + id + '/selections'],
      ['POST', '/trips/' + id + '/apply-proposal'],
      ['PUT', '/trips/' + id + '/schedule'],
      ['DELETE', '/trips/' + id + '?expectedRevision=1'],
      ['GET', '/users/me'],
      ['PATCH', '/users/me'],
    ];
    for (const [method, url] of routes)
      for (const identity of ['anonymous', 'forged']) {
        const response = await fetch(base + url, {
          method,
          headers: {
            ...(identity === 'forged' ? { Authorization: 'Bearer invalid-acceptance-token' } : {}),
            ...(method === 'POST' || method === 'PUT' || method === 'PATCH'
              ? { 'Content-Type': 'application/json' }
              : {}),
          },
          ...(method === 'POST' || method === 'PUT' || method === 'PATCH' ? { body: '{}' } : {}),
        });
        const body = await response.json();
        assert.equal(response.status, 401, method + ' ' + url);
        assert.equal(body.code, 'UNAUTHENTICATED');
        checks.push({ method, path: url, identity, status: response.status });
      }
    console.log(JSON.stringify({ passed: checks.length, failed: 0, checks }, null, 2));
  } finally {
    await app.close();
  }
}
function run() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = path.resolve(root, '../../C-验收记录', stamp);
  fs.mkdirSync(output, { recursive: true });
  const startedAt = shanghai();
  const commands = [
    ['01-node', 'node --version'],
    ['02-npm', 'npm --version'],
    ['03-lint', 'npm run lint'],
    ['04-typecheck', 'npm run typecheck'],
    ['05-build', 'npm run build'],
    ['06-backend', 'npm run test --workspace=@travel/api'],
    ['07-frontend', 'npm run test --workspace=@travel/web'],
    ['08-migration-status', 'npm run db:migrate:status'],
    ['09-persistence', 'node apps/api/scripts/verify-trip-persistence.cjs'],
    ['10-migration-upgrade', 'node apps/api/scripts/verify-catalog-migration.cjs'],
    ['11-format', 'npm run format:check'],
    [
      '12-diff',
      'git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check',
    ],
    ['13-http-smoke', 'node apps/api/scripts/acceptance-c.cjs --http-smoke'],
  ];
  const results = [];
  for (const [name, command] of commands) {
    const at = shanghai(),
      start = Date.now();
    const result =
      process.platform === 'win32'
        ? spawnSync('cmd.exe', ['/d', '/s', '/c', command], {
            cwd: root,
            encoding: 'utf8',
            timeout: 180000,
            maxBuffer: 4 * 1024 * 1024,
          })
        : spawnSync('/bin/sh', ['-c', command], {
            cwd: root,
            encoding: 'utf8',
            timeout: 180000,
            maxBuffer: 4 * 1024 * 1024,
          });
    const log =
      (result.stdout ?? '') +
      (result.stderr ?? '') +
      (result.error ? '\n' + result.error.message : '');
    fs.writeFileSync(path.join(output, name + '.txt'), log);
    const record = {
      name,
      command,
      startedAt: at,
      durationMs: Date.now() - start,
      exitCode: result.status,
      passed: result.status === 0,
    };
    if (name === '06-backend' || name === '07-frontend')
      record.testCount = Number(/(?:# tests|ℹ tests)\s+(\d+)/.exec(log)?.[1] ?? 0);
    if (name === '13-http-smoke' && record.passed) {
      const parsed = JSON.parse(result.stdout);
      record.checkCount = parsed.passed;
    }
    results.push(record);
    console.log(`${record.passed ? 'PASS' : 'FAIL'} ${name} (${record.durationMs}ms)`);
    if (name === '05-build' && !record.passed) break;
  }
  const repo = path.resolve(root, '..');
  const list =
    spawnSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--full-name', '-z'],
      { cwd: repo, encoding: 'utf8' },
    ).stdout ?? '';
  const manifest = [...new Set(list.split('\0'))]
    .filter(
      (name) =>
        name.startsWith('travel-planner-v2-framework/') &&
        /\.(?:[cm]?js|tsx?|json|cts)$/.test(name) &&
        !name.includes('/docs/'),
    )
    .filter((name) => fs.existsSync(path.join(repo, name)))
    .map((name) => ({
      path: name,
      sha256: crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(repo, name)))
        .digest('hex'),
    }));
  fs.writeFileSync(path.join(output, 'source-manifest.json'), JSON.stringify(manifest, null, 2));
  const summary = {
    scope: 'current-local-C-workspace; not B remote implementation',
    startedAt,
    finishedAt: shanghai(),
    output,
    commandGroups: {
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
    },
    results,
    sourceFileCount: manifest.length,
    unverified: [
      'B implementation/remote server/Ollama: not present or connected',
      'Real AMap and map-to-schedule integration',
      'Actual teammate frontend source merge',
      'Administrator roles and D footprints/journals',
      'GitHub remote Actions and production deployment',
    ],
  };
  fs.writeFileSync(path.join(output, 'run.json'), JSON.stringify(summary, null, 2));
  const hashes = fs
    .readdirSync(output)
    .filter((name) => fs.statSync(path.join(output, name)).isFile())
    .map((name) => ({
      path: name,
      sha256: crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(output, name)))
        .digest('hex'),
    }));
  fs.writeFileSync(path.join(output, 'artifact-manifest.json'), JSON.stringify(hashes, null, 2));
  console.log(
    JSON.stringify({ output, commandGroups: summary.commandGroups, sourceFiles: manifest.length }),
  );
  if (summary.commandGroups.failed) process.exitCode = 1;
}
if (process.argv.includes('--http-smoke'))
  smoke().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
else run();
