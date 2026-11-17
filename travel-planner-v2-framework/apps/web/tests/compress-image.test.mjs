import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/compress-image.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const loaded = { exports: {} };
new Function('module', 'exports', outputText)(loaded, loaded.exports);
const {
  MAX_IMAGE_BYTES,
  MAX_INPUT_BYTES,
  MAX_EDGE,
  fitWithin,
  validateImageFile,
  ImageCompressError,
} = loaded.exports;

const codeOf = (run) => {
  try {
    run();
  } catch (error) {
    return error.code;
  }
  return null;
};

test('等比缩放到最长边不超过上限，且保持宽高比', () => {
  assert.deepEqual(fitWithin(3200, 2400), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(2400, 3200), { width: 1200, height: 1600 });
  assert.deepEqual(fitWithin(12000, 12000), { width: 1600, height: 1600 });
});

test('本来就小于等于上限时保持原尺寸', () => {
  assert.deepEqual(fitWithin(1600, 900), { width: 1600, height: 900 });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(1, 1), { width: 1, height: 1 });
});

test('极端窄条和超限 1 像素都按最长边收敛', () => {
  assert.deepEqual(fitWithin(3000, 10), { width: 1600, height: 5 });
  assert.deepEqual(fitWithin(1601, 900), { width: 1600, height: 899 });
});

test('非法尺寸退回 1×1，绝不产生 0 或 NaN', () => {
  for (const [width, height] of [
    [0, 0],
    [0, 100],
    [Number.NaN, 100],
    [100, Number.POSITIVE_INFINITY],
    [-100, 100],
  ]) {
    assert.deepEqual(fitWithin(width, height), { width: 1, height: 1 });
  }
  assert.deepEqual(fitWithin(3200, 2400, 0), { width: 1, height: 1 });
});

test('自定义最长边时按传入值缩放', () => {
  assert.deepEqual(fitWithin(3200, 2400, 800), { width: 800, height: 600 });
  assert.equal(MAX_EDGE, 1600);
});

test('空文件和非图片类型被拒绝', () => {
  assert.equal(
    codeOf(() => validateImageFile({ type: 'image/jpeg', size: 0 })),
    'EMPTY',
  );
  assert.equal(
    codeOf(() => validateImageFile({ type: '', size: 0 })),
    'EMPTY',
  );
  // 有内容但没有图片类型：是「不是图片」，不是「空文件」。
  assert.equal(
    codeOf(() => validateImageFile({ type: '', size: 1024 })),
    'NOT_IMAGE',
  );
  assert.equal(
    codeOf(() => validateImageFile({ type: 'application/pdf', size: 1024 })),
    'NOT_IMAGE',
  );
  assert.equal(
    codeOf(() => validateImageFile({ type: 'video/mp4', size: 1024 })),
    'NOT_IMAGE',
  );
});

test('JPEG / PNG / WebP 在默认上限内通过', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
    assert.doesNotThrow(() => validateImageFile({ type, size: 1024 }));
    assert.doesNotThrow(() => validateImageFile({ type, size: MAX_IMAGE_BYTES }));
  }
});

test('超过传入上限 1 字节即拒绝，错误信息可读', () => {
  assert.equal(
    codeOf(() =>
      validateImageFile({ type: 'image/jpeg', size: MAX_IMAGE_BYTES + 1 }, MAX_IMAGE_BYTES),
    ),
    'TOO_LARGE',
  );
  assert.throws(
    () => validateImageFile({ type: 'image/jpeg', size: MAX_INPUT_BYTES + 1 }),
    (error) => error instanceof ImageCompressError && error.code === 'TOO_LARGE',
  );
  // 12 MB 的原图仍在 24 MiB 解码上限内，交给压缩环节处理，不在这里拒收。
  assert.doesNotThrow(() => validateImageFile({ type: 'image/jpeg', size: 12 * 1024 * 1024 }));
  assert.equal(MAX_INPUT_BYTES, 24 * 1024 * 1024);
  assert.equal(MAX_IMAGE_BYTES, 10 * 1024 * 1024);
});

test('错误类型保留 code 与中文消息', () => {
  const error = new ImageCompressError('DECODE_FAILED');
  assert.equal(error.code, 'DECODE_FAILED');
  assert.equal(error.name, 'ImageCompressError');
  assert.ok(error instanceof Error);
  assert.match(error.message, /JPG/);
});
