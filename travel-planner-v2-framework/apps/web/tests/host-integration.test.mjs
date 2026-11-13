import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(
  new URL('../src/features/trip-create/host-integration.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
const errors = [];
new Function('module', 'exports', 'console', compiled)(mod, mod.exports, {
  error: (message) => errors.push(message),
});
const { tripEntryPath, tripEntryFromPath, tripEntryKey, notifyHost } = mod.exports;
test('宿主入口与URL可往返，非法地址不会打开任意资源', () => {
  for (const entry of [
    { view: 'list' },
    { view: 'new' },
    { view: 'edit', tripId: '11000000-0000-4000-8002-000000000001' },
  ]) {
    assert.deepEqual(tripEntryFromPath(tripEntryPath(entry)), entry);
    assert.ok(tripEntryKey(entry));
  }
  assert.deepEqual(tripEntryFromPath('/trips/fake/edit'), { view: 'list' });
  assert.deepEqual(tripEntryFromPath('/unrelated'), { view: 'list' });
});
test('保存通知返回原服务器资源，宿主通知失败不把已完成保存变成失败', async () => {
  const trip = { id: 'server-id', revision: 8, status: 'planned', days: [] };
  let received;
  notifyHost((value) => {
    received = value;
  }, trip);
  assert.equal(received, trip);
  assert.doesNotThrow(() =>
    notifyHost(() => {
      throw new Error('host failure');
    }, trip),
  );
  notifyHost(async () => {
    throw new Error('async host failure');
  }, trip);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(errors.length, 2);
  assert.ok(errors.every((message) => !message.includes('host failure')));
});
