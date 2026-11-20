const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const manifest = require("../../cases/app-core.v1.json");
const root = path.resolve(__dirname, "../.."),
  definitions = new Map();
for (const entry of manifest.cases) {
  if (definitions.has(entry.id))
    throw new Error("Duplicate manifest ID: " + entry.id);
  const file = path.resolve(root, entry.file);
  assert.ok(file.startsWith(root + path.sep));
  const definition = require(file)[entry.id];
  assert.ok(definition, "Missing test definition: " + entry.id);
  assert.equal(definition[0], entry.title);
  assert.equal(typeof definition[1], "function");
  definitions.set(entry.id, definition[1]);
}
assert.equal(definitions.size, manifest.total);
const files = [...new Set(manifest.cases.map((c) => c.file))];
const declared = files.flatMap((file) =>
  Object.keys(require(path.join(root, file))),
);
assert.deepEqual(
  [...declared].sort(),
  [...definitions.keys()].sort(),
  "Unregistered definitions must not disappear from the denominator",
);
for (const entry of manifest.cases) {
  test(
    `${entry.id} ${entry.title}`,
    { concurrency: false, timeout: entry.timeoutMs || 60000 },
    async (t) => {
      try {
        await definitions.get(entry.id)(t);
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
