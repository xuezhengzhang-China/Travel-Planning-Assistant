const fs = require("node:fs");
const path = require("node:path");
const manifest = require("../cases/tdd-core.v1.json");
// Only the explicit TDD runner selects this reporter. Nothing here runs on file creation.
module.exports = async function* reporter(events) {
  const rows = new Map();
  const harnessErrors = [];
  for await (const event of events) {
    if (!["test:pass", "test:fail"].includes(event.type)) continue;
    const data = event.data;
    const match = /^([A-Z]\d{2}) /.exec(data.name);
    if (!match) {
      if (event.type === "test:fail")
        harnessErrors.push({
          name: data.name,
          error: data.details?.error?.message || "test harness failure",
        });
      continue;
    }
    const status = data.skip
      ? "blocked"
      : data.todo
        ? "todo"
        : event.type === "test:pass"
          ? "passed"
          : "failed";
    const row = {
      id: match[1],
      title: data.name.slice(4),
      status,
      elapsedMs: data.details?.duration_ms,
      reason: data.skip || data.todo || data.details?.error?.message || null,
    };
    if (rows.has(row.id))
      harnessErrors.push({ name: row.id, error: "duplicate test result" });
    rows.set(row.id, row);
    yield `${status.toUpperCase()} ${data.name}${row.reason ? " — " + row.reason : ""}\n`;
  }
  const cases = manifest.cases.map((entry) => ({
    ...entry,
    ...(rows.get(entry.id) || {
      status: "not-run",
      reason: "未收到该用例执行结果",
    }),
  }));
  const passed = cases.filter((c) => c.status === "passed").length;
  const failed = cases.filter((c) => c.status === "failed").length;
  const blocked = cases.filter((c) =>
    ["blocked", "todo"].includes(c.status),
  ).length;
  const notRun = cases.filter((c) => c.status === "not-run").length;
  const validMeasurement =
    harnessErrors.length === 0 && blocked === 0 && notRun === 0;
  const result = {
    suiteVersion: manifest.version,
    total: manifest.total,
    passed,
    failed,
    blocked,
    notRun,
    harnessErrors,
    passedFractionOfFrozenSet: `${passed}/${manifest.total}`,
    observedPassRatePercent: Number(
      ((passed / manifest.total) * 100).toFixed(2),
    ),
    validMeasurement,
    classification: !validMeasurement
      ? "incomplete-or-environment-blocked"
      : passed === 0
        ? "red-baseline"
        : passed === manifest.total
          ? "all-core-passed"
          : "partial-business-progress",
    cases,
  };
  if (process.env.TPA_TDD_REPORT_DIR)
    fs.writeFileSync(
      path.join(process.env.TPA_TDD_REPORT_DIR, "core-results.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
  yield "TDD " +
    JSON.stringify({
      total: result.total,
      passed,
      failed,
      blocked,
      notRun,
      validMeasurement,
    }) +
    "\n";
};
