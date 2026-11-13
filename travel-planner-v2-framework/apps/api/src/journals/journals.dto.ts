import { BadRequestException } from '@nestjs/common';
import type { CreateJournalInput } from '@travel/shared' with { 'resolution-mode': 'import' };

export const MAX_JOURNAL_TITLE_LENGTH = 120;
export const MAX_JOURNAL_BODY_LENGTH = 20000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ValidatedJournalCreate extends Omit<CreateJournalInput, 'title'> {
  title: string | null;
}

export interface ValidatedJournalUpdate {
  title?: string | null;
  body?: string;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** 标题可空；空字符串按“不设标题”保存。 */
function readTitle(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new BadRequestException('title must be a string');
  }
  const title = value.trim();
  if (!title) return null;
  if (title.length > MAX_JOURNAL_TITLE_LENGTH) {
    throw new BadRequestException(`title must be ${MAX_JOURNAL_TITLE_LENGTH} characters or fewer`);
  }
  return title;
}

function readBody(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('body must be a string');
  }
  const body = value.trim();
  if (!body) {
    throw new BadRequestException('body must not be empty');
  }
  if (body.length > MAX_JOURNAL_BODY_LENGTH) {
    throw new BadRequestException(`body must be ${MAX_JOURNAL_BODY_LENGTH} characters or fewer`);
  }
  return body;
}

/** 首期随笔只接受纯文本；带图片关联的请求必须等媒体契约落地后再放行。 */
function rejectMediaAttachments(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new BadRequestException('mediaIds must be an array');
  }
  if (value.length > 0) {
    throw new BadRequestException('media attachments are not supported yet');
  }
}

export function validateJournalCreate(body: Record<string, unknown>): ValidatedJournalCreate {
  const allowedFields = new Set(['footprintId', 'title', 'body', 'mediaIds']);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new BadRequestException('Unexpected journal field');
  }
  if (!isUuid(body.footprintId)) {
    throw new BadRequestException('footprintId must be a valid UUID');
  }
  rejectMediaAttachments(body.mediaIds);
  return {
    footprintId: body.footprintId,
    title: readTitle(body.title),
    body: readBody(body.body),
  };
}

export function validateJournalUpdate(body: Record<string, unknown>): ValidatedJournalUpdate {
  const allowedFields = new Set(['title', 'body', 'mediaIds']);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new BadRequestException('Unexpected journal field');
  }
  rejectMediaAttachments(body.mediaIds);
  const update: ValidatedJournalUpdate = {};
  if ('title' in body) update.title = readTitle(body.title);
  if ('body' in body) update.body = readBody(body.body);
  if (update.title === undefined && update.body === undefined) {
    throw new BadRequestException('Provide at least one of title or body to update');
  }
  return update;
}
