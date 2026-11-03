const test = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { mkdtemp, readFile, readdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { URL } = require('node:url');
const Response = globalThis.Response;
const {
  MAX_PHOTO_BYTES,
  currentShanghaiDate,
  validateFootprintInput,
  validateFootprintUpdate,
  validateUpload,
} = require('../dist/footprints/footprints.dto.js');
const { MediaStorageService } = require('../dist/footprints/media-storage.service.js');
const { FootprintsService } = require('../dist/footprints/footprints.service.js');
const { AmapLocationService } = require('../dist/footprints/amap-location.service.js');

const today = currentShanghaiDate();
const amapStub = {
  async resolve(longitude, latitude, coordinateSystem, poiId) {
    return {
      placeName: null,
      placeAddress: null,
      poiId,
      longitude,
      latitude,
      coordinateSystem,
      mapLongitude: coordinateSystem === 'GCJ-02' ? longitude : null,
      mapLatitude: coordinateSystem === 'GCJ-02' ? latitude : null,
      provinceName: null,
      provinceAdcode: null,
      cityName: null,
      cityAdcode: null,
    };
  },
  async searchPlaces() {
    return [];
  },
};
const validInput = {
  longitude: '121.4737',
  latitude: '31.2304',
  coordinateSystem: 'WGS-84',
  recordedOn: today,
};

test('footprint input requires location, date, and text or media', () => {
  assert.deepEqual(validateFootprintInput({ ...validInput, text: '  A visit  ' }, false), {
    longitude: 121.4737,
    latitude: 31.2304,
    coordinateSystem: 'WGS-84',
    recordedOn: today,
    text: 'A visit',
  });
  assert.throws(() => validateFootprintInput(validInput, false), /Add text or attach/);
  assert.throws(
    () => validateFootprintInput({ ...validInput, recordedOn: '2026-02-30', text: 'x' }, false),
    /valid YYYY-MM-DD/,
  );
  assert.throws(
    () => validateFootprintInput({ ...validInput, longitude: '181', text: 'x' }, false),
    /longitude/,
  );
  assert.throws(
    () =>
      validateFootprintInput(
        { ...validInput, recordedOn: '2099-01-01', text: 'x' },
        false,
        new Date('2026-11-03T00:00:00.000Z'),
      ),
    /future/,
  );
});

test('media validation checks file signatures, claimed type, and photo size', () => {
  assert.deepEqual(
    validateUpload({
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
      mimetype: 'image/jpeg',
      size: 4,
    }),
    { kind: 'photo', mimeType: 'image/jpeg' },
  );
  assert.deepEqual(
    validateUpload({
      buffer: Buffer.from('0000ftypisom'),
      mimetype: 'video/mp4',
      size: 12,
    }),
    { kind: 'video', mimeType: 'video/mp4' },
  );
  assert.throws(
    () =>
      validateUpload({
        buffer: Buffer.from([0xff, 0xd8, 0xff]),
        mimetype: 'image/png',
        size: 3,
      }),
    /does not match/,
  );
  assert.throws(
    () =>
      validateUpload({
        buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_PHOTO_BYTES)]),
        mimetype: 'image/jpeg',
        size: MAX_PHOTO_BYTES + 3,
      }),
    /10 MiB or smaller/,
  );
});

test('media storage uses generated names and reads back the exact bytes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'travel-footprints-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storage = new MediaStorageService({ values: { mediaStorageDir: directory } });
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x11]);
  const key = await storage.write(bytes, 'image/jpeg');
  assert.match(key, /^[0-9a-f-]+\.jpg$/);
  assert.deepEqual(await storage.read(key), bytes);
  await storage.delete(key);
  await assert.rejects(readFile(join(directory, key)), { code: 'ENOENT' });
});

test('failed database save compensates by deleting an uploaded file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'travel-footprints-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storage = new MediaStorageService({ values: { mediaStorageDir: directory } });
  const database = {
    async transaction() {
      throw new Error('simulated database failure');
    },
  };
  const service = new FootprintsService(database, storage, amapStub);
  await assert.rejects(
    service.create(
      'b3e1f9a0-5d1c-4c90-9a10-d3b98d4f1234',
      {
        longitude: 121,
        latitude: 31,
        coordinateSystem: 'WGS-84',
        recordedOn: today,
        text: null,
      },
      {
        buffer: Buffer.from([0xff, 0xd8, 0xff]),
        mimetype: 'image/jpeg',
        size: 3,
        originalname: 'photo.jpg',
      },
      { kind: 'photo', mimeType: 'image/jpeg' },
    ),
    /simulated database failure/,
  );
  assert.deepEqual(await readdir(directory), []);
});

test('footprint save writes coordinates, date, and media metadata in one transaction', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'travel-footprints-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storage = new MediaStorageService({ values: { mediaStorageDir: directory } });
  const statements = [];
  const database = {
    async transaction(work) {
      return work({
        async query(text, values) {
          statements.push({ text, values });
          if (text.includes('INSERT INTO footprint_entries')) {
            return {
              rows: [
                {
                  id: values[0],
                  text_content: values[2],
                  longitude: values[3],
                  latitude: values[4],
                  coordinate_system: values[5],
                  recorded_on: values[6],
                  place_name: values[7],
                  place_address: values[8],
                  poi_id: values[9],
                  map_longitude: values[10],
                  map_latitude: values[11],
                  province_name: values[12],
                  province_adcode: values[13],
                  city_name: values[14],
                  city_adcode: values[15],
                  created_at: new Date('2026-11-03T00:00:00.000Z'),
                  updated_at: new Date('2026-11-03T00:00:00.000Z'),
                },
              ],
            };
          }
          return {
            rows: [
              {
                id: values[0],
                kind: values[4],
                original_name: values[5],
                mime_type: values[6],
                size_bytes: values[7],
                created_at: new Date('2026-11-03T00:00:00.000Z'),
              },
            ],
          };
        },
      });
    },
    async query(text) {
      assert.match(text, /SELECT storage_key FROM footprint_media_cleanup/);
      return { rows: [] };
    },
  };
  const service = new FootprintsService(database, storage, amapStub);
  const result = await service.create(
    'b3e1f9a0-5d1c-4c90-9a10-d3b98d4f1234',
    {
      longitude: 121.4737,
      latitude: 31.2304,
      coordinateSystem: 'WGS-84',
      recordedOn: today,
      text: 'A visit',
    },
    {
      buffer: Buffer.from([0xff, 0xd8, 0xff]),
      mimetype: 'image/jpeg',
      size: 3,
      originalname: 'photo.jpg',
    },
    { kind: 'photo', mimeType: 'image/jpeg' },
  );
  assert.equal(statements.length, 2);
  assert.deepEqual(statements[0].values.slice(2), [
    'A visit',
    121.4737,
    31.2304,
    'WGS-84',
    today,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ]);
  assert.equal(statements[1].values[4], 'photo');
  assert.equal(result.recordedOn, today);
  assert.equal(result.latitude, 31.2304);
  assert.deepEqual(result.media, {
    id: statements[1].values[0],
    kind: 'photo',
    originalName: 'photo.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 3,
    createdAt: '2026-11-03T00:00:00.000Z',
  });
  assert.equal(Object.hasOwn(result.media, 'storageKey'), false);
  assert.equal((await readdir(directory)).length, 1);
});

test('AMap place search maps POI and administrative fields and ignores invalid results', async (t) => {
  const config = { values: { amapWebServiceKey: 'test-key' } };
  const service = new AmapLocationService(config);
  const fetch = t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(input);
    assert.equal(url.pathname, '/v5/place/text');
    assert.equal(url.searchParams.get('key'), 'test-key');
    assert.equal(url.searchParams.get('keywords'), '东方明珠');
    return Response.json({
      status: '1',
      pois: [
        {
          id: 'B000A83M5F',
          name: '东方明珠',
          address: ['世纪大道', '1号'],
          location: '121.499809,31.239666',
          pname: '上海市',
          pcode: '310000',
          cityname: ['上海市'],
          adcode: '310101',
        },
        { id: 'incomplete', name: '缺少坐标' },
      ],
    });
  });

  assert.deepEqual(await service.searchPlaces('东方明珠'), [
    {
      poiId: 'B000A83M5F',
      name: '东方明珠',
      address: '世纪大道1号',
      longitude: 121.499809,
      latitude: 31.239666,
      provinceName: '上海市',
      provinceAdcode: '310000',
      cityName: '上海市',
      cityAdcode: '310100',
      coordinateSystem: 'GCJ-02',
    },
  ]);
  assert.equal(fetch.mock.callCount(), 1);
});

test('AMap coordinate resolution converts GPS coordinates before reverse geocoding', async (t) => {
  const requestedUrls = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(input);
    requestedUrls.push(url);
    if (url.pathname.endsWith('/coordinate/convert')) {
      assert.equal(url.searchParams.get('coordsys'), 'gps');
      assert.equal(url.searchParams.get('locations'), '121.473700,31.230400');
      return Response.json({ status: '1', locations: '121.478226,31.229571' });
    }
    assert.equal(url.pathname, '/v3/geocode/regeo');
    assert.equal(url.searchParams.get('location'), '121.478226,31.229571');
    return Response.json({
      status: '1',
      regeocode: {
        formatted_address: '上海市黄浦区人民广场',
        addressComponent: { province: '上海市', city: '上海市', adcode: '310101' },
      },
    });
  });
  const service = new AmapLocationService({ values: { amapWebServiceKey: 'test-key' } });

  assert.deepEqual(await service.resolve(121.4737, 31.2304, 'WGS-84', null), {
    placeName: null,
    placeAddress: '上海市黄浦区人民广场',
    poiId: null,
    longitude: 121.4737,
    latitude: 31.2304,
    coordinateSystem: 'WGS-84',
    provinceName: '上海市',
    provinceAdcode: '310000',
    cityName: '上海市',
    cityAdcode: '310100',
    mapLongitude: 121.478226,
    mapLatitude: 31.229571,
  });
  assert.equal(requestedUrls.length, 2);
});

test('AMap operations fail clearly when the key is missing or the provider returns invalid coordinates', async (t) => {
  const missingKeyService = new AmapLocationService({ values: { amapWebServiceKey: null } });
  await assert.rejects(
    missingKeyService.searchPlaces('景点'),
    (error) => error.getStatus() === 503,
  );

  const invalidCoordinatesService = new AmapLocationService({
    values: { amapWebServiceKey: 'test-key' },
  });
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ status: '1', locations: 'not-a-coordinate' }),
  );
  await assert.rejects(
    invalidCoordinatesService.resolve(121, 31, 'WGS-84', null),
    (error) => error.getStatus() === 502,
  );
});

test('map data deduplicates POIs and nearby coordinates while preserving check-in counts', async () => {
  const rows = [
    mapEntry({ id: 'poi-1', poi_id: 'poi-shanghai', longitude: 121.5, latitude: 31.2 }),
    mapEntry({ id: 'poi-2', poi_id: 'poi-shanghai', longitude: 121.6, latitude: 31.3 }),
    mapEntry({ id: 'nearby', longitude: 121.5001, latitude: 31.2 }),
    mapEntry({ id: 'other-place', longitude: 121.502, latitude: 31.2 }),
    mapEntry({
      id: 'unknown-admin',
      longitude: 120,
      latitude: 30,
      coordinate_system: 'WGS-84',
      map_longitude: null,
      map_latitude: null,
      province_name: null,
      province_adcode: null,
      city_name: null,
      city_adcode: null,
    }),
    mapEntry({
      id: 'other-city',
      longitude: 120.5,
      latitude: 30.5,
      city_name: '苏州市',
      city_adcode: '320500',
      province_name: '江苏省',
      province_adcode: '320000',
    }),
  ];
  const database = {
    async query() {
      return { rows };
    },
  };
  const service = new FootprintsService(database, {}, amapStub);

  const national = await service.getMapData('owner-id', null);
  assert.deepEqual(national.summary, {
    provinceCount: 2,
    cityCount: 2,
    locationCount: 4,
    checkInCount: 6,
  });
  const shanghai = await service.getMapData('owner-id', '310000');
  assert.deepEqual(shanghai.summary, national.summary);
  assert.deepEqual(shanghai.provinces, []);
  assert.equal(shanghai.cities.length, 1);
  assert.equal(shanghai.cities[0].cityAdcode, '310100');
  assert.equal(shanghai.cities[0].checkInCount, 4);
  assert.equal(shanghai.cities[0].locationCount, 2);
  assert.equal(shanghai.locations.length, 2);
  assert.equal(
    shanghai.locations.find((location) => location.poiId === 'poi-shanghai').checkInCount,
    3,
  );
});

test('map data passes the selected year to its single aggregation query', async () => {
  let query;
  const service = new FootprintsService(
    {
      async query(text, values) {
        query = { text, values };
        return { rows: [] };
      },
    },
    {},
    amapStub,
  );
  const result = await service.getMapData('owner-1', null, 2024);

  assert.deepEqual(result.summary, {
    provinceCount: 0,
    cityCount: 0,
    locationCount: 0,
    checkInCount: 0,
  });
  assert.match(query.text, /EXTRACT\(YEAR FROM recorded_on\) = \$2/);
  assert.deepEqual(query.values, ['owner-1', 2024]);
});

test('footprint list applies owner/year filters, ordering, and pagination', async () => {
  const calls = [];
  const database = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes('COUNT(*)')) return { rows: [{ total: '3' }] };
      return { rows: [joinedMapEntry({ id: 'listed-entry', recorded_on: '2025-06-07' })] };
    },
  };
  const service = new FootprintsService(database, {}, amapStub);

  assert.deepEqual(await service.list('owner-1', 2025, 2, 1), {
    items: [
      {
        id: 'listed-entry',
        text: 'A visit',
        placeName: '上海地点',
        placeAddress: null,
        poiId: null,
        longitude: 121.5,
        latitude: 31.2,
        coordinateSystem: 'GCJ-02',
        mapLongitude: null,
        mapLatitude: null,
        provinceName: '上海市',
        provinceAdcode: '310000',
        cityName: '上海市',
        cityAdcode: '310100',
        recordedOn: '2025-06-07',
        media: null,
        createdAt: '2026-11-03T00:00:00.000Z',
        updatedAt: '2026-11-03T00:00:00.000Z',
      },
    ],
    page: 2,
    pageSize: 1,
    total: 3,
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].text, /e\.owner_id = \$1/);
  assert.match(calls[0].text, /EXTRACT\(YEAR FROM e\.recorded_on\) = \$2/);
  assert.deepEqual(calls[0].values, ['owner-1', 2025]);
  assert.match(calls[1].text, /ORDER BY e\.recorded_on DESC/);
  assert.deepEqual(calls[1].values, ['owner-1', 2025, 1, 1]);
});

test('footprint details are restricted to the owner', async () => {
  const database = {
    async query(text, values) {
      assert.match(text, /e\.id = \$1 AND e\.owner_id = \$2/);
      assert.deepEqual(values, ['entry-id', 'owner-1']);
      return { rows: [] };
    },
  };
  const service = new FootprintsService(database, {}, amapStub);
  await assert.rejects(
    service.getById('owner-1', 'entry-id'),
    (error) => error.getStatus() === 404,
  );
});

test('footprint updates preserve omitted fields and validate media and coordinates', () => {
  const existing = {
    id: 'entry-id',
    text: 'Keep this text',
    placeName: '上海地点',
    placeAddress: null,
    poiId: 'poi-123',
    longitude: 121.5,
    latitude: 31.2,
    coordinateSystem: 'GCJ-02',
    mapLongitude: 121.5,
    mapLatitude: 31.2,
    provinceName: '上海市',
    provinceAdcode: '310000',
    cityName: '上海市',
    cityAdcode: '310100',
    recordedOn: today,
    media: null,
    createdAt: '2026-11-03T00:00:00.000Z',
    updatedAt: '2026-11-03T00:00:00.000Z',
  };

  assert.deepEqual(validateFootprintUpdate({ text: '  Updated  ' }, false, existing), {
    input: {
      longitude: 121.5,
      latitude: 31.2,
      coordinateSystem: 'GCJ-02',
      recordedOn: today,
      text: 'Updated',
      poiId: 'poi-123',
    },
    removeMedia: false,
    locationChanged: false,
  });
  assert.throws(
    () => validateFootprintUpdate({ longitude: 120 }, false, existing),
    /must be updated together/,
  );
  assert.throws(
    () => validateFootprintUpdate({ text: null, removeMedia: true }, false, existing),
    /Add text or attach/,
  );
  assert.equal(
    validateFootprintUpdate(
      { longitude: 120, latitude: 30, coordinateSystem: 'WGS-84' },
      false,
      existing,
    ).input.poiId,
    undefined,
  );
});

test('footprint metadata updates avoid external location lookups and keep media intact', async () => {
  const existing = mapEntry({
    id: 'entry-id',
    place_name: '原地点',
    poi_id: 'poi-123',
  });
  const existingMedia = {
    id: 'media-id',
    kind: 'photo',
    original_name: 'photo.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 10,
    created_at: new Date('2026-11-03T00:00:00.000Z'),
    storage_key: 'stored.jpg',
  };
  let resolved = false;
  const locationService = {
    async resolve() {
      resolved = true;
      return {};
    },
  };
  const clientQueries = [];
  const database = {
    async transaction(work) {
      return work({
        async query(text, values) {
          clientQueries.push({ text, values });
          if (text.includes('FROM footprint_entries WHERE id')) return { rows: [existing] };
          if (text.includes('FROM footprint_media WHERE entry_id')) {
            return { rows: [existingMedia] };
          }
          if (text.includes('UPDATE footprint_entries')) {
            return { rows: [{ ...existing, text_content: values[2], updated_at: new Date() }] };
          }
          throw new Error(`Unexpected SQL in test: ${text}`);
        },
      });
    },
    async query(text) {
      assert.match(text, /SELECT storage_key FROM footprint_media_cleanup/);
      return { rows: [] };
    },
  };
  const service = new FootprintsService(database, {}, locationService);
  const result = await service.update('owner-1', 'entry-id', {
    input: {
      longitude: existing.longitude,
      latitude: existing.latitude,
      coordinateSystem: existing.coordinate_system,
      recordedOn: today,
      text: 'Edited text',
      poiId: existing.poi_id,
    },
    removeMedia: false,
    locationChanged: false,
  });

  assert.equal(result.text, 'Edited text');
  assert.deepEqual(result.media, {
    id: 'media-id',
    kind: 'photo',
    originalName: 'photo.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 10,
    createdAt: '2026-11-03T00:00:00.000Z',
  });
  assert.equal(resolved, false);
  assert.ok(clientQueries.some(({ text }) => text.includes('owner_id = $2')));
});

test('deleting a footprint queues and removes its private media file', async () => {
  const queued = [];
  const deletedFiles = [];
  const database = {
    async transaction(work) {
      return work({
        async query(text, values) {
          if (text.includes('FROM footprint_entries WHERE id')) return { rows: [{ id: 'entry' }] };
          if (text.includes('FROM footprint_media WHERE entry_id')) {
            return { rows: [{ storage_key: 'media-file.jpg' }] };
          }
          if (text.includes('INSERT INTO footprint_media_cleanup')) {
            queued.push(values[0]);
            return { rows: [] };
          }
          if (text.includes('DELETE FROM footprint_entries')) return { rows: [] };
          throw new Error(`Unexpected SQL in test: ${text}`);
        },
      });
    },
    async query(text, values) {
      if (text.startsWith('SELECT storage_key FROM footprint_media_cleanup')) {
        return { rows: queued.map((storage_key) => ({ storage_key })) };
      }
      if (text.startsWith('DELETE FROM footprint_media_cleanup')) {
        queued.splice(queued.indexOf(values[0]), 1);
        return { rows: [] };
      }
      throw new Error(`Unexpected cleanup SQL in test: ${text}`);
    },
  };
  const storage = {
    async delete(storageKey) {
      deletedFiles.push(storageKey);
    },
  };
  const service = new FootprintsService(database, storage, amapStub);

  await service.delete('owner-1', 'entry-id');

  assert.deepEqual(deletedFiles, ['media-file.jpg']);
  assert.deepEqual(queued, []);
});

test('removing a footprint attachment queues cleanup and returns no media', async () => {
  const queued = [];
  const deletedFiles = [];
  const currentEntry = mapEntry({ id: 'entry-id', text_content: 'Keep text' });
  const oldMedia = {
    id: 'media-id',
    kind: 'photo',
    original_name: 'photo.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 10,
    created_at: new Date('2026-11-03T00:00:00.000Z'),
    storage_key: 'old-media.jpg',
  };
  const database = {
    async transaction(work) {
      return work({
        async query(text, values) {
          if (text.includes('FROM footprint_entries WHERE id')) return { rows: [currentEntry] };
          if (text.includes('FROM footprint_media WHERE entry_id')) return { rows: [oldMedia] };
          if (text.includes('INSERT INTO footprint_media_cleanup')) {
            queued.push(values[0]);
            return { rows: [] };
          }
          if (text.startsWith('DELETE FROM footprint_media')) return { rows: [] };
          if (text.includes('UPDATE footprint_entries')) {
            return { rows: [{ ...currentEntry, updated_at: new Date() }] };
          }
          throw new Error(`Unexpected SQL in test: ${text}`);
        },
      });
    },
    async query(text, values) {
      if (text.startsWith('SELECT storage_key FROM footprint_media_cleanup')) {
        return { rows: queued.map((storage_key) => ({ storage_key })) };
      }
      if (text.startsWith('DELETE FROM footprint_media_cleanup')) {
        queued.splice(queued.indexOf(values[0]), 1);
        return { rows: [] };
      }
      throw new Error(`Unexpected cleanup SQL in test: ${text}`);
    },
  };
  const service = new FootprintsService(
    database,
    {
      async delete(storageKey) {
        deletedFiles.push(storageKey);
      },
    },
    amapStub,
  );

  const result = await service.update('owner-1', 'entry-id', {
    input: {
      longitude: currentEntry.longitude,
      latitude: currentEntry.latitude,
      coordinateSystem: currentEntry.coordinate_system,
      recordedOn: today,
      text: 'Keep text',
    },
    removeMedia: true,
    locationChanged: false,
  });

  assert.equal(result.text, 'Keep text');
  assert.equal(result.media, null);
  assert.deepEqual(deletedFiles, ['old-media.jpg']);
  assert.deepEqual(queued, []);
});

function mapEntry(overrides) {
  return {
    id: 'entry-id',
    text_content: 'A visit',
    longitude: 121.5,
    latitude: 31.2,
    coordinate_system: 'GCJ-02',
    place_name: '上海地点',
    place_address: null,
    poi_id: null,
    map_longitude: null,
    map_latitude: null,
    province_name: '上海市',
    province_adcode: '310000',
    city_name: '上海市',
    city_adcode: '310100',
    recorded_on: today,
    created_at: new Date('2026-11-03T00:00:00.000Z'),
    updated_at: new Date('2026-11-03T00:00:00.000Z'),
    ...overrides,
  };
}

function joinedMapEntry(overrides) {
  return {
    ...mapEntry(overrides),
    media_id: null,
    media_kind: null,
    media_original_name: null,
    media_mime_type: null,
    media_size_bytes: null,
    media_created_at: null,
    media_storage_key: null,
  };
}
