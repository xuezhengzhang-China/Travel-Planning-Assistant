import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * CSS 作用域守卫。
 *
 * 背景：`features/shell/shell.css` 是从 V1（liuyan 分支）整份搬来的类规则，
 * 它和当前应用的样式活在同一个文档里。一旦出现同名类，后引入的一方会静默覆盖前者，
 * 而且没有任何构建或类型检查能发现。这里用几条便宜的断言把已经踩过的坑钉住。
 *
 * 为什么先剥离注释：`shell.css` 的文件头注释里就写着 `@import` 和 `.footprint-map`，
 * 不剥离会误报。
 */

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
const shellPath = resolve(srcDir, 'features/shell/shell.css');

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** 去掉声明体，只留选择器部分，避免把属性值里的 `.5em` 之类当成类名。 */
const selectorsOf = (css) => stripComments(css).replace(/\{[^{}]*\}/g, '{}');

/** 收集 CSS 里定义过的类名（去重）。 */
function classNames(css) {
  return [...new Set([...selectorsOf(css).matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]))];
}

function listCss(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) found.push(...listCss(full));
    else if (entry.name.endsWith('.css')) found.push(full);
  }
  return found;
}

test('外壳样式不再定义 footprint-map 前缀类（D 的组件独占该命名空间）', () => {
  const owned = classNames(readFileSync(shellPath, 'utf8')).filter((name) =>
    name.startsWith('footprint-map'),
  );
  assert.deepEqual(owned, [], `shell.css 不应再出现 footprint-map*，实际有：${owned.join(', ')}`);
});

test('footprint-map* 类只由 features/footprints/footprint-map.css 定义', () => {
  const owners = listCss(srcDir)
    .filter((file) =>
      classNames(readFileSync(file, 'utf8')).some((name) => name.startsWith('footprint-map')),
    )
    .map((file) => relative(srcDir, file).replace(/\\/g, '/'));
  assert.deepEqual(owners, ['features/footprints/footprint-map.css']);
});

test('外壳样式不重新引入 @import（避免 Google Fonts 之类的外部依赖）', () => {
  assert.equal(
    /@import/.test(stripComments(readFileSync(shellPath, 'utf8'))),
    false,
    'shell.css 不应包含 @import',
  );
});

test('外壳样式不含 :root / html / body / 通配符这类全局选择器', () => {
  const selectors = selectorsOf(readFileSync(shellPath, 'utf8'));
  // 全局选择器会把登录页（src/style.css 管的那个页面）一起改掉。
  const globalSelector = /(^|[\n,{}])\s*(:root|html|body|\*)\s*(,|\{|$)/;
  assert.equal(globalSelector.test(selectors), false, 'shell.css 不应出现全局选择器');

  // 反过来确认文件本身确实被读到了，避免上面断言因为空串而永远通过。
  assert.ok(classNames(readFileSync(shellPath, 'utf8')).includes('app-shell'));
});
