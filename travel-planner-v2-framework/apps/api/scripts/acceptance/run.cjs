const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '../../../..');
const position = process.argv.indexOf('--output');
const output = path.resolve(
  root,
  position < 0 ? `docs/acceptance/B-${Date.now()}` : process.argv[position + 1],
);
if (!output.startsWith(root + path.sep))
  throw new Error('Evidence directory must be inside the project');
if (fs.existsSync(path.join(output, 'run.json')))
  throw new Error('Existing acceptance evidence cannot be overwritten; choose a new directory');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run through npm run acceptance:b -- --output <directory>');
fs.mkdirSync(output, { recursive: true });
const results = [];
const startedAt = new Date().toISOString();
const replay = [
  '# Run in the project root. Keep npm run db:tunnel:b active in another terminal.',
  `Set-Location '${root.replaceAll("'", "''")}'`,
];
const realModel = process.argv.includes('--real-model');
const environment = {
  ...process.env,
  NO_COLOR: '1',
  B_ACCEPTANCE_OUTPUT: output,
  B_ACCEPT_REAL_LLM: realModel ? 'true' : 'false',
};

async function run(id, title, program, args, shown) {
  const log = `${id}.txt`;
  const started = new Date();
  const stream = fs.createWriteStream(path.join(output, log));
  stream.write(`COMMAND: ${shown}\nSTART UTC: ${started.toISOString()}\nWORKDIR: ${root}\n\n`);
  console.log(`\n[${id}] ${title}: ${shown}`);
  replay.push(shown);
  const child = spawn(program, args, {
    cwd: root,
    env: environment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const channel of [child.stdout, child.stderr])
    channel.on('data', (chunk) => {
      stream.write(chunk);
      process.stdout.write(chunk);
    });
  let launchError;
  child.on('error', (error) => {
    launchError = error;
  });
  const [code, signal] = await once(child, 'close');
  const exitCode = launchError ? 1 : (code ?? 1);
  if (launchError) stream.write(`\nPROCESS ERROR: ${launchError.message}\n`);
  stream.end(`\nEXIT CODE: ${exitCode}\nEND UTC: ${new Date().toISOString()}\n`);
  await once(stream, 'finish');
  results.push({
    id,
    title,
    command: shown,
    log,
    startedAt: started.toISOString(),
    elapsedMs: Date.now() - started.getTime(),
    exitCode,
    signal,
  });
}
async function npm(id, name) {
  await run(id, name, process.execPath, [npmCli, 'run', name], `npm run ${name}`);
}

async function main() {
  await run('01-node', 'Node version', process.execPath, ['--version'], 'node --version');
  await run('02-npm', 'npm version', process.execPath, [npmCli, '--version'], 'npm --version');
  await npm('03-lint', 'lint');
  await npm('04-typecheck', 'typecheck');
  await npm('05-build', 'build');
  await npm('06-fast-tests', 'test');
  await npm('07-migrations', 'db:migrate:status');
  await npm('08-integration', 'test:integration:b');
  await run(
    '08b-full-b',
    'Complete B HTTP/database acceptance and optional real model',
    process.execPath,
    [path.join(__dirname, 'full-b.cjs')],
    `$env:B_ACCEPTANCE_OUTPUT='${output.replaceAll("'", "''")}'; $env:B_ACCEPT_REAL_LLM='${realModel}'; node apps/api/scripts/acceptance/full-b.cjs`,
  );
  await npm('09-format', 'format:check');
  await run(
    '10-diff-check',
    'Git whitespace check',
    'git',
    ['-c', 'core.autocrlf=false', 'diff', '--check'],
    'git -c core.autocrlf=false diff --check',
  );
  let api;
  const apiOut = fs.openSync(path.join(output, 'api-stdout.txt'), 'w');
  const apiErr = fs.openSync(path.join(output, 'api-stderr.txt'), 'w');
  try {
    const port = 3031;
    const base = `http://127.0.0.1:${port}/api`;
    console.log(`Starting dedicated acceptance API on ${base}`);
    replay.push(
      '# HTTP smoke uses a temporary API at port 3031, started and stopped by the acceptance runner.',
    );
    api = spawn(process.execPath, [path.join(root, 'apps/api/dist/main.js')], {
      cwd: root,
      env: { ...environment, PORT: String(port) },
      windowsHide: true,
      stdio: ['ignore', apiOut, apiErr],
    });
    await run(
      '11-http-smoke',
      'Live HTTP health/readiness/authentication',
      process.execPath,
      [path.join(__dirname, 'http-smoke.cjs'), base, path.join(output, 'http-results.json')],
      `node apps/api/scripts/acceptance/http-smoke.cjs ${base} "${path.join(output, 'http-results.json')}"`,
    );
  } finally {
    if (api && api.exitCode === null) {
      api.kill();
      await Promise.race([once(api, 'close'), delay(5000)]);
    }
    fs.closeSync(apiOut);
    fs.closeSync(apiErr);
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    results.push({
      id: 'runner-error',
      title: 'Acceptance runner',
      exitCode: 1,
      error: error.message,
    });
  })
  .finally(() => {
    const gitOutput = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    const revision = gitOutput(['rev-parse', 'HEAD']);
    const sourceFiles = gitOutput([
      '-c',
      'core.quotepath=false',
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
    ])
      .split('\n')
      .filter(
        (name) =>
          name &&
          !name.startsWith('docs/acceptance/') &&
          !name.split('/').some((part) => part === '__pycache__') &&
          !name.startsWith('.env'),
      );
    const sourceManifest = [...new Set(sourceFiles)]
      .sort()
      .filter((name) => fs.existsSync(path.join(root, name)))
      .map((name) => ({
        path: name,
        sha256: createHash('sha256')
          .update(fs.readFileSync(path.join(root, name)))
          .digest('hex'),
      }));
    fs.writeFileSync(
      path.join(output, 'source-manifest.json'),
      JSON.stringify(sourceManifest, null, 2) + '\n',
    );
    fs.writeFileSync(path.join(output, 'commands.ps1'), replay.join('\n') + '\n');
    const manifest = {
      startedAt,
      finishedAt: new Date().toISOString(),
      timeZone: 'Asia/Shanghai',
      projectRoot: root,
      baseRevision: revision,
      workingTreeChangesIncluded: true,
      commandGroups: results.length,
      passed: results.filter((r) => r.exitCode === 0).length,
      failed: results.filter((r) => r.exitCode !== 0).length,
      results,
      pending: [
        'C real registration/login and B authenticator integration',
        'A/C formal trip confirmation and pages',
        'D map/journal integration',
        'Real AMap provider verification; controlled HTTP adapter tests do not certify AMap permissions/data',
        ...(realModel ? [] : ['Real model provider verification (not enabled for this run)']),
      ],
    };
    fs.writeFileSync(path.join(output, 'run.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(
      `\nACCEPTANCE COMMAND GROUPS: ${manifest.passed}/${manifest.commandGroups} passed; ${manifest.failed} failed`,
    );
    console.log(`Evidence: ${output}`);
    if (manifest.failed) process.exitCode = 1;
  });
