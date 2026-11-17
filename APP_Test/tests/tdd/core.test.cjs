// Register the frozen suite. Importing case definitions does not invoke business code.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const manifest = require("../../cases/tdd-core.v1.json");
const modules = [
  "validation",
  "catalog",
  "planner",
  "proposals",
  "geo",
  "model",
  "http",
];
const definitions = new Map();
for (const name of modules) {
  for (const [id, [title, run]] of Object.entries(
    require(`./${name}.cases.cjs`),
  )) {
    assert.ok(!definitions.has(id), "重复用例ID: " + id);
    assert.equal(typeof run, "function", id);
    definitions.set(id, { title, run, file: name + ".cases.cjs" });
  }
}
assert.equal(definitions.size, manifest.total, "用例集数量变化必须更新版本");
assert.deepEqual(
  [...definitions.keys()].sort(),
  manifest.cases.map((c) => c.id).sort(),
);
for (const entry of manifest.cases) {
  const definition = definitions.get(entry.id);
  assert.equal(
    definition.title,
    entry.title,
    entry.id + "的清单和测试名称不一致",
  );
  assert.equal(path.basename(entry.file), definition.file, entry.id);
  test(
    `${entry.id} ${entry.title}`,
    { concurrency: false, timeout: 30000 },
    async (t) => {
      try {
        await definition.run(t);
      } catch (error) {
        if (error.code === "TDD_ENVIRONMENT") {
          t.skip("BLOCKED: " + error.message);
          return;
        }
        throw error;
      }
    },
  );
}
