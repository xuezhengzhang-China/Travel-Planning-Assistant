import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function importSource(name) {
  const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
}
const { buildDestinationDirectory } = await importSource('destinations');
const { buildReminders, calendarFile, packingSuggestions, readReminderSettings, shanghaiDate, shiftDate } = await importSource('tripReminders');
const trip = { id: 123, destination: '兰州市', startDate: '2026-11-15', endDate: '2026-11-18', transport: ['火车/高铁'], theme: ['城市漫步'], spots: '' };
const settings = { enabled: true, train: true, saleTime: '08:00', departureTime: '09:00', completed: [], packed: [] };

test('national directory covers 34 province-level groups and searchable county-level cities', async () => {
  const data = JSON.parse(await readFile(new URL('../public/data/pca-code.json', import.meta.url), 'utf8'));
  const directory = buildDestinationDirectory(data);
  assert.equal(directory.length, 34);
  assert.ok(directory.flatMap(group => group.cities).length > 350);
  assert.ok(directory.flatMap(group => group.counties).length > 2800);
  const gansu = directory.find(group => group.name === '甘肃省');
  assert.ok(gansu.cities.some(city => city.name === '兰州市' && city.code === '620100'));
  assert.ok(gansu.counties.some(city => city.name === '敦煌市' && city.parentCode === '620900'));
  const beijing = directory.find(group => group.name === '北京市');
  assert.equal(beijing.cities.length, 1);
  assert.equal(beijing.cities[0].code, '110000');
  assert.ok(beijing.counties.some(county => county.name === '朝阳区'));
  assert.ok(directory.find(group => group.name === '台湾省').cities.some(city => city.name === '台北市'));
});

test('rail ticket release reminder subtracts fourteen days, including month and year boundaries', () => {
  const reminders = buildReminders(trip, settings);
  assert.equal(reminders.find(item => item.kind === 'ticket-out').due, '2026-11-01T00:00:00.000Z');
  assert.equal(reminders.find(item => item.kind === 'ticket-back').due, '2026-11-04T00:00:00.000Z');
  assert.equal(shiftDate('2027-01-03', -14), '2026-12-20');
  assert.equal(shiftDate('2028-03-01', -1), '2028-02-29');
});

test('preparation and departure reminders use Beijing time, including departure near midnight', () => {
  const reminders = buildReminders(trip, { ...settings, departureTime: '01:00' });
  assert.equal(reminders.find(item => item.kind === 'packing').due, '2026-11-14T12:00:00.000Z');
  assert.equal(reminders.find(item => item.kind === 'departure').due, '2026-11-14T15:00:00.000Z');
  assert.equal(shanghaiDate(new Date('2026-11-01T17:00:00Z')), '2026-11-02');
});

test('train reminders are opt-in for other transport, and settings can disable all reminders', () => {
  assert.deepEqual(buildReminders(trip, { ...settings, enabled: false }), []);
  assert.equal(buildReminders(trip, { ...settings, train: false }).length, 2);
  globalThis.localStorage = { getItem: () => null };
  assert.equal(readReminderSettings({ ...trip, transport: ['自驾'] }).train, false);
  assert.equal(readReminderSettings(trip).train, true);
  globalThis.localStorage = { getItem: () => JSON.stringify({ saleTime: '99:99', departureTime: '25:01' }) };
  assert.equal(readReminderSettings(trip).saleTime, '08:00');
  assert.equal(readReminderSettings(trip).departureTime, '09:00');
});

test('changing dates generates new reminder keys instead of incorrectly keeping old completion state', () => {
  const first = buildReminders(trip, settings);
  const second = buildReminders({ ...trip, startDate: '2026-11-16' }, settings);
  assert.notEqual(first.find(item => item.kind === 'ticket-out').id, second.find(item => item.kind === 'ticket-out').id);
});

test('packing suggestions use actual forecast thresholds and do not invent missing weather', () => {
  assert.deepEqual(packingSuggestions([], trip).map(item => item.id), ['documents', 'charger']);
  const weather = [{ date: '2026-11-15', low: 8, high: 29, rain: 70, code: 61, wind: 35 }];
  const suggestions = packingSuggestions(weather, { ...trip, theme: ['户外探险'] }).map(item => item.id);
  for (const id of ['layers', 'warm', 'umbrella', 'sun', 'wind', 'mosquito']) assert.ok(suggestions.includes(id));
});

test('calendar export includes real UTC reminder dates, alarms, escaped text and UTF-8 line folding', () => {
  const reminders = buildReminders(trip, settings);
  const file = calendarFile(reminders, new Date('2026-11-01T00:00:00Z'));
  assert.ok(file.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0'));
  assert.equal((file.match(/BEGIN:VEVENT/g) || []).length, 4);
  assert.equal((file.match(/BEGIN:VALARM/g) || []).length, 4);
  assert.ok(file.includes('DTSTART:20261101T000000Z'));
  assert.ok(file.includes('TRIGGER:PT0S'));
  for (const line of file.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  const escaped = calendarFile([{ ...reminders[0], title: '购票,出发;提醒\n下一行' }]).replace(/\r\n /g, '');
  assert.ok(escaped.includes('SUMMARY:购票\\,出发\\;提醒\\n下一行'));
});
