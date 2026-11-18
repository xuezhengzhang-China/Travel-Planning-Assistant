// Future execution entry only. Authoring/static checking must not invoke this file.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createRequire } = require("node:module");
const { execFileSync, spawn } = require("node:child_process");
const { once } = require("node:events");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, ".."),
  manifest = require("../cases/app-core.v1.json");
const argv = process.argv.slice(2);
function option(key) {
  const i = argv.indexOf(key);
  return i < 0 ? undefined : argv[i + 1];
}
function hash(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function files(dir) {
  return fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((d) =>
          d.isDirectory()
            ? files(path.join(dir, d.name))
            : [path.join(dir, d.name)],
        )
    : [];
}
function hashes(dir, relativeTo, filter = () => true) {
  return Object.fromEntries(
    files(dir)
      .filter(filter)
      .map((f) => [
        path.relative(relativeTo, f).replaceAll("\\", "/"),
        hash(f),
      ]),
  );
}
function redact(text, env) {
  for (const [key, value] of Object.entries(env))
    if (
      /(?:KEY|SECRET|PASSWORD|TOKEN|DATABASE_URL)$/.test(key) &&
      value &&
      value.length >= 6
    )
      text = text.split(value).join("[REDACTED]");
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://[REDACTED]");
}
async function main() {
  const configured =
    option("--subject") ||
    process.env.TPA_APP_SUBJECT_ROOT ||
    process.env.TPA_TDD_SUBJECT_ROOT;
  if (!configured || !path.isAbsolute(configured))
    throw new Error(
      "请显式配置 TPA_APP_SUBJECT_ROOT 或 --subject 为目标工程绝对路径",
    );
  const phase = option("--phase");
  if (!/^T(?:[0-9]|10)$/.test(phase || ""))
    throw new Error("必须指定实际开发阶段 --phase T0 至 T10");
  const subject = path.resolve(configured);
  if (!fs.existsSync(path.join(subject, "package.json")))
    throw new Error("目标路径不包含 package.json");
  const dependency = createRequire(path.join(subject, "package.json"));
  for (const name of [
    "@nestjs/core",
    "@nestjs/platform-express",
    "pg",
    "node-pg-migrate",
    "dotenv",
    "reflect-metadata",
  ])
    dependency.resolve(name);
  require.resolve("@playwright/test");
  const env = {
    ...process.env,
    TPA_APP_SUBJECT_ROOT: subject,
    TPA_TDD_SUBJECT_ROOT: subject,
  };
  const privateFile = process.env.TPA_APP_ENV_FILE;
  const allowed = [
    "TEST_DATABASE_URL",
    "LLM_API_BASE_URL",
    "LLM_MODEL",
    "LLM_API_KEY",
    "AMAP_WEB_SERVICE_KEY",
    "TPA_APP_REAL_MODEL",
    "TPA_APP_REAL_AMAP",
    "TPA_BROWSER_CHANNEL",
  ];
  if (privateFile) {
    if (!path.isAbsolute(privateFile))
      throw new Error("TPA_APP_ENV_FILE 必须是绝对路径");
    const parsed = dependency("dotenv").parse(fs.readFileSync(privateFile));
    for (const key of allowed)
      if (env[key] === undefined && parsed[key] !== undefined)
        env[key] = parsed[key];
  }
  if (env.TEST_DATABASE_URL) {
    let url;
    try {
      url = new URL(env.TEST_DATABASE_URL);
    } catch {
      throw new Error("测试库连接串格式错误");
    }
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !/^[a-z0-9_]+_test$/.test(decodeURIComponent(url.pathname.slice(1)))
    )
      throw new Error("仅允许 PostgreSQL 专用 _test 库");
  }
  // Only infrastructure/skeleton readiness is checked here. Missing business routes must fail real assertions.
  dependency("reflect-metadata");
  const skeleton = {
    "app.js": ["createApp"],
    "b/validation.js": [
      "planningInput",
      "calendarDates",
      "coordinates",
      "uuid",
      "pagination",
    ],
    "b/b.module.js": ["BModule"],
    "b/config.js": ["BConfig", "readBConfig"],
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
  for (const [file, names] of Object.entries(skeleton)) {
    let loaded;
    try {
      loaded = dependency(path.join(subject, "apps/api/dist", file));
    } catch {
      throw new Error("接口骨架无法加载：" + file + "，请先修复依赖和构建");
    }
    for (const name of names)
      if (typeof loaded[name] !== "function")
        throw new Error("接口骨架缺少导出：" + file + " " + name);
  }
  let revision = option("--revision"),
    dirty = null;
  try {
    revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: subject,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    dirty = Boolean(
      execFileSync("git", ["status", "--porcelain"], {
        cwd: subject,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim(),
    );
  } catch {}
  if (!revision) throw new Error("非 Git 目标需 --revision 声明真实来源版本");
  const report = path.join(
    root,
    "reports/app",
    new Date().toISOString().replace(/[^0-9]/g, "") +
      "-" +
      phase +
      "-" +
      process.pid,
  );
  fs.mkdirSync(report, { recursive: true });
  const args = [
    "--test",
    "--test-concurrency=1",
    "--test-reporter=" +
      pathToFileURL(path.join(root, "scripts/app-reporter.cjs")).href,
    path.join(root, "tests/app/core.test.cjs"),
  ];
  const metadata = {
    suiteVersion: manifest.version,
    total: manifest.total,
    phase,
    subject,
    revision,
    subjectDirty: dirty,
    startedAt: new Date().toISOString(),
    timeZone: "Asia/Shanghai",
    command: [process.execPath, ...args],
    manifestSha256: hash(path.join(root, "cases/app-core.v1.json")),
    testFileHashes: {
      ...hashes(path.join(root, "tests"), root, (f) => f.endsWith(".cjs")),
      ...hashes(path.join(root, "scripts"), root, (f) => f.endsWith(".cjs")),
      ...hashes(path.join(root, "cases"), root, (f) => f.endsWith(".json")),
    },
    subjectSourceHashes: Object.assign(
      {},
      ...[
        "apps/api/src",
        "apps/web/src",
        "packages/shared/src",
        "apps/api/migrations",
      ].map((dir) => hashes(path.join(subject, dir), subject)),
    ),
    subjectBuildHashes: hashes(
      path.join(subject, "apps/api/dist"),
      subject,
      (f) => f.endsWith(".js"),
    ),
    scope:
      "Entire application contract v1.1: auth, planning, trips, visits, footprints, journals, media, security, database, UI, real E2E and external providers",
  };
  const save = () =>
    fs.writeFileSync(
      path.join(report, "execution.json"),
      JSON.stringify(metadata, null, 2) + "\n",
    );
  save();
  const output = fs.createWriteStream(path.join(report, "console.txt"), {
    flags: "wx",
  });
  const child = spawn(process.execPath, args, {
    cwd: root,
    windowsHide: true,
    env: { ...env, TPA_TDD_REPORT_DIR: report },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      const safe = redact(chunk, env);
      output.write(safe);
      process.stdout.write(safe);
    });
  }
  let code;
  try {
    [code] = await once(child, "close");
  } catch {
    code = 2;
  }
  const finished = once(output, "finish");
  output.end();
  await finished;
  const resultPath = path.join(report, "app-results.json");
  const result = fs.existsSync(resultPath)
    ? JSON.parse(fs.readFileSync(resultPath, "utf8"))
    : null;
  metadata.finishedAt = new Date().toISOString();
  metadata.childExitCode = code;
  metadata.outcome = result?.classification || "no-complete-results";
  metadata.expectedT0ZeroConfirmed = Boolean(
    phase === "T0" && result?.validMeasurement && result.passed === 0,
  );
  save();
  const rows =
    result?.cases
      .map(
        (c) =>
          `| ${c.id} | ${c.title} | ${c.status} | ${(c.reason || "").replaceAll("|", "\\|").replaceAll("\n", " ")} |`,
      )
      .join("\n") || "";
  fs.writeFileSync(
    path.join(report, "阶段结果.md"),
    `# 全软件 TDD ${phase} 实测结果\n\n版本：${revision}；工作区有未提交修改：${dirty}。\n\n用例集：${manifest.version}；总数：${manifest.total}。\n\n通过 ${result?.passed ?? "未知"}；失败 ${result?.failed ?? "未知"}；阻塞 ${result?.blocked ?? "未知"}；未执行 ${result?.notRun ?? "未知"}。\n\n通过率：${result?.observedPassRatePercent ?? "未知"}%；有效业务测量：${result?.validMeasurement ?? false}。\n\n结论：${metadata.outcome}。0% 和 100% 均须以真实完整执行为依据。\n\n| ID | 用例 | 状态 | 原因 |\n| --- | --- | --- | --- |\n${rows}\n`,
  );
  console.log("报告：" + report);
  process.exitCode =
    !result || !result.validMeasurement ? 2 : code || (result.failed ? 1 : 0);
  if (phase === "T0" && result?.validMeasurement && result.passed > 0) {
    console.error("T0 已有实际通过项，请核对起始版本；结果不会被改为0%。");
    process.exitCode = 3;
  }
}
main().catch((error) => {
  console.error(
    "全软件测试环境/工具错误：" + redact(error.message, process.env),
  );
  process.exitCode = 2;
});
