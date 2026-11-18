import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createRequire } from 'node:module';

const source = await readFile(new URL('../src/data/planner.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', outputText)(
  createRequire(import.meta.url),
  loaded,
  loaded.exports,
);
const { dateRange, dateError, movePlace, reorderPlace } = loaded.exports;

test('日期包含首尾，正确跨月和跨年', () => {
  assert.deepEqual(dateRange('2026-12-31', '2027-01-02'), [
    '2026-12-31',
    '2027-01-01',
    '2027-01-02',
  ]);
  assert.equal(dateRange('2028-02-28', '2028-03-01').length, 3);
  assert.equal(dateRange('2026-11-10', '2026-11-10').length, 1);
});
test('拒绝无效日期、逆序和超过 30 天的范围', () => {
  for (const [start, end] of [
    ['2026-02-29', '2026-03-01'],
    ['', '2026-01-01'],
    ['2026-01-02', '2026-01-01'],
    ['2026-01-01', '2026-01-31'],
  ]) {
    assert.equal(dateRange(start, end).length, 0);
    assert.ok(dateError(start, end));
  }
  assert.equal(dateRange('2026-01-01', '2026-01-30').length, 30);
  assert.equal(dateError('2026-01-01', '2026-01-30'), '');
});
test('跨日期移动不丢失或重复景点，不改变原始数据', () => {
  const days = [
    { date: '2026-11-01', placeIds: ['a', 'b'] },
    { date: '2026-11-02', placeIds: ['c'] },
  ];
  const result = movePlace(days, 'a', '2026-11-02');
  assert.deepEqual(
    result.map((day) => day.placeIds),
    [['b'], ['c', 'a']],
  );
  assert.deepEqual(days[0].placeIds, ['a', 'b']);
  assert.deepEqual(movePlace(days, 'a', 'invalid'), days);
});
test('排序上下边界保持不变，交换只影响当日顺序', () => {
  const days = [
    { date: '2026-11-01', placeIds: ['a', 'b'] },
    { date: '2026-11-02', placeIds: ['c', 'd'] },
  ];
  assert.deepEqual(reorderPlace(days, 'a', -1), days);
  assert.deepEqual(reorderPlace(days, 'd', 1), days);
  assert.deepEqual(
    reorderPlace(days, 'b', -1).map((day) => day.placeIds),
    [
      ['b', 'a'],
      ['c', 'd'],
    ],
  );
});
