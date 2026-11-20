// Explicit future execution entry. Do not run while the user has requested test authoring only.
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const { pathToFileURL } = require("node:url");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const manifest = require("../cases/tdd-core.v1.json");
const argv = process.argv.slice(2);
function value(option) {
  const index = argv.indexOf(option);
  return index < 0 ? undefined : argv[index + 1];
}
function digest(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
async function main() {
  const configured = value("--subject") || process.env.TPA_TDD_SUBJECT_ROOT;
  const phase = value("--phase");
  if (!configured || !path.isAbsolute(configured))
    throw new Error(
      "用 --subject 或 TPA_TDD_SUBJECT_ROOT 指定被测工程绝对路径，不使用旧实现作为默认起点。",
    );
  if (!/^T[0-8]$/.test(phase || ""))
    throw new Error(
      "必须显式指定 --phase T0 至 T8。该标签记录实际阶段，不预设结果。",
    );
  const subject = path.resolve(configured);
  if (!fs.existsSync(path.join(subject, "package.json")))
    throw new Error("被测工程 package.json 不存在。");
  for (const name of [
    "b/validation.js",
    "b/b.module.js",
    "places/places.service.js",
    "places/places.repository.js",
    "recommendations/rule-planner.js",
    "recommendations/recommendations.service.js",
    "recommendations/proposals.repository.js",
    "integrations/amap/amap.client.js",
    "integrations/amap/geo.service.js",
    "integrations/llm/llm.advisor.js",
  ]) {
    if (!fs.existsSync(path.join(subject, "apps/api/dist", name)))
      throw new Error(
        `缺少已构建的接口骨架 ${name}；本入口不自动编写或构建业务实现。`,
      );
  }
  const dependency = require("node:module").createRequire(
    path.join(subject, "package.json"),
  );
  dependency.resolve("@nestjs/core");
  dependency.resolve("pg");
  dependency.resolve("node-pg-migrate");
  dependency("reflect-metadata");
  const interfaces = {
    "b/validation.js": [
      "planningInput",
      "calendarDates",
      "coordinates",
      "uuid",
      "pagination",
    ],
    "b/config.js": ["readBConfig", "BConfig"],
    "b/b.module.js": ["BModule"],
    "places/places.service.js": ["PlacesService"],
    "places/places.repository.js": ["PlacesRepository"],
    "recommendations/rule-planner.js": [
      "planRule",
      "validateSchedule",
      "RouteNeeded",
      "routeKey",
    ],
    "recommendations/recommendations.service.js": [
      "RecommendationsService",
      "isProposalExpired",
    ],
    "recommendations/proposals.repository.js": ["ProposalsRepository"],
    "integrations/amap/amap.client.js": ["AmapClient"],
    "integrations/amap/geo.service.js": ["GeoService"],
    "integrations/llm/llm.advisor.js": ["LlmAdvisor"],
  };
  for (const [file, exports] of Object.entries(interfaces)) {
    let module;
    try {
      module = dependency(path.join(subject, "apps/api/dist", file));
    } catch {
      throw new Error(`无法加载接口骨架 ${file}，应先修复环境或构建。`);
    }
    for (const name of exports)
      if (typeof module[name] !== "function")
        throw new Error(
          `接口骨架缺少 ${file} 的 ${name} 导出，不把加载错误算作业务Red。`,
        );
  }
  let revision;
  try {
    revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: subject,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    revision = value("--revision");
  }
  if (!revision)
    throw new Error(
      "非 Git 工程必须用 --revision 明确来源；不能把旧验收提交作为默认版本。",
    );
  const env = { ...process.env, TPA_TDD_SUBJECT_ROOT: subject };
  const envFile = process.env.TPA_TDD_ENV_FILE;
  if (envFile) {
    if (!fs.existsSync(envFile)) throw new Error("TPA_TDD_ENV_FILE 不存在。");
    const privateSettings = dependency("dotenv").parse(
      fs.readFileSync(envFile),
    );
    if (!env.TEST_DATABASE_URL && privateSettings.TEST_DATABASE_URL)
      env.TEST_DATABASE_URL = privateSettings.TEST_DATABASE_URL;
  }
  // Never load or print the developer's whole .env. Core tests need no paid provider.
  if (env.TEST_DATABASE_URL) {
    let db;
    try {
      db = new URL(env.TEST_DATABASE_URL);
    } catch {
      throw new Error("TEST_DATABASE_URL 格式错误。");
    }
    if (
      !["postgres:", "postgresql:"].includes(db.protocol) ||
      !/^[a-z0-9_]+_test$/.test(decodeURIComponent(db.pathname.slice(1)))
    )
      throw new Error("只允许专用 PostgreSQL _test 库。");
  }
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "");
  const report = path.join(
    root,
    "reports/tdd",
    `${stamp}-${phase}-${process.pid}`,
  );
  fs.mkdirSync(report, { recursive: true });
  const sourceHashes = Object.fromEntries(
    [
      "b/validation.js",
      "b/b.module.js",
      "places/places.repository.js",
      "places/places.service.js",
      "recommendations/rule-planner.js",
      "recommendations/recommendations.service.js",
      "recommendations/proposals.repository.js",
      "integrations/amap/amap.client.js",
      "integrations/amap/geo.service.js",
      "integrations/llm/llm.advisor.js",
    ].map((name) => [name, digest(path.join(subject, "apps/api/dist", name))]),
  );
  const metadata = {
    startedAt: new Date().toISOString(),
    timeZone: "Asia/Shanghai",
    phase,
    subject,
    revision,
    suiteVersion: manifest.version,
    manifestSha256: digest(path.join(root, "cases/tdd-core.v1.json")),
    testFileHashes: Object.fromEntries(
      [
        "core.test.cjs",
        "validation.cases.cjs",
        "catalog.cases.cjs",
        "planner.cases.cjs",
        "proposals.cases.cjs",
        "geo.cases.cjs",
        "model.cases.cjs",
        "http.cases.cjs",
        "support/context.cjs",
        "support/fixtures.cjs",
      ].map((name) => [name, digest(path.join(root, "tests/tdd", name))]),
    ),
    sourceHashes,
    scope:
      "B frozen core; maps/models are controlled fixtures; database cases require real dedicated PostgreSQL; no A/C/D joint certification",
  };
  fs.writeFileSync(
    path.join(report, "execution.json"),
    JSON.stringify(metadata, null, 2) + "\n",
  );
  const args = [
    "--test",
    "--test-concurrency=1",
    "--test-reporter=" +
      pathToFileURL(path.join(root, "scripts/tdd-reporter.cjs")).href,
    path.join(root, "tests/tdd/core.test.cjs"),
  ];
  const output = fs.createWriteStream(path.join(report, "console.txt"), {
    flags: "wx",
  });
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...env, TPA_TDD_REPORT_DIR: report },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (bytes) => {
      output.write(bytes);
      process.stdout.write(bytes);
    });
  let code;
  try {
    [code] = await once(child, "close");
  } catch {
    code = 1;
  }
  output.end();
  await once(output, "finish");
  const resultsPath = path.join(report, "core-results.json");
  const result = fs.existsSync(resultsPath)
    ? JSON.parse(fs.readFileSync(resultsPath, "utf8"))
    : null;
  metadata.finishedAt = new Date().toISOString();
  metadata.childExitCode = code;
  metadata.outcome =
    !result || !result.validMeasurement
      ? "incomplete-or-environment-error"
      : result.classification;
  metadata.expectedT0ZeroConfirmed =
    phase === "T0" && result?.validMeasurement && result.passed === 0;
  fs.writeFileSync(
    path.join(report, "execution.json"),
    JSON.stringify(metadata, null, 2) + "\n",
  );
  const rows =
    result?.cases
      .map(
        (c) =>
          `| ${c.id} | ${c.title} | ${c.status} | ${(c.reason || "").replaceAll("|", "\\|").replaceAll("\n", " ")} |`,
      )
      .join("\n") || "";
  fs.writeFileSync(
    path.join(report, "阶段结果.md"),
    `# TDD ${phase} 实际结果\n\n版本：${revision}\n\n用例集：${manifest.version}\n\n结论：${metadata.outcome}\n\n通过：${result?.passed ?? "未知"}/${manifest.total}；失败：${result?.failed ?? "未知"}；阻塞：${result?.blocked ?? "未知"}；未执行：${result?.notRun ?? "未知"}。\n\n有效业务测量：${result?.validMeasurement ?? false}。环境错误或阻塞不能当作初始0%的证据。\n\n| ID | 用例 | 状态 | 原因 |\n| --- | --- | --- | --- |\n${rows}\n`,
  );
  console.log("报告：" + report);
  process.exitCode =
    !result || !result.validMeasurement ? 2 : code || (result.failed ? 1 : 0);
  if (phase === "T0" && result?.validMeasurement && result.passed !== 0) {
    console.error("T0 实际已有通过用例，请核对起始版本；不改写实际结果。");
    process.exitCode = 3;
  }
}
main().catch((error) => {
  console.error("TDD 环境/执行错误：" + error.message);
  process.exitCode = 2;
});
