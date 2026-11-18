import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/footprintStore.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { explorationCount, litCityCodes, readFootprints, relatedVisits, saveFootprints } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
const province = { code: '330000', name: '浙江省', level: 'province' };
const city = { code: '330100', name: '杭州市', level: 'city' };
const county = { code: '330106', name: '西湖区', level: 'district' };
const town = { code: '330106001', name: '北山街道', level: 'town' };
const region = (node, path) => ({ id: `region:${node.code}`, name: node.name, kind: 'region', path, createdAt: '2026-01-01' });
const cityMark = region(city, [province, city]);
const countyMark = region(county, [province, city, county]);
const townMark = region(town, [province, city, county, town]);
const spot = { id: 'spot:west-lake', name: '西湖', kind: 'spot', path: [province, city, county], point: [120.149, 30.242], createdAt: '2026-01-01' };
const visit = (id, date, extra = {}) => ({ id, date, place: '杭州 西湖', companions: '', weather: '', thoughts: '回忆', photos: [], ...extra });

test('lighting and unlighting never reads or modifies journal storage', () => {
  const values = new Map([['wander-travel-journals', JSON.stringify([visit('original', '2026-01-01')])]]);
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const events = [];
  globalThis.window = { dispatchEvent: event => events.push(event.type) };
  const before = values.get('wander-travel-journals');
  saveFootprints([cityMark, countyMark]);
  assert.deepEqual(readFootprints(), [cityMark, countyMark]);
  saveFootprints([countyMark]);
  assert.deepEqual(readFootprints(), [countyMark]);
  assert.equal(values.get('wander-travel-journals'), before);
  assert.deepEqual(events, ['footprints-changed', 'footprints-changed']);
});

test('cities are deduplicated across county, township and concrete spot marks', () => {
  assert.deepEqual(litCityCodes([cityMark, countyMark, townMark, spot]), ['330100']);
  assert.deepEqual(litCityCodes([region(province, [province])]), []);
  assert.equal(explorationCount([region(province, [province]), cityMark, countyMark, townMark], province.code), 1);
  assert.equal(explorationCount([cityMark, countyMark, townMark], city.code), 1);
  assert.equal(explorationCount([countyMark, townMark], county.code), 1);
});

test('lighting a parent does not imply that all children have been visited', () => {
  assert.equal(explorationCount([cityMark], county.code), 0);
  assert.equal(explorationCount([countyMark], town.code), 0);
  assert.equal(explorationCount([townMark], province.code), 1);
});

test('waterdrop timeline matches optional links, excludes other links and sorts oldest first for stable numbering', () => {
  const entries = [visit('new', '2026-10-01', { footprintId: spot.id }), visit('other', '2026-11-01', { footprintId: 'spot:elsewhere' }), visit('old', '2025-01-01', { footprintId: spot.id })];
  assert.deepEqual(relatedVisits(spot, entries).map(entry => entry.id), ['old', 'new']);
  assert.deepEqual(relatedVisits(spot, []), []);
});

test('legacy records require city context, avoiding same-name places from another city', () => {
  const entries = [visit('hangzhou', '2026-01-01', { city: city.code }), visit('other-city', '2026-01-01', { city: '350100' }), visit('no-context', '2026-01-01', { place: '西湖' })];
  assert.deepEqual(relatedVisits(spot, entries).map(entry => entry.id), ['hangzhou']);
});

test('township list is available locally and includes real county-linked streets', async () => {
  const towns = JSON.parse(await readFile(new URL('../public/data/streets.json', import.meta.url), 'utf8'));
  assert.ok(towns.length > 30000);
  assert.ok(towns.some(item => item.areaCode === '330106' && item.name === '北山街道'));
  assert.ok(towns.some(item => item.areaCode === '110101' && item.name === '东华门街道'));
});
