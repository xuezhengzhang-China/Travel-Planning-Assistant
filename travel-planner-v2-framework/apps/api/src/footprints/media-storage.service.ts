import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { ConfigService } from '../config/config.service';

const extensionsByMimeType: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
};

@Injectable()
export class MediaStorageService {
  constructor(private readonly config: ConfigService) {}

  async write(bytes: Buffer, mimeType: string): Promise<string> {
    const extension = extensionsByMimeType[mimeType];
    if (!extension) throw new Error('Unsupported media type for storage');
    await mkdir(this.config.values.mediaStorageDir, { recursive: true });
    const storageKey = `${randomUUID()}${extension}`;
    await writeFile(join(this.config.values.mediaStorageDir, storageKey), bytes, {
      flag: 'wx',
      mode: 0o600,
    });
    return storageKey;
  }

  read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolveStorageKey(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await unlink(this.resolveStorageKey(storageKey));
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return;
      }
      throw error;
    }
  }

  private resolveStorageKey(storageKey: string): string {
    if (
      basename(storageKey) !== storageKey ||
      !/^[0-9a-f-]+\.(jpg|png|webp|mp4|webm)$/.test(storageKey)
    ) {
      throw new Error('Invalid media storage key');
    }
    return join(this.config.values.mediaStorageDir, storageKey);
  }
}
