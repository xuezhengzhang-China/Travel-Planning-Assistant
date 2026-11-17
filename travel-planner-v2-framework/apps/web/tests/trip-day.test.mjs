import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/features/trip-create/trip-day.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', compiled)(mod, mod.exports);
const { buildDayTimeline, destinationDate } = mod.exports;

test('每日时间轴按已排时段拆出游览、交通和缓冲', () => {
  const items = [
    {
      placeId: 'a',
      startTime: '09:00',
      durationMinutes: 60,
      travelMinutesFromPrevious: 0,
      travelTimeSource: 'none',
    },
    {
      placeId: 'b',
      startTime: '10:45',
      durationMinutes: 45,
      travelMinutesFromPrevious: 30,
      travelTimeSource: 'estimate',
    },
  ];
  const timeline = buildDayTimeline(items);
  assert.deepEqual(timeline.totals, { visit: 105, travel: 30, buffer: 15 });
  assert.deepEqual(timeline.segments, [
    { kind: 'visit', start: 540, end: 600, placeId: 'a' },
    { kind: 'travel', start: 600, end: 630, placeId: 'b', estimated: true },
    { kind: 'buffer', start: 630, end: 645, placeId: 'b' },
    { kind: 'visit', start: 645, end: 690, placeId: 'b' },
  ]);
  assert.deepEqual(buildDayTimeline([]).segments, []);
});

test('出游日期按目的地跨过零点并兼容旧目录', () => {
  const utc = new Date('2026-11-22T16:30:00Z');
  assert.equal(destinationDate('Asia/Shanghai', utc), '2026-11-23');
  assert.equal(destinationDate('America/Los_Angeles', utc), '2026-11-22');
  assert.equal(destinationDate(undefined, utc), '2026-11-23');
  assert.equal(destinationDate('invalid', utc), '2026-11-23');
});
