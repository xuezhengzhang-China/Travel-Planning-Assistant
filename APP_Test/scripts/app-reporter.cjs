const fs = require("node:fs");
const path = require("node:path");
const manifest = require("../cases/app-core.v1.json");
function redact(value) {
  let text = String(value || "");
  for (const [key, secret] of Object.entries(process.env))
    if (
      /(?:KEY|SECRET|PASSWORD|DATABASE_URL|TOKEN)$/.test(key) &&
      secret &&
      secret.length >= 6
    )
      text = text.split(secret).join("[REDACTED]");
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://[REDACTED]");
}
module.exports = async function* reporter(events) {
  const rows = new Map(),
    errors = [],
    ids = new Set(manifest.cases.map((c) => c.id));
  for await (const event of events) {
    if (!["test:pass", "test:fail"].includes(event.type)) continue;
    const d = event.data,
      id = d.name.split(" ")[0];
    if (!ids.has(id)) {
      if (event.type === "test:fail")
        errors.push({
          name: redact(d.name),
          reason: redact(d.details?.error?.message),
        });
      continue;
    }
    const status =
      d.skip || d.todo
        ? "blocked"
        : event.type === "test:pass"
          ? "passed"
          : "failed";
    if (rows.has(id)) errors.push({ name: id, reason: "duplicate-result" });
    const row = {
      id,
      status,
      elapsedMs: d.details?.duration_ms,
      reason: redact(d.skip || d.todo || d.details?.error?.message) || null,
    };
    rows.set(id, row);
    yield `${status.toUpperCase()} ${d.name}${row.reason ? " — " + row.reason : ""}\n`;
  }
  const cases = manifest.cases.map((c) => ({
    ...c,
    ...(rows.get(c.id) || { status: "not-run", reason: "未收到结果" }),
  }));
  const count = (status) => cases.filter((c) => c.status === status).length;
  const passed = count("passed"),
    failed = count("failed"),
    blocked = count("blocked"),
    notRun = count("not-run");
  const validMeasurement = errors.length === 0 && blocked === 0 && notRun === 0;
  const result = {
    suiteVersion: manifest.version,
    total: manifest.total,
    passed,
    failed,
    blocked,
    notRun,
    harnessErrors: errors,
    validMeasurement,
    observedPassRatePercent: Number(
      ((passed / manifest.total) * 100).toFixed(2),
    ),
    passedFractionOfFrozenSet: `${passed}/${manifest.total}`,
    classification: !validMeasurement
      ? "incomplete-or-environment-blocked"
      : passed === 0
        ? "red-baseline"
        : passed === manifest.total
          ? "all-application-cases-passed"
          : "partial-business-progress",
    cases,
  };
  if (process.env.TPA_TDD_REPORT_DIR)
    fs.writeFileSync(
      path.join(process.env.TPA_TDD_REPORT_DIR, "app-results.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
  yield JSON.stringify({
    total: manifest.total,
    passed,
    failed,
    blocked,
    notRun,
    validMeasurement,
  }) + "\n";
};
