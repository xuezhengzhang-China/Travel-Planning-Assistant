import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const source = readFileSync(
  fileURLToPath(new URL('../src/features/footprints/atlas-geo.ts', import.meta.url)),
  'utf8',
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const loaded = { exports: {} };
new Function('module', 'exports', outputText)(loaded, loaded.exports);
const {
  projectCoordinate,
  pointInRing,
  featureContains,
  featureAt,
  countByFeature,
  buildProjection,
  atlasShade,
  ATLAS_SHADES,
  ATLAS_PAD_X,
  ATLAS_PAD_Y,
  ATLAS_WIDTH,
  ATLAS_HEIGHT,
} = loaded.exports;

/** 0..10 的正方形（外环按顺时针闭合）。 */
const square = (x, y, size) => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
];

const featureA = {
  properties: { adcode: '110000', name: '甲方' },
  geometry: {
    type: 'Polygon',
    // 外环 0..10，中间挖掉 4..6 的洞
    coordinates: [square(0, 0, 10), square(4, 4, 2)],
  },
};
const featureB = {
  properties: { adcode: '330000', name: '乙方' },
  geometry: { type: 'Polygon', coordinates: [square(20, 0, 10)] },
};

test('墨卡托投影：原点为 0，北纬得到负 y（SVG 向下为正）', () => {
  const origin = projectCoordinate([0, 0]);
  assert.equal(origin[0], 0);
  // tan(π/4) 在浮点下不精确等于 1，原点会得到一个 ~1e-15 的极小值。
  assert.ok(Math.abs(origin[1]) < 1e-9, `原点 y 应接近 0，实际 ${origin[1]}`);
  const northern = projectCoordinate([120, 30]);
  assert.equal(northern[0], 120);
  assert.ok(northern[1] < 0, '北纬应得到负 y');
  // 纬度越高，y 越负
  assert.ok(projectCoordinate([0, 40])[1] < projectCoordinate([0, 30])[1]);
});

test('射线法判断点在环内', () => {
  const ring = square(0, 0, 10);
  assert.equal(pointInRing(5, 5, ring), true);
  assert.equal(pointInRing(0.5, 0.5, ring), true);
  assert.equal(pointInRing(15, 5, ring), false);
  assert.equal(pointInRing(5, 15, ring), false);
  assert.equal(pointInRing(-1, 5, ring), false);
});

test('带洞的多边形：洞内不算命中', () => {
  assert.equal(featureContains(featureA, 3, 3), true);
  assert.equal(featureContains(featureA, 5, 5), false, '洞内应判为不在范围内');
  assert.equal(featureContains(featureA, 12, 5), false);
});

test('featureAt 命中正确要素，落在所有要素外返回 null', () => {
  const features = [featureA, featureB];
  assert.equal(featureAt(features, 3, 3).properties.adcode, '110000');
  assert.equal(featureAt(features, 25, 5).properties.adcode, '330000');
  assert.equal(featureAt(features, 5, 5), null, '洞内不归属任何要素');
  assert.equal(featureAt(features, 50, 50), null);
});

test('countByFeature 按要素聚合，越界点被跳过', () => {
  const features = [featureA, featureB];
  const counts = countByFeature(features, [
    { longitude: 3, latitude: 3 },
    { longitude: 7, latitude: 3 },
    { longitude: 25, latitude: 5 },
    { longitude: 50, latitude: 50 },
  ]);
  assert.equal(counts.get('110000'), 2);
  assert.equal(counts.get('330000'), 1);
  assert.equal(counts.size, 2);
});

test('投影把包围盒等比映射进绘图区并保持相对位置', () => {
  const features = [featureA, featureB];
  const { position, path } = buildProjection(features);

  const left = position([0, 0]);
  const right = position([30, 0]);
  const top = position([0, 10]);
  assert.equal(left[0], ATLAS_PAD_X);
  assert.ok(Math.abs(right[0] - (ATLAS_PAD_X + ATLAS_WIDTH)) < 1e-6);
  // 纬度 10 在 bbox 顶部，对应绘图区上边缘；纬度 0 在底部。
  assert.ok(Math.abs(top[1] - ATLAS_PAD_Y) < 1e-6);
  assert.ok(left[1] >= ATLAS_PAD_Y && left[1] <= ATLAS_PAD_Y + ATLAS_HEIGHT);
  assert.ok(top[1] < left[1], '高纬度应画在上方');

  const drawn = path(featureA);
  assert.ok(drawn.startsWith('M'), '路径应以 M 开头');
  assert.ok(drawn.includes('Z'), '路径应闭合');
  // 两个环（外环 + 洞）应产生两段闭合路径
  assert.equal((drawn.match(/Z/g) ?? []).length, 2);
});

test('没有要素时投影退化为恒等映射，不产生 NaN', () => {
  const { position, path } = buildProjection([]);
  assert.deepEqual(position([120, 30]), [ATLAS_PAD_X, ATLAS_PAD_Y]);
  assert.equal(path(featureA), '');
});

test('色阶按 0 / 1–2 / 3–5 / 6–9 / 10+ 分五档', () => {
  assert.equal(ATLAS_SHADES.length, 5);
  assert.equal(atlasShade(0), ATLAS_SHADES[0]);
  assert.equal(atlasShade(1), ATLAS_SHADES[1]);
  assert.equal(atlasShade(2), ATLAS_SHADES[1]);
  assert.equal(atlasShade(3), ATLAS_SHADES[2]);
  assert.equal(atlasShade(5), ATLAS_SHADES[2]);
  assert.equal(atlasShade(6), ATLAS_SHADES[3]);
  assert.equal(atlasShade(9), ATLAS_SHADES[3]);
  assert.equal(atlasShade(10), ATLAS_SHADES[4]);
  assert.equal(atlasShade(99), ATLAS_SHADES[4]);
});
