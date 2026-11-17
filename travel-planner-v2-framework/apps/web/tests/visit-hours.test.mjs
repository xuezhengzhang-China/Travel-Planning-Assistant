import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/features/trip-create/visit-hours.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', compiled)(mod, mod.exports);
const { groupVisitHours, visitConflicts } = mod.exports;
const catalog = JSON.parse(
  await readFile(new URL('../../../packages/shared/data/beijing.json', import.meta.url), 'utf8'),
);

function hoursFor(name) {
  return catalog.places.find((place) => place.name === name).visitInfo.hours;
}

test('天坛大门和园内景点都按出行日期对应的季节显示', () => {
  const hours = hoursFor('天坛公园');
  const [peak, winter, peakInside, winterInside] = hours;
  for (const date of ['2026-11-01', '2027-01-20', '2027-03-31']) {
    assert.deepEqual(groupVisitHours(hours, date), {
      relevant: [winter, winterInside],
      other: [peak, peakInside],
    });
  }
  for (const date of ['2026-10-31', '2027-04-01']) {
    assert.deepEqual(groupVisitHours(hours, date), {
      relevant: [peak, peakInside],
      other: [winter, winterInside],
    });
  }
});

test('中山公园匹配不连续的月段，季节日期未知时保留完整公告', () => {
  const hours = hoursFor('中山公园');
  assert.equal(groupVisitHours(hours, '2027-05-31').relevant[0], hours[0]);
  assert.equal(groupVisitHours(hours, '2027-06-01').relevant[0], hours[1]);
  assert.equal(groupVisitHours(hours, '2027-09-01').relevant[0], hours[0]);
  assert.equal(groupVisitHours(hours, '2027-01-01').relevant[0], hours[2]);

  const ditan = hoursFor('地坛公园');
  assert.deepEqual(groupVisitHours(ditan, '2027-01-01'), { relevant: ditan, other: [] });
});

test('天坛淡季按园内停止入场的分钟提醒，并保留公园大门的独立时段', () => {
  const hours = hoursFor('天坛公园');
  assert.deepEqual(visitConflicts(hours, '2026-11-22', '16:29', 30), []);
  const late = visitConflicts(hours, '2026-11-22', '16:30', 30);
  assert.equal(late.length, 1);
  assert.match(late[0].message, /祈年殿.*16:30 停止入场/);
  assert.deepEqual(visitConflicts(hours, '2026-10-31', '16:30', 30), []);
  assert.match(visitConflicts(hours, '2026-11-22', '21:00', 30)[0].message, /该景点.*21:00/);
});

test('周闭馆与关闭前游览超时分开提醒，季节未确认时没有冲突推断', () => {
  const palace = hoursFor('故宫博物院');
  assert.match(visitConflicts(palace, '2026-11-23', '09:00', 60)[0].message, /周一.*节假日/);
  assert.equal(visitConflicts(palace, '2026-11-22', '14:30', 120).length, 0);
  assert.equal(visitConflicts(palace, '2026-11-22', '14:30', 121)[0].label, '游览可能超时');
  assert.deepEqual(visitConflicts(hoursFor('地坛公园'), '2026-11-22', '20:45', 30), []);
});
