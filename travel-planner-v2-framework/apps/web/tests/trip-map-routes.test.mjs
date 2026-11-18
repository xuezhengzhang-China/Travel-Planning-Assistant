import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/features/trip-create/trip-map-routes.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', compiled)(mod, mod.exports);
const {
  buildDays,
  canCompareRoutes,
  formatRouteSummary,
  navigationUrl,
  savedOrder,
  summarizeRoutes,
  transitSummary,
} = mod.exports;

test('调序只变更相关的有向路段，单景点日期保持独立', () => {
  const trip = {
    planningInput: { transportMode: 'walking' },
    days: [
      {
        date: '2026-11-20',
        items: ['a', 'b', 'c', 'd'].map((placeId, position) => ({ placeId, position })),
      },
      { date: '2026-11-21', items: [{ placeId: 'e', position: 0 }] },
    ],
  };
  const places = 'abcde'.split('').map((id) => ({ id }));
  const original = buildDays(trip, places, savedOrder(trip));
  const revised = buildDays(trip, places, [
    { date: '2026-11-20', placeIds: ['a', 'b', 'd', 'c'] },
    { date: '2026-11-21', placeIds: ['e'] },
  ]);
  assert.equal(original[0].legs[0].key, revised[0].legs[0].key);
  assert.notEqual(original[0].legs[1].key, revised[0].legs[1].key);
  assert.notEqual(original[0].legs[2].key, revised[0].legs[2].key);
  assert.equal(revised[1].legs.length, 0);
  assert.equal(revised[1].stops[0].number, 5);
});

test('调序耗时仅比较完整的高德结果，缺失路段不计为零', () => {
  const legs = [{ key: 'a' }, { key: 'b' }];
  const routes = new Map([['a', { source: 'provider', durationMinutes: 12 }]]);
  const pending = summarizeRoutes(legs, routes);
  assert.equal(pending.pending, 1);
  assert.match(formatRouteSummary(pending, 'walking'), /1 段已查，约 12 分钟/);
  assert.equal(canCompareRoutes(pending), false);
  routes.set('b', { source: 'estimate', durationMinutes: 8 });
  const estimated = summarizeRoutes(legs, routes);
  assert.match(formatRouteSummary(estimated, 'walking'), /20 分钟（含估算）/);
  assert.equal(canCompareRoutes(estimated), false);
  routes.set('b', { source: 'provider', durationMinutes: 9 });
  assert.equal(canCompareRoutes(summarizeRoutes(legs, routes)), true);
});

test('高德导航编码景点名并携带对应出行方式', () => {
  const url = new URL(
    navigationUrl(
      { name: '西湖·花港观鱼', coordinates: { longitude: 120.1, latitude: 30.2 } },
      'transit',
    ),
  );
  assert.equal(url.origin, 'https://uri.amap.com');
  assert.equal(url.searchParams.get('to'), '120.1,30.2,西湖·花港观鱼');
  assert.equal(url.searchParams.get('mode'), 'bus');
  assert.equal(navigationUrl({ name: '未知坐标' }, 'walking'), null);
});

test('路段跳转高德带上明确的起终点，公交摘要包含所选换乘线路', () => {
  const origin = { name: '天坛·东门', coordinates: { longitude: 116.42, latitude: 39.88 } };
  const target = { name: '地坛公园', coordinates: { longitude: 116.41, latitude: 39.95 } };
  const link = new URL(navigationUrl(target, 'transit', origin));
  assert.equal(link.searchParams.get('from'), '116.42,39.88,天坛·东门');
  assert.equal(link.searchParams.get('to'), '116.41,39.95,地坛公园');
  assert.equal(link.searchParams.get('mode'), 'bus');
  assert.equal(navigationUrl(target, 'transit', { name: '起点没有坐标' }), null);
  assert.equal(
    transitSummary({
      transitSteps: [
        { mode: 'walking', name: '步行' },
        { mode: 'bus', name: '地铁5号线' },
        { mode: 'bus', name: '公交示例线路' },
      ],
    }),
    '地铁5号线 → 公交示例线路',
  );
  assert.equal(transitSummary('unavailable'), '');
  assert.equal(transitSummary({ durationMinutes: 10 }), '');
});
