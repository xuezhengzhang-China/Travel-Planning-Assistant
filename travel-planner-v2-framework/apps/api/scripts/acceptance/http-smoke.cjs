const { writeFileSync } = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');

async function main() {
  const [base, output] = process.argv.slice(2);
  if (!base || !output) throw new Error('Usage: http-smoke.cjs <base URL> <result JSON>');
  const results = [];
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await fetch(`${base}/health`, { signal: globalThis.AbortSignal.timeout(1000) });
      break;
    } catch {
      if (attempt === 29) throw new Error('API did not become available');
      await delay(300);
    }
  }
  async function check(name, method, path, status, expected, forged = false) {
    const headers = forged ? { authorization: 'Bearer invalid-acceptance-token' } : {};
    const started = Date.now();
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      signal: globalThis.AbortSignal.timeout(10000),
    });
    const body = await response.json();
    const passed =
      response.status === status &&
      Object.entries(expected).every(([key, value]) => body[key] === value);
    results.push({
      name,
      request: { method, url: `${base}${path}`, headers },
      expected: { status, body: expected },
      actual: { status: response.status, body },
      elapsedMs: Date.now() - started,
      passed,
    });
    console.log(
      `${passed ? 'PASS' : 'FAIL'} ${name}: ${method} ${path} -> ${response.status} ${JSON.stringify(body)}`,
    );
  }
  await check('E01 API health', 'GET', '/health', 200, {
    status: 'ok',
    service: 'travel-planner-api',
  });
  await check('E02 remote database ready', 'GET', '/ready', 200, {
    status: 'ready',
    database: 'ok',
  });
  const endpoints = [
    ['GET', '/destinations'],
    ['GET', '/places'],
    ['GET', '/places/30000000-0000-4000-8000-000000000001'],
    ['POST', '/routes/preview'],
    ['POST', '/locations/reverse'],
    ['POST', '/recommendations/itinerary'],
  ];
  for (const forged of [false, true]) {
    for (const [method, path] of endpoints)
      await check(
        forged ? 'A02 reject forged token' : 'A01 reject anonymous',
        method,
        '/b' + path,
        401,
        { code: 'UNAUTHENTICATED' },
        forged,
      );
  }
  const summary = {
    executedAt: new Date().toISOString(),
    baseUrl: base,
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    results,
  };
  writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
  console.log(`HTTP CHECKS: ${summary.passed}/${summary.total} passed; ${summary.failed} failed`);
  if (summary.failed) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
