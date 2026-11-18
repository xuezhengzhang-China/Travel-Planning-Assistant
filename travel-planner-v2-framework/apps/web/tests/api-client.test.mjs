import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';

const external = createRequire(import.meta.url);
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path).exports;
  const m = { exports: {} };
  cache.set(path, m);
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', compiled)(
    (specifier) =>
      specifier.startsWith('.')
        ? load(resolve(dirname(path), specifier + '.ts'))
        : external(specifier),
    m,
    m.exports,
  );
  return m.exports;
}

const { createApiClient, ApiError, NETWORK_ERROR_STATUS } = load(
  fileURLToPath(new URL('../src/lib/api-client.ts', import.meta.url)),
);
const { createProfileApi, normalizeDisplayName, profileErrorMessage, MAX_DISPLAY_NAME } = load(
  fileURLToPath(new URL('../src/lib/profile-client.ts', import.meta.url)),
);

const jsonResponse = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
  blob: async () => new Blob([]),
});
const htmlResponse = (status) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    throw new SyntaxError('Unexpected token <');
  },
  blob: async () => new Blob(['<html></html>'], { type: 'text/html' }),
});
const blobResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => ({}),
  blob: async () => body,
});

function recordingFetcher(respond) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return respond(calls.length, url, init);
  };
  return { calls, fetcher };
}

test('token 自动注入 Authorization，路径按 baseUrl 拼接', async () => {
  const { calls, fetcher } = recordingFetcher(() => jsonResponse(200, { id: 'u1' }));
  const client = createApiClient({ getAccessToken: () => 'tok-123', fetcher });
  assert.deepEqual(await client.request('/users/me'), { id: 'u1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/users/me');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok-123');
});

test('没有 token 时不发请求，直接抛 UNAUTHENTICATED', async () => {
  const { calls, fetcher } = recordingFetcher(() => jsonResponse(200, {}));
  const client = createApiClient({ getAccessToken: () => null, fetcher });
  await assert.rejects(
    () => client.request('/users/me'),
    (error) =>
      error instanceof ApiError && error.status === 401 && error.code === 'UNAUTHENTICATED',
  );
  assert.equal(calls.length, 0);
});

test('公开接口传 auth:false 时不带 Authorization 也能请求', async () => {
  const { calls, fetcher } = recordingFetcher(() => jsonResponse(200, { status: 'ok' }));
  const client = createApiClient({ getAccessToken: () => null, fetcher });
  assert.deepEqual(await client.request('/health', { auth: false }), { status: 'ok' });
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test('204 返回 undefined 且不解析 JSON', async () => {
  const { fetcher } = recordingFetcher(() => ({
    ok: true,
    status: 204,
    json: async () => {
      throw new Error('不应该解析 204');
    },
  }));
  const client = createApiClient({ getAccessToken: () => 't', fetcher });
  assert.equal(await client.request('/media/x', { method: 'DELETE' }), undefined);
});

test('后端错误码与 details 原样透传', async () => {
  const { fetcher } = recordingFetcher(() =>
    jsonResponse(409, { code: 'MEDIA_IN_USE', message: '图片仍被引用', details: { id: 'm1' } }),
  );
  const client = createApiClient({ getAccessToken: () => 't', fetcher });
  await assert.rejects(
    () => client.request('/media/m1', { method: 'DELETE' }),
    (error) =>
      error.status === 409 &&
      error.code === 'MEDIA_IN_USE' &&
      error.message === '图片仍被引用' &&
      error.details.id === 'm1',
  );
});

test('非 JSON 错误体（例如 SPA 兜底返回 HTML）退回 HTTP_ERROR', async () => {
  const { fetcher } = recordingFetcher(() => htmlResponse(503));
  const client = createApiClient({ getAccessToken: () => 't', fetcher });
  await assert.rejects(
    () => client.request('/places'),
    (error) => error.status === 503 && error.code === 'HTTP_ERROR' && /503/.test(error.message),
  );
});

test('网络异常包成 NETWORK_ERROR，主动取消则原样抛出', async () => {
  const failing = createApiClient({
    getAccessToken: () => 't',
    fetcher: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  await assert.rejects(
    () => failing.request('/trips'),
    (error) =>
      error instanceof ApiError &&
      error.status === NETWORK_ERROR_STATUS &&
      error.code === 'NETWORK_ERROR',
  );

  const abort = new Error('aborted');
  abort.name = 'AbortError';
  const aborted = createApiClient({
    getAccessToken: () => 't',
    fetcher: async () => {
      throw abort;
    },
  });
  await assert.rejects(
    () => aborted.request('/trips'),
    (error) => error === abort && !(error instanceof ApiError),
  );
});

test('JSON 请求体自动带 Content-Type 并默认 POST；FormData 不手写 Content-Type', async () => {
  const { calls, fetcher } = recordingFetcher(() => jsonResponse(200, {}));
  const client = createApiClient({ getAccessToken: () => 't', fetcher, baseUrl: '/api/' });

  await client.request('/users/me', { method: 'PATCH', body: { displayName: '小张' } });
  assert.equal(calls[0].url, '/api/users/me');
  assert.equal(calls[0].init.method, 'PATCH');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].init.body, JSON.stringify({ displayName: '小张' }));

  const form = new FormData();
  form.append('file', new Blob(['x'], { type: 'image/png' }), 'a.png');
  await client.request('/media', { body: form });
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.headers['Content-Type'], undefined);
  assert.equal(calls[1].init.body, form);
});

test('blob 走认证并返回二进制；失败时抛 ApiError', async () => {
  const payload = new Blob(['png-bytes'], { type: 'image/png' });
  const { calls, fetcher } = recordingFetcher((index) =>
    index === 1 ? blobResponse(200, payload) : blobResponse(404, new Blob([])),
  );
  const client = createApiClient({ getAccessToken: () => 'tok', fetcher });

  const blob = await client.blob('/media/m1');
  assert.equal(blob.type, 'image/png');
  assert.equal(await blob.text(), 'png-bytes');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');

  await assert.rejects(
    () => client.blob('/media/m2'),
    (error) => error instanceof ApiError && error.status === 404,
  );
});

test('个人资料：读取与改名走统一客户端', async () => {
  const { calls, fetcher } = recordingFetcher((index) =>
    jsonResponse(
      200,
      index === 1
        ? { id: 'u1', email: 'a@b.c', displayName: '老名字' }
        : { id: 'u1', email: 'a@b.c', displayName: '新名字' },
    ),
  );
  const client = createApiClient({ getAccessToken: () => 'tok', fetcher });
  const api = createProfileApi(client);

  assert.equal((await api.getMe()).displayName, '老名字');
  assert.equal(calls[0].url, '/api/users/me');
  assert.equal(calls[0].init.method ?? 'GET', 'GET');

  const renamed = await api.rename('  新名字  ');
  assert.equal(renamed.displayName, '新名字');
  assert.equal(calls[1].url, '/api/users/me');
  assert.equal(calls[1].init.method, 'PATCH');
  assert.equal(JSON.parse(calls[1].init.body).displayName, '新名字');
});

test('昵称本地校验：去空格、拒绝空值、限制长度，且不发请求', async () => {
  assert.equal(normalizeDisplayName('  小张  '), '小张');
  assert.equal(normalizeDisplayName('x'.repeat(MAX_DISPLAY_NAME)).length, MAX_DISPLAY_NAME);
  assert.throws(
    () => normalizeDisplayName('   '),
    (error) => error.code === 'VALIDATION_ERROR',
  );
  assert.throws(
    () => normalizeDisplayName('x'.repeat(MAX_DISPLAY_NAME + 1)),
    (error) => error.code === 'VALIDATION_ERROR',
  );

  const { calls, fetcher } = recordingFetcher(() => jsonResponse(200, {}));
  const api = createProfileApi(createApiClient({ getAccessToken: () => 't', fetcher }));
  await assert.rejects(
    () => api.rename('   '),
    (error) => error.code === 'VALIDATION_ERROR',
  );
  assert.equal(calls.length, 0);
});

test('错误提示按错误码分支，而不是一律显示原文', () => {
  assert.match(profileErrorMessage(new ApiError(401, 'UNAUTHENTICATED', '原始信息')), /重新登录/);
  assert.match(profileErrorMessage(new ApiError(0, 'NETWORK_ERROR', '无法连接服务器')), /无法连接/);
  assert.match(
    profileErrorMessage(new ApiError(400, 'VALIDATION_ERROR', '昵称不能为空')),
    /昵称不能为空/,
  );
  assert.match(profileErrorMessage(new TypeError('failed')), /无法连接服务器/);
  assert.match(profileErrorMessage(new Error('其它')), /其它/);
});
