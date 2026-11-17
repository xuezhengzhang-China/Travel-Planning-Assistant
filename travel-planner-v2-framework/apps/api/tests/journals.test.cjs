const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_JOURNAL_TITLE_LENGTH,
  validateJournalCreate,
  validateJournalUpdate,
} = require('../dist/journals/journals.dto.js');
const { JournalsService } = require('../dist/journals/journals.service.js');

const ownerId = 'b3e1f9a0-5d1c-4c90-9a10-d3b98d4f1234';
const footprintId = 'c4f2a0b1-6e2d-4d01-ab21-e4c0a9e51234';
const journalId = 'd5a3b1c2-7f3e-4e12-bc32-f5d1baf62345';
const mediaA = 'a1111111-1111-4111-8111-111111111111';
const mediaB = 'b2222222-2222-4222-9222-222222222222';
const createdAt = new Date('2026-11-03T00:00:00.000Z');

function journalRow(overrides = {}) {
  return {
    id: journalId,
    footprint_id: footprintId,
    title: '第一天',
    body: '到了外滩。',
    media_ids: [],
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  };
}

function rejectsNotFound(promise) {
  return assert.rejects(promise, (error) => {
    assert.equal(typeof error.getStatus, 'function');
    assert.equal(error.getStatus(), 404);
    return true;
  });
}

function rejectsWith(promise, status, code) {
  return assert.rejects(promise, (error) => {
    assert.equal(error.getStatus(), status);
    assert.equal(error.code, code);
    return true;
  });
}

test('journal create input trims text and validates mediaIds', () => {
  assert.deepEqual(
    validateJournalCreate({ footprintId, title: '  第一天  ', body: '  到了外滩。  ' }),
    { footprintId, title: '第一天', body: '到了外滩。', mediaIds: [] },
  );
  assert.deepEqual(validateJournalCreate({ footprintId, body: '没有标题' }), {
    footprintId,
    title: null,
    body: '没有标题',
    mediaIds: [],
  });
  assert.equal(
    validateJournalCreate({ footprintId, title: '   ', body: '只有空白标题' }).title,
    null,
  );
  assert.deepEqual(
    validateJournalCreate({ footprintId, body: '带图', mediaIds: [mediaA, mediaB] }).mediaIds,
    [mediaA, mediaB],
  );
  assert.throws(
    () => validateJournalCreate({ footprintId, body: '   ' }),
    /body must not be empty/,
  );
  assert.throws(
    () => validateJournalCreate({ footprintId, body: 'x', extra: true }),
    /Unexpected journal field/,
  );
  assert.throws(
    () => validateJournalCreate({ footprintId: 'not-a-uuid', body: 'x' }),
    /footprintId must be a valid UUID/,
  );
  assert.throws(
    () =>
      validateJournalCreate({
        footprintId,
        title: 'x'.repeat(MAX_JOURNAL_TITLE_LENGTH + 1),
        body: 'x',
      }),
    /title must be/,
  );
  assert.throws(
    () => validateJournalCreate({ footprintId, body: 'x', mediaIds: 'oops' }),
    /mediaIds must be an array/,
  );
  assert.throws(
    () => validateJournalCreate({ footprintId, body: 'x', mediaIds: ['not-a-uuid'] }),
    /mediaIds must contain valid UUIDs/,
  );
  assert.throws(
    () =>
      validateJournalCreate({
        footprintId,
        body: 'x',
        mediaIds: Array.from(
          { length: 10 },
          (_, index) => `a1111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
        ),
      }),
    /at most 9/,
  );
  assert.throws(
    () => validateJournalCreate({ footprintId, body: 'x', mediaIds: [mediaA, mediaA] }),
    /must not contain duplicates/,
  );
});

test('journal update requires at least one field and keeps null title semantics', () => {
  assert.deepEqual(validateJournalUpdate({ body: '更新后的正文' }), {
    body: '更新后的正文',
  });
  assert.deepEqual(validateJournalUpdate({ title: null }), { title: null });
  assert.deepEqual(validateJournalUpdate({ mediaIds: [mediaA] }), { mediaIds: [mediaA] });
  assert.deepEqual(validateJournalUpdate({ mediaIds: [] }), { mediaIds: [] });
  assert.deepEqual(validateJournalUpdate({ title: ' 新标题 ', body: '正文' }), {
    title: '新标题',
    body: '正文',
  });
  assert.throws(() => validateJournalUpdate({}), /Provide at least one of title, body or mediaIds/);
  assert.throws(
    () => validateJournalUpdate({ body: 'x', footprintId }),
    /Unexpected journal field/,
  );
  assert.throws(() => validateJournalUpdate({ body: '   ' }), /body must not be empty/);
});

test('journal create checks footprint ownership before inserting', async () => {
  const statements = [];
  const database = {
    async transaction(work) {
      return work({
        async query(text, values) {
          statements.push({ text, values });
          if (text.includes('FROM footprint_entries')) {
            return { rows: [{ id: values[0] }] };
          }
          return {
            rows: [journalRow({ title: values[3], body: values[4] })],
          };
        },
      });
    },
  };
  const service = new JournalsService(database);
  const journal = await service.create(ownerId, {
    footprintId,
    title: '第一天',
    body: '到了外滩。',
    mediaIds: [],
  });

  assert.equal(statements[0].values[0], footprintId);
  assert.equal(statements[0].values[1], ownerId);
  assert.match(statements[0].text, /FOR UPDATE/);
  assert.match(statements[1].values[0], /^[0-9a-f-]{36}$/);
  assert.equal(statements[1].values[1], footprintId);
  assert.equal(statements[1].values[2], ownerId);
  assert.deepEqual(journal, {
    id: journalId,
    footprintId,
    title: '第一天',
    body: '到了外滩。',
    mediaIds: [],
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
  });
});

test('journal create links owned media in order', async () => {
  const statements = [];
  const database = {
    async transaction(work) {
      return work({
        async query(text, values) {
          statements.push({ text, values });
          if (text.includes('FROM footprint_entries')) return { rows: [{ id: values[0] }] };
          if (text.includes('FROM media_assets')) {
            return { rows: [{ id: mediaA }, { id: mediaB }] };
          }
          if (text.includes('SELECT media_id FROM journal_media')) return { rows: [] };
          if (text.includes('INSERT INTO journal_entries')) return { rows: [journalRow()] };
          return { rows: [] };
        },
      });
    },
  };
  const service = new JournalsService(database);
  const journal = await service.create(ownerId, {
    footprintId,
    title: null,
    body: '带两张图',
    mediaIds: [mediaB, mediaA],
  });

  assert.deepEqual(journal.mediaIds, [mediaB, mediaA]);
  const links = statements.filter((entry) => entry.text.includes('INSERT INTO journal_media'));
  assert.deepEqual(
    links.map((entry) => entry.values[1]),
    [mediaB, mediaA],
  );
  assert.deepEqual(
    links.map((entry) => entry.values[2]),
    [0, 1],
  );
});

test('journal create rejects media owned by another user or already linked', async () => {
  const base = (mediaRows, usedRows) => ({
    async transaction(work) {
      return work({
        async query(text, values) {
          if (text.includes('FROM footprint_entries')) return { rows: [{ id: values[0] }] };
          if (text.includes('FROM media_assets')) return { rows: mediaRows };
          if (text.includes('SELECT media_id FROM journal_media')) return { rows: usedRows };
          return { rows: [] };
        },
      });
    },
  });
  await rejectsWith(
    new JournalsService(base([{ id: mediaA }], [])).create(ownerId, {
      footprintId,
      title: null,
      body: 'x',
      mediaIds: [mediaA, mediaB],
    }),
    404,
    'NOT_FOUND',
  );
  await rejectsWith(
    new JournalsService(base([{ id: mediaA }], [{ media_id: mediaA }])).create(ownerId, {
      footprintId,
      title: null,
      body: 'x',
      mediaIds: [mediaA],
    }),
    409,
    'MEDIA_IN_USE',
  );
});

test('journal create rejects footprints that are not owned by the current user', async () => {
  const statements = [];
  const database = {
    async transaction(work) {
      return work({
        async query(text, values) {
          statements.push({ text, values });
          return { rows: [] };
        },
      });
    },
  };
  const service = new JournalsService(database);
  await rejectsNotFound(
    service.create(ownerId, {
      footprintId,
      title: null,
      body: '试图写到他人的到访上',
      mediaIds: [],
    }),
  );
  assert.equal(statements.length, 1);
  assert.doesNotMatch(statements[0].text, /INSERT INTO journal_entries/);
});

test('journal list applies owner, footprint, year filters and paginates', async () => {
  const queries = [];
  const database = {
    async query(text, values) {
      queries.push({ text, values });
      if (text.includes('COUNT(*)')) return { rows: [{ total: '3' }] };
      return { rows: [journalRow({ media_ids: [mediaA] })] };
    },
  };
  const service = new JournalsService(database);
  const page = await service.list(ownerId, footprintId, 2026, 2, 20);

  assert.equal(page.total, 3);
  assert.equal(page.page, 2);
  assert.equal(page.pageSize, 20);
  assert.equal(page.items.length, 1);
  assert.deepEqual(page.items[0].mediaIds, [mediaA]);
  assert.match(queries[0].text, /j\.owner_id = \$1/);
  assert.match(queries[0].text, /j\.footprint_id = \$2/);
  assert.match(queries[0].text, /EXTRACT\(YEAR FROM f\.recorded_on\) = \$3/);
  assert.deepEqual(queries[1].values, [ownerId, footprintId, 2026, 20, 20]);
});

test('journal list without filters only scopes to the current user', async () => {
  const queries = [];
  const database = {
    async query(text, values) {
      queries.push({ text, values });
      return text.includes('COUNT(*)') ? { rows: [{ total: 0 }] } : { rows: [] };
    },
  };
  const service = new JournalsService(database);
  await service.list(ownerId, null, null, 1, 20);
  assert.doesNotMatch(queries[1].text, /footprint_id = \$2/);
  assert.doesNotMatch(queries[1].text, /EXTRACT\(YEAR/);
  assert.deepEqual(queries[1].values, [ownerId, 20, 0]);
});

test('journal detail and update are scoped to the owner', async () => {
  const database = {
    async query(text, values) {
      assert.match(text, /WHERE j\.id = \$1 AND j\.owner_id = \$2/);
      return { rows: [journalRow({ title: values[4] ?? '第一天', media_ids: [mediaA] })] };
    },
    async transaction(work) {
      return work({
        async query(text, values) {
          if (text.includes('SELECT') && text.includes('FROM journal_entries')) {
            return { rows: [journalRow({ media_ids: [mediaA] })] };
          }
          return {
            rows: [journalRow({ title: values[2], body: values[3], media_ids: null })],
          };
        },
      });
    },
  };
  const service = new JournalsService(database);
  const detail = await service.getById(ownerId, journalId);
  assert.equal(detail.id, journalId);
  assert.deepEqual(detail.mediaIds, [mediaA]);

  const updated = await service.update(ownerId, journalId, { body: '更新后的正文' });
  assert.equal(updated.title, '第一天');
  assert.equal(updated.body, '更新后的正文');
  assert.deepEqual(updated.mediaIds, [mediaA]);

  const cleared = await service.update(ownerId, journalId, { title: null });
  assert.equal(cleared.title, null);
});

test('journal update replaces the linked media set', async () => {
  const statements = [];
  const database = {
    async transaction(work) {
      return work({
        async query(text, values) {
          statements.push({ text, values });
          if (text.includes('SELECT') && text.includes('FROM journal_entries')) {
            return { rows: [journalRow({ media_ids: [mediaA] })] };
          }
          if (text.includes('FROM media_assets')) return { rows: [{ id: mediaB }] };
          if (text.includes('SELECT media_id FROM journal_media')) return { rows: [] };
          if (text.includes('UPDATE journal_entries')) {
            return { rows: [journalRow({ media_ids: null })] };
          }
          return { rows: [] };
        },
      });
    },
  };
  const service = new JournalsService(database);
  const updated = await service.update(ownerId, journalId, { mediaIds: [mediaB] });

  assert.deepEqual(updated.mediaIds, [mediaB]);
  assert.ok(statements.some((entry) => entry.text.includes('DELETE FROM journal_media')));
  const links = statements.filter((entry) => entry.text.includes('INSERT INTO journal_media'));
  assert.deepEqual(
    links.map((entry) => entry.values[1]),
    [mediaB],
  );
});

test('journal update can clear media with an empty array', async () => {
  const statements = [];
  const database = {
    async transaction(work) {
      return work({
        async query(text, values) {
          statements.push({ text, values });
          if (text.includes('SELECT') && text.includes('FROM journal_entries')) {
            return { rows: [journalRow({ media_ids: [mediaA] })] };
          }
          if (text.includes('UPDATE journal_entries')) {
            return { rows: [journalRow({ media_ids: null })] };
          }
          return { rows: [] };
        },
      });
    },
  };
  const service = new JournalsService(database);
  const updated = await service.update(ownerId, journalId, { mediaIds: [] });
  assert.deepEqual(updated.mediaIds, []);
  assert.ok(statements.some((entry) => entry.text.includes('DELETE FROM journal_media')));
  assert.equal(
    statements.filter((entry) => entry.text.includes('INSERT INTO journal_media')).length,
    0,
  );
});

test('journal detail and update return 404 for other owners or missing rows', async () => {
  const database = {
    async query() {
      return { rows: [] };
    },
    async transaction(work) {
      return work({
        async query() {
          return { rows: [] };
        },
      });
    },
  };
  const service = new JournalsService(database);
  await rejectsNotFound(service.getById(ownerId, journalId));
  await rejectsNotFound(service.update(ownerId, journalId, { body: 'x' }));
});

test('journal delete removes only the journal, never the footprint', async () => {
  const statements = [];
  const database = {
    async query(text, values) {
      statements.push({ text, values });
      return { rows: [{ id: values[0] }] };
    },
  };
  const service = new JournalsService(database);
  await service.delete(ownerId, journalId);
  assert.equal(statements.length, 1);
  assert.match(statements[0].text, /DELETE FROM journal_entries WHERE id = \$1 AND owner_id = \$2/);
  assert.doesNotMatch(statements[0].text, /footprint_entries/);

  const emptyDatabase = {
    async query() {
      return { rows: [] };
    },
  };
  await rejectsNotFound(new JournalsService(emptyDatabase).delete(ownerId, journalId));
});
