import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
function storageModule(seed) {
  const values = new Map(Object.entries(seed));
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const mod = { exports: {} };
    cache.set(path, mod);
    const source = readFileSync(path, 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'module', 'exports', 'localStorage', compiled)(
      (specifier) =>
        specifier.startsWith('.')
          ? load(resolve(dirname(path), `${specifier}.ts`))
          : createRequire(import.meta.url)(specifier),
      mod,
      mod.exports,
      storage,
    );
    return mod.exports;
  }
  return load(fileURLToPath(new URL('../src/data/planner-storage.ts', import.meta.url)));
}
test('旧长城偏好迁移为历史文化并去重，不影响艺术和在地主题', () => {
  const module = storageModule({});
  assert.deepEqual(module.normalizeThemes(['长城古迹', '历史文化', '艺术设计', '老街与在地体验']), [
    '历史文化',
    '艺术设计',
    '老街与在地体验',
  ]);
  assert.deepEqual(module.normalizeThemes(null), []);
});
test('刷新恢复草稿时执行主题迁移，并保留日期与景点顺序', () => {
  const id = '11000000-0000-4000-8001-000000000005';
  const module = storageModule({
    'travel-planner:beijing-planner:v2': JSON.stringify({
      draft: {
        cityId: '11000000-0000-4000-8000-000000000001',
        startDate: '2026-11-10',
        endDate: '2026-11-12',
        themes: ['长城古迹', '历史文化'],
        pace: 'standard',
        transport: 'transit',
        selectedPlaceIds: [id],
      },
      trip: null,
    }),
  });
  const state = module.loadPlanner();
  assert.deepEqual(state.draft.themes, ['历史文化']);
  assert.deepEqual(state.draft.selectedPlaceIds, [id]);
  assert.equal(state.draft.startDate, '2026-11-10');
  assert.equal(module.savePlanner(state), true);
  assert.deepEqual(module.loadPlanner(), state);
});
