import { Injectable, NotFoundException } from '@nestjs/common';
import type { Journal, JournalListPage } from '@travel/shared' with { 'resolution-mode': 'import' };
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ApiError } from '../common/api-error';
import { DatabaseService } from '../database/database.service';
import type { ValidatedJournalCreate, ValidatedJournalUpdate } from './journals.dto';

interface JournalRow {
  id: string;
  footprint_id: string;
  title: string | null;
  body: string;
  media_ids: string[] | null;
  created_at: Date;
  updated_at: Date;
}

const journalColumns = `j.id, j.footprint_id, j.title, j.body, j.created_at, j.updated_at,
  COALESCE(
    (SELECT jsonb_agg(m.media_id ORDER BY m.position) FROM journal_media m WHERE m.journal_id = j.id),
    '[]'::jsonb
  ) AS media_ids`;

const returnedColumns = `id, footprint_id, title, body, created_at, updated_at, '[]'::jsonb AS media_ids`;

function toJournal(row: JournalRow): Journal {
  return {
    id: row.id,
    footprintId: row.footprint_id,
    title: row.title,
    body: row.body,
    mediaIds: Array.isArray(row.media_ids) ? row.media_ids : [],
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function journalNotFound(): NotFoundException {
  return new NotFoundException({ code: 'NOT_FOUND', message: 'Journal not found' });
}

@Injectable()
export class JournalsService {
  constructor(private readonly database: DatabaseService) {}

  async create(ownerId: string, input: ValidatedJournalCreate): Promise<Journal> {
    const journalId = randomUUID();
    return this.database.transaction(async (client) => {
      // 随笔必须挂在当前用户自己的到访记录上；他人或不存在的到访统一按 404 处理。
      const footprint = await client.query<{ id: string }>(
        'SELECT id FROM footprint_entries WHERE id = $1 AND owner_id = $2 FOR UPDATE',
        [input.footprintId, ownerId],
      );
      if (!footprint.rows[0]) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Footprint not found' });
      }
      await this.assertMediaAvailable(client, ownerId, input.mediaIds, journalId);
      const inserted = await client.query<JournalRow>(
        `INSERT INTO journal_entries (id, footprint_id, owner_id, title, body)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${returnedColumns}`,
        [journalId, input.footprintId, ownerId, input.title, input.body],
      );
      await this.insertMediaLinks(client, journalId, input.mediaIds);
      return toJournal({ ...inserted.rows[0], media_ids: input.mediaIds });
    });
  }

  async list(
    ownerId: string,
    footprintId: string | null,
    year: number | null,
    page: number,
    pageSize: number,
  ): Promise<JournalListPage> {
    const conditions = ['j.owner_id = $1'];
    const values: unknown[] = [ownerId];
    if (footprintId) {
      values.push(footprintId);
      conditions.push(`j.footprint_id = $${values.length}`);
    }
    if (year !== null) {
      values.push(year);
      conditions.push(`EXTRACT(YEAR FROM f.recorded_on) = $${values.length}`);
    }
    const where = conditions.join(' AND ');
    const countResult = await this.database.query<{ total: string | number }>(
      `SELECT COUNT(*) AS total
       FROM journal_entries j
       JOIN footprint_entries f ON f.id = j.footprint_id
       WHERE ${where}`,
      values,
    );
    const offset = (page - 1) * pageSize;
    const rowsResult = await this.database.query<JournalRow>(
      `SELECT ${journalColumns}
       FROM journal_entries j
       JOIN footprint_entries f ON f.id = j.footprint_id
       WHERE ${where}
       ORDER BY j.created_at DESC, j.id
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, offset],
    );
    return {
      items: rowsResult.rows.map(toJournal),
      page,
      pageSize,
      total: Number(countResult.rows[0]?.total ?? 0),
    };
  }

  async getById(ownerId: string, journalId: string): Promise<Journal> {
    const result = await this.database.query<JournalRow>(
      `SELECT ${journalColumns} FROM journal_entries j WHERE j.id = $1 AND j.owner_id = $2`,
      [journalId, ownerId],
    );
    const row = result.rows[0];
    if (!row) throw journalNotFound();
    return toJournal(row);
  }

  async update(
    ownerId: string,
    journalId: string,
    update: ValidatedJournalUpdate,
  ): Promise<Journal> {
    return this.database.transaction(async (client) => {
      const existing = await client.query<JournalRow>(
        `SELECT ${journalColumns}
         FROM journal_entries j
         WHERE j.id = $1 AND j.owner_id = $2
         FOR UPDATE`,
        [journalId, ownerId],
      );
      const current = existing.rows[0];
      if (!current) throw journalNotFound();
      const title = update.title === undefined ? current.title : update.title;
      const body = update.body === undefined ? current.body : update.body;
      let mediaIds = Array.isArray(current.media_ids) ? current.media_ids : [];
      if (update.mediaIds !== undefined) {
        await this.assertMediaAvailable(client, ownerId, update.mediaIds, journalId);
        await client.query('DELETE FROM journal_media WHERE journal_id = $1', [journalId]);
        await this.insertMediaLinks(client, journalId, update.mediaIds);
        mediaIds = update.mediaIds;
      }
      const updated = await client.query<JournalRow>(
        `UPDATE journal_entries
         SET title = $3, body = $4, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND owner_id = $2
         RETURNING ${returnedColumns}`,
        [journalId, ownerId, title, body],
      );
      return toJournal({ ...updated.rows[0], media_ids: mediaIds });
    });
  }

  /** 删除随笔保留到访记录与城市点亮；journal_media 关联随外键级联删除，图片保留为未引用。 */
  async delete(ownerId: string, journalId: string): Promise<void> {
    const result = await this.database.query<{ id: string }>(
      'DELETE FROM journal_entries WHERE id = $1 AND owner_id = $2 RETURNING id',
      [journalId, ownerId],
    );
    if (!result.rows[0]) throw journalNotFound();
  }

  private async assertMediaAvailable(
    client: PoolClient,
    ownerId: string,
    mediaIds: string[],
    journalId: string,
  ): Promise<void> {
    if (mediaIds.length === 0) return;
    const owned = await client.query<{ id: string }>(
      'SELECT id FROM media_assets WHERE id = ANY($1::uuid[]) AND owner_id = $2 FOR UPDATE',
      [mediaIds, ownerId],
    );
    if (owned.rows.length !== mediaIds.length) {
      throw new ApiError('NOT_FOUND', '图片不存在或不属于当前用户', 404);
    }
    const used = await client.query<{ media_id: string }>(
      'SELECT media_id FROM journal_media WHERE media_id = ANY($1::uuid[]) AND journal_id <> $2',
      [mediaIds, journalId],
    );
    if (used.rows.length > 0) {
      throw new ApiError('MEDIA_IN_USE', '图片已被其他随笔使用', 409);
    }
  }

  private async insertMediaLinks(
    client: PoolClient,
    journalId: string,
    mediaIds: string[],
  ): Promise<void> {
    for (const [position, mediaId] of mediaIds.entries()) {
      await client.query(
        'INSERT INTO journal_media (journal_id, media_id, position) VALUES ($1, $2, $3)',
        [journalId, mediaId, position],
      );
    }
  }
}
