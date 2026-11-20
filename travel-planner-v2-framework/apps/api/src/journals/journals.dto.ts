import { BadRequestException } from '@nestjs/common';
import type { CreateJournalInput } from '@travel/shared' with { 'resolution-mode': 'import' };

export const MAX_JOURNAL_TITLE_LENGTH = 120;
export const MAX_JOURNAL_BODY_LENGTH = 20000;
export const MAX_JOURNAL_MEDIA = 9;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ValidatedJournalCreate extends Omit<CreateJournalInput, 'title'> {
  title: string | null;
  mediaIds: string[];
}

export interface ValidatedJournalUpdate {
  title?: string | null;
  body?: string;
  mediaIds?: string[];
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** 标题可空；空字符串按“不设标题”保存。 */
function readTitle(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new BadRequestException('标题必须是字符串');
  }
  const title = value.trim();
  if (!title) return null;
  if (title.length > MAX_JOURNAL_TITLE_LENGTH) {
    throw new BadRequestException(
      `标题最多 ${MAX_JOURNAL_TITLE_LENGTH} 字，当前 ${title.length} 字`,
    );
  }
  return title;
}

function readBody(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('正文必须是字符串');
  }
  const body = value.trim();
  if (!body) {
    throw new BadRequestException('正文不能为空');
  }
  if (body.length > MAX_JOURNAL_BODY_LENGTH) {
    throw new BadRequestException(`正文最多 ${MAX_JOURNAL_BODY_LENGTH} 字，当前 ${body.length} 字`);
  }
  return body;
}

/** mediaIds 必须是 UUID 数组：最多 9 个、不重复，顺序即展示顺序。 */
function readMediaIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException('mediaIds 必须是数组');
  }
  if (value.length > MAX_JOURNAL_MEDIA) {
    throw new BadRequestException(`最多 ${MAX_JOURNAL_MEDIA} 张图片`);
  }
  const ids = value.map((item) => {
    if (!isUuid(item)) throw new BadRequestException('mediaIds 必须是合法的 UUID');
    return item;
  });
  if (new Set(ids).size !== ids.length) {
    throw new BadRequestException('mediaIds 不能重复');
  }
  return ids;
}

export function validateJournalCreate(body: Record<string, unknown>): ValidatedJournalCreate {
  const allowedFields = new Set(['footprintId', 'title', 'body', 'mediaIds']);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new BadRequestException('包含未支持的手账字段');
  }
  if (!isUuid(body.footprintId)) {
    throw new BadRequestException('footprintId 必须是合法的 UUID');
  }
  return {
    footprintId: body.footprintId,
    title: readTitle(body.title),
    body: readBody(body.body),
    mediaIds: body.mediaIds === undefined ? [] : readMediaIds(body.mediaIds),
  };
}

export function validateJournalUpdate(body: Record<string, unknown>): ValidatedJournalUpdate {
  const allowedFields = new Set(['title', 'body', 'mediaIds']);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new BadRequestException('包含未支持的手账字段');
  }
  const update: ValidatedJournalUpdate = {};
  if ('title' in body) update.title = readTitle(body.title);
  if ('body' in body) update.body = readBody(body.body);
  if ('mediaIds' in body) update.mediaIds = readMediaIds(body.mediaIds);
  if (update.title === undefined && update.body === undefined && update.mediaIds === undefined) {
    throw new BadRequestException('至少提供标题、正文或图片中的一项');
  }
  return update;
}
