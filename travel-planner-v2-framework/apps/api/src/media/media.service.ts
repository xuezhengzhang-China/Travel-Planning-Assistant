import { Injectable, Logger } from '@nestjs/common';
import type { MediaAsset } from '@travel/shared' with { 'resolution-mode': 'import' };
import { randomUUID } from 'node:crypto';
import { ApiError } from '../common/api-error';
import { DatabaseService } from '../database/database.service';
import { MediaStorageService } from '../footprints/media-storage.service';
import type { UploadedMedia } from '../footprints/footprints.dto';
import type { ValidatedMediaUpload } from './media.dto';

const logger = new Logger('MediaService');

interface MediaRow {
  id: string;
  storage_key: string;
  mime_type: string;
  size_bytes: string | number;
  original_name: string;
  created_at: Date;
}

function toMediaAsset(row: MediaRow): MediaAsset {
  return {
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function safeOriginalName(name: string): string {
  return name.replace(/^.*[\\/]/, '').slice(0, 255) || 'upload';
}

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23503'
  );
}

@Injectable()
export class MediaService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: MediaStorageService,
  ) {}

  async upload(
    ownerId: string,
    file: UploadedMedia,
    upload: ValidatedMediaUpload,
  ): Promise<MediaAsset> {
    const mediaId = randomUUID();
    const storageKey = await this.storage.write(file.buffer, upload.mimeType);
    try {
      const inserted = await this.database.query<MediaRow>(
        `INSERT INTO media_assets (id, owner_id, storage_key, mime_type, size_bytes, original_name)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, storage_key, mime_type, size_bytes, original_name, created_at`,
        [
          mediaId,
          ownerId,
          storageKey,
          upload.mimeType,
          file.size,
          safeOriginalName(file.originalname),
        ],
      );
      return toMediaAsset(inserted.rows[0]);
    } catch (error) {
      // 文件已写入但数据库失败时补偿删除，避免留下孤立文件。
      try {
        await this.storage.delete(storageKey);
      } catch (cleanupError) {
        logger.error('Failed to remove media file after database insert failed', cleanupError);
      }
      throw error;
    }
  }

  async read(ownerId: string, mediaId: string): Promise<{ bytes: Buffer; mimeType: string }> {
    const result = await this.database.query<{ storage_key: string; mime_type: string }>(
      'SELECT storage_key, mime_type FROM media_assets WHERE id = $1 AND owner_id = $2',
      [mediaId, ownerId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError('NOT_FOUND', '图片不存在', 404);
    return { bytes: await this.storage.read(row.storage_key), mimeType: row.mime_type };
  }

  async remove(ownerId: string, mediaId: string): Promise<void> {
    const result = await this.database.query<{ storage_key: string }>(
      'SELECT storage_key FROM media_assets WHERE id = $1 AND owner_id = $2',
      [mediaId, ownerId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError('NOT_FOUND', '图片不存在', 404);
    try {
      await this.database.query('DELETE FROM media_assets WHERE id = $1 AND owner_id = $2', [
        mediaId,
        ownerId,
      ]);
    } catch (error) {
      // journal_media 的外键 RESTRICT 兜住并发绑定：仍被引用时返回 409 而不是 500。
      if (isForeignKeyViolation(error)) {
        throw new ApiError('MEDIA_IN_USE', '图片仍被随笔引用，请先解除关联', 409);
      }
      throw error;
    }
    try {
      await this.storage.delete(row.storage_key);
    } catch (error) {
      // 数据库已删除，文件删除失败不应让接口失败；清理任务留给后续迭代。
      logger.error('Failed to remove media file after metadata deletion', error);
    }
  }
}
