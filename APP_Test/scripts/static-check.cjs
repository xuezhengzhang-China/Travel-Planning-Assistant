// This command parses files and compares declarations; it never imports a test or subject module.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
function files(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((d) =>
      d.name === "node_modules" || d.name === "reports"
        ? []
        : d.isDirectory()
          ? files(path.join(dir, d.name))
          : [path.join(dir, d.name)],
    );
}
const all = files(root),
  javascript = all.filter((f) => f.endsWith(".cjs"));
for (const file of javascript) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
}
for (const file of all.filter((f) => f.endsWith(".json")))
  JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "cases/app-core.v1.json"), "utf8"),
);
const ids = manifest.cases.map((c) => c.id);
assert.equal(ids.length, manifest.total);
assert.equal(new Set(ids).size, manifest.total);
assert.equal(manifest.status, "authored-not-executed");
assert.equal(manifest.initialObservedPassRate, null);
const groups = {};
for (const id of ids) {
  const group = id.slice(0, -2);
  groups[group] = (groups[group] || 0) + 1;
}
assert.deepEqual(groups, manifest.groups);
const defined = new Map();
for (const filename of new Set(manifest.cases.map((c) => c.file))) {
  const file = path.resolve(root, filename);
  assert.ok(file.startsWith(root + path.sep));
  const text = fs.readFileSync(file, "utf8");
  const pattern = /^\s{2}([A-Z][A-Z0-9]*\d{2}):\s*\[\s*(["'])(.*?)\2/gms;
  for (const match of text.matchAll(pattern)) {
    assert.ok(!defined.has(match[1]));
    defined.set(match[1], { title: match[3], file: filename });
  }
}
assert.deepEqual([...defined.keys()].sort(), [...ids].sort());
for (const c of manifest.cases) {
  assert.equal(defined.get(c.id).title, c.title);
  assert.equal(defined.get(c.id).file, c.file);
}
for (const file of javascript) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    const target = path.resolve(path.dirname(file), match[1]);
    assert.ok(target.startsWith(root + path.sep));
    assert.ok(fs.existsSync(target), file + ": " + match[1]);
  }
}
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const lock = JSON.parse(
  fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
);
assert.equal(pkg.name, lock.name);
assert.deepEqual(pkg.devDependencies, lock.packages[""].devDependencies);
assert.equal(pkg.scripts.test, "node scripts/app-run.cjs");
console.log(
  JSON.stringify(
    {
      staticSyntaxFiles: javascript.length,
      frozenCases: manifest.total,
      groups,
      relativeImportsValid: true,
      testsExecuted: false,
    },
    null,
    2,
  ),
);
