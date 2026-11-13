require('reflect-metadata');
const test = require('node:test');
const assert = require('node:assert/strict');
const { AuthGuard } = require('../dist/auth/auth.guard.js');
const { ApiError } = require('../dist/common/api-error.js');

const userId = 'b3e1f9a0-5d1c-4c90-9a10-d3b98d4f1234';

function guardWith(verify) {
  return new AuthGuard({ verifyAccessToken: verify });
}

function contextWith(headers) {
  const request = { headers };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
    },
  };
}

test('auth guard rejects missing or malformed authorization headers', async () => {
  const guard = guardWith(async () => userId);
  for (const headers of [{}, { authorization: 'Basic abc' }, { authorization: 'Bearer' }]) {
    const { context } = contextWith(headers);
    await assert.rejects(
      guard.canActivate(context),
      (error) =>
        error instanceof ApiError && error.getStatus() === 401 && error.code === 'UNAUTHENTICATED',
    );
  }
});

test('auth guard rejects tokens the auth service cannot verify', async () => {
  const guard = guardWith(async () => null);
  const { context } = contextWith({ authorization: 'Bearer expired-token' });
  await assert.rejects(
    guard.canActivate(context),
    (error) => error instanceof ApiError && error.getStatus() === 401,
  );
});

test('auth guard exposes the verified user as request.user.userId for D endpoints', async () => {
  const seen = [];
  const guard = guardWith(async (token) => {
    seen.push(token);
    return token === 'valid-token' ? userId : null;
  });
  const { context, request } = contextWith({ authorization: 'Bearer valid-token' });
  assert.equal(await guard.canActivate(context), true);
  assert.deepEqual(seen, ['valid-token']);
  assert.deepEqual(request.user, { userId });
});
