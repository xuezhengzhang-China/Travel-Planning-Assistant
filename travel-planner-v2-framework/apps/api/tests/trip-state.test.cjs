const test = require('node:test');
const assert = require('node:assert/strict');
const { merge, normalize } = require('../dist/trips/trip-state.service.js');

const PLACE = '30000000-0000-4000-8000-000000000001';
const KEY = `2026-11-18:${PLACE}`;

test('state defaults to empty shape and drops unknown fields', () => {
  assert.deepEqual(normalize(null), {
    visited: [],
    footprints: {},
    bookings: {},
    stay: { name: '', address: '' },
    packing: [],
    reminders: {},
  });
  const state = normalize({
    visited: [KEY, 'not-a-key', 42],
    bookings: { [PLACE]: 'booked', other: 'nonsense' },
    stay: { name: 'A', address: 'B', extra: 'ignored' },
    packing: [{ id: 'p1', label: '充电器', packed: true }, { id: 'p2' }],
    reminders: { enabled: true },
    unknown: 'ignored',
  });
  assert.deepEqual(state.visited, [KEY]);
  assert.deepEqual(state.bookings, { [PLACE]: 'booked' });
  assert.deepEqual(state.stay, { name: 'A', address: 'B' });
  assert.deepEqual(state.packing, [{ id: 'p1', label: '充电器', packed: true }]);
  assert.deepEqual(state.reminders, { enabled: true });
});

test('partial merge keeps sections that were not sent', () => {
  const current = normalize({
    visited: [KEY],
    bookings: { [PLACE]: 'pending' },
    stay: { name: '旧酒店', address: '旧地址' },
  });
  const next = merge(current, { bookings: { [PLACE]: 'booked' } });
  assert.deepEqual(next.visited, [KEY]);
  assert.deepEqual(next.stay, { name: '旧酒店', address: '旧地址' });
  assert.equal(next.bookings[PLACE], 'booked');
});

test('invalid input is rejected with a specific Chinese message', () => {
  assert.throws(() => merge(normalize(null), { visited: ['nope'] }), /日期:景点ID/);
  assert.throws(() => merge(normalize(null), { bookings: { [PLACE]: 'maybe' } }), /pending/);
  assert.throws(() => merge(normalize(null), { packing: 'nope' }), /packing 必须是数组/);
  assert.throws(() => merge(normalize(null), { stay: { name: 'x'.repeat(121) } }), /最多 120 字/);
});
