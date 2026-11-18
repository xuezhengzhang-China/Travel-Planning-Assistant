const test = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { mkdtemp, readdir, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { MediaStorageService } = require('../dist/footprints/media-storage.service.js');
const { MediaService } = require('../dist/media/media.service.js');
const { validateMediaUpload, MAX_MEDIA_BYTES } = require('../dist/media/media.dto.js');

const ownerId = 'b3e1f9a0-5d1c-4c90-9a10-d3b98d4f1234';
const otherOwner = 'c4f2a0b1-6e2d-4d01-ab21-e4c0a9e51234';
const mediaId = 'd5a3b1c2-7f3e-4e12-bc32-f5d1baf62345';
const createdAt = new Date('2026-11-15T00:00:00.000Z');

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const webp = Buffer.from('RIFF0000WEBP', 'ascii');
const pdf = Buffer.from('%PDF-1.4', 'ascii');
const mp4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('ftyp', 'ascii'),
  Buffer.alloc(8),
]);

function rejectsWith(promise, status, code) {
  return assert.rejects(promise, (error) => {
    assert.equal(error.getStatus(), status);
    assert.equal(error.code, code);
    return true;
  });
}

async function withStorage(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'travel-media-'));
  try {
    const storage = new MediaStorageService({ values: { mediaStorageDir: directory } });
    return await callback(directory, storage);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('media upload validation accepts real images and rejects other types', () => {
  assert.deepEqual(
    validateMediaUpload({
      buffer: png,
      mimetype: 'image/png',
      size: png.length,
      originalname: 'a.png',
    }),
    {
      file: { buffer: png, mimetype: 'image/png', size: png.length, originalname: 'a.png' },
      mimeType: 'image/png',
    },
  );
  assert.equal(
    validateMediaUpload({
      buffer: jpeg,
      mimetype: 'image/jpeg',
      size: jpeg.length,
      originalname: 'a.jpg',
    }).mimeType,
    'image/jpeg',
  );
  assert.equal(
    validateMediaUpload({
      buffer: webp,
      mimetype: 'image/webp',
      size: webp.length,
      originalname: 'a.webp',
    }).mimeType,
    'image/webp',
  );
  assert.throws(() => validateMediaUpload(undefined), /file is required/);
  assert.throws(
    () =>
      validateMediaUpload({
        buffer: pdf,
        mimetype: 'image/png',
        size: pdf.length,
        originalname: 'a.png',
      }),
    /仅支持 JPEG、PNG、WebP/,
  );
  assert.throws(
    () =>
      validateMediaUpload({
        buffer: mp4,
        mimetype: 'video/mp4',
        size: mp4.length,
        originalname: 'a.mp4',
      }),
    /仅支持 JPEG、PNG、WebP/,
  );
  assert.throws(
    () =>
      validateMediaUpload({
        buffer: jpeg,
        mimetype: 'image/png',
        size: jpeg.length,
        originalname: 'a.png',
      }),
    /文件类型与内容不一致/,
  );
  assert.throws(
    () =>
      validateMediaUpload({
        buffer: png,
        mimetype: 'image/png',
        size: MAX_MEDIA_BYTES + 1,
        originalname: 'huge.png',
      }),
    /不能超过 10 MiB/,
  );
});

test('media upload writes the file and returns metadata', async () => {
  await withStorage(async (directory, storage) => {
    const statements = [];
    const database = {
      async query(text, values) {
        statements.push({ text, values });
        return {
          rows: [
            {
              id: values[0],
              storage_key: values[2],
              mime_type: values[3],
              size_bytes: values[4],
              original_name: values[5],
              created_at: createdAt,
            },
          ],
        };
      },
    };
    const service = new MediaService(database, storage);
    const file = {
      buffer: png,
      mimetype: 'image/png',
      size: png.length,
      originalname: 'C:\\tmp\\photo.png',
    };
    const asset = await service.upload(ownerId, file, validateMediaUpload(file));

    assert.match(asset.id, /^[0-9a-f-]{36}$/);
    assert.equal(asset.mimeType, 'image/png');
    assert.equal(asset.sizeBytes, png.length);
    assert.equal(asset.originalName, 'photo.png');
    assert.equal(asset.createdAt, createdAt.toISOString());
    const stored = await readdir(directory);
    assert.equal(stored.length, 1);
    assert.deepEqual(await readFile(join(directory, stored[0])), png);
  });
});

test('media upload deletes the written file when the database insert fails', async () => {
  await withStorage(async (directory, storage) => {
    const database = {
      async query() {
        throw new Error('simulated database failure');
      },
    };
    const service = new MediaService(database, storage);
    const file = { buffer: png, mimetype: 'image/png', size: png.length, originalname: 'a.png' };
    await assert.rejects(
      service.upload(ownerId, file, validateMediaUpload(file)),
      /simulated database failure/,
    );
    assert.deepEqual(await readdir(directory), []);
  });
});

test('media read is scoped to the owner', async () => {
  await withStorage(async (directory, storage) => {
    const key = await storage.write(png, 'image/png');
    const database = {
      async query(text, values) {
        assert.deepEqual(values, [mediaId, ownerId]);
        return { rows: [{ storage_key: key, mime_type: 'image/png' }] };
      },
    };
    const service = new MediaService(database, storage);
    const media = await service.read(ownerId, mediaId);
    assert.equal(media.mimeType, 'image/png');
    assert.deepEqual(media.bytes, png);

    const otherDatabase = {
      async query() {
        return { rows: [] };
      },
    };
    await rejectsWith(
      new MediaService(otherDatabase, storage).read(otherOwner, mediaId),
      404,
      'NOT_FOUND',
    );
    assert.ok(await readdir(directory));
  });
});

test('media delete removes the row and file, but refuses media still linked', async () => {
  await withStorage(async (directory, storage) => {
    const key = await storage.write(png, 'image/png');
    const statements = [];
    const database = {
      async query(text, values) {
        statements.push({ text, values });
        if (text.startsWith('SELECT')) {
          return { rows: [{ storage_key: key }] };
        }
        return { rows: [] };
      },
    };
    const service = new MediaService(database, storage);
    await service.remove(ownerId, mediaId);
    assert.deepEqual(await readdir(directory), []);
    assert.ok(statements.some((entry) => entry.text.includes('DELETE FROM media_assets')));

    const linkedKey = await storage.write(png, 'image/png');
    const linkedDatabase = {
      async query(text) {
        if (text.startsWith('SELECT')) return { rows: [{ storage_key: linkedKey }] };
        const error = new Error('fk violation');
        error.code = '23503';
        throw error;
      },
    };
    await rejectsWith(
      new MediaService(linkedDatabase, storage).remove(ownerId, mediaId),
      409,
      'MEDIA_IN_USE',
    );
    assert.deepEqual(await readdir(directory), [linkedKey]);

    const missingDatabase = {
      async query() {
        return { rows: [] };
      },
    };
    await rejectsWith(
      new MediaService(missingDatabase, storage).remove(ownerId, mediaId),
      404,
      'NOT_FOUND',
    );
  });
});
