require('reflect-metadata');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const pdf = Buffer.from('%PDF-1.4', 'ascii');

async function fixture() {
  process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
  const { createApp } = require('../dist/app.js');
  const { AuthService } = require('../dist/auth/auth.service.js');
  const { MediaService } = require('../dist/media/media.service.js');
  const app = await createApp({ logger: false });
  app.get(AuthService).verifyAccessToken = async (token) =>
    token === 'owner-token' ? 'owner-id' : null;
  app.get(MediaService).upload = async (ownerId, file, upload) => ({
    id: 'd5a3b1c2-7f3e-4e12-bc32-f5d1baf62345',
    originalName: file.originalname,
    mimeType: upload.mimeType,
    sizeBytes: file.size,
    createdAt: new Date('2026-11-15T00:00:00.000Z').toISOString(),
  });
  await app.listen(0, '127.0.0.1');
  return { app, base: (await app.getUrl()) + '/api' };
}

function form(bytes, type, name) {
  const body = new FormData();
  body.append('file', new Blob([bytes], { type }), name);
  return body;
}

test('media HTTP endpoint enforces auth, type and size checks', async () => {
  const { app, base } = await fixture();
  try {
    const anonymous = await fetch(`${base}/media`, {
      method: 'POST',
      body: form(png, 'image/png', 'a.png'),
    });
    assert.equal(anonymous.status, 401);

    const rejected = await fetch(`${base}/media`, {
      method: 'POST',
      headers: { Authorization: 'Bearer owner-token' },
      body: form(pdf, 'image/png', 'a.png'),
    });
    assert.equal(rejected.status, 415);
    assert.equal((await rejected.json()).code, 'UNSUPPORTED_MEDIA_TYPE');

    const accepted = await fetch(`${base}/media`, {
      method: 'POST',
      headers: { Authorization: 'Bearer owner-token' },
      body: form(png, 'image/png', 'photo.png'),
    });
    assert.equal(accepted.status, 201);
    const asset = await accepted.json();
    assert.equal(asset.mimeType, 'image/png');
    assert.equal(asset.originalName, 'photo.png');
    assert.equal(asset.sizeBytes, png.length);

    const missing = await fetch(`${base}/media`, {
      method: 'POST',
      headers: { Authorization: 'Bearer owner-token' },
      body: new FormData(),
    });
    assert.equal(missing.status, 400);
  } finally {
    await app.close();
  }
});
